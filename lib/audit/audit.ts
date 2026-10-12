import type { SupabaseClient } from "@supabase/supabase-js";

type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface CreateAuditLogParams {
  tenant_id: string;
  actor_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  old_data?: Json;
  new_data?: Json;
  reason?: string;
}

/**
 * Inserts a tenant-scoped audit event using the real audit_logs schema.
 * The caller is responsible for authenticating the actor and validating
 * tenant/resource ownership before invoking this helper.
 */
export async function createAuditLog(
  supabase: SupabaseClient,
  params: CreateAuditLogParams,
): Promise<void> {
  const { error } = await supabase.from("audit_logs").insert({
    tenant_id: params.tenant_id,
    actor_id: params.actor_id,
    action: params.action,
    resource_type: params.resource_type,
    resource_id: params.resource_id,
    old_data: params.old_data,
    new_data: params.new_data,
    reason: params.reason,
  });

  if (error) {
    console.error("Audit log failed", {
      action: params.action,
      tenant_id: params.tenant_id,
      error,
    });
    throw error;
  }
}
