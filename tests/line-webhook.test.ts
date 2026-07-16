import { describe, expect, it } from "vitest";
import { createLineSignature, verifyLineSignature } from "../src/lib/line/signature";
import { runLineConnectionTest } from "../src/lib/line/connection-test";
import { minimalMessagePayload, redactWebhookEventPayload } from "../src/lib/line/redaction";
import { getLineFixture } from "../src/lib/line/fixtures";
import { LineProfileClient } from "../src/lib/line/client";
import { processWebhookEvent, processWebhookEvents } from "../src/lib/webhook/processor";
import { MockWebhookStore } from "../src/lib/webhook/store";
import { CONTROLLED_ENROLLMENT_REDACTED_TEXT } from "../src/lib/launch/controlled-recipient";
import type { LineEvent } from "../src/lib/line/types";
import { markLineChatAsRead } from "../src/lib/line/read";

const secret = "test-channel-secret";
const organizationId = "00000000-0000-4000-8000-000000000001";
const profileClient = new LineProfileClient({ mode: "mock" });

function eventFromFixture(name: string, index = 0): LineEvent {
  const fixture = getLineFixture(name);
  if (typeof fixture === "string") throw new Error("malformed fixture is not an event payload");
  return fixture.events[index] as LineEvent;
}

describe("LINE webhook signature and redaction", () => {
  it("accepts only the exact HMAC signature", () => {
    const body = JSON.stringify({ events: [] });
    const signature = createLineSignature(body, secret);
    expect(verifyLineSignature(body, signature, secret)).toBe(true);
    expect(verifyLineSignature(body, `${signature}x`, secret)).toBe(false);
    expect(verifyLineSignature(body, null, secret)).toBe(false);
  });

  it("does not retain replyToken or message text in event metadata", () => {
    const event = eventFromFixture("text");
    const redacted = redactWebhookEventPayload(event);
    expect(JSON.stringify(redacted)).not.toContain("fixture-reply-token");
    expect(JSON.stringify(redacted)).not.toContain("fixture message");
    expect(minimalMessagePayload(event)).toEqual({ type: "text", hasText: true, messageIdPresent: true });
  });
});

