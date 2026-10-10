import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import AgentPlayground from "./agent-playground";

type Agent = { id: string; name: string; status: string; language_mode: string | null };

export default async function AgentPage() {
  const { tenant, supabase, user, membership } = await getTenantContext();
  if (!tenant) redirect("/onboarding");
  const { data, error } = await supabase.from("agents")
    .select("id,name,status,language_mode")
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: true });
  const agents = (data ?? []) as Agent[];
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/">EasyReach</a>
        <div className="tenant-name">{tenant.name}</div>
        <nav>
          <a href="/dashboard">Overview</a>
          <a className="active" href="/agent">AI Agent</a>
          <a href="/channels">Channels</a>
          <a href="/inbox">Shared Inbox</a>
          <a href="/customers">Customers</a>
          <a href="/products">Products</a>
          <a href="/orders">Orders</a><a href="/analytics">Analytics</a>
          <a href="/settings">Settings</a>
        </nav>
        <div className="sidebar-bottom"><span>{user.email}</span><span>{membership?.role}</span></div>
      </aside>
      <section className="workspace">
        <header className="workspace-head">
          <div><div className="eyebrow">AI workforce</div><h1>Test your sales agent</h1><p className="muted">Try real responses using this workspace’s approved business data. The playground never invents a successful connection or order.</p></div>
        </header>
        {error ? <div className="error-card">We couldn't load your agent. Please refresh and try again.</div> : agents.length ? <AgentPlayground agent={agents[0]} /> : <div className="empty-card"><strong>No AI agent found</strong><p className="muted">This workspace does not have an agent record yet, so the playground is unavailable.</p></div>}
      </section>
    </main>
  );
}