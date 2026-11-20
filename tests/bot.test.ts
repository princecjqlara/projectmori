import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Contact, Tenant } from "../src/lib/types";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  audit: vi.fn(),
  send: vi.fn(),
  answer: vi.fn(),
  decide: vi.fn(),
}));
vi.mock("../src/server/db", () => ({
  pool: { query: mocks.query },
  audit: mocks.audit,
}));
vi.mock("../src/server/facebook", () => ({ sendMessage: mocks.send }));
vi.mock("../src/server/knowledge", () => ({ answerKnowledge: mocks.answer }));
vi.mock("../src/server/jev", async () => ({
  ...(await vi.importActual("../src/server/jev")),
  decide: mocks.decide,
}));
import { botReply, planTouchpoints } from "../src/server/bot";
const tenant: Tenant = {
  id: "tenant",
  name: "Test",
  timezone: "Asia/Manila",
  currency: "PHP",
  expense_percent: 0,
  expense_threshold_minor: 0,
  automation_enabled: false,
  bot_enabled: true,
  aov_spend_multiplier: 1.5,
  min_ad_days: 3,
  intake_fields: [
    {
      key: "name",
      label: "What is your full name?",
      required: true,
      type: "text",
    },
    {
      key: "phone",
      label: "What number can we reach you on?",
      required: true,
      type: "phone",
    },
  ],
  followup_templates: Array.from({ length: 7 }, () => "Hello {name}"),
  role: "head",
};
const contact = (): Contact => ({
  id: "contact",
  tenant_id: "tenant",
  page_id: "page",
  external_id: "person",
  name: "Customer",
  email: null,
  phone: null,
  stage: "not_qualified",
  bot_state: "intake",
  first_inquiry_at: new Date().toISOString(),
  last_inbound_at: new Date().toISOString(),
  converted_at: null,
  ad_window_opened_at: null,
  source_ad_id: null,
  source: "messenger",
  timezone: null,
  form_answers: {},
  objections: [],
  notes: "",
  opted_out: false,
  assigned_to: null,
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("JEV_API_KEY", "");
  vi.stubEnv("OPENROUTER_API_KEY", "");
  vi.stubEnv("JEV_PROVIDER", "typesafe");
  mocks.query.mockResolvedValue({ rows: [], rowCount: 1 });
  mocks.send.mockResolvedValue({ message_id: "sent" });
  mocks.answer.mockResolvedValue({
    answer: null,
    reason: "No supported knowledge",
  });
});
afterEach(() => vi.unstubAllEnvs());
describe("Intake, consent, knowledge, and handoff", () => {
  it("introduces the bot and starts with the form even when the first message is a question", async () => {
    const c = contact();
    await botReply(tenant, c, "How much is shipping?", true);
    expect(mocks.answer).not.toHaveBeenCalled();
    expect(mocks.send.mock.calls[0][3]).toContain("automated assistant");
    expect(mocks.send.mock.calls[0][3]).toContain("What is your full name?");
    expect(c.form_answers).toEqual({});
  });
  it("keeps collecting required answers before FAQs and does not save questions as answers", async () => {
    const c = contact();
    await botReply(tenant, c, "How long does delivery take?", false);
    expect(mocks.answer).not.toHaveBeenCalled();
    expect(c.form_answers).toEqual({});
    expect(mocks.send.mock.calls[0][3]).toContain("complete your details");
  });
  it("saves a valid answer and asks the next question", async () => {
    const c = contact();
    await botReply(tenant, c, "Andrea Reyes", false);
    expect(c.form_answers.name).toBe("Andrea Reyes");
    expect(mocks.send.mock.calls[0][3]).toContain(
      "What number can we reach you on?",
    );
  });
  it("does not accept a malformed phone number or skip to qualified", async () => {
    const c = contact();
    c.form_answers = { name: "Andrea" };
    await botReply(tenant, c, "tomorrow", false);
    expect(c.form_answers.phone).toBeUndefined();
    expect(
      mocks.query.mock.calls.some((call) =>
        call[0].includes("bot_state='faq'"),
      ),
    ).toBe(false);
  });
  it("records opt-out while a human controls the conversation and cancels touchpoints", async () => {
    const c = contact();
    c.bot_state = "human";
    await botReply({ ...tenant, bot_enabled: false }, c, "STOP", false);
    expect(
      mocks.query.mock.calls.some((call) => call[0].includes("opted_out=true")),
    ).toBe(true);
    expect(
      mocks.query.mock.calls.some((call) =>
        call[0].includes("status='cancelled'"),
      ),
    ).toBe(true);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("hands off unsupported questions after intake", async () => {
    const c = contact();
    c.form_answers = { name: "Andrea", phone: "09171234567" };
    c.bot_state = "faq";
    await botReply(
      tenant,
      c,
      "Can you guarantee it cures my condition?",
      false,
    );
    expect(mocks.answer).toHaveBeenCalled();
    expect(
      mocks.query.mock.calls.some((call) =>
        call[0].includes("bot_state='human'"),
      ),
    ).toBe(true);
    expect(mocks.send.mock.calls[0][3]).toContain("team to answer");
  });
  it("does not answer or schedule while opted out", async () => {
    const c = { ...contact(), opted_out: true };
    await botReply(tenant, c, "hello", false);
    await planTouchpoints({ query: mocks.query }, tenant, c);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("asks only for details still missing after multi-field autofill", async () => {
    const c = contact();
    c.name = "Andrea Reyes";
    c.phone = "09171234567";
    c.form_answers = { name: "Andrea Reyes", phone: "09171234567" };
    await botReply(
      tenant,
      c,
      "My name is Andrea Reyes and my number is 09171234567.",
      true,
    );
    expect(mocks.send.mock.calls[0][3]).toContain("your details are complete");
    expect(mocks.send.mock.calls[0][3]).not.toContain(
      "What is your full name?",
    );
    expect(mocks.send.mock.calls[0][3]).not.toContain(
      "What number can we reach you on?",
    );
  });
});
