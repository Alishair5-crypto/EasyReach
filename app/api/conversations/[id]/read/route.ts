import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";

const readableRoles = ["owner", "admin", "manager", "sales", "support"];

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, tenant, user, membership } = await getTenantContext();
    if (!tenant || !user || !membership) {
      return NextResponse.json({ error: "workspace_required" }, { status: 400 });
    }
    if (!readableRoles.includes(membership.role)) {
      return NextResponse.json({ error: "not_authorized" }, { status: 403 });
    }

    const { id } = await params;
    const { data: conversation, error: conversationError } = await supabase
      .from("conversations")
      .select("id")
      .eq("tenant_id", tenant.id)
      .eq("id", id)
      .maybeSingle();

    if (conversationError) throw conversationError;
    if (!conversation) {
      return NextResponse.json({ error: "conversation_not_found" }, { status: 404 });
    }

    const { error: updateError } = await supabase
      .from("messages")
      .update({ read_at: new Date().toISOString() })
      .eq("tenant_id", tenant.id)
      .eq("conversation_id", id)
      .eq("direction", "inbound")
      .is("read_at", null);

    if (updateError) throw updateError;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "message_read_acknowledgement_failed" }, { status: 500 });
  }
}
