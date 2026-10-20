import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MockWebhookStore } from "@/lib/webhook/store";
import { SupabaseInboxStore } from "@/lib/inbox/store-supabase";
import { processWebhookEvent } from "@/lib/webhook/processor";
import { LineProfileClient } from "@/lib/line/client";
import { inboxRevision } from "@/lib/inbox/sync-revision";

const state = vi.hoisted(() => ({ loggedIn: true, configured: true, revision: vi.fn() }));
vi.mock("@/lib/inbox/queries", () => ({ getInboxData: async () => state.loggedIn ? { auth: { organizationId: "org", profileId: "staff" }, store: state.configured ? { getSyncRevision: state.revision } : null } : null }));
import { GET } from "@/app/api/inbox/sync/route";

beforeEach(() => { state.loggedIn = true; state.configured = true; state.revision.mockReset().mockResolvedValue("a".repeat(64)); });

describe("inbox sync endpoint", () => {
  it("is private, read-only, scoped to the logged-in user and returns no customer data", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ revision: "a".repeat(64) });
    expect(state.revision).toHaveBeenCalledWith("org", "staff");
  });
  it("rejects anonymous access and reports unavailable storage without leaking errors", async () => {
    state.loggedIn = false;
    expect((await GET()).status).toBe(401); expect(state.revision).not.toHaveBeenCalled();
    state.loggedIn = true; state.configured = false;
    expect((await GET()).status).toBe(503);
    state.configured = true; state.revision.mockRejectedValue(new Error("private database credentials"));
    const failed = await GET(); expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("credentials");
  });
});

describe("revision coverage", () => {
  it("uses microsecond precision and isolates organization/profile", () => {
    const rows = [{ id: "one", updated_at: "2026-10-20T01:02:03.123456Z" }];
    expect(inboxRevision("org", "staff", rows)).toMatch(/^[a-f0-9]{64}$/);
    expect(inboxRevision("org", "staff", rows)).not.toBe(inboxRevision("org", "staff", [{ ...rows[0], updated_at: "2026-10-20T01:02:03.123457Z" }]));
    expect(inboxRevision("org", "staff", rows)).not.toBe(inboxRevision("other", "staff", rows));
    expect(inboxRevision("org", "staff", rows)).not.toBe(inboxRevision("org", "other", rows));
  });
  it("detects inbound, another operator's outbound, send status, notes, assignment and unsend", async () => {
    const store = new MockWebhookStore();
    const revision = () => store.getSyncRevision("org", "mock-user");
    let previous = await revision();
    const changed = async () => { const next = await revision(); expect(next).not.toBe(previous); previous = next; await new Promise(resolve => setTimeout(resolve, 3)); };
    await processWebhookEvent({ type: "message", webhookEventId: "event", timestamp: Date.now(), source: { type: "user", userId: "Utest" }, message: { id: "inbound", type: "text", text: "private" } }, store, { organizationId: "org", profileClient: new LineProfileClient({ mode: "mock" }) });
    await changed();
    const conversation = (await store.listConversations({ organizationId: "org", profileId: "mock-user", filter: "all", page: 1, pageSize: 50 })).items[0].conversation;
    previous = await revision();
    const outgoing = await store.createOutboundMessage({ organizationId: "org", conversationId: conversation.id, contactId: conversation.contactId, textContent: "private reply", clientRequestId: "request", retryKey: "retry", sentByProfileId: "operator-b" });
    await changed();
    await store.updateOutboundMessage("org", outgoing.message.id, { status: "accepted", acceptedAt: new Date().toISOString() });
    await changed();
    const note = await store.addNote("org", conversation.id, "mock-user", "owner", "private note");
    await changed();
    await store.updateNote("org", note.id, "mock-user", "owner", "changed note"); await changed();
    await store.deleteNote("org", note.id, "mock-user", "owner"); await changed();
    await store.updateConversation("org", conversation.id, "mock-user", "owner", { status: "pending" }); await changed();
    await store.redactMessage("org", "inbound"); await changed();
    const otherBefore = await store.getSyncRevision("other", "mock-user");
    await store.addNote("org", conversation.id, "mock-user", "owner", "another");
    expect(await store.getSyncRevision("other", "mock-user")).toBe(otherBefore);
  });
  it("queries only bounded metadata, scopes all live tables, and fails closed on query errors", async () => {
    let error: { message: string } | null = null;
    const queries: Record<string, ReturnType<typeof query>> = {};
    function query() {
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
        then: (resolve: (value: { data: unknown[]; error: typeof error }) => unknown) => Promise.resolve({ data: [{ id: "id", updated_at: "2026-10-20T01:02:03.123456Z" }], error }).then(resolve) };
    }
    const client = { from: (table: string) => queries[table] = query() } as unknown as SupabaseClient;
    const store = new SupabaseInboxStore(client, "org");
    expect(await store.getSyncRevision("org", "staff")).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.keys(queries)).toEqual(["messages", "conversations", "contacts", "conversation_notes", "conversation_read_states"]);
    for (const value of Object.values(queries)) {
      expect(value.select).toHaveBeenCalledWith("id, updated_at"); expect(value.eq).toHaveBeenCalledWith("organization_id", "org");
      expect(value.limit).toHaveBeenCalledWith(1); expect(value.order).toHaveBeenCalledWith("updated_at", { ascending: false });
    }
    expect(queries.conversation_read_states.eq).toHaveBeenCalledWith("profile_id", "staff");
    error = { message: "database unavailable" };
    await expect(store.getSyncRevision("org", "staff")).rejects.toThrow("同期情報");
  });
});
