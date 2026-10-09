import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { getIntegrationSecret } from "@/lib/integrations/server";
import { configureEvolutionWebhook, getEvolutionQr } from "@/lib/integrations/whatsapp";

export async function POST(req: Request) {
  try {
    const { tenant, membership, supabase } = await getTenantContext();
    if (!tenant || !membership) return NextResponse.json({ error: "workspace_required" }, { status: 400 });
    if (!["owner", "admin", "manager"].includes(membership.role)) return NextResponse.json({ error: "not_authorized" }, { status: 403 });

    const body = await req.json().catch(() => null);
    const integrationId = typeof body?.integrationId === "string" ? body.integrationId : "";
    if (!integrationId) return NextResponse.json({ error: "integration_id_required" }, { status: 400 });

    const { data: integration, error } = await supabase.from("integrations")
      .select("id,tenant_id,kind,status").eq("id", integrationId).eq("tenant_id", tenant.id).maybeSingle();
    if (error) throw error;
    if (!integration || integration.kind !== "whatsapp_evolution") return NextResponse.json({ error: "evolution_integration_not_found" }, { status: 404 });

    const { provider, secret } = await getIntegrationSecret(integration.id);
    if (provider !== "whatsapp_evolution") {
      return NextResponse.json({ error: "evolution_integration_not_found" }, { status: 404 });
    }
    const result = await getEvolutionQr(secret);
    await configureEvolutionWebhook(secret);

    const { error: updateError } = await supabase.from("integrations").update({
      status: "qr_ready",
      error_message: null,
      updated_at: new Date().toISOString(),
    }).eq("id", integration.id).eq("tenant_id", tenant.id);
    if (updateError) throw updateError;

    return NextResponse.json({ integrationId, status: "qr_ready", providerResponse: result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "whatsapp_qr_failed";
    return NextResponse.json({ error: message.startsWith("whatsapp_") || message.endsWith("_not_configured") ? message : "whatsapp_qr_failed" }, { status: 502 });
  }
}