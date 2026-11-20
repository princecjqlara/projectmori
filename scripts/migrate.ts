import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
async function main() {
  const { pool, transaction } = await import("../src/server/db");
  const { readdir, readFile } = await import("node:fs/promises");
  const { createHash } = await import("node:crypto");
  try {
    await transaction(async (db) => {
      await db.query(
        "select pg_advisory_xact_lock(hashtext('mori_migrations'))",
      );
      await db.query(
        "create table if not exists public.mori_migrations (name text primary key, checksum text not null, applied_at timestamptz default now())",
      );
      await db.query(
        "revoke all on public.mori_migrations from anon,authenticated",
      );
      for (const name of (await readdir("supabase/migrations"))
        .filter((n) => n.endsWith(".sql"))
        .sort()) {
        const sql = await readFile(`supabase/migrations/${name}`, "utf8");
        const checksum = createHash("sha256").update(sql).digest("hex");
        const { rows } = await db.query(
          "select checksum from mori_migrations where name=$1",
          [name],
        );
        if (rows[0]) {
          if (rows[0].checksum !== checksum)
            throw new Error("An applied migration was modified.");
          continue;
        }
        await db.query(sql);
        await db.query(
          "insert into mori_migrations (name,checksum) values ($1,$2)",
          [name, checksum],
        );
        console.log("Applied:", name);
      }
    });
    console.log("Database migrations are up to date.");
  } catch (e) {
    const code =
      e && typeof e === "object" && "code" in e ? String(e.code) : "UNKNOWN";
    console.error(
      "Migration failed:",
      code,
      "(credentials hidden). Check network, project status, and DATABASE_URL.",
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
main();
