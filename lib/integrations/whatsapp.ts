import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { getIntegrationSecret } from "./server";

export type WhatsAppProvider = "whatsapp_meta" | "whatsapp_evolution";
const graphVersion = () => process.env.META_GRAPH_API_VERSION ?? "v25.0";
const stripTrailingSlashes = (value: string) => value.replace(/\/+$/, "");
type DnsLookup = (hostname: string, options: { all: true; verbatim: true }) => Promise<Array<{ address: string; family: number }>>;

function isPublicIpv4(address: string) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 168 || (b === 0 && c === 0) || (b === 0 && c === 2))) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function isPublicIp(address: string) {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family !== 6) return false;
  const ip = address.toLowerCase();
  if (ip === "::" || ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") ||
      ip.startsWith("fe8") || ip.startsWith("fe9") || ip.startsWith("fea") ||
      ip.startsWith("feb") || ip.startsWith("ff") || ip.startsWith("2001:db8:")) return false;
  return ip.startsWith("2") || ip.startsWith("3");
}

export async function isSafeEvolutionBaseUrl(value: string, resolver: DnsLookup = lookup) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return false;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!host || host === "localhost" || !host.includes(".") ||
        host.endsWith(".local") || host.endsWith(".localhost") ||
        host.endsWith(".internal") || host.endsWith(".test") || isIP(host)) return false;
    const addresses = await resolver(host, { all: true, verbatim: true });
    return addresses.length > 0 && addresses.every((entry) => isPublicIp(entry.address));
  } catch {
    return false;
  }
}

async function validatedEvolutionBaseUrl(secret: Record<string, unknown>, resolver: DnsLookup = lookup) {
  const value = stripTrailingSlashes(requiredString(secret, "base_url"));
  if (!value || !(await isSafeEvolutionBaseUrl(value, resolver))) {
    throw new Error("whatsapp_evolution_base_url_invalid");
  }
  return value;
}

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

export async function getEvolutionStatus(secret: Record<string, unknown>, resolver?: DnsLookup) {
  const baseUrl = await validatedEvolutionBaseUrl(secret, resolver);
  const apiKey = requiredString(secret, "api_key");
  const instance = requiredString(secret, "instance_name");
  if (!baseUrl || !apiKey || !instance) throw new Error("whatsapp_evolution_credentials_invalid");

  // Evolution API v2 exposes the state at /instance/connectionState/{instanceName}.
  const response = await fetch(`${baseUrl}/instance/connectionState/${encodeURIComponent(instance)}`, {
    headers: { apikey: apiKey }, cache: "no-store", redirect: "error",
  });
  if (!response.ok) throw new Error("whatsapp_evolution_status_failed");
  return await response.json() as Record<string, unknown>;
}

export function normalizeEvolutionConnectionState(payload: Record<string, unknown>) {
  const instance = payload.instance && typeof payload.instance === "object"
    ? payload.instance as Record<string, unknown>
    : {};
  const data = payload.data && typeof payload.data === "object"
    ? payload.data as Record<string, unknown>
    : {};
  const raw = [instance.state, instance.status, payload.state, payload.status, data.state, data.status]
    .find((value) => typeof value === "string" && value.trim().length > 0);
  const state = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (state === "open" || state === "connected") return "connected";
  if (state === "connecting" || state === "pairing") return "connecting";
  if (state === "close" || state === "closed" || state === "disconnected") return "disconnected";
  if (state.includes("qr")) return "qr_ready";
  return "preparing";
}

export async function getEvolutionQr(secret: Record<string, unknown>, resolver?: DnsLookup) {
  const baseUrl = await validatedEvolutionBaseUrl(secret);
  const apiKey = requiredString(secret, "api_key");
  const instance = requiredString(secret, "instance_name");
  if (!baseUrl || !apiKey || !instance) throw new Error("whatsapp_evolution_credentials_invalid");

  const instancePath = encodeURIComponent(instance);
  const headers = { "Content-Type": "application/json", apikey: apiKey };
  const connectUrl = `${baseUrl}/instance/connect/${instancePath}`;

  // Evolution API v2 uses GET /instance/connect/{instanceName}, not POST /instance/connect.
  let response = await fetch(connectUrl, { method: "GET", headers, cache: "no-store", redirect: "error" });

  // A configured URL/key with a missing instance is recoverable: create that named
  // instance, then request its real QR. Do not create a duplicate for other errors.
  if (response.status === 404) {
    const create = await fetch(`${baseUrl}/instance/create`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        instanceName: instance,
        integration: "WHATSAPP-BAILEYS",
        qrcode: true,
      }),
      cache: "no-store",
      redirect: "error",
    });
    if (!create.ok) throw new Error("whatsapp_evolution_instance_create_failed");
    response = await fetch(connectUrl, { method: "GET", headers, cache: "no-store", redirect: "error" });
  }

  if (!response.ok) throw new Error("whatsapp_evolution_qr_failed");
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!payload || !(typeof payload.base64 === "string" || typeof payload.code === "string" ||
      (payload.qrcode && typeof payload.qrcode === "object") || (payload.qr && typeof payload.qr === "object"))) {
    throw new Error("whatsapp_evolution_qr_payload_missing");
  }
  return payload;
}

export function getWhatsAppWebhookUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  const productionDomain = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const deploymentDomain = process.env.VERCEL_URL;
  const base = configured || (productionDomain ? `https://${productionDomain}` : deploymentDomain ? `https://${deploymentDomain}` : "");
  if (!base) throw new Error("app_url_not_configured");
  return stripTrailingSlashes(base) + "/api/webhooks/whatsapp";
}

export async function configureEvolutionWebhook(secret: Record<string, unknown>, resolver?: DnsLookup) {
  const baseUrl = await validatedEvolutionBaseUrl(secret);
  const apiKey = requiredString(secret, "api_key");
  const instance = requiredString(secret, "instance_name");
  const webhookSecret = requiredString(secret, "webhook_secret");
  if (!baseUrl || !apiKey || !instance || !webhookSecret) {
    throw new Error("whatsapp_evolution_credentials_invalid");
  }

  const url = getWhatsAppWebhookUrl();
  const response = await fetch(`${baseUrl}/webhook/set/${encodeURIComponent(instance)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: apiKey },
    body: JSON.stringify({
      enabled: true,
      url,
      webhookByEvents: false,
      webhookBase64: false,
      events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
      headers: { "x-easyreach-webhook-secret": webhookSecret },
    }),
    cache: "no-store",
    redirect: "error",
  });
  if (!response.ok) throw new Error("whatsapp_evolution_webhook_config_failed");
  return { configured: true, url, events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"] };
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
  return { accessToken, phone, waba, phoneNumberId: resolvedPhoneId, webhookUrl: getWhatsAppWebhookUrl() };
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
  const baseUrl = await validatedEvolutionBaseUrl(secret);
  const apiKey = requiredString(secret, "api_key");
  const instance = requiredString(secret, "instance_name");
  if (!baseUrl || !apiKey || !instance) throw new Error("whatsapp_evolution_credentials_invalid");
  const response = await fetch(`${baseUrl}/message/sendText/${encodeURIComponent(instance)}`, { method: "POST", headers: { "Content-Type": "application/json", apikey: apiKey }, body: JSON.stringify({ number: to, textMessage: { text } }), cache: "no-store", redirect: "error" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`whatsapp_evolution_send_failed:${response.status}`);
  return payload;
}
