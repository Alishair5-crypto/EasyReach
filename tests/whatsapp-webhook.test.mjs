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
