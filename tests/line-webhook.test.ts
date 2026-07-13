import { describe, expect, it } from "vitest";
import { createLineSignature, verifyLineSignature } from "../src/lib/line/signature";
import { runLineConnectionTest } from "../src/lib/line/connection-test";
import { minimalMessagePayload, redactWebhookEventPayload } from "../src/lib/line/redaction";
import { getLineFixture } from "../src/lib/line/fixtures";
import { LineProfileClient } from "../src/lib/line/client";
import { processWebhookEvent, processWebhookEvents } from "../src/lib/webhook/processor";
import { MockWebhookStore } from "../src/lib/webhook/store";
import type { LineEvent } from "../src/lib/line/types";

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
    expect(result.checks.signatureProtection.status).toBe("skip");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.signature).toBeNull();
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("treats an unsigned live webhook response of 401 as protected", async () => {
    const result = await runLineConnectionTest(
      {
        environment: "production",
        mode: "live",
        appUrl: "https://crm.example.com",
        organizationId,
        channelId: "1234567890",
        channelSecret: secret,
        channelAccessToken: "test-access-token"
      },
      async (url) => {
        const requestUrl = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
        return new Response(null, { status: 401 });
      }
    );

    expect(result.ok).toBe(false);
    expect(result.checks.environment.status).toBe("ok");
    expect(result.checks.lineApi.status).toBe("ng");
    expect(result.checks.webhook.status).toBe("ok");
    expect(result.checks.signatureProtection.status).toBe("ok");
    expect(result.checks.signatureProtection.detail).toContain("署名保護されています");
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
        channelAccessToken: "test-access-token"
      },
      async (url) => {
        const requestUrl = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
        return new Response(null, { status: requestUrl.includes("api.line.me") ? 200 : webhookStatus });
      }
    );

    expect(result.ok).toBe(false);
    expect(result.checks.webhook.status).toBe("ng");
  });
});
