import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { decrypt, encrypt, safeEqual } from "@/server/crypto";
import { graph, graphPages, graphVersion } from "@/server/facebook";
import { pool, transaction, audit } from "@/server/db";
type Page = { id: string; name: string; access_token: string };
type Account = {
  id: string;
  name: string;
  currency: string;
  timezone_name: string;
};
export async function GET(request: Request) {
  const home = new URL("/", process.env.APP_URL);
  const cookieJar = await cookies();
  try {
    const url = new URL(request.url);
    if (url.searchParams.has("error")) throw new Error("Connection cancelled.");
    const state = JSON.parse(decrypt(url.searchParams.get("state") || ""));
    const nonce = cookieJar.get("mori_oauth_nonce")?.value || "";
    cookieJar.delete("mori_oauth_nonce");
    if (!nonce || !safeEqual(nonce, state.nonce) || state.exp < Date.now())
      throw new Error("Invalid or expired authorization.");
    const membership = await pool.query(
      "select role from mori_memberships where tenant_id=$1 and user_id=$2",
      [state.tenantId, state.userId],
    );
    if (!["head", "admin"].includes(membership.rows[0]?.role))
      throw new Error("Administrator access required.");
    const code = url.searchParams.get("code");
    if (!code) throw new Error("Authorization code missing.");
    const tokenUrl = `https://graph.facebook.com/${graphVersion()}/oauth/access_token`;
    const exchange = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.FACEBOOK_APP_ID!,
        client_secret: process.env.FACEBOOK_APP_SECRET!,
        redirect_uri: `${process.env.APP_URL}/api/facebook/callback`,
        code,
      }),
      signal: AbortSignal.timeout(20000),
    });
    const short = await exchange.json();
    if (!exchange.ok || !short.access_token)
      throw new Error("Token exchange failed.");
    const longResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: process.env.FACEBOOK_APP_ID!,
        client_secret: process.env.FACEBOOK_APP_SECRET!,
        fb_exchange_token: short.access_token,
      }),
      signal: AbortSignal.timeout(20000),
    });
    const long = await longResponse.json();
    if (!longResponse.ok || !long.access_token)
      throw new Error("Long-lived token exchange failed.");
    const token: string = long.access_token;
    const pages = await graphPages<Page>("me/accounts", token, {
      fields: "id,name,access_token",
    });
    const accounts = await graphPages<Account>("me/adaccounts", token, {
      fields: "id,name,currency,timezone_name",
    });
    await transaction(async (db) => {
      for (const page of pages) {
        const conflict = await db.query(
          "select tenant_id from mori_resources where id=$1 and type='page' and tenant_id<>$2",
          [page.id, state.tenantId],
        );
        if (conflict.rowCount)
          throw new Error("A Page is already linked to another workspace.");
        await graph(
          `${page.id}/subscribed_apps`,
          page.access_token,
          {
            subscribed_fields:
              "messages,messaging_postbacks,messaging_referrals,message_deliveries,message_reads",
          },
          "POST",
        );
        await db.query(
          "insert into mori_resources (tenant_id,id,name,type,token_encrypted,connected_by) values ($1,$2,$3,'page',$4,$5) on conflict (tenant_id,id) do update set name=excluded.name,token_encrypted=excluded.token_encrypted,status='connected',updated_at=now()",
          [
            state.tenantId,
            page.id,
            page.name,
            encrypt(page.access_token),
            state.userId,
          ],
        );
      }
      for (const account of accounts)
        await db.query(
          "insert into mori_resources (tenant_id,id,name,type,currency,timezone,token_encrypted,connected_by) values ($1,$2,$3,'ad_account',$4,$5,$6,$7) on conflict (tenant_id,id) do update set name=excluded.name,currency=excluded.currency,timezone=excluded.timezone,token_encrypted=excluded.token_encrypted,status='connected',updated_at=now()",
          [
            state.tenantId,
            account.id,
            account.name,
            account.currency,
            account.timezone_name,
            encrypt(token),
            state.userId,
          ],
        );
      await audit(db, state.tenantId, state.userId, "facebook.connected", {
        pages: pages.length,
        ad_accounts: accounts.length,
      });
    });
    home.searchParams.set("facebook", "connected");
  } catch {
    home.searchParams.set("facebook", "failed");
  }
  return NextResponse.redirect(home);
}
