import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const route = readFileSync(
  resolve(process.cwd(), "app/api/integrations/whatsapp/embedded-signup/route.ts"),
  "utf8",
);

describe("Meta embedded signup persistence contracts", () => {
  it("requires authenticated tenant context and an authorized integration role", () => {
    expect(route).toContain("getTenantContext()");
    expect(route).toContain('["owner", "admin", "manager"].includes(membership.role)');
    expect(route).toContain('error: "workspace_required"');
    expect(route).toContain('error: "not_authorized"');
  });

  it("fails closed when webhook signature verification secrets are not configured", () => {
    expect(route).toContain('process.env.META_WEBHOOK_VERIFY_TOKEN');
    expect(route).toContain('process.env.META_APP_SECRET');
    expect(route).toContain('error: "meta_webhook_not_configured"');
  });

  it("checks cross-tenant ownership lookup errors instead of ignoring them", () => {
    expect(route).toContain("const { data: claimed, error: claimError }");
    expect(route).toContain("if (claimError) throw new Error");
    expect(route).toContain('error: "whatsapp_number_already_connected"');
  });

  it("checks tenant-scoped integration persistence and secret persistence errors", () => {
    expect(route).toContain('.eq("id", integrationId).eq("tenant_id", tenant.id)');
    expect(route).toContain("meta_embedded_signup_integration_save_failed");
    expect(route).toContain("meta_embedded_signup_secret_save_failed");
  });

  it("does not report connected when status persistence or audit insertion fails", () => {
    expect(route).toContain("if (statusError) throw new Error");
    expect(route).toContain("if (auditError) throw new Error");
    expect(route).toContain("meta_embedded_signup_status_save_failed");
    expect(route).toContain("meta_embedded_signup_audit_failed");
  });
});
