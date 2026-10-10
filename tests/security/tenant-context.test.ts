import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient, redirect, cookies } = vi.hoisted(() => ({
  createClient: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
  cookies: vi.fn(),
}));

vi.mock("../../lib/supabase/server", () => ({ createClient }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/headers", () => ({ cookies }));

import { getTenantContext } from "../../lib/auth";

function queryResult(data: unknown) {
  const query: Record<string, any> = {};
  for (const method of ["select", "eq", "order", "limit"]) query[method] = vi.fn(() => query);
  query.maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
  return query;
}

describe("authenticated tenant context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookies.mockResolvedValue({ get: vi.fn(() => undefined) });
  });

  it("redirects unauthenticated users before querying tenant membership", async () => {
    const from = vi.fn();
    createClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null }, error: null }) }, from });
    await expect(getTenantContext()).rejects.toThrow("redirect:/signin");
    expect(from).not.toHaveBeenCalled();
  });

  it("uses the sole membership when the user has exactly one workspace", async () => {
    const memberships = [{ tenant_id: "tenant-A", role: "owner" }];
    const membershipQuery = { select: vi.fn(() => membershipQuery), eq: vi.fn(() => membershipQuery), maybeSingle: vi.fn(), then: undefined } as unknown as Record<string, unknown>;
    const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
    const from = vi.fn((table: string) => {
      if (table === "tenant_members") {
        const q = { select: vi.fn(() => q), eq: vi.fn(() => q), then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: memberships, error: null }).then(resolve) };
        return q;
      }
      return queryResult({ id: "tenant-A", name: "Tenant A" });
    });
    createClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "user-123" } }, error: null }) }, from });
    const result = await getTenantContext();
    expect(result.tenant).toMatchObject({ id: "tenant-A", name: "Tenant A" });
    expect(result.membership).toEqual(memberships[0]);
  });

  it("requires explicit workspace selection when multiple memberships exist", async () => {
    const memberships = [{ tenant_id: "tenant-A", role: "owner" }, { tenant_id: "tenant-B", role: "support" }];
    const from = vi.fn(() => {
      const q = { select: vi.fn(() => q), eq: vi.fn(() => q), maybeSingle: vi.fn(), then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: memberships, error: null }).then(resolve) };
      return q;
    });
    createClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "user-456" } }, error: null }) }, from });
    const result = await getTenantContext();
    expect(result.tenant).toBeNull();
    expect(result.membership).toBeNull();
    expect(result.workspaceSelectionRequired).toBe(true);
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("does not accept an active workspace cookie without matching membership", async () => {
    cookies.mockResolvedValue({ get: vi.fn(() => ({ value: "tenant-C" })) });
    const memberships = [{ tenant_id: "tenant-A", role: "owner" }];
    const from = vi.fn(() => {
      const q = { select: vi.fn(() => q), eq: vi.fn(() => q), maybeSingle: vi.fn(), then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: memberships, error: null }).then(resolve) };
      return q;
    });
    createClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "user-456" } }, error: null }) }, from });
    const result = await getTenantContext();
    expect(result.tenant).toBeNull();
    expect(result.workspaceSelectionRequired).toBe(true);
    expect(from).toHaveBeenCalledTimes(1);
  });
});
