import "server-only";

import { randomUUID } from "node:crypto";
import { getServerEnv } from "@/lib/env/server";
import { buildLineAttachmentMessage, publicAttachmentUrl } from "@/lib/inbox/attachment-file";
import { createLineMessagePushClient, createLinePushClient, lineTextMessageSchema, LineSendConfigurationError, type LineMessagePushClient, type LinePushClient, type LinePushResult } from "@/lib/line/send";
import type { InboxRole, InboxStore } from "@/lib/inbox/types";
import type { MessageRecord } from "@/lib/webhook/store";
import { assertTestRecipient, isLaunchFlagEnabled } from "@/lib/launch/flags";

export class InboxSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InboxSendError";
  }
}

export type SendMessageInput = {
  store: InboxStore;
  organizationId: string;
  profileId: string;
  role: InboxRole;
  conversationId?: string;
  text?: string;
  clientRequestId?: string;
  messageId?: string;
  pushClient?: LinePushClient;
  gate?: "manual" | "automation";
};

export type SendAttachmentMessageInput = {
  store: InboxStore;
  organizationId: string;
  profileId: string;
  role: InboxRole;
  conversationId: string;
  messageId: string;
  pushClient?: LineMessagePushClient;
};

export function assertInboxAttachmentSendingAvailable(role: InboxRole): void {
  if (role === "viewer") throw new InboxSendError("viewerはファイルを送信できません。");
  const env = getServerEnv();
  if (!env.MOCK_LINE_API && !isLaunchFlagEnabled("LINE_MANUAL_SEND_ENABLED")) {
    throw new InboxSendError("手動送信は無効です。");
  }
  if (!env.MOCK_LINE_API && !isLaunchFlagEnabled("LINE_MEDIA_SEND_ENABLED")) {
    throw new InboxSendError("画像・PDF送信は無効です。");
  }
  if (!env.NEXT_PUBLIC_APP_URL) throw new InboxSendError("公開URLが設定されていません。");
  if (!env.MEDIA_DOWNLOAD_SIGNING_SECRET || env.MEDIA_DOWNLOAD_SIGNING_SECRET.length < 32) {
    throw new InboxSendError("ファイル送信用の署名設定が不足しています。");
  }
}

function safeResultMessage(result: Extract<LinePushResult, { accepted: false }>): string {
  return result.safeMessage || "LINE送信に失敗しました。";
}

async function waitBeforeRetry(attempt: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, attempt === 1 ? 50 : 100));
}

async function resolveMessage(input: SendMessageInput): Promise<{ message: MessageRecord; contactId: string; conversationId: string; created: boolean }> {
  if (input.messageId) {
    if (!input.conversationId) throw new InboxSendError("会話が指定されていません。");
    const detail = await input.store.getConversation(input.organizationId, input.conversationId, input.profileId);
    const message = detail?.messages.find((item) => item.id === input.messageId);
    if (!detail || !message || message.direction !== "outbound") throw new InboxSendError("再試行対象のメッセージが見つかりません。");
    return { message, contactId: detail.contact.id, conversationId: detail.conversation.id, created: false };
  }
  if (!input.conversationId || !input.text || !input.clientRequestId) throw new InboxSendError("送信内容が不足しています。");
  const detail = await input.store.getConversation(input.organizationId, input.conversationId, input.profileId);
  if (!detail) throw new InboxSendError("会話が見つかりません。");
  const existing = await input.store.findOutboundByClientRequest(input.organizationId, input.clientRequestId);
  if (existing) return { message: existing, contactId: detail.contact.id, conversationId: detail.conversation.id, created: false };
  const created = await input.store.createOutboundMessage({ organizationId: input.organizationId, conversationId: detail.conversation.id, contactId: detail.contact.id, textContent: input.text, clientRequestId: input.clientRequestId, retryKey: randomUUID(), sentByProfileId: input.profileId });
  return { message: created.message, contactId: detail.contact.id, conversationId: detail.conversation.id, created: created.created };
}

