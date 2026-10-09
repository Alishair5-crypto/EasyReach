import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { annotateKnowledgeTrust } from "@/lib/ai/knowledge-trust";

const EDIT_ROLES = new Set(["owner", "admin", "manager"]);
const TYPES = new Set(["policy", "faq", "business", "shipping", "returns", "payment", "general"]);

function text(v: unknown, max: number) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export async function GET() {
  try {
    const { supabase, tenant } = await getTenantContext();
    if (!tenant) return NextResponse.json({ error: "workspace_required" }, { status: 400 });
    const { data, error } = await supabase.from("knowledge_documents")
      .select("id,title,source_type,source_url,content,status,verification_status,verified_at,verified_by,last_synced_at,created_at")
      .eq("tenant_id", tenant.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ documents: annotateKnowledgeTrust(data ?? []) });
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
    const title = text(body.title, 160);
    const content = text(body.content, 30000);
    const sourceType = text(body.source_type, 40) || "business";
    const sourceUrl = text(body.source_url, 2000);
    if (!title || !content) return NextResponse.json({ error: "title_and_content_required" }, { status: 400 });
    if (!TYPES.has(sourceType)) return NextResponse.json({ error: "invalid_source_type" }, { status: 400 });

    const { data, error } = await supabase.from("knowledge_documents").insert({
      tenant_id: tenant.id,
      title,
      source_type: sourceType,
      source_url: sourceUrl || null,
      content,
      status: "active",
      verification_status: "pending",
      verified_at: null,
      verified_by: null,
      last_synced_at: null
    }).select("id,title,source_type,source_url,content,status,verification_status,verified_at,verified_by,last_synced_at,created_at").single();
    if (error) throw error;
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

    const body = await req.json().catch(() => ({}));
    const id = text(body.id, 100);
    if (!id) return NextResponse.json({ error: "document_id_required" }, { status: 400 });

    const { data: before, error: beforeError } = await supabase.from("knowledge_documents")
      .select("*").eq("tenant_id", tenant.id).eq("id", id).maybeSingle();
    if (beforeError) throw beforeError;
    if (!before) return NextResponse.json({ error: "document_not_found" }, { status: 404 });

    if (body.action === "verify") {
      if (before.status !== "active") return NextResponse.json({ error: "only_active_knowledge_can_be_verified" }, { status: 409 });
      const patch = { verification_status: "verified", verified_at: new Date().toISOString(), verified_by: user.id };
      const { data, error } = await supabase.from("knowledge_documents").update(patch)
        .eq("tenant_id", tenant.id).eq("id", id).eq("status", "active")
        .select("id,title,source_type,source_url,content,status,verification_status,verified_at,verified_by,last_synced_at,created_at").maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: "knowledge_state_changed_retry" }, { status: 409 });
      return NextResponse.json({ document: data });
    }

    if (body.action === "reject") {
      const patch = { verification_status: "rejected", verified_at: null, verified_by: null };
      const { data, error } = await supabase.from("knowledge_documents").update(patch)
        .eq("tenant_id", tenant.id).eq("id", id)
        .select("id,title,source_type,source_url,content,status,verification_status,verified_at,verified_by,last_synced_at,created_at").single();
      if (error) throw error;
      return NextResponse.json({ document: data });
    }

    const patch: Record<string, unknown> = {};
    let substantiveChange = false;
    if ("title" in body) { patch.title = text(body.title, 160); substantiveChange = true; }
    if ("content" in body) { patch.content = text(body.content, 30000); substantiveChange = true; }
    if ("source_type" in body) {
      const t = text(body.source_type, 40);
      if (!TYPES.has(t)) return NextResponse.json({ error: "invalid_source_type" }, { status: 400 });
      patch.source_type = t; substantiveChange = true;
    }
    if ("source_url" in body) { patch.source_url = text(body.source_url, 2000) || null; substantiveChange = true; }
    let statusChanged = false;
    if ("status" in body) {
      const s = text(body.status, 20);
      if (!["active", "archived", "pending", "failed"].includes(s)) return NextResponse.json({ error: "invalid_status" }, { status: 400 });
      if (s !== before.status) statusChanged = true;
      patch.status = s;
    }
    if ("title" in body && !patch.title) return NextResponse.json({ error: "title_required" }, { status: 400 });
    if ("content" in body && !patch.content) return NextResponse.json({ error: "content_required" }, { status: 400 });
    if (substantiveChange || statusChanged) {
      patch.verification_status = "pending";
      patch.verified_at = null;
      patch.verified_by = null;
    }
    if (!Object.keys(patch).length) return NextResponse.json({ error: "no_changes" }, { status: 400 });

    const { data, error } = await supabase.from("knowledge_documents").update(patch)
      .eq("tenant_id", tenant.id).eq("id", id)
      .select("id,title,source_type,source_url,content,status,verification_status,verified_at,verified_by,last_synced_at,created_at").single();
    if (error) throw error;
    return NextResponse.json({ document: data });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "business_brain_update_failed" }, { status: 500 });
  }
}
