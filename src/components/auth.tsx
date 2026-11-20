"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Leaf, Loader2, MessageCircle, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button, Field } from "./ui";

function AuthFrame({ children }: { children: ReactNode }) {
  return <main className="auth-page">
    <aside className="auth-story">
      <a className="brand" href="/sign-in"><span className="brand-mark"><Leaf size={25} /></span><span>mori<span className="brand-period">.</span></span></a>
      <div className="auth-story-copy"><span className="eyebrow">A LITTLE SPACE TO GROW</span><h1>Every conversation.<br />A closer connection.</h1><p>A home for your customers, your team, and the moments that move your business forward.</p><div className="auth-story-detail"><MessageCircle size={21} /><span>Conversations, thoughtfully connected.</span></div><div className="auth-story-detail"><ShieldCheck size={21} /><span>Your workspace. Your team’s access.</span></div></div>
      <span className="auth-story-footer">Made for meaningful connections.</span>
    </aside>
    <section className="auth-main"><div className="auth-card">{children}</div><span className="auth-footnote">Your customer relationships start here.</span></section>
  </main>;
}

export function SignIn() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup" | "reset">("login");
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [name, setName] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    supabase().auth.getSession().then(({ data }) => { if (active && data.session) router.replace("/"); });
    const params = new URLSearchParams(window.location.search);
    if (params.has("error")) setError("The sign-in link could not be completed. Please try again.");
    return () => { active = false; };
  }, [router]);
  function changeMode(next: typeof mode) { setMode(next); setError(""); setNotice(""); setPassword(""); }
  async function facebook() {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY! } });
      const settings = await response.json();
      if (!response.ok || !settings.external?.facebook) throw new Error("Facebook sign-in is temporarily unavailable. Please use email to sign in.");
      const { error } = await supabase().auth.signInWithOAuth({ provider: "facebook", options: { scopes: "email", redirectTo: `${window.location.origin}/auth/callback` } });
      if (error) throw new Error("Facebook sign-in is temporarily unavailable. Please use email to sign in.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not start Facebook sign-in."); setBusy(false); }
  }
  return <AuthFrame><span className="eyebrow">WELCOME TO MORI</span><h2>{mode === "signup" ? "Make room for growth." : mode === "reset" ? "Let’s get you back in." : "Welcome back."}</h2><p className="auth-description">{mode === "signup" ? "Create your account, then set up your workspace or join your team’s invitation." : mode === "reset" ? "We’ll email you a link to choose a new password." : "Sign in to your workspace and pick up the conversation."}</p>
    {mode !== "reset" && <><Button className="facebook-signin" type="button" disabled={busy} onClick={() => void facebook()}><svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.5-3.9 3.78-3.9 1.1 0 2.24.2 2.24.2v2.46H15.2c-1.24 0-1.64.77-1.64 1.56V12h2.78l-.44 2.89H13.56v6.99A10 10 0 0 0 22 12Z" /></svg>Continue with Facebook</Button><div className="auth-divider"><span />or continue with email<span /></div></>}
    <form className="form-stack" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError(""); setNotice("");
      try {
        if (mode === "login") {
          const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
          if (error) throw error;
          router.replace("/"); router.refresh();
        } else if (mode === "signup") {
          const { data, error } = await supabase().auth.signUp({ email: email.trim(), password, options: { data: { full_name: name.trim() }, emailRedirectTo: `${window.location.origin}/auth/callback` } });
          if (error) throw error;
          if (data.session) { router.replace("/"); router.refresh(); }
          else setNotice("Check your email to confirm your account, then sign in. If you already have an account, use Sign in below.");
        } else {
          const { error } = await supabase().auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/auth/callback?next=/set-password` });
          if (error) throw error;
          setNotice("If this email has an account, a password reset link is on its way.");
        }
      } catch (e) { setError(e instanceof Error ? e.message : "Could not complete sign-in."); }
      finally { setBusy(false); }
    }}>
      {mode === "signup" && <Field label="Your name"><input required maxLength={100} autoComplete="name" value={name} onChange={e => setName(e.target.value)} /></Field>}
      <Field label="Email address"><input required type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@yourbusiness.com" /></Field>
      {mode !== "reset" && <Field label="Password"><input required type="password" minLength={mode === "signup" ? 8 : undefined} autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={e => setPassword(e.target.value)} /></Field>}
      {mode === "login" && <button className="auth-text-button auth-forgot" type="button" onClick={() => changeMode("reset")}>Forgot password?</button>}
      {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="auth-notice" role="status">{notice}</p>}
      <Button variant="primary" className="auth-submit" disabled={busy}>{busy ? <Loader2 className="spin" size={17} /> : <>{mode === "signup" ? "Create account" : mode === "reset" ? "Send reset link" : "Sign in"}<ArrowRight size={17} /></>}</Button>
    </form>
    <p className="auth-switch">{mode === "login" ? "New to Mori?" : "Already have an account?"} <button className="auth-text-button" type="button" disabled={busy} onClick={() => changeMode(mode === "login" ? "signup" : "login")}>{mode === "login" ? "Create an account" : "Sign in"}</button></p>
  </AuthFrame>;
}

export function AuthCallback() {
  const router = useRouter();
  const started = useRef(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      if (params.has("error") || fragment.has("error")) throw new Error("Sign-in was canceled or the link has expired. Please try again.");
      // Admin-generated invitation links use a token fragment. Accept it explicitly,
      // while normal email and social sign-in use the client's automatic PKCE exchange.
      if (fragment.get("access_token") && fragment.get("refresh_token")) {
        window.history.replaceState({}, "", window.location.pathname + window.location.search);
        const { error } = await supabase().auth.setSession({ access_token: fragment.get("access_token")!, refresh_token: fragment.get("refresh_token")! });
        if (error) throw new Error("This invitation has expired. Please request a new invitation.");
      }
      const { data, error } = await supabase().auth.getSession();
      if (error || !data.session) throw new Error("This sign-in link has expired or was opened in a different browser. Please request a new link in this browser.");
      const { error: userError } = await supabase().auth.getUser();
      if (userError) throw new Error("Your session could not be verified. Please sign in again.");
      // Only these two local destinations are supported, including invitation and recovery links.
      const next = params.get("next") === "/set-password" ? "/set-password" : "/";
      window.history.replaceState({}, "", "/auth/callback");
      router.replace(next); router.refresh();
    })().catch(e => setError(e instanceof Error ? e.message : "Could not complete sign-in."));
  }, [router]);
  return <AuthFrame><h2>{error ? "Let’s try that again." : "You’re almost there."}</h2>{error ? <><p className="form-error" role="alert">{error}</p><a className="button primary auth-submit" href="/sign-in">Back to sign in</a></> : <p className="auth-loading" role="status"><Loader2 className="spin" />Completing sign-in…</p>}</AuthFrame>;
}

export function SetPassword() {
  const router = useRouter();
  const [ready, setReady] = useState(false), [password, setPassword] = useState(""), [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { supabase().auth.getUser().then(({ data }) => { if (!data.user) router.replace("/sign-in"); else setReady(true); }); }, [router]);
  return <AuthFrame><h2>Choose your password.</h2><p className="auth-description">Set a password to access your account and team workspace.</p>{ready ? <form className="form-stack" onSubmit={async e => {
    e.preventDefault(); setError("");
    if (password !== confirm) { setError("Your passwords do not match."); return; }
    setBusy(true);
    const { error } = await supabase().auth.updateUser({ password });
    setBusy(false);
    if (error) setError(error.message);
    else { router.replace("/"); router.refresh(); }
  }}><Field label="New password"><input type="password" minLength={8} required autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} /></Field><Field label="Confirm password"><input type="password" minLength={8} required autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} /></Field>{error && <p className="form-error" role="alert">{error}</p>}<Button variant="primary" disabled={busy}>{busy ? "Saving…" : "Save password"}</Button></form> : <p role="status">Checking your account…</p>}</AuthFrame>;
}
