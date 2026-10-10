import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";

const statuses = ["open", "pending", "closed"] as const;
const priorities = ["low", "normal", "high", "urgent"] as const;
const editableRoles = ["owner", "admin", "manager", "sales", "support"] as const;
const readableRoles = editableRoles;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ConversationPatch = {
  status?: (typeof statuses)[number];
  priority?: (typeof priorities)[number];
  handoff?: boolean;
  assigned_to?: string | null;
};
type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validConversationId(id: string): boolean {
  return uuidPattern.test(id);
}

function parsePatch(body: JsonRecord): ConversationPatch | null {
  const allowed = new Set(["status", "priority", "handoff", "assigned_to"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) return null;
  const patch: ConversationPatch = {};

  if ("status" in body) {
    if (typeof body.status !== "string" || !statuses.includes(body.status as (typeof statuses)[number])) return null;
    patch.status = body.status as (typeof statuses)[number];
  }
  if ("priority" in body) {
    if (typeof body.priority !== "string" || !priorities.includes(body.priority as (typeof priorities)[number])) return null;
    patch.priority = body.priority as (typeof priorities)[number];
  }
  if ("handoff" in body) {
    if (typeof body.handoff !== "boolean") return null;
    patch.handoff = body.handoff;
  }
  if ("assigned_to" in body) {
    if (body.assigned_to !== null &&
      (typeof body.assigned_to !== "string" || !uuidPattern.test(body.assigned_to))) {
      return null;
    }
    patch.assigned_to = body.assigned_to as string | null;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

function updateErrorResponse(message: string) {
  if (message.includes("conversation_not_found")) return NextResponse.json({ error: "conversation_not_found" }, { status: 404 });
  if (message.includes("not_authorized")) return NextResponse.json({ error: "not_authorized" }, { status: 403 });
  if (message.includes("invalid_assignee")) return NextResponse.json({ error: "invalid_assignee" }, { status: 400 });
  if (message.includes("invalid_status")) return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  if (message.includes("invalid_priority")) return NextResponse.json({ error: "invalid_priority" }, { status: 400 });
  if (message.includes("invalid_handoff")) return NextResponse.json({ error: "invalid_handoff" }, { status: 400 });
  return NextResponse.json({ error: "conversation_update_failed" }, { status: 500 });
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, tenant, membership } = await getTenantContext();
    if (!tenant || !membership) return NextResponse.json({ error: "workspace_required" }, { status: 400 });
    if (!(readableRoles as readonly string[]).includes(membership.role)) {
      return NextResponse.json({ error: "not_authorized" }, { status: 403 });
    }

    const { id } = await params;
    if (!validConversationId(id)) {
      return NextResponse.json({ error: "invalid_conversation_id" }, { status: 400 });
    }

    const { data: conversation, error } = await supabase
      .from("conversations")
      .select("id,customer_id,channel,external_id,status,priority,assigned_to,handoff,last_message_at,created_at")
      .eq("tenant_id", tenant.id)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!conversation) return NextResponse.json({ error: "conversation_not_found" }, { status: 404 });

    const [{ data: customer, error: customerError }, { data: messages, error: messagesError }, { data: members, error: membersError }] =
      await Promise.all([
        conversation.customer_id
          ? supabase.from("customers").select("id,name,phone,email,preferred_language,tags").eq("tenant_id", tenant.id).eq("id", conversation.customer_id).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        supabase.from("messages").select("id,conversation_id,direction,sender_type,content,media,created_at,read_at")
          .eq("tenant_id", tenant.id).eq("conversation_id", id).order("created_at", { ascending: false }).limit(200),
        supabase.from("tenant_members").select("user_id,role").eq("tenant_id", tenant.id),
      ]);
    if (customerError || messagesError || membersError) throw new Error("conversation_detail_query_failed");

    return NextResponse.json({
      conversation: {
        ...conversation,
        customer: customer ?? null,
        messages: (messages ?? []).reverse(),
        members: members ?? [],
      },
    });
  } catch {
    return NextResponse.json({ error: "conversation_fetch_failed" }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, tenant, user, membership } = await getTenantContext();
    if (!tenant || !user || !membership) {
      return NextResponse.json({ error: "workspace_required" }, { status: 400 });
    }
    if (!(editableRoles as readonly string[]).includes(membership.role)) {
      return NextResponse.json({ error: "not_authorized" }, { status: 403 });
    }

    const { id } = await params;
    if (!validConversationId(id)) {
      return NextResponse.json({ error: "invalid_conversation_id" }, { status: 400 });
    }

    const body: unknown = await req.json().catch(() => null);
    if (!isRecord(body)) return NextResponse.json({ error: "invalid_request_body" }, { status: 400 });
    const patch = parsePatch(body);
    if (!patch) return NextResponse.json({ error: "invalid_conversation_patch" }, { status: 400 });

    const { data, error } = await supabase.rpc("update_conversation_atomic", {
      p_tenant_id: tenant.id,
      p_conversation_id: id,
      p_patch: patch,
    });
    if (error) return updateErrorResponse(error.message);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return NextResponse.json({ error: "conversation_update_failed" }, { status: 500 });
    }
    return NextResponse.json({ conversation: data });
  } catch {
    return NextResponse.json({ error: "conversation_update_failed" }, { status: 500 });
  }
}
