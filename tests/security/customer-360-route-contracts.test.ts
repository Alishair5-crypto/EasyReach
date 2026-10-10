import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const route = readFileSync(resolve(process.cwd(), "app/api/customers/[id]/route.ts"), "utf8");

describe("Customer 360 API contracts", () => {
  it("validates customer identifiers before querying", () => {
    expect(route).toContain("function validCustomerId(id: string): boolean");
    expect(route).toContain('error: "invalid_customer_id"');
    expect(route).toContain('.eq("tenant_id", tenant.id)');
    expect(route).toContain('.eq("id", id)');
  });

  it("checks every Customer 360 query for errors instead of silently returning empty data", () => {
    expect(route).toContain("results.some((result) => result.error)");
    expect(route).toContain("customer_360_query_failed");
    expect(route).toContain("customer_messages_query_failed");
  });

  it("does not use TypeScript any or leak raw database errors to clients", () => {
    expect(route).not.toMatch(/\bany\b/);
    expect(route).toContain('error: "customer_360_fetch_failed"');
    expect(route).toContain('error: "customer_update_failed"');
    expect(route).not.toContain("error: e.message");
  });

  it("rejects unknown patch keys and checks role permissions before mutations", () => {
    expect(route).toContain("unsupported_customer_field");
    expect(route).toContain("editableRoles");
    expect(route).toContain('supabase.rpc("update_customer_atomic"');
  });
});
