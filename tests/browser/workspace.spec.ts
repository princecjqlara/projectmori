import { test, expect, type Page } from "@playwright/test";
import { qaUser, qaAuth, cleanupQa, qaDatabase } from "../../scripts/qa-support";

let user: Awaited<ReturnType<typeof qaUser>>;
const tenants: string[] = [];
test.beforeAll(async () => { user = await qaUser("Mori browser verification"); });
test.afterAll(async () => {
  test.setTimeout(120000);
  if (!user) return;
  const { pool } = qaDatabase();
  const rows = await pool.query("select tenant_id from mori_memberships where user_id=$1", [user.id]);
  for (const row of rows.rows) if (!tenants.includes(row.tenant_id)) tenants.push(row.tenant_id);
  await cleanupQa(tenants, [user.id]);
});
async function login(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email address", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}
test("signed-out visitors see the real sign-in page on desktop and phone", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Facebook" })).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveCount(0);
  await page.screenshot({ path: ".local/sign-in-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Create an account", exact: true }).click();
  await expect(page.getByLabel("Your name")).toBeVisible();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.getByRole("button", { name: "Send reset link" })).toBeVisible();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("Email address")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: ".local/sign-in-mobile.png", fullPage: true });
});
test("real email sign-in, empty workspace, persisted order, workspace switch, and logout", async ({ page }) => {
  test.setTimeout(180000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await login(page);
  const create = page.getByRole("dialog", { name: "Create your workspace" });
  await create.getByLabel("Business or workspace name").fill("Browser QA workspace A");
  await create.getByRole("button", { name: "Create workspace", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
  await expect(page.locator(".sample-banner")).toHaveCount(0);
  await expect(page.getByText("Alex Morgan", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: ".local/overview-desktop.png", fullPage: true });
  for (const label of ["Performance calendar", "Conversations", "Sales pipeline", "Orders", "Ad creatives", "Reports & patterns", "Knowledge & FAQ", "Team & access", "Settings"]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.locator("main h1")).toBeVisible();
  }
  await page.getByRole("button", { name: "Contacts", exact: true }).click();
  await page.getByRole("button", { name: "Add contact", exact: true }).first().click();
  const form = page.getByRole("dialog", { name: "Make a new connection" });
  await form.getByLabel("Full name").fill("Temporary browser contact");
  await form.getByLabel("Email address").fill("qa@example.invalid");
  await form.getByRole("button", { name: "Add contact", exact: true }).click();
  await page.getByRole("button", { name: "Open Temporary browser contact" }).click();
  const profile = page.getByRole("dialog", { name: "Contact profile" });
  await profile.getByRole("button", { name: "Create order", exact: true }).click();
  const order = page.getByRole("dialog", { name: "A conversation becomes an order" });
  await order.getByLabel("Order amount (PHP)", { exact: true }).fill("2500");
  await order.getByLabel("Payment status", { exact: true }).selectOption("paid");
  await order.getByRole("button", { name: "Create order", exact: true }).click();
  await expect(profile.getByText("Converted", { exact: true })).toBeVisible();
  await profile.getByRole("button", { name: "Close dialog" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Contacts", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open Temporary browser contact" })).toBeVisible();
  await page.locator(".workspace-picker").click();
  await create.getByLabel("Business or workspace name").fill("Browser QA workspace B");
  await create.getByRole("button", { name: "Create workspace", exact: true }).click();
  await expect(page.locator(".workspace-picker strong")).toHaveText("Browser QA workspace B");
  const select = page.getByLabel("Switch workspace");
  await expect(select.locator("option")).toHaveCount(2);
  const firstId = await select.locator("option").first().getAttribute("value");
  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
  await page.getByRole("button", { name: "Contacts", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open Temporary browser contact" })).toHaveCount(0);
  await select.selectOption(firstId!);
  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
  await page.getByRole("button", { name: "Contacts", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open Temporary browser contact" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.locator(".app-shell")).toHaveCount(0);
  expect(errors).toEqual([]);
});
test("invitation session can set a password and view the workspace on mobile", async ({ page }) => {
  test.setTimeout(60000);
  const { data, error } = await qaAuth().auth.signInWithPassword(user);
  if (error) throw error;
  await page.goto(`/auth/callback?next=/set-password#${new URLSearchParams({ access_token: data.session!.access_token, refresh_token: data.session!.refresh_token, type: "invite" })}`);
  await expect(page).toHaveURL(/\/set-password$/);
  expect(new URL(page.url()).hash).toBe("");
  await page.getByLabel("New password", { exact: true }).fill(user.password + "Updated");
  await page.getByLabel("Confirm password").fill(user.password + "Updated");
  await page.getByRole("button", { name: "Save password" }).click();
  user.password += "Updated";
  const create = page.getByRole("dialog", { name: "Create your workspace" });
  const greeting = page.getByRole("heading", { name: /Good (morning|afternoon|evening)/ });
  await expect(create.or(greeting)).toBeVisible();
  if (await create.isVisible()) {
    await create.getByLabel("Business or workspace name").fill("Browser QA invitation workspace");
    await create.getByRole("button", { name: "Create workspace", exact: true }).click();
  }
  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: ".local/overview-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Performance calendar", exact: true }).click();
  await expect(page.locator("main h1")).toBeVisible();
});
test("protected endpoints reject anonymous calls and forged webhooks", async ({ request }) => {
  expect((await request.get("/api/snapshot")).status()).toBe(401);
  expect((await request.post("/api/cron")).status()).toBe(401);
  expect((await request.post("/api/webhooks/facebook", { data: { object: "page", entry: [] }, headers: { "x-hub-signature-256": "sha256=forged" } })).status()).toBe(401);
});
