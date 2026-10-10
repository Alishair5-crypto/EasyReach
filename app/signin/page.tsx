"use client";
import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/browser";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const { error } = await createClient().auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        setError("We couldn't sign you in with those details. Check your email and password, then try again.");
        setBusy(false);
        return;
      }
      window.location.assign("/dashboard");
    } catch {
      setError("A connection problem prevented sign-in. Check your internet connection and try again.");
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="signin-title">
        <a className="brand" href="/" aria-label="EasyReach home">EasyReach</a>
        <div className="eyebrow">Welcome back</div>
        <h1 id="signin-title">Sign in to your business.</h1>
        <p className="muted">Pick up where your team left off. Your workspace is protected by authenticated access.</p>
        <form onSubmit={submit} aria-busy={busy}>
          <label htmlFor="signin-email">Work email
            <input id="signin-email" name="email" type="email" autoComplete="username" inputMode="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" />
          </label>
          <label htmlFor="signin-password">Password
            <input id="signin-password" name="password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password" />
          </label>
          {error && <div className="error" role="alert" aria-live="polite">{error}</div>}
          <button className="button wide" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in to EasyReach"}</button>
        </form>
        <p className="muted center auth-switch">New to EasyReach? <a href="/signup">Create an account <span aria-hidden="true">→</span></a></p>
        <p className="auth-security-note"><span aria-hidden="true">◇</span> Your business workspace is private to your authorized team.</p>
      </section>
    </main>
  );
}