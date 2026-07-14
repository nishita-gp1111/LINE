import "server-only";

import { randomUUID } from "node:crypto";
import { getServerEnv } from "@/lib/env/server";
import { createLinePushClient, lineTextMessageSchema, LineSendConfigurationError, type LinePushClient, type LinePushResult } from "@/lib/line/send";
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