describe("Mock webhook store integration", () => {
  it("deduplicates follow redelivery and supports unfollow/re-follow", async () => {
    const store = new MockWebhookStore();
    const context = { organizationId, profileClient };
    expect(await processWebhookEvent(eventFromFixture("follow"), store, context)).toBe("processed");
    expect(await processWebhookEvent(eventFromFixture("follow-redelivery"), store, context)).toBe("duplicate");
    expect(await processWebhookEvent(eventFromFixture("unfollow"), store, context)).toBe("processed");
    expect(await processWebhookEvent(eventFromFixture("re-follow"), store, context)).toBe("processed");
    const contacts = await store.listContacts({ page: 1, pageSize: 50 });
    expect(contacts.total).toBe(1);
    expect(contacts.items[0]?.friendStatus).toBe("following");
    expect(contacts.items[0]?.unfollowedAt).toBeNull();
  });

  it("stores one inbound message, ignores group/unsupported events, and redacts unsend", async () => {
    const store = new MockWebhookStore();
    const context = { organizationId, profileClient };
    expect((await processWebhookEvents([eventFromFixture("text"), eventFromFixture("text"), eventFromFixture("non-text")], store, context)).processed).toBe(2);
    expect(await processWebhookEvent(eventFromFixture("group"), store, context)).toBe("ignored");
    expect(await processWebhookEvent(eventFromFixture("unsupported"), store, context)).toBe("ignored");
    const contact = (await store.listContacts({ page: 1, pageSize: 50 })).items[0];
    expect(contact).toBeTruthy();
    const beforeUnsend = await store.listMessages(organizationId, contact!.id);
    expect(beforeUnsend).toHaveLength(2);
    expect(beforeUnsend.find((message) => message.lineMessageId === "Mfixture0001")?.textContent).toBe("fixture message");
    expect(await processWebhookEvent(eventFromFixture("unsend"), store, context)).toBe("processed");
    const afterUnsend = await store.listMessages(organizationId, contact!.id);
    const deleted = afterUnsend.find((message) => message.lineMessageId === "Mfixture0001");
    expect(deleted?.status).toBe("deleted");
    expect(deleted?.textContent).toBeNull();
  });

  it("keeps the newer contact status when events arrive out of order", async () => {
    const store = new MockWebhookStore();
    const context = { organizationId, profileClient };
    const newerFollow = { ...eventFromFixture("re-follow"), webhookEventId: "newer", timestamp: 1735689609000 };
    const olderUnfollow = { ...eventFromFixture("unfollow"), webhookEventId: "older", timestamp: 1735689608000 };
    await processWebhookEvent(newerFollow, store, context);
    await processWebhookEvent(olderUnfollow, store, context);
    expect((await store.listContacts({ page: 1, pageSize: 50 })).items[0]?.friendStatus).toBe("following");
  });

  it("schedules one inbound notification only after a new message is stored", async () => {
    const store = new MockWebhookStore();
    const notifications: Array<{ messageId: string; conversationId: string }> = [];
    const context = {
      organizationId,
      profileClient,
      onInboundMessage: (input: { messageId: string; conversationId: string }) => {
        notifications.push({ messageId: input.messageId, conversationId: input.conversationId });
      }
    };
    const event = eventFromFixture("text");

    expect(await processWebhookEvent(event, store, context)).toBe("processed");
    expect(await processWebhookEvent(event, store, context)).toBe("duplicate");
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.messageId).toMatch(/^mock-message-/);
    expect(notifications[0]?.conversationId).toMatch(/^mock-conversation-/);
  });

  it("enrolls from the signed text event without retaining the one-time phrase", async () => {
    const store = new MockWebhookStore();
    const enrollmentInputs: Array<{ lineUserId: string; message?: string | null }> = [];
    const notifications: string[] = [];
    const source = eventFromFixture("text");
    const result = await processWebhookEvent(source, store, {
      organizationId,
      profileClient,
      controlledRecipientEnrollment: async (input) => {
        enrollmentInputs.push({ lineUserId: input.lineUserId, message: input.message });
        return { matched: true, status: "enrolled" };
      },
      onInboundMessage: (input) => notifications.push(input.messageId)
    });

    expect(result).toBe("processed");
    expect(enrollmentInputs).toEqual([{ lineUserId: source.source?.userId, message: "fixture message" }]);
    const contact = (await store.listContacts({ page: 1, pageSize: 50 })).items[0]!;
    const [message] = await store.listMessages(organizationId, contact.id);
    expect(message?.textContent).toBe(CONTROLLED_ENROLLMENT_REDACTED_TEXT);
    expect(JSON.stringify(message?.payloadJson)).not.toContain("fixture message");
    expect(message?.payloadJson).toMatchObject({ hasText: false, controlledLaunchEnrollment: true });
    expect(notifications).toEqual([]);
  });

  it("stores the LINE read token outside the public message payload", async () => {
    const store = new MockWebhookStore();
    const source = eventFromFixture("text");
    const event = { ...source, webhookEventId: "read-token-event", message: { ...source.message!, markAsReadToken: "secret-read-token" } };
    await processWebhookEvent(event, store, { organizationId, profileClient });
    const conversation = (await store.listConversations({ organizationId, profileId: "mock-user", filter: "all", page: 1, pageSize: 10 })).items[0]!.conversation;
    expect(await store.getLatestLineMarkAsReadToken(organizationId, conversation.id)).toBe("secret-read-token");
    const contact = (await store.listContacts({ page: 1, pageSize: 10 })).items[0]!;
    expect(JSON.stringify(await store.listMessages(organizationId, contact.id))).not.toContain("secret-read-token");
  });
});

describe("LINE mark-as-read", () => {
  it("calls the token-based LINE endpoint without exposing the token in the result", async () => {
    let requestBody = "";
    const result = await markLineChatAsRead("read-token", { mode: "live", channelAccessToken: "access-token" }, async (url, init) => {
      expect(String(url)).toBe("https://api.line.me/v2/bot/chat/markAsRead");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer access-token");
      requestBody = String(init?.body);
      return new Response(null, { status: 200 });
    });
    expect(JSON.parse(requestBody)).toEqual({ markAsReadToken: "read-token" });
    expect(result).toEqual({ status: "marked", httpStatus: 200 });
    expect(JSON.stringify(result)).not.toContain("read-token");
  });

  it("returns a safe failure for a rejected request", async () => {
    expect(await markLineChatAsRead("read-token", { mode: "live", channelAccessToken: "access-token" }, async () => new Response(null, { status: 400 }))).toEqual({ status: "failed", httpStatus: 400 });
  });
});

describe("LINE profile lookup", () => {
  it("maps a not-found response without exposing response content", async () => {
    const result = await (await import("../src/lib/line/client")).getLineProfile("Uunknown", {
      mode: "live",
      channelAccessToken: "token"
    }, async () => new Response("not found", { status: 404 }));
    expect(result).toEqual({ error: { kind: "not_found", message: "LINEプロフィールが見つかりません。" } });
  });
});

