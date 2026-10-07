import { getIntegrationSecret } from "./server";

export type WhatsAppProvider = "whatsapp_meta" | "whatsapp_evolution";
const graphVersion = () => process.env.META_GRAPH_API_VERSION ?? "v25.0";
const stripTrailingSlashes = (value: string) => value.replace(/\/+$/, "");
function requiredString(secret: Record<string, unknown>, key: string) {
  return typeof secret[key] === "string" ? secret[key] : "";
}

export async function verifyMetaCredentials(secret: Record<string, unknown>) {
  const token = requiredString(secret, "access_token");
  const phoneNumberId = requiredString(secret, "phone_number_id");
  if (!token || !phoneNumberId) throw new Error("whatsapp_meta_credentials_invalid");
  const response = await fetch(`https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(phoneNumberId)}?fields=id,display_phone_number,verified_name,quality_rating`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!response.ok) throw new Error(`whatsapp_meta_verify_failed:${response.status}`);
  return await response.json() as Record<string, unknown>;
}

export async function subscribeMetaWaba(secret: Record<string, unknown>) {
  const token = requiredString(secret, "access_token");
  const wabaId = requiredString(secret, "waba_id");
  if (!token || !wabaId) return { subscribed: false, reason: "waba_id_required" };
  const response = await fetch(`https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(wabaId)}/subscribed_apps`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!response.ok) throw new Error(`whatsapp_meta_waba_subscribe_failed:${response.status}`);
  return { subscribed: true };
}

export async function getEvolutionStatus(secret: Record<string, unknown>) {
  const baseUrl = stripTrailingSlashes(requiredString(secret, "base_url"));
  const apiKey = requiredString(secret, "api_key");
  const instance = requiredString(secret, "instance_name");
  if (!baseUrl || !apiKey || !instance) throw new Error("whatsapp_evolution_credentials_invalid");
  const urls = [`${baseUrl}/instance/status/${encodeURIComponent(instance)}`, `${baseUrl}/instance/${encodeURIComponent(instance)}/status`, `${baseUrl}/instance/status`];
  for (const url of urls) {
    const response = await fetch(url, { headers: { apikey: apiKey }, cache: "no-store" });
    if (response.ok) return await response.json() as Record<string, unknown>;
  }
  throw new Error("whatsapp_evolution_status_failed");
}

export async function getEvolutionQr(secret: Record<string, unknown>) {
  const baseUrl = stripTrailingSlashes(requiredString(secret, "base_url"));
  const apiKey = requiredString(secret, "api_key");
  const instance = requiredString(secret, "instance_name");
  if (!baseUrl || !apiKey || !instance) throw new Error("whatsapp_evolution_credentials_invalid");
  for (const url of [`${baseUrl}/instance/connect`, `${baseUrl}/instance/${encodeURIComponent(instance)}/connect`]) {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", apikey: apiKey }, body: JSON.stringify({ instanceName: instance, webhookUrl: webhookUrl(), webhookByEvents: true }), cache: "no-store" });
    if (response.ok) return await response.json();
  }
  const qr = await fetch(`${baseUrl}/instance/${encodeURIComponent(instance)}/qrcode`, { headers: { apikey: apiKey }, cache: "no-store" });
  if (qr.ok) return await qr.json();
  throw new Error("whatsapp_evolution_qr_failed");
}

function webhookUrl() {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  if (!base) throw new Error("app_url_not_configured");
  return stripTrailingSlashes(base) + "/api/webhooks/whatsapp";
}

export async function exchangeMetaEmbeddedSignup(code: string, wabaId: string, phoneNumberId?: string) {
  const appId = process.env.META_APP_ID ?? "";
  const appSecret = process.env.META_APP_SECRET ?? "";
  if (!appId || !appSecret) throw new Error("meta_embedded_signup_not_configured");
  const params = new URLSearchParams({ client_id: appId, client_secret: appSecret, code, grant_type: "authorization_code" });
  const redirectUri = process.env.META_EMBEDDED_SIGNUP_REDIRECT_URI;
  if (redirectUri) params.set("redirect_uri", redirectUri);
  const response = await fetch(`https://graph.facebook.com/${graphVersion()}/oauth/access_token?${params.toString()}`, { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload.access_token !== "string") throw new Error("meta_embedded_signup_code_exchange_failed");
  const accessToken = payload.access_token as string;
  let resolvedPhoneId = phoneNumberId ?? "";
  if (!resolvedPhoneId) {
    const list = await fetch(`https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(wabaId)}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating&limit=10`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
    const data = await list.json().catch(() => ({}));
    resolvedPhoneId = typeof data?.data?.[0]?.id === "string" ? data.data[0].id : "";
  }
  if (!resolvedPhoneId) throw new Error("meta_embedded_signup_phone_verification_failed");
  const phoneResponse = await fetch(`https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(resolvedPhoneId)}?fields=id,display_phone_number,verified_name,quality_rating`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  if (!phoneResponse.ok) throw new Error("meta_embedded_signup_phone_verification_failed");
  const phone = await phoneResponse.json() as Record<string, unknown>;
  if (String(phone.id ?? "") !== resolvedPhoneId) throw new Error("meta_embedded_signup_phone_mismatch");
  const wabaResponse = await fetch(`https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(wabaId)}?fields=id,name`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  if (!wabaResponse.ok) throw new Error("meta_embedded_signup_waba_verification_failed");
  const waba = await wabaResponse.json() as Record<string, unknown>;
  return { accessToken, phone, waba, phoneNumberId: resolvedPhoneId, webhookUrl: webhookUrl() };
}

export async function sendWhatsAppText(integrationId: string, to: string, text: string) {
  const { provider, secret } = await getIntegrationSecret(integrationId);
  if (!/^[0-9]{6,20}$/.test(to)) throw new Error("whatsapp_recipient_invalid");
  if (!text.trim()) throw new Error("whatsapp_message_empty");
  if (provider === "whatsapp_meta") {
    const token = requiredString(secret, "access_token");
    const phoneNumberId = requiredString(secret, "phone_number_id");
    if (!token || !phoneNumberId) throw new Error("whatsapp_meta_credentials_invalid");
    const response = await fetch(`https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(phoneNumberId)}/messages`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body: text } }), cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`whatsapp_meta_send_failed:${response.status}`);
    return payload;
  }
  const baseUrl = stripTrailingSlashes(requiredString(secret, "base_url"));
  const apiKey = requiredString(secret, "api_key");
  const instance = requiredString(secret, "instance_name");
  if (!baseUrl || !apiKey || !instance) throw new Error("whatsapp_evolution_credentials_invalid");
  const response = await fetch(`${baseUrl}/message/sendText/${encodeURIComponent(instance)}`, { method: "POST", headers: { "Content-Type": "application/json", apikey: apiKey }, body: JSON.stringify({ number: to, textMessage: { text } }), cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`whatsapp_evolution_send_failed:${response.status}`);
  return payload;
}
