import { DateTime } from "luxon";
import type { Ad, AdSpend, Contact, Message, Order, Tenant } from "./types";

export const DEFAULT_FIELDS: Tenant["intake_fields"] = [
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
  {
    key: "interest",
    label: "Which product or service are you interested in?",
    required: true,
    type: "text",
  },
  {
    key: "location",
    label: "What city are you in?",
    required: true,
    type: "text",
  },
  {
    key: "budget",
    label: "What budget do you have in mind?",
    required: true,
    type: "text",
  },
];
export const DEFAULT_FOLLOWUPS = [
  "Hi {name}! Would you like help completing your inquiry?",
  "Hi {name}, do you have any questions about the options we discussed?",
  "Hi {name}! Is there anything you would like us to clarify?",
  "Hi {name}, we are here if you need help choosing the right option.",
  "Hi {name}! Would you like a team member to walk you through the next step?",
  "Hi {name}, just checking whether you still need assistance with your inquiry.",
  "Hi {name}! This is our final check-in. Reply anytime if you would like help.",
];
export const dayKey = (iso: string, zone = "Asia/Manila") =>
  DateTime.fromISO(iso, { zone: "utc" }).setZone(zone).toISODate()!;
export const moneyMinor = (amount: string | number) => {
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000_000)
    throw new Error("Enter a valid amount between 0 and 1 billion.");
  return Math.round((n + Number.EPSILON) * 100);
};
export const ratio = (a: number, b: number): number | null =>
  b > 0 ? a / b : null;