describe("LINE connection test", () => {
  it("checks mock webhook reachability without sending a signature", async () => {
    const requests: Array<{ url: string; signature: string | null }> = [];
    const result = await runLineConnectionTest(
      {
        environment: "development",
        mode: "mock",
        appUrl: "http://127.0.0.1:3000",
      },
      async (url, init) => {
        const requestUrl = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
        requests.push({ url: requestUrl, signature: new Headers(init?.headers).get("x-line-signature") });
        return new Response(JSON.stringify({ ok: true }), { status: 401 });
      }
    );

    expect(result.ok).toBe(true);
    expect(result.checks.lineApi.status).toBe("skip");
    expect(result.checks.webhook.status).toBe("ok");
    expect(result.checks.unsignedSignature.status).toBe("skip");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.signature).toBeNull();
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("verifies bot identity and all three live signature paths without sending a message", async () => {
    const webhookRequests: Array<string | null> = [];
    const result = await runLineConnectionTest(
      {
        environment: "production",
        mode: "live",
        appUrl: "https://crm.example.com",
        organizationId,
        channelId: "1234567890",
        channelSecret: secret,
        channelAccessToken: "test-access-token",
        expectedBasicId: "@612evfuv",
        expectedDisplayName: "GP PRモニター窓口"
      },
      async (url, init) => {
        const requestUrl = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
        if (requestUrl.includes("api.line.me")) {
          return Response.json({
            displayName: "GP PRモニター窓口",
            basicId: "@612evfuv",
            userId: "U-must-not-be-returned"
          });
        }
        const signature = new Headers(init?.headers).get("x-line-signature");
        webhookRequests.push(signature);
        if (!signature || signature === "invalid-connection-test-signature") return new Response(null, { status: 401 });
        expect(verifyLineSignature(String(init?.body), signature, secret)).toBe(true);
        return Response.json({ ok: true, events: 0 });
      }
    );

    expect(result.ok).toBe(true);
    expect(result.checks.environment.status).toBe("ok");
    expect(result.checks.lineApi.status).toBe("ok");
    expect(result.checks.botIdentity.status).toBe("ok");
    expect(result.checks.webhook.status).toBe("ok");
    expect(result.checks.unsignedSignature.status).toBe("ok");
    expect(result.checks.invalidSignature.status).toBe("ok");
    expect(result.checks.validSignature.status).toBe("ok");
    expect(result.bot).toEqual({ displayName: "GP PRモニター窓口", basicId: "@612evfuv" });
    expect(webhookRequests).toHaveLength(3);
    expect(JSON.stringify(result)).not.toContain("U-must-not-be-returned");
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain("test-access-token");
  });

  it("fails when the token belongs to a different LINE official account", async () => {
    const result = await runLineConnectionTest(
      {
        environment: "production",
        mode: "live",
        appUrl: "https://crm.example.com",
        organizationId,
        channelId: "1234567890",
        channelSecret: secret,
        channelAccessToken: "test-access-token",
        expectedBasicId: "@612evfuv",
        expectedDisplayName: "GP PRモニター窓口"
      },
      async (url, init) => {
        const requestUrl = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
        if (requestUrl.includes("api.line.me")) return Response.json({ displayName: "別アカウント", basicId: "@other" });
        const signature = new Headers(init?.headers).get("x-line-signature");
        return new Response(null, { status: signature && signature !== "invalid-connection-test-signature" ? 200 : 401 });
      }
    );

    expect(result.ok).toBe(false);
    expect(result.checks.lineApi.status).toBe("ok");
    expect(result.checks.botIdentity.status).toBe("ng");
  });

  it.each([404, 500])("treats HTTP %i as a webhook failure", async (webhookStatus) => {
    const result = await runLineConnectionTest(
      {
        environment: "production",
        mode: "live",
        appUrl: "https://crm.example.com",
        organizationId,
        channelId: "1234567890",
        channelSecret: secret,
        channelAccessToken: "test-access-token",
        expectedBasicId: "@612evfuv",
        expectedDisplayName: "GP PRモニター窓口"
      },
      async (url) => {
        const requestUrl = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
        return requestUrl.includes("api.line.me")
          ? Response.json({ displayName: "GP PRモニター窓口", basicId: "@612evfuv" })
          : new Response(null, { status: webhookStatus });
      }
    );

    expect(result.ok).toBe(false);
    expect(result.checks.webhook.status).toBe("ng");
  });

  it("does not accept a protection-layer 401 as a valid signed webhook response", async () => {
    const result = await runLineConnectionTest(
      {
        environment: "production",
        mode: "live",
        appUrl: "https://crm.example.com",
        organizationId,
        channelId: "1234567890",
        channelSecret: secret,
        channelAccessToken: "test-access-token",
        expectedBasicId: "@612evfuv",
        expectedDisplayName: "GP PRモニター窓口"
      },
      async (url) => {
        const requestUrl = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
        return requestUrl.includes("api.line.me")
          ? Response.json({ displayName: "GP PRモニター窓口", basicId: "@612evfuv" })
          : new Response(null, { status: 401 });
      }
    );

    expect(result.ok).toBe(false);
    expect(result.checks.unsignedSignature.status).toBe("ok");
    expect(result.checks.invalidSignature.status).toBe("ok");
    expect(result.checks.validSignature.status).toBe("ng");
  });
});
