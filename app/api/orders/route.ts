import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeOrderError(message: string) {
  const known: Record<string, number> = {
    not_authorized: 403,
    customer_not_found: 404,
    invalid_items: 400,
    invalid_quantity: 400,
    variant_price_unavailable: 409,
    product_price_unavailable: 409,
    insufficient_inventory: 409,
    product_required: 400,
    invalid_item_id: 400,
    invalid_idempotency_key: 400,
    plan_inactive: 402,
    feature_not_entitled: 403,
    usage_limit_exceeded: 429,
  };
  const key = Object.keys(known).find((item) => message.includes(item));
  return NextResponse.json({ error: key ?? "order_creation_failed" }, { status: key ? known[key] : 500 });
}

export async function POST(req: Request) {
  try {
    const { supabase, tenant, user } = await getTenantContext();
    if (!tenant || !user) return NextResponse.json({ error: "workspace_required" }, { status: 400 });

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || !Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) {
      return NextResponse.json({ error: "invalid_items" }, { status: 400 });
    }

    const rawKey = req.headers.get("Idempotency-Key")?.trim() ?? "";
    if (rawKey.length < 8 || rawKey.length > 200) {
      return NextResponse.json({ error: "invalid_idempotency_key" }, { status: 400 });
    }

    const customerId = body.customer_id == null ? null : String(body.customer_id);
    if (customerId && !UUID.test(customerId)) {
      return NextResponse.json({ error: "invalid_customer_id" }, { status: 400 });
    }

    const items = body.items.map((item: any) => ({
      product_id: typeof item?.product_id === "string" && item.product_id ? item.product_id : null,
      variant_id: typeof item?.variant_id === "string" && item.variant_id ? item.variant_id : null,
      quantity: item?.quantity,
    }));
    const invalidItems = items.some((item: any) => {
      const hasProduct = item.product_id !== null;
      const hasVariant = item.variant_id !== null;
      return hasProduct === hasVariant
        || (hasProduct && !UUID.test(item.product_id))
        || (hasVariant && !UUID.test(item.variant_id))
        || !Number.isInteger(item.quantity)
        || item.quantity < 1
        || item.quantity > 10000;
    });
    if (invalidItems) return NextResponse.json({ error: "invalid_items" }, { status: 400 });

    const { data: orderId, error } = await supabase.rpc("create_order_atomic", {
      p_tenant_id: tenant.id,
      p_customer_id: customerId,
      p_source_channel: typeof body.source_channel === "string" ? body.source_channel.slice(0, 100) : "dashboard",
      p_currency: typeof body.currency === "string" ? body.currency.slice(0, 10) : "PKR",
      p_items: items,
      p_idempotency_key: rawKey,
    });
    if (error) return safeOrderError(error.message || "");

    const { data: order, error: readError } = await supabase
      .from("orders").select("*,order_items(*)")
      .eq("tenant_id", tenant.id).eq("id", orderId).maybeSingle();
    if (readError) return NextResponse.json({ error: "order_read_failed" }, { status: 500 });
    if (!order) return NextResponse.json({ error: "order_read_failed" }, { status: 500 });

    // The RPC is idempotent. Avoid duplicating its audit event when a client retries.
    const { data: existingAudit, error: auditReadError } = await supabase.from("audit_logs")
      .select("id")
      .eq("tenant_id", tenant.id)
      .eq("resource_type", "order")
      .eq("resource_id", orderId)
      .eq("action", "order_created")
      .limit(1)
      .maybeSingle();
    if (auditReadError) return NextResponse.json({ error: "order_audit_failed" }, { status: 500 });
    if (!existingAudit) {
      const { error: auditError } = await supabase.from("audit_logs").insert({
        tenant_id: tenant.id,
        actor_id: user.id,
        action: "order_created",
        resource_type: "order",
        resource_id: orderId,
        new_data: order,
        reason: "Verified atomic order action",
      });
      if (auditError) return NextResponse.json({ error: "order_audit_failed" }, { status: 500 });
    }

    return NextResponse.json({ order }, { status: 201, headers: { "Idempotency-Key": rawKey } });
  } catch {
    return NextResponse.json({ error: "order_creation_failed" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const { supabase, tenant } = await getTenantContext();
    if (!tenant) return NextResponse.json({ error: "workspace_required" }, { status: 400 });
    const url = new URL(req.url);
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 25) || 25));
    let query = supabase.from("orders")
      .select("id,customer_id,status,currency,subtotal,discount,total,payment_status,source_channel,created_at,updated_at")
      .eq("tenant_id", tenant.id)
      .order("created_at", { ascending: false })
      .limit(limit);
    const customerId = url.searchParams.get("customer_id");
    if (customerId) {
      if (!UUID.test(customerId)) return NextResponse.json({ error: "invalid_customer_id" }, { status: 400 });
      query = query.eq("customer_id", customerId);
    }
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ orders: data ?? [] });
  } catch {
    return NextResponse.json({ error: "order_list_failed" }, { status: 500 });
  }
}
