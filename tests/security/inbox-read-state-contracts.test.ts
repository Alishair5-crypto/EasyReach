import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const inbox = read("app/inbox/page.tsx");
const readRoute = read("app/api/conversations/[id]/read/route.ts");

describe("shared inbox unread-state contract", () => {
  it("acknowledges unread messages when a conversation is opened", () => {
    expect(inbox).toContain('fetch("/api/conversations/"+id+"/read",{method:"POST"})');
    expect(inbox).toContain("unreadCount:0");
  });

  it("limits read acknowledgement to an authenticated tenant conversation", () => {
    expect(readRoute).toContain("getTenantContext()");
    expect(readRoute).toContain('.eq("tenant_id", tenant.id)');
    expect(readRoute).toContain('.eq("conversation_id", id)');
    expect(readRoute).toContain('.eq("direction", "inbound")');
    expect(readRoute).toContain('.is("read_at", null)');
    expect(readRoute).toContain("not_authorized");
    expect(readRoute).toContain("conversation_not_found");
  });
});
