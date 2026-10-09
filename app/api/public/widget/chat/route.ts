import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createPrivilegedClient } from "@/lib/integrations/server";
import { runSalesAgent } from "@/lib/ai/orchestrator";
import { requireFeature } from "@/lib/entitlements";

export const runtime = "nodejs";

const MAX_MESSAGE = 4000;
const MAX_VISITOR = 120;

function text(v: unknown, max: number) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function originAllowed(origin: string, allowed: unknown[]) {
  if (!origin) return false;
  try {
    const candidate = new URL(origin).origin;
    return allowed.some((value) => {
      if (typeof value !== "string" || !value.trim()) return false;
      try {
        return new URL(value).origin === candidate;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

async function resolveWidget(req: Request, db: ReturnType<typeof createPrivilegedClient>) {
  const key = text(req.headers.get("x-easyreach-widget-key"), 200);
  if (!key || !/^[A-Za-z0-9_-]{16,200}$/.test(key)) throw new Error("invalid_widget_key");
  const { data: agent, error } = await db
    .from("agents")
    .select("id,tenant_id,status,widget_allowed_origins,widget_public_key")
    .eq("widget_public_key", key)
    .maybeSingle();
  if (error) throw error;
  if (!agent || agent.status !== "active") throw new Error("widget_not_active");
  const origin = req.headers.get("origin") ?? "";
  const allowed = Array.isArray(agent.widget_allowed_origins) ? agent.widget_allowed_origins : [];
  if (!originAllowed(origin, allowed)) throw new Error("origin_not_allowed");
  return agent;
}

function cors(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-EasyReach-Widget-Key",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  return new NextResponse(null, { status: 204, headers: cors(origin) });
}

export async function POST(req: Request) {
  const db = createPrivilegedClient();
  const origin = req.headers.get("origin") ?? "";
  try {
    const agent = await resolveWidget(req, db);
    const body = await req.json().catch(() => null);
    const message = text(body?.message, MAX_MESSAGE);
    const visitorId = text(body?.visitor_id, MAX_VISITOR);
    if (!message) return NextResponse.json({ error: "message_required" }, { status: 400, headers: cors(origin) });
    if (!visitorId || !/^[A-Za-z0-9._:-]{8,120}$/.test(visitorId)) return NextResponse.json({ error: "visitor_id_required" }, { status: 400, headers: cors(origin) });

    await requireFeature(agent.tenant_id, "core_ai", db);

    const externalKey = "website:" + visitorId;
    let { data: customer, error: customerError } = await db
      .from("customers")
      .select("id")
      .eq("tenant_id", agent.tenant_id)
      .eq("external_key", externalKey)
      .maybeSingle();
    if (customerError) throw customerError;

    if (!customer) {
      const created = await db
        .from("customers")
        .insert({
          tenant_id: agent.tenant_id,
          external_key: externalKey,
          name: "Website visitor",
          metadata: { source: "website_widget", visitor_id: visitorId },
          consent: { channel: "website", status: "unknown" },
          tags: ["website"],
        })
        .select("id")
        .single();
      if (created.error) {
        const retry = await db.from("customers").select("id").eq("tenant_id", agent.tenant_id).eq("external_key", externalKey).maybeSingle();
        if (retry.error || !retry.data) throw created.error;
        customer = retry.data;
      } else customer = created.data;
    }

    const conversationExternalId = "website:" + visitorId;
    let { data: conversation, error: conversationError } = await db
      .from("conversations")
      .select("id,customer_id,handoff,status")
      .eq("tenant_id", agent.tenant_id)
      .eq("channel", "website")
      .eq("external_id", conversationExternalId)
      .maybeSingle();
    if (conversationError) throw conversationError;

    if (!conversation) {
      const created = await db
        .from("conversations")
        .insert({
          tenant_id: agent.tenant_id,
          customer_id: customer.id,
          channel: "website",
          external_id: conversationExternalId,
          status: "open",
          priority: "normal",
          handoff: false,
          last_message_at: new Date().toISOString(),
        })
        .select("id,customer_id,handoff,status")
        .single();
      if (created.error) {
        const retry = await db.from("conversations").select("id,customer_id,handoff,status").eq("tenant_id", agent.tenant_id).eq("channel", "website").eq("external_id", conversationExternalId).maybeSingle();
        if (retry.error || !retry.data) throw created.error;
        conversation = retry.data;
      } else conversation = created.data;
    }

    if (conversation.customer_id !== customer.id) throw new Error("visitor_identity_conflict");
    if (conversation.handoff) return NextResponse.json({ error: "human_handoff_active", conversation_id: conversation.id }, { status: 409, headers: cors(origin) });

    const result = await runSalesAgent({
      tenantId: agent.tenant_id,
      agentId: agent.id,
      conversationId: conversation.id,
      customerId: customer.id,
      message,
      userId: (await db.from("tenants").select("owner_id").eq("id", agent.tenant_id).single()).data?.owner_id ?? "",
    }, { db });

    return NextResponse.json({
      conversation_id: result.conversationId,
      message_id: result.messageId,
      text: result.text,
      channel: "website",
    }, { headers: cors(origin) });
  } catch (e) {
    const code = e instanceof Error ? e.message : "website_chat_failed";
    const status = code === "origin_not_allowed" ? 403 : code === "widget_not_active" ? 404 : code === "invalid_widget_key" ? 400 : code === "human_handoff_active" ? 409 : code === "usage_limit_exceeded" ? 402 : 500;
    return NextResponse.json({ error: code }, { status, headers: cors(origin) });
  }
}
