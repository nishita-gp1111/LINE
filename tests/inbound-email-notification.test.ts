import { describe, expect, it, vi } from "vitest";
import { parseEnv } from "../src/lib/env/schema";
import {
  buildInboundEmail,
  sendInboundEmailNotification,
  type InboundEmailHistory,
  type InboundEmailNotificationInput
} from "../src/lib/notifications/inbound-email";

const message: InboundEmailNotificationInput = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  contactId: "00000000-0000-4000-8000-000000000002",
  conversationId: "00000000-0000-4000-8000-000000000003",
  messageId: "00000000-0000-4000-8000-000000000004",
  displayName: "山田 <script>alert(1)</script>\n太郎",
  messageType: "text",
  textContent: "相談したいです。\n<script>alert('x')</script>",
  receivedAt: "2026-07-15T03:04:05.000Z",
  createdAt: "2026-07-15T03:04:06.000Z"
};

function configuredEnv() {
  return parseEnv({
    NEXT_PUBLIC_APP_URL: "https://line-gp-1111.vercel.app",
    APP_ENV: "production",
    APP_TIMEZONE: "Asia/Tokyo",
    INBOUND_EMAIL_NOTIFICATIONS_ENABLED: "true",
    INBOUND_EMAIL_NOTIFICATION_RECIPIENTS: "s.nishita@growth-path.jp,y.imahuku@growth-path.jp",
    INBOUND_EMAIL_NOTIFICATION_FROM: "notifications@updates.growth-path.jp",
    INBOUND_EMAIL_NOTIFICATION_COOLDOWN_MINUTES: "10",
    RESEND_API_KEY: "re_test_secret"
  });
}

describe("inbound LINE email notification", () => {
  it("builds a safe CRM notification with a direct conversation link", () => {
    const built = buildInboundEmail(message, "https://line-gp-1111.vercel.app/", "Asia/Tokyo", 10);

    expect(built.subject).not.toContain("\n");
    expect(built.crmUrl).toBe(
      "https://line-gp-1111.vercel.app/admin/inbox?conversation=00000000-0000-4000-8000-000000000003"
    );
    expect(built.text).toContain("2026/07/15 12:04:05");
    expect(built.html).not.toContain("<script>alert");
    expect(built.html).toContain("&lt;script&gt;alert");
  });

  it("sends one provider request to both configured recipients with an idempotency key", async () => {
    const history: InboundEmailHistory = {
      hasEarlierInboundMessageWithinCooldown: vi.fn().mockResolvedValue(false)
    };
    const requests: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(url),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>
      });
      return Response.json({ id: "email_123" });
    }) as typeof fetch;

    const result = await sendInboundEmailNotification({
      message,
      env: configuredEnv(),
      history,
      fetchImpl
    });

    expect(result).toEqual({ status: "sent", providerMessageId: "email_123" });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://api.resend.com/emails");
    expect(requests[0]?.headers.get("idempotency-key")).toBe(`line-inbound-message/${message.messageId}`);
    expect(requests[0]?.body.to).toEqual([
      "s.nishita@growth-path.jp",
      "y.imahuku@growth-path.jp"
    ]);
    expect(requests[0]?.body.from).toBe("LINE CRM <notifications@updates.growth-path.jp>");
    expect(JSON.stringify(result)).not.toContain("re_test_secret");
  });

  it("suppresses a second message from the same customer inside the cooldown", async () => {
    const history: InboundEmailHistory = {
      hasEarlierInboundMessageWithinCooldown: vi.fn().mockResolvedValue(true)
    };
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const result = await sendInboundEmailNotification({
      message,
      env: configuredEnv(),
      history,
      fetchImpl
    });

    expect(result).toEqual({ status: "suppressed" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("stays disabled by default and never contacts the provider", async () => {
    const history: InboundEmailHistory = {
      hasEarlierInboundMessageWithinCooldown: vi.fn()
    };
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const result = await sendInboundEmailNotification({
      message,
      env: parseEnv({}),
      history,
      fetchImpl
    });

    expect(result).toEqual({ status: "disabled" });
    expect(history.hasEarlierInboundMessageWithinCooldown).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
