import { NextResponse } from "next/server";
import {
  LiffAcquisitionError,
  liffAcquisitionClaimSchema,
  verifyLiffAcquisitionUser
} from "@/lib/acquisition/liff-verification";
import { getServerEnv } from "@/lib/env/server";
import { applyLiveAcquisitionRouteTagBySlug } from "@/lib/minimum-launch/live";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SupabaseWebhookStore } from "@/lib/webhook/store-supabase";

export const runtime = "nodejs";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff"
};

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS });
}

function requestOriginIsAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  let normalizedOrigin: string;
  try {
    normalizedOrigin = new URL(origin).origin;
  } catch {
    return false;
  }
  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host")?.trim();
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProtocol || requestUrl.protocol.replace(/:$/, "");
  const trustedOrigins = new Set([requestUrl.origin]);
  if (host && (protocol === "http" || protocol === "https")) {
    trustedOrigins.add(`${protocol}://${host}`);
  }
  return trustedOrigins.has(normalizedOrigin);
}

export async function POST(request: Request) {
  if (!requestOriginIsAllowed(request)) {
    return json({ ok: false, code: "invalid_origin", error: "この画面からもう一度お試しください。" }, 403);
  }
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return json({ ok: false, code: "invalid_request", error: "リクエスト形式が不正です。" }, 400);
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > 20_000) {
    return json({ ok: false, code: "invalid_request", error: "リクエストが大きすぎます。" }, 413);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody) as unknown;
  } catch {
    return json({ ok: false, code: "invalid_request", error: "リクエスト形式が不正です。" }, 400);
  }
  const parsed = liffAcquisitionClaimSchema.safeParse(body);
  if (!parsed.success) {
    return json({ ok: false, code: "invalid_request", error: "登録情報が不正です。" }, 400);
  }

  const env = getServerEnv();
  if (
    !env.NEXT_PUBLIC_LIFF_ID ||
    !env.LINE_LOGIN_CHANNEL_ID ||
    !env.LINE_CHANNEL_ACCESS_TOKEN ||
    !env.LINE_ORGANIZATION_ID
  ) {
    return json({ ok: false, code: "not_configured", error: "LINE登録機能の設定が完了していません。" }, 503);
  }
  const client = createSupabaseAdminClient();
  if (!client) {
    return json({ ok: false, code: "database_not_configured", error: "登録先の設定が完了していません。" }, 503);
  }

  try {
    const verified = await verifyLiffAcquisitionUser({
      idToken: parsed.data.idToken,
      accessToken: parsed.data.accessToken,
      lineLoginChannelId: env.LINE_LOGIN_CHANNEL_ID,
      lineChannelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN
    });
    const now = new Date().toISOString();
    const store = new SupabaseWebhookStore(client, env.LINE_ORGANIZATION_ID);
    const contact = await store.applyContact({
      organizationId: env.LINE_ORGANIZATION_ID,
      lineUserId: verified.lineUserId,
      eventType: "follow",
      eventAt: now,
      displayName: verified.displayName,
      pictureUrl: verified.pictureUrl,
      statusMessage: verified.statusMessage,
      language: verified.language
    });
    const tagging = await applyLiveAcquisitionRouteTagBySlug({
      client,
      organizationId: env.LINE_ORGANIZATION_ID,
      contactId: contact.id,
      slug: parsed.data.source
    });
    if (!tagging.matched || !tagging.tagName) {
      return json({ ok: false, code: "invalid_source", error: "流入経路を確認できませんでした。" }, 400);
    }
    return json({
      ok: true,
      source: tagging.slug,
      tagName: tagging.tagName,
      duplicate: tagging.duplicate === true
    });
  } catch (error) {
    if (error instanceof LiffAcquisitionError) {
      return json({ ok: false, code: error.code, error: error.message }, error.status);
    }
    return json({ ok: false, code: "registration_failed", error: "登録を完了できませんでした。時間をおいて再度お試しください。" }, 500);
  }
}
