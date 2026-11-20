import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import {
  aggregateMetrics,
  bestContactTimes,
  cohortMetrics,
  evaluateAd,
  formPatterns,
  messagePermission,
  nextTouchpoint,
} from "../src/lib/domain";
import type { Contact, Order, Ad, AdSpend, Tenant } from "../src/lib/types";
const tenant: Tenant = {
  id: "t",
  name: "Test",
  timezone: "Asia/Manila",
  currency: "PHP",
  expense_percent: 20,
  expense_threshold_minor: 0,
  automation_enabled: true,
  bot_enabled: true,
  aov_spend_multiplier: 1,
  min_ad_days: 3,
  intake_fields: [],
  followup_templates: [],
  role: "head",
};
const contact = (
  id: string,
  inquiry: string,
  stage: Contact["stage"] = "converted",
): Contact => ({
  id,
  tenant_id: "t",
  page_id: "p",
  external_id: id,
  name: id,
  email: null,
  phone: null,
  stage,
  bot_state: "faq",
  first_inquiry_at: inquiry,
  last_inbound_at: inquiry,
  converted_at: null,
  ad_window_opened_at: null,
  source_ad_id: "ad",
  source: "messenger",
  timezone: null,
  form_answers: {},
  objections: [],
  notes: "",
  opted_out: false,
  assigned_to: null,
});
const order = (
  id: string,
  contact_id: string,
  amount_minor: number,
  paid_at: string,
  status: Order["status"] = "paid",
): Order => ({
  id,
  contact_id,
  amount_minor,
  paid_at,
  status,
  created_at: paid_at,
  notes: "",
  currency: "PHP",
});
const spend = (day: string, amount = 10000): AdSpend => ({
  id: day,
  ad_id: "ad",
  day,
  spend_minor: amount,
  impressions: 100,
  clicks: 5,
});
describe("Inquiry cohorts and money", () => {
  it("attributes delayed and repeat orders to first inquiry, counts CPA customers once, and excludes refunds", () => {
    const contacts = [
      contact("a", "2026-11-01T16:30:00Z"),
      contact("b", "2026-11-02T02:00:00Z"),
    ];
    const orders = [
      order("1", "a", 100000, "2026-11-12T00:00:00Z"),
      order("2", "a", 50000, "2026-11-18T00:00:00Z"),
      order("3", "b", 200000, "2026-11-20T00:00:00Z", "refunded"),
    ];
    const r = cohortMetrics(
      "2026-11-02",
      contacts,
      orders,
      [spend("2026-11-02", 30000)],
      tenant,
    );
    expect(r.inquiries).toBe(2);
    expect(r.revenue).toBe(150000);
    expect(r.orders).toBe(2);
    expect(r.customers).toBe(1);
    expect(r.cpa).toBe(30000);
    expect(r.conversionRate).toBe(0.5);
    expect(r.roas).toBe(5);
    expect(r.expenses).toBe(30000);
    expect(r.profit).toBe(90000);
    expect(r.conversionMilestones.later).toBe(1);
    expect(
      cohortMetrics("2026-11-12", contacts, orders, [], tenant).revenue,
    ).toBe(0);
  });
  it("returns unknown rather than fabricated zero ratios without denominators", () => {
    const r = cohortMetrics("2026-11-02", [], [], [], tenant);
    expect(r.cpa).toBeNull();
    expect(r.aov).toBeNull();
    expect(r.roas).toBeNull();
    expect(r.conversionRate).toBeNull();
  });
  it("applies expense threshold to each paid order, excluding ad costs", () => {
    const c = contact("a", "2026-11-01T02:00:00Z");
    const r = cohortMetrics(
      "2026-11-01",
      [c],
      [
        order("a", "a", 10000, "2026-11-02T00:00:00Z"),
        order("b", "a", 30000, "2026-11-03T00:00:00Z"),
      ],
      [spend("2026-11-01", 5000)],
      { ...tenant, expense_threshold_minor: 20000 },
    );
    expect(r.expenses).toBe(6000);
    expect(r.profit).toBe(29000);
  });
  it("calculates aggregate AOV from orders rather than averaging day-level averages", () => {
    const c: Contact[] = [
      contact("a", "2026-11-01T02:00:00Z"),
      contact("b", "2026-11-02T02:00:00Z"),
    ];
    const o = [
      order("1", "a", 10000, "2026-11-04T00:00:00Z"),
      order("2", "b", 20000, "2026-11-04T00:00:00Z"),
      order("3", "b", 60000, "2026-11-04T00:00:00Z"),
    ];
    const total = aggregateMetrics(
      ["2026-11-01", "2026-11-02"].map((d) =>
        cohortMetrics(d, c, o, [], tenant),
      ),
    );
    expect(total.aov).toBe(30000);
  });
});
describe("Evidence-based scheduling and message eligibility", () => {
  it("cannot let one message burst outweigh separate active days", () => {
    const m = [
      ...Array.from({ length: 100 }, () => ({
        direction: "inbound" as const,
        sent_at: "2026-11-01T01:30:00Z",
      })),
      ...["02", "03", "04"].map((d) => ({
        direction: "inbound" as const,
        sent_at: `2026-11-${d}T12:00:00Z`,
      })),
    ];
    const times = bestContactTimes(m, "Asia/Manila");
    expect(times[0].hour).toBe(20);
    expect(times[0].count).toBe(3);
    expect(times[0].confidence).toBe("medium");
    expect(times).toHaveLength(2);
    expect(bestContactTimes([], "Asia/Manila")).toEqual([]);
  });
  it("uses the contact timezone and ranked hours for the next-day touchpoint", () => {
    const result = nextTouchpoint(
      "2026-11-01T12:37:00Z",
      1,
      [20, 9],
      "Asia/Manila",
      DateTime.fromISO("2026-11-01T13:00:00Z"),
    );
    expect(result).toBe("2026-11-02T12:00:00.000Z");
  });
  it("keeps automated sends out of HUMAN_AGENT and closes windows at their exact boundary", () => {
    const c = contact("a", "2026-11-01T00:00:00Z");
    expect(
      messagePermission(c, "bot", Date.parse("2026-11-01T23:59:59Z")).allowed,
    ).toBe(true);
    expect(
      messagePermission(c, "bot", Date.parse("2026-11-02T00:00:00Z")).allowed,
    ).toBe(false);
    expect(
      messagePermission(c, "agent", Date.parse("2026-11-02T00:00:00Z")).tag,
    ).toBe("HUMAN_AGENT");
    expect(
      messagePermission(c, "agent", Date.parse("2026-11-08T00:00:00Z")).allowed,
    ).toBe(false);
  });
  it("requires verified ad-opened eligibility and never extends it from unrelated messages", () => {
    const c = {
      ...contact("a", "2026-11-01T00:00:00Z"),
      ad_window_opened_at: "2026-11-01T00:00:00Z",
    };
    const now = Date.parse("2026-11-04T00:00:00Z");
    expect(messagePermission(c, "bot", now, false).allowed).toBe(false);
    expect(messagePermission(c, "bot", now, true).allowed).toBe(true);
    expect(
      messagePermission(c, "bot", Date.parse("2026-11-08T00:00:00Z"), true)
        .allowed,
    ).toBe(false);
    expect(
      messagePermission({ ...c, opted_out: true }, "agent", now, true).allowed,
    ).toBe(false);
  });
});
describe("Ad automation and form patterns", () => {
  const ad: Ad = {
    id: "ad",
    account_id: "account",
    name: "Test",
    creative_name: "Test",
    thumbnail_url: null,
    status: "ACTIVE",
    daily_budget_minor: null,
    automation_enabled: true,
  };
  it("does not automate without AOV or three complete days", () => {
    expect(evaluateAd(ad, [], [], [], tenant, "2026-11-05").action).toBe(
      "hold",
    );
    expect(
      evaluateAd(
        ad,
        [spend("2026-11-04", 999999)],
        [],
        [order("1", "x", 10000, "2026-11-01T00:00:00Z")],
        tenant,
        "2026-11-05",
      ).action,
    ).toBe("hold");
  });
  it("excludes today, preserves winning creatives, and pauses only excess spend with loss", () => {
    const s = ["2026-11-02", "2026-11-03", "2026-11-04"].map((d) =>
      spend(d, 100000),
    );
    s.push(spend("2026-11-05", 99999999));
    const noCohort = [order("1", "old", 50000, "2026-10-01T00:00:00Z")];
    const decision = evaluateAd(ad, s, [], noCohort, tenant, "2026-11-05");
    expect(decision.action).toBe("pause");
    expect(decision.averageSpend).toBe(100000);
    const c = contact("a", "2026-11-02T00:00:00Z");
    expect(
      evaluateAd(
        ad,
        s,
        [c],
        [order("2", "a", 1000000, "2026-11-04T00:00:00Z")],
        tenant,
        "2026-11-05",
      ).action,
    ).toBe("keep");
  });
  it("uses answered forms as denominators separately within each stage", () => {
    const c: Contact[] = [
      {
        ...contact("1", "2026-11-01"),
        form_answers: { city: " Quezon   City " },
      },
      { ...contact("2", "2026-11-01"), form_answers: { city: "QUEZON CITY" } },
      {
        ...contact("3", "2026-11-01", "qualified"),
        form_answers: { city: "Makati" },
      },
      { ...contact("4", "2026-11-01"), form_answers: {} },
    ];
    const patterns = formPatterns(c);
    expect(patterns.find((p) => p.answer === "quezon city")).toMatchObject({
      count: 2,
      total: 2,
      percent: 100,
      stage: "converted",
    });
    expect(patterns.find((p) => p.answer === "makati")?.stage).toBe(
      "qualified",
    );
  });
  it("counts unusual customer text as data rather than inherited object keys", () => {
    const c: Contact = {
      ...contact("5", "2026-11-01"),
      form_answers: { constructor: "__proto__" },
    };
    expect(formPatterns([c])).toMatchObject([
      {
        field: "constructor",
        answer: "__proto__",
        count: 1,
        total: 1,
        percent: 100,
      },
    ]);
  });
});
