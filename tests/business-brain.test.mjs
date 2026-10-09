import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

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
  assert.doesNotMatch(tools, /select\([^\n]*updated_at/);
});

test("AI knowledge search is tenant-scoped and excludes unverified documents", () => {
  assert.match(actions, /from\("knowledge_documents"\)/);
  assert.match(actions, /eq\("tenant_id",ctx\.tenantId\)/);
  assert.match(actions, /eq\("status","active"\)/);
  assert.match(actions, /eq\("verification_status","verified"\)/);
  assert.match(actions, /verified_at/);
  assert.doesNotMatch(actions, /knowledge_documents"\)\.select\([^\n]*updated_at/);
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
  assert.doesNotMatch(auditMigration, /security (?:invoker|definer)/i);
  assert.match(auditMigration, /insert into public\.audit_logs/);
  assert.match(auditMigration, /actor_id, action, resource_type, resource_id, old_data, new_data, reason/);
});

test("AI retrieval excludes stale, unknown-freshness, and conflicting knowledge", async () => {
  const trust = await readFile(new URL("../lib/ai/knowledge-trust.ts", import.meta.url), "utf8");
  const policyTools = await readFile(new URL("../lib/ai/tools.ts", import.meta.url), "utf8");
  const actionTools = await readFile(new URL("../lib/ai/action-tools.ts", import.meta.url), "utf8");
  const orchestrator = await readFile(new URL("../lib/ai/orchestrator.ts", import.meta.url), "utf8");
  assert.match(trust, /authoritative_eligible: freshness_status === "current" && !conflict/);
  assert.match(policyTools, /annotateKnowledgeTrust\(data\?\?\[\]\)\.filter\(row=>row\.authoritative_eligible\)/);
  assert.match(actionTools, /annotateKnowledgeTrust\(rows\)\.filter\(row=>row\.authoritative_eligible\)/);
  assert.match(orchestrator, /cannot confirm the current policy and offer human review/);
});

test("manual Business Brain entry does not claim an external sync occurred", async () => {
  const route = await readFile(new URL("../app/api/business-brain/route.ts", import.meta.url), "utf8");
  assert.match(route, /last_synced_at: null/);
  assert.match(route, /annotateKnowledgeTrust\(data \?\? \[\]\)/);
});


test("freshness requires an actual sync timestamp for URL-backed sources", async () => {
  const source = await readFile(new URL("../lib/ai/knowledge-trust.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const trust = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
  const now = Date.parse("2026-10-09T00:00:00.000Z");
  const [noSync, freshSync, staleSync, manual] = trust.annotateKnowledgeTrust([
    { title: "Shipping", content: "Ships in 3 days", source_url: "https://shop.example/policy", last_synced_at: null, verified_at: "2026-10-08T00:00:00.000Z" },
    { title: "Returns", content: "Returns within 7 days", source_url: "https://shop.example/returns", last_synced_at: "2026-10-01T00:00:00.000Z", verified_at: "2026-10-01T00:00:00.000Z" },
    { title: "Warranty", content: "One year", source_url: "https://shop.example/warranty", last_synced_at: "2026-08-01T00:00:00.000Z", verified_at: "2026-10-08T00:00:00.000Z" },
    { title: "Opening hours", content: "Open 9 to 5", source_url: null, last_synced_at: null, verified_at: "2026-10-08T00:00:00.000Z" },
  ], now);
  assert.equal(noSync.freshness_status, "unknown");
  assert.equal(noSync.authoritative_eligible, false);
  assert.equal(freshSync.freshness_status, "current");
  assert.equal(freshSync.authoritative_eligible, true);
  assert.equal(staleSync.freshness_status, "stale");
  assert.equal(staleSync.authoritative_eligible, false);
  assert.equal(manual.freshness_status, "current");
  assert.equal(manual.authoritative_eligible, true);
});

test("same-title conflicting verified knowledge is never authoritative", async () => {
  const source = await readFile(new URL("../lib/ai/knowledge-trust.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const trust = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
  const now = Date.parse("2026-10-09T00:00:00.000Z");
  const rows = trust.annotateKnowledgeTrust([
    { title: "Return Policy", content: "Returns accepted within 7 days", source_url: null, verified_at: "2026-10-08T00:00:00.000Z" },
    { title: " return   policy ", content: "All sales are final", source_url: null, verified_at: "2026-10-08T00:00:00.000Z" },
  ], now);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.conflict_status === "possible_conflict"));
  assert.ok(rows.every((row) => row.authoritative_eligible === false));
});


test("knowledge search detects conflicts before applying its response limit", () => {
  const retrieval = actions.indexOf("const trusted=annotateKnowledgeTrust(rows).filter(row=>row.authoritative_eligible)");
  const responseLimit = actions.indexOf("return{ok:true,tool:name,data:trusted.slice(0,20)}");
  assert.notEqual(retrieval, -1);
  assert.notEqual(responseLimit, -1);
  assert.ok(retrieval < responseLimit, "trust and conflict annotation must run before limiting returned rows");
  assert.doesNotMatch(actions, /seen\.add\(x\.id\)\)\.slice\(0,20\)/);
});

test("verification transition is conditional and reports concurrent state changes", async () => {
  const route = await readFile(new URL("../app/api/business-brain/route.ts", import.meta.url), "utf8");
  const verifyBranch = route.split('if (body.action === "verify") {')[1]?.split('if (body.action === "reject") {')[0] ?? "";
  assert.match(verifyBranch, /before\.status !== "active"/);
  assert.match(verifyBranch, /\.eq\("tenant_id", tenant\.id\)\.eq\("id", id\)\.eq\("status", "active"\)/);
  assert.match(verifyBranch, /\.maybeSingle\(\)/);
  assert.match(verifyBranch, /if \(!data\).*knowledge_state_changed_retry/s);
  assert.match(verifyBranch, /status: 409/);
});
