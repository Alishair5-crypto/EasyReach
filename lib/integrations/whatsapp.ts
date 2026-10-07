import { getIntegrationSecret } from "./server";

export type WhatsAppProvider = "whatsapp_meta" | "whatsapp_evolution";
const graphVersion = () => process.env.META_GRAPH_API_VERSION ?? "v25.0";
const stripTrailingSlashes = (value: string) => value.replace(/\/+$/, "");

function requiredString(secret: Record<string, unknown>, key: string) {
  return typeof secret[key] === "string" ? secret[key] : "";
}

async function readJson(response: Response): Promise<any> {
  return await response.json().catch(() => ({})) as Record<string, unknown>;
}

export async function verifyMetaCredentials(secret: Record<string, unknown>) {
  const token = requiredString(secret, "access_token");
  const phoneNumberId = requiredString(secret, "phone_number_id");
  if (!token || !phoneNumberId) throw new Error("whatsapp_meta_credentials_invalid");
  const response = await fetch(`https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(phoneNumberId)}?fields=id,display_phone_number,verified_name,quality_rating`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!response.ok) throw new Error(`whatsapp_meta_verify_failed:${response.status}`);
  return await readJson(response);
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

  const response = await fetch(`${baseUrl}/instance/connectionState/${encodeURIComponent(instance)}`, {
    headers: { apikey: apiKey }, cache: "no-store"
  });
  if (!response.ok) throw new Error(`whatsapp_evolution_status_failed:${response.status}`);
  return await readJson(response);
}

export async function configureEvolutionWebhook(secret: Record<string, unknown>) {
  const baseUrl = stripTrailingSlashes(requiredString(secret, "base_url"));
  const apiKey = requiredString(secret, "api_key");
  const instance = requiredString(secret, "instance_name");
  const webhookSecret = requiredString(secret, "webhook_secret");
  if (!baseUrl || !apiKey || !instance || !webhookSecret) throw new Error("whatsapp_evolution_webhook_credentials_invalid");

  const response = await fetch(`${baseUrl}/webhook/set/${encodeURIComponent(instance)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: apiKey },
    body: JSON.stringify({
      enabled: true,
      url: webhookUrl(),
      webhookByEvents: false,
      webhookBase64: false,
      events: ["CONNECTION_UPDATE", "MESSAGES_UPSERT", "MESSAGES_UPDATE", "SEND_MESSAGE"],
      headers: { "x-easyreach-webhook-secret": webhookSecret }
    }),
    cache: "no-store"
  });
  if (!response.ok) {
    const payload = await readJson(response);
    throw new Error(`whatsapp_evolution_webhook_config_failed:${response.status}:${String(payload.message ?? "provider rejected webhook configuration")}`);
  }
  return await readJson(response);
}

export async function getEvolutionQr(secret: Record<string, unknown>) {
  const baseUrl = stripTrailingSlashes(requiredString(secret, "base_url"));
  const apiKey = requiredString(secret, "api_key");
  const instance = requiredString(secret, "instance_name");
  if (!baseUrl || !apiKey || !instance) throw new Error("whatsapp_evolution_credentials_invalid");

  await configureEvolutionWebhook(secret);

  const response = await fetch(`${baseUrl}/instance/connect/${encodeURIComponent(instance)}`, {
    headers: { apikey: apiKey }, cache: "no-store"
  });
  if (response.ok) return await readJson(response);

  // If the instance is already connected, the QR endpoint may not return a QR.
  // Surface the real connection state instead of fabricating a QR.
  const state = await getEvolutionStatus(secret).catch(() => null);
  if (state) return { connectionState: state };

  throw new Error(`whatsapp_evolution_qr_failed:${response.status}`);
}

export async function downloadEvolutionMedia(secret: Record<string, unknown>, message: Record<string, unknown>) {
  const baseUrl = stripTrailingSlashes(requiredString(secret, "base_url"));
  const apiKey = requiredString(secret, "api_key");
  const instance = requiredString(secret, "instance_name");
  if (!baseUrl || !apiKey || !instance) throw new Error("whatsapp_evolution_credentials_invalid");
  if (!message || typeof message !== "object") throw new Error("whatsapp_evolution_media_message_required");

  const response = await fetch(`${baseUrl}/message/downloadimage`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: apiKey },
    body: JSON.stringify({ message }),
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`whatsapp_evolution_media_download_failed:${response.status}`);
  return await readJson(response);
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
  const payload = await readJson(response);
  if (!response.ok || typeof payload.access_token !== "string") throw new Error("meta_embedded_signup_code_exchange_failed");
  const accessToken = payload.access_token as string;
  let resolvedPhoneId = phoneNumberId ?? "";
  if (!resolvedPhoneId) {
    const list = await fetch(`https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(wabaId)}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating&limit=10`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
    const data = await readJson(list);
    resolvedPhoneId = typeof data?.data?.[0]?.id === "string" ? data.data[0].id : "";
  }
  if (!resolvedPhoneId) throw new Error("meta_embedded_signup_phone_verification_failed");
  const phoneResponse = await fetch(`https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(resolvedPhoneId)}?fields=id,display_phone_number,verified_name,quality_rating`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  if (!phoneResponse.ok) throw new Error("meta_embedded_signup_phone_verification_failed");
  const phone = await readJson(phoneResponse);
  if (String(phone.id ?? "") !== resolvedPhoneId) throw new Error("meta_embedded_signup_phone_mismatch");
  const wabaResponse = await fetch(`https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(wabaId)}?fields=id,name`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  if (!wabaResponse.ok) throw new Error("meta_embedded_signup_waba_verification_failed");
  const waba = await readJson(wabaResponse);
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
    const response = await fetch(`https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body: text } }), cache: "no-store"
    });
    const payload = await readJson(response);
    if (!response.ok) throw new Error(`whatsapp_meta_send_failed:${response.status}`);
    return payload;
  }

  const baseUrl = stripTrailingSlashes(requiredString(secret, "base_url"));
  const apiKey = requiredString(secret, "api_key");
  const instance = requiredString(secret, "instance_name");
  if (!baseUrl || !apiKey || !instance) throw new Error("whatsapp_evolution_credentials_invalid");
  const response = await fetch(`${baseUrl}/message/sendText/${encodeURIComponent(instance)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: apiKey },
    body: JSON.stringify({ number: to, text }),
    cache: "no-store"
  });
  const payload = await readJson(response);
  if (!response.ok) throw new Error(`whatsapp_evolution_send_failed:${response.status}`);
  return payload;
}
