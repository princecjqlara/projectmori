"use client";
import { useState, useRef } from "react";
import { DateTime } from "luxon";
import {
  Plus,
  RefreshCw,
  Layers3,
  ShieldCheck,
  Info,
  Upload,
  FileText,
  Trash2,
  BookOpen,
  Search,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  UsersRound,
  Link2,
  Facebook,
  ChevronDown,
  SlidersHorizontal,
  Save,
  KeyRound,
  Paperclip,
  X,
  Pause,
  Clock3,
  Database,
  Cloud,
  Settings2,
  UserRound,
  ExternalLink,
} from "lucide-react";
import { useApp } from "./context";
import {
  Button,
  IconButton,
  Badge,
  Select,
  Field,
  Modal,
  Avatar,
  Empty,
  formatMoney,
  formatPercent,
  formatDate,
} from "./ui";
import { evaluateAd, aggregateMetrics, cohortMetrics } from "@/lib/domain";
import type { Member, IntakeField } from "@/lib/types";
import { supabase } from "@/lib/supabase";

export function AdsView() {
  const { data, mutate, busy, notify } = useApp();
  const [filter, setFilter] = useState("all");
  const admin = data.tenant.role !== "member";
  const today = DateTime.now().setZone(data.tenant.timezone).toISODate()!;
  const month = DateTime.now().setZone(data.tenant.timezone).startOf("month");
  const ads = data.ads.filter((a) => filter === "all" || a.status === filter);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">GIVE GOOD CREATIVES ROOM TO WORK</div>
          <h1>A little more intention. Less wasted spend.</h1>
          <p>
            Monitor creative performance and pause eligible underperformers
            using real order value.
          </p>
        </div>
        <Button
          disabled={busy || !admin}
          onClick={() => {
            void mutate("POST", "facebook/sync", {})
              .then((r) =>
                notify(
                  r.warnings?.length
                    ? r.warnings.join(" ")
                    : `Synced ${r.ads} ads and ${r.days} daily spend records.`,
                ),
              )
              .catch(() => {});
          }}
        >
          <RefreshCw size={15} className={busy ? "spin" : ""} />
          Sync from Meta
        </Button>
      </div>
      <div className="automation-banner">
        <span className="automation-icon">
          <ShieldCheck size={25} />
        </span>
        <div>
          <h3>Decisions grounded in your business.</h3>
          <p>
            Three completed days of average spend × your paid-order AOV
            threshold. Ads are only paused when their inquiry cohorts are
            unprofitable. No paid-order AOV means no automatic actions.
          </p>
        </div>
        <Badge tone={data.tenant.automation_enabled ? "green" : "sand"}>
          {data.tenant.automation_enabled
            ? "Automation enabled"
            : "Automation paused"}
        </Badge>
      </div>
      <div className="list-toolbar">
        <Select
          aria-label="Filter ad status"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">All creatives</option>
          <option value="ACTIVE">Active</option>
          <option value="PAUSED">Paused</option>
        </Select>
        <span className="muted">
          {ads.length} creatives · this month’s inquiry cohorts
        </span>
      </div>
      <div className="ads-grid">
        {ads.map((ad, i) => {
          const decision = evaluateAd(
            ad,
            data.spend,
            data.contacts,
            data.orders,
            data.tenant,
            today,
          );
          const totals = aggregateMetrics(
            Array.from({ length: month.daysInMonth || 30 }, (_, d) =>
              cohortMetrics(
                month.set({ day: d + 1 }).toISODate()!,
                data.contacts,
                data.orders,
                data.spend,
                data.tenant,
                ad.id,
              ),
            ),
          );
          return (
            <article className="ad-card panel" key={ad.id}>
              <div className={`ad-art art-${i % 4}`}>
                {ad.thumbnail_url ? (
                  <img src={ad.thumbnail_url} alt={ad.creative_name} />
                ) : (
                  <div className="creative-placeholder"><Layers3 size={30} /><span>Preview unavailable</span></div>
                )}
                <Badge tone={ad.status === "ACTIVE" ? "green" : "neutral"}>
                  {ad.status === "ACTIVE" ? "Active" : "Paused"}
                </Badge>
              </div>
              <div className="ad-card-body">
                <h3>{ad.name}</h3>
                <small className="muted">{ad.creative_name}</small>
                <div className="ad-metrics">
                  <span>
                    Ad spend
                    <strong>
                      {formatMoney(totals.spend, data.tenant.currency)}
                    </strong>
                  </span>
                  <span>
                    Revenue
                    <strong>
                      {formatMoney(totals.revenue, data.tenant.currency)}
                    </strong>
                  </span>
                  <span>
                    ROAS
                    <strong>
                      {totals.roas === null
                        ? "—"
                        : `${totals.roas.toFixed(2)}×`}
                    </strong>
                  </span>
                  <span>
                    Inquiries<strong>{totals.inquiries}</strong>
                  </span>
                  <span>
                    Qualified<strong>{totals.qualified}</strong>
                  </span>
                  <span>
                    Converted<strong>{totals.converted}</strong>
                  </span>
                  <span>
                    Not qualified<strong>{totals.notQualified}</strong>
                  </span>
                  <span>
                    Customers<strong>{totals.customers}</strong>
                  </span>
                  <span>
                    CPA
                    <strong>
                      {formatMoney(totals.cpa, data.tenant.currency)}
                    </strong>
                  </span>
                </div>
                <div
                  className={`ad-decision ${decision.action === "pause" ? "warning" : ""}`}
                >
                  <ShieldCheck size={16} />
                  <span>
                    <strong>
                      {decision.action === "hold"
                        ? "Waiting for enough evidence"
                        : decision.action === "pause"
                          ? "Eligible to pause"
                          : "Room to keep learning"}
                    </strong>
                    <small>{decision.reason}</small>
                  </span>
                </div>
                <div className="ad-rule-detail">
                  <span>
                    Paid-order AOV
                    <strong>
                      {formatMoney(decision.aov, data.tenant.currency)}
                    </strong>
                  </span>
                  <span>
                    3-day avg. spend
                    <strong>
                      {formatMoney(decision.averageSpend, data.tenant.currency)}
                    </strong>
                  </span>
                </div>
                <label className="toggle-row">
                  <span>Allow automatic pause</span>
                  <input
                    role="switch"
                    aria-label={`Allow automatic pause for ${ad.name}`}
                    type="checkbox"
                    checked={ad.automation_enabled}
                    disabled={busy || !admin}
                    onChange={(e) => {
                      void mutate("PATCH", `ads/${ad.id}`, {
                        automation_enabled: e.target.checked,
                      }).catch(() => {});
                    }}
                  />
                  <span className="toggle-visual" />
                </label>
              </div>
            </article>
          );
        })}
      </div>
      {!ads.length && (
        <section className="panel">
          <Empty
            title="Give your next creative a little room"
            description="Connect a Facebook ad account in Settings, then sync its campaigns and daily spend."
          />
        </section>
      )}
    </>
  );
}

