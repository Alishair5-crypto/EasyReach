import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";

const EDIT_ROLES = new Set(["owner","admin","manager"]);
const TYPES = new Set(["policy","faq","business","shipping","returns","payment","general"]);

function text(v: unknown, max: number) { return typeof v === "string" ? v.trim().slice(0, max) : ""; }

export async function GET() {
  try {
    const { supabase, tenant } = await getTenantContext();
    if (!tenant) return NextResponse.json({ error: "workspace_required" }, { status: 400 });
    const { data, error } = await supabase.from("knowledge_documents")
      .select("id,title,source_type,source_url,content,status,verification_status,verified_at,verified_by,last_synced_at,created_at")
      .eq("tenant_id", tenant.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ documents: data ?? [] });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "business_brain_load_failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { supabase, tenant, user, membership } = await getTenantContext();
    if (!tenant || !user || !membership) return NextResponse.json({ error: "workspace_required" }, { status: 400 });
    if (!EDIT_ROLES.has(membership.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const body = await req.json().catch(() => ({}));
    const title = text(body.title, 160), content = text(body.content, 30000), sourceType = text(body.source_type, 40) || "business", sourceUrl = text(body.source_url, 2000);
    if (!title || !content) return NextResponse.json({ error: "title_and_content_required" }, { status: 400 });
    if (!TYPES.has(sourceType)) return NextResponse.json({ error: "invalid_source_type" }, { status: 400 });
    const { data, error } = await supabase.from("knowledge_documents").insert({
      tenant_id: tenant.id, title, source_type: sourceType, source_url: sourceUrl || null, content, status: "active", verification_status: "pending", verified_at: null, verified_by: null, last_synced_at: new Date().toISOString()
    }).select("id,title,source_type,source_url,content,status,last_synced_at,created_at").single();
    if (error) throw error;
    const audit = await supabase.from("audit_logs").insert({
      tenant_id: tenant.id, actor_id: user.id, action: "knowledge.created", resource_type: "knowledge_document", resource_id: data.id, new_data: data, reason: "Business Brain document created"
    });
    if (audit.error) throw audit.error;
    return NextResponse.json({ document: data }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "business_brain_create_failed" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const { supabase, tenant, user, membership } = await getTenantContext();
    if (!tenant || !user || !membership) return NextResponse.json({ error: "workspace_required" }, { status: 400 });
    if (!EDIT_ROLES.has(membership.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const body = await req.json().catch(() => ({})), id = text(body.id, 100);
    if (!id) return NextResponse.json({ error: "document_id_required" }, { status: 400 });
    const { data: before, error: beforeError } = await supabase.from("knowledge_documents").select("*").eq("tenant_id", tenant.id).eq("id", id).maybeSingle();
    if (beforeError) throw beforeError;
    if (!before) return NextResponse.json({ error: "document_not_found" }, { status: 404 });
    const patch: Record<string, unknown> = {};
    if ("title" in body) patch.title = text(body.title, 160);
    if ("content" in body) patch.content = text(body.content, 30000);
    if ("source_type" in body) { const t = text(body.source_type, 40); if (!TYPES.has(t)) return NextResponse.json({ error: "invalid_source_type" }, { status: 400 }); patch.source_type = t; }
    if ("source_url" in body) patch.source_url = text(body.source_url, 2000) || null;
    if ("status" in body) { const s = text(body.status, 20); if (!["active","archived","pending","failed"].includes(s)) return NextResponse.json({ error: "invalid_status" }, { status: 400 }); patch.status = s; }\n    if (body.action === "verify") { patch.verification_status = "verified"; patch.verified_at = new Date().toISOString(); patch.verified_by = user.id; }\n    if (body.action === "reject") { patch.verification_status = "rejected"; patch.verified_at = null; patch.verified_by = null; }
    if (!Object.keys(patch).length) return NextResponse.json({ error: "no_changes" }, { status: 400 });
    patch.last_synced_at = new Date().toISOString();
    const { data, error } = await supabase.from("knowledge_documents").update(patch).eq("tenant_id", tenant.id).eq("id", id).select("id,title,source_type,source_url,content,status,last_synced_at,created_at").single();
    if (error) throw error;
    const audit = await supabase.from("audit_logs").insert({
      tenant_id: tenant.id, actor_id: user.id, action: "knowledge.updated", resource_type: "knowledge_document", resource_id: id, old_data: before, new_data: data, reason: typeof body.reason === "string" ? body.reason.slice(0,500) : "Business Brain document updated"
    });
    if (audit.error) throw audit.error;
    return NextResponse.json({ document: data });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "business_brain_update_failed" }, { status: 500 });
  }
}