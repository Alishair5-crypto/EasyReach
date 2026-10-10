"use client";

import { useEffect, useState } from "react";

type Workspace = { id: string; name: string; role: string; active: boolean };

export default function WorkspaceSelector({ email }: { email: string }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/workspaces/active", { cache: "no-store" })
      .then(async response => {
        const body: unknown = await response.json();
        if (!response.ok || typeof body !== "object" || body === null || !("workspaces" in body) || !Array.isArray(body.workspaces)) {
          throw new Error("Unable to load your workspaces.");
        }
        if (alive) {
          const list = body.workspaces as Workspace[];
          setWorkspaces(list);
          setSelected(list.find(item => item.active)?.id ?? list[0]?.id ?? "");
        }
      })
      .catch(() => { if (alive) setError("We couldn't load your workspaces. Refresh the page and try again."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  async function chooseWorkspace() {
    if (saving || !selected) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/workspaces/active", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspace_id: selected }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const message = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : "workspace_selection_failed";
        throw new Error(message);
      }
      window.location.assign("/dashboard");
    } catch {
      setError("Your workspace could not be selected. Please retry.");
      setSaving(false);
    }
  }

  return (
    <div className="setup-form" aria-busy={loading || saving}>
      <div className="setup-note"><strong>{email}</strong><span>Signed in</span></div>
      {loading ? <p className="muted">Loading available workspaces…</p> : workspaces.length === 0 ? <p className="muted">No business workspaces are available for this account.</p> : (
        <label className="setup-field">
          <span>Business workspace</span>
          <select value={selected} onChange={event => setSelected(event.target.value)} disabled={saving}>
            {workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name} · {workspace.role}</option>)}
          </select>
        </label>
      )}
      {error && <div className="error" role="alert" aria-live="polite">{error}</div>}
      <button className="button wide" disabled={loading || saving || !selected} onClick={chooseWorkspace}>{saving ? "Opening workspace…" : "Continue to workspace"}</button>
    </div>
  );
}
