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
  assert.doesNotMatch(route, /from\("audit_logs"\)/);
  const auditMigration = await readFile(new URL("../supabase/migrations/20261009093000_business_brain_atomic_audit.sql", import.meta.url), "utf8");
  assert.match(auditMigration, /create trigger knowledge_document_audit_after_write/);
  assert.match(auditMigration, /insert into public\.audit_logs/);
  assert.match(auditMigration, /knowledge\.verified/);
  assert.match(auditMigration, /knowledge\.rejected/);
  assert.match(auditMigration, /to_jsonb\(old\)/);
  assert.match(auditMigration, /to_jsonb\(new\)/);
});

test("database write policies enforce Business Brain editor roles", async () => {
  const rlsMigration = await readFile(new URL("../supabase/migrations/20261009090000_business_brain_write_role_rls.sql", import.meta.url), "utf8");
  assert.match(rlsMigration, /role in \('owner', 'admin', 'manager'\)/);
  assert.match(rlsMigration, /create policy knowledge_member_read[\s\S]*for select[\s\S]*private\.is_tenant_member\(tenant_id\)/);
  assert.match(rlsMigration, /create policy knowledge_editor_insert[\s\S]*for insert[\s\S]*private\.is_tenant_knowledge_editor\(tenant_id\)/);
  assert.match(rlsMigration, /create policy knowledge_editor_update[\s\S]*for update[\s\S]*using \(private\.is_tenant_knowledge_editor\(tenant_id\)\)[\s\S]*with check \(private\.is_tenant_knowledge_editor\(tenant_id\)\)/);
  assert.match(rlsMigration, /drop policy if exists knowledge_member on public\.knowledge_documents/);
  assert.match(rlsMigration, /Direct DELETE is intentionally not granted/);
});

test("Business Brain audit records share the document transaction", async () => {
  const auditMigration = await readFile(new URL("../supabase/migrations/20261009093000_business_brain_atomic_audit.sql", import.meta.url), "utf8");
  assert.match(auditMigration, /create or replace function private\.audit_knowledge_document_change\(\)/);
  assert.match(auditMigration, /after insert or update on public\.knowledge_documents/);
  assert.match(auditMigration, /security invoker|security definer/i) === false;
  assert.match(auditMigration, /insert into public\.audit_logs/);
  assert.match(auditMigration, /actor_id, action, resource_type, resource_id, old_data, new_data, reason/);
});
