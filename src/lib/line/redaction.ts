import type { LineEvent } from "@/lib/line/types";

export function redactWebhookEventPayload(event: LineEvent): Record<string, unknown> {
  return {
    type: event.type,
    webhookEventId: event.webhookEventId,
    timestamp: event.timestamp,
    mode: event.mode,
    isRedelivery: event.deliveryContext?.isRedelivery === true,
    sourceType: event.source?.type,
    message: event.message
      ? { id: event.message.id, type: event.message.type }
      : undefined,
    unsendMessageId: event.unsend?.messageId
  };
}

export function minimalMessagePayload(event: LineEvent): Record<string, unknown> {
  return {
    type: event.message?.type || "unknown",
    hasText: Boolean(event.message?.text),
    messageIdPresent: Boolean(event.message?.id)
  };
}
