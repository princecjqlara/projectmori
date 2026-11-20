"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  LayoutDashboard,
  CalendarDays,
  MessagesSquare,
  Users,
  Columns3,
  ShoppingBag,
  Layers3,
  BookOpen,
  Settings2,
  UsersRound,
  ChevronsUpDown,
  Search,
  Plus,
  ChevronDown,
  LogOut,
  Command,
  Leaf,
  PanelLeftClose,
  Menu,
  CheckCircle2,
  AlertCircle,
  X,
  Loader2,
  ExternalLink,
  Building2,
} from "lucide-react";
import type { Snapshot } from "@/lib/types";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { AppContext } from "./context";
import { Button, Modal, Field, IconButton, Avatar, Badge } from "./ui";
import { Overview, CalendarView, ReportsView } from "./dashboard";
import {
  ContactsView,
  PipelineView,
  OrdersView,
  InboxView,
  ContactProfile,
  ContactForm,
  OrderForm,
} from "./crm";
import { AdsView, KnowledgeView, TeamView, SettingsView } from "./management";

const nav = [
  { label: "Overview", id: "overview", icon: LayoutDashboard },
  { label: "Performance calendar", id: "calendar", icon: CalendarDays },
  { label: "Conversations", id: "inbox", icon: MessagesSquare },
  { label: "Contacts", id: "contacts", icon: Users },
  { label: "Sales pipeline", id: "pipeline", icon: Columns3 },
  { label: "Orders", id: "orders", icon: ShoppingBag },
  { label: "Ad creatives", id: "ads", icon: Layers3 },
  { label: "Reports & patterns", id: "reports", icon: BookOpen },
  { label: "Knowledge & FAQ", id: "knowledge", icon: BookOpen },
  { label: "Team & access", id: "team", icon: UsersRound },
  { label: "Settings", id: "settings", icon: Settings2 },
];
export default function Workspace() {
  const router = useRouter();
  const [authReady, setAuthReady] = useState(false);
  const [data, setData] = useState<Snapshot | null>(null),
    [session, setSession] = useState<Session | null>(null),
    [tenantId, setTenantId] = useState(""),
    [workspaces, setWorkspaces] = useState<
      { id: string; name: string; role: string }[]
    >([]);
  const [page, setPage] = useState("overview"),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [sidebar, setSidebar] = useState(false);
  const [createWorkspace, setCreateWorkspace] = useState(false),
    [newContact, setNewContact] = useState(false),
    [orderContact, setOrderContact] = useState<string | undefined>(),
    [newOrder, setNewOrder] = useState(false),
    [contactId, setContactId] = useState<string | null>(null);
  const [search, setSearch] = useState(""),
    [searchOpen, setSearchOpen] = useState(false),
    [toast, setToast] = useState<{ message: string; tone: string } | null>(
      null,
    );
  const notify = useCallback((message: string, tone = "success") => {
    setToast({ message, tone });
  }, []);
  const activeWorkspace = useRef({ tenantId, userId: session?.user.id });
  activeWorkspace.current = { tenantId, userId: session?.user.id };
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("facebook");
    if (!result) return;
    setPage("settings");
    notify(
      result === "connected"
        ? "Facebook accounts connected. Assign resources to your team in Team & access."
        : "Facebook connection could not be completed. Check the app callback, permissions, and Page ownership in the setup guide.",
      result === "connected" ? "success" : "error",
    );
    const clean = new URL(window.location.href);
    clean.searchParams.delete("facebook");
    window.history.replaceState({}, "", clean);
  }, [notify]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  useEffect(() => {
    let active = true;
    const client = supabase();
    const applySession = (next: Session | null) => {
      if (!active) return;
      if (activeWorkspace.current.userId !== next?.user.id) {
        setData(null); setTenantId(""); setContactId(null);
        setNewContact(false); setNewOrder(false); setSearch("");
      }
      setSession(next);
      setAuthReady(true);
      if (!next) {
        setData(null); setTenantId(""); setWorkspaces([]);
        router.replace("/sign-in");
      }
    };
    client.auth.getSession().then(({ data, error }) => applySession(error ? null : data.session));
    const { data: listener } = client.auth.onAuthStateChange((_event, next) => applySession(next));
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, [router]);
  const request = useCallback(
    async (path: string, options: RequestInit = {}) => {
      const result = await fetch(`/api/${path}`, {
        ...options,
        headers: {
          ...(options.body instanceof FormData
            ? {}
            : { "Content-Type": "application/json" }),
          Authorization: `Bearer ${session?.access_token || ""}`,
          "x-tenant-id": tenantId,
          ...options.headers,
        },
      });
      const json = await result.json();
      if (result.status === 401) {
        setData(null); setTenantId("");
        await supabase().auth.signOut({ scope: "local" });
        router.replace("/sign-in");
      }
      if (!result.ok) throw new Error(json.error || "The request failed.");
      return json;
    },
    [session, tenantId, router],
  );
  useEffect(() => {
    if (!session) return;
    let active = true;
    setLoading(true);
    request("workspaces")
      .then((list) => {
        if (!active) return;
        setWorkspaces(list);
        if (!list.length) {
          setTenantId("");
          setData(null);
          setCreateWorkspace(true);
        } else
          setTenantId((current) =>
            list.some((w: { id: string }) => w.id === current)
              ? current
              : list[0].id,
          );
        setError("");
      })
      .catch((e) => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session, request]);
  const refresh = useCallback(async () => {
    if (!session || !tenantId) return;
    setLoading(true);
    try {
      const result = await request("snapshot");
      if (
        activeWorkspace.current.userId !== session.user.id ||
        activeWorkspace.current.tenantId !== tenantId
      )
        return;
      setData(result);
      setError("");
    } catch (e) {
      if (activeWorkspace.current.userId === session.user.id && activeWorkspace.current.tenantId === tenantId)
        setError(e instanceof Error ? e.message : "Cannot load the workspace.");
    } finally {
      setLoading(false);
    }
  }, [session, tenantId, request]);
  useEffect(() => {
    void refresh();
    if (session && tenantId) {
      const timer = setInterval(() => void refresh(), 60000);
      return () => clearInterval(timer);
    }
  }, [refresh, session, tenantId]);
  async function mutate(method: string, path: string, body?: any) {
    setBusy(true);
    try {
      const result = await request(path, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      await refresh();
      return result;
    } catch (e) {
      const message = e instanceof Error ? e.message : "The operation failed.";
      notify(message, "error");
      throw e;
    } finally {
      setBusy(false);
    }
  }
  async function upload(path: string, file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const result = await request(path, { method: "POST", body: form });
      await refresh();
      return result;
    } catch (e) {
      notify(e instanceof Error ? e.message : "Upload failed.", "error");
      throw e;
    } finally {
      setBusy(false);
    }
  }
  function navigate(id: string) {
    setPage(id);
    setSidebar(false);
    setSearchOpen(false);
  }
  const openOrder = (id?: string) => {
    setOrderContact(id);
    setNewOrder(true);
  };
  const selected = data?.contacts.find((c) => c.id === contactId);
  const filtered = search.trim()
    ? data?.contacts
        .filter((c) =>
          `${c.name} ${c.phone || ""} ${c.email || ""}`
            .toLowerCase()
            .includes(search.toLowerCase()),
        )
        .slice(0, 6)
    : [];
  const title = nav.find((n) => n.id === page)?.label || "Overview";
  if (!authReady || !session) return <div className="auth-loading" role="status"><Loader2 className="spin" /> Checking your session…</div>;
  return (
    <div className="app-shell">
      {sidebar && (
        <div className="sidebar-scrim" onClick={() => setSidebar(false)} />
      )}
      <aside className={`sidebar ${sidebar ? "is-open" : ""}`}>
        <a className="brand" href="/" aria-label="Mori home">
          <span className="brand-mark">
            <Leaf size={25} />
          </span>
          <span>
            mori<span className="brand-period">.</span>
          </span>
        </a>
        <button
          className="workspace-picker"
          onClick={() => setCreateWorkspace(true)}
        >
          <span className="workspace-icon">
            {(data?.tenant.name || "Mori")[0]}
          </span>
          <span>
            <strong>{data?.tenant.name || "Your workspace"}</strong>
            <small>{data?.tenant.role || "Business workspace"}</small>
          </span>
          <ChevronsUpDown size={15} />
        </button>
        {workspaces.length > 1 && (
          <select
            className="workspace-select"
            aria-label="Switch workspace"
            value={tenantId}
            onChange={(e) => {
              setTenantId(e.target.value);
              setData(null);
              setContactId(null); setNewContact(false); setNewOrder(false); setSearch(""); setPage("overview");
            }}
          >
            {workspaces.map((w) => (
              <option value={w.id} key={w.id}>
                {w.name} · {w.role}
              </option>
            ))}
          </select>
        )}
        <span className="nav-label">WORKSPACE</span>
        <nav>
          {nav.slice(0, 6).map((n) => (
            <button
              key={n.id}
              aria-label={n.label}
              className={`nav-item ${page === n.id ? "active" : ""}`}
              onClick={() => navigate(n.id)}
            >
              <n.icon size={18} />
              <span>{n.label}</span>
              {n.id === "inbox" &&
                !!data?.contacts.filter((c) => c.bot_state === "human")
                  .length && (
                  <span className="nav-count">
                    {
                      data.contacts.filter((c) => c.bot_state === "human")
                        .length
                    }
                  </span>
                )}
            </button>
          ))}
        </nav>
        <span className="nav-label">GROWTH & TOOLS</span>
        <nav>
          {nav.slice(6, 9).map((n) => (
            <button
              key={n.id}
              aria-label={n.label}
              className={`nav-item ${page === n.id ? "active" : ""}`}
              onClick={() => navigate(n.id)}
            >
              <n.icon size={18} />
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="assistant-note">
            <span className="assistant-note-icon">✧</span>
            <strong>A little help. A lot of growth.</strong>
            <p>Thoughtful automation, with your team always in control.</p>
            <button onClick={() => navigate("settings")}>
              Manage your assistant <Settings2 size={13} />
            </button>
          </div>
          <nav>
            {nav.slice(9).map((n) => (
              <button
                key={n.id}
                aria-label={n.label}
                className={`nav-item ${page === n.id ? "active" : ""}`}
                onClick={() => navigate(n.id)}
              >
                <n.icon size={18} />
                <span>{n.label}</span>
              </button>
            ))}
          </nav>
          <button className="user-card" aria-label="Sign out" onClick={async () => {
            setData(null); setTenantId(""); setSession(null);
            await supabase().auth.signOut(); router.replace("/sign-in");
          }}>
            <Avatar name={session?.user.user_metadata.full_name || session?.user.email || "Your account"} size="small" />
            <span><strong>{session?.user.user_metadata.full_name || session?.user.email?.split("@")[0] || "Your account"}</strong><small>{data?.tenant.role || "Signed in"}</small></span>
            <LogOut size={15} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <IconButton
              label="Open navigation"
              className="mobile-nav"
              onClick={() => setSidebar(true)}
            >
              <Menu size={20} />
            </IconButton>
            <span>Workspace</span>
            <span className="breadcrumb-slash">/</span>
            <strong>{title}</strong>
          </div>
          <div className="topbar-actions">
            <div className="global-search">
              <Search size={16} />
              <input
                aria-label="Search contacts"
                placeholder="Search anything..."
                value={search}
                onFocus={() => setSearchOpen(true)}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setSearchOpen(true);
                }}
              />
              <kbd>⌕</kbd>
              {searchOpen && search && (
                <div className="search-results">
                  <span className="eyebrow">CONTACTS</span>
                  {filtered?.length ? (
                    filtered.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => {
                          setContactId(c.id);
                          setSearchOpen(false);
                          setSearch("");
                        }}
                      >
                        <Avatar name={c.name} size="small" />
                        <span>
                          {c.name}
                          <small>{c.email || c.phone}</small>
                        </span>
                      </button>
                    ))
                  ) : (
                    <p>No matching contacts.</p>
                  )}
                </div>
              )}
            </div>
            <span className="topbar-divider" />
            <Badge tone="green">Live workspace</Badge>
          </div>
        </header>
        <main className="main-content">
          {error && (
            <div className="error-banner">
              <AlertCircle size={18} />
              <span>{error}</span>
              <Button onClick={() => tenantId ? void refresh() : window.location.reload()}>Retry</Button>

            </div>
          )}
          {(loading || !!tenantId) && !data && !error ? (
            <div className="loading-state">
              <Loader2 className="spin" />
              Loading your workspace…
            </div>
          ) : (
            data && (
              <AppContext.Provider
                key={tenantId}
                value={{
                  data,
                  userId: session!.user.id,
                  busy,
                  mutate,
                  upload,
                  notify,
                  refresh,
                  openContact: setContactId,
                  openOrder,
                  navigate,
                }}
              >
                {page === "overview" && (
                  <Overview onAdd={() => setNewContact(true)} />
                )}
                {page === "calendar" && <CalendarView />}
                {page === "reports" && <ReportsView />}
                {page === "contacts" && (
                  <ContactsView onAdd={() => setNewContact(true)} />
                )}
                {page === "pipeline" && <PipelineView />}
                {page === "orders" && <OrdersView onAdd={() => openOrder()} />}
                {page === "inbox" && <InboxView />}
                {page === "ads" && <AdsView />}
                {page === "knowledge" && <KnowledgeView />}
                {page === "team" && <TeamView />}
                {page === "settings" && <SettingsView />}
                {selected && (
                  <ContactProfile
                    contact={selected}
                    onClose={() => setContactId(null)}
                  />
                )}
                {newContact && (
                  <ContactForm onClose={() => setNewContact(false)} />
                )}
                {newOrder && (
                  <OrderForm
                    contactId={orderContact}
                    onClose={() => setNewOrder(false)}
                  />
                )}
              </AppContext.Provider>
            )
          )}
          {!data && !tenantId && !loading && !error && (
            <div className="welcome-empty">
              <Building2 size={38} />
              <h1>Your next chapter starts here.</h1>
              <p>
                Create a workspace to connect your conversations and customers.
              </p>
              <Button
                variant="primary"
                onClick={() => setCreateWorkspace(true)}
              >
                Create workspace
              </Button>
            </div>
          )}
        </main>
        <footer className="app-footer">
          <span>Made for meaningful connections.</span>
          <span>
            {loading ? "Refreshing…" : "Your workspace"}
            <span className="footer-dot">·</span>
            {data?.tenant.timezone || "Asia/Manila"}
          </span>
        </footer>
      </div>
      {toast && (
        <div role="status" className={`toast ${toast.tone}`}>
          {toast.tone === "error" ? (
            <AlertCircle size={18} />
          ) : (
            <CheckCircle2 size={18} />
          )}
          <span>{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            aria-label="Dismiss notification"
          >
            <X size={16} />
          </button>
        </div>
      )}
      {createWorkspace && (
        <WorkspaceDialog
          onClose={() => setCreateWorkspace(false)}
          onCreate={async (name) => {
            const result = await request("workspaces", {
              method: "POST",
              body: JSON.stringify({ name }),
            });
            setWorkspaces((current) => [...current, result]);
            setData(null); setContactId(null); setNewContact(false); setNewOrder(false);
            setPage("overview"); setSearch("");
            setTenantId(result.id);
            setCreateWorkspace(false);
            notify("Your workspace is ready.");
          }}
        />
      )}
    </div>
  );
}
function WorkspaceDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal
      title="Create your workspace"
      description="Keep your people, Pages, and performance together."
      onClose={onClose}
    >
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onCreate(name);
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "Could not create workspace.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Business or workspace name">
          <input
            required
            minLength={2}
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Mori Studio"
          />
        </Field>
        {error && <p className="form-error">{error}</p>}
        <Button variant="primary" disabled={busy}>
          {busy ? "Creating…" : "Create workspace"}
        </Button>
      </form>
    </Modal>
  );
}
