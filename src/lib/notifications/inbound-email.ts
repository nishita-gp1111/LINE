import type { AppEnv } from "@/lib/env/schema";

const RESEND_EMAIL_ENDPOINT = "https://api.resend.com/emails";
const PREVIEW_LIMIT = 240;

export type InboundEmailNotificationInput = {
  organizationId: string;
  contactId: string;
  conversationId: string;
  messageId: string;
  displayName: string | null;
  messageType: string;
  textContent: string | null;
  receivedAt: string;
  createdAt: string;
};

export type InboundEmailHistory = {
  hasEarlierInboundMessageWithinCooldown(
    input: InboundEmailNotificationInput,
    cooldownMinutes: number
  ): Promise<boolean>;
};

export type InboundEmailDispatchResult =
  | { status: "disabled" }
  | { status: "suppressed" }
  | { status: "sent"; providerMessageId: string | null }
  | { status: "failed"; errorCode: string };

export type BuiltInboundEmail = {
  subject: string;
  text: string;
  html: string;
  crmUrl: string;
};

function compact(value: string, limit: number): string {
  const normalized = value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function messagePreview(messageType: string, textContent: string | null): string {
  if (messageType === "text") return compact(textContent || "（本文なし）", PREVIEW_LIMIT);
  const labels: Record<string, string> = {
    image: "画像が届きました。",
    video: "動画が届きました。",
    audio: "音声が届きました。",
    file: "ファイルが届きました。",
    location: "位置情報が届きました。",
    sticker: "スタンプが届きました。"
  };
  return labels[messageType] || "LINEメッセージが届きました。";
}

function formatReceivedAt(value: string, timeZone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

export function buildInboundEmail(
  input: InboundEmailNotificationInput,
  appUrl: string,
  timeZone: string,
  cooldownMinutes: number
): BuiltInboundEmail {
  const displayName = compact(input.displayName || "お客様", 40);
  const preview = messagePreview(input.messageType, input.textContent);
  const receivedAt = formatReceivedAt(input.receivedAt, timeZone);
  const crmUrl = `${appUrl.replace(/\/$/, "")}/admin/inbox?conversation=${encodeURIComponent(input.conversationId)}`;
  const subject = `[LINE CRM] ${displayName}さんから新着メッセージ`;
  const text = [
    `${displayName}さんからLINEメッセージが届きました。`,
    "",
    `受信日時: ${receivedAt}`,
    `内容: ${preview}`,
    "",
    `CRMで確認: ${crmUrl}`,
    "",
    `※同じお客様からの連続メッセージは${cooldownMinutes}分間まとめて通知します。`
  ].join("\n");
  const html = `<!doctype html>
<html lang="ja"><body style="margin:0;background:#f4f7f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans JP',sans-serif;color:#18352a">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px">
    <div style="background:#ffffff;border:1px solid #dbe8e0;border-radius:18px;overflow:hidden;box-shadow:0 8px 24px rgba(19,75,52,.08)">
      <div style="background:#159a5b;padding:18px 24px;color:#ffffff;font-weight:800;font-size:18px">LINE CRM 新着メッセージ</div>
      <div style="padding:24px">
        <p style="margin:0 0 18px;font-size:17px;font-weight:700">${escapeHtml(displayName)}さんから届きました。</p>
        <div style="background:#f2f8f4;border-radius:12px;padding:16px;line-height:1.7;white-space:pre-wrap">${escapeHtml(preview)}</div>
        <p style="margin:16px 0 22px;color:#667a70;font-size:13px">受信日時: ${escapeHtml(receivedAt)}</p>
        <a href="${escapeHtml(crmUrl)}" style="display:inline-block;background:#159a5b;color:#ffffff;text-decoration:none;border-radius:10px;padding:12px 20px;font-weight:800">CRMで会話を確認する</a>
        <p style="margin:22px 0 0;color:#7d8e85;font-size:12px;line-height:1.6">同じお客様からの連続メッセージは${cooldownMinutes}分間まとめて通知します。</p>
      </div>
    </div>
  </div>
</body></html>`;

  return { subject, text, html, crmUrl };
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function sendInboundEmailNotification(input: {
  message: InboundEmailNotificationInput;
  env: AppEnv;
  history: InboundEmailHistory;
  fetchImpl?: typeof fetch;
}): Promise<InboundEmailDispatchResult> {
  const { env, message, history } = input;
  if (!env.INBOUND_EMAIL_NOTIFICATIONS_ENABLED) return { status: "disabled" };

  const apiKey = env.RESEND_API_KEY;
  const sender = env.INBOUND_EMAIL_NOTIFICATION_FROM;
  const recipients = env.INBOUND_EMAIL_NOTIFICATION_RECIPIENTS;
  const appUrl = env.NEXT_PUBLIC_APP_URL;
  if (!apiKey || !sender || recipients.length === 0 || !appUrl) {
    return { status: "failed", errorCode: "notification_configuration_missing" };
  }

  try {
    const recent = await history.hasEarlierInboundMessageWithinCooldown(
      message,
      env.INBOUND_EMAIL_NOTIFICATION_COOLDOWN_MINUTES
    );
    if (recent) return { status: "suppressed" };
  } catch {
    return { status: "failed", errorCode: "notification_history_unavailable" };
  }

  const email = buildInboundEmail(
    message,
    appUrl,
    env.APP_TIMEZONE,
    env.INBOUND_EMAIL_NOTIFICATION_COOLDOWN_MINUTES
  );
  const fetchImpl = input.fetchImpl || fetch;
  let lastErrorCode = "provider_unavailable";

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetchImpl(RESEND_EMAIL_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `line-inbound-message/${message.messageId}`,
          "User-Agent": "line-crm/1.0"
        },
        body: JSON.stringify({
          from: `LINE CRM <${sender}>`,
          to: recipients,
          subject: email.subject,
          text: email.text,
          html: email.html
        }),
        redirect: "error",
        signal: controller.signal
      });
      if (response.ok) {
        const body = await response.json().catch(() => ({})) as { id?: unknown };
        return { status: "sent", providerMessageId: typeof body.id === "string" ? body.id : null };
      }
      lastErrorCode = `provider_http_${response.status}`;
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) {
      lastErrorCode = error instanceof DOMException && error.name === "AbortError"
        ? "provider_timeout"
        : "provider_network_error";
    } finally {
      clearTimeout(timeout);
    }
    if (attempt === 1) await wait(250);
  }

  return { status: "failed", errorCode: lastErrorCode };
}
