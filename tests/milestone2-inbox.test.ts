import { afterEach, describe, expect, it } from "vitest";
import { getLineFixture } from "../src/lib/line/fixtures";
import { LineProfileClient } from "../src/lib/line/client";
import { processWebhookEvent } from "../src/lib/webhook/processor";
import { MockWebhookStore } from "../src/lib/webhook/store";
import { MockLinePushClient, lineTextMessageSchema } from "../src/lib/line/send";
import { sendInboxTextMessage, InboxSendError } from "../src/lib/inbox/send-service";

const organizationId = "00000000-0000-4000-8000-000000000001";
const profileClient = new LineProfileClient({ mode: "mock" });
const originalEnv = {
  auth: process.env.NEXT_PUBLIC_AUTH_MODE,
  mock: process.env.MOCK_LINE_API,
  gate: process.env.LINE_MANUAL_SEND_ENABLED,
  outcome: process.env.MOCK_LINE_SEND_OUTCOME
};

afterEach(() => {
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_AUTH_MODE: originalEnv.auth, MOCK_LINE_API: originalEnv.mock, LINE_MANUAL_SEND_ENABLED: originalEnv.gate, MOCK_LINE_SEND_OUTCOME: originalEnv.outcome })) {
    if (value === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = value;
  }
});

function event(name: string) {
  const fixture = getLineFixture(name);
  if (typeof fixture === "string") throw new Error("invalid fixture");
  return fixture.events[0];
}

describe("Milestone 2 conversation foundation", () => {
  it("supports named assignees with shared login, manual changes, and unassigned filtering", async () => {
    const store = new MockWebhookStore();
    await processWebhookEvent(event("text"), store, { organizationId, profileClient });
    const query = { organizationId, profileId: "mock-user", filter: "unassigned" as const, page: 1, pageSize: 50 };
    const conversation = (await store.listConversations(query)).items[0]!.conversation;
    await store.updateConversation(organizationId, conversation.id, "mock-user", "owner", { assigneeName: "担当A", assigneeProfileId: null });
    expect((await store.getConversation(organizationId, conversation.id, "mock-user"))?.conversation.assigneeName).toBe("担当A");
    expect((await store.listConversations(query)).total).toBe(0);
    await store.updateConversation(organizationId, conversation.id, "mock-user", "owner", { assigneeName: "担当B" });
    expect((await store.getConversation(organizationId, conversation.id, "mock-user"))?.conversation.assigneeName).toBe("担当B");
    await store.updateConversation(organizationId, conversation.id, "mock-user", "owner", { assigneeName: null, assigneeProfileId: null });
    expect((await store.listConversations(query)).total).toBe(1);
    await expect(store.updateConversation(organizationId, conversation.id, "viewer", "viewer", { assigneeName: "担当C" })).rejects.toThrow();
  });
  it("creates a conversation and increments CRM unread only once for redelivery", async () => {
    const store = new MockWebhookStore();
    const context = { organizationId, profileClient };
    await processWebhookEvent(event("text"), store, context);
    await processWebhookEvent(event("follow-redelivery"), store, context);
    const result = await store.listConversations({ organizationId, profileId: "mock-user", filter: "all", page: 1, pageSize: 50 });
    expect(result.total).toBe(1);
    expect(result.items[0]?.readState.unreadCount).toBe(1);
    await store.markConversationRead(organizationId, result.items[0]!.conversation.id, "mock-user", result.items[0]!.conversation.id);
    expect((await store.listConversations({ organizationId, profileId: "mock-user", filter: "unread", page: 1, pageSize: 50 })).total).toBe(0);
  });

  it("reopens a closed conversation when a new inbound message arrives", async () => {
    const store = new MockWebhookStore();
    const context = { organizationId, profileClient };
    await processWebhookEvent(event("text"), store, context);
    const conversation = (await store.listConversations({ organizationId, profileId: "mock-user", filter: "all", page: 1, pageSize: 50 })).items[0]!.conversation;
    await store.updateConversation(organizationId, conversation.id, "mock-user", "owner", { status: "closed" });
    const next = { ...event("non-text"), webhookEventId: "new-inbound-for-reopen", timestamp: event("text").timestamp + 10000, message: { id: "Mreopen", type: "text", text: "new message" } };
    await processWebhookEvent(next, store, context);
    expect((await store.getConversation(organizationId, conversation.id, "mock-user"))?.conversation.status).toBe("open");
  });

  it("keeps internal notes separate and prevents viewer actions", async () => {
    const store = new MockWebhookStore();
    await processWebhookEvent(event("text"), store, { organizationId, profileClient });
    const conversation = (await store.listConversations({ organizationId, profileId: "mock-user", filter: "all", page: 1, pageSize: 50 })).items[0]!.conversation;
    const note = await store.addNote(organizationId, conversation.id, "mock-user", "owner", "internal only");
    expect((await store.getConversation(organizationId, conversation.id, "mock-user"))?.notes[0]?.body).toBe("internal only");
    expect((await store.listConversations({ organizationId, profileId: "mock-user", filter: "all", search: "internal only", page: 1, pageSize: 50 })).total).toBe(1);
    expect((await store.listConversations({ organizationId, profileId: "mock-user", filter: "all", search: "not in this conversation", page: 1, pageSize: 50 })).total).toBe(0);
    expect(note.body).not.toBe("");
    await store.deleteNote(organizationId, note.id, "mock-user", "owner");
    expect((await store.listConversations({ organizationId, profileId: "mock-user", filter: "all", search: "internal only", page: 1, pageSize: 50 })).total).toBe(0);
    await expect(store.addNote(organizationId, conversation.id, "viewer", "viewer", "not allowed")).rejects.toThrow();
  });

  it("finds a conversation by message text", async () => {
    const store = new MockWebhookStore();
    const inbound = event("text");
    await processWebhookEvent(inbound, store, { organizationId, profileClient });
    const messageText = inbound.message?.type === "text" ? inbound.message.text : "";
    expect(messageText).not.toBe("");
    expect((await store.listConversations({ organizationId, profileId: "mock-user", filter: "all", search: messageText, page: 1, pageSize: 50 })).total).toBe(1);
  });
});