export function expenseForOrder(
  order: Order,
  tenant: Pick<Tenant, "expense_percent" | "expense_threshold_minor">,
) {
  return order.amount_minor >= tenant.expense_threshold_minor
    ? Math.round((order.amount_minor * tenant.expense_percent) / 100)
    : 0;
}
export type CohortMetrics = {
  day: string;
  inquiries: number;
  qualified: number;
  notQualified: number;
  converted: number;
  customers: number;
  orders: number;
  revenue: number;
  spend: number;
  expenses: number;
  profit: number;
  aov: number | null;
  cpa: number | null;
  roas: number | null;
  conversionRate: number | null;
  avgHoursToConversion: number | null;
  conversionMilestones: {
    within1Day: number;
    within3Days: number;
    within7Days: number;
    later: number;
  };
};
export function cohortMetrics(
  day: string,
  contacts: Contact[],
  orders: Order[],
  spend: AdSpend[],
  tenant: Pick<
    Tenant,
    "timezone" | "expense_percent" | "expense_threshold_minor"
  >,
  adId?: string,
): CohortMetrics {
  const cohort = contacts.filter(
    (c) =>
      dayKey(c.first_inquiry_at, tenant.timezone) === day &&
      (!adId || c.source_ad_id === adId),
  );
  const ids = new Set(cohort.map((c) => c.id));
  const paid = orders.filter(
    (o) => ids.has(o.contact_id) && o.status === "paid",
  );
  const revenue = paid.reduce((sum, o) => sum + o.amount_minor, 0);
  const expenses = paid.reduce((sum, o) => sum + expenseForOrder(o, tenant), 0);
  const adSpend = spend
    .filter((s) => s.day === day && (!adId || s.ad_id === adId))
    .reduce((sum, s) => sum + s.spend_minor, 0);
  const buyers = new Set(paid.map((o) => o.contact_id));
  const hours = cohort
    .filter((c) => buyers.has(c.id))
    .map((c) => {
      const first = paid
        .filter((o) => o.contact_id === c.id)
        .map((o) => o.paid_at || o.created_at)
        .sort()[0];
      return Math.max(
        0,
        (Date.parse(first) - Date.parse(c.first_inquiry_at)) / 3_600_000,
      );
    });
  return {
    day,
    inquiries: cohort.length,
    qualified: cohort.filter((c) => c.stage === "qualified").length,
    notQualified: cohort.filter((c) => c.stage === "not_qualified").length,
    converted: cohort.filter((c) => c.stage === "converted").length,
    customers: buyers.size,
    orders: paid.length,
    revenue,
    spend: adSpend,
    expenses,
    profit: revenue - adSpend - expenses,
    aov: ratio(revenue, paid.length),
    cpa: ratio(adSpend, buyers.size),
    roas: ratio(revenue, adSpend),
    conversionRate: ratio(buyers.size, cohort.length),
    avgHoursToConversion: hours.length
      ? hours.reduce((a, b) => a + b, 0) / hours.length
      : null,
    conversionMilestones: {
      within1Day: hours.filter((h) => h <= 24).length,
      within3Days: hours.filter((h) => h <= 72).length,
      within7Days: hours.filter((h) => h <= 168).length,
      later: hours.filter((h) => h > 168).length,
    },
  };
}
export function aggregateMetrics(rows: CohortMetrics[]) {
  const sums = rows.reduce(
    (a, r) => ({
      inquiries: a.inquiries + r.inquiries,
      customers: a.customers + r.customers,
      orders: a.orders + r.orders,
      revenue: a.revenue + r.revenue,
      spend: a.spend + r.spend,
      expenses: a.expenses + r.expenses,
      profit: a.profit + r.profit,
      qualified: a.qualified + r.qualified,
      notQualified: a.notQualified + r.notQualified,
      converted: a.converted + r.converted,
    }),
    {
      inquiries: 0,
      customers: 0,
      orders: 0,
      revenue: 0,
      spend: 0,
      expenses: 0,
      profit: 0,
      qualified: 0,
      notQualified: 0,
      converted: 0,
    },
  );
  return {
    ...sums,
    aov: ratio(sums.revenue, sums.orders),
    cpa: ratio(sums.spend, sums.customers),
    roas: ratio(sums.revenue, sums.spend),
    conversionRate: ratio(sums.customers, sums.inquiries),
  };
}
export type ContactTime = {
  hour: number;
  label: string;
  count: number;
  share: number;
  confidence: "low" | "medium" | "high";
};
export function bestContactTimes(
  messages: Pick<Message, "direction" | "sent_at">[],
  zone: string,
): ContactTime[] {
  const counts = new Map<number, number>();
  // Count distinct active days per hour so one burst cannot outweigh many separate days.
  const samples = new Set<string>();
  for (const m of messages.filter((m) => m.direction === "inbound")) {
    const dt = DateTime.fromISO(m.sent_at).setZone(zone);
    if (dt.isValid) samples.add(`${dt.toISODate()}/${dt.hour}`);
  }
  for (const sample of samples) {
    const hour = Number(sample.split("/")[1]);
    counts.set(hour, (counts.get(hour) || 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, 5)
    .map(([hour, count]) => ({
      hour,
      count,
      label: DateTime.fromObject({ hour }, { zone }).toFormat("h a"),
      share: count / samples.size,
      confidence: count >= 7 ? "high" : count >= 3 ? "medium" : "low",
    }));
}
export function nextTouchpoint(
  firstInquiry: string,
  dayNumber: number,
  hours: number[],
  zone: string,
  now: DateTime = DateTime.utc(),
) {
  const first = DateTime.fromISO(firstInquiry).setZone(zone);
  const day = first.plus({ days: dayNumber }).startOf("day");
  const candidates = (hours.length ? hours : [first.hour])
    .map((hour) => day.set({ hour, minute: 0, second: 0, millisecond: 0 }))
    .filter(
      (t) =>
        t.toMillis() >=
        DateTime.fromISO(firstInquiry).plus({ hours: 1 }).toMillis(),
    );
  const future = candidates.filter((t) => t.toMillis() > now.toMillis());
  const selected =
    future[0] || candidates[0] || day.plus({ hours: 23, minutes: 59 });
  return selected.toUTC().toISO()!;
}
export function messagePermission(
  contact: Pick<
    Contact,
    "opted_out" | "last_inbound_at" | "ad_window_opened_at"
  >,
  sender: "bot" | "agent",
  now = Date.now(),
  allowAdWindow = false,
) {
  if (contact.opted_out)
    return { allowed: false, tag: null, reason: "Contact opted out." };
  if (!contact.last_inbound_at)
    return {
      allowed: false,
      tag: null,
      reason: "No inbound message opens a messaging window.",
    };
  const elapsed = now - Date.parse(contact.last_inbound_at);
  if (elapsed >= 0 && elapsed < 24 * 3_600_000)
    return { allowed: true, tag: null, reason: "Standard 24-hour window." };
  const adElapsed = contact.ad_window_opened_at
    ? now - Date.parse(contact.ad_window_opened_at)
    : Infinity;
  if (allowAdWindow && adElapsed >= 0 && adElapsed < 7 * 86_400_000)
    return {
      allowed: true,
      tag: null,
      reason: "Verified ad-opened seven-day standard window.",
    };
  if (sender === "agent" && elapsed >= 0 && elapsed < 7 * 86_400_000)
    return {
      allowed: true,
      tag: "HUMAN_AGENT",
      reason:
        "Manual support reply only. Requires approved HUMAN_AGENT permission.",
    };
  return {
    allowed: false,
    tag: null,
    reason:
      "Outside the permitted messaging window. A new inbound message or an eligible approved messaging permission is needed.",
  };
}
export function evaluateAd(
  ad: Ad,
  spend: AdSpend[],
  contacts: Contact[],
  orders: Order[],
  tenant: Tenant,
  today: string,
) {
  const allPaid = orders.filter((o) => o.status === "paid");
  const aov = ratio(
    allPaid.reduce((sum, o) => sum + o.amount_minor, 0),
    allPaid.length,
  );
  if (!aov)
    return {
      action: "hold" as const,
      reason: "No paid-order average order value yet.",
      aov,
      averageSpend: 0,
    };
  const days = Array.from(
    { length: 3 },
    (_, i) =>
      DateTime.fromISO(today)
        .minus({ days: i + 1 })
        .toISODate()!,
  );
  const observations = spend.filter(
    (s) => s.ad_id === ad.id && days.includes(s.day),
  );
  if (
    new Set(observations.map((s) => s.day)).size <
    Math.max(3, tenant.min_ad_days)
  )
    return {
      action: "hold" as const,
      reason: "Need three complete days of spend. Today is excluded.",
      aov,
      averageSpend: 0,
    };
  const total = observations.reduce((sum, s) => sum + s.spend_minor, 0);
  const averageSpend = total / 3;
  const cohorts = days.map((d) =>
    cohortMetrics(d, contacts, orders, spend, tenant, ad.id),
  );
  const revenue = cohorts.reduce((sum, c) => sum + c.revenue, 0);
  const buyerCount = cohorts.reduce((sum, c) => sum + c.customers, 0);
  const roas = ratio(revenue, total);
  const costs = cohorts.reduce((sum, c) => sum + c.expenses, 0);
  const netMargin = 1 - tenant.expense_percent / 100;
  const threshold = aov * tenant.aov_spend_multiplier;
  const loss = revenue - total - costs < 0;
  const enoughSpend = averageSpend >= threshold;
  const shouldPause =
    ad.status === "ACTIVE" &&
    enoughSpend &&
    loss &&
    (!buyerCount || (roas !== null && roas < 1 / Math.max(0.01, netMargin)));
  return {
    action: shouldPause ? ("pause" as const) : ("keep" as const),
    reason: shouldPause
      ? "Three-day average spend exceeds the AOV threshold and inquiry cohorts are unprofitable."
      : "Below the AOV spend threshold or producing profitable cohort results.",
    aov,
    averageSpend,
    threshold,
    roas,
    revenue,
    buyerCount,
  };
}
export function formPatterns(contacts: Contact[]) {
  const groups: Record<
    string,
    Record<string, Record<string, number>>
  > = Object.create(null);
  const denominators: Record<string, Record<string, number>> = Object.create(
    null,
  );
  for (const c of contacts)
    for (const [field, raw] of Object.entries(c.form_answers)) {
      const answer = raw.trim().toLocaleLowerCase().replace(/\s+/g, " ");
      if (!answer) continue;
      groups[c.stage] ??= Object.create(null);
      groups[c.stage][field] ??= Object.create(null);
      denominators[c.stage] ??= Object.create(null);
      groups[c.stage][field][answer] =
        (groups[c.stage][field][answer] || 0) + 1;
      denominators[c.stage][field] = (denominators[c.stage][field] || 0) + 1;
    }
  return Object.entries(groups)
    .flatMap(([stage, fields]) =>
      Object.entries(fields).flatMap(([field, answers]) =>
        Object.entries(answers).map(([answer, count]) => ({
          stage,
          field,
          answer,
          count,
          total: denominators[stage][field],
          percent: (count / denominators[stage][field]) * 100,
        })),
      ),
    )
    .sort((a, b) => b.count - a.count);
}
