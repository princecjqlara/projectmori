import { Pool, types, type PoolClient } from "pg";
import { readFileSync } from "node:fs";
import { rootCertificates } from "node:tls";
import { join } from "node:path";
// All application integer amounts are bounded below Number.MAX_SAFE_INTEGER.
types.setTypeParser(20, (value) => Number(value));
types.setTypeParser(1700, (value) => Number(value));
types.setTypeParser(1082, (value) => value);
types.setTypeParser(1184, (value) => new Date(value).toISOString());
const globalDb = globalThis as unknown as { moriPool?: Pool };
export const pool =
  globalDb.moriPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 8,
    connectionTimeoutMillis: 12000,
    idleTimeoutMillis: 30000,
    // Uses the operating system certificate trust store; no TLS verification bypass.
    ssl: {
      rejectUnauthorized: true,
      ca: [
        ...rootCertificates,
        readFileSync(join(process.cwd(), "config/supabase-ca.crt"), "utf8"),
      ],
    },
  });
if (pool.listenerCount("error") === 0) {
  // pg removes a broken idle connection itself. Handle the event so a network
  // reset does not crash the worker or dump connection details into its logs.
  pool.on("error", (error: Error & { code?: string }) => {
    const code = /^[A-Z0-9_]{1,32}$/.test(error.code || "")
      ? error.code
      : "CONNECTION_ERROR";
    console.error("Mori idle database connection closed:", code);
  });
}
if (process.env.NODE_ENV !== "production") globalDb.moriPool = pool;
export type DB = Pick<PoolClient, "query">;
export async function transaction<T>(
  fn: (db: PoolClient) => Promise<T>,
  userId?: string,
): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("begin");
    if (userId) {
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({ sub: userId, role: "authenticated" }),
      ]);
    }
    const result = await fn(db);
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally {
    db.release();
  }
}
export async function audit(
  db: DB,
  tenantId: string,
  actorId: string | null,
  action: string,
  details: Record<string, unknown> = {},
) {
  await db.query(
    "insert into mori_audit (tenant_id,actor_id,action,details) values ($1,$2,$3,$4)",
    [tenantId, actorId, action, JSON.stringify(details)],
  );
}
