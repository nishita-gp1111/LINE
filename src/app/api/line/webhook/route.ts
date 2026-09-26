import { after, NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env/server";
import { getLineRuntimeConfig } from "@/lib/line/config";
import { LineConfigurationError } from "@/lib/line/errors";
import { LineProfileClient } from "@/lib/line/client";
import { verifyLineSignature } from "@/lib/line/signature";
import { lineWebhookPayloadSchema } from "@/lib/line/types";
import { processWebhookEvents } from "@/lib/webhook/processor";
import { getMockWebhookStore } from "@/lib/webhook/store";
import { createSupabaseWebhookStore } from "@/lib/webhook/store-supabase";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendInboundEmailNotification } from "@/lib/notifications/inbound-email";
import { SupabaseInboundEmailHistory } from "@/lib/notifications/inbound-email-supabase";
import { getReceivedImage, removeReceivedImage } from "@/lib/inbox/received-image";

export const runtime = "nodejs";

function badRequest(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-line-signature");
  const env = getServerEnv();

  if (!signature) {
    return NextResponse.json({ ok: false, error: "署名がありません。" }, { status: 401 });
  }
  if (!env.LINE_CHANNEL_SECRET) {
    return NextResponse.json({ ok: false, error: "LINE署名検証の設定が不足しています。" }, { status: 503 });
  }
  if (!verifyLineSignature(rawBody, signature, env.LINE_CHANNEL_SECRET)) {
    return NextResponse.json({ ok: false, error: "署名が不正です。" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody) as unknown;
  } catch {
    return badRequest("JSON形式が不正です。");
  }

  const parsed = lineWebhookPayloadSchema.safeParse(json);
  if (!parsed.success) return badRequest("Webhook payloadが不正です。");
  if (parsed.data.events.length === 0) return NextResponse.json({ ok: true, events: 0 });

  try {
    const config = getLineRuntimeConfig();
    const store =
      config.mode === "mock"
        ? getMockWebhookStore()
        : createSupabaseWebhookStore(config.organizationId);
    if (!store) {
      return NextResponse.json({ ok: false, error: "Webhook保存先の設定が不足しています。" }, { status: 503 });
    }

    const adminClient = config.mode === "live" ? createSupabaseAdminClient() || undefined : undefined;
    const emailHistory = adminClient ? new SupabaseInboundEmailHistory(adminClient) : undefined;
    const result = await processWebhookEvents(parsed.data.events, store, {
      organizationId: config.organizationId,
      profileClient: new LineProfileClient({
        mode: config.mode,
        channelAccessToken: config.channelAccessToken
      }),
      minimumLaunchClient: adminClient,
      onInboundMessage: adminClient
        ? (message) => {
            after(async () => {
              if (message.messageType === "image") {
                try { await getReceivedImage(message.organizationId, message.messageId); }
                catch { console.error("[received-image] archive failed; retry on authorized view"); }
              }
              if (!env.INBOUND_EMAIL_NOTIFICATIONS_ENABLED || !emailHistory) return;
              try {
                const notification = await sendInboundEmailNotification({
                  message,
                  env,
                  history: emailHistory
                });
                if (notification.status === "failed") {
                  console.error(`[inbound-email] ${notification.errorCode}`);
                }
              } catch {
                console.error("[inbound-email] unexpected notification failure");
              }
            });
          }
        : undefined
    });
    if (adminClient) {
      for (const event of parsed.data.events) {
        if (event.type === "unsend" && event.unsend && event.source?.type === "user") {
          const lineMessageId = event.unsend.messageId;
          after(async () => {
            try { await removeReceivedImage(config.organizationId, lineMessageId); }
            catch { console.error("[received-image] cleanup failed"); }
          });
        }
      }
    }
    return NextResponse.json({ ok: true, events: parsed.data.events.length, ...result });
  } catch (error) {
    const status = error instanceof LineConfigurationError ? 503 : 500;
    const message = error instanceof LineConfigurationError ? error.message : "Webhook処理に失敗しました。";
    return NextResponse.json(
      { ok: false, error: message },
      { status }
    );
  }
}
