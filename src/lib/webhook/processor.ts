import type { SupabaseClient } from "@supabase/supabase-js";
import type { LineEvent } from "@/lib/line/types";
import { minimalMessagePayload, redactWebhookEventPayload } from "@/lib/line/redaction";
import { LineProfileClient } from "@/lib/line/client";
import {
  CONTROLLED_ENROLLMENT_REDACTED_TEXT,
  tryEnrollControlledRecipient,
  type ControlledEnrollmentResult
} from "@/lib/launch/controlled-recipient";
import { handleLiveSurveyPostback, sendFollowSurveyIfConfigured } from "@/lib/minimum-launch/live";
import type { InboundEmailNotificationInput } from "@/lib/notifications/inbound-email";
import type { ApplyContactInput, WebhookStore } from "@/lib/webhook/store";

type ControlledRecipientEnrollment = (input: {
  organizationId: string;
  contactId: string;
  lineUserId: string;
  webhookEventId: string;
  message?: string | null;
}) => Promise<ControlledEnrollmentResult>;

export type ProcessContext = {
  organizationId: string;
  profileClient: LineProfileClient;
  minimumLaunchClient?: SupabaseClient;
  controlledRecipientEnrollment?: ControlledRecipientEnrollment;
  onInboundMessage?: (input: InboundEmailNotificationInput) => void;
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
      const contact = await applyContact(store, context, event, "follow");
      if (contact && store.ensureConversationForContact) await store.ensureConversationForContact(context.organizationId, contact.id, eventAt(event));
      if (contact && context.minimumLaunchClient) {
        await sendFollowSurveyIfConfigured({ client: context.minimumLaunchClient, organizationId: context.organizationId, contactId: contact.id, webhookEventId: event.webhookEventId });
      }
      await store.completeEvent(claim.eventId, "processed");
      return "processed";
    }

    if (event.type === "unfollow") {
      await applyContact(store, context, event, "unfollow");
      await store.completeEvent(claim.eventId, "processed");
      return "processed";
    }

    if (event.type === "postback") {
      const postback = (event as LineEvent & { postback?: { data?: string } }).postback;
      if (postback?.data && context.minimumLaunchClient) {
        const contact = await applyContact(store, context, event, "message");
        if (contact) await handleLiveSurveyPostback({ client: context.minimumLaunchClient, organizationId: context.organizationId, contactId: contact.id, data: postback.data, webhookEventId: event.webhookEventId });
      }
      await store.completeEvent(claim.eventId, "processed");
      return "processed";
    }

    if (event.type === "message" && event.message) {
      const contact = await applyContact(store, context, event, "message");
      if (!contact) {
        await store.completeEvent(claim.eventId, "ignored");
        return "ignored";
      }
      let enrollment: ControlledEnrollmentResult = { matched: false, status: "not_enrollment" };
      const enrollmentInput = {
        organizationId: context.organizationId,
        contactId: contact.id,
        lineUserId: contact.lineUserId,
        webhookEventId: event.webhookEventId,
        message: event.message.type === "text" ? event.message.text || null : null
      };
      if (context.controlledRecipientEnrollment) {
        enrollment = await context.controlledRecipientEnrollment(enrollmentInput);
      } else if (context.minimumLaunchClient) {
        enrollment = await tryEnrollControlledRecipient({
          client: context.minimumLaunchClient,
          ...enrollmentInput
        });
      }
      const inserted = await store.insertInboundMessage({
        organizationId: context.organizationId,
        contactId: contact.id,
        lineMessageId: event.message.id || null,
        lineRequestId: event.webhookEventId,
        messageType: event.message.type,
        textContent: enrollment.matched
          ? CONTROLLED_ENROLLMENT_REDACTED_TEXT
          : event.message.type === "text" ? event.message.text || null : null,
        payloadJson: enrollment.matched
          ? { type: "text", hasText: false, messageIdPresent: true, controlledLaunchEnrollment: true }
          : minimalMessagePayload(event),
        lineMarkAsReadToken: event.message.markAsReadToken || null,
        eventAt: eventAt(event)
      });
      if (inserted.inserted && inserted.message && store.ensureConversationForContact) {
        const conversation = await store.ensureConversationForContact(context.organizationId, contact.id, eventAt(event), inserted.message);
        if (store.incrementUnreadForInbound) await store.incrementUnreadForInbound(context.organizationId, conversation.id, inserted.message.id);
        if (!enrollment.matched && context.onInboundMessage) {
          try {
            context.onInboundMessage({
              organizationId: context.organizationId,
              contactId: contact.id,
              conversationId: conversation.id,
              messageId: inserted.message.id,
              displayName: contact.displayName,
              messageType: inserted.message.messageType,
              textContent: inserted.message.textContent,
              receivedAt: inserted.message.lineEventTimestamp,
              createdAt: inserted.message.createdAt
            });
          } catch {
            // Email notification scheduling must never turn a valid LINE event into a webhook failure.
            console.error("[inbound-email] notification scheduling failed");
          }
        }
      }
      if (enrollment.status === "enrolled" && context.minimumLaunchClient) {
        await sendFollowSurveyIfConfigured({
          client: context.minimumLaunchClient,
          organizationId: context.organizationId,
          contactId: contact.id,
          webhookEventId: event.webhookEventId
        });
      }
      await store.completeEvent(claim.eventId, "processed");
      return "processed";
    }

    if (event.type === "unsend" && event.unsend) {
      await store.redactMessage(context.organizationId, event.unsend.messageId);
      if (store.recalculateConversationPreview) {
        const contact = event.source?.userId ? await store.getContact(context.organizationId, event.source.userId) : null;
        if (contact) {
          const conversation = await store.ensureConversationForContact?.(context.organizationId, contact.id, eventAt(event));
          if (conversation) await store.recalculateConversationPreview(context.organizationId, conversation.id);
        }
      }
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
