import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createPrivilegedClient } from "@/lib/integrations/server";
import { getEvolutionQr } from "@/lib/integrations/whatsapp";

export async function POST(req: Request) {
  try {
    const { tenant, membership, supabase } = await getTenantContext();
    if (!tenant || !membership) return NextResponse.json({ error: "workspace_required" }, { status: 400 });
    try { const { requireFeature } = await import("@/lib/entitlements"); await requireFeature(tenant.id, "whatsapp", supabase); } catch (e) { const m = e instanceof Error ? e.message : ""; if (["feature_not_entitled", "plan_inactive", "plan_not_started"].includes(m)) return NextResponse.json({ error: m }, { status: m === "feature_not_entitled" ? 403 : 402 }); throw e; }
    if (!["owner", "admin", "manager"].includes(membership.role)) return NextResponse.json({ error: "not_authorized" }, { status: 403 });

    const body = await req.json().catch(() => null);
    const integrationId = typeof body?.integrationId === "string" ? body.integrationId : "";
    if (!integrationId) return NextResponse.json({ error: "integration_id_required" }, { status: 400 });

    const { data: integration, error } = await supabase.from("integrations")
      .select("id,tenant_id,kind,status").eq("id", integrationId).eq("tenant_id", tenant.id).maybeSingle();
    if (error) throw error;
    if (!integration || integration.kind !== "whatsapp_evolution") return NextResponse.json({ error: "evolution_integration_not_found" }, { status: 404 });

    const admin = createPrivilegedClient();
    const result = await getEvolutionQr(await (async () => {
      const row = await admin.from("integration_secrets").select("encrypted_payload").eq("integration_id", integration.id).maybeSingle();
      if (row.error) throw row.error;
      if (!row.data) throw new Error("integration_secret_missing");
      const { decryptSecret } = await import("@/lib/integrations/secrets");
      return decryptSecret<Record<string, unknown>>(row.data.encrypted_payload);
    })());

    await supabase.from("integrations").update({
      status: "qr_ready", error_message: null, updated_at: new Date().toISOString()
    }).eq("id", integration.id).eq("tenant_id", tenant.id);

    return NextResponse.json({ integrationId, status: "qr_ready", providerResponse: result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "whatsapp_qr_failed";
    if (["feature_not_entitled", "plan_inactive", "plan_not_started"].includes(message)) return NextResponse.json({ error: message }, { status: message === "feature_not_entitled" ? 403 : 402 });
    return NextResponse.json({ error: message.startsWith("whatsapp_") || message.endsWith("_not_configured") ? message : "whatsapp_qr_failed" }, { status: 502 });
  }
}