import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";

export const ACTIVE_WORKSPACE_COOKIE = "easyreach_active_workspace_id";

type Membership = { tenant_id: string; role: string };
type Tenant = { id: string; name: string; onboarding_step: number; [key: string]: unknown };

export async function getUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) throw new Error("AUTHENTICATION_LOOKUP_FAILED");
  return { supabase, user };
}

export async function requireUser() {
  const { supabase, user } = await getUser();
  if (!user) redirect("/signin");
  return { supabase, user };
}

export async function getTenantContext() {
  const { supabase, user } = await requireUser();
  const cookieStore = await cookies();
  const activeWorkspaceId = cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value ?? null;
  const { data: memberships, error: membershipError } = await supabase
    .from("tenant_members")
    .select("tenant_id,role")
    .eq("user_id", user.id);

  if (membershipError) throw new Error("TENANT_MEMBERSHIP_LOOKUP_FAILED");
  const availableMemberships = (memberships ?? []) as Membership[];
  if (availableMemberships.length === 0) {
    return { supabase, user, membership: null, tenant: null, memberships: availableMemberships, workspaceSelectionRequired: false };
  }

  let membership: Membership | null = null;
  if (activeWorkspaceId) {
    membership = availableMemberships.find(item => item.tenant_id === activeWorkspaceId) ?? null;
    if (!membership) {
      return { supabase, user, membership: null, tenant: null, memberships: availableMemberships, workspaceSelectionRequired: true };
    }
  } else if (availableMemberships.length === 1) {
    membership = availableMemberships[0];
  } else {
    return { supabase, user, membership: null, tenant: null, memberships: availableMemberships, workspaceSelectionRequired: true };
  }

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .select("*")
    .eq("id", membership.tenant_id)
    .maybeSingle();

  if (tenantError) throw new Error("ACTIVE_WORKSPACE_LOOKUP_FAILED");
  if (!tenant) return { supabase, user, membership: null, tenant: null, memberships: availableMemberships, workspaceSelectionRequired: true };
  return { supabase, user, membership, tenant: tenant as Tenant, memberships: availableMemberships, workspaceSelectionRequired: false };
}
