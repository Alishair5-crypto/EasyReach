import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";

export default async function AnalyticsPage() {
  const { tenant, user, membership, supabase } = await getTenantContext();
  if (!tenant) redirect("/onboarding");
  const [customers, products, conversations, orders, leads, aiEvents, integrations] = await Promise.all([
    supabase.from("customers").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id),
    supabase.from("conversations").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id),
    supabase.from("ai_usage_events").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id),
    supabase.from("integrations").select("id,status").eq("tenant_id", tenant.id),
  ]);
  const errors = [customers, products, conversations, orders, leads, aiEvents].filter(result => result.error).length;
  const connected = (integrations.data ?? []).filter(item => item.status === "connected").length;
  const metrics: Array<[string, number | null]> = [
    ["Customers", customers.count], ["Products", products.count], ["Conversations", conversations.count],
    ["Orders", orders.count], ["Leads", leads.count], ["AI runs recorded", aiEvents.count],
  ];
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/">EasyReach</a><div className="tenant-name">{tenant.name}</div>
        <nav><a href="/dashboard">Overview</a><a href="/agent">AI Agent</a><a href="/channels">Channels</a><a href="/inbox">Shared Inbox</a><a href="/customers">Customers</a><a href="/products">Products</a><a href="/orders">Orders</a><a className="active" href="/analytics">Analytics</a><a href="/settings">Settings</a></nav>
        <div className="sidebar-bottom"><span>{user.email}</span><span>{membership?.role}</span></div>
      </aside>
      <section className="workspace">
        <header className="workspace-head"><div><div className="eyebrow">Business performance</div><h1>Analytics</h1><p className="muted">A transparent view of records currently stored in your workspace. These are real counts, not estimates or projected revenue.</p></div></header>
        {errors > 0 && <div className="error-card" role="alert">{errors} metric {errors === 1 ? "query was" : "queries were"} unavailable. Review the values marked unavailable below.</div>}
        <section className="metric-grid analytics-metrics">{metrics.map(([label, value]) => <div className="metric card" key={label}><span>{label}</span><strong>{value === null ? "—" : value}</strong></div>)}</section>
        <section className="section analytics-section"><div className="section-head"><div><div className="eyebrow">Channel readiness</div><h2>Connected channels</h2></div></div><div className="card analytics-summary"><div className="analytics-summary-number"><strong>{integrations.error ? "—" : connected}</strong><span>Verified connected integrations</span></div><p className="muted">{integrations.error ? "Connection records could not be loaded." : (integrations.data ?? []).length + " integration records exist in this workspace. Only records with a connected status are counted as connected."}</p><a className="button secondary small" href="/channels">Review channels</a></div></section>
        <section className="section analytics-section"><div className="section-head"><div><div className="eyebrow">Next steps</div><h2>Improve data readiness</h2></div></div><div className="analytics-next-grid"><a className="card analytics-next" href="/products"><strong>Review product catalog <span aria-hidden="true">→</span></strong><p className="muted">Confirm stored prices, availability and inventory before relying on AI product answers.</p></a><a className="card analytics-next" href="/inbox"><strong>Review conversations <span aria-hidden="true">→</span></strong><p className="muted">Follow up with customers and use human handoff when needed.</p></a><a className="card analytics-next" href="/orders"><strong>Review orders <span aria-hidden="true">→</span></strong><p className="muted">Inspect persisted order records and verified payment states.</p></a></div></section>
      </section>
    </main>
  );
}