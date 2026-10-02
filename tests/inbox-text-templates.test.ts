import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ role: "owner", authenticated: true, trusted: true, store: {
  listQuickReplies: vi.fn(), createQuickReply: vi.fn(), updateQuickReply: vi.fn(), deleteQuickReply: vi.fn(), recordAudit: vi.fn()
} }));
vi.mock("@/lib/inbox/auth", () => ({
  getInboxAuthContext: async () => mocks.authenticated ? { role: mocks.role, organizationId: "org-templates", profileId: "owner-templates" } : null,
  canAdminister: (role: string) => role === "owner" || role === "admin", isTrustedOrigin: () => mocks.trusted
}));
vi.mock("@/lib/inbox/store", () => ({ getInboxStore: () => mocks.store }));
import { GET, POST, PATCH, DELETE } from "@/app/api/inbox/quick-replies/route";
import { appendTextTemplate } from "@/lib/inbox/text-templates";
import { MockWebhookStore } from "@/lib/webhook/store";

function request(data: unknown) { return new Request("https://crm.example/api/inbox/quick-replies", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }); }
const input = { name: "お礼", textContent: "ありがとうございます。\nよろしくお願いいたします。", sortOrder: 0 };
beforeEach(() => {
  vi.resetAllMocks(); mocks.role = "owner"; mocks.authenticated = true; mocks.trusted = true;
  mocks.store.listQuickReplies.mockResolvedValue([]); mocks.store.createQuickReply.mockResolvedValue({ id: "template-a", ...input });
  mocks.store.updateQuickReply.mockResolvedValue({ id: "template-a", ...input });
});

describe("composer template insertion", () => {
  it("inserts into an empty composer and preserves newlines", () => expect(appendTextTemplate("", input.textContent)).toBe(input.textContent));
  it("preserves the existing draft without trimming or replacing it", () => expect(appendTextTemplate("下書き  \n", "定型文")).toBe("下書き  \n\n定型文"));
  it("allows exactly 5000 characters and rejects overflow without truncating", () => {
    expect(appendTextTemplate("a".repeat(4998), "b")?.length).toBe(5000);
    expect(appendTextTemplate("a".repeat(4999), "b")).toBeNull();
    expect(appendTextTemplate("", "a".repeat(5001))).toBeNull();
  });
});

describe("template storage isolation", () => {
  it("keeps another organization's templates inaccessible and excludes inactive entries", async () => {
    const store = new MockWebhookStore();
    const item = await store.createQuickReply("org-a", "owner-a", "お礼", "定型文", 0);
    await store.createQuickReply("org-b", "owner-b", "お礼", "他組織の定型文", 0);
    expect((await store.listQuickReplies("org-a")).map(row => row.textContent)).toEqual(["定型文"]);
    await expect(store.updateQuickReply("org-b", item.id, "お礼", "変更", 0, true)).rejects.toThrow();
    await expect(store.deleteQuickReply("org-b", item.id)).rejects.toThrow();
    await store.updateQuickReply("org-a", item.id, "お礼", "定型文", 0, false);
    expect(await store.listQuickReplies("org-a")).toEqual([]);
    expect(await store.listQuickReplies("org-a", true)).toHaveLength(1);
  });
});

describe("template API", () => {
  it("rejects anonymous access for every endpoint", async () => {
    mocks.authenticated = false;
    for (const response of [await GET(), await POST(request(input)), await PATCH(request(input)), await DELETE(request({ id: "template-a" }))]) expect(response.status).toBe(401);
    expect(mocks.store.listQuickReplies).not.toHaveBeenCalled(); expect(mocks.store.createQuickReply).not.toHaveBeenCalled();
  });
  it.each(["operator", "viewer"])("allows %s to list but not mutate shared templates", async role => {
    mocks.role = role; expect((await GET()).status).toBe(200);
    expect((await POST(request(input))).status).toBe(403);
    expect((await PATCH(request(input))).status).toBe(403);
    expect((await DELETE(request({ id: "template-a" }))).status).toBe(403);
    expect(mocks.store.createQuickReply).not.toHaveBeenCalled();
  });
  it("rejects cross-origin writes", async () => {
    mocks.trusted = false;
    expect((await POST(request(input))).status).toBe(403); expect((await PATCH(request(input))).status).toBe(403); expect((await DELETE(request({ id: "template-a" }))).status).toBe(403);
  });
  it("scopes reads, creates and edits to the authenticated organization, not client input", async () => {
    const response = await GET(); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.store.listQuickReplies).toHaveBeenCalledWith("org-templates");
    expect((await POST(request({ ...input, organizationId: "other-org" }))).status).toBe(200);
    expect(mocks.store.createQuickReply).toHaveBeenCalledWith("org-templates", "owner-templates", input.name, input.textContent, 0);
    expect((await PATCH(request({ ...input, id: "template-a", isActive: true, organizationId: "other-org" }))).status).toBe(200);
    expect(mocks.store.updateQuickReply).toHaveBeenCalledWith("org-templates", "template-a", input.name, input.textContent, 0, true);
    expect(JSON.stringify(mocks.store.recordAudit.mock.calls)).not.toContain(input.textContent);
  });
  it.each([{ ...input, name: " " }, { ...input, textContent: " " }, { ...input, textContent: "a".repeat(5001) }])("rejects invalid template content", async data => {
    expect((await POST(request(data))).status).toBe(400); expect(mocks.store.createQuickReply).not.toHaveBeenCalled();
  });
  it("returns a helpful conflict without exposing database details", async () => {
    mocks.store.createQuickReply.mockRejectedValue(new Error("同じ名前のクイック返信が存在します。"));
    const response = await POST(request(input)); expect(response.status).toBe(409); expect((await response.json()).error).toContain("別の名前");
  });
  it("sanitizes unexpected errors from storage", async () => {
    mocks.store.listQuickReplies.mockRejectedValue(new Error("private-db-detail"));
    const response = await GET(); expect(response.status).toBe(500); expect(await response.text()).not.toContain("private-db-detail");
  });
});
