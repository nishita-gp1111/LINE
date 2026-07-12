import { NextResponse } from "next/server";
import { getInboxAuthContext, isTrustedOrigin } from "@/lib/inbox/auth";
import { sendMessageSchema } from "@/lib/inbox/schemas";
import { getInboxStore } from "@/lib/inbox/store";
import { sendInboxTextMessage } from "@/lib/inbox/send-service";
import { toPublicMessage } from "@/lib/inbox/public";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await getInboxAuthContext();
  if (!auth) return NextResponse.json({ ok: false, error: "認証が必要です。" }, { status: 401 });
  if (!isTrustedOrigin(request)) return NextResponse.json({ ok: false, error: "不正なOriginです。" }, { status: 403 });
  const parsed = sendMessageSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message || "入力内容が不正です。" }, { status: 400 });
  const store = getInboxStore(auth.organizationId);
  if (!store) return NextResponse.json({ ok: false, error: "データストアが設定されていません。" }, { status: 503 });
  try {
    const result = await sendInboxTextMessage({ store, organizationId: auth.organizationId, profileId: auth.profileId, role: auth.role, conversationId: parsed.data.conversationId, text: parsed.data.text, clientRequestId: parsed.data.clientRequestId });
    await store.recordAudit({ organizationId: auth.organizationId, actorProfileId: auth.profileId, action: result.reused ? "message.send_requested" : "message.send_requested", resourceType: "message", resourceId: result.message.id, metadata: { status: result.message.status, textLength: parsed.data.text.length } });
    return NextResponse.json({ ok: true, message: toPublicMessage(result.message), reused: result.reused });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "送信できませんでした。" }, { status: 400 });
  }
}
