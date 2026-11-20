"use client";
import { useMemo, useState } from "react";
import { DateTime } from "luxon";
import {
  Plus,
  Download,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  TrendingUp,
  Wallet,
  Users,
  Target,
  Info,
  Clock3,
  MessagesSquare,
  SlidersHorizontal,
  Check,
  ArrowUpRight,
  Sparkles,
  Layers3,
} from "lucide-react";
import { useApp } from "./context";
import {
  Button,
  IconButton,
  Select,
  Badge,
  Avatar,
  StageBadge,
  Empty,
  formatMoney,
  formatNumber,
  formatPercent,
  formatDate,
  Sparkline,
} from "./ui";
import {
  cohortMetrics,
  aggregateMetrics,
  dayKey,
  formPatterns,
  type CohortMetrics,
} from "@/lib/domain";
import type { Snapshot } from "@/lib/types";

function usePerformance() {
  const { data } = useApp();
  const [month, setMonth] = useState(
      DateTime.now().setZone(data.tenant.timezone).startOf("month"),
    ),
    [ad, setAd] = useState("all");
  const rows = useMemo(
    () =>
      Array.from({ length: month.daysInMonth || 30 }, (_, i) =>
        cohortMetrics(
          month.set({ day: i + 1 }).toISODate()!,
          data.contacts,
          data.orders,
          data.spend,
          data.tenant,
          ad === "all" ? undefined : ad,
        ),
      ),
    [month, data, ad],
  );
  return { month, setMonth, ad, setAd, rows, totals: aggregateMetrics(rows) };
}
function exportCsv(rows: CohortMetrics[], currency: string) {
  const columns = [
    "Inquiry date",
    "Inquiries",
    "Qualified",
    "Not qualified",
    "Converted stage",
    "Paying customers",
    "Paid orders",
    `Revenue (${currency})`,
    `Spend (${currency})`,
    `Expenses (${currency})`,
    `Profit (${currency})`,
    `CPA (${currency})`,
    "ROAS",
    "Conversion rate",
    "Avg hours to conversion",
  ];
  const csv = [
    columns.join(","),
    ...rows.map((r) =>
      [
        r.day,
        r.inquiries,
        r.qualified,
        r.notQualified,
        r.converted,
        r.customers,
        r.orders,
        r.revenue / 100,
        r.spend / 100,
        r.expenses / 100,
        r.profit / 100,
        r.cpa === null ? "" : r.cpa / 100,
        r.roas ?? "",
        r.conversionRate ?? "",
        r.avgHoursToConversion ?? "",
      ].join(","),
    ),
  ].join("\r\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8;" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `mori-cohorts-${rows[0]?.day.slice(0, 7)}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}
function Stats({ p }: { p: ReturnType<typeof usePerformance> }) {
  const { data } = useApp();
  const cur = data.tenant.currency;
  const cards = [
    {
      label: "Cohort revenue",
      value: formatMoney(p.totals.revenue, cur),
      note: `${p.totals.orders} paid orders from this month’s inquiries`,
      icon: Wallet,
      values: p.rows.map((r) => r.revenue),
      color: "#497d68",
      tone: "green",
    },
    {
      label: "Ad spend",
      value: formatMoney(p.totals.spend, cur),
      note: "Actual spend on the inquiry dates",
      icon: Target,
      values: p.rows.map((r) => r.spend),
      color: "#a29368",
      tone: "sand",
    },
    {
      label: "Customers acquired",
      value: formatNumber(p.totals.customers),
      note: `${formatPercent(p.totals.conversionRate)} of ${p.totals.inquiries} inquiries`,
      icon: Users,
      values: p.rows.map((r) => r.customers),
      color: "#768bb2",
      tone: "blue",
    },
    {
      label: "Return on ad spend",
      value: p.totals.roas === null ? "—" : `${p.totals.roas.toFixed(2)}×`,
      note: `${formatMoney(p.totals.profit, cur)} after spend & expenses`,
      icon: TrendingUp,
      values: p.rows.map((r) => r.roas || 0),
      color: "#8a7fa6",
      tone: "lilac",
    },
  ];
  return (
    <div className="stats-grid">
      {cards.map((c) => (
        <div className="stat-card" key={c.label}>
          <div className="stat-label">
            {c.label}
            <span className={`stat-icon ${c.tone}`}>
              <c.icon size={16} />
            </span>
          </div>
          <div className="stat-number-row">
            <strong>{c.value}</strong>
            <Sparkline
              values={c.values.slice(0, DateTime.now().day)}
              color={c.color}
            />
          </div>
          <div className="stat-note">{c.note}</div>
        </div>
      ))}
    </div>
  );
}
function MonthControls({ p }: { p: ReturnType<typeof usePerformance> }) {
  return (
    <div className="month-controls">
      <IconButton
        label="Previous month"
        onClick={() => p.setMonth(p.month.minus({ months: 1 }))}
      >
        <ChevronLeft size={16} />
      </IconButton>
      <span>
        <CalendarDays size={15} />
        {p.month.toFormat("MMMM yyyy")}
      </span>
      <IconButton
        label="Next month"
        onClick={() => p.setMonth(p.month.plus({ months: 1 }))}
      >
        <ChevronRight size={16} />
      </IconButton>
    </div>
  );
}
function Filters({ p }: { p: ReturnType<typeof usePerformance> }) {
  const { data } = useApp();
  return (
    <div className="page-filters">
      <Select
        aria-label="Filter by creative"
        value={p.ad}
        onChange={(e) => p.setAd(e.target.value)}
      >
        <option value="all">All ad creatives</option>
        {data.ads.map((a) => (
          <option value={a.id} key={a.id}>
            {a.name}
          </option>
        ))}
      </Select>
      <MonthControls p={p} />
      <Button onClick={() => exportCsv(p.rows, data.tenant.currency)}>
        <Download size={15} /> Export report
      </Button>
    </div>
  );
}
export function Overview({ onAdd }: { onAdd: () => void }) {
  const { data, userId, navigate, openContact } = useApp();
  const p = usePerformance();
  const now = DateTime.now().setZone(data.tenant.timezone);
  const name =
    data.members.find((m) => m.user_id === userId)?.name.split(" ")[0] ||
    "there";
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow greeting-date">
            {now.toFormat("cccc, MMMM d, yyyy")}
          </div>
          <h1>
            Good{" "}
            {now.hour < 12
              ? "morning"
              : now.hour < 18
                ? "afternoon"
                : "evening"}
            , {name}
            <span className="greeting-sun">☼</span>
          </h1>
          <p>
            A little perspective on your conversations, customers, and growth.
          </p>
        </div>
        <Button variant="primary" onClick={onAdd}>
          <Plus size={16} /> Add contact
        </Button>
      </div>
      <Filters p={p} />
      <Stats p={p} />
      <div className="overview-grid">
        <CalendarPanel p={p} />
        <GrowthPanel p={p} />
      </div>
      <div className="bottom-grid">
        <div className="panel">
          <div className="panel-heading">
            <div>
              <h2>Creatives making connections</h2>
              <p>Results that keep growing with your inquiry cohorts.</p>
            </div>
            <button className="text-link" onClick={() => navigate("ads")}>
              View creatives <Layers3 size={14} />
            </button>
          </div>
          <CreativeTable data={data} p={p} />
        </div>
        <div className="panel recent-panel">
          <div className="panel-heading">
            <div>
              <h2>People behind the numbers</h2>
              <p>Your newest conversations.</p>
            </div>
            <button className="text-link" onClick={() => navigate("contacts")}>
              View all
            </button>
          </div>
          {data.contacts.slice(0, 4).map((c) => (
            <button
              className="recent-contact"
              key={c.id}
              onClick={() => openContact(c.id)}
            >
              <Avatar name={c.name} />
              <span>
                <strong>{c.name}</strong>
                <small>
                  {formatDate(c.first_inquiry_at, data.tenant.timezone)}
                </small>
              </span>
              <StageBadge stage={c.stage} />
            </button>
          ))}
          {!data.contacts.length && (
            <Empty
              title="Your next connection starts here"
              description="Connect a Page to bring your conversations into Mori."
            />
          )}
        </div>
      </div>
      <div className="cohort-explainer">
        <Info size={16} />
        <p>
          <strong>A clearer picture, even after the day ends.</strong> Revenue
          and conversions follow the first inquiry date. When someone buys
          later, their original day updates automatically. CPA counts unique
          paying customers; ROAS is revenue ÷ ad spend.
        </p>
      </div>
    </>
  );
}
export function CalendarView() {
  const p = usePerformance();
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">THE BIGGER PICTURE</div>
          <h1>Every day has a story.</h1>
          <p>
            Explore the lifetime results of the conversations that started each
            day.
          </p>
        </div>
        <Badge tone="green">Inquiry cohorts</Badge>
      </div>
      <Filters p={p} />
      <Stats p={p} />
      <div className="overview-grid">
        <CalendarPanel p={p} />
        <GrowthPanel p={p} />
      </div>
      <div className="cohort-explainer">
        <Info size={16} />
        <p>
          Day colors reflect cohort profit after ad spend and optional order
          expenses. A day can become greener as later orders arrive.
          Unattributed contacts remain in all-creative totals and never inflate
          a specific creative.
        </p>
      </div>
    </>
  );
}
function CalendarPanel({ p }: { p: ReturnType<typeof usePerformance> }) {
  const { data, openContact } = useApp();
  const [selected, setSelected] = useState<string | null>(null),
    [view, setView] = useState<"profit" | "revenue">("profit");
  const today = DateTime.now().setZone(data.tenant.timezone).toISODate()!;
  const fallback =
    p.rows.find((r) => r.day === today) ||
    p.rows.find((r) => r.inquiries > 0) ||
    p.rows[0];
  const row = p.rows.find((r) => r.day === selected) || fallback;
  const blanks = Array.from({ length: p.month.weekday - 1 });
  const cur = data.tenant.currency;
  function color(r: CohortMetrics) {
    if (r.day > today) return "future";
    if (!r.spend && !r.inquiries) return "empty";
    if (r.profit < 0) return r.revenue === 0 ? "loss-deep" : "loss";
    if (r.profit === 0) return "neutral";
    if ((r.roas || 0) > 3) return "profit-deep";
    return "profit";
  }
  const cohort = data.contacts.filter(
    (c) =>
      dayKey(c.first_inquiry_at, data.tenant.timezone) === row.day &&
      (p.ad === "all" || c.source_ad_id === p.ad),
  );
  return (
    <section className="panel calendar-panel">
      <div className="panel-heading">
        <div>
          <h2>
            Performance calendar <span className="heading-dot" />
          </h2>
          <p>Small moments. Measurable progress.</p>
        </div>
        <div className="segmented">
          <button
            className={view === "profit" ? "selected" : ""}
            onClick={() => setView("profit")}
          >
            Profit
          </button>
          <button
            className={view === "revenue" ? "selected" : ""}
            onClick={() => setView("revenue")}
          >
            Revenue
          </button>
        </div>
      </div>
      <div className="calendar-weekdays">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="calendar-grid">
        {blanks.map((_, i) => (
          <span className="calendar-blank" key={`blank-${i}`} />
        ))}
        {p.rows.map((r) => (
          <button
            aria-label={`${r.day}: ${r.inquiries} inquiries, ${formatMoney(r.revenue, cur)} revenue, ${formatMoney(r.profit, cur)} profit`}
            key={r.day}
            className={`calendar-cell ${color(r)} ${row.day === r.day ? "chosen" : ""} ${r.day === today ? "today" : ""}`}
            onClick={() => setSelected(r.day)}
          >
            <span className="calendar-date">
              {Number(r.day.slice(-2))}
              {r.day === today && <i />}
            </span>
            {r.day <= today && (r.inquiries || r.spend) ? (
              <>
                <strong>
                  {formatMoney(
                    view === "profit" ? r.profit : r.revenue,
                    cur,
                    true,
                  )}
                </strong>
                <small>
                  <span>{r.inquiries}</span>
                  <span className="inquiry-label"> inquiries</span>
                </small>
              </>
            ) : (
              <span className="calendar-no-data">—</span>
            )}
          </button>
        ))}
      </div>
      <div className="calendar-legend">
        <span>
          <i className="legend-square loss-deep" />
          Loss
        </span>
        <span className="legend-scale">
          <i className="loss" />
          <i className="neutral" />
          <i className="profit" />
          <i className="profit-deep" />
        </span>
        <span>Profitable</span>
        <span className="calendar-zone">{data.tenant.timezone}</span>
      </div>
      <div className="selected-day">
        <div className="selected-day-top">
          <div>
            <span className="eyebrow">DAY IN FOCUS</span>
            <h3>{DateTime.fromISO(row.day).toFormat("cccc, MMMM d")}</h3>
          </div>
          <Badge tone={row.profit >= 0 ? "green" : "red"}>
            {row.inquiries
              ? `${row.customers} customers acquired`
              : "No inquiries yet"}
          </Badge>
        </div>
        <div className="day-stats">
          <span>
            Revenue<strong>{formatMoney(row.revenue, cur)}</strong>
          </span>
          <span>
            Ad spend<strong>{formatMoney(row.spend, cur)}</strong>
          </span>
          <span>
            CPA<strong>{formatMoney(row.cpa, cur)}</strong>
          </span>
          <span>
            ROAS
            <strong>
              {row.roas === null ? "—" : `${row.roas.toFixed(2)}×`}
            </strong>
          </span>
          <span>
            Conversion<strong>{formatPercent(row.conversionRate)}</strong>
          </span>
        </div>
        <div className="day-milestones">
          <span>
            Converted in 24h
            <strong>
              {formatPercent(
                row.inquiries
                  ? row.conversionMilestones.within1Day / row.inquiries
                  : null,
              )}
            </strong>
          </span>
          <span>
            Within 3 days
            <strong>
              {formatPercent(
                row.inquiries
                  ? row.conversionMilestones.within3Days / row.inquiries
                  : null,
              )}
            </strong>
          </span>
          <span>
            Within 7 days
            <strong>
              {formatPercent(
                row.inquiries
                  ? row.conversionMilestones.within7Days / row.inquiries
                  : null,
              )}
            </strong>
          </span>
          <span>
            Average order<strong>{formatMoney(row.aov, cur)}</strong>
          </span>
          <span>
            Avg. conversion time
            <strong>
              {row.avgHoursToConversion === null
                ? "—"
                : `${(row.avgHoursToConversion / 24).toFixed(1)} days`}
            </strong>
          </span>
        </div>
        <div className="day-cohort-footer">
          <div className="avatar-stack">
            {cohort.slice(0, 4).map((c) => (
              <button
                key={c.id}
                title={`Open ${c.name}`}
                onClick={() => openContact(c.id)}
              >
                <Avatar name={c.name} size="small" />
              </button>
            ))}
            <span>{row.inquiries} conversations started here</span>
          </div>
          <span className="muted">
            {row.qualified} qualified · {row.notQualified} not qualified
          </span>
        </div>
        <details className="day-creative-breakdown">
          <summary>
            Creative results for this day <Layers3 size={13} />
          </summary>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Creative</th>
                  <th>Spend</th>
                  <th>Revenue</th>
                  <th>Inquiries</th>
                  <th>Qualified</th>
                  <th>Not qualified</th>
                  <th>Converted</th>
                  <th>CPA</th>
                  <th>ROAS</th>
                </tr>
              </thead>
              <tbody>
                {data.ads
                  .filter((a) => p.ad === "all" || a.id === p.ad)
                  .map((a) => {
                    const m = cohortMetrics(
                      row.day,
                      data.contacts,
                      data.orders,
                      data.spend,
                      data.tenant,
                      a.id,
                    );
                    return (
                      <tr key={a.id}>
                        <td>{a.name}</td>
                        <td>{formatMoney(m.spend, cur)}</td>
                        <td>{formatMoney(m.revenue, cur)}</td>
                        <td>{m.inquiries}</td>
                        <td>{m.qualified}</td>
                        <td>{m.notQualified}</td>
                        <td>{m.converted}</td>
                        <td>{formatMoney(m.cpa, cur)}</td>
                        <td>
                          {m.roas === null ? "—" : `${m.roas.toFixed(2)}×`}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <p>
            Operating expenses: {formatMoney(row.expenses, cur)} · Cohort
            profit: {formatMoney(row.profit, cur)}. All-creative totals also
            include unattributed contacts.
          </p>
        </details>
      </div>
    </section>
  );
}
function GrowthPanel({ p }: { p: ReturnType<typeof usePerformance> }) {
  const { data, openContact, navigate } = useApp();
  const cur = data.tenant.currency;
  const tp = data.touchpoints
    .filter((t) => ["scheduled", "needs_human"].includes(t.status))
    .slice(0, 3);
  const paid = p.totals.inquiries;
  const one = p.rows.reduce(
      (sum, r) => sum + r.conversionMilestones.within1Day,
      0,
    ),
    three = p.rows.reduce(
      (sum, r) => sum + r.conversionMilestones.within3Days,
      0,
    ),
    seven = p.rows.reduce(
      (sum, r) => sum + r.conversionMilestones.within7Days,
      0,
    );
  return (
    <aside className="growth-column">
      <div className="growth-card">
        <div className="growth-card-top">
          <span className="eyebrow">ROOM TO GROW</span>
          <Sparkles size={19} />
        </div>
        <h2>
          Good conversations.
          <br />
          Better outcomes.
        </h2>
        <p>Turn a little attention into a lasting customer relationship.</p>
        <div className="growth-mini-stats">
          <span>
            Average order<strong>{formatMoney(p.totals.aov, cur)}</strong>
          </span>
          <span>
            Acquisition cost<strong>{formatMoney(p.totals.cpa, cur)}</strong>
          </span>
        </div>
        <div className="growth-progress">
          <span
            style={{
              width: `${Math.min(100, (p.totals.conversionRate || 0) * 100)}%`,
            }}
          />
        </div>
        <small>
          {formatPercent(p.totals.conversionRate)} of inquiries became customers
        </small>
      </div>
      <section className="panel conversion-panel">
        <div className="panel-heading compact">
          <h2>Conversions take time</h2>
          <Clock3 size={16} />
        </div>
        <p className="panel-subtitle">
          Share of inquiries converted by each milestone.
        </p>
        {[
          { label: "Within 24 hours", value: one, color: "green" },
          { label: "Within 3 days", value: three, color: "blue" },
          { label: "Within 7 days", value: seven, color: "lilac" },
        ].map((m) => (
          <div className="conversion-row" key={m.label}>
            <div>
              <span>{m.label}</span>
              <strong>
                {paid ? `${((m.value / paid) * 100).toFixed(1)}%` : "—"}
              </strong>
            </div>
            <div className={`progress-bar ${m.color}`}>
              <span
                style={{ width: `${paid ? (m.value / paid) * 100 : 0}%` }}
              />
            </div>
          </div>
        ))}
        <small className="muted">
          Recent cohorts are still maturing. Later purchases update their
          original day.
        </small>
      </section>
      <section className="panel touchpoint-panel">
        <div className="panel-heading compact">
          <h2>A thoughtful next step</h2>
          <button className="text-link" onClick={() => navigate("inbox")}>
            View inbox
          </button>
        </div>
        {tp.length ? (
          tp.map((t) => {
            const c = data.contacts.find((c) => c.id === t.contact_id);
            return (
              <button
                className="upcoming-touchpoint"
                key={t.id}
                onClick={() => c && openContact(c.id)}
              >
                <span
                  className={`touchpoint-icon ${t.status === "needs_human" ? "sand" : ""}`}
                >
                  {t.status === "needs_human" ? (
                    <Users size={16} />
                  ) : (
                    <MessagesSquare size={16} />
                  )}
                </span>
                <span>
                  <strong>{c?.name || "Contact"}</strong>
                  <small>
                    Day {t.day_number} ·{" "}
                    {t.status === "needs_human"
                      ? "Needs a person"
                      : formatDate(
                          t.scheduled_at,
                          data.tenant.timezone,
                          "h:mm a",
                        )}
                  </small>
                </span>
              </button>
            );
          })
        ) : (
          <p className="panel-subtitle">
            Your scheduled touchpoints will appear here.
          </p>
        )}
      </section>
    </aside>
  );
}
function CreativeTable({
  data,
  p,
}: {
  data: Snapshot;
  p: ReturnType<typeof usePerformance>;
}) {
  const { navigate } = useApp();
  return data.ads.length ? (
    <div className="table-scroll">
      <table className="data-table creative-summary">
        <thead>
          <tr>
            <th>Creative</th>
            <th>Inquiries</th>
            <th>Revenue</th>
            <th>ROAS</th>
          </tr>
        </thead>
        <tbody>
          {data.ads.slice(0, 4).map((ad, i) => {
            const totals = aggregateMetrics(
              p.rows.map((r) =>
                cohortMetrics(
                  r.day,
                  data.contacts,
                  data.orders,
                  data.spend,
                  data.tenant,
                  ad.id,
                ),
              ),
            );
            return (
              <tr
                key={ad.id}
                onClick={() => navigate("ads")}
                className="clickable"
              >
                <td>
                  <div className="creative-name">
                    <span className="creative-thumb">{ad.thumbnail_url ? <img src={ad.thumbnail_url} alt="" /> : <Layers3 size={20} />}</span>
                    <span>
                      <strong>{ad.creative_name}</strong>
                      <small>{ad.name}</small>
                    </span>
                  </div>
                </td>
                <td>{totals.inquiries}</td>
                <td>{formatMoney(totals.revenue, data.tenant.currency)}</td>
                <td>
                  <Badge tone={(totals.roas || 0) >= 2 ? "green" : "neutral"}>
                    {totals.roas === null ? "—" : `${totals.roas.toFixed(2)}×`}
                  </Badge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty
      title="Your creatives belong here"
      description="Connect a Facebook ad account and sync to see results."
    />
  );
}
export function ReportsView() {
  const { data } = useApp();
  const p = usePerformance();
  const [stage, setStage] = useState("all");
  const cohort = data.contacts.filter(
    (c) =>
      dayKey(c.first_inquiry_at, data.tenant.timezone).startsWith(
        p.month.toFormat("yyyy-MM"),
      ) &&
      (p.ad === "all" || c.source_ad_id === p.ad),
  );
  const patterns = formPatterns(cohort).filter(
    (p) => stage === "all" || p.stage === stage,
  );
  // Avoid aggregating identity fields into "common patterns".
  const meaningful = patterns.filter(
    (p) => !["name", "email", "phone"].includes(p.field),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">UNDERSTAND WHAT CONNECTS</div>
          <h1>Patterns, with perspective.</h1>
          <p>
            See what your customers share, and which conversations turn into
            value.
          </p>
        </div>
      </div>
      <Filters p={p} />
      <Stats p={p} />
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>What your customers are telling you</h2>
            <p>
              Similar answers are grouped by normalized text. Percentages use
              answered forms in each stage.
            </p>
          </div>
          <Select
            aria-label="Filter patterns by stage"
            value={stage}
            onChange={(e) => setStage(e.target.value)}
          >
            <option value="all">All stages</option>
            <option value="qualified">Qualified</option>
            <option value="not_qualified">Not qualified</option>
            <option value="converted">Converted</option>
          </Select>
        </div>
        {meaningful.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Form field</th>
                  <th>Common answer</th>
                  <th>Stage</th>
                  <th>Responses</th>
                  <th>Share of answers</th>
                </tr>
              </thead>
              <tbody>
                {meaningful.slice(0, 30).map((p, i) => (
                  <tr key={i}>
                    <td className="capitalize">
                      {p.field.replaceAll("_", " ")}
                    </td>
                    <td>{p.answer}</td>
                    <td>
                      <StageBadge stage={p.stage} />
                    </td>
                    <td>
                      {p.count} of {p.total}
                    </td>
                    <td>
                      <div className="pattern-share">
                        <div className="progress-bar green">
                          <span style={{ width: `${p.percent}%` }} />
                        </div>
                        <strong>{p.percent.toFixed(1)}%</strong>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Patterns start with a few answers"
            description="As people complete your intake form, shared answers will appear here."
          />
        )}
      </section>
      <section className="panel report-table">
        <div className="panel-heading">
          <div>
            <h2>A month of meaningful moments</h2>
            <p>
              Revenue includes later purchases from these inquiry dates. Amounts
              update as orders change.
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Inquiry date</th>
                <th>Inquiries</th>
                <th>Customers</th>
                <th>Qualified</th>
                <th>Revenue</th>
                <th>Ad spend</th>
                <th>Profit</th>
                <th>Conv. rate</th>
                <th>CPA</th>
                <th>AOV</th>
              </tr>
            </thead>
            <tbody>
              {p.rows
                .filter((r) => r.inquiries || r.spend)
                .map((r) => (
                  <tr key={r.day}>
                    <td>{DateTime.fromISO(r.day).toFormat("MMM d, ccc")}</td>
                    <td>{r.inquiries}</td>
                    <td>{r.customers}</td>
                    <td>{r.qualified}</td>
                    <td>{formatMoney(r.revenue, data.tenant.currency)}</td>
                    <td>{formatMoney(r.spend, data.tenant.currency)}</td>
                    <td className={r.profit >= 0 ? "positive" : "negative"}>
                      {formatMoney(r.profit, data.tenant.currency)}
                    </td>
                    <td>{formatPercent(r.conversionRate)}</td>
                    <td>{formatMoney(r.cpa, data.tenant.currency)}</td>
                    <td>{formatMoney(r.aov, data.tenant.currency)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
