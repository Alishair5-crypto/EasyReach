import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";

const EDIT_ROLES = new Set(["owner", "admin", "manager"]);

function validId(v: unknown) { return typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v); }

function normalizeOrigins(value: unknown) {
  if (!Array.isArray(value)) return null;
  const origins = value.map((v) => typeof v === "string" ? v.trim() : "").filter(Boolean);
  if (!origins.length || origins.length > 20) return null;
  const normalized: string[] = [];
  for (const raw of origins) {
    try {
      const u = new URL(raw);
      if (u.protocol !== "https:" && u.hostname !== "localhost") return null;
      if (u.username || u.password || u.pathname !== "/" || u.search || u.hash) return null;
      const origin = u.origin;
      if (!normalized.includes(origin)) normalized.push(origin);
    } catch { return null; }
  }
  return normalized;
}

export async function GET(req: Request) {
  try {
    const { tenant, membership, supabase } = await getTenantContext();
    if (!tenant || !membership) return NextResponse.json({ error: "workspace_required" }, { status: 400 });
    if (!EDIT_ROLES.has(membership.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const agentId = new URL(req.url).searchParams.get("agent_id") ?? "";
    if (!validId(agentId)) return NextResponse.json({ error: "agent_id_required" }, { status: 400 });
    const { data, error } = await supabase.from("agents").select("id,name,status,widget_public_key,widget_allowed_origins").eq("tenant_id", tenant.id).eq("id", agentId).maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "agent_not_found" }, { status: 404 });
    return NextResponse.json({ widget: { agent_id: data.id, agent_name: data.name, status: data.status, public_key: data.widget_public_key, allowed_origins: data.widget_allowed_origins ?? [] } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "widget_config_failed" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const { tenant, user, membership, supabase } = await getTenantContext();
    if (!tenant || !membership) return NextResponse.json({ error: "workspace_required" }, { status: 400 });
    if (!EDIT_ROLES.has(membership.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const body = await req.json().catch(() => null);
    const agentId = typeof body?.agent_id === "string" ? body.agent_id : "";
    if (!validId(agentId)) return NextResponse.json({ error: "agent_id_required" }, { status: 400 });
    const origins = normalizeOrigins(body?.allowed_origins);
    if (!origins) return NextResponse.json({ error: "valid_allowed_origins_required" }, { status: 400 });

    const { data: old, error: loadError } = await supabase.from("agents").select("id,name,status,widget_public_key,widget_allowed_origins").eq("tenant_id", tenant.id).eq("id", agentId).maybeSingle();
    if (loadError) throw loadError;
    if (!old) return NextResponse.json({ error: "agent_not_found" }, { status: 404 });
    if (old.status !== "active") return NextResponse.json({ error: "agent_must_be_active" }, { status: 409 });

    const publicKey = old.widget_public_key || "ew_" + randomBytes(24).toString("base64url");
    const { data, error } = await supabase.from("agents").update({ widget_public_key: publicKey, widget_allowed_origins: origins, updated_at: new Date().toISOString() }).eq("tenant_id", tenant.id).eq("id", agentId).select("id,name,status,widget_public_key,widget_allowed_origins").single();
    if (error) throw error;

    await supabase.from("audit_logs").insert({
      tenant_id: tenant.id,
      actor_id: user.id,
      action: "agent.widget_configured",
      resource_type: "agent",
      resource_id: agentId,
      old_data: { widget_allowed_origins: old.widget_allowed_origins ?? [], widget_public_key_configured: Boolean(old.widget_public_key) },
      new_data: { widget_allowed_origins: origins, widget_public_key_configured: true },
      reason: "Website AI widget configured",
    });

    return NextResponse.json({ widget: { agent_id: data.id, agent_name: data.name, status: data.status, public_key: data.widget_public_key, allowed_origins: data.widget_allowed_origins } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "widget_config_failed" }, { status: 500 });
  }
}
