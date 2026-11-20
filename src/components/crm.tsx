"use client";
import { useState, useEffect, useRef } from "react";
import { DateTime } from "luxon";
import {
  Plus,
  Search,
  Mail,
  Phone,
  CalendarDays,
  Clock3,
  Wallet,
  MessageCircle,
  Send,
  Paperclip,
  UserRound,
  CheckCheck,
  MoreHorizontal,
  GripVertical,
  ShoppingBag,
  StickyNote,
  Pause,
  Play,
  ChevronRight,
  FileText,
  CheckCircle2,
  Users,
  Tag,
  ExternalLink,
  X,
  Sparkles,
} from "lucide-react";
import type { Contact, Stage, Message } from "@/lib/types";
import {
  bestContactTimes,
  cohortMetrics,
  dayKey,
  messagePermission,
} from "@/lib/domain";
import { useApp } from "./context";
import {
  Button,
  Select,
  Field,
  Modal,
  Avatar,
  StageBadge,
  Badge,
  Empty,
  IconButton,
  formatMoney,
  formatDate,
} from "./ui";

export function ContactsView({ onAdd }: { onAdd: () => void }) {
  const { data, openContact } = useApp();
  const [search, setSearch] = useState(""),
    [stage, setStage] = useState("all"),
    [page, setPage] = useState("all");
  const list = data.contacts.filter(
    (c) =>
      (stage === "all" || c.stage === stage) &&
      (page === "all" || c.page_id === page) &&
      `${c.name} ${c.email || ""} ${c.phone || ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">PEOPLE, NOT JUST PROFILES</div>
          <h1>Every connection, remembered.</h1>
          <p>A little context makes every conversation more personal.</p>
        </div>
        <Button variant="primary" onClick={onAdd}>
          <Plus size={16} />
          Add contact
        </Button>
      </div>
      <div className="list-toolbar">
        <div className="input-search">
          <Search size={17} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a name, email, or phone number"
            aria-label="Search contact list"
          />
        </div>
        <Select
          aria-label="Filter contact stage"
          value={stage}
          onChange={(e) => setStage(e.target.value)}
        >
          <option value="all">All stages</option>
          <option value="qualified">Qualified</option>
          <option value="not_qualified">Not qualified</option>
          <option value="converted">Converted</option>
        </Select>
        <Select
          aria-label="Filter Facebook Page"
          value={page}
          onChange={(e) => setPage(e.target.value)}
        >
          <option value="all">All Pages</option>
          {data.resources
            .filter((r) => r.type === "page")
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
        </Select>
        <span className="muted">{list.length} contacts</span>
      </div>
      <section className="panel">
        <div className="table-scroll">
          <table className="data-table contacts-table">
            <thead>
              <tr>
                <th>Contact</th>
                <th>Stage</th>
                <th>First inquiry</th>
                <th>Customer value</th>
                <th>Conversation</th>
                <th>Source</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((c) => {
                const value = data.orders
                  .filter((o) => o.contact_id === c.id && o.status === "paid")
                  .reduce((n, o) => n + o.amount_minor, 0);
                return (
                  <tr
                    key={c.id}
                    className="clickable"
                    onClick={() => openContact(c.id)}
                  >
                    <td>
                      <div className="person-cell">
                        <Avatar name={c.name} />
                        <span>
                          <strong>{c.name}</strong>
                          <small>
                            {c.email || c.phone || "Messenger contact"}
                          </small>
                        </span>
                      </div>
                    </td>
                    <td>
                      <StageBadge stage={c.stage} />
                    </td>
                    <td>
                      {formatDate(
                        c.first_inquiry_at,
                        data.tenant.timezone,
                        "MMM d, yyyy",
                      )}
                      <small className="table-small">
                        {formatDate(
                          c.first_inquiry_at,
                          data.tenant.timezone,
                          "h:mm a",
                        )}
                      </small>
                    </td>
                    <td>
                      <strong>
                        {formatMoney(value, data.tenant.currency)}
                      </strong>
                    </td>
                    <td>
                      <Badge
                        tone={c.bot_state === "human" ? "sand" : "neutral"}
                      >
                        {c.bot_state === "human"
                          ? "Human agent"
                          : c.bot_state === "intake"
                            ? "Collecting details"
                            : c.bot_state === "faq"
                              ? "Assistant"
                              : "Paused"}
                      </Badge>
                    </td>
                    <td className="capitalize">{c.source}</td>
                    <td>
                      <IconButton
                        label={`Open ${c.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          openContact(c.id);
                        }}
                      >
                        <ChevronRight size={16} />
                      </IconButton>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!list.length && (
          <Empty
            title="Your people, all in one place"
            description="Add a contact or connect a Facebook Page to start."
            action={<Button onClick={onAdd}>Add your first contact</Button>}
          />
        )}
      </section>
    </>
  );
}
export function PipelineView() {
  const { data, mutate, openContact, openOrder } = useApp();
  const [search, setSearch] = useState("");
  const stages: { id: Stage; label: string; description: string }[] = [
    {
      id: "not_qualified",
      label: "Not qualified",
      description: "Intake in progress or not a fit yet",
    },
    {
      id: "qualified",
      label: "Qualified",
      description: "Details complete, ready for the next step",
    },
    {
      id: "converted",
      label: "Converted",
      description: "A conversation that became a customer",
    },
  ];
  async function move(id: string, stage: Stage) {
    const contact = data.contacts.find((c) => c.id === id);
    if (!contact || contact.stage === stage) return;
    if (stage === "converted") {
      openOrder(id);
      return;
    }
    try {
      await mutate("PATCH", `contacts/${id}`, { stage });
    } catch {}
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">A PLACE FOR EVERY NEXT STEP</div>
          <h1>From curious to customer.</h1>
          <p>
            Move contacts between stages. A paid order marks the conversion.
          </p>
        </div>
        <div className="input-search">
          <Search size={16} />
          <input
            placeholder="Find a contact"
            aria-label="Search pipeline"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      <div className="pipeline-grid">
        {stages.map((stage) => {
          const contacts = data.contacts.filter(
            (c) =>
              c.stage === stage.id &&
              c.name.toLowerCase().includes(search.toLowerCase()),
          );
          return (
            <section
              className={`pipeline-column ${stage.id}`}
              key={stage.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void move(e.dataTransfer.getData("text/plain"), stage.id);
              }}
            >
              <div className="pipeline-heading">
                <h2>
                  <i />
                  {stage.label}
                  <span>{contacts.length}</span>
                </h2>
                <small>{stage.description}</small>
              </div>
              <div className="pipeline-cards">
                {contacts.map((c) => (
                  <article
                    key={c.id}
                    className="pipeline-card"
                    draggable
                    onDragStart={(e) =>
                      e.dataTransfer.setData("text/plain", c.id)
                    }
                  >
                    <div className="pipeline-card-top">
                      <Avatar name={c.name} size="small" />
                      <button onClick={() => openContact(c.id)}>
                        <strong>{c.name}</strong>
                        <small>
                          {c.form_answers.interest || "New inquiry"}
                        </small>
                      </button>
                      <GripVertical size={15} />
                    </div>
                    <div className="pipeline-detail">
                      <CalendarDays size={13} />
                      {formatDate(
                        c.first_inquiry_at,
                        data.tenant.timezone,
                        "MMM d",
                      )}
                      <span>·</span>
                      {Object.keys(c.form_answers).length}/
                      {data.tenant.intake_fields.length} details
                    </div>
                    {c.objections.length > 0 && (
                      <div className="tag-list">
                        {c.objections.map((o) => (
                          <Badge tone="sand" key={o}>
                            {o}
                          </Badge>
                        ))}
                      </div>
                    )}
                    <div className="pipeline-card-bottom">
                      <span>
                        {formatMoney(
                          data.orders
                            .filter(
                              (o) =>
                                o.contact_id === c.id && o.status === "paid",
                            )
                            .reduce((n, o) => n + o.amount_minor, 0),
                          data.tenant.currency,
                        )}
                      </span>
                      <Select
                        aria-label={`Move ${c.name} to stage`}
                        value={c.stage}
                        onChange={(e) =>
                          void move(c.id, e.target.value as Stage)
                        }
                      >
                        {stages.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </article>
                ))}
                {!contacts.length && (
                  <div className="pipeline-empty">
                    A little room for the next opportunity.
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
export function OrdersView({ onAdd }: { onAdd: () => void }) {
  const { data, mutate, openContact } = useApp();
  const [status, setStatus] = useState("all");
  const orders = data.orders.filter(
    (o) => status === "all" || o.status === status,
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">CONVERSATIONS THAT BECAME SOMETHING</div>
          <h1>Good things, ordered.</h1>
          <p>Track payment, order notes, and the value of each relationship.</p>
        </div>
        <Button variant="primary" onClick={onAdd}>
          <Plus size={16} />
          Create order
        </Button>
      </div>
      <div className="list-toolbar">
        <Select
          aria-label="Filter payment status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="all">All orders</option>
          {["pending", "paid", "cancelled", "refunded"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </Select>
        <span className="muted">{orders.length} orders</span>
        <div className="toolbar-summary">
          Paid revenue{" "}
          <strong>
            {formatMoney(
              data.orders
                .filter((o) => o.status === "paid")
                .reduce((n, o) => n + o.amount_minor, 0),
              data.tenant.currency,
            )}
          </strong>
        </div>
      </div>
      <section className="panel">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Order date</th>
                <th>Inquiry cohort</th>
                <th>Amount</th>
                <th>Notes</th>
                <th>Payment status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const c = data.contacts.find((c) => c.id === o.contact_id);
                return (
                  <tr key={o.id}>
                    <td>
                      <strong>#{o.id.slice(0, 8).toUpperCase()}</strong>
                    </td>
                    <td>
                      <button
                        className="person-cell text-button"
                        onClick={() => openContact(o.contact_id)}
                      >
                        <Avatar name={c?.name || "Contact"} size="small" />
                        {c?.name || "Contact"}
                      </button>
                    </td>
                    <td>
                      {formatDate(
                        o.created_at,
                        data.tenant.timezone,
                        "MMM d, yyyy",
                      )}
                    </td>
                    <td>
                      {c
                        ? formatDate(
                            c.first_inquiry_at,
                            data.tenant.timezone,
                            "MMM d, yyyy",
                          )
                        : "—"}
                    </td>
                    <td>
                      <strong>{formatMoney(o.amount_minor, o.currency)}</strong>
                    </td>
                    <td className="notes-cell">{o.notes || "—"}</td>
                    <td>
                      <Select
                        aria-label={`Payment status for order ${o.id}`}
                        value={o.status}
                        onChange={(e) => {
                          void mutate("PATCH", `orders/${o.id}`, {
                            status: e.target.value,
                          }).catch(() => {});
                        }}
                      >
                        {["pending", "paid", "cancelled", "refunded"].map(
                          (s) => (
                            <option key={s}>{s}</option>
                          ),
                        )}
                      </Select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!orders.length && (
          <Empty
            title="Your next order starts with a conversation"
            description="Create an order to record the amount, payment status, and delivery notes."
            action={<Button onClick={onAdd}>Create order</Button>}
          />
        )}
      </section>
    </>
  );
}
export function ContactProfile({
  contact: c,
  onClose,
}: {
  contact: Contact;
  onClose: () => void;
}) {
  const { data, mutate, busy, openOrder, notify } = useApp();
  const [tab, setTab] = useState("overview"),
    [notes, setNotes] = useState(c.notes),
    [objections, setObjections] = useState(c.objections.join(", ")),
    [answers, setAnswers] = useState(c.form_answers),
    [zone, setZone] = useState(c.timezone || data.tenant.timezone);
  useEffect(() => {
    setNotes(c.notes);
    setObjections(c.objections.join(", "));
    setAnswers(c.form_answers);
    setZone(c.timezone || data.tenant.timezone);
  }, [c.id]);
  const orders = data.orders.filter((o) => o.contact_id === c.id),
    paid = orders.filter((o) => o.status === "paid"),
    messages = data.messages.filter((m) => m.contact_id === c.id),
    times = bestContactTimes(messages, c.timezone || data.tenant.timezone),
    touchpoints = data.touchpoints.filter((t) => t.contact_id === c.id);
  const duration = c.converted_at
    ? Math.max(
        0,
        DateTime.fromISO(c.converted_at).diff(
          DateTime.fromISO(c.first_inquiry_at),
          "hours",
        ).hours,
      )
    : null;
  const cohort = cohortMetrics(
    dayKey(c.first_inquiry_at, data.tenant.timezone),
    data.contacts,
    data.orders,
    data.spend,
    data.tenant,
    c.source_ad_id || undefined,
  );
  const value = paid.reduce((n, o) => n + o.amount_minor, 0);
  async function runAutofill() {
    try {
      const result = await mutate("POST", `contacts/${c.id}/autofill`, {});
      setAnswers(result.contact.form_answers);
      const count = Object.keys(result.updated).length;
      notify(
        count
          ? `Filled ${count} ${count === 1 ? "detail" : "details"} from customer messages.`
          : result.review?.length
            ? "Some details need clarification. Saved values were preserved."
            : "No additional supported details found.",
      );
    } catch {}
  }
  return (
    <Modal title="Contact profile" onClose={onClose} wide>
      <div className="profile-hero">
        <Avatar name={c.name} size="large" />
        <div>
          <h2>{c.name}</h2>
          <div className="profile-contact-line">
            {c.email && (
              <span>
                <Mail size={13} />
                {c.email}
              </span>
            )}
            {c.phone && (
              <span>
                <Phone size={13} />
                {c.phone}
              </span>
            )}
          </div>
          <div className="profile-badges">
            <StageBadge stage={c.stage} />
            <Badge tone={c.bot_state === "human" ? "sand" : "neutral"}>
              {c.bot_state === "human"
                ? "With a human"
                : c.bot_state === "stopped"
                  ? "Assistant paused"
                  : "Assistant enabled"}
            </Badge>
            {c.opted_out && <Badge tone="red">Opted out</Badge>}
          </div>
        </div>
        <Button
          disabled={busy || !data.integrations.jev || !messages.length}
          title={
            !data.integrations.jev
              ? "Connect Jev to autofill customer details"
              : !messages.length
                ? "No customer messages to read yet"
                : "Fill missing details from customer messages"
          }
          onClick={() => void runAutofill()}
        >
          <Sparkles size={15} />
          Autofill details
        </Button>
        <Button variant="primary" onClick={() => openOrder(c.id)}>
          <Plus size={15} />
          Create order
        </Button>
      </div>
      <div className="profile-stats">
        <div>
          <span>Customer total value</span>
          <strong>{formatMoney(value, data.tenant.currency)}</strong>
        </div>
        <div>
          <span>First inquiry</span>
          <strong>
            {formatDate(
              c.first_inquiry_at,
              data.tenant.timezone,
              "MMM d, h:mm a",
            )}
          </strong>
        </div>
        <div>
          <span>First conversion</span>
          <strong>
            {c.converted_at
              ? formatDate(
                  c.converted_at,
                  data.tenant.timezone,
                  "MMM d, h:mm a",
                )
              : "Not yet"}
          </strong>
        </div>
        <div>
          <span>Inquiry to conversion</span>
          <strong>
            {duration === null
              ? "—"
              : duration < 24
                ? `${duration.toFixed(1)} hours`
                : `${(duration / 24).toFixed(1)} days`}
          </strong>
        </div>
      </div>
      <div className="tabs">
        {["overview", "intake", "conversation", "orders"].map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {t === "intake"
              ? "Intake answers"
              : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {tab === "overview" && (
        <div className="profile-content">
          <div className="profile-main">
            <div className="subsection">
              <h3>
                <Clock3 size={17} />A better time to connect
              </h3>
              <p className="muted">
                Top observed hours in {c.timezone || data.tenant.timezone}.
                Ranked by distinct active days, not message bursts.
              </p>
              {times.length ? (
                <div className="contact-times">
                  {times.map((time, i) => (
                    <div className="contact-time" key={time.hour}>
                      <span>{i + 1}</span>
                      <strong>{time.label}</strong>
                      <small>
                        {time.count} active {time.count === 1 ? "day" : "days"}
                      </small>
                      <Badge
                        tone={
                          time.confidence === "high"
                            ? "green"
                            : time.confidence === "medium"
                              ? "blue"
                              : "sand"
                        }
                      >
                        {time.confidence} evidence
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">
                  No inbound message history yet. No reliable contact times
                  available.
                </p>
              )}
              <Field
                label="Contact timezone"
                hint="Set a known customer timezone; otherwise the workspace timezone is used."
              >
                <input
                  value={zone}
                  onChange={(e) => setZone(e.target.value)}
                  placeholder="Asia/Manila"
                />
              </Field>
            </div>
            <div className="subsection">
              <h3>
                <StickyNote size={17} />A little context for the next
                conversation
              </h3>
              <Field label="Internal notes">
                <textarea
                  rows={4}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Preferences, context, and things worth remembering…"
                />
              </Field>
              <Field label="Objections" hint="Separate objections with commas.">
                <input
                  value={objections}
                  onChange={(e) => setObjections(e.target.value)}
                  placeholder="price, timing, delivery"
                />
              </Field>
              <Button
                disabled={busy}
                onClick={() => {
                  void mutate("PATCH", `contacts/${c.id}`, {
                    notes,
                    objections: objections
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                    timezone: zone,
                  })
                    .then(() => notify("Contact context saved."))
                    .catch(() => {});
                }}
              >
                Save contact context
              </Button>
            </div>
          </div>
          <aside className="profile-aside">
            <div className="profile-aside-card">
              <h3>Conversation care</h3>
              <p>
                {c.bot_state === "human"
                  ? "Your team is in control. The assistant is paused for this contact."
                  : "The assistant collects details, answers supported FAQs, and asks for help when needed."}
              </p>
              <Button
                onClick={() => {
                  void mutate("PATCH", `contacts/${c.id}`, {
                    bot_state:
                      c.bot_state === "human" || c.bot_state === "stopped"
                        ? "intake"
                        : "human",
                  }).catch(() => {});
                }}
              >
                {c.bot_state === "human" || c.bot_state === "stopped" ? (
                  <Play size={14} />
                ) : (
                  <UserRound size={14} />
                )}{" "}
                {c.bot_state === "human" || c.bot_state === "stopped"
                  ? "Resume assistant"
                  : "Take over conversation"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  void mutate("PATCH", `contacts/${c.id}`, {
                    opted_out: !c.opted_out,
                    ...(!c.opted_out ? { bot_state: "stopped" } : {}),
                  }).catch(() => {});
                }}
              >
                {c.opted_out ? "Record renewed consent" : "Record opt-out"}
              </Button>
            </div>
            <div className="profile-aside-card">
              <h3>Acquisition context</h3>
              <dl>
                <dt>Inquiry cohort</dt>
                <dd>
                  {formatDate(
                    c.first_inquiry_at,
                    data.tenant.timezone,
                    "MMM d, yyyy",
                  )}
                </dd>
                <dt>Source creative</dt>
                <dd>
                  {data.ads.find((a) => a.id === c.source_ad_id)?.name ||
                    "Unattributed"}
                </dd>
                <dt>Cohort ad spend</dt>
                <dd>{formatMoney(cohort.spend, data.tenant.currency)}</dd>
                <dt>Cohort CPA</dt>
                <dd>{formatMoney(cohort.cpa, data.tenant.currency)}</dd>
              </dl>
              <small className="muted">
                Shared cohort spend ÷ unique paying customers. Later buyers
                update this cost.
              </small>
            </div>
            <div className="profile-aside-card">
              <div className="inline-heading">
                <h3>7-day touchpoints</h3>
                <Button
                  variant="ghost"
                  onClick={() => {
                    void mutate("POST", "touchpoints/plan", {
                      contact_id: c.id,
                    }).catch(() => {});
                  }}
                >
                  Plan
                </Button>
              </div>
              {touchpoints.map((t) => (
                <div className="profile-touchpoint" key={t.id}>
                  <span>
                    <strong>Day {t.day_number}</strong>
                    <small>
                      {formatDate(t.scheduled_at, data.tenant.timezone)}
                    </small>
                    <small>{t.reason}</small>
                  </span>
                  <Badge
                    tone={
                      t.status === "sent"
                        ? "green"
                        : t.status === "needs_human"
                          ? "sand"
                          : "neutral"
                    }
                  >
                    {t.status.replaceAll("_", " ")}
                  </Badge>
                  {["scheduled", "needs_human", "blocked"].includes(
                    t.status,
                  ) && (
                    <IconButton
                      label="Cancel touchpoint"
                      onClick={() => {
                        void mutate("PATCH", `touchpoints/${t.id}`, {}).catch(
                          () => {},
                        );
                      }}
                    >
                      <X size={13} />
                    </IconButton>
                  )}
                </div>
              ))}
              {!touchpoints.length && (
                <p className="muted">No touchpoints scheduled.</p>
              )}
            </div>
          </aside>
        </div>
      )}
      {tab === "intake" && (
        <div className="form-stack profile-tab-content">
          <p className="muted">
            These answers stay with the contact and feed stage-level reporting.
          </p>
          <p className="muted">
            Jev fills supported details from customer messages and keeps
            existing answers. Required details still missing will be asked in
            the conversation.
          </p>
          {data.tenant.intake_fields.map((field) => (
            <Field
              key={field.key}
              label={field.label}
              hint={field.required ? "Required" : ""}
            >
              {field.type === "choice" ? (
                <Select
                  value={answers[field.key] || ""}
                  onChange={(e) =>
                    setAnswers({ ...answers, [field.key]: e.target.value })
                  }
                >
                  <option value="">Choose an answer</option>
                  {field.options?.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </Select>
              ) : (
                <input
                  value={answers[field.key] || ""}
                  onChange={(e) =>
                    setAnswers({ ...answers, [field.key]: e.target.value })
                  }
                />
              )}
            </Field>
          ))}
          {Object.entries(c.autofill_evidence || {}).filter(
            ([key, fact]) => c.form_answers[key] === fact.value,
          ).length > 0 && (
            <section className="autofill-evidence">
              <h3>
                <Sparkles size={16} />
                Captured from customer messages
              </h3>
              {Object.entries(c.autofill_evidence || {})
                .filter(([key, fact]) => c.form_answers[key] === fact.value)
                .map(([key, fact]) => (
                  <details key={key}>
                    <summary>
                      <span>
                        {data.tenant.intake_fields.find((f) => f.key === key)
                          ?.label || key.replaceAll("_", " ")}
                      </span>
                      <strong>{fact.value}</strong>
                    </summary>
                    <blockquote>{fact.source_text}</blockquote>
                    <p>
                      {formatDate(fact.source_sent_at, data.tenant.timezone)} ·{" "}
                      {fact.model} · {Math.round(fact.probability * 100)}% Jev
                      support score
                    </p>
                  </details>
                ))}
            </section>
          )}
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              void mutate("PATCH", `contacts/${c.id}`, {
                form_answers: answers,
              })
                .then(() => notify("Intake answers saved."))
                .catch(() => {});
            }}
          >
            Save intake answers
          </Button>
        </div>
      )}
      {tab === "conversation" && (
        <div className="profile-tab-content">
          <MessageThread contact={c} messages={messages} />
          <Composer contact={c} />
        </div>
      )}
      {tab === "orders" && (
        <div className="profile-tab-content">
          {orders.map((o) => (
            <div className="profile-order" key={o.id}>
              <span className="order-icon">
                <ShoppingBag size={19} />
              </span>
              <div>
                <strong>#{o.id.slice(0, 8).toUpperCase()}</strong>
                <small>{formatDate(o.created_at, data.tenant.timezone)}</small>
                <p>{o.notes}</p>
              </div>
              <strong>{formatMoney(o.amount_minor, o.currency)}</strong>
              <Badge
                tone={
                  o.status === "paid"
                    ? "green"
                    : o.status === "pending"
                      ? "sand"
                      : "neutral"
                }
              >
                {o.status}
              </Badge>
            </div>
          ))}
          {!orders.length && (
            <Empty
              title="A little room for their first order"
              description="Create an order when this contact is ready."
              action={
                <Button onClick={() => openOrder(c.id)}>Create order</Button>
              }
            />
          )}
        </div>
      )}
    </Modal>
  );
}
export function ContactForm({ onClose }: { onClose: () => void }) {
  const { data, mutate, busy } = useApp();
  const [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [phone, setPhone] = useState(""),
    [page, setPage] = useState(
      data.resources.find((r) => r.type === "page")?.id || "",
    ),
    [notes, setNotes] = useState("");
  return (
    <Modal
      title="Make a new connection"
      description="Start with the details you know. You can fill in the rest later."
      onClose={onClose}
    >
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await mutate("POST", "contacts", {
              name,
              email,
              phone,
              page_id: page || null,
              notes,
            });
            onClose();
          } catch {}
        }}
      >
        <Field label="Full name">
          <input
            required
            maxLength={150}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Andrea Reyes"
          />
        </Field>
        <div className="form-row">
          <Field label="Email address">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="andrea@example.com"
            />
          </Field>
          <Field label="Phone number">
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+63"
            />
          </Field>
        </div>
        <Field label="Facebook Page">
          <Select value={page} onChange={(e) => setPage(e.target.value)}>
            <option value="">No Page · manual contact</option>
            {data.resources
              .filter((r) => r.type === "page")
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Notes">
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything useful for the next conversation"
          />
        </Field>
        <div className="form-actions">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy}>
            Add contact
          </Button>
        </div>
      </form>
    </Modal>
  );
}
export function OrderForm({
  contactId,
  onClose,
}: {
  contactId?: string;
  onClose: () => void;
}) {
  const { data, mutate, busy } = useApp();
  const [id, setId] = useState(contactId || ""),
    [amount, setAmount] = useState(""),
    [status, setStatus] = useState("pending"),
    [notes, setNotes] = useState("");
  return (
    <Modal
      title="A conversation becomes an order"
      description="Paid orders update customer value and the original inquiry cohort."
      onClose={onClose}
    >
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await mutate("POST", "orders", {
              contact_id: id,
              amount: Number(amount),
              status,
              notes,
            });
            onClose();
          } catch {}
        }}
      >
        <Field label="Customer">
          <Select required value={id} onChange={(e) => setId(e.target.value)}>
            <option value="">Select a contact</option>
            {data.contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="form-row">
          <Field label={`Order amount (${data.tenant.currency})`}>
            <input
              type="number"
              min="0.01"
              max="1000000000"
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </Field>
          <Field label="Payment status">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="pending">Pending payment</option>
              <option value="paid">Paid</option>
            </Select>
          </Field>
        </div>
        <Field label="Order notes">
          <textarea
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Products, quantities, delivery details, or a gift note"
          />
        </Field>
        <div className="form-actions">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy}>
            Create order
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function InboxView() {
  const { data, openContact, mutate } = useApp();
  const [id, setId] = useState<string | null>(null),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all");
  const list = data.contacts.filter(
    (c) =>
      (filter === "all" || c.bot_state === filter) &&
      c.name.toLowerCase().includes(search.toLowerCase()),
  );
  const c = list.find((c) => c.id === id) || list[0];
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">GIVE EVERY CONVERSATION A LITTLE CARE</div>
          <h1>Good to hear from you.</h1>
          <p>
            The assistant starts the conversation. Your team brings the human
            touch.
          </p>
        </div>
        <Badge tone="sand">
          {data.contacts.filter((c) => c.bot_state === "human").length} waiting
          for a person
        </Badge>
      </div>
      <div className="inbox-layout panel">
        <aside className="inbox-list">
          <div className="inbox-list-header">
            <div className="input-search">
              <Search size={15} />
              <input
                aria-label="Search conversations"
                placeholder="Find a conversation"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="segmented">
              <button
                className={filter === "all" ? "selected" : ""}
                onClick={() => setFilter("all")}
              >
                All
              </button>
              <button
                className={filter === "human" ? "selected" : ""}
                onClick={() => setFilter("human")}
              >
                Needs a person
              </button>
            </div>
          </div>
          <div className="inbox-list-scroll">
            {list.map((contact) => {
              const last = data.messages
                .filter((m) => m.contact_id === contact.id)
                .at(-1);
              return (
                <button
                  className={`inbox-list-item ${c?.id === contact.id ? "selected" : ""}`}
                  key={contact.id}
                  onClick={() => setId(contact.id)}
                >
                  <Avatar name={contact.name} />
                  <span>
                    <strong>
                      {contact.name}
                      <small>
                        {formatDate(
                          contact.last_inbound_at || contact.first_inquiry_at,
                          data.tenant.timezone,
                          "MMM d",
                        )}
                      </small>
                    </strong>
                    <p>{last?.text || "No messages yet"}</p>
                    <Badge
                      tone={contact.bot_state === "human" ? "sand" : "neutral"}
                    >
                      {contact.bot_state === "human"
                        ? "Human agent"
                        : contact.bot_state === "intake"
                          ? "Intake"
                          : "Assistant"}
                    </Badge>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>
        {c ? (
          <div className="inbox-conversation">
            <div className="conversation-header">
              <Avatar name={c.name} />
              <div>
                <h3>{c.name}</h3>
                <span>
                  Messenger · <StageBadge stage={c.stage} />
                </span>
              </div>
              <Button
                onClick={() => {
                  void mutate("PATCH", `contacts/${c.id}`, {
                    bot_state: c.bot_state === "human" ? "intake" : "human",
                  }).catch(() => {});
                }}
              >
                {c.bot_state === "human" ? (
                  <Play size={14} />
                ) : (
                  <Pause size={14} />
                )}{" "}
                {c.bot_state === "human" ? "Resume assistant" : "Take over"}
              </Button>
              <IconButton
                label="Open contact profile"
                onClick={() => openContact(c.id)}
              >
                <UserRound size={18} />
              </IconButton>
            </div>
            <MessageThread
              contact={c}
              messages={data.messages.filter((m) => m.contact_id === c.id)}
            />
            <Composer contact={c} />
          </div>
        ) : (
          <Empty
            title="A little quiet for now"
            description="Conversations from your connected Pages will appear here."
          />
        )}
      </div>
    </>
  );
}
function MessageThread({
  contact,
  messages,
}: {
  contact: Contact;
  messages: Message[];
}) {
  const { data } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [messages.length, contact.id]);
  return (
    <div className="message-thread" ref={ref}>
      {messages.length ? (
        <>
          <div className="conversation-start">
            <span>
              {formatDate(
                contact.first_inquiry_at,
                data.tenant.timezone,
                "MMMM d, yyyy",
              )}
            </span>
            <p>This connection started with a {contact.source} inquiry.</p>
          </div>
          {messages.map((m) => (
            <div key={m.id} className={`message-row ${m.direction}`}>
              <div className="message-bubble">
                {m.text && <p>{m.text}</p>}
                {m.media_url &&
                  (m.media_type === "image" ? (
                    <a href={m.media_url} target="_blank" rel="noreferrer">
                      <img src={m.media_url} alt="Conversation attachment" />
                    </a>
                  ) : (
                    <a href={m.media_url} target="_blank" rel="noreferrer">
                      <Paperclip size={14} />
                      Open {m.media_type || "attachment"}
                    </a>
                  ))}
                <small>
                  {m.sender === "bot"
                    ? "Mori assistant"
                    : m.sender === "agent"
                      ? "Human agent"
                      : contact.name.split(" ")[0]}{" "}
                  · {formatDate(m.sent_at, data.tenant.timezone, "h:mm a")}
                  {m.direction === "outbound" && (
                    <span>
                      {m.status === "sent" ? (
                        <CheckCheck size={12} />
                      ) : (
                        m.status
                      )}
                    </span>
                  )}
                </small>
              </div>
            </div>
          ))}
        </>
      ) : (
        <Empty
          title="Their story starts here"
          description="This contact has no message history yet."
        />
      )}
    </div>
  );
}
function Composer({ contact }: { contact: Contact }) {
  const { mutate, upload, busy, notify } = useApp();
  const [text, setText] = useState(""),
    [support, setSupport] = useState(false),
    [media, setMedia] = useState<{
      url: string;
      type: string;
      name: string;
    } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const permission = messagePermission(contact, "agent");
  useEffect(() => {
    setText("");
    setSupport(false);
    setMedia(null);
  }, [contact.id]);
  return (
    <form
      className="message-composer"
      onSubmit={async (e) => {
        e.preventDefault();
        if (media && text.trim()) {
          notify("Send the attachment and text separately.", "error");
          return;
        }
        try {
          await mutate("POST", "messages", {
            contact_id: contact.id,
            text,
            media: media ? { url: media.url, type: media.type } : undefined,
            human_support: support,
          });
          setText("");
          setMedia(null);
        } catch {}
      }}
    >
      {!permission.allowed && (
        <div className="composer-notice">
          <Clock3 size={14} />
          {permission.reason}
        </div>
      )}
      {permission.tag && (
        <label className="check-label">
          <input
            type="checkbox"
            checked={support}
            onChange={(e) => setSupport(e.target.checked)}
          />
          This is a manual reply to a support issue. Use HUMAN_AGENT.
        </label>
      )}
      {media && (
        <div className="attachment-chip">
          <Paperclip size={13} />
          {media.name}
          <button
            type="button"
            onClick={() => setMedia(null)}
            aria-label="Remove attachment"
          >
            <X size={13} />
          </button>
        </div>
      )}
      <textarea
        value={text}
        maxLength={2000}
        rows={2}
        onChange={(e) => setText(e.target.value)}
        placeholder="Write a thoughtful reply…"
        aria-label="Reply message"
      />
      <div className="composer-actions">
        <input
          ref={file}
          type="file"
          hidden
          accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,audio/mpeg,audio/mp4,audio/wav,application/pdf"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f)
              try {
                setMedia(await upload("media", f));
              } catch {}
            e.target.value = "";
          }}
        />
        <IconButton
          label="Attach media"
          type="button"
          onClick={() => file.current?.click()}
        >
          <Paperclip size={18} />
        </IconButton>
        <small>Replying as a human · assistant pauses after send</small>
        <Button
          variant="primary"
          disabled={
            busy ||
            (!text.trim() && !media) ||
            !permission.allowed ||
            !!(permission.tag && !support)
          }
        >
          <Send size={15} />
          Send reply
        </Button>
      </div>
    </form>
  );
}
