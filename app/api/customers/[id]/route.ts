import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";

type RouteContext = { params: Promise<{ id: string }> };
type JsonRecord = Record<string, unknown>;

const editableFields = [
  "name",
  "phone",
  "email",
  "preferred_language",
  "consent",
  "tags",
  "notes",
] as const;

const editableRoles = ["owner", "admin", "manager", "sales", "support"] as const;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validCustomerId(id: string): boolean {
  return uuidPattern.test(id);
}

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { supabase, tenant, membership } = await getTenantContext();
    if (!tenant || !membership) {
      return NextResponse.json({ error: "workspace_required" }, { status: 400 });
    }
    if (!(editableRoles as readonly string[]).includes(membership.role)) {
      return NextResponse.json({ error: "not_authorized" }, { status: 403 });
    }

    const { id } = await params;
    if (!validCustomerId(id)) {
      return NextResponse.json({ error: "invalid_customer_id" }, { status: 400 });
    }

    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .select("id,external_key,name,phone,email,preferred_language,consent,tags,notes,last_seen_at,created_at,updated_at")
      .eq("tenant_id", tenant.id)
      .eq("id", id)
      .maybeSingle();

    if (customerError) throw customerError;
    if (!customer) {
      return NextResponse.json({ error: "customer_not_found" }, { status: 404 });
    }

    const results = await Promise.all([
      supabase.from("customer_identities")
        .select("id,channel,external_id,display_name,phone,email,metadata,created_at,updated_at")
        .eq("tenant_id", tenant.id).eq("customer_id", id).order("created_at", { ascending: true }),
      supabase.from("conversations")
        .select("id,channel,status,priority,assigned_to,handoff,last_message_at,created_at")
        .eq("tenant_id", tenant.id).eq("customer_id", id).order("last_message_at", { ascending: false }),
      supabase.from("orders")
        .select("id,status,currency,subtotal,discount,total,payment_status,source_channel,metadata,created_at,updated_at")
        .eq("tenant_id", tenant.id).eq("customer_id", id).order("created_at", { ascending: false }),
      supabase.from("leads")
        .select("id,status,source_channel,budget,intent,notes,created_at,updated_at")
        .eq("tenant_id", tenant.id).eq("customer_id", id).order("created_at", { ascending: false }),
      supabase.from("followups")
        .select("id,conversation_id,channel,message,scheduled_for,status,attempts,last_error,created_at,updated_at")
        .eq("tenant_id", tenant.id).eq("customer_id", id).order("scheduled_for", { ascending: true }),
    ]);

    if (results.some((result) => result.error)) {
      throw new Error("customer_360_query_failed");
    }

    const [identitiesResult, conversationsResult, ordersResult, leadsResult, followupsResult] = results;
    const conversations = conversationsResult.data ?? [];
    const conversationIds = conversations.map((conversation) => conversation.id);
    let messages: Array<{
      id: string;
      conversation_id: string;
      direction: string;
      sender_type: string;
      external_id: string | null;
      content: string | null;
      media: unknown;
      created_at: string;
    }> = [];

    if (conversationIds.length > 0) {
      const { data, error } = await supabase
        .from("messages")
        .select("id,conversation_id,direction,sender_type,external_id,content,media,created_at")
        .eq("tenant_id", tenant.id)
        .in("conversation_id", conversationIds)
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) throw new Error("customer_messages_query_failed");
      messages = data ?? [];
    }

    return NextResponse.json({
      customer,
      identities: identitiesResult.data ?? [],
      conversations,
      messages,
      orders: ordersResult.data ?? [],
      leads: leadsResult.data ?? [],
      followups: followupsResult.data ?? [],
    });
  } catch {
    return NextResponse.json({ error: "customer_360_fetch_failed" }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const { supabase, tenant, user, membership } = await getTenantContext();
    if (!tenant || !user || !membership) {
      return NextResponse.json({ error: "workspace_required" }, { status: 400 });
    }
    if (!(editableRoles as readonly string[]).includes(membership.role)) {
      return NextResponse.json({ error: "not_authorized" }, { status: 403 });
    }

    const { id } = await params;
    if (!validCustomerId(id)) {
      return NextResponse.json({ error: "invalid_customer_id" }, { status: 400 });
    }

    const body: unknown = await request.json().catch(() => null);
    if (!isRecord(body)) {
      return NextResponse.json({ error: "invalid_request_body" }, { status: 400 });
    }
    if (Object.keys(body).some((key) => !(editableFields as readonly string[]).includes(key))) {
      return NextResponse.json({ error: "unsupported_customer_field" }, { status: 400 });
    }

    const patch: JsonRecord = {};
    for (const key of editableFields) {
      if (Object.prototype.hasOwnProperty.call(body, key)) patch[key] = body[key];
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "no_editable_fields" }, { status: 400 });
    }

    if ("name" in patch && patch.name !== null && typeof patch.name !== "string") {
      return NextResponse.json({ error: "invalid_name" }, { status: 400 });
    }
    if ("phone" in patch && patch.phone !== null && typeof patch.phone !== "string") {
      return NextResponse.json({ error: "invalid_phone" }, { status: 400 });
    }
    if ("email" in patch && patch.email !== null && typeof patch.email !== "string") {
      return NextResponse.json({ error: "invalid_email" }, { status: 400 });
    }
    if ("preferred_language" in patch && patch.preferred_language !== null && typeof patch.preferred_language !== "string") {
      return NextResponse.json({ error: "invalid_language" }, { status: 400 });
    }
    if ("tags" in patch && (!Array.isArray(patch.tags) || patch.tags.some((tag) => typeof tag !== "string"))) {
      return NextResponse.json({ error: "invalid_tags" }, { status: 400 });
    }
    if ("notes" in patch && patch.notes !== null && typeof patch.notes !== "string") {
      return NextResponse.json({ error: "invalid_notes" }, { status: 400 });
    }
    if ("consent" in patch && (patch.consent === null || !isRecord(patch.consent))) {
      return NextResponse.json({ error: "invalid_consent" }, { status: 400 });
    }

    const { data: customer, error } = await supabase.rpc("update_customer_atomic", {
      p_tenant_id: tenant.id,
      p_customer_id: id,
      p_patch: patch,
    });

    if (error) {
      const knownErrors: Record<string, number> = {
        not_authorized: 403,
        customer_not_found: 404,
        invalid_customer_patch: 400,
        invalid_name: 400,
        invalid_phone: 400,
        invalid_email: 400,
        invalid_language: 400,
        invalid_tags: 400,
        invalid_notes: 400,
        invalid_consent: 400,
      };
      const key = Object.keys(knownErrors).find((candidate) => error.message.includes(candidate));
      return NextResponse.json(
        { error: key ?? "customer_update_failed" },
        { status: key ? knownErrors[key] : 500 },
      );
    }

    if (!isRecord(customer)) {
      return NextResponse.json({ error: "customer_update_failed" }, { status: 500 });
    }
    return NextResponse.json({ customer });
  } catch {
    return NextResponse.json({ error: "customer_update_failed" }, { status: 500 });
  }
}
