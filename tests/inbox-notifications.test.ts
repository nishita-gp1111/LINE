import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeNotificationCursor, parseNotificationCursor, notificationText, type InboxNotificationFeed } from "@/lib/notifications/inbox-feed";
import { MockWebhookStore } from "@/lib/webhook/store";
import { processWebhookEvent } from "@/lib/webhook/processor";
import { LineProfileClient } from "@/lib/line/client";

const state = vi.hoisted(() => ({ auth: true, store: null as MockWebhookStore | null }));
vi.mock("@/lib/inbox/auth", () => ({ getInboxAuthContext: async () => state.auth ? { organizationId: "org-a", profileId: "owner" } : null }));
vi.mock("@/lib/auth/config", () => ({ getAuthMode: () => "mock" }));
vi.mock("@/lib/webhook/store", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/webhook/store")>(), getMockWebhookStore: () => state.store! }));
import { GET } from "@/app/api/inbox/notifications/route";

async function receive(id: number, organizationId = "org-a") {
  await processWebhookEvent({ type: "message", webhookEventId: `event-${id}-${organizationId}`, timestamp: Date.now(), source: { type: "user", userId: "Ufake001" }, message: { id: `line-${id}`, type: "text", text: "private body must not leak in notification" } }, state.store!, { organizationId, profileClient: new LineProfileClient({ mode: "mock" }) });
}
async function poll(after?: string) { const result = await GET(new Request(`https://crm.example/api/inbox/notifications${after ? `?after=${encodeURIComponent(after)}` : ""}`)); return await result.json() as InboxNotificationFeed; }
beforeEach(() => { state.auth = true; state.store = new MockWebhookStore(); });
describe("admin incoming notifications", () => {
  it("preserves microsecond cursor precision and validates malformed filters", () => {
    const cursor = { at: "2026-09-26T03:02:01.123456+00:00", id: "00000000-0000-4000-8000-000000000001" };
    expect(parseNotificationCursor(encodeNotificationCursor(cursor))).toEqual(cursor);
    expect(parseNotificationCursor(Buffer.from('{"at":"bad","id":"),id.neq.null"}').toString("base64url"))).toBeNull();
    expect(parseNotificationCursor("x".repeat(300))).toBeNull();
  });
  it("requires login and rejects invalid cursors", async () => {
    state.auth = false; expect((await GET(new Request("https://crm.example/api/inbox/notifications"))).status).toBe(401);
    state.auth = true; expect((await GET(new Request("https://crm.example/api/inbox/notifications?after=bad"))).status).toBe(400);
  });
  it("does not notify historical messages or expose message bodies", async () => {
    await receive(1);
    const first = await poll(); expect(first.items).toEqual([]);
    await new Promise(resolve => setTimeout(resolve, 5));
    await receive(2);
    const next = await poll(first.cursor);
    expect(next.items).toHaveLength(1); expect(next.items[0].messageType).toBe("text");
    expect(JSON.stringify(next)).not.toContain("private body");
    expect((await poll(next.cursor)).items).toEqual([]);
  });
  it("isolates organizations, ignores outbound/unsent, and deduplicates webhook redelivery", async () => {
    const first = await poll(); await new Promise(resolve => setTimeout(resolve, 5));
    await receive(1, "org-other"); await receive(2); await receive(2);
    expect((await poll(first.cursor)).items).toHaveLength(1);
    await state.store!.redactMessage("org-a", "line-2");
    expect((await poll(first.cursor)).items).toHaveLength(0);
  });
  it("pages through >50 events including identical timestamps without losing IDs", async () => {
    const first = await poll(); await new Promise(resolve => setTimeout(resolve, 5));
    for (let id = 0; id < 65; id++) await receive(id);
    const page = await poll(first.cursor); expect(page.items).toHaveLength(50); expect(page.hasMore).toBe(true);
    const rest = await poll(page.cursor); expect(rest.items).toHaveLength(15); expect(rest.hasMore).toBe(false);
    expect(new Set([...page.items, ...rest.items].map(item => item.id)).size).toBe(65);
  });
  it("labels media without private message text", () => { expect(notificationText("image")).toBe("写真が届きました"); expect(notificationText("text")).toBe("メッセージが届きました"); });
});
