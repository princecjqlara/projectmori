import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
async function main() {
  const { runTick } = await import("../src/server/worker");
  const { pool } = await import("../src/server/db");
  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
  });
  process.on("SIGTERM", () => {
    stopping = true;
  });
  console.log(
    "Mori worker started. Checks every 30 seconds; ad sync runs hourly.",
  );
  while (!stopping) {
    try {
      const r = await runTick();
      if ("events" in r && (r.events || r.sent)) console.log("Processed:", r);
    } catch {
      console.error("Worker connection failed. Check npm run doctor.");
    }
    await new Promise((resolve) => setTimeout(resolve, 30000));
  }
  await pool.end();
}
main();
