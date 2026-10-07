import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: true, role: "owner", trusted: true, mock: false, rpc: vi.fn() }));
vi.mock("@/lib/inbox/auth", () => ({ getInboxAuthContext: async () => mocks.auth ? { organizationId: "org-a", profileId: "owner-a", role: mocks.role } : null, canAdminister: (role: string) => ["owner", "admin"].includes(role), isTrustedOrigin: () => mocks.trusted }));
vi.mock("@/lib/env/server", () => ({ getServerEnv: () => ({ MOCK_LINE_API: mocks.mock }) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: mocks.rpc }) }));
import { GET, DELETE } from "@/app/api/tags/delete/route";
import { createTag, assignTag, foundationState } from "@/lib/milestone3/foundation-store";
import { checkMockTagDeletion } from "@/lib/tags/mock-deletion";
const id = randomUUID();
const input = { id, name: "テストタグ", confirmed: true };
const request = (body: unknown = input) => new Request(`https://crm.example/api/tags/delete?id=${id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); mocks.auth = true; mocks.role = "owner"; mocks.trusted = true; mocks.mock = false; mocks.rpc.mockResolvedValue({ data: { status: "ready" }, error: null }); });

describe("tag deletion authorization", () => {
  it("rejects anonymous users", async () => { mocks.auth = false; expect((await GET(request())).status).toBe(401); expect((await DELETE(request())).status).toBe(401); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it.each(["operator", "viewer"])("rejects %s", async role => { mocks.role = role; expect((await GET(request())).status).toBe(403); expect((await DELETE(request())).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it("rejects untrusted origins and missing confirmation", async () => {
    mocks.trusted = false; expect((await DELETE(request())).status).toBe(403); mocks.trusted = true;
    expect((await DELETE(request({ id, name: "テストタグ" }))).status).toBe(400);
    expect((await DELETE(request({ ...input, id: "bad" }))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("only trusts the session organization; preflight does not delete", async () => {
    expect((await GET(request())).headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).toHaveBeenLastCalledWith("manage_crm_tag_deletion", expect.objectContaining({ perform_delete: false }));
    await DELETE(request({ ...input, organizationId: "other", profileId: "other" }));
    expect(mocks.rpc).toHaveBeenLastCalledWith("manage_crm_tag_deletion", { target_organization_id: "org-a", target_actor_profile_id: "owner-a", target_tag_id: id, perform_delete: true, expected_name: "テストタグ" });
  });
  it("handles concurrent new dependencies as a conflict", async () => {
    mocks.rpc.mockResolvedValue({ data: { status: "in_use", blockers: [{ key: "surveys", count: 1 }] }, error: null });
    expect((await GET(request())).status).toBe(200); expect((await DELETE(request())).status).toBe(409);
  });
  it("fails closed and hides private database errors", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "private-db-details" } });
    const response = await DELETE(request()); expect(response.status).toBe(503); expect(await response.text()).not.toContain("private-db-details");
  });
  it("removes mock assignments while retaining the original rows", () => {
    const tag = createTag({ name: randomUUID() });
    const assignment = assignTag({ contactId: randomUUID(), tagId: tag.id, sourceType: "manual" });
    expect(checkMockTagDeletion(tag.id)).toMatchObject({ status: "ready", contactCount: 1 });
    expect(checkMockTagDeletion(tag.id, true, tag.name).status).toBe("deleted");
    expect(foundationState().tags.find(item => item.id === tag.id)?.isActive).toBe(false); expect(assignment.removedAt).not.toBeNull();
    expect(() => assignTag({ contactId: assignment.contactId, tagId: tag.id, sourceType: "manual" })).toThrow("有効なタグ");
  });
});
