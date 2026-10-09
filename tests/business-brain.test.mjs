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
