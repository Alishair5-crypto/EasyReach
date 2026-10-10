import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const auth = readFileSync(resolve(process.cwd(), "lib/auth.ts"), "utf8");
const route = readFileSync(resolve(process.cwd(), "app/api/workspaces/active/route.ts"), "utf8");
const selector = readFileSync(resolve(process.cwd(), "app/workspaces/select/workspace-selector.tsx"), "utf8");
const page = readFileSync(resolve(process.cwd(), "app/workspaces/select/page.tsx"), "utf8");

describe("active workspace security contracts", () => {
  it("does not silently choose the earliest workspace for multi-workspace users", () => {
    expect(auth).toContain("availableMemberships.length === 1");
    expect(auth).toContain("workspaceSelectionRequired: true");
    expect(auth).not.toContain('.order("created_at", { ascending: true })');
  });

  it("validates selected workspace against the authenticated user's membership", () => {
    expect(route).toContain('.eq("tenant_id", workspaceId)');
    expect(route).toContain('.eq("user_id", user.id)');
    expect(route).toContain('error: "workspace_access_denied"');
    expect(route).toContain("httpOnly: true");
    expect(route).toContain('sameSite: "strict"');
  });

  it("offers an intentional workspace switch after a workspace is already active", () => {
    expect(page).toContain('params.switch !== "1"');
    expect(selector).toContain('fetch("/api/workspaces/active"');
    expect(selector).toContain('method: "POST"');
  });
});
