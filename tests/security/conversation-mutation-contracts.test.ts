import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const conversationRoute = read("app/api/conversations/[id]/route.ts");
const atomicMigration = read("supabase/migrations/20261010110000_atomic_conversation_updates.sql");
const messageRoute = read("app/api/conversations/[id]/messages/route.ts");

describe("conversation mutation and history security contracts", () => {
  it("rejects malformed and unknown conversation patch fields before database mutation", () => {
    expect(conversationRoute).toContain('error: "invalid_request_body"');
    expect(conversationRoute).toContain('error: "invalid_conversation_patch"');
    expect(conversationRoute).toContain('const allowed = new Set(["status", "priority", "handoff", "assigned_to"])');
  });

  it("performs tenant-scoped authorization, assignment validation, update and audit in one RPC transaction", () => {
    expect(conversationRoute).toContain('supabase.rpc("update_conversation_atomic"');
    expect(atomicMigration).toContain("tm.tenant_id = p_tenant_id");
    expect(atomicMigration).toContain("tm.user_id = auth.uid()");
    expect(atomicMigration).toContain("where c.tenant_id = p_tenant_id and c.id = p_conversation_id");
    expect(atomicMigration).toContain("insert into public.audit_logs");
    expect(atomicMigration).toContain("to_jsonb(v_before), to_jsonb(v_after)");
  });

  it("restricts conversation reads to approved roles and returns only required customer fields", () => {
    expect(conversationRoute).toContain("const readableRoles = [\"owner\", \"admin\", \"manager\", \"sales\", \"support\"] as const");
    expect(conversationRoute).toContain('.select("id,name,phone,email,preferred_language,tags")');
  });

  it("scopes message history to both tenant and selected conversation", () => {
    expect(conversationRoute).toContain('.eq("tenant_id", tenant.id).eq("conversation_id", id)');
  });

  it("parses provider message identifiers without unsafe any types", () => {
    expect(messageRoute).toContain("function externalMessageId(payload: unknown)");
    expect(messageRoute).not.toContain("payload: any");
  });
});
