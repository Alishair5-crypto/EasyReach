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
    expect(webhook).toContain('else if(existing.status==="processing")');
    expect(webhook).toContain('if(!claimed)return jsonResponse({received:true,duplicate:true})');
    expect(webhook).toContain('.eq("id",receiptId!)');
    expect(webhook).toContain('const eventId=`${provider}:${sha256(rawBody)}`');
  });
  
  it("allows one retry to claim a previously failed receipt", () => {
    expect(webhook).toContain('existing.status==="failed"');
    expect(webhook).toContain('.eq("status","failed").select("id").maybeSingle()');
    expect(webhook).toContain('processing_started_at:leaseNow,error_message:null,processed_at:null');
  });

  it("reclaims only stale processing receipts with a compare-and-set lease", () => {
    expect(webhook).toContain('const staleBefore=Date.now()-5*60*1000');
    expect(webhook).toContain('existing.processing_started_at??existing.received_at');
    expect(webhook).toContain('.eq("status","processing")');
    expect(webhook).toContain('.eq("processing_started_at",existing.processing_started_at)');
    expect(webhook).toContain('.is("processing_started_at",null)');
  });

  it("stores a redacted webhook receipt rather than the raw provider payload", () => {
    expect(webhook).toContain('payload:{object:body.object??null,event_type:');
    expect(webhook).toContain('signature_verified:true},signature_verified:true');
    expect(webhook).not.toContain('payload:body,signature_verified:true');
  });
});
