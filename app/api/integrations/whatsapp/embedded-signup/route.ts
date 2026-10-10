import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { encryptSecret, sha256 } from "@/lib/integrations/secrets";
import { createPrivilegedClient } from "@/lib/integrations/server";
import { exchangeMetaEmbeddedSignup, subscribeMetaWaba } from "@/lib/integrations/whatsapp";

function text(value: unknown, max = 5000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function validId(value: string): boolean {
  return /^[0-9A-Za-z_-]{2,200}$/.test(value);
}

export async function POST(req: Request) {
  try {
    const { tenant, user, membership, supabase } = await getTenantContext();
    if (!tenant || !user || !membership) {
      return NextResponse.json({ error: "workspace_required" }, { status: 400 });
    }
    if (!["owner", "admin", "manager"].includes(membership.role)) {
      return NextResponse.json({ error: "not_authorized" }, { status: 403 });
    }

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "invalid_request_body" }, { status: 400 });
    }
    const input = body as Record<string, unknown>;
    const code = text(input.code, 10000);
    const wabaId = text(input.waba_id, 200);
    const phoneNumberId = text(input.phone_number_id, 200);
    const businessId = text(input.business_id, 200);
    const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN ?? "";
    const appSecret = process.env.META_APP_SECRET ?? "";

    if (!code || !validId(wabaId) || (phoneNumberId && !validId(phoneNumberId))) {
      return NextResponse.json({ error: "meta_signup_data_required" }, { status: 400 });
    }
    if (!verifyToken || !appSecret) {
      return NextResponse.json({ error: "meta_webhook_not_configured" }, { status: 503 });
    }

    const admin = createPrivilegedClient();
    const exchanged = await exchangeMetaEmbeddedSignup(code, wabaId, phoneNumberId || undefined);
    const resolvedPhoneId = text(exchanged.phoneNumberId, 200);
    if (!validId(resolvedPhoneId)) {
      return NextResponse.json({ error: "meta_embedded_signup_phone_verification_failed" }, { status: 502 });
    }

    const { data: claimed, error: claimError } = await admin
      .from("integrations")
      .select("id,tenant_id")
      .eq("kind", "whatsapp_meta")
      .eq("provider_external_id", resolvedPhoneId)
      .maybeSingle();
    if (claimError) throw new Error("meta_embedded_signup_claim_check_failed");
    if (claimed && claimed.tenant_id !== tenant.id) {
      return NextResponse.json({ error: "whatsapp_number_already_connected" }, { status: 409 });
    }

    const secret = {
      access_token: exchanged.accessToken,
      app_secret: appSecret,
      phone_number_id: resolvedPhoneId,
      waba_id: wabaId,
      business_id: businessId || undefined,
    };
    const metadata = {
      verify_token_hash: sha256(verifyToken),
      waba_id: wabaId,
      business_id: businessId || null,
      display_phone_number: exchanged.phone.display_phone_number ?? null,
      verified_name: exchanged.phone.verified_name ?? null,
      quality_rating: exchanged.phone.quality_rating ?? null,
    };
    const displayName = text(exchanged.phone.verified_name, 200) || "WhatsApp Cloud API";
    let integrationId = claimed?.id as string | undefined;

    if (integrationId) {
      const { error } = await supabase.from("integrations").update({
        status: "preparing",
        display_name: displayName,
        provider_external_id: resolvedPhoneId,
        metadata,
        error_message: null,
        updated_at: new Date().toISOString(),
      }).eq("id", integrationId).eq("tenant_id", tenant.id);
      if (error) throw new Error("meta_embedded_signup_integration_save_failed");
    } else {
      const { data, error } = await supabase.from("integrations").insert({
        tenant_id: tenant.id,
        kind: "whatsapp_meta",
        status: "preparing",
        display_name: displayName,
        provider_external_id: resolvedPhoneId,
        metadata,
      }).select("id").single();
      if (error) throw new Error("meta_embedded_signup_integration_save_failed");
      integrationId = data.id;
    }

    const { error: secretError } = await admin.from("integration_secrets").upsert({
      tenant_id: tenant.id,
      integration_id: integrationId,
      provider: "whatsapp_meta",
      encrypted_payload: encryptSecret(secret),
      key_version: 1,
      updated_at: new Date().toISOString(),
    }, { onConflict: "integration_id" });
    if (secretError) throw new Error("meta_embedded_signup_secret_save_failed");

    await subscribeMetaWaba(secret);

    // Record successful provider verification before marking the integration connected.
    // If audit persistence fails, the integration remains in "preparing" and can be retried.
    const { error: auditError } = await admin.from("audit_logs").insert({
      tenant_id: tenant.id,
      actor_id: user.id,
      action: "integration.whatsapp.embedded_signup_verified",
      resource_type: "integration",
      resource_id: integrationId,
      new_data: {
        provider: "whatsapp_meta",
        phone_number_id: resolvedPhoneId,
        waba_id: wabaId,
      },
    });
    if (auditError) throw new Error("meta_embedded_signup_audit_failed");

    const now = new Date().toISOString();
    const { error: statusError } = await supabase.from("integrations").update({
      status: "connected",
      last_sync_at: now,
      error_message: null,
      updated_at: now,
    }).eq("id", integrationId).eq("tenant_id", tenant.id);
    if (statusError) throw new Error("meta_embedded_signup_status_save_failed");

    return NextResponse.json({
      integrationId,
      status: "connected",
      displayName,
      displayPhoneNumber: exchanged.phone.display_phone_number ?? null,
      webhookUrl: exchanged.webhookUrl,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "meta_embedded_signup_failed";
    const knownErrors = [
      "meta_embedded_signup_not_configured",
      "meta_embedded_signup_code_exchange_failed",
      "meta_embedded_signup_phone_verification_failed",
      "meta_embedded_signup_phone_mismatch",
      "meta_embedded_signup_waba_verification_failed",
      "whatsapp_number_already_connected",
      "meta_webhook_not_configured",
      "meta_embedded_signup_claim_check_failed",
      "meta_embedded_signup_integration_save_failed",
      "meta_embedded_signup_secret_save_failed",
      "meta_embedded_signup_status_save_failed",
      "meta_embedded_signup_audit_failed",
    ];
    const safeError = knownErrors.includes(message) ? message : "meta_embedded_signup_failed";
    const status = safeError === "whatsapp_number_already_connected" ? 409
      : safeError === "meta_webhook_not_configured" || safeError === "meta_embedded_signup_not_configured" ? 503
      : safeError === "meta_embedded_signup_phone_verification_failed" ? 502
      : 502;
    return NextResponse.json({ error: safeError }, { status });
  }
}
