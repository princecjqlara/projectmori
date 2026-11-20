import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

export function qaAuth() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
}
export function qaDatabase(): typeof import("../src/server/db") {
  // require also passes through Playwright's TypeScript loader in its worker.
  return require("../src/server/db");
}
export async function qaUser(name: string) {
  const email = `mori-qa-${randomUUID()}@example.invalid`, password = `Mori!${randomUUID()}`;
  const admin = qaAuth();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
  if (error) throw error;
  return { id: data.user.id, email, password };
}
// Explicit IDs only; never delete by name, date, domain, or an unbounded query.
export async function cleanupQa(tenantIds: string[], userIds: string[], eventIds: string[] = []) {
  const { pool, transaction } = qaDatabase();
  await transaction(async db => {
    if (eventIds.length) await db.query("delete from mori_webhook_events where id=any($1::text[])", [eventIds]);
    for (const id of tenantIds) {
      await db.query("select set_config('mori.qa_tenant_id',$1,true)", [id]);
      const statements = ["mori_touchpoints", "mori_messages", "mori_orders", "mori_chunks", "mori_documents", "mori_faqs", "mori_audit", "mori_spend", "mori_ads", "mori_contacts", "mori_assignments", "mori_referrals", "mori_resources", "mori_memberships"]
        .map(table => `delete from ${table} where tenant_id=current_setting('mori.qa_tenant_id')::uuid;`).join("\n");
      await db.query(`do $$ begin ${statements} delete from mori_tenants where id=current_setting('mori.qa_tenant_id')::uuid; end $$;`);
    }
  });
  for (const id of userIds) {
    const { error } = await qaAuth().auth.admin.deleteUser(id);
    if (error) throw error;
  }
  await pool.end();
}