export async function sendInboxTextMessage(input: SendMessageInput): Promise<{ message: MessageRecord; reused: boolean }> {
  if (input.role === "viewer") throw new InboxSendError("viewerはメッセージを送信できません。");
  const env = getServerEnv();
  const sendFlag = input.gate === "automation" ? "LINE_AUTOMATION_SEND_ENABLED" : "LINE_MANUAL_SEND_ENABLED";
  if (!env.MOCK_LINE_API && !isLaunchFlagEnabled(sendFlag)) throw new InboxSendError(`${input.gate === "automation" ? "自動送信" : "手動送信"}は無効です。`);
  if (!input.messageId && input.text !== undefined) {
    const parsed = lineTextMessageSchema.safeParse(input.text);
    if (!parsed.success) throw new InboxSendError(parsed.error.issues[0]?.message || "本文が不正です。");
  }

  const resolved = await resolveMessage(input);
  const detail = await input.store.getConversation(input.organizationId, resolved.conversationId, input.profileId);
  if (!detail || detail.contact.id !== resolved.contactId) throw new InboxSendError("送信先が見つかりません。");
  if (detail.contact.friendStatus === "blocked") throw new InboxSendError("このユーザーは現在ブロック状態です。");
  try {
    if (input.store.authorizeControlledRecipient) {
      const policy = await input.store.authorizeControlledRecipient(input.organizationId, detail.contact.lineUserId);
      if (!policy.allowed) throw new Error(policy.reason || "送信先が許可されていません。");
    } else {
      assertTestRecipient(detail.contact.lineUserId);
    }
  } catch (error) {
    throw new InboxSendError(error instanceof Error ? error.message : "送信先が許可されていません。");
  }
  if (resolved.message.status === "accepted" || resolved.message.status === "sending") return { message: resolved.message, reused: true };
  if (resolved.message.status !== "queued" && resolved.message.status !== "retryable_failed") throw new InboxSendError("このメッセージは送信できません。");
  if (input.messageId && resolved.message.failedAt && Date.now() - Date.parse(resolved.message.failedAt) > 24 * 60 * 60 * 1000) throw new InboxSendError("再試行期限を過ぎています。新規メッセージとして内容を確認して送信してください。");

  let message: MessageRecord;
  try {
    message = await input.store.claimOutboundMessage(input.organizationId, resolved.message.id, input.profileId);
  } catch (error) {
    if (error instanceof Error && error.message.includes("cannot be sent")) return { message: resolved.message, reused: true };
    throw error;
  }

  let client;
  try {
    client = input.pushClient || createLinePushClient();
  } catch (error) {
    if (error instanceof LineSendConfigurationError) throw new InboxSendError(error.message);
    throw new InboxSendError("LINE送信の設定を確認できません。");
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (!message.retryKey) throw new InboxSendError("Retry Keyが保存されていません。");
    const result = await client.pushTextMessage({ lineUserId: detail.contact.lineUserId, text: message.textContent || "", retryKey: message.retryKey });
    await input.store.recordOutboundAttempt({ organizationId: input.organizationId, messageId: message.id, attemptNumber: attempt, httpStatus: result.accepted ? 200 : result.httpStatus, lineRequestId: result.lineRequestId, lineAcceptedRequestId: result.lineAcceptedRequestId, errorClass: result.accepted ? null : result.errorClass, errorMessageSafe: result.accepted ? null : result.safeMessage });
    if (result.accepted) {
      const accepted = await input.store.updateOutboundMessage(input.organizationId, message.id, { status: "accepted", lineRequestId: result.lineRequestId, lineAcceptedRequestId: result.lineAcceptedRequestId, lineSentMessageId: result.lineSentMessageId, acceptedAt: new Date().toISOString(), errorClass: null, errorCode: null, errorMessageSafe: null, attemptCount: message.attemptCount });
      await input.store.recordAudit({ organizationId: input.organizationId, actorProfileId: input.profileId, action: "message.send_accepted", resourceType: "message", resourceId: message.id, metadata: { status: "accepted" } });
      return { message: accepted, reused: !resolved.created };
    }
    if (!result.retryable || attempt === 3) {
      const failed = await input.store.updateOutboundMessage(input.organizationId, message.id, { status: result.retryable ? "retryable_failed" : "permanently_failed", lineRequestId: result.lineRequestId, lineAcceptedRequestId: result.lineAcceptedRequestId, errorClass: result.errorClass, errorCode: result.errorCode, errorMessageSafe: safeResultMessage(result), failedAt: new Date().toISOString(), attemptCount: message.attemptCount });
      await input.store.recordAudit({ organizationId: input.organizationId, actorProfileId: input.profileId, action: "message.send_failed", resourceType: "message", resourceId: message.id, metadata: { status: failed.status, errorClass: result.errorClass } });
      return { message: failed, reused: !resolved.created };
    }
    await waitBeforeRetry(attempt);
  }
  throw new InboxSendError("LINE送信に失敗しました。");
}

