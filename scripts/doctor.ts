import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
async function main() {
  const { pool } = await import("../src/server/db");
  const checks: Record<string, string> = {};
  try {
    await pool.query("select 1");
    checks.database = "connected (certificate verified)";
    const { rows } = await pool.query(
      "select count(*)::int as n from pg_tables where schemaname='public' and tablename like 'mori_%' and rowsecurity=true",
    );
    checks.rowLevelSecurity = `${rows[0].n} tables protected`;
    checks.migrations = (
      await pool.query("select name from mori_migrations order by name")
    ).rows
      .map((r) => r.name)
      .join(", ");
  } catch (e) {
    checks.database = `failed (${e && typeof e === "object" && "code" in e ? String(e.code) : "unknown"})`;
    process.exitCode = 1;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  try {
    const response = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY! },
      signal: AbortSignal.timeout(12000),
    });
    checks.supabaseAuth = response.ok
      ? "reachable with publishable key"
      : `HTTP ${response.status}`;
    const admin = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=1`, {
      headers: {
        apikey: process.env.SUPABASE_SECRET_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
      },
      signal: AbortSignal.timeout(12000),
    });
    checks.supabaseSecret = admin.ok
      ? "accepted (no user data printed)"
      : `HTTP ${admin.status}`;
  } catch {
    checks.supabaseAuth = "network check failed";
  }
  try {
    const auth = Buffer.from(
      `${process.env.CLOUDINARY_API_KEY}:${process.env.CLOUDINARY_API_SECRET}`,
    ).toString("base64");
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/ping`,
      {
        headers: { Authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(12000),
      },
    );
    checks.cloudinary = response.ok
      ? "credentials accepted"
      : `HTTP ${response.status}`;
  } catch {
    checks.cloudinary = "network check failed";
  }
  checks.facebook =
    process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET
      ? "app credentials configured; Page OAuth still required"
      : "app credentials missing";
  const { isJevConfigured, jevConfiguration } = await import(
    "../src/server/jev"
  );
  const jev = jevConfiguration();
  checks.jev = isJevConfigured()
    ? `${jev.provider} / ${jev.model}: key configured`
    : "API key missing";
  checks.embeddings = process.env.EMBEDDING_API_KEY
    ? "hybrid text + vector retrieval"
    : "full-text retrieval (no embedding API key)";
  checks.worker =
    "run npm run worker while the app is in use; production needs a persistent worker or authenticated cron";
  console.table(checks);
  await pool.end();
}
main();
