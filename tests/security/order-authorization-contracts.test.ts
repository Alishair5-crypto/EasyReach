import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261010090000_harden_order_confirmation_mutations.sql"), "utf8");

describe("order and AI confirmation authorization regression contracts", () => {
  it("removes direct authenticated DML from order and confirmation tables", () => {
    expect(migration).toMatch(/revoke all privileges on table public\.orders from anon, authenticated/i);
    expect(migration).toMatch(/revoke all privileges on table public\.order_items from anon, authenticated/i);
    expect(migration).toMatch(/revoke all privileges on table public\.ai_action_confirmations from anon, authenticated/i);
    expect(migration).toMatch(/grant select on table public\.orders, public\.order_items, public\.ai_action_confirmations/i);
  });

  it("restricts status and payment mutation to permitted workspace roles", () => {
    expect(migration).toMatch(/function public\.transition_order_atomic[\s\S]*?tm\.role in \('owner', 'admin', 'manager', 'sales'\)/i);
    expect(migration).toMatch(/function public\.set_order_payment_atomic[\s\S]*?tm\.role in \('owner', 'admin', 'manager'\)/i);
  });

  it("restricts confirmation creation and confirmation to sales-capable roles", () => {
    expect(migration).toMatch(/function public\.create_order_confirmation[\s\S]*?tm\.role in \('owner', 'admin', 'manager', 'sales'\)/i);
    expect(migration).toMatch(/function public\.confirm_ai_action[\s\S]*?tm\.role in \('owner', 'admin', 'manager', 'sales'\)/i);
  });

  it("removes PUBLIC/anon execution from sensitive RPCs", () => {
    expect(migration).toMatch(/revoke all on function public\.create_order_atomic\([\s\S]*?from public, anon/i);
    expect(migration).toMatch(/revoke all on function public\.execute_confirmed_order_atomic\([\s\S]*?from public, anon/i);
  });

  it("keeps the audit table non-mutable through direct update/delete grants", () => {
    expect(migration).toMatch(/revoke update, delete, truncate, references, trigger on table public\.audit_logs from authenticated/i);
  });

  it("writes the order-created audit event inside the atomic order transaction", () => {
    expect(migration).toMatch(/function public\.create_order_atomic[\s\S]*?insert into public\.audit_logs[\s\S]*?Atomic order creation with server-verified catalog and inventory/i);
    expect(migration).toMatch(/set search_path = pg_catalog, public, pg_temp/i);
  });
});
