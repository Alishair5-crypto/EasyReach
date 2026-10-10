import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import SignOutButton from "./sign-out-button";

type Integration = { id: string; kind: string; status: string; last_sync_at: string | null; error_message: string | null };

export default async function SettingsPage() {
  const { tenant, user, membership, supabase } = await getTenantContext();
  if (!tenant) redirect("/onboarding");
  const [{ data: subscription }, { data: integrations, error: integrationError }, { count: members }] = await Promise.all([
    supabase.from("subscriptions").select("status,plans(name,code)").eq("tenant_id", tenant.id).maybeSingle(),
    supabase.from("integrations").select("id,kind,status,last_sync_at,error_message").eq("tenant_id", tenant.id).order("kind"),
    supabase.from("tenant_members").select("user_id", { count: "exact", head: true }).eq("tenant_id", tenant.id),
  ]);
  const rows = (integrations ?? []) as Integration[];
  const connected = rows.filter(item => item.status === "connected").length;
  const needsAttention = rows.filter(item => item.status === "error").length;
  const plan = subscription?.plans as { name?: string; code?: string } | null;
  const labels: Record<string, string> = { whatsapp_meta: "WhatsApp Business", whatsapp_evolution: "WhatsApp QR", website: "Website", shopify: "Shopify", woocommerce: "WooCommerce", instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", email: "Email", google_sheets: "Google Sheets", crm: "CRM", pos: "POS", custom_api: "Custom API" };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/">EasyReach</a>
        <div className="tenant-name">{tenant.name}</div>
        <a className="button secondary small" href="/workspaces/select?switch=1">Switch workspace</a>
        <nav>
          <a href="/dashboard">Overview</a><a href="/agent">AI Agent</a><a href="/channels">Channels</a>
          <a href="/inbox">Shared Inbox</a><a href="/customers">Customers</a><a href="/products">Products</a><a href="/orders">Orders</a><a href="/analytics">Analytics</a>
          <a className="active" href="/settings">Settings</a>
        </nav>
        <div className="sidebar-bottom"><span>{user.email}</span><span>{membership?.role}</span></div>
      </aside>
      <section className="workspace">
        <header className="workspace-head"><div><div className="eyebrow">Workspace administration</div><h1>Settings</h1><p className="muted">Review your actual account, workspace access, plan record and channel health.</p></div></header>
        <div className="settings-grid">
          <section className="card settings-panel"><div className="eyebrow">Workspace</div><h2>{tenant.name}</h2><p className="muted">Your private EasyReach business workspace.</p><div className="settings-row"><span>Workspace ID</span><strong title={tenant.id}>{tenant.id.slice(0, 8)}…</strong></div><div className="settings-row"><span>Workspace members</span><strong>{members ?? 0}</strong></div></section>
          <section className="card settings-panel"><div className="eyebrow">Account & access</div><h2>Signed-in account</h2><p className="settings-email">{user.email ?? "Email unavailable"}</p><div className="settings-row"><span>Your role</span><strong className="settings-role">{membership?.role ?? "Unknown"}</strong></div><p className="muted">Access is scoped to this workspace and its membership permissions.</p><SignOutButton /></section>
          <section className="card settings-panel"><div className="eyebrow">Subscription</div><h2>{plan?.name ?? "Plan record unavailable"}</h2><div className="settings-row"><span>Subscription status</span><strong>{subscription?.status ?? "Not configured"}</strong></div>{plan?.code && <div className="settings-row"><span>Plan code</span><strong>{plan.code}</strong></div>}<p className="muted">Plan changes and payment processing are not exposed here unless a verified billing flow is configured.</p></section>
          <section className="card settings-panel"><div className="eyebrow">Connections</div><h2>Channel health</h2><div className="settings-metrics"><div><strong>{connected}</strong><span>Connected</span></div><div><strong>{needsAttention}</strong><span>Needs attention</span></div><div><strong>{rows.length}</strong><span>Configured records</span></div></div>{integrationError ? <p className="error" role="alert">Connection status could not be loaded.</p> : <div className="settings-connections">{rows.length ? rows.map(item => <div className="settings-row" key={item.id}><span>{labels[item.kind] ?? item.kind}</span><span className={"status " + (item.status === "connected" ? "good" : item.status === "error" ? "bad" : "")}>{item.status.replaceAll("_", " ")}</span></div>) : <p className="muted">No channel records have been configured yet.</p>}</div>}<a className="button secondary small settings-link" href="/channels">Manage channels</a></section>
        </div>
      </section>
    </main>
  );
}