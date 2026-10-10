import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";

const channels: Array<[string, string, string]> = [
  ["whatsapp_meta", "WhatsApp Business", "Official Meta Cloud API connection."],
  ["whatsapp_evolution", "WhatsApp QR", "Connect a WhatsApp session by scanning a QR code."],
  ["instagram", "Instagram", "Business messaging, subject to Meta permissions."],
  ["facebook", "Facebook", "Facebook Page messaging, subject to Meta permissions."],
  ["tiktok", "TikTok", "Availability depends on approved provider access."],
  ["email", "Email", "Connect an authorized business mailbox."],
  ["website", "Website", "Add a customer-facing assistant to your brand website."],
  ["shopify", "Shopify", "Connect store and approved catalog data."],
  ["woocommerce", "WooCommerce", "Connect store and approved catalog data."],
  ["google_sheets", "Google Sheets", "Use an approved sheet as business data."],
  ["crm", "CRM", "Connect an existing customer system."],
  ["pos", "POS", "Connect a supported point-of-sale system."],
  ["custom_api", "Custom API", "Connect a documented business API."],
];

export default async function Channels() {
  const { tenant, supabase } = await getTenantContext();
  if (!tenant) redirect("/onboarding");
  const { data, error } = await supabase.from("integrations")
    .select("id,kind,status,last_sync_at,error_message")
    .eq("tenant_id", tenant.id).order("kind");
  if (error) return <main className="workspace standalone"><a className="muted" href="/dashboard">← Dashboard</a><div className="error-card">We couldn't load your connections. Please refresh and try again.</div></main>;
  const rows = data ?? [];
  const statusLabel = (status?: string) => status === "connected" ? "Connected" : status === "error" ? "Needs attention" : status === "connecting" || status === "pending" || status === "qr_ready" ? status.replace("_", " ") : "Not connected";
  return <main className="workspace standalone">
    <a className="muted" href="/dashboard">← Dashboard</a>
    <div className="hero compact"><div className="eyebrow">Business connections</div><h1>Channels & integrations</h1><p>Review the channels your business may connect. Status reflects stored integration records; unsupported setup flows are clearly identified.</p></div>
    <div className="channel-grid">{channels.map(([kind, name, description]) => {
      const integration = rows.find(row => row.kind === kind);
      const status = integration?.status;
      return <article className="channel-card" key={kind}>
        <div className="channel-title"><h3>{name}</h3><span className={"status " + (status === "connected" ? "good" : status === "error" ? "bad" : "")}>{statusLabel(status)}</span></div>
        <p>{integration?.error_message ?? description}</p>
        {integration?.last_sync_at && <p className="muted">Last sync: {new Date(integration.last_sync_at).toLocaleString()}</p>}
        <a className="button secondary small" href={"/channels/" + kind}>{status === "connected" ? "Manage connection" : "View setup"}</a>
      </article>;
    })}</div>
  </main>;
}