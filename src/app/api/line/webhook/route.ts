import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env/server";
import { getLineRuntimeConfig } from "@/lib/line/config";
import { LineConfigurationError } from "@/lib/line/errors";
import { LineProfileClient } from "@/lib/line/client";
import { verifyLineSignature } from "@/lib/line/signature";
import { lineWebhookPayloadSchema } from "@/lib/line/types";
import { processWebhookEvents } from "@/lib/webhook/processor";
import { getMockWebhookStore } from "@/lib/webhook/store";
import { createSupabaseWebhookStore } from "@/lib/webhook/store-supabase";

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

    const result = await processWebhookEvents(parsed.data.events, store, {
      organizationId: config.organizationId,
      profileClient: new LineProfileClient({
        mode: config.mode,
        channelAccessToken: config.channelAccessToken
      })
    });
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
