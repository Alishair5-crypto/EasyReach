"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/browser";

function userFacingError(message?: string) {
  if (message?.includes("resource_limit_exceeded")) {
    return "Your workspace could not be created because of a plan-limit conflict. Please try again; if it continues, contact support.";
  }
  if (message?.includes("not_authenticated")) {
    return "Your sign-in session has expired. Please sign in again and retry.";
  }
  if (message?.includes("trial_plan_missing")) {
    return "Workspace setup is temporarily unavailable. Please try again later.";
  }
  return "We couldn't create your workspace. Please check the details and try again.";
}

export default function OnboardingForm({ email }: { email: string }) {
  const [business, setBusiness] = useState("");
  const [type, setType] = useState("");
  const [agent, setAgent] = useState("EasyReach Sales Agent");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");

    try {
      const { data, error: rpcError } = await createClient().rpc("bootstrap_tenant", {
        p_business_name: business.trim(),
        p_business_type: type.trim(),
        p_agent_name: agent.trim(),
      });

      if (rpcError || !data) {
        console.error("EasyReach workspace creation failed", rpcError);
        setError(userFacingError(rpcError?.message));
        setBusy(false);
        return;
      }

      window.location.assign("/dashboard");
    } catch (cause) {
      console.error("EasyReach workspace creation request failed", cause);
      setError("A connection problem prevented workspace creation. Please retry.");
      setBusy(false);
    }
  }

  return (
    <form className="setup-form" onSubmit={submit} aria-busy={busy}>
      <div className="setup-note">
        <strong>{email}</strong>
        <span>Owner</span>
      </div>

      <label className="setup-field">
        <span>Business name</span>
        <input
          autoComplete="organization"
          required
          minLength={2}
          maxLength={120}
          value={business}
          onChange={(e) => setBusiness(e.target.value)}
          placeholder="e.g. Chand Brands"
        />
      </label>

      <label className="setup-field">
        <span>Business type</span>
        <input
          required
          minLength={2}
          maxLength={80}
          value={type}
          onChange={(e) => setType(e.target.value)}
          placeholder="e.g. Fashion & clothing"
        />
      </label>

      <label className="setup-field">
        <span>AI agent name</span>
        <input
          required
          minLength={2}
          maxLength={80}
          value={agent}
          onChange={(e) => setAgent(e.target.value)}
          placeholder="e.g. EasyReach Sales Agent"
        />
      </label>

      {error && <div className="error" role="alert" aria-live="polite">{error}</div>}

      <button className="button wide" disabled={busy}>
        {busy ? "Creating workspace…" : "Create workspace"}
      </button>
    </form>
  );
}
