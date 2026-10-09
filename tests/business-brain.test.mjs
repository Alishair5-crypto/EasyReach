import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const tools = await readFile(new URL("../lib/ai/tools.ts", import.meta.url), "utf8");
const actions = await readFile(new URL("../lib/ai/action-tools.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20261008070000_business_brain_verification_evidence.sql", import.meta.url), "utf8");

test("Business Brain policy retrieval is tenant-scoped, active, and verified-only", () => {
  assert.match(tools, /from\("knowledge_documents"\)/);
  assert.match(tools, /eq\("tenant_id",tenantId\)/);
  assert.match(tools, /eq\("source_type","policy"\)/);
  assert.match(tools, /eq\("status","active"\)/);
  assert.match(tools, /eq\("verification_status","verified"\)/);
  assert.match(tools, /verified_at/);
});

test("AI knowledge search is tenant-scoped and excludes unverified documents", () => {
  assert.match(actions, /from\("knowledge_documents"\)/);
  assert.match(actions, /eq\("tenant_id",ctx\.tenantId\)/);
  assert.match(actions, /eq\("status","active"\)/);
  assert.match(actions, /eq\("verification_status","verified"\)/);
  assert.match(actions, /verified_at/);
});

test("verification lifecycle has controlled states and records verifier evidence", () => {
  assert.match(migration, /verification_status.*'pending'.*'verified'.*'rejected'/);
  assert.match(migration, /verified_at/);
  assert.match(migration, /verified_by uuid references auth\.users\(id\)/);
  assert.match(migration, /knowledge_verified_tenant_idx/);
});


test("Business Brain edits and status transitions invalidate prior verification", async () => {
  const route = await readFile(new URL("../app/api/business-brain/route.ts", import.meta.url), "utf8");
  assert.match(route, /if \(substantiveChange \|\| statusChanged\)/);
  assert.match(route, /if \(s !== before\.status\) statusChanged = true/);
  assert.match(route, /patch\.verification_status = "pending"/);
  assert.match(route, /patch\.verified_at = null/);
  assert.match(route, /patch\.verified_by = null/);
  assert.match(route, /title_required/);
  assert.match(route, /content_required/);
  assert.doesNotMatch(route, /patch\.last_synced_at = new Date\(\)\.toISOString\(\)/);
});

test("Business Brain verification actions are role-gated and tenant-scoped", async () => {
  const route = await readFile(new URL("../app/api/business-brain/route.ts", import.meta.url), "utf8");
  assert.match(route, /EDIT_ROLES\.has\(membership\.role\)/);
  assert.match(route, /\.eq\("tenant_id", tenant\.id\)\.eq\("id", id\)/);
  assert.match(route, /action: "knowledge\.verified"/);
  assert.match(route, /action: "knowledge\.rejected"/);
});
