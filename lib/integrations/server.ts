import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "./secrets";

export function createPrivilegedClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("supabase_service_role_not_configured");
  return createSupabaseClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function getIntegrationSecret(id: string) {
  const admin = createPrivilegedClient();
  const { data, error } = await admin.from("integration_secrets").select("encrypted_payload,provider,key_version,integration_id").eq("integration_id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("integration_secret_missing");
  return { provider: data.provider as string, keyVersion: data.key_version as number, secret: decryptSecret<Record<string, unknown>>(data.encrypted_payload) };
}