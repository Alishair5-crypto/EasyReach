import crypto from "node:crypto";

const KEY_ENV = "INTEGRATION_ENCRYPTION_KEY";

function getKey() {
  const raw = process.env[KEY_ENV];
  if (!raw) throw new Error("integration_encryption_key_missing");
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("integration_encryption_key_invalid");
  return key;
}

export function encryptSecret(value: unknown) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret<T = Record<string, unknown>>(payload: string): T {
  const [version, ivText, tagText, dataText] = payload.split(".");
  if (version !== "v1" || !ivText || !tagText || !dataText) throw new Error("integration_secret_invalid");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(dataText, "base64url")), decipher.final()]).toString("utf8");
  return JSON.parse(plaintext) as T;
}

export function sha256(value: string) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function timingSafeEqualHex(expected: string, actual: string) {
  if (!/^[0-9a-f]{64}$/i.test(expected) || !/^[0-9a-f]{64}$/i.test(actual)) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"));
}

export function hmacSha256Hex(secret: string, rawBody: string) {
  return crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}