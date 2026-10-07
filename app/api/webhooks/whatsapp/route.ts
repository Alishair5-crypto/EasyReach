import { NextResponse } from "next/server";
import { createPrivilegedClient } from "@/lib/integrations/server";
import { decryptSecret, hmacSha256Hex, sha256, timingSafeEqualHex } from "@/lib/integrations/secrets";

export const runtime = "nodejs";

function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function findIntegration(admin: ReturnType<typeof createPrivilegedClient>, provider: string, externalId: string) {
  const { data, error } = await admin.from("integrations")
    .select("id,tenant_id,kind,status,provider_external_id,metadata")
    .eq("kind", provider).eq("provider_external_id", externalId).maybeSingle();
  if (error) throw error;
  return data;
}

async function processInbound(admin: ReturnType<typeof createPrivilegedClient>, integration: any, externalId: string, customerName: string | null, text: string | null, messageType: string, messageId: string, timestamp: string | null, metadata: Record<string, unknown>) {
  if (!externalId || !messageId) return;
  const tenantId = integration.tenant_id as string;
  const customerKey = \`whatsapp:${externalId}\`;

  const { data: identity } = await admin.from("customer_identities").select("customer_id").eq("tenant_id", tenantId).eq("channel", "whatsapp").eq("external_id", externalId).maybeSingle();
  let customerId = identity?.customer_id as string | undefined;

  if (!customerId) {
    const { data: customer, error } = await admin.from("customers").upsert(
      { tenant_id: tenantId, external_key: customerKey, name: customerName, phone: externalId, last_seen_at: new Date().toISOString() },
      { onConflict: "tenant_id,external_key" }
    ).select("id").single();
    if (error) throw error;
    customerId = customer.id;
    await admin.from("customer_identities").upsert({
      tenant_id: tenantId, customer_id: customerId, channel: "whatsapp", external_id: externalId,
      display_name: customerName, phone: externalId, metadata: { provider: integration.kind }
    }, { onConflict: "tenant_id,channel,external_id" });
  } else {
    await admin.from("customers").update({ name: customerName ?? undefined, phone: externalId, last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", customerId);
  }

  const conversationExternalId = \`${integration.kind}:${integration.provider_external_id}:${externalId}\`;
  const { data: conversation, error: conversationError } = await admin.from("conversations").upsert({
    tenant_id: tenantId, customer_id: customerId, channel: "whatsapp", external_id: conversationExternalId,
    status: "open", last_message_at: timestamp ? new Date(Number(timestamp) * 1000).toISOString() : new Date().toISOString()
  }, { onConflict: "tenant_id,channel,external_id" }).select("id").single();
  if (conversationError) throw conversationError;

  const { error: messageError } = await admin.from("messages").upsert({
    tenant_id: tenantId, conversation_id: conversation.id, direction: "inbound", sender_type: "customer",
    external_id: messageId, content: text, media: { message_type: messageType, provider: integration.kind, ...metadata },
    created_at: timestamp ? new Date(Number(timestamp) * 1000).toISOString() : new Date().toISOString()
  }, { onConflict: "tenant_id,external_id" });
  if (messageError) throw messageError;

  await admin.from("integrations").update({ status: "connected", last_sync_at: new Date().toISOString(), error_message: null, updated_at: new Date().toISOString() }).eq("id", integration.id).eq("tenant_id", tenantId);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token") ?? "";
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  if (mode !== "subscribe" || !token || !challenge) return new Response("Forbidden", { status: 403 });
  try {
    const admin = createPrivilegedClient();
    const { data: integrations, error } = await admin.from("integrations").select("id,metadata").eq("kind", "whatsapp_meta");
    if (error) throw error;
    const tokenHash = sha256(token);
    const match = (integrations ?? []).find((x: any) => timingSafeEqualHex(String(x.metadata?.verify_token_hash ?? ""), tokenHash));
    if (!match) return new Response("Forbidden", { status: 403 });
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
  } catch {
    return new Response("Webhook verification unavailable", { status: 503 });
  }
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  if (rawBody.length > 1024 * 1024) return jsonResponse({ error: "payload_too_large" }, 413);

  try {
    const body = JSON.parse(rawBody);
    const admin = createPrivilegedClient();

    let provider: "whatsapp_meta" | "whatsapp_evolution";
    let externalId = "";

    if (body?.object === "whatsapp_business_account") {
      provider = "whatsapp_meta";
      externalId = String(body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id ?? "");
    } else {
      provider = "whatsapp_evolution";
      externalId = String(body?.instance ?? body?.data?.instance ?? "");
    }
    if (!externalId) return jsonResponse({ error: "integration_identifier_missing" }, 400);

    const integration = await findIntegration(admin, provider, externalId);
    if (!integration) return jsonResponse({ error: "integration_not_found" }, 404);

    const { secret } = await (async () => {
      const row = await admin.from("integration_secrets").select("encrypted_payload").eq("integration_id", integration.id).maybeSingle();
      if (row.error) throw row.error;
      if (!row.data) throw new Error("integration_secret_missing");
      return { secret: decryptSecret<Record<string, unknown>>(row.data.encrypted_payload) };
    })();

    if (provider === "whatsapp_meta") {
      const signature = req.headers.get("x-hub-signature-256") ?? "";
      const expected = hmacSha256Hex(String(secret.app_secret ?? ""), rawBody);
      const supplied = signature.startsWith("sha256=") ? signature.slice(7) : "";
      if (!timingSafeEqualHex(expected, supplied)) return jsonResponse({ error: "invalid_signature" }, 403);
    } else {
      const supplied = req.headers.get("x-easyreach-webhook-secret") ?? "";
      const expected = String(secret.webhook_secret ?? "");
      if (!expected || supplied !== expected) return jsonResponse({ error: "invalid_signature" }, 403);
    }

    const eventId = \`${provider}:${sha256(rawBody)}\`;
    const { data: receipt, error: receiptError } = await admin.from("webhook_events").insert({
      tenant_id: integration.tenant_id, integration_id: integration.id, provider, external_event_id: eventId,
      event_type: provider === "whatsapp_meta" ? "whatsapp_business_account" : String(body.event ?? "unknown"),
      payload: body, signature_verified: true, status: "processing"
    }).select("id").single();
    if (receiptError) {
      if (receiptError.code === "23505") return jsonResponse({ received: true, duplicate: true });
      throw receiptError;
    }

    if (provider === "whatsapp_meta") {
      for (const entry of body.entry ?? []) {
        for (const change of entry.changes ?? []) {
          const value = change.value ?? {};
          for (const message of value.messages ?? []) {
            const from = String(message.from ?? "");
            const contacts = Array.isArray(value.contacts) ? value.contacts : [];
            const contact = contacts.find((x: any) => String(x.wa_id ?? "") === from);
            const text = message.type === "text" ? String(message.text?.body ?? "") : null;
            await processInbound(admin, integration, from, contact?.profile?.name ? String(contact.profile.name).slice(0,200) : null, text, String(message.type ?? "unknown"), String(message.id ?? ""), message.timestamp ? String(message.timestamp) : null, { context: message.context ?? null });
          }
        }
      }
    } else {
      const event = String(body.event ?? "").toUpperCase();
      const data = body.data ?? {};
      if (event.includes("CONNECTION")) {
        const state = String(data.state ?? data.status ?? "").toLowerCase();
        const status = state === "open" || state === "connected" ? "connected" : state === "connecting" ? "connecting" : state === "close" || state === "closed" ? "disconnected" : "preparing";
        await admin.from("integrations").update({ status, last_sync_at: new Date().toISOString(), error_message: null }).eq("id", integration.id).eq("tenant_id", integration.tenant_id);
      }
      const messages = Array.isArray(data) ? data : [data];
      if (event.includes("MESSAGE") || event.includes("MESSAGES_UPSERT")) {
        for (const item of messages) {
          const key = item.key ?? {};
          if (key.fromMe) continue;
          const from = String(key.remoteJid ?? "").split("@")[0];
          const message = item.message ?? {};
          const text = message.conversation ?? message.extendedTextMessage?.text ?? message.imageMessage?.caption ?? null;
          await processInbound(admin, integration, from, item.pushName ? String(item.pushName).slice(0,200) : null, typeof text === "string" ? text : null, "message", String(key.id ?? ""), item.messageTimestamp ? String(item.messageTimestamp) : null, {});
        }
      }
    }

    await admin.from("webhook_events").update({ status: "processed", processed_at: new Date().toISOString(), error_message: null }).eq("id", receipt.id);
    return jsonResponse({ received: true });
  } catch (e) {
    return jsonResponse({ error: "webhook_processing_failed" }, 500);
  }
}