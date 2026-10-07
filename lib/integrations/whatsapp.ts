import { getIntegrationSecret } from "./server";

export type WhatsAppProvider = "whatsapp_meta" | "whatsapp_evolution";

export async function verifyMetaCredentials(secret: Record<string, unknown>) {
  const token = typeof secret.access_token === "string" ? secret.access_token : "";
  const phoneNumberId = typeof secret.phone_number_id === "string" ? secret.phone_number_id : "";
  if (!token || !phoneNumberId) throw new Error("whatsapp_meta_credentials_invalid");
  const version = process.env.META_GRAPH_API_VERSION ?? "v25.0";
  const response = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId)}?fields=id,display_phone_number,verified_name,quality_rating`, {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
  });
  if (!response.ok) throw new Error(`whatsapp_meta_verify_failed:${response.status}`);
  return await response.json() as Record<string, unknown>;
}

export async function subscribeMetaWaba(secret: Record<string, unknown>) {
  const token = typeof secret.access_token === "string" ? secret.access_token : "";
  const wabaId = typeof secret.waba_id === "string" ? secret.waba_id : "";
  if (!token || !wabaId) return { subscribed: false, reason: "waba_id_required" };
  const version = process.env.META_GRAPH_API_VERSION ?? "v25.0";
  const response = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(wabaId)}/subscribed_apps`, {
    method: "POST", headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
  });
  if (!response.ok) throw new Error(`whatsapp_meta_waba_subscribe_failed:${response.status}`);
  return { subscribed: true };
}

export async function getEvolutionStatus(secret: Record<string, unknown>) {
  const baseUrl = typeof secret.base_url === "string" ? secret.base_url.replace(/\/+$/, "") : "";
  const apiKey = typeof secret.api_key === "string" ? secret.api_key : "";
  const instance = typeof secret.instance_name === "string" ? secret.instance_name : "";
  if (!baseUrl || !apiKey || !instance) throw new Error("whatsapp_evolution_credentials_invalid");
  const urls = [`${baseUrl}/instance/status`, `${baseUrl}/instance/${encodeURIComponent(instance)}/status`];
  for (const url of urls) {
    const response = await fetch(url, { headers: { apikey: apiKey }, cache: "no-store" });
    if (response.ok) return await response.json() as Record<string, unknown>;
  }
  throw new Error("whatsapp_evolution_status_failed");
}

export async function getEvolutionQr(secret: Record<string, unknown>) {
  const baseUrl = typeof secret.base_url === "string" ? secret.base_url.replace(/\/+$/, "") : "";
  const apiKey = typeof secret.api_key === "string" ? secret.api_key : "";
  const instance = typeof secret.instance_name === "string" ? secret.instance_name : "";
  if (!baseUrl || !apiKey || !instance) throw new Error("whatsapp_evolution_credentials_invalid");
  const response = await fetch(`${baseUrl}/instance/connect`, {
    method: "POST", headers: { "Content-Type": "application/json", apikey: apiKey },
    body: JSON.stringify({ webhookUrl: webhookUrl(), subscribe: ["MESSAGE", "CONNECTION", "QRCODE"] }), cache: "no-store",
  });
  if (response.ok) return await response.json();
  const qr = await fetch(`${baseUrl}/instance/${encodeURIComponent(instance)}/qrcode`, { headers: { apikey: apiKey }, cache: "no-store" });
  if (qr.ok) return await qr.json();
  throw new Error("whatsapp_evolution_qr_failed");
}

function webhookUrl() {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  if (!base) throw new Error("app_url_not_configured");
  return `${base.replace(/\/+$/, "")}/api/webhooks/whatsapp`;
}

export async function sendWhatsAppText(integrationId: string, to: string, text: string) {
  const { provider, secret } = await getIntegrationSecret(integrationId);
  if (provider === "whatsapp_meta") {
    const token = typeof secret.access_token === "string" ? secret.access_token : "";
    const phoneNumberId = typeof secret.phone_number_id === "string" ? secret.phone_number_id : "";
    const version = process.env.META_GRAPH_API_VERSION ?? "v25.0";
    const response = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body: text } }), cache: "no-store",
    });
    if (!response.ok) throw new Error("whatsapp_meta_send_failed");
    return await response.json();
  }
  const baseUrl = typeof secret.base_url === "string" ? secret.base_url.replace(/\/+$/, "") : "";
  const apiKey = typeof secret.api_key === "string" ? secret.api_key : "";
  const instance = typeof secret.instance_name === "string" ? secret.instance_name : "";
  const response = await fetch(`${baseUrl}/message/sendText/${encodeURIComponent(instance)}`, {
    method: "POST", headers: { "Content-Type": "application/json", apikey: apiKey },
    body: JSON.stringify({ number: to, textMessage: { text } }), cache: "no-store",
  });
  if (!response.ok) throw new Error("whatsapp_evolution_send_failed");
  return await response.json();
}