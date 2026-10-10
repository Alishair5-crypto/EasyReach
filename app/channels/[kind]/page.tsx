import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import WhatsAppSetup from "./whatsapp-setup";

const names: Record<string, string> = {
  website: "Website", whatsapp_meta: "WhatsApp Business (Meta)", whatsapp_evolution: "WhatsApp QR",
  shopify: "Shopify", woocommerce: "WooCommerce", instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok",
  email: "Email", google_sheets: "Google Sheets", crm: "CRM", pos: "POS", custom_api: "Custom API",
};
const whatsappKinds = ["whatsapp_meta", "whatsapp_evolution"];

export default async function Setup({ params }: { params: Promise<{ kind: string }> }) {
  const { tenant, supabase } = await getTenantContext();
  if (!tenant) redirect("/onboarding");
  const { kind } = await params;
  if (!Object.prototype.hasOwnProperty.call(names, kind)) {
    return <main className="workspace standalone"><a className="muted" href="/channels">← All connections</a><div className="error-card">This connection type is not supported.</div></main>;
  }
  const { data, error } = await supabase.from("integrations")
    .select("id,status,error_message,last_sync_at,metadata")
    .eq("tenant_id", tenant.id).eq("kind", kind).maybeSingle();
  if (error) {
    return <main className="workspace standalone"><a className="muted" href="/channels">← All connections</a><div className="error-card">We couldn't load this connection. Please refresh and try again.</div></main>;
  }
  const isWhatsApp = whatsappKinds.includes(kind);
  if (isWhatsApp) {
    return <main className="workspace standalone">
      <a className="muted" href="/channels">← All connections</a>
      <div className="hero compact"><div className="eyebrow">Guided connection</div><h1>{names[kind]}</h1><p>Connect and verify the real provider account. EasyReach will not mark a channel connected until provider verification succeeds.</p></div>
      <WhatsAppSetup kind={kind} integrationId={data?.id ?? ""} status={data?.status ?? "not_connected"} metadata={data?.metadata ?? null} />
    </main>;
  }
  return <main className="workspace standalone">
    <a className="muted" href="/channels">← All connections</a>
    <div className="hero compact"><div className="eyebrow">Guided connection</div><h1>{names[kind]}</h1><p>Connect → Verify → Configure → Sync → Test → Activate.</p></div>
    <div className="card">
      <div className="section-head"><h2>Connection status</h2><span className={"status " + (data?.status === "connected" ? "good" : data?.status === "error" ? "bad" : "")}>{data?.status ?? "not connected"}</span></div>
      <p className="muted">{data?.error_message ?? (data?.last_sync_at ? "A sync timestamp is available. Run a fresh provider verification before relying on the connection." : "A verified setup flow for this provider is not yet available in this workspace. No connection has been created or simulated.")}</p>
      <p className="muted small-note">Return to Channels to review the other available connection types. This screen does not claim a successful integration.</p>
    </div>
  </main>;
}