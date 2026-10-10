import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20261010120000_restrict_audit_log_inserts.sql");
const customerRoute = read("app/api/customers/[id]/route.ts");
const whatsappRoute = read("app/api/integrations/whatsapp/route.ts");
const statusRoute = read("app/api/integrations/whatsapp/status/route.ts");
const signupRoute = read("app/api/integrations/whatsapp/embedded-signup/route.ts");

describe("audit log insertion security contracts", () => {
  it("revokes direct audit log INSERT from authenticated PostgREST clients", () => {
    expect(migration).toContain("revoke insert on table public.audit_logs from anon, authenticated");
    expect(migration).toContain("grant select on table public.audit_logs to authenticated");
    expect(migration).toContain("revoke update, delete, truncate, references, trigger");
  });

  it("routes application audit inserts through the server-only privileged client", () => {
    expect(customerRoute).toContain("createPrivilegedClient");
    expect(customerRoute).toContain('auditClient.from("audit_logs").insert');
    expect(whatsappRoute).toContain('admin.from("audit_logs").insert');
    expect(statusRoute).toContain("createPrivilegedClient");
    expect(statusRoute).toContain('auditClient.from("audit_logs").insert');
    expect(signupRoute).toContain('admin.from("audit_logs").insert');
    expect(customerRoute).not.toContain('supabase.from("audit_logs").insert');
    expect(whatsappRoute).not.toContain('supabase.from("audit_logs").insert');
    expect(statusRoute).not.toContain('supabase.from("audit_logs").insert');
    expect(signupRoute).not.toContain('supabase.from("audit_logs").insert');
  });
});
