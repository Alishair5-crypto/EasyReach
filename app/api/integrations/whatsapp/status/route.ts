import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { getIntegrationSecret } from "@/lib/integrations/server";
import { getEvolutionStatus, verifyMetaCredentials } from "@/lib/integrations/whatsapp";
import { normalizeEvolutionConnectionStatus } from "@/lib/integrations/whatsapp-status";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { tenant, user, membership, supabase } = await getTenantContext();
    if (!tenant || !membership || !user) return NextResponse.json({ error: "workspace_required" }, { status: 400 });
    if (!["owner", "admin", "manager"].includes(membership.role)) return NextResponse.json({ error: "not_authorized" }, { status: 403 });

    const body = await req.json().catch(() => null);
    const integrationId = typeof body?.integrationId === "string" ? body.integrationId : "";
    if (!integrationId) return NextResponse.json({ error: "integration_id_required" }, { status: 400 });

    const { data: integration, error } = await supabase.from("integrations")
      .select("id,tenant_id,kind,status,display_name,provider_external_id,last_sync_at,error_message,metadata")
      .eq("id", integrationId).eq("tenant_id", tenant.id).maybeSingle();
    if (error) throw error;
    if (!integration || !["whatsapp_meta", "whatsapp_evolution"].includes(integration.kind)) {
      return NextResponse.json({ error: "whatsapp_integration_not_found" }, { status: 404 });
    }

    const { secret } = await getIntegrationSecret(integration.id);
    const providerStatus = integration.kind === "whatsapp_meta"
      ? await verifyMetaCredentials(secret)
      : await getEvolutionStatus(secret);
    const now = new Date().toISOString();
    const normalizedStatus = integration.kind === "whatsapp_meta"
      ? "connected"
      : normalizeEvolutionConnectionStatus(providerStatus);

    const metadata = {
      ...(integration.metadata ?? {}),
      last_verified_at: now,
      ...(integration.kind === "whatsapp_meta"
        ? {
            display_phone_number: providerStatus.display_phone_number ?? null,
            verified_name: providerStatus.verified_name ?? null,
            quality_rating: providerStatus.quality_rating ?? null,
          }
        : {}),
    };

    const { error: updateError } = await supabase.from("integrations").update({
      status: normalizedStatus, last_sync_at: now, error_message: null, updated_at: now, metadata,
    }).eq("id", integration.id).eq("tenant_id", tenant.id);
    if (updateError) throw updateError;

    await supabase.from("audit_logs").insert({
      tenant_id: tenant.id, actor_id: user.id, action: "integration.whatsapp.status_checked",
      resource_type: "integration", resource_id: integration.id,
      new_data: { provider: integration.kind, status: normalizedStatus },
    });

    return NextResponse.json({
      integrationId: integration.id, provider: integration.kind, status: normalizedStatus,
      displayName: integration.display_name, providerExternalId: integration.provider_external_id, lastSyncAt: now,
      providerStatus: integration.kind === "whatsapp_meta"
        ? { id: providerStatus.id ?? null, display_phone_number: providerStatus.display_phone_number ?? null, verified_name: providerStatus.verified_name ?? null, quality_rating: providerStatus.quality_rating ?? null }
        : providerStatus,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "whatsapp_status_check_failed";
    return NextResponse.json({
      error: message.startsWith("whatsapp_") || message.endsWith("_not_configured") ? message : "whatsapp_status_check_failed",
    }, { status: 502 });
  }
}
