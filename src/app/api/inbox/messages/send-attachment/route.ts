import { NextResponse } from "next/server";
import { getInboxAuthContext, isTrustedOrigin } from "@/lib/inbox/auth";
import { removeStoredInboxAttachment, storeInboxAttachment } from "@/lib/inbox/attachment-storage";
import { sendAttachmentSchema } from "@/lib/inbox/schemas";
import { assertInboxAttachmentSendingAvailable, sendInboxAttachmentMessage } from "@/lib/inbox/send-service";
import { toPublicMessage } from "@/lib/inbox/public";
import { getInboxStore } from "@/lib/inbox/store";
import { assertTestRecipient } from "@/lib/launch/flags";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await getInboxAuthContext();
  if (!auth) return NextResponse.json({ ok: false, error: "認証が必要です。" }, { status: 401 });
  if (!isTrustedOrigin(request)) return NextResponse.json({ ok: false, error: "不正なOriginです。" }, { status: 403 });

  try {
    assertInboxAttachmentSendingAvailable(auth.role);
    const form = await request.formData();
    const parsed = sendAttachmentSchema.safeParse({
      conversationId: form.get("conversationId"),
      clientRequestId: form.get("clientRequestId")
    });
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message || "入力内容が不正です。" }, { status: 400 });
    }
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "ファイルを選択してください。" }, { status: 400 });

    const store = getInboxStore(auth.organizationId);
    if (!store) return NextResponse.json({ ok: false, error: "データストアが設定されていません。" }, { status: 503 });
    const detail = await store.getConversation(auth.organizationId, parsed.data.conversationId, auth.profileId);
    if (!detail) return NextResponse.json({ ok: false, error: "会話が見つかりません。" }, { status: 404 });
    if (detail.contact.friendStatus === "blocked") return NextResponse.json({ ok: false, error: "このユーザーは現在ブロック状態です。" }, { status: 400 });

    if (store.authorizeControlledRecipient) {
      const policy = await store.authorizeControlledRecipient(auth.organizationId, detail.contact.lineUserId);
      if (!policy.allowed) return NextResponse.json({ ok: false, error: policy.reason || "送信先が許可されていません。" }, { status: 403 });
    } else {
      assertTestRecipient(detail.contact.lineUserId);
    }

    const existing = await store.findOutboundByClientRequest(auth.organizationId, parsed.data.clientRequestId);
    if (existing) {
      const result = await sendInboxAttachmentMessage({ store, organizationId: auth.organizationId, profileId: auth.profileId, role: auth.role, conversationId: detail.conversation.id, messageId: existing.id });
      return NextResponse.json({ ok: true, message: toPublicMessage(result.message), reused: true });
    }

    const attachment = await storeInboxAttachment({
      organizationId: auth.organizationId,
      conversationId: detail.conversation.id,
      contactId: detail.contact.id,
      createdByProfileId: auth.profileId,
      file
    });

    let created;
    try {
      created = await store.createOutboundMessage({
        organizationId: auth.organizationId,
        conversationId: detail.conversation.id,
        contactId: detail.contact.id,
        textContent: attachment.attachmentType === "image" ? `画像：${attachment.fileName}` : `PDF：${attachment.fileName}`,
        clientRequestId: parsed.data.clientRequestId,
        retryKey: crypto.randomUUID(),
        sentByProfileId: auth.profileId,
        attachment
      });
    } catch (error) {
      await removeStoredInboxAttachment(attachment);
      throw error;
    }

    if (!created.created) await removeStoredInboxAttachment(attachment);
    await store.recordAudit({
      organizationId: auth.organizationId,
      actorProfileId: auth.profileId,
      action: "message.attachment_send_requested",
      resourceType: "message",
      resourceId: created.message.id,
      metadata: { attachmentType: attachment.attachmentType, sizeBytes: attachment.sizeBytes }
    });
    const result = await sendInboxAttachmentMessage({ store, organizationId: auth.organizationId, profileId: auth.profileId, role: auth.role, conversationId: detail.conversation.id, messageId: created.message.id });
    return NextResponse.json({ ok: true, message: toPublicMessage(result.message), reused: !created.created || result.reused });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "ファイルを送信できませんでした。" }, { status: 400 });
  }
}
