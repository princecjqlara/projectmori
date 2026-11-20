import { safeEqual } from "@/server/crypto";
import { runTick } from "@/server/worker";
import { api } from "@/server/auth";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (
    !process.env.CRON_SECRET ||
    !safeEqual(
      request.headers.get("authorization") || "",
      `Bearer ${process.env.CRON_SECRET}`,
    )
  )
    return new Response("Unauthorized", { status: 401 });
  return api(runTick);
}