describe("Milestone 2 outbound safety", () => {
  it("validates text, treats mock 200 and 409 as accepted, and does not retry 429", async () => {
    expect(lineTextMessageSchema.safeParse("").success).toBe(false);
    expect(lineTextMessageSchema.safeParse("a".repeat(5001)).success).toBe(false);
    expect((await new MockLinePushClient("success").pushTextMessage({ lineUserId: "U1", text: "hello", retryKey: crypto.randomUUID() })).accepted).toBe(true);
    const duplicate = await new MockLinePushClient("409").pushTextMessage({ lineUserId: "U1", text: "hello", retryKey: crypto.randomUUID() });
    expect(duplicate.accepted).toBe(true);
    const rateLimited = await new MockLinePushClient("429").pushTextMessage({ lineUserId: "U1", text: "hello", retryKey: crypto.randomUUID() });
    expect(rateLimited.accepted).toBe(false);
    if (!rateLimited.accepted) expect(rateLimited.retryable).toBe(false);
  });

  it("uses one outbound row for a duplicated client request and rejects blocked/viewer sends", async () => {
    process.env.NEXT_PUBLIC_AUTH_MODE = "mock";
    process.env.MOCK_LINE_API = "true";
    process.env.LINE_MANUAL_SEND_ENABLED = "false";
    process.env.MOCK_LINE_SEND_OUTCOME = "success";
    const store = new MockWebhookStore();
    await processWebhookEvent(event("text"), store, { organizationId, profileClient });
    const conversation = (await store.listConversations({ organizationId, profileId: "mock-user", filter: "all", page: 1, pageSize: 50 })).items[0]!.conversation;
    const clientRequestId = crypto.randomUUID();
    const first = await sendInboxTextMessage({ store, organizationId, profileId: "mock-user", role: "owner", conversationId: conversation.id, text: "reply", clientRequestId });
    const second = await sendInboxTextMessage({ store, organizationId, profileId: "mock-user", role: "owner", conversationId: conversation.id, text: "reply", clientRequestId });
    expect(first.message.status).toBe("accepted");
    expect(second.reused).toBe(true);
    expect((await store.getConversation(organizationId, conversation.id, "mock-user"))?.messages.filter((message) => message.direction === "outbound")).toHaveLength(1);
    await expect(sendInboxTextMessage({ store, organizationId, profileId: "viewer", role: "viewer", conversationId: conversation.id, text: "blocked", clientRequestId: crypto.randomUUID() })).rejects.toBeInstanceOf(InboxSendError);
  });

  it("retries 5xx at most twice and reuses the persisted retry key", async () => {
    process.env.NEXT_PUBLIC_AUTH_MODE = "mock";
    process.env.MOCK_LINE_API = "true";
    const store = new MockWebhookStore();
    await processWebhookEvent(event("text"), store, { organizationId, profileClient });
    const conversation = (await store.listConversations({ organizationId, profileId: "mock-user", filter: "all", page: 1, pageSize: 50 })).items[0]!.conversation;
    const retryKeys: string[] = [];
    const failing = { pushTextMessage: async (input: { lineUserId: string; text: string; retryKey: string }) => { retryKeys.push(input.retryKey); return { accepted: false as const, retryable: true, httpStatus: 500, errorClass: "line_5xx", errorCode: "500", safeMessage: "temporary", lineRequestId: null, lineAcceptedRequestId: null }; } };
    const failed = await sendInboxTextMessage({ store, organizationId, profileId: "mock-user", role: "owner", conversationId: conversation.id, text: "retry me", clientRequestId: crypto.randomUUID(), pushClient: failing });
    expect(failed.message.status).toBe("retryable_failed");
    expect(retryKeys).toHaveLength(3);
    expect(new Set(retryKeys).size).toBe(1);
    const success = { pushTextMessage: async (input: { lineUserId: string; text: string; retryKey: string }) => { retryKeys.push(input.retryKey); return { accepted: true as const, lineRequestId: "mock-request", lineAcceptedRequestId: null, lineSentMessageId: "mock-sent" }; } };
    const retried = await sendInboxTextMessage({ store, organizationId, profileId: "mock-user", role: "owner", conversationId: conversation.id, messageId: failed.message.id, pushClient: success });
    expect(retried.message.status).toBe("accepted");
    expect(new Set(retryKeys).size).toBe(1);
  });

  it("rejects a live recipient at the store-backed server policy before LINE API use", async () => {
    process.env.NEXT_PUBLIC_AUTH_MODE = "mock";
    process.env.MOCK_LINE_API = "true";
    const store = new MockWebhookStore();
    await processWebhookEvent(event("text"), store, { organizationId, profileClient });
    const conversation = (await store.listConversations({ organizationId, profileId: "mock-user", filter: "all", page: 1, pageSize: 50 })).items[0]!.conversation;
    Object.assign(store, {
      authorizeControlledRecipient: async () => ({ allowed: false, reason: "Sho本人以外への送信を拒否しました。" })
    });
    let pushed = false;
    const pushClient = {
      pushTextMessage: async () => {
        pushed = true;
        return { accepted: true as const, lineRequestId: "should-not-run", lineAcceptedRequestId: null, lineSentMessageId: null };
      }
    };

    await expect(sendInboxTextMessage({
      store,
      organizationId,
      profileId: "mock-user",
      role: "owner",
      conversationId: conversation.id,
      text: "must not send",
      clientRequestId: crypto.randomUUID(),
      pushClient
    })).rejects.toThrow("Sho本人以外");
    expect(pushed).toBe(false);
  });
});
