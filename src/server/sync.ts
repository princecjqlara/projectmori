import { DateTime } from "luxon";
import { graph, graphPages } from "./facebook";
import { decrypt } from "./crypto";
import { pool, transaction, audit } from "./db";
import { evaluateAd, moneyMinor } from "@/lib/domain";
import type { Tenant, Ad, Contact, Order, AdSpend } from "@/lib/types";
type Account = {
  id: string;
  token_encrypted: string;
  currency: string;
  timezone: string;
};
type RemoteAd = {
  id: string;
  name: string;
  effective_status: string;
  creative?: { name?: string; thumbnail_url?: string };
  adset?: { daily_budget?: string };
};
type Insight = {
  ad_id: string;
  date_start: string;
  spend: string;
  impressions?: string;
  clicks?: string;
};
export async function syncAds(tenant: Tenant, actorId: string | null) {
  const { rows: accounts } = await pool.query<Account>(
    "select id,token_encrypted,currency,timezone from mori_resources where tenant_id=$1 and type='ad_account' and status='connected'",
    [tenant.id],
  );
  let adCount = 0,
    days = 0;
  const warnings: string[] = [];
  for (const account of accounts) {
    // Daily ad spend must share the reporting timezone and currency; never silently mix them.
    if (
      account.currency !== tenant.currency ||
      account.timezone !== tenant.timezone
    ) {
      warnings.push(
        `${account.id}: currency/timezone differs from the workspace. Align it before syncing.`,
      );
      continue;
    }
    const token = decrypt(account.token_encrypted);
    const ads = await graphPages<RemoteAd>(`${account.id}/ads`, token, {
      fields:
        "id,name,effective_status,creative{name,thumbnail_url},adset{daily_budget}",
    });
    const today = DateTime.now().setZone(tenant.timezone);
    const insights = await graphPages<Insight>(
      `${account.id}/insights`,
      token,
      {
        fields: "ad_id,date_start,spend,impressions,clicks",
        level: "ad",
        time_increment: "1",
        time_range: JSON.stringify({
          since: today.minus({ days: 90 }).toISODate(),
          until: today.toISODate(),
        }),
      },
    );
    await transaction(async (db) => {
      for (const ad of ads) {
        await db.query(
          "insert into mori_ads (tenant_id,id,account_id,name,creative_name,thumbnail_url,status,daily_budget_minor) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (tenant_id,id) do update set name=excluded.name,creative_name=excluded.creative_name,thumbnail_url=excluded.thumbnail_url,status=excluded.status,daily_budget_minor=excluded.daily_budget_minor,updated_at=now()",
          [
            tenant.id,
            ad.id,
            account.id,
            ad.name,
            ad.creative?.name || ad.name,
            ad.creative?.thumbnail_url || null,
            ad.effective_status,
            ad.adset?.daily_budget ? Number(ad.adset.daily_budget) : null,
          ],
        );
      }
      for (const row of insights) {
        if (!ads.some((a) => a.id === row.ad_id)) {
          warnings.push(`Skipped spend for unavailable ad ${row.ad_id}.`);
          continue;
        }
        await db.query(
          "insert into mori_spend (tenant_id,ad_id,day,spend_minor,impressions,clicks) values ($1,$2,$3,$4,$5,$6) on conflict (tenant_id,ad_id,day) do update set spend_minor=excluded.spend_minor,impressions=excluded.impressions,clicks=excluded.clicks,updated_at=now()",
          [
            tenant.id,
            row.ad_id,
            row.date_start,
            moneyMinor(row.spend),
            Number(row.impressions || 0),
            Number(row.clicks || 0),
          ],
        );
        days++;
      }
      await audit(db, tenant.id, actorId, "facebook.ads_synced", {
        account_id: account.id,
        ads: ads.length,
        days: insights.length,
      });
    });
    adCount += ads.length;
  }
  return { ads: adCount, days, warnings };
}
export async function optimizeAds(tenant: Tenant) {
  if (!tenant.automation_enabled) return 0;
  const { rows: ads } = await pool.query<Ad>(
    "select * from mori_ads where tenant_id=$1 and automation_enabled=true and status='ACTIVE'",
    [tenant.id],
  );
  const { rows: spend } = await pool.query<AdSpend>(
    "select * from mori_spend where tenant_id=$1",
    [tenant.id],
  );
  const { rows: contacts } = await pool.query<Contact>(
    "select * from mori_contacts where tenant_id=$1",
    [tenant.id],
  );
  const { rows: orders } = await pool.query<Order>(
    "select * from mori_orders where tenant_id=$1",
    [tenant.id],
  );
  let paused = 0;
  for (const ad of ads) {
    const decision = evaluateAd(
      ad,
      spend,
      contacts,
      orders,
      tenant,
      DateTime.now().setZone(tenant.timezone).toISODate()!,
    );
    if (decision.action !== "pause") continue;
    const { rows } = await pool.query<Account>(
      "select id,token_encrypted,currency,timezone from mori_resources where tenant_id=$1 and id=$2 and status='connected'",
      [tenant.id, ad.account_id],
    );
    if (
      !rows[0] ||
      rows[0].currency !== tenant.currency ||
      rows[0].timezone !== tenant.timezone
    )
      continue;
    // Recheck both opt-in switches at the moment the external action is about to run.
    const enabled = await pool.query(
      "select a.id from mori_ads a join mori_tenants t on t.id=a.tenant_id where a.tenant_id=$1 and a.id=$2 and a.automation_enabled=true and t.automation_enabled=true and a.status='ACTIVE'",
      [tenant.id, ad.id],
    );
    if (!enabled.rowCount) continue;
    // Require a successful current sync; stale spend must never trigger a budget action.
    const fresh = await pool.query(
      "select count(distinct day)::int as n from mori_spend where tenant_id=$1 and ad_id=$2 and day between (now() at time zone $3)::date-3 and (now() at time zone $3)::date-1 and updated_at > now()-interval '2 hours'",
      [tenant.id, ad.id, tenant.timezone],
    );
    if (fresh.rows[0].n !== 3) continue;
    await graph(
      ad.id,
      decrypt(rows[0].token_encrypted),
      { status: "PAUSED" },
      "POST",
    );
    await pool.query(
      "update mori_ads set status='PAUSED' where tenant_id=$1 and id=$2",
      [tenant.id, ad.id],
    );
    await audit(pool, tenant.id, null, "ad.auto_paused", {
      ad_id: ad.id,
      ...decision,
    });
    paused++;
  }
  return paused;
}
