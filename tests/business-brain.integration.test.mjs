import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const names = [
  "SUPABASE_INTEGRATION_URL",
  "SUPABASE_INTEGRATION_ANON_KEY",
  "SUPABASE_TEST_TENANT_A_ID",
  "SUPABASE_TEST_TENANT_B_ID",
  "SUPABASE_TEST_EDITOR_EMAIL",
  "SUPABASE_TEST_EDITOR_PASSWORD",
  "SUPABASE_TEST_VIEWER_EMAIL",
  "SUPABASE_TEST_VIEWER_PASSWORD",
];
const configured = names.filter((name) => Boolean(process.env[name]));
const enabled = process.env.EASYREACH_INTEGRATION_ALLOW_WRITES === "YES";
const missing = names.filter((name) => !process.env[name]);
const partialConfig = configured.length > 0 && missing.length > 0;

function clientFor(email, password) {
  const client = createClient(process.env.SUPABASE_INTEGRATION_URL, process.env.SUPABASE_INTEGRATION_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client.auth.signInWithPassword({ email, password }).then(({ data, error }) => {
    assert.ifError(error, `sign in failed for configured test identity ${email}`);
    assert.ok(data.user, `no authenticated user returned for ${email}`);
    return { client, user: data.user };
  });
}

test("authenticated Business Brain tenant, role, immutability, and audit integration", {
  skip: !enabled && !partialConfig
    ? "Not run: set up a dedicated non-production Supabase project and explicitly set EASYREACH_INTEGRATION_ALLOW_WRITES=YES"
    : false,
}, async () => {
  assert.equal(partialConfig, false, `Incomplete integration environment. Missing: ${missing.join(", ")}`);
  assert.equal(enabled, true, "Refusing database writes unless EASYREACH_INTEGRATION_ALLOW_WRITES=YES");
  assert.notEqual(process.env.SUPABASE_TEST_TENANT_A_ID, process.env.SUPABASE_TEST_TENANT_B_ID,
    "Tenant A and B must be distinct");

  const [{ client: editor, user: editorUser }, { client: viewer, user: viewerUser }] = await Promise.all([
    clientFor(process.env.SUPABASE_TEST_EDITOR_EMAIL, process.env.SUPABASE_TEST_EDITOR_PASSWORD),
    clientFor(process.env.SUPABASE_TEST_VIEWER_EMAIL, process.env.SUPABASE_TEST_VIEWER_PASSWORD),
  ]);
  const tenantA = process.env.SUPABASE_TEST_TENANT_A_ID;
  const tenantB = process.env.SUPABASE_TEST_TENANT_B_ID;
  const suffix = `integration-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const createdIds = [];

  async function createDocument(client, tenantId, title) {
    const { data, error } = await client.from("knowledge_documents").insert({
      tenant_id: tenantId,
      title,
      source_type: "general",
      content: `Automated integration fixture ${suffix}`,
      status: "active",
      verification_status: "pending",
      verified_at: null,
      verified_by: null,
      last_synced_at: null,
    }).select("id,tenant_id,title,content,verification_status").single();
    assert.ifError(error, `could not create integration fixture in tenant ${tenantId}`);
    assert.ok(data?.id, "insert must return a document ID");
    createdIds.push({ id: data.id, tenantId });
    return data;
  }

  try {
    const { data: editorMemberships, error: editorMembershipError } = await editor
      .from("tenant_members").select("tenant_id,role").in("tenant_id", [tenantA, tenantB]).eq("user_id", editorUser.id);
    assert.ifError(editorMembershipError);
    assert.deepEqual(new Set((editorMemberships ?? []).map((m) => m.tenant_id)), new Set([tenantA, tenantB]),
      "editor test identity must be a member of both test tenants to isolate the immutable-tenant trigger from RLS");
    assert.ok((editorMemberships ?? []).every((m) => ["owner", "admin", "manager"].includes(m.role)),
      "editor test identity must have an editor role in both test tenants");

    const { data: viewerMemberships, error: viewerMembershipError } = await viewer
      .from("tenant_members").select("tenant_id,role").in("tenant_id", [tenantA, tenantB]).eq("user_id", viewerUser.id);
    assert.ifError(viewerMembershipError);
    assert.ok((viewerMemberships ?? []).some((m) => m.tenant_id === tenantA), "viewer must belong to tenant A");
    assert.ok(!(viewerMemberships ?? []).some((m) => m.tenant_id === tenantB), "viewer must not belong to tenant B");
    assert.ok((viewerMemberships ?? []).every((m) => !["owner", "admin", "manager"].includes(m.role)),
      "viewer identity must not have an editor role in tenant A");

    const docA = await createDocument(editor, tenantA, `[TEST ONLY] ${suffix} A`);
    const docB = await createDocument(editor, tenantB, `[TEST ONLY] ${suffix} B`);

    const { data: viewerReadA, error: viewerReadAError } = await viewer
      .from("knowledge_documents").select("id,tenant_id").eq("id", docA.id).maybeSingle();
    assert.ifError(viewerReadAError);
    assert.equal(viewerReadA?.id, docA.id, "tenant A member should read tenant A document");

    const { data: viewerReadB, error: viewerReadBError } = await viewer
      .from("knowledge_documents").select("id,tenant_id").eq("id", docB.id).maybeSingle();
    assert.ifError(viewerReadBError);
    assert.equal(viewerReadB, null, "tenant A viewer must not see tenant B document");

    const { data: viewerInsert, error: viewerInsertError } = await viewer.from("knowledge_documents").insert({
      tenant_id: tenantA,
      title: `[TEST ONLY] unauthorized ${suffix}`,
      source_type: "general",
      content: "This insert must be rejected by RLS",
      status: "active",
      verification_status: "pending",
    }).select("id").maybeSingle();
    assert.ok(viewerInsertError || !viewerInsert, "viewer insert must be rejected by database policy");
    assert.equal(viewerInsert, null, "viewer must not create Business Brain documents");

    const { data: forgedAudit, error: forgedAuditError } = await viewer.from("audit_logs").insert({
      tenant_id: tenantA,
      actor_id: editorUser.id,
      action: "knowledge.updated",
      resource_type: "knowledge_document",
      resource_id: docA.id,
      old_data: { content: "original" },
      new_data: { content: "forged" },
      reason: "forged actor must be rejected",
    }).select("id").maybeSingle();
    assert.ok(forgedAuditError || !forgedAudit, "viewer must not forge audit entries under another actor's identity");
    assert.equal(forgedAudit, null, "forged audit insert must not persist");

    const { data: viewerUpdate, error: viewerUpdateError } = await viewer.from("knowledge_documents")
      .update({ content: "unauthorized update must not persist" }).eq("id", docA.id).select("id").maybeSingle();
    assert.ok(viewerUpdateError || !viewerUpdate, "viewer update must be rejected by database policy");
    assert.equal(viewerUpdate, null, "viewer must not update Business Brain documents");

    const { error: reassignmentError } = await editor.from("knowledge_documents")
      .update({ tenant_id: tenantB }).eq("id", docA.id).eq("tenant_id", tenantA).select("id").maybeSingle();
    assert.ok(reassignmentError, "tenant reassignment must be rejected even for an editor who belongs to both tenants");
    assert.match(`${reassignmentError.code ?? ""} ${reassignmentError.message ?? ""}`,
      /42501|knowledge_document_tenant_immutable/i, "tenant reassignment should be blocked by the immutable-tenant trigger");

    const { data: afterRejectedMove, error: afterRejectedMoveError } = await editor.from("knowledge_documents")
      .select("id,tenant_id").eq("id", docA.id).single();
    assert.ifError(afterRejectedMoveError);
    assert.equal(afterRejectedMove.tenant_id, tenantA, "rejected reassignment must leave original tenant unchanged");

    const updatedContent = `audited update ${suffix}`;
    const { data: updated, error: updateError } = await editor.from("knowledge_documents")
      .update({ content: updatedContent }).eq("id", docA.id).eq("tenant_id", tenantA)
      .select("id,content").single();
    assert.ifError(updateError);
    assert.equal(updated.content, updatedContent);

    const { data: auditRows, error: auditError } = await editor.from("audit_logs")
      .select("tenant_id,actor_id,action,resource_type,resource_id,old_data,new_data,reason")
      .eq("tenant_id", tenantA).eq("resource_type", "knowledge_document").eq("resource_id", docA.id);
    assert.ifError(auditError);
    assert.ok((auditRows ?? []).some((row) => row.action === "knowledge.created" && row.actor_id === editorUser.id),
      "create audit row must record the authenticated editor as actor");
    const updateAudit = (auditRows ?? []).find((row) => row.action === "knowledge.updated"
      && row.actor_id === editorUser.id && row.new_data?.content === updatedContent);
    assert.ok(updateAudit, "update audit row must include authenticated actor and new document content");
    assert.equal(updateAudit.old_data?.content, docA.content, "update audit must retain the previous content");
    assert.ok(updateAudit.reason, "audit row must carry a reason");

    const { data: viewerAudit, error: viewerAuditError } = await viewer.from("audit_logs")
      .select("resource_id").eq("tenant_id", tenantB).eq("resource_id", docB.id);
    assert.ifError(viewerAuditError);
    assert.deepEqual(viewerAudit ?? [], [], "tenant A viewer must not read tenant B audit evidence");
  } finally {
    // Keep the test project tidy without DELETE privileges: archive only the unique test fixtures.
    for (const item of createdIds) {
      const { error } = await editor.from("knowledge_documents")
        .update({ status: "archived", verification_status: "pending", verified_at: null, verified_by: null })
        .eq("id", item.id).eq("tenant_id", item.tenantId);
      if (error) process.stderr.write(`Cleanup warning for test fixture ${item.id}: ${error.message}\n`);
    }
    await Promise.all([editor.auth.signOut(), viewer.auth.signOut()]);
  }
});
