"use client";
import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/browser";

export default function SignUp() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const { data, error } = await createClient().auth.signUp({
        email: email.trim(),
        password,
        options: { data: { full_name: name.trim() } },
      });
      if (error) {
        setError("We couldn't create your account with those details. Check the email and password requirements, then try again.");
        setBusy(false);
        return;
      }
      if (data.session) {
        window.location.assign("/onboarding");
      } else {
        setMessage("Account created. Check your email to confirm your address, then sign in to continue.");
        setBusy(false);
      }
    } catch {
      setError("A connection problem prevented account creation. Check your internet connection and try again.");
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="signup-title">
        <a className="brand" href="/" aria-label="EasyReach home">EasyReach</a>
        <div className="eyebrow">Create your account</div>
        <h1 id="signup-title">Build your sales workforce.</h1>
        <p className="muted">Start with an account, then create a private workspace for your business.</p>
        <form onSubmit={submit} aria-busy={busy}>
          <label htmlFor="signup-name">Your name
            <input id="signup-name" name="name" type="text" autoComplete="name" required minLength={2} maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder="Your full name" />
          </label>
          <label htmlFor="signup-email">Work email
            <input id="signup-email" name="email" type="email" autoComplete="email" inputMode="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" />
          </label>
          <label htmlFor="signup-password">Create password
            <input id="signup-password" name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" aria-describedby="password-hint" />
          </label>
          <p id="password-hint" className="field-hint">Use at least 8 characters. Choose a password you do not use elsewhere.</p>
          {error && <div className="error" role="alert" aria-live="polite">{error}</div>}
          {message && <div className="success" role="status" aria-live="polite">{message}</div>}
          <button className="button wide" type="submit" disabled={busy}>{busy ? "Creating account…" : "Create account"}</button>
        </form>
        <p className="muted center auth-switch">Already have an account? <a href="/signin">Sign in <span aria-hidden="true">→</span></a></p>
        <p className="auth-security-note"><span aria-hidden="true">◇</span> Your business workspace is private to your authorized team.</p>
      </section>
    </main>
  );
}