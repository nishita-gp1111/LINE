import "server-only";

import type { AppEnv } from "@/lib/env/schema";
import { formatBookingDate } from "@/lib/bookings/domain";

const RESEND_EMAIL_ENDPOINT = "https://api.resend.com/emails";

export type BookingEmailKind = "confirmation" | "reschedule" | "day_before" | "hour_before";

export type BookingEmailInput = {
  idempotencyKey: string;
  kind: BookingEmailKind;
  recipient: string;
  applicantName: string;
  memberName: string;
  startsAt: string;
  timezone: string;
  meetUrl: string;
  rescheduleUrl: string;
};

export type BookingEmailResult =
  | { status: "sent"; providerMessageId: string | null }
  | { status: "not_configured" }
  | { status: "failed"; errorCode: string };

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function emailCopy(kind: BookingEmailKind): { subjectPrefix: string; heading: string; intro: string } {
  if (kind === "reschedule") return {
    subjectPrefix: "面談日時を変更しました",
    heading: "面談日時の変更を受け付けました",
    intro: "新しい日時をご確認ください。"
  };
  if (kind === "day_before") return {
    subjectPrefix: "明日の面談のご案内",
    heading: "面談は明日です",
    intro: "ご予約いただいた面談の前日になりました。"
  };
  if (kind === "hour_before") return {
    subjectPrefix: "面談開始1時間前です",
    heading: "まもなく面談が始まります",
    intro: "開始時刻になりましたら、下のGoogle Meetボタンからご参加ください。"
  };
  return {
    subjectPrefix: "面談予約を受け付けました",
    heading: "ご予約ありがとうございます",
    intro: "以下の内容で面談予約を受け付けました。"
  };
}

export function buildBookingEmail(input: BookingEmailInput): { subject: string; text: string; html: string } {
  const date = formatBookingDate(input.startsAt, input.timezone);
  const copy = emailCopy(input.kind);
  const subject = `【GP PRモニター窓口】${copy.subjectPrefix}`;
  const text = [
    `${input.applicantName} 様`,
    "",
    copy.intro,
    `日時: ${date}`,
    `担当: ${input.memberName}`,
    `Google Meet: ${input.meetUrl}`,
    "",
    `日時変更: ${input.rescheduleUrl}`,
    "",
    "このメールは予約システムから自動送信されています。"
  ].join("\n");
  const html = `<!doctype html><html lang="ja"><body style="margin:0;background:#f4f7f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans JP',sans-serif;color:#17352b">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px">
    <div style="overflow:hidden;border:1px solid #dceae2;border-radius:22px;background:#fff;box-shadow:0 12px 30px rgba(20,76,54,.08)">
      <div style="padding:24px;background:linear-gradient(135deg,#16a267,#118a72);color:#fff">
        <div style="font-size:13px;font-weight:700;opacity:.8">GP PRモニター窓口</div>
        <div style="margin-top:6px;font-size:22px;font-weight:900">${escapeHtml(copy.heading)}</div>
      </div>
      <div style="padding:28px">
        <p style="margin:0 0 12px;font-size:17px;font-weight:800">${escapeHtml(input.applicantName)} 様</p>
        <p style="margin:0 0 22px;color:#5f756b;line-height:1.8">${escapeHtml(copy.intro)}</p>
        <div style="border-radius:16px;background:#f1f8f4;padding:20px;line-height:1.9">
          <div><b>日時</b><br>${escapeHtml(date)}</div>
          <div style="margin-top:10px"><b>担当</b><br>${escapeHtml(input.memberName)}</div>
        </div>
        <a href="${escapeHtml(input.meetUrl)}" style="display:block;margin-top:22px;border-radius:13px;background:#159a5b;padding:15px 18px;text-align:center;color:#fff;text-decoration:none;font-weight:900">Google Meetに参加する</a>
        <p style="margin:24px 0 8px;color:#70847b;font-size:13px">日時を変更したい場合</p>
        <a href="${escapeHtml(input.rescheduleUrl)}" style="color:#147c5a;font-size:14px;font-weight:800">予約日時を変更する</a>
        <p style="margin:26px 0 0;color:#91a098;font-size:11px;line-height:1.7">このメールは予約システムから自動送信されています。</p>
      </div>
    </div>
  </div></body></html>`;
  return { subject, text, html };
}

export async function sendBookingEmail(input: {
  message: BookingEmailInput;
  env: AppEnv;
  fetchImpl?: typeof fetch;
}): Promise<BookingEmailResult> {
  const apiKey = input.env.RESEND_API_KEY;
  const sender = input.env.BOOKING_EMAIL_FROM || input.env.INBOUND_EMAIL_NOTIFICATION_FROM;
  if (!apiKey || !sender) return { status: "not_configured" };
  const email = buildBookingEmail(input.message);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await (input.fetchImpl || fetch)(RESEND_EMAIL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.message.idempotencyKey,
        "User-Agent": "line-crm-booking/1.0"
      },
      body: JSON.stringify({
        from: `GP PRモニター窓口 <${sender}>`,
        to: [input.message.recipient],
        subject: email.subject,
        text: email.text,
        html: email.html
      }),
      redirect: "error",
      signal: controller.signal
    });
    if (!response.ok) return { status: "failed", errorCode: `provider_http_${response.status}` };
    const body = await response.json().catch(() => ({})) as { id?: unknown };
    return { status: "sent", providerMessageId: typeof body.id === "string" ? body.id : null };
  } catch (error) {
    return {
      status: "failed",
      errorCode: error instanceof DOMException && error.name === "AbortError" ? "provider_timeout" : "provider_network_error"
    };
  } finally {
    clearTimeout(timeout);
  }
}
