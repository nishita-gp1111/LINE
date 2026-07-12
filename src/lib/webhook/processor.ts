import type { LineEvent } from "@/lib/line/types";
import { minimalMessagePayload, redactWebhookEventPayload } from "@/lib/line/redaction";
import { LineProfileClient } from "@/lib/line/client";
import type { ApplyContactInput, WebhookStore } from "@/lib/webhook/store";

type ProcessContext = {
  organizationId: string;
  profileClient: LineProfileClient;
};

export type ProcessResult = "processed" | "ignored" | "duplicate";

function sourceIsUser(event: LineEvent): boolean {
  return event.source?.type === "user" && Boolean(event.source.userId);
}

function eventAt(event: LineEvent): string {
  return new Date(event.timestamp).toISOString();
}

async function applyContact(
  store: WebhookStore,
  context: ProcessContext,
  event: LineEvent,
  eventType: ApplyContactInput["eventType"]
) {
  const lineUserId = event.source?.userId;
  if (!lineUserId) return null;

  const lookup = await context.profileClient.getProfile(lineUserId);
  return store.applyContact({
    organizationId: context.organizationId,
    lineUserId,
    eventType,
    eventAt: eventAt(event),
    displayName: lookup.profile?.displayName,
    pictureUrl: lookup.profile?.pictureUrl,
    statusMessage: lookup.profile?.statusMessage,
    language: lookup.profile?.language
  });
}

export async function processWebhookEvent(
  event: LineEvent,
  store: WebhookStore,
  context: ProcessContext
): Promise<ProcessResult> {
  const claim = await store.claimEvent({
    organizationId: context.organizationId,
    webhookEventId: event.webhookEventId,
    eventType: event.type,
    lineUserId: event.source?.userId || null,
    lineMessageId: event.message?.id || event.unsend?.messageId || null,
    eventTimestamp: eventAt(event),
    isRedelivery: event.deliveryContext?.isRedelivery === true,
    payloadRedactedJson: redactWebhookEventPayload(event)
  });

  if (!claim.claimed) return "duplicate";

  try {
    if (!sourceIsUser(event)) {
      await store.completeEvent(claim.eventId, "ignored");
      return "ignored";
    }

    if (event.type === "follow") {
      await applyContact(store, context, event, "follow");
      await store.completeEvent(claim.eventId, "processed");
      return "processed";
    }

    if (event.type === "unfollow") {
      await applyContact(store, context, event, "unfollow");
      await store.completeEvent(claim.eventId, "processed");
      return "processed";
    }

    if (event.type === "message" && event.message) {
      const contact = await applyContact(store, context, event, "message");
      if (!contact) {
        await store.completeEvent(claim.eventId, "ignored");
        return "ignored";
      }
      await store.insertInboundMessage({
        organizationId: context.organizationId,
        contactId: contact.id,
        lineMessageId: event.message.id || null,
        lineRequestId: event.webhookEventId,
        messageType: event.message.type,
        textContent: event.message.type === "text" ? event.message.text || null : null,
        payloadJson: minimalMessagePayload(event),
        eventAt: eventAt(event)
      });
      await store.completeEvent(claim.eventId, "processed");
      return "processed";
    }

    if (event.type === "unsend" && event.unsend) {
      await store.redactMessage(context.organizationId, event.unsend.messageId);
      await store.completeEvent(claim.eventId, "processed");
      return "processed";
    }

    await store.completeEvent(claim.eventId, "ignored");
    return "ignored";
  } catch (error) {
    await store.failEvent(claim.eventId, error instanceof Error ? error.message : "Webhook処理に失敗しました。");
    throw error;
  }
}

export async function processWebhookEvents(
  events: LineEvent[],
  store: WebhookStore,
  context: ProcessContext
): Promise<{ processed: number; ignored: number; duplicates: number }> {
  const result = { processed: 0, ignored: 0, duplicates: 0 };
  for (const event of events) {
    const status = await processWebhookEvent(event, store, context);
    if (status === "processed") result.processed += 1;
    if (status === "ignored") result.ignored += 1;
    if (status === "duplicate") result.duplicates += 1;
  }
  return result;
}
