import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient, redirect } = vi.hoisted(() => ({
  createClient: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
}));

vi.mock("../../lib/supabase/server", () => ({ createClient }));
vi.mock("next/navigation", () => ({ redirect }));

import { getTenantContext } from "../../lib/auth";

function queryResult(data: unknown) {
  const query: Record<string, any> = {};
  for (const method of ["select", "eq", "order", "limit"]) query[method] = vi.fn(() => query);
  query.maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
  return query;
}

describe("authenticated tenant context", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects unauthenticated users before querying tenant membership", async () => {
    const from = vi.fn();
    createClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null } }) }, from });
    await expect(getTenantContext()).rejects.toThrow("redirect:/signin");
    expect(from).not.toHaveBeenCalled();
  });

  it("loads a tenant only through the authenticated user's membership", async () => {
    const membershipQuery = queryResult({ tenant_id: "tenant-A", role: "member" });
    const tenantQuery = queryResult({ id: "tenant-A", name: "Tenant A" });
    const from = vi.fn((table: string) => table === "tenant_members" ? membershipQuery : tenantQuery);
    const user = { id: "user-123" };
    createClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user } }) }, from });

    const result = await getTenantContext();

    expect(from).toHaveBeenNthCalledWith(1, "tenant_members");
    expect(membershipQuery.eq).toHaveBeenCalledWith("user_id", user.id);
    expect(tenantQuery.eq).toHaveBeenCalledWith("id", "tenant-A");
    expect(result.membership).toEqual({ tenant_id: "tenant-A", role: "member" });
    expect(result.tenant).toEqual({ id: "tenant-A", name: "Tenant A" });
  });

  it("returns no tenant when the authenticated user has no membership", async () => {
    const membershipQuery = queryResult(null);
    const from = vi.fn(() => membershipQuery);
    createClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "user-456" } } }) }, from });

    const result = await getTenantContext();

    expect(result.membership).toBeNull();
    expect(result.tenant).toBeNull();
    expect(from).toHaveBeenCalledTimes(1);
  });
});
