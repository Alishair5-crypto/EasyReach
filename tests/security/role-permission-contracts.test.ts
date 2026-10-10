import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const aiChat = read("app/api/ai/chat/route.ts");
const customer = read("app/api/customers/[id]/route.ts");
const conversation = read("app/api/conversations/[id]/route.ts");
const orders = read("app/api/orders/route.ts");
const sql = read("supabase/migrations/20261010090000_harden_order_confirmation_mutations.sql");

describe("role authorization contracts", () => {
  it("restricts AI chat and order creation to sales-capable roles", () => {
    expect(aiChat).toContain('["owner","admin","manager","sales"].includes(membership.role)');
    expect(orders).toContain('["owner", "admin", "manager", "sales"].includes(membership.role)');
  });

  it("denies viewer role customer and conversation mutations", () => {
    expect(customer).toContain('const editableRoles = ["owner", "admin", "manager", "sales", "support"] as const');
    expect(customer).toContain('(editableRoles as readonly string[]).includes(membership.role)');
    expect(conversation).toContain('const editableRoles = ["owner", "admin", "manager", "sales", "support"] as const');
    expect(conversation).toContain('(editableRoles as readonly string[]).includes(membership.role)');
  });

  it("enforces role authorization inside privileged database RPCs as defense in depth", () => {
    expect(sql).toMatch(/function public\.create_order_atomic[\s\S]*?role in \('owner', 'admin', 'manager', 'sales'\)/i);
    expect(sql).toMatch(/function public\.set_order_payment_atomic[\s\S]*?role in \('owner', 'admin', 'manager'\)/i);
    expect(sql).toMatch(/function public\.execute_confirmed_order_atomic[\s\S]*?role in \('owner', 'admin', 'manager', 'sales'\)/i);
  });
});
