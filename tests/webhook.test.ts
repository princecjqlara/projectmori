import { createHash, createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../src/server/db", () => ({ pool: { query } }));
import { GET, POST } from "../src/app/api/webhooks/facebook/route";
const secret = "webhook-unit-test-only";
function event(raw: string, valid = true) {
  return new Request("https://mori.test/api/webhooks/facebook", { method: "POST", body: raw, headers: { "x-hub-signature-256": valid ? `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}` : "sha256=forged" } });
}
beforeEach(() => {
  query.mockReset().mockResolvedValue({ rowCount: 1 });
  vi.stubEnv("FACEBOOK_APP_SECRET", secret);
  vi.stubEnv("FACEBOOK_WEBHOOK_VERIFY_TOKEN", "test-verify");
});
afterEach(() => vi.unstubAllEnvs());
describe("Meta webhook transport", () => {
  it("returns the exact challenge only for a valid subscription token", async () => {
    const response = await GET(new Request("https://mori.test/api/webhooks/facebook?hub.mode=subscribe&hub.verify_token=test-verify&hub.challenge=1234"));
    expect(response.status).toBe(200); expect(await response.text()).toBe("1234");
    expect((await GET(new Request("https://mori.test/api/webhooks/facebook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1234"))).status).toBe(403);
  });
  it("rejects a forged signature and a changed body before touching storage", async () => {
    const raw = JSON.stringify({ object: "page", entry: [] });
    expect((await POST(event(raw, false))).status).toBe(401);
    const modified = event(raw); const signature = modified.headers.get("x-hub-signature-256")!;
    expect((await POST(new Request(modified.url, { method: "POST", body: raw + " ", headers: { "x-hub-signature-256": signature } }))).status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });
  it("rejects malformed signed events without queueing them", async () => {
    for (const raw of ["{malformed", "null", '{"object":"page","entry":[null]}']) expect((await POST(event(raw))).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });
  it("counts UTF-8 bytes when enforcing its request size limit", async () => {
    expect((await POST(event("界".repeat(700000)))).status).toBe(413);
    expect(query).not.toHaveBeenCalled();
  });
  it("acknowledges only after durable insertion and uses a conflict-safe delivery ID", async () => {
    const raw = JSON.stringify({ object: "page", entry: [{ id: "unit-page", messaging: [] }] });
    expect((await POST(event(raw))).status).toBe(200);
    expect(query.mock.calls[0][0]).toContain("on conflict (id) do nothing");
    expect(query.mock.calls[0][1][0]).toBe(createHash("sha256").update(raw).digest("hex"));
    query.mockRejectedValueOnce(new Error("unavailable"));
    expect((await POST(event(raw))).status).toBe(503);
  });
});
