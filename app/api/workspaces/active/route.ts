import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getTenantContext, ACTIVE_WORKSPACE_COOKIE } from "@/lib/auth";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET() {
  try {
    const { supabase, user, tenant, membership, memberships } = await getTenantContext();
    if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    const rows = memberships ?? [];
    const results = await Promise.all(rows.map(async item => {
      const { data: workspace, error } = await supabase
        .from("tenants")
        .select("id,name")
        .eq("id", item.tenant_id)
        .maybeSingle();
      if (error) throw new Error("workspace_list_failed");
      return workspace ? { id: workspace.id, name: workspace.name, role: item.role, active: workspace.id === tenant?.id && item.tenant_id === membership?.tenant_id } : null;
    }));
    return NextResponse.json({ workspaces: results.filter((item): item is NonNullable<typeof item> => item !== null) });
  } catch {
    return NextResponse.json({ error: "workspace_list_failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await getTenantContext();
    if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    const body: unknown = await request.json().catch(() => null);
    if (typeof body !== "object" || body === null || Array.isArray(body) ||
        typeof (body as Record<string, unknown>).workspace_id !== "string" ||
        !uuidPattern.test((body as Record<string, unknown>).workspace_id as string)) {
      return NextResponse.json({ error: "invalid_workspace_id" }, { status: 400 });
    }
    const workspaceId = (body as { workspace_id: string }).workspace_id;
    const { data: membership, error } = await supabase
      .from("tenant_members")
      .select("tenant_id")
      .eq("tenant_id", workspaceId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw new Error("workspace_membership_check_failed");
    if (!membership) return NextResponse.json({ error: "workspace_access_denied" }, { status: 403 });

    const { data: workspace, error: workspaceError } = await supabase
      .from("tenants")
      .select("id")
      .eq("id", membership.tenant_id)
      .maybeSingle();
    if (workspaceError) throw new Error("workspace_lookup_failed");
    if (!workspace) return NextResponse.json({ error: "workspace_not_found" }, { status: 404 });

    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_WORKSPACE_COOKIE, workspace.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "workspace_selection_failed" }, { status: 500 });
  }
}
