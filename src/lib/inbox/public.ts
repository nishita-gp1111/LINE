import type { MessageRecord } from "@/lib/webhook/store";

export type PublicMessage = Omit<MessageRecord, "retryKey" | "clientRequestId">;

export function toPublicMessage(message: MessageRecord): PublicMessage {
  const { retryKey: _retryKey, clientRequestId: _clientRequestId, ...safeMessage } = message;
  return safeMessage;
}
