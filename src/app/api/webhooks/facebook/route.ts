import { NextResponse } from "next/server";
import { sign, safeEqual } from "@/server/crypto";
import { pool } from "@/server/db";
import { createHash } from "node:crypto";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  const valid =
    p.get("hub.mode") === "subscribe" &&
    process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN &&
    safeEqual(
      p.get("hub.verify_token") || "",
      process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN,
    );
  return new Response(valid ? p.get("hub.challenge") : "Verification failed", {
    status: valid ? 200 : 403,
  });
}
export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") || 0) > 2 * 1024 * 1024)
    return new Response("Payload too large", { status: 413 });
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > 2 * 1024 * 1024)
    return new Response("Payload too large", { status: 413 });
  const signature = request.headers.get("x-hub-signature-256") || "";
  if (
    !process.env.FACEBOOK_APP_SECRET ||
    !safeEqual(signature, `sha256=${sign(raw)}`)
  )
    return new Response("Invalid signature", { status: 401 });
  let payload;
  try { payload = JSON.parse(raw); }
  catch { return new Response("Invalid JSON", { status: 400 }); }
  if (!payload || typeof payload !== "object")
    return new Response("Invalid event", { status: 400 });
  if (payload.object === "page" && (!Array.isArray(payload.entry) || payload.entry.some((entry: unknown) => !entry || typeof entry !== "object")))
    return new Response("Invalid Page event", { status: 400 });
  try {
    if (payload.object !== "page")
      return NextResponse.json({ received: true });
    const id = createHash("sha256").update(raw).digest("hex");
    // Acknowledge only after durable storage. A separate worker handles AI and sends.
    await pool.query(
      "insert into mori_webhook_events (id,payload) values ($1,$2) on conflict (id) do nothing",
      [id, JSON.stringify(payload)],
    );
    return NextResponse.json({ received: true });
  } catch {
    return new Response("Unable to queue event", { status: 503 });
  }
}