export function KnowledgeView() {
  const { data, mutate, upload, busy, notify } = useApp();
  const [faqOpen, setFaqOpen] = useState(false),
    [question, setQuestion] = useState(""),
    [answer, setAnswer] = useState<{
      answer: string | null;
      source: string | null;
      reason: string;
    } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const admin = data.tenant.role !== "member";
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            GIVE YOUR ASSISTANT SOMETHING TO LEARN FROM
          </div>
          <h1>The right answer starts here.</h1>
          <p>
            Approved knowledge for more helpful conversations and more confident
            handoffs.
          </p>
        </div>
        <Button
          variant="primary"
          disabled={!admin}
          onClick={() => setFaqOpen(true)}
        >
          <Plus size={16} />
          Add FAQ
        </Button>
      </div>
      <div className="knowledge-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Knowledge library</h2>
              <p>Files are extracted, split, and indexed automatically.</p>
            </div>
            <Badge tone="green">
              {data.documents.filter((d) => d.status === "ready").length} ready
            </Badge>
          </div>
          <input
            ref={file}
            type="file"
            hidden
            accept=".pdf,.docx,.txt,.md,.csv"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f)
                try {
                  const r = await upload("knowledge", f);
                  notify(
                    r.status === "failed"
                      ? r.error
                      : `${f.name} is ready. ${r.chunk_count} passages indexed.`,
                    r.status === "failed" ? "error" : "success",
                  );
                } catch {}
              e.target.value = "";
            }}
          />
          <button
            className="upload-zone"
            disabled={busy || !admin}
            onClick={() => file.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={async (e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f && admin)
                try {
                  const r = await upload("knowledge", f);
                  notify(
                    r.error || "Your knowledge file is ready.",
                    r.error ? "error" : "success",
                  );
                } catch {}
            }}
          >
            <span>
              <Upload size={23} />
            </span>
            <strong>
              {busy
                ? "Preparing your knowledge…"
                : "Drop a little knowledge here"}
            </strong>
            <p>Choose a file, or drag it into this space.</p>
            <small>PDF, DOCX, TXT, Markdown, CSV · up to 10 MB</small>
          </button>
          <div className="document-list">
            {data.documents.map((doc) => (
              <div className="document-row" key={doc.id}>
                <span className="document-icon">
                  <FileText size={20} />
                </span>
                <div>
                  <strong>{doc.name}</strong>
                  <small>
                    {doc.status === "ready"
                      ? `${doc.chunk_count} indexed passages`
                      : doc.error || "Extracting and indexing…"}{" "}
                    ·{" "}
                    {formatDate(doc.created_at, data.tenant.timezone, "MMM d")}
                  </small>
                </div>
                <Badge
                  tone={
                    doc.status === "ready"
                      ? "green"
                      : doc.status === "failed"
                        ? "red"
                        : "sand"
                  }
                >
                  {doc.status}
                </Badge>
                {admin && (
                  <IconButton
                    label={`Remove ${doc.name}`}
                    onClick={() => {
                      void mutate("DELETE", `knowledge/${doc.id}`).catch(
                        () => {},
                      );
                    }}
                  >
                    <Trash2 size={15} />
                  </IconButton>
                )}
              </div>
            ))}
          </div>
          <div className="library-note">
            <ShieldCheck size={16} />
            <span>
              Answers come from your approved content. When a question needs
              more context, a person takes over.
            </span>
          </div>
        </section>
        <section className="panel knowledge-test">
          <div className="panel-heading">
            <div>
              <h2>A little test conversation</h2>
              <p>See which approved answer your assistant would choose.</p>
            </div>
            <Sparkles size={19} />
          </div>
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                setAnswer(
                  await mutate("POST", "knowledge/search", { question }),
                );
              } catch {}
            }}
          >
            <Field label="Ask a customer question">
              <textarea
                rows={4}
                required
                minLength={2}
                maxLength={2000}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="e.g. How long does delivery take?"
              />
            </Field>
            <Button disabled={busy} type="submit">
              <Search size={15} />
              {busy ? "Finding an approved answer…" : "Find an answer"}
            </Button>
          </form>
          {answer && (
            <div className="knowledge-answer">
              <Badge tone={answer.answer ? "green" : "sand"}>
                {answer.answer ? "Supported answer" : "Human handoff"}
              </Badge>
              <p>{answer.answer || answer.reason}</p>
              {answer.source && (
                <small>
                  <BookOpen size={13} />
                  {answer.source}
                </small>
              )}
            </div>
          )}
          <div className="knowledge-status">
            <span>
              <span
                className={`connection-dot ${data.integrations.jev ? "connected" : ""}`}
              />
              Jev decisions
            </span>
            <Badge tone={data.integrations.jev ? "green" : "sand"}>
              {data.integrations.jev ? "Connected" : "API key needed"}
            </Badge>
            <span>
              <Database size={13} />
              Retrieval
            </span>
            <small>
              {data.integrations.embeddings
                ? "Hybrid text + vector"
                : "Indexed full-text passages"}
            </small>
          </div>
        </section>
      </div>
      <section className="panel faq-panel">
        <div className="panel-heading">
          <div>
            <h2>A few frequently asked things</h2>
            <p>
              Jev chooses an approved answer when the question fits with enough
              certainty.
            </p>
          </div>
          <span className="muted">{data.faqs.length} answers</span>
        </div>
        {data.faqs.map((faq) => (
          <details key={faq.id} className="faq-item">
            <summary>
              <MessageCircleIcon />
              <strong>{faq.question}</strong>
              {faq.media_url && <Paperclip size={14} />}
              <ChevronDown size={17} />
            </summary>
            <div className="faq-answer">
              <p>{faq.answer}</p>
              {faq.media_url && (
                <a href={faq.media_url} target="_blank" rel="noreferrer">
                  Open attached media
                </a>
              )}
              {admin && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    void mutate("DELETE", `faqs/${faq.id}`).catch(() => {});
                  }}
                >
                  <Trash2 size={14} />
                  Remove FAQ
                </Button>
              )}
            </div>
          </details>
        ))}
        {!data.faqs.length && (
          <Empty
            title="Start with the questions you hear most"
            description="Add clear answers about products, delivery, payment, and your business."
          />
        )}
      </section>
      {faqOpen && <FaqForm onClose={() => setFaqOpen(false)} />}
    </>
  );
}
function MessageCircleIcon() {
  return <BookOpen size={16} />;
}
function FaqForm({ onClose }: { onClose: () => void }) {
  const { mutate, upload, busy } = useApp();
  const [question, setQuestion] = useState(""),
    [answer, setAnswer] = useState(""),
    [media, setMedia] = useState<{
      url: string;
      type: string;
      name: string;
    } | null>(null);
  return (
    <Modal
      title="A helpful answer, ready to go"
      description="Write an approved response that can be sent directly to a customer."
      onClose={onClose}
    >
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await mutate("POST", "faqs", {
              question,
              answer,
              media_url: media?.url,
              media_type: media?.type,
            });
            onClose();
          } catch {}
        }}
      >
        <Field label="Customer question">
          <input
            required
            minLength={3}
            maxLength={1000}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="What payment methods do you accept?"
          />
        </Field>
        <Field label="Approved answer">
          <textarea
            required
            maxLength={10000}
            rows={6}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
        </Field>
        <Field
          label="Optional media"
          hint="Stored in Cloudinary and sent with this answer."
        >
          <input
            type="file"
            accept="image/*,video/mp4,audio/mpeg,application/pdf"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f)
                try {
                  setMedia(await upload("media", f));
                } catch {}
            }}
          />
        </Field>
        {media && <Badge tone="green">{media.name}</Badge>}
        <div className="form-actions">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy}>
            Save FAQ
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function TeamView() {
  const { data } = useApp();
  const [edit, setEdit] = useState<Member | null | undefined>(undefined);
  const admin = data.tenant.role !== "member";
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">GROW TOGETHER</div>
          <h1>A good team makes all the difference.</h1>
          <p>The right people, with the right Pages and ad accounts.</p>
        </div>
        <Button
          variant="primary"
          disabled={!admin}
          onClick={() => setEdit(null)}
        >
          <Plus size={16} />
          Add teammate
        </Button>
      </div>
      <div className="role-grid">
        {[
          {
            role: "Head",
            text: "The full picture. Manage workspaces, administrators, connections, and business settings.",
            icon: ShieldCheck,
          },
          {
            role: "Admin",
            text: "Connect accounts, manage members, assign resources, and keep the workspace running.",
            icon: Settings2,
          },
          {
            role: "Member",
            text: "Work with assigned Pages and ad accounts. Reporting follows the same access.",
            icon: UserRound,
          },
        ].map((r) => (
          <div className="role-card panel" key={r.role}>
            <r.icon size={22} />
            <h3>{r.role}</h3>
            <p>{r.text}</p>
          </div>
        ))}
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>People in your corner</h2>
            <p>
              {data.members.length} teammates in {data.tenant.name}
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Teammate</th>
                <th>Role</th>
                <th>Assigned Pages</th>
                <th>Ad accounts</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.members.map((member) => (
                <tr key={member.user_id}>
                  <td>
                    <div className="person-cell">
                      <Avatar name={member.name} />
                      <span>
                        <strong>{member.name}</strong>
                        <small>{member.email}</small>
                      </span>
                    </div>
                  </td>
                  <td>
                    <Badge
                      tone={
                        member.role === "head"
                          ? "green"
                          : member.role === "admin"
                            ? "blue"
                            : "neutral"
                      }
                    >
                      {member.role}
                    </Badge>
                  </td>
                  <td>
                    <div className="tag-list">
                      {member.role !== "member" ? (
                        <span className="muted">All workspace Pages</span>
                      ) : (
                        data.resources
                          .filter(
                            (r) =>
                              r.type === "page" &&
                              member.assignments.includes(r.id),
                          )
                          .map((r) => <Badge key={r.id}>{r.name}</Badge>)
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="tag-list">
                      {member.role !== "member" ? (
                        <span className="muted">All workspace ad accounts</span>
                      ) : (
                        data.resources
                          .filter(
                            (r) =>
                              r.type === "ad_account" &&
                              member.assignments.includes(r.id),
                          )
                          .map((r) => <Badge key={r.id}>{r.name}</Badge>)
                      )}
                    </div>
                  </td>
                  <td>
                    {admin &&
                      member.role !== "head" &&
                      (data.tenant.role === "head" ||
                        member.role === "member") && (
                        <Button onClick={() => setEdit(member)}>
                          Manage access
                        </Button>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {edit !== undefined && (
        <MemberForm member={edit} onClose={() => setEdit(undefined)} />
      )}
    </>
  );
}
function MemberForm({
  member,
  onClose,
}: {
  member: Member | null;
  onClose: () => void;
}) {
  const { data, mutate, busy } = useApp();
  const [name, setName] = useState(member?.name || ""),
    [email, setEmail] = useState(member?.email || ""),
    [role, setRole] = useState(member?.role || "member"),
    [assignments, setAssignments] = useState<string[]>(
      member?.assignments || [],
    );
  return (
    <Modal
      title={member ? "A place on the team" : "Bring someone into the picture"}
      description={
        member
          ? "Update their role and the resources they can access."
          : "Existing users are added directly. New teammates receive a secure invitation email."
      }
      onClose={onClose}
    >
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await mutate(
              member ? "PATCH" : "POST",
              member ? `members/${member.user_id}` : "members",
              member
                ? { role, assignments }
                : { name, email, role, assignments },
            );
            onClose();
          } catch {}
        }}
      >
        {!member && (
          <>
            <Field label="Full name">
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Work email">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
          </>
        )}
        <Field label="Role">
          <Select
            value={role}
            onChange={(e) => setRole(e.target.value as Member["role"])}
          >
            <option value="member">Member</option>
            {data.tenant.role === "head" && (
              <option value="admin">Admin</option>
            )}
          </Select>
        </Field>
        {role === "member" && (
          <fieldset className="resource-checks">
            <legend>Assigned Pages & ad accounts</legend>
            {data.resources.map((r) => (
              <label key={r.id}>
                <input
                  type="checkbox"
                  checked={assignments.includes(r.id)}
                  onChange={(e) =>
                    setAssignments(
                      e.target.checked
                        ? [...assignments, r.id]
                        : assignments.filter((a) => a !== r.id),
                    )
                  }
                />
                <span>
                  {r.type === "page" ? (
                    <Facebook size={16} />
                  ) : (
                    <Layers3 size={16} />
                  )}
                  <strong>{r.name}</strong>
                  <small>
                    {r.type === "page" ? "Facebook Page" : "Ad account"}
                  </small>
                </span>
              </label>
            ))}
            {!data.resources.length && (
              <p className="muted">
                Connect Facebook first to assign Pages and ad accounts.
              </p>
            )}
          </fieldset>
        )}
        <div className="form-actions">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy}>
            {member ? "Save access" : "Add teammate"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function SettingsView() {
  const { data, mutate, busy, notify } = useApp();
  const admin = data.tenant.role !== "member";
  const [name, setName] = useState(data.tenant.name),
    [timezone, setTimezone] = useState(data.tenant.timezone),
    [expense, setExpense] = useState(data.tenant.expense_percent),
    [threshold, setThreshold] = useState(
      data.tenant.expense_threshold_minor / 100,
    ),
    [multiplier, setMultiplier] = useState(data.tenant.aov_spend_multiplier),
    [fields, setFields] = useState<IntakeField[]>(
      structuredClone(data.tenant.intake_fields),
    ),
    [templates, setTemplates] = useState([...data.tenant.followup_templates]);
  const [newPassword, setNewPassword] = useState("");
  async function connect() {
    try {
      const { data: session } = await supabase().auth.getSession();
      const response = await fetch("/api/facebook/connect", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.session?.access_token}`,
          "x-tenant-id": data.tenant.id,
        },
      });
      const r = await response.json();
      if (!response.ok) throw new Error(r.error);
      window.location.assign(r.url);
    } catch (e) {
      notify(
        e instanceof Error ? e.message : "Could not start Facebook connection.",
        "error",
      );
    }
  }
  async function save(body: Record<string, unknown>) {
    try {
      await mutate("PATCH", "settings", body);
      notify("Workspace settings saved.");
    } catch {}
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            MAKE A LITTLE SPACE FOR YOUR WAY OF WORKING
          </div>
          <h1>Your workspace, thoughtfully set up.</h1>
          <p>
            Connections, conversation flow, and the rules that keep your team in
            control.
          </p>
        </div>
        {!admin && (
          <Badge tone="sand">View only · ask an admin to make changes</Badge>
        )}
      </div>
      <div className="settings-layout">
        <div className="settings-main">
          <section className="panel settings-card">
            <div className="panel-heading">
              <div>
                <h2>The essentials</h2>
                <p>
                  One reporting timezone keeps inquiry cohorts and ad spend
                  aligned.
                </p>
              </div>
              <Settings2 size={20} />
            </div>
            <div className="form-stack">
              <Field label="Workspace name">
                <input
                  value={name}
                  disabled={!admin}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <div className="form-row">
                <Field label="Reporting timezone">
                  <input
                    value={timezone}
                    disabled={!admin}
                    onChange={(e) => setTimezone(e.target.value)}
                    placeholder="Asia/Manila"
                  />
                </Field>
                <Field label="Reporting currency">
                  <input value={data.tenant.currency} disabled />
                </Field>
              </div>
              <Button
                disabled={busy || !admin}
                onClick={() => void save({ name, timezone })}
              >
                Save workspace details
              </Button>
            </div>
          </section>
          <section className="panel settings-card">
            <div className="panel-heading">
              <div>
                <h2>Let’s get connected</h2>
                <p>
                  Head and admin accounts can connect Facebook. Tokens stay on
                  the server.
                </p>
              </div>
              <Link2 size={20} />
            </div>
            <div className="integration-row">
              <span className="integration-icon facebook">
                <Facebook size={22} />
              </span>
              <div>
                <strong>Facebook Pages & Ads</strong>
                <small>
                  {data.resources.length
                    ? `${data.resources.filter((r) => r.type === "page").length} Pages · ${data.resources.filter((r) => r.type === "ad_account").length} ad accounts`
                    : "Connect your business accounts"}
                </small>
              </div>
              <Button disabled={!admin} onClick={() => void connect()}>
                {data.resources.length
                  ? "Connect or refresh"
                  : "Connect Facebook"}
              </Button>
            </div>
            {data.resources.map((r) => (
              <div className="connected-resource" key={r.id}>
                <span className="connection-dot connected" />
                <span>
                  {r.name}
                  <small>
                    {r.type === "page"
                      ? "Facebook Page"
                      : `${r.currency} · ${r.timezone}`}
                  </small>
                </span>
                <Badge tone={r.status === "connected" ? "green" : "sand"}>
                  {r.status}
                </Badge>
              </div>
            ))}
            <p className="setting-help">
              For live messaging, your Meta app needs the Messenger permissions,
              a verified webhook, and a public HTTPS callback. Use the setup
              guide included with the project.
            </p>
            <div className="integration-row">
              <span className="integration-icon lilac">
                <Sparkles size={22} />
              </span>
              <div>
                <strong>Jev AI</strong>
                <small>
                  {data.integrations.jev_provider === "openrouter"
                    ? "OpenRouter · "
                    : ""}
                  {data.integrations.jev_model ||
                    "Typed decisions for autofill, FAQ selection, and human handoff"}
                </small>
              </div>
              <Badge tone={data.integrations.jev ? "green" : "sand"}>
                {data.integrations.jev ? "Configured" : "API key needed"}
              </Badge>
            </div>
            <div className="integration-row">
              <span className="integration-icon sand">
                <Cloud size={22} />
              </span>
              <div>
                <strong>Cloudinary</strong>
                <small>Media uploads and message attachments</small>
              </div>
              <Badge tone={data.integrations.cloudinary ? "green" : "sand"}>
                {data.integrations.cloudinary ? "Configured" : "Not connected"}
              </Badge>
            </div>
          </section>
          <section className="panel settings-card">
            <div className="panel-heading">
              <div>
                <h2>Your conversation assistant</h2>
                <p>
                  Collect required details first, answer from approved
                  knowledge, and hand off when needed.
                </p>
              </div>
              <Sparkles size={20} />
            </div>
            <label className="toggle-row large">
              <span>
                <strong>Autofill contact details with Jev</strong>
                <small>
                  Capture names, contact information, and intake answers from
                  customer messages. Works alongside human agents and keeps the
                  source for review.
                </small>
              </span>
              <input
                type="checkbox"
                role="switch"
                aria-label="Autofill contact details with Jev"
                checked={data.tenant.autofill_enabled !== false}
                disabled={busy || !admin}
                onChange={(e) =>
                  void save({ autofill_enabled: e.target.checked })
                }
              />
              <span className="toggle-visual" />
            </label>
            <label className="toggle-row large">
              <span>
                <strong>Enable the assistant</strong>
                <small>
                  Replies to new messages and runs eligible scheduled
                  touchpoints.
                </small>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={data.tenant.bot_enabled}
                disabled={busy || !admin}
                onChange={(e) => void save({ bot_enabled: e.target.checked })}
              />
              <span className="toggle-visual" />
            </label>
            <div className="intake-editor">
              <h3>A step at a time</h3>
              <p className="muted">
                Every required field is collected before intake is complete.
                Optional choice rules determine qualification.
              </p>
              {fields.map((field, i) => (
                <div className="intake-field" key={i}>
                  <div className="intake-field-top">
                    <span className="step-number">{i + 1}</span>
                    <input
                      aria-label={`Question ${i + 1}`}
                      value={field.label}
                      disabled={!admin}
                      onChange={(e) =>
                        setFields(
                          fields.map((f, n) =>
                            n === i ? { ...f, label: e.target.value } : f,
                          ),
                        )
                      }
                    />
                    <IconButton
                      label="Remove question"
                      disabled={!admin || fields.length <= 1}
                      onClick={() =>
                        setFields(fields.filter((_, n) => n !== i))
                      }
                    >
                      <Trash2 size={15} />
                    </IconButton>
                  </div>
                  <div className="intake-field-options">
                    <input
                      aria-label={`Field key ${i + 1}`}
                      value={field.key}
                      disabled={!admin}
                      onChange={(e) =>
                        setFields(
                          fields.map((f, n) =>
                            n === i ? { ...f, key: e.target.value } : f,
                          ),
                        )
                      }
                    />
                    <Select
                      aria-label={`Answer type ${i + 1}`}
                      value={field.type}
                      disabled={!admin}
                      onChange={(e) =>
                        setFields(
                          fields.map((f, n) =>
                            n === i
                              ? {
                                  ...f,
                                  type: e.target.value as IntakeField["type"],
                                }
                              : f,
                          ),
                        )
                      }
                    >
                      {["text", "email", "phone", "number", "choice"].map(
                        (t) => (
                          <option key={t}>{t}</option>
                        ),
                      )}
                    </Select>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={field.required}
                        disabled={!admin}
                        onChange={(e) =>
                          setFields(
                            fields.map((f, n) =>
                              n === i
                                ? { ...f, required: e.target.checked }
                                : f,
                            ),
                          )
                        }
                      />
                      Required
                    </label>
                  </div>
                  {field.type === "choice" && (
                    <div className="form-row">
                      <Field
                        label="Choices"
                        hint="Separate options with commas."
                      >
                        <input
                          value={field.options?.join(", ") || ""}
                          disabled={!admin}
                          onChange={(e) =>
                            setFields(
                              fields.map((f, n) =>
                                n === i
                                  ? {
                                      ...f,
                                      options: e.target.value
                                        .split(",")
                                        .map((s) => s.trim()),
                                    }
                                  : f,
                              ),
                            )
                          }
                        />
                      </Field>
                      <Field
                        label="Qualifying answers"
                        hint="Leave empty to accept any option."
                      >
                        <input
                          value={field.qualify?.join(", ") || ""}
                          disabled={!admin}
                          onChange={(e) =>
                            setFields(
                              fields.map((f, n) =>
                                n === i
                                  ? {
                                      ...f,
                                      qualify: e.target.value
                                        ? e.target.value
                                            .split(",")
                                            .map((s) => s.trim())
                                        : [],
                                    }
                                  : f,
                              ),
                            )
                          }
                        />
                      </Field>
                    </div>
                  )}
                </div>
              ))}
              <div className="inline-actions">
                <Button
                  disabled={!admin || fields.length >= 20}
                  onClick={() =>
                    setFields([
                      ...fields,
                      {
                        key: `question_${fields.length + 1}`,
                        label: "What else would you like us to know?",
                        required: true,
                        type: "text",
                      },
                    ])
                  }
                >
                  <Plus size={15} />
                  Add question
                </Button>
                <Button
                  variant="primary"
                  disabled={!admin || busy}
                  onClick={() => void save({ intake_fields: fields })}
                >
                  Save intake flow
                </Button>
              </div>
            </div>
          </section>
          <section className="panel settings-card">
            <div className="panel-heading">
              <div>
                <h2>Seven days of thoughtful follow-through</h2>
                <p>
                  Scheduled around observed contact hours. Each send checks
                  messaging eligibility again.
                </p>
              </div>
              <Clock3 size={20} />
            </div>
            <div className="followup-editor">
              {templates.map((template, i) => (
                <div className="followup-edit-row" key={i}>
                  <span>Day {i + 1}</span>
                  <textarea
                    aria-label={`Day ${i + 1} follow-up`}
                    rows={2}
                    value={template}
                    disabled={!admin}
                    onChange={(e) =>
                      setTemplates(
                        templates.map((t, n) => (n === i ? e.target.value : t)),
                      )
                    }
                  />
                </div>
              ))}
            </div>
            <p className="setting-help">
              Use {"{name}"} for a first name. Outside an eligible window, the
              worker creates a human task. The HUMAN_AGENT tag is reserved for
              manually composed support replies.
            </p>
            <Button
              disabled={!admin || busy}
              onClick={() => void save({ followup_templates: templates })}
            >
              Save touchpoints
            </Button>
          </section>
        </div>
        <aside className="settings-aside">
          <section className="panel settings-card">
            <div className="panel-heading">
              <div>
                <h2>A clearer view of profit</h2>
                <p>Optional operating expenses, separate from advertising.</p>
              </div>
              <WalletIcon />
            </div>
            <div className="form-stack">
              <Field
                label="Expense percentage"
                hint="Applied per paid order meeting the threshold."
              >
                <div className="input-suffix">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="0.1"
                    value={expense}
                    disabled={!admin}
                    onChange={(e) => setExpense(Number(e.target.value))}
                  />
                  <span>%</span>
                </div>
              </Field>
              <Field
                label={`Minimum order amount (${data.tenant.currency})`}
                hint="Use 0 to apply to every paid order."
              >
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={threshold}
                  disabled={!admin}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                />
              </Field>
              <div className="calculation-example">
                <small>
                  For a{" "}
                  {formatMoney(
                    Math.max(threshold * 100, 300000),
                    data.tenant.currency,
                  )}{" "}
                  paid order
                </small>
                <span>
                  Operating expense{" "}
                  <strong>
                    {formatMoney(
                      Math.round(
                        (Math.max(threshold * 100, 300000) * expense) / 100,
                      ),
                      data.tenant.currency,
                    )}
                  </strong>
                </span>
                <small>Ad spend is deducted separately.</small>
              </div>
              <Button
                disabled={!admin || busy}
                onClick={() =>
                  void save({
                    expense_percent: expense,
                    expense_threshold_minor: Math.round(threshold * 100),
                  })
                }
              >
                Save expense rule
              </Button>
            </div>
          </section>
          <section className="panel settings-card">
            <div className="panel-heading">
              <div>
                <h2>Spend with a little more care</h2>
                <p>Automatic ad pausing stays off until you enable it.</p>
              </div>
              <ShieldCheck size={20} />
            </div>
            <label className="toggle-row">
              <span>Enable ad automation</span>
              <input
                type="checkbox"
                role="switch"
                checked={data.tenant.automation_enabled}
                disabled={!admin || busy}
                onChange={(e) =>
                  void save({ automation_enabled: e.target.checked })
                }
              />
              <span className="toggle-visual" />
            </label>
            <div className="form-stack">
              <Field
                label="AOV spend multiplier"
                hint="Pause eligibility starts when 3-day average daily spend reaches AOV × this value."
              >
                <input
                  type="number"
                  min={0.5}
                  max={10}
                  step={0.1}
                  value={multiplier}
                  disabled={!admin}
                  onChange={(e) => setMultiplier(Number(e.target.value))}
                />
              </Field>
              <div className="rule-list">
                <p>
                  <CheckCircle2 size={14} />
                  Three completed spend days
                </p>
                <p>
                  <CheckCircle2 size={14} />A real paid-order AOV
                </p>
                <p>
                  <CheckCircle2 size={14} />
                  Unprofitable inquiry cohorts
                </p>
                <p>
                  <CheckCircle2 size={14} />
                  Fresh spend, synced within 2 hours
                </p>
                <p>
                  <CheckCircle2 size={14} />
                  Ad-level permission enabled
                </p>
              </div>
              <Button
                disabled={!admin || busy}
                onClick={() => void save({ aov_spend_multiplier: multiplier })}
              >
                Save ad rule
              </Button>
            </div>
          </section>
          <section className="panel settings-card">
            <div className="panel-heading">
              <div>
                <h2>Your account</h2>
                <p>Set or update your login password.</p>
              </div>
              <KeyRound size={19} />
            </div>
            <form
              className="form-stack"
              onSubmit={async (e) => {
                e.preventDefault();
                const { error } = await supabase().auth.updateUser({
                  password: newPassword,
                });
                if (error) notify(error.message, "error");
                else {
                  notify("Your password is updated.");
                  setNewPassword("");
                }
              }}
            >
              <Field label="New password">
                <input
                  type="password"
                  minLength={8}
                  required
                  value={newPassword}
                  autoComplete="new-password"
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </Field>
              <Button type="submit">Update password</Button>
            </form>
          </section>
        </aside>
      </div>
    </>
  );
}
function WalletIcon() {
  return <SlidersHorizontal size={20} />;
}
