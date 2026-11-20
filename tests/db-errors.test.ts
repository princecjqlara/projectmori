import { afterAll, afterEach, expect, it, vi } from "vitest";
import { pool } from "../src/server/db";

afterEach(() => vi.restoreAllMocks());
afterAll(async () => { await pool.end(); });

it("survives an idle connection reset without logging connection details", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const error = Object.assign(new Error("private connection details"), { code: "ECONNRESET", client: { password: "private-password" } });
  expect(() => pool.emit("error", error)).not.toThrow();
  expect(log).toHaveBeenCalledExactlyOnceWith("Mori idle database connection closed:", "ECONNRESET");
});

it("does not log untrusted error codes", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(() => pool.emit("error", Object.assign(new Error("private details"), { code: "postgresql://private-connection" }))).not.toThrow();
  expect(log).toHaveBeenCalledExactlyOnceWith("Mori idle database connection closed:", "CONNECTION_ERROR");
});
