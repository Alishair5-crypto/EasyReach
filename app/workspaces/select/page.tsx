import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import WorkspaceSelector from "./workspace-selector";

export default async function WorkspaceSelectionPage() {
  const { user, tenant, memberships } = await getTenantContext();
  if (tenant) redirect("/dashboard");
  if (!memberships || memberships.length === 0) redirect("/onboarding");
  return (
    <main className="auth-shell">
      <section className="auth-card wide-card">
        <div className="eyebrow">Workspace access</div>
        <h1>Choose your business workspace</h1>
        <p className="muted">Your account can access more than one workspace. Choose which business you want to manage. Your choice is verified against your membership.</p>
        <WorkspaceSelector email={user.email ?? ""} />
      </section>
    </main>
  );
}
