import { qaAuth, qaUser, cleanupQa } from "./qa-support";
import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import https from "node:https";

async function main() {
  const { pool } = await import("../src/server/db");
  const users: string[] = [], tenants: string[] = [], eventIds: string[] = [];
  function publicRequest(path: string, method = "GET", raw?: string, signature?: string) {
    return new Promise<{ status: number; body: string }>((resolve, reject) => {
      const url = new URL(path, process.env.APP_URL);
      const request = https.request(url, {
        method, timeout: 20000,
        headers: raw ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(raw), "x-hub-signature-256": signature! } : {},
      }, response => {
        const chunks: Buffer[] = [];
        response.on("data", chunk => chunks.push(chunk));
        response.on("end", () => resolve({ status: response.statusCode!, body: Buffer.concat(chunks).toString() }));
      });
      request.on("error", reject); request.on("timeout", () => request.destroy(new Error("Public request timed out")));
      request.end(raw);
    });
  }
  async function call(token: string, tenant: string, path: string, method = "GET", body?: unknown) {
    const r = await fetch(new URL(`/api/${path}`, process.env.APP_URL), { method, headers: { Authorization: `Bearer ${token}`, "x-tenant-id": tenant, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json() };
  }
  try {
    const a = await qaUser("Tenant A owner"); users.push(a.id);
    const b = await qaUser("Tenant B owner"); users.push(b.id);
    const member = await qaUser("Assigned member"); users.push(member.id);
    const administrator = await qaUser("Workspace administrator"); users.push(administrator.id);
    async function login(user: typeof a) {
      const { data, error } = await qaAuth().auth.signInWithPassword(user);
      if (error) throw error;
      return data.session!.access_token;
    }
    const ta = await login(a), tb = await login(b), tm = await login(member), tad = await login(administrator);
    const wa = await call(ta, "", "workspaces", "POST", { name: "QA isolation A" }); assert.equal(wa.status, 200); tenants.push(wa.data.id);
    const wb = await call(tb, "", "workspaces", "POST", { name: "QA isolation B" }); assert.equal(wb.status, 200); tenants.push(wb.data.id);
    const aid = wa.data.id, bid = wb.data.id;
    assert.deepEqual((await call(ta, "", "workspaces")).data.map((w: any) => w.id), [aid]);
    assert.deepEqual((await call(tb, "", "workspaces")).data.map((w: any) => w.id), [bid]);
    assert.equal((await call(tb, aid, "snapshot")).status, 403);
    assert.equal((await call(ta, bid, "snapshot")).status, 403);
    const snapshot = (await call(ta, aid, "snapshot")).data;
    for (const collection of ["contacts", "messages", "orders", "ads", "resources", "spend", "documents", "faqs"]) assert.equal(snapshot[collection].length, 0, collection);
    const pa = `qa-page-${randomUUID()}`, pb = `qa-page-${randomUUID()}`;
    const { encrypt } = await import("../src/server/crypto");
    await pool.query("insert into mori_resources (tenant_id,id,name,type,token_encrypted,connected_by) values ($1,$2,'QA assigned Page','page',$4,$5),($1,$3,'QA unassigned Page','page',$4,$5)", [aid, pa, pb, encrypt("unusable-qa-token"), a.id]);
    await pool.query("update mori_tenants set bot_enabled=false,autofill_enabled=false where id=$1", [aid]);
    assert.equal((await call(ta, aid, "members", "POST", { email: administrator.email, name: "Administrator", role: "admin", assignments: [] })).status, 200);
    assert.equal((await call(tad, aid, "members", "POST", { email: member.email, name: "Assigned member", role: "member", assignments: [pa] })).status, 200);
    const ca = await call(ta, aid, "contacts", "POST", { name: "Assigned test contact", page_id: pa }); assert.equal(ca.status, 200);
    const cb = await call(ta, aid, "contacts", "POST", { name: "Unassigned test contact", page_id: pb }); assert.equal(cb.status, 200);
    const ms = await call(tm, aid, "snapshot"); assert.equal(ms.status, 200);
    assert.deepEqual(ms.data.contacts.map((c: any) => c.id), [ca.data.id]);
    assert.deepEqual(ms.data.resources.map((r: any) => r.id), [pa]);
    assert.ok(ms.data.resources.every((r: any) => !('token_encrypted' in r)));
    assert.equal((await call(tm, aid, "settings", "PATCH", { name: "Blocked" })).status, 403);
    assert.equal((await call(tm, aid, `contacts/${cb.data.id}`, "PATCH", { notes: "Blocked" })).status, 404);
    assert.equal((await call(tm, aid, "members", "POST", { email: b.email, name: "Blocked", role: "admin", assignments: [] })).status, 403);
    assert.equal((await call(tad, aid, "members", "POST", { email: b.email, name: "Blocked", role: "head", assignments: [] })).status, 400);
    assert.equal((await call(tad, aid, "members", "POST", { email: b.email, name: "Blocked", role: "admin", assignments: [] })).status, 403);
    assert.equal((await call(tad, aid, "snapshot")).data.contacts.length, 2);
    assert.equal((await call(tad, bid, "snapshot")).status, 403);
    assert.equal((await call(tb, aid, `contacts/${ca.data.id}`, "PATCH", { notes: "Blocked" })).status, 403);
    console.log("PASS: real email login, empty onboarding, separate tenants, assigned-Page visibility, protected tokens, head/admin/member permissions, and blocked role escalation.");

    const challenge = randomUUID();
    const verify = await publicRequest(`/api/webhooks/facebook?${new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN!, "hub.challenge": challenge })}`);
    assert.equal(verify.status, 200); assert.equal(verify.body, challenge);
    assert.equal((await publicRequest("/api/webhooks/facebook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=x")).status, 403);
    const malformed = "{malformed";
    const malformedSignature = `sha256=${createHmac("sha256", process.env.FACEBOOK_APP_SECRET!).update(malformed).digest("hex")}`;
    assert.equal((await publicRequest("/api/webhooks/facebook", "POST", malformed, malformedSignature)).status, 400);
    const mid = `qa-mid-${randomUUID()}`, sender = `qa-sender-${randomUUID()}`, timestamp = Date.now();
    const raw = JSON.stringify({ object: "page", entry: [{ id: pa, time: timestamp, messaging: [{ sender: { id: sender }, recipient: { id: pa }, timestamp, message: { mid, text: "QA webhook transport check" } }] }] });
    const signature = `sha256=${createHmac("sha256", process.env.FACEBOOK_APP_SECRET!).update(raw).digest("hex")}`;
    const id = createHash("sha256").update(raw).digest("hex"); eventIds.push(id);
    assert.equal((await publicRequest("/api/webhooks/facebook", "POST", raw, "sha256=forged")).status, 401);
    assert.equal((await pool.query("select id from mori_webhook_events where id=$1", [id])).rowCount, 0);
    assert.equal((await publicRequest("/api/webhooks/facebook", "POST", raw, signature)).status, 200);
    assert.equal((await publicRequest("/api/webhooks/facebook", "POST", raw, signature)).status, 200);
    assert.equal((await pool.query("select id from mori_webhook_events where id=$1", [id])).rowCount, 1);
    console.log("PASS: public callback verification, invalid token/signature rejection, durable queue acknowledgement, and duplicate delivery suppression. Waiting for the running worker…");
    let state = "pending";
    for (let attempt = 0; attempt < 24; attempt++) {
      state = (await pool.query("select status from mori_webhook_events where id=$1", [id])).rows[0]?.status;
      if (state === "done" || state === "failed") break;
      await new Promise(resolve => setTimeout(resolve, 2500));
    }
    assert.equal(state, "done", "Running worker must process the queued event");
    const contact = (await pool.query("select * from mori_contacts where tenant_id=$1 and page_id=$2 and external_id=$3", [aid, pa, sender])).rows;
    assert.equal(contact.length, 1); assert.equal(Date.parse(contact[0].first_inquiry_at), timestamp);
    const messages = (await pool.query("select * from mori_messages where tenant_id=$1 and external_id=$2", [aid, mid])).rows;
    assert.equal(messages.length, 1); assert.equal(messages[0].direction, "inbound");
    assert.equal((await pool.query("select id from mori_messages where tenant_id=$1 and direction='outbound'", [aid])).rowCount, 0);
    console.log("PASS: the running worker ingested the signed public event once, created the correct tenant contact/message, preserved inquiry time, and sent no customer messages.");
    const r = await fetch(`https://graph.facebook.com/v23.0/${process.env.FACEBOOK_APP_ID}/subscriptions`, { headers: { Authorization: `Bearer ${process.env.FACEBOOK_APP_ID}|${process.env.FACEBOOK_APP_SECRET}` } });
    const subscriptions = await r.json(); assert.ok(r.ok, "Meta subscription lookup");
    const page = subscriptions.data?.find((s: any) => s.object === "page" && s.callback_url === `${process.env.APP_URL}/api/webhooks/facebook`);
    assert.ok(page?.active, "Meta Page webhook must be active for the current public URL");
    const fields = page.fields.map((f: any) => typeof f === "string" ? f : f.name);
    for (const name of ["messages", "messaging_postbacks", "messaging_referrals"]) assert.ok(fields.includes(name), name);
    console.log("PASS: Meta reports an active Page webhook subscription with messages, postbacks, and referrals for the production callback.");
  } finally {
    await cleanupQa(tenants, users, eventIds);
    console.log("Removed all temporary test users, workspaces, records, and webhook events.");
  }
}
main().catch(e => { console.error("Verification failed:", e instanceof Error ? e.message : "unknown"); process.exitCode = 1; });
