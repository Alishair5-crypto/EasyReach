"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";

export default function SignOutButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function signOut() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const { error } = await createClient().auth.signOut();
      if (error) throw error;
      window.location.assign("/signin");
    } catch {
      setError("Sign out failed. Please retry.");
      setBusy(false);
    }
  }
  return <div className="settings-signout"><button className="button secondary small" type="button" onClick={signOut} disabled={busy}>{busy ? "Signing out…" : "Sign out"}</button>{error && <p className="error" role="alert">{error}</p>}</div>;
}