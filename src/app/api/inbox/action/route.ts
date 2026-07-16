import { NextResponse } from "next/server";
import { getInboxAuthContext, isTrustedOrigin } from "@/lib/inbox/auth";
import { inboxActionSchema } from "@/lib/inbox/schemas";
import { getInboxStore } from "@/lib/inbox/store";
import { getServerEnv } from "@/lib/env/server";
import { markLineChatAsRead } from "@/lib/line/read";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await getInboxAuthContext();
  if (!auth) return NextResponse.json({ ok: false, error: "認証が必要です。" }, { status: 401 });
  if (!isTrustedOrigin(request)) return NextResponse.json({ ok: false, error: "不正なOriginです。" }, { status: 403 });
  const parsed = inboxActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "入力内容が不正です。" }, { status: 400 });
  const store = getInboxStore(auth.organizationId);
  if (!store) return NextResponse.json({ ok: false, error: "データストアが設定されていません。" }, { status: 503 });
  try {
    if (parsed.data.action === "read") {
      const state = await store.markConversationRead(auth.organizationId, parsed.data.conversationId, auth.profileId, parsed.data.lastMessageId);
      const markAsReadToken = await store.getLatestLineMarkAsReadToken(auth.organizationId, parsed.data.conversationId);
      const env = getServerEnv();
      const lineRead = markAsReadToken
        ? await markLineChatAsRead(markAsReadToken, { mode: env.MOCK_LINE_API ? "mock" : "live", channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN })
        : { status: "no_token" as const };
      await store.recordAudit({ organizationId: auth.organizationId, actorProfileId: auth.profileId, action: "conversation.read", resourceType: "conversation", resourceId: parsed.data.conversationId, metadata: { lineReadStatus: lineRead.status } });
      return NextResponse.json({ ok: true, readState: state, lineRead: { status: lineRead.status } });
    }
    if (parsed.data.action === "update") {
      if (auth.role === "viewer") return NextResponse.json({ ok: false, error: "権限がありません。" }, { status: 403 });
      const assigneeProfileId = parsed.data.assigneeProfileId;
      if (assigneeProfileId && auth.role !== "admin" && auth.role !== "owner" && assigneeProfileId !== auth.profileId) return NextResponse.json({ ok: false, error: "担当者を変更できません。" }, { status: 403 });
      if (assigneeProfileId && !(await store.listProfiles(auth.organizationId)).some((profile) => profile.id === assigneeProfileId)) return NextResponse.json({ ok: false, error: "同じorganizationの担当者を指定してください。" }, { status: 400 });
      const conversation = await store.updateConversation(auth.organizationId, parsed.data.conversationId, auth.profileId, auth.role, { status: parsed.data.status, assigneeProfileId: parsed.data.assigneeProfileId, priority: parsed.data.priority });
      await store.recordAudit({ organizationId: auth.organizationId, actorProfileId: auth.profileId, action: parsed.data.assigneeProfileId !== undefined ? "conversation.assigned" : parsed.data.priority ? "conversation.priority_changed" : "conversation.status_changed", resourceType: "conversation", resourceId: parsed.data.conversationId, metadata: { status: parsed.data.status || null, priority: parsed.data.priority || null } });
      return NextResponse.json({ ok: true, conversation });
    }
    if (parsed.data.action === "note_create") {
      const note = await store.addNote(auth.organizationId, parsed.data.conversationId, auth.profileId, auth.role, parsed.data.body);
      await store.recordAudit({ organizationId: auth.organizationId, actorProfileId: auth.profileId, action: "conversation.note_created", resourceType: "conversation_note", resourceId: note.id, metadata: { length: parsed.data.body.length } });
      return NextResponse.json({ ok: true, note });
    }
    if (parsed.data.action === "note_update") {
      const note = await store.updateNote(auth.organizationId, parsed.data.noteId, auth.profileId, auth.role, parsed.data.body);
      await store.recordAudit({ organizationId: auth.organizationId, actorProfileId: auth.profileId, action: "conversation.note_updated", resourceType: "conversation_note", resourceId: note.id, metadata: { length: parsed.data.body.length } });
      return NextResponse.json({ ok: true, note });
    }
    await store.deleteNote(auth.organizationId, parsed.data.noteId, auth.profileId, auth.role);
    await store.recordAudit({ organizationId: auth.organizationId, actorProfileId: auth.profileId, action: "conversation.note_deleted", resourceType: "conversation_note", resourceId: parsed.data.noteId });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "操作を完了できませんでした。権限と対象を確認してください。" }, { status: 400 });
  }
}
