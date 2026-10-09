import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../app/api/webhooks/whatsapp/route.ts", import.meta.url), "utf8");

test("WhatsApp webhook deduplicates completed and in-progress events", () => {
  assert.match(source, /existing\.status!=="failed"[\s\S]*duplicate:true,status:existing\.status/);
  assert.match(source, /\.eq\("id",existing\.id\)\.eq\("status","failed"\)\.select\("id"\)/);
});

test("failed WhatsApp webhook receipts can be reclaimed once for retry", () => {
  assert.match(source, /update\(\{status:"processing",error_message:null,processed_at:null\}\)/);
  assert.match(source, /if\(!claimed\)return jsonResponse\(\{received:true,duplicate:true,status:"processing"\}\)/);
  assert.match(source, /status:"failed",error_message:message,processed_at:new Date\(\)\.toISOString\(\)/);
});

test("critical WhatsApp webhook database writes propagate failures", () => {
  assert.match(source, /function assertDbWrite\(error:unknown,operation:string\)/);
  assert.match(source, /if\(identityLookupError\)throw identityLookupError/);
  assert.match(source, /customer_identity_upsert_failed/);
  assert.match(source, /customer_update_failed/);
  assert.match(source, /integration_status_update_failed/);
  assert.match(source, /integration_connection_event_update_failed/);
  assert.match(source, /message_delivery_status_update_failed/);
  assert.match(source, /webhook_receipt_completion_failed/);
});

test("webhook completion is not acknowledged if receipt persistence fails", () => {
  assert.match(source, /assertDbWrite\(\(await admin\.from\("webhook_events"\)\.update\(\{status:"processed"/);
  assert.match(source, /catch\(error\)\{if\(admin&&receiptId\)/);
});
