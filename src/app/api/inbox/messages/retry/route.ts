import { NextResponse } from "next/server";
import { getInboxAuthContext, isTrustedOrigin } from "@/lib/inbox/auth";
import { retryMessageSchema } from "@/lib/inbox/schemas";
import { getInboxStore } from "@/lib/inbox/store";
import { sendInboxTextMessage } from "@/lib/inbox/send-service";
import { toPublicMessage } from "@/lib/inbox/public";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await getInboxAuthContext();
  if (!auth) return NextResponse.json({ ok: false, error: "認証が必要です。" }, { status: 401 });
  if (!isTrustedOrigin(request)) return NextResponse.json({ ok: false, error: "不正なOriginです。" }, { status: 403 });
  const parsed = retryMessageSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "再試行対象が不正です。" }, { status: 400 });
  const store = getInboxStore(auth.organizationId);
  if (!store) return NextResponse.json({ ok: false, error: "データストアが設定されていません。" }, { status: 503 });
  try {
    const conversationId = parsed.data.conversationId || (await findConversationForMessage(store, auth.organizationId, auth.profileId, parsed.data.messageId));
    if (!conversationId) return NextResponse.json({ ok: false, error: "再試行対象の会話が見つかりません。" }, { status: 404 });
    const result = await sendInboxTextMessage({ store, organizationId: auth.organizationId, profileId: auth.profileId, role: auth.role, conversationId, messageId: parsed.data.messageId });
    await store.recordAudit({ organizationId: auth.organizationId, actorProfileId: auth.profileId, action: "message.retry_requested", resourceType: "message", resourceId: parsed.data.messageId });
    return NextResponse.json({ ok: true, message: toPublicMessage(result.message), reused: result.reused });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "再試行できませんでした。" }, { status: 400 });
  }
}

async function findConversationForMessage(store: ReturnType<typeof getInboxStore>, organizationId: string, profileId: string, messageId: string): Promise<string | null> {
  if (!store) return null;
  const list = await store.listConversations({ organizationId, profileId, filter: "all", page: 1, pageSize: 50 });
  for (const item of list.items) {
    const detail = await store.getConversation(organizationId, item.conversation.id, profileId);
    if (detail?.messages.some((message) => message.id === messageId)) return item.conversation.id;
  }
  return null;
}
