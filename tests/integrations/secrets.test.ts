import { afterEach, describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  hmacSha256Hex,
  sha256,
  timingSafeEqualHex,
} from "../lib/integrations/secrets";

const originalKey = process.env.INTEGRATION_ENCRYPTION_KEY;
const validKey = "11".repeat(32);

afterEach(() => {
  if (originalKey === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
  else process.env.INTEGRATION_ENCRYPTION_KEY = originalKey;
});

describe("integration secret encryption", () => {
  it("round-trips structured credentials using AES-256-GCM", () => {
    process.env.INTEGRATION_ENCRYPTION_KEY = validKey;
    const secret = { accessToken: "test-token", nested: { enabled: true }, count: 3 };
    expect(decryptSecret(encryptSecret(secret))).toEqual(secret);
  });

  it("fails closed when the encryption key is missing", () => {
    delete process.env.INTEGRATION_ENCRYPTION_KEY;
    expect(() => encryptSecret({ token: "x" })).toThrow("integration_encryption_key_missing");
    expect(() => decryptSecret("v1.a.b.c")).toThrow("integration_encryption_key_missing");
  });

  it("rejects malformed and unsupported ciphertext envelopes", () => {
    process.env.INTEGRATION_ENCRYPTION_KEY = validKey;
    expect(() => decryptSecret("not-an-envelope")).toThrow("integration_secret_invalid");
    expect(() => decryptSecret("v2.a.b.c")).toThrow("integration_secret_invalid");
  });

  it("rejects ciphertext tampering", () => {
    process.env.INTEGRATION_ENCRYPTION_KEY = validKey;
    const encrypted = encryptSecret({ token: "sensitive" });
    const parts = encrypted.split(".");
    parts[3] = Buffer.from("tampered-value").toString("base64url");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });

  it("rejects invalid encryption key lengths", () => {
    process.env.INTEGRATION_ENCRYPTION_KEY = "too-short";
    expect(() => encryptSecret({ token: "x" })).toThrow("integration_encryption_key_invalid");
  });
});

describe("webhook cryptographic primitives", () => {
  it("hashes the exact raw payload deterministically", () => {
    expect(sha256('{"a":1}')).toBe(sha256('{"a":1}'));
    expect(sha256('{"a":1}')).not.toBe(sha256('{ "a": 1 }'));
  });

  it("compares valid SHA-256 hex digests safely and rejects malformed inputs", () => {
    const digest = sha256("payload");
    expect(timingSafeEqualHex(digest, digest)).toBe(true);
    expect(timingSafeEqualHex(digest, sha256("different"))).toBe(false);
    expect(timingSafeEqualHex(digest, "short")).toBe(false);
    expect(timingSafeEqualHex(digest, "z".repeat(64))).toBe(false);
  });

  it("computes an HMAC over the exact raw request body", () => {
    const signature = hmacSha256Hex("test-secret", '{"event":"message"}');
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(signature).not.toBe(hmacSha256Hex("test-secret", '{ "event": "message" }'));
  });
});
