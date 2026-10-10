import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const resourceLimitMigration = read("supabase/migrations/20261009214130_fix_starter_integration_channel_limit.sql");
const bootstrapMigration = read("supabase/migrations/20261009215156_fix_bootstrap_audit_log_columns.sql");

describe("resource-limit and tenant bootstrap regression contracts", () => {
  it("checks integration status only inside the integrations-specific trigger branch", () => {
    const integrationBranch = resourceLimitMigration.indexOf("if TG_TABLE_NAME = 'integrations' then");
    const statusCheck = resourceLimitMigration.indexOf("NEW.status", integrationBranch);
    const metricGuard = resourceLimitMigration.indexOf("if v_metric is null then return NEW; end if;");
    expect(metricGuard).toBeGreaterThanOrEqual(0);
    expect(integrationBranch).toBeGreaterThan(metricGuard);
    expect(statusCheck).toBeGreaterThan(integrationBranch);
    expect(resourceLimitMigration).toContain("('connected', 'connecting', 'pending')");
  });

  it("counts only active integrations against channel entitlements", () => {
    expect(resourceLimitMigration).toContain("i.status in ('connected', 'connecting', 'pending')");
    expect(resourceLimitMigration).toContain("create trigger integrations_resource_limit_update");
    expect(resourceLimitMigration).toContain("before update of status, tenant_id on public.integrations");
    expect(resourceLimitMigration).toContain("pg_advisory_xact_lock");
  });

  it("keeps bootstrap identity server-derived and records audit fields matching the current schema", () => {
    expect(bootstrapMigration).toContain("v_uid uuid := auth.uid()");
    expect(bootstrapMigration).toContain("if v_uid is null then");
    expect(bootstrapMigration).toContain("insert into public.audit_logs(tenant_id, actor_id, action, resource_type, resource_id, new_data)");
    expect(bootstrapMigration).not.toContain("user_id, action, entity_type, entity_id, new_values");
    expect(bootstrapMigration).toContain("revoke all on function public.bootstrap_tenant(text, text, text) from public, anon");
    expect(bootstrapMigration).toContain("grant execute on function public.bootstrap_tenant(text, text, text) to authenticated");
  });
});
