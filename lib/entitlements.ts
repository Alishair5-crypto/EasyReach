import { createClient } from "./supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export type Entitlements = {
  status: string;
  plan: string;
  features: Record<string, unknown>;
  limits: Record<string, unknown>;
};

type Db = SupabaseClient;

type PlanRecord = {
  code: string;
  features: Record<string, unknown> | null;
  limits: Record<string, unknown> | null;
  active: boolean;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isExpired(value: string | null | undefined, now: number): boolean {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  // Treat malformed persisted dates as invalid rather than granting access.
  return !Number.isFinite(timestamp) || timestamp < now;
}

export async function getEntitlements(tenantId: string, db?: Db): Promise<Entitlements> {
  if (!tenantId) throw new Error("entitlement_tenant_required");

  const supabase = db ?? await createClient();
  const now = Date.now();

  const { data: subscription, error: subscriptionError } = await supabase
    .from("subscriptions")
    .select("status,starts_at,ends_at,plans(code,features,limits,active)")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (subscriptionError) {
    throw new Error(`Entitlement check failed: ${subscriptionError.message}`);
  }

  if (subscription) {
    const joinedPlan = Array.isArray(subscription.plans)
      ? subscription.plans[0]
      : subscription.plans;
    const plan = joinedPlan as PlanRecord | null;

    if (!plan) {
      throw new Error("entitlement_plan_not_found");
    }
    if (plan.active === false) {
      return {
        status: "plan_inactive",
        plan: plan.code,
        features: {},
        limits: {},
      };
    }

    const startsAt = subscription.starts_at
      ? new Date(subscription.starts_at).getTime()
      : null;
    if (startsAt !== null && (!Number.isFinite(startsAt) || startsAt > now)) {
      return {
        status: "not_started",
        plan: plan.code,
        features: {},
        limits: {},
      };
    }

    const status = isExpired(subscription.ends_at, now)
      ? "expired"
      : subscription.status;

    return {
      status,
      plan: plan.code,
      features: asRecord(plan.features),
      limits: asRecord(plan.limits),
    };
  }

  // Legacy Phase 3 entitlements are a fallback only when no subscription exists.
  // A missing row or inactive entitlement must never silently grant trial access.
  const { data: entitlement, error: entitlementError } = await supabase
    .from("entitlements")
    .select("plan,status")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (entitlementError) {
    throw new Error(`Entitlement check failed: ${entitlementError.message}`);
  }
  if (!entitlement) {
    throw new Error("entitlement_not_found");
  }

  const entitlementStatus = String(entitlement.status ?? "").toLowerCase();
  if (!["active", "trial", "trialing"].includes(entitlementStatus)) {
    return {
      status: entitlementStatus || "inactive",
      plan: String(entitlement.plan ?? ""),
      features: {},
      limits: {},
    };
  }

  const { data: plan, error: planError } = await supabase
    .from("plans")
    .select("code,features,limits,active")
    .eq("code", entitlement.plan)
    .maybeSingle();

  if (planError) {
    throw new Error(`Entitlement check failed: ${planError.message}`);
  }
  if (!plan) {
    throw new Error("entitlement_plan_not_found");
  }
  if (plan.active === false) {
    return {
      status: "plan_inactive",
      plan: plan.code,
      features: {},
      limits: {},
    };
  }

  return {
    status: entitlementStatus,
    plan: plan.code,
    features: asRecord(plan.features),
    limits: asRecord(plan.limits),
  };
}

export function canUse(features: Record<string, unknown>, key: string): boolean {
  return features[key] === true;
}

export async function requirePlanActive(tenantId: string, db?: Db): Promise<Entitlements> {
  const entitlements = await getEntitlements(tenantId, db);
  if (["expired", "canceled", "past_due", "suspended", "inactive", "plan_inactive", "not_started"].includes(entitlements.status.toLowerCase())) {
    throw new Error(entitlements.status === "not_started" ? "plan_not_started" : "plan_inactive");
  }
  return entitlements;
}

export async function requireFeature(tenantId: string, key: string, db?: Db): Promise<Entitlements> {
  const entitlements = await requirePlanActive(tenantId, db);
  if (!canUse(entitlements.features, key)) {
    throw new Error("feature_not_entitled");
  }
  return entitlements;
}

export async function consumeUsage(
  tenantId: string,
  metric: string,
  quantity = 1,
  db?: Db,
): Promise<{ allowed: true; quantity: number; limit: number }> {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error("invalid_usage_request");
  }

  const entitlements = await requirePlanActive(tenantId, db);
  const rawLimit = entitlements.limits[metric];
  const limit = typeof rawLimit === "number" ? rawLimit : Number(rawLimit);

  if (!Number.isFinite(limit) || limit < 0) {
    throw new Error("usage_limit_not_configured");
  }

  const supabase = db ?? await createClient();
  const { data, error } = await supabase.rpc("consume_usage", {
    p_tenant_id: tenantId,
    p_metric: metric,
    p_quantity: quantity,
    p_limit: limit,
  });

  if (error) {
    throw new Error(`Usage check failed: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.allowed) {
    throw new Error("usage_limit_exceeded");
  }

  return {
    allowed: true,
    quantity: Number(row.quantity),
    limit,
  };
}
