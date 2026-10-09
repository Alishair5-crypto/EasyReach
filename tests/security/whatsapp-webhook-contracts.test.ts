import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Temporary architecture guards for the current route implementation. These do not
// replace request-level tests with a mocked Supabase client; they ensure key security
// contracts cannot disappear unnoticed during refactors.
const webhook = readFileSync(new URL("../../app/api/webhooks/whatsapp/route.ts", import.meta.url), "utf8");

describe("WhatsApp webhook security contracts", () => {
  it("verifies Meta signatures against the exact raw request body", () => {
    expect(webhook).toContain('req.text()');
    expect(webhook).toContain('hmacSha256Hex(String(secret.app_secret??""),rawBody)');
    expect(webhook).toContain('timingSafeEqualHex(expected,supplied)');
  });

  it("records only signature-verified webhook events as processing receipts", () => {
    expect(webhook).toContain("signature_verified:true");
    expect(webhook).toContain('status:"processing"');
    expect(webhook).toContain('status:"processed"');
    expect(webhook).toContain('status:"failed"');
  });

  it("scopes customer and conversation mutations to the resolved tenant", () => {
    expect(webhook).toContain('.eq("tenant_id",tenantId)');
    expect(webhook).toContain('.eq("tenant_id",integration.tenant_id)');
    expect(webhook).toContain('onConflict:"tenant_id,external_key"');
    expect(webhook).toContain('onConflict:"tenant_id,channel,external_id"');
  });

  it("uses a unique event receipt to detect duplicate deliveries", () => {
    expect(webhook).toContain('if(receiptError.code!=="23505")throw receiptError');
    expect(webhook).toContain('if(existing?.status!=="failed")return jsonResponse({received:true,duplicate:true})');
    expect(webhook).toContain('.eq("id",receiptId!)');
    expect(webhook).toContain('const eventId=`${provider}:${sha256(rawBody)}`');
  });
  
  it("allows one retry to claim a previously failed receipt", () => {
    expect(webhook).toContain('existing?.status!=="failed"');
    expect(webhook).toContain('.eq("status","failed").select("id").maybeSingle()');
    expect(webhook).toContain('status:"processing",error_message:null,processed_at:null');
  });
});
