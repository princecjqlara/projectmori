import { DateTime } from "luxon";
import { pool, transaction, audit } from "./db";
import { botReply } from "./bot";
import { autofillContact } from "./autofill";
import { isOptOutMessage } from "@/lib/intake";
import { sendMessage } from "./facebook";
import { messagePermission } from "@/lib/domain";
import { syncAds, optimizeAds } from "./sync";
import type { Contact, Tenant, Touchpoint } from "@/lib/types";
type Referral = { ad_id?: string; source?: string };
type RemoteEvent = {
  sender?: { id: string };
  recipient?: { id: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    referral?: Referral;
    attachments?: { type: string; payload?: { url?: string } }[];
  };
  referral?: Referral;
  postback?: { mid?: string; title?: string; referral?: Referral };
};
type Payload = { entry: { id: string; messaging?: RemoteEvent[] }[] };
export async function ingestFacebookEvent(pageId: string, event: RemoteEvent) {
  if (
    event.message?.is_echo ||
    !event.sender?.id ||
    (!event.message && !event.postback && !event.referral)
  )
    return;
  const externalId = event.message?.mid || event.postback?.mid;
  const { rows: resources } = await pool.query(
    "select tenant_id from mori_resources where id=$1 and type='page' and status='connected'",
    [pageId],
  );
  for (const resource of resources) {
    const tenantId = resource.tenant_id;
    const tenant = (
      await pool.query<Tenant>("select * from mori_tenants where id=$1", [
        tenantId,
      ])
    ).rows[0];
    if (!tenant) continue;
    let referral =
      event.referral || event.message?.referral || event.postback?.referral;
    const instant = new Date(
      Math.min(event.timestamp || Date.now(), Date.now()),
    ).toISOString();
    if (referral) {
      await pool.query(
        "insert into mori_referrals (tenant_id,page_id,external_id,occurred_at,source_ad_id,source) values ($1,$2,$3,$4,$5,$6) on conflict do nothing",
        [
          tenantId,
          pageId,
          event.sender.id,
          instant,
          referral.ad_id || null,
          referral.source || "UNKNOWN",
        ],
      );
      // Late referral metadata can repair a missing first-inquiry attribution only when
      // timestamps agree closely. Returning customers retain their original acquisition ad.
      if (referral.source === "ADS" && referral.ad_id)
        await pool.query(
          "update mori_contacts set source_ad_id=$4 where tenant_id=$1 and page_id=$2 and external_id=$3 and source_ad_id is null and abs(extract(epoch from (first_inquiry_at-$5::timestamptz)))<=300",
          [tenantId, pageId, event.sender.id, referral.ad_id, instant],
        );
    }
    if (!externalId) continue;
    if (!referral) {
      const cached = (
        await pool.query(
          "select source_ad_id,source from mori_referrals where tenant_id=$1 and page_id=$2 and external_id=$3 and occurred_at between $4::timestamptz-interval '24 hours' and $4::timestamptz order by occurred_at desc limit 1",
          [tenantId, pageId, event.sender.id, instant],
        )
      ).rows[0];
      if (cached)
        referral = { ad_id: cached.source_ad_id, source: cached.source };
    }
    const attachment = event.message?.attachments?.[0];
    const result = await transaction(async (db) => {
      // Serialize incoming messages for this Page-scoped identity.
      await db.query("select pg_advisory_xact_lock(hashtext($1))", [
        `${tenantId}:${pageId}:${event.sender!.id}`,
      ]);
      const prior = (
        await db.query<Contact>(
          "select * from mori_contacts where tenant_id=$1 and page_id=$2 and external_id=$3",
          [tenantId, pageId, event.sender!.id],
        )
      ).rows[0];
      const adOpened =
        (!prior || Date.parse(instant) < Date.parse(prior.first_inquiry_at)) &&
        !!event.message &&
        !!referral?.ad_id &&
        referral.source === "ADS";
      const { rows } = await db.query<Contact>(
        "insert into mori_contacts (tenant_id,page_id,external_id,source,source_ad_id,first_inquiry_at,last_inbound_at,ad_window_opened_at) values ($1,$2,$3,'messenger',$4,$5,$5,$6) on conflict (tenant_id,page_id,external_id) do update set last_inbound_at=greatest(mori_contacts.last_inbound_at,excluded.last_inbound_at),source_ad_id=case when excluded.first_inquiry_at<mori_contacts.first_inquiry_at then excluded.source_ad_id else mori_contacts.source_ad_id end,ad_window_opened_at=case when excluded.first_inquiry_at<mori_contacts.first_inquiry_at then excluded.ad_window_opened_at else mori_contacts.ad_window_opened_at end,first_inquiry_at=least(mori_contacts.first_inquiry_at,excluded.first_inquiry_at) returning *",
        [
          tenantId,
          pageId,
          event.sender!.id,
          referral?.source === "ADS" ? referral.ad_id || null : null,
          instant,
          adOpened ? instant : null,
        ],
      );
      const contact = rows[0];
      const stored = await db.query(
        "insert into mori_messages (tenant_id,contact_id,direction,sender,text,sent_at,external_id,media_url,media_type) values ($1,$2,'inbound','contact',$3,$4,$5,$6,$7) on conflict (tenant_id,external_id) do nothing returning id",
        [
          tenantId,
          contact.id,
          event.message?.text || event.postback?.title || "",
          instant,
          externalId,
          attachment?.payload?.url || null,
          attachment?.type || null,
        ],
      );
      return {
        contact,
        fresh:
          !!stored.rowCount &&
          (!prior?.last_inbound_at ||
            Date.parse(instant) >= Date.parse(prior.last_inbound_at)),
        first: !prior,
      };
    });
    if (result.fresh) {
      let current = result.contact;
      if (
        !isOptOutMessage(event.message?.text || event.postback?.title || "")
      ) {
        try {
          current = (await autofillContact(tenant, current)).contact;
        } catch {
          await audit(pool, tenantId, null, "contact.autofill_failed", {
            contact_id: current.id,
          });
        }
      }
      try {
        await botReply(
          tenant,
          current,
          event.message?.text || event.postback?.title || "",
          result.first,
        );
      } catch {
        await pool.query(
          "update mori_contacts set bot_state='human' where tenant_id=$1 and id=$2",
          [tenantId, result.contact.id],
        );
        await audit(pool, tenantId, null, "bot.error_handoff", {
          contact_id: result.contact.id,
        });
      }
    }
  }
}
export async function runTick() {
  // One worker across processes; advisory lock is held on a dedicated session.
  const lock = await pool.connect();
  const acquired = (
    await lock.query(
      "select pg_try_advisory_lock(hashtext('mori_worker')) as ok",
    )
  ).rows[0].ok;
  if (!acquired) {
    lock.release();
    return { busy: true };
  }
  let events = 0,
    sent = 0;
  try {
    // A crash after an external send is ambiguous: route to human, never replay automatically.
    await pool.query(
      "update mori_touchpoints set status='needs_human',reason='Worker interrupted; check delivery before retrying' where status='sending' and scheduled_at<now()-interval '15 minutes'",
    );
    await pool.query(
      "update mori_webhook_events set status='failed',error='Worker interrupted; inspect messages before replaying' where status='processing' and updated_at<now()-interval '15 minutes'",
    );
    await pool.query(
      "update mori_messages set status='needs_review' where direction='outbound' and status='sending' and sent_at<now()-interval '15 minutes'",
    );
    const pending = await pool.query<{ id: string; payload: Payload }>(
      "select id,payload from mori_webhook_events where status='pending' order by created_at limit 50",
    );
    for (const row of pending.rows) {
      await pool.query(
        "update mori_webhook_events set status='processing',attempts=attempts+1,updated_at=now() where id=$1",
        [row.id],
      );
      try {
        for (const entry of row.payload.entry)
          for (const event of entry.messaging || [])
            await ingestFacebookEvent(entry.id, event);
        await pool.query(
          "update mori_webhook_events set status='done',updated_at=now() where id=$1",
          [row.id],
        );
        events++;
      } catch {
        await pool.query(
          "update mori_webhook_events set status='failed',error='Processing failed; inspect before replaying',updated_at=now() where id=$1",
          [row.id],
        );
      }
    }
    const due = await pool.query<Touchpoint & { tenant_id: string }>(
      "select * from mori_touchpoints where status='scheduled' and scheduled_at<=now() order by scheduled_at limit 50",
    );
    for (const tp of due.rows) {
      const contact = (
        await pool.query<Contact>(
          "select * from mori_contacts where tenant_id=$1 and id=$2",
          [tp.tenant_id, tp.contact_id],
        )
      ).rows[0];
      const tenant = (
        await pool.query<Tenant>("select * from mori_tenants where id=$1", [
          tp.tenant_id,
        ])
      ).rows[0];
      if (!tenant || !contact || !tenant.bot_enabled) continue;
      const stopped =
        contact.opted_out ||
        contact.stage === "converted" ||
        ["stopped", "human"].includes(contact.bot_state);
      const permission = messagePermission(
        contact,
        "bot",
        Date.now(),
        process.env.FACEBOOK_AD_WINDOW_ENABLED === "true",
      );
      if (
        stopped ||
        !permission.allowed ||
        Date.now() - Date.parse(tp.scheduled_at) > 3 * 3600000
      ) {
        await pool.query(
          "update mori_touchpoints set status=$2,reason=$3 where id=$1",
          [
            tp.id,
            stopped ? "cancelled" : "needs_human",
            stopped
              ? "Contact converted, opted out, or in human care"
              : !permission.allowed
                ? permission.reason
                : "Scheduled time passed by more than three hours",
          ],
        );
        continue;
      }
      await pool.query(
        "update mori_touchpoints set status='sending' where id=$1",
        [tp.id],
      );
      try {
        await sendMessage(pool, tenant.id, contact, tp.template, "bot");
        await pool.query(
          "update mori_touchpoints set status='sent' where id=$1",
          [tp.id],
        );
        sent++;
      } catch {
        await pool.query(
          "update mori_touchpoints set status='needs_human',reason='Delivery failed or uncertain; inspect before retrying' where id=$1",
          [tp.id],
        );
      }
    }
    const tenants = (await pool.query<Tenant>("select * from mori_tenants"))
      .rows;
    for (const tenant of tenants) {
      const last = await pool.query(
        "select max(created_at) as latest from mori_audit where tenant_id=$1 and action='facebook.sync_tick'",
        [tenant.id],
      );
      if (
        last.rows[0].latest &&
        Date.now() - Date.parse(last.rows[0].latest) < 3600000
      )
        continue;
      try {
        await syncAds(tenant, null);
        await optimizeAds(tenant);
        await audit(pool, tenant.id, null, "facebook.sync_tick");
      } catch {
        await audit(pool, tenant.id, null, "facebook.sync_failed");
      }
    }
    return { events, sent };
  } finally {
    await lock.query("select pg_advisory_unlock(hashtext('mori_worker'))");
    lock.release();
  }
}