export async function sendInboxAttachmentMessage(input: SendAttachmentMessageInput): Promise<{ message: MessageRecord; reused: boolean }> {
  assertInboxAttachmentSendingAvailable(input.role);
  const env = getServerEnv();
  const detail = await input.store.getConversation(input.organizationId, input.conversationId, input.profileId);
  const message = detail?.messages.find((item) => item.id === input.messageId);
  if (!detail || !message || message.direction !== "outbound" || !["image", "file"].includes(message.messageType)) {
    throw new InboxSendError("送信する添付ファイルが見つかりません。");
  }
  if (detail.contact.friendStatus === "blocked") throw new InboxSendError("このユーザーは現在ブロック状態です。");
  try {
    if (input.store.authorizeControlledRecipient) {
      const policy = await input.store.authorizeControlledRecipient(input.organizationId, detail.contact.lineUserId);
      if (!policy.allowed) throw new Error(policy.reason || "送信先が許可されていません。");
    } else {
      assertTestRecipient(detail.contact.lineUserId);
    }
  } catch (error) {
    throw new InboxSendError(error instanceof Error ? error.message : "送信先が許可されていません。");
  }

  if (message.status === "accepted" || message.status === "sending") return { message, reused: true };
  if (message.status !== "queued" && message.status !== "retryable_failed") throw new InboxSendError("このファイルは送信できません。");
  if (message.failedAt && Date.now() - Date.parse(message.failedAt) > 24 * 60 * 60 * 1000) {
    throw new InboxSendError("再試行期限を過ぎています。ファイルを選び直して送信してください。");
  }

  const attachment = await input.store.getMessageAttachment(input.organizationId, message.id);
  if (!attachment) throw new InboxSendError("添付ファイル情報が見つかりません。");
  const originalUrl = publicAttachmentUrl({
    appUrl: env.NEXT_PUBLIC_APP_URL!,
    attachmentId: attachment.id,
    secret: env.MEDIA_DOWNLOAD_SIGNING_SECRET!
  });
  const previewUrl = attachment.attachmentType === "image"
    ? publicAttachmentUrl({
      appUrl: env.NEXT_PUBLIC_APP_URL!,
      attachmentId: attachment.id,
      secret: env.MEDIA_DOWNLOAD_SIGNING_SECRET!,
      variant: "preview"
    })
    : undefined;
  const lineMessage = buildLineAttachmentMessage({
    attachmentType: attachment.attachmentType,
    fileName: attachment.fileName,
    originalUrl,
    previewUrl
  });

  let claimed: MessageRecord;
  try {
    claimed = await input.store.claimOutboundMessage(input.organizationId, message.id, input.profileId);
  } catch (error) {
    if (error instanceof Error && error.message.includes("cannot be sent")) return { message, reused: true };
    throw error;
  }

  let client: LineMessagePushClient;
  try {
    client = input.pushClient || createLineMessagePushClient();
  } catch (error) {
    if (error instanceof LineSendConfigurationError) throw new InboxSendError(error.message);
    throw new InboxSendError("LINE送信の設定を確認できません。");
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (!claimed.retryKey) throw new InboxSendError("Retry Keyが保存されていません。");
    const result = await client.pushMessage({ lineUserId: detail.contact.lineUserId, message: lineMessage, retryKey: claimed.retryKey });
    await input.store.recordOutboundAttempt({ organizationId: input.organizationId, messageId: claimed.id, attemptNumber: attempt, httpStatus: result.accepted ? 200 : result.httpStatus, lineRequestId: result.lineRequestId, lineAcceptedRequestId: result.lineAcceptedRequestId, errorClass: result.accepted ? null : result.errorClass, errorMessageSafe: result.accepted ? null : result.safeMessage });
    if (result.accepted) {
      const accepted = await input.store.updateOutboundMessage(input.organizationId, claimed.id, { status: "accepted", lineRequestId: result.lineRequestId, lineAcceptedRequestId: result.lineAcceptedRequestId, lineSentMessageId: result.lineSentMessageId, acceptedAt: new Date().toISOString(), errorClass: null, errorCode: null, errorMessageSafe: null, attemptCount: claimed.attemptCount });
      await input.store.recordAudit({ organizationId: input.organizationId, actorProfileId: input.profileId, action: "message.attachment_send_accepted", resourceType: "message", resourceId: claimed.id, metadata: { status: "accepted", attachmentType: attachment.attachmentType, sizeBytes: attachment.sizeBytes } });
      return { message: accepted, reused: false };
    }
    if (!result.retryable || attempt === 3) {
      const failed = await input.store.updateOutboundMessage(input.organizationId, claimed.id, { status: result.retryable ? "retryable_failed" : "permanently_failed", lineRequestId: result.lineRequestId, lineAcceptedRequestId: result.lineAcceptedRequestId, errorClass: result.errorClass, errorCode: result.errorCode, errorMessageSafe: safeResultMessage(result), failedAt: new Date().toISOString(), attemptCount: claimed.attemptCount });
      await input.store.recordAudit({ organizationId: input.organizationId, actorProfileId: input.profileId, action: "message.attachment_send_failed", resourceType: "message", resourceId: claimed.id, metadata: { status: failed.status, attachmentType: attachment.attachmentType, errorClass: result.errorClass } });
      return { message: failed, reused: false };
    }
    await waitBeforeRetry(attempt);
  }
  throw new InboxSendError("LINE送信に失敗しました。");
}
