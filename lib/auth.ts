import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";

export async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    return { supabase, user: null };
  }

  return { supabase, user };
}

export async function requireUser() {
  const { supabase, user } = await getUser();
  if (!user) redirect("/signin");
  return { supabase, user };
}

/**
 * Resolve the current user's tenant context.
 *
 * If activeWorkspaceId is supplied, membership in that exact tenant is
 * required; the supplied ID is never treated as proof of authorization.
 * Without an explicit workspace, retain the existing earliest-membership
 * behavior for backward compatibility with current callers.
 *
 * On missing membership/tenant, returns the existing null-context shape so
 * callers that already consume this helper do not break.
 */
export async function getTenantContext(activeWorkspaceId?: string) {
  const { supabase, user } = await requireUser();

  let membershipQuery = supabase
    .from("tenant_members")
    .select("tenant_id, role, created_at")
    .eq("user_id", user.id);

  if (activeWorkspaceId) {
    membershipQuery = membershipQuery.eq("tenant_id", activeWorkspaceId);
  }

  const { data: membership, error: membershipError } = activeWorkspaceId
    ? await membershipQuery.maybeSingle()
    : await membershipQuery
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

  if (membershipError || !membership) {
    return { supabase, user, membership: null, tenant: null };
  }

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .select("*")
    .eq("id", membership.tenant_id)
    .maybeSingle();

  if (tenantError || !tenant) {
    return { supabase, user, membership: null, tenant: null };
  }

  return {
    supabase,
    user,
    membership,
    tenant,
    tenant_id: tenant.id,
    user_id: user.id,
    role: membership.role,
  };
}
