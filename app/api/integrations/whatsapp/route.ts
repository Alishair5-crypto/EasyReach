import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getTenantContext } from "@/lib/auth";
import { encryptSecret, sha256 } from "@/lib/integrations/secrets";
import { createPrivilegedClient } from "@/lib/integrations/server";
import { getEvolutionStatus, subscribeMetaWaba, verifyMetaCredentials } from "@/lib/integrations/whatsapp";

function text(value: unknown, max = 5000) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function validId(value: string) { return /^[0-9A-Za-z_-]{2,200}$/.test(value); }
function publicHttpsUrl(value: string) {
  try {
    const url = new URL(value); if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".local") || host === "127.0.0.1" || host === "::1") return false;
    if (/^(10|127)\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return false;
    return true;
  } catch { return false; }
}

export async function POST(req: Request) {
  try {
    const { tenant, user, membership, supabase } = await getTenantContext();
    if (!tenant || !user || !membership) return NextResponse.json({ error: "workspace_required" }, { status: 400 });
    if (!["owner", "admin", "manager"].includes(membership.role)) return NextResponse.json({ error: "not_authorized" }, { status: 403 });

    const body = await req.json().catch(() => null);
    const provider = body?.provider === "whatsapp_meta" || body?.provider === "whatsapp_evolution" ? body.provider : null;
    if (!provider) return NextResponse.json({ error: "provider_required" }, { status: 400 });

    const existing = await supabase.from("integrations").select("id").eq("tenant_id", tenant.id).eq("kind", provider).maybeSingle();
    if (existing.error) throw existing.error;

    let integrationId = existing.data?.id as string | undefined;
    const secret: Record<string, unknown> = {};
    let externalId = ""; let displayName = "";

    if (provider === "whatsapp_meta") {
      const accessToken = text(body.access_token, 10000), appSecret = text(body.app_secret, 1000);
      const phoneNumberId = text(body.phone_number_id, 200), wabaId = text(body.waba_id, 200);
      let verifyToken = text(body.verify_token, 500);
      if (!accessToken || !appSecret || !phoneNumberId || !validId(phoneNumberId)) return NextResponse.json({ error: "meta_credentials_required" }, { status: 400 });
      if (!verifyToken) verifyToken = randomBytes(24).toString("base64url");
      Object.assign(secret, { access_token: accessToken, app_secret: appSecret, phone_number_id: phoneNumberId, waba_id: wabaId || undefined, verify_token: verifyToken });
      externalId = phoneNumberId; displayName = text(body.display_name, 200) || "WhatsApp Cloud API";
    } else {
      const baseUrl = text(body.base_url, 2000).replace(/\/+$/, ""), apiKey = text(body.api_key, 5000), instanceName = text(body.instance_name, 200);
      const webhookSecret = text(body.webhook_secret, 500);
      if (!baseUrl || !apiKey || !instanceName || !publicHttpsUrl(baseUrl) || !/^[A-Za-z0-9_-]{2,100}$/.test(instanceName) || !webhookSecret) return NextResponse.json({ error: "evolution_credentials_required" }, { status: 400 });
      Object.assign(secret, { base_url: baseUrl, api_key: apiKey, instance_name: instanceName, webhook_secret: webhookSecret });
      externalId = instanceName; displayName = text(body.display_name, 200) || "WhatsApp QR";
    }

    const metadata = provider === "whatsapp_meta"
      ? { verify_token_hash: sha256(String(secret.verify_token)), waba_id: secret.waba_id ?? null }
      : { webhook_header: "x-easyreach-webhook-secret" };

    if (integrationId) {
      const { error } = await supabase.from("integrations").update({ status: "preparing", display_name: displayName, provider_external_id: externalId, metadata, error_message: null, updated_at: new Date().toISOString() }).eq("id", integrationId).eq("tenant_id", tenant.id);
      if (error) throw error;
    } else {
      const { data, error } = await supabase.from("integrations").insert({ tenant_id: tenant.id, kind: provider, status: "preparing", display_name: displayName, provider_external_id: externalId, metadata }).select("id").single();
      if (error) throw error; integrationId = data.id;
    }

    const admin = createPrivilegedClient();
    const { error: secretError } = await admin.from("integration_secrets").upsert({ tenant_id: tenant.id, integration_id: integrationId, provider, encrypted_payload: encryptSecret(secret), key_version: 1, updated_at: new Date().toISOString() }, { onConflict: "integration_id" });
    if (secretError) throw secretError;

    let verification: Record<string, unknown> = {};
    if (provider === "whatsapp_meta") {
      verification = await verifyMetaCredentials(secret);
      if (secret.waba_id) await subscribeMetaWaba(secret);
    } else {
      verification = await getEvolutionStatus(secret);
    }

    const { error: statusError } = await supabase.from("integrations").update({ status: "preparing", last_sync_at: new Date().toISOString(), error_message: null, updated_at: new Date().toISOString() }).eq("id", integrationId).eq("tenant_id", tenant.id);
    if (statusError) throw statusError;
    await supabase.from("audit_logs").insert({ tenant_id: tenant.id, actor_id: user.id, action: "integration.whatsapp.configured", resource_type: "integration", resource_id: integrationId, new_data: { provider, provider_external_id: externalId } });

    return NextResponse.json({
      integrationId, provider, status: "preparing",
      verification: provider === "whatsapp_meta" ? { id: verification.id, display_phone_number: verification.display_phone_number, verified_name: verification.verified_name } : { provider_response: verification },
      verifyToken: provider === "whatsapp_meta" ? secret.verify_token : undefined,
      webhookUrl: ${process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "")}/api/webhooks/whatsapp
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "whatsapp_integration_failed";
    return NextResponse.json({ error: message.startsWith("whatsapp_") || message.endsWith("_not_configured") ? message : "whatsapp_integration_failed" }, { status: 502 });
  }
}