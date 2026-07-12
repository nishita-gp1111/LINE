import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ConversationRecord } from "@/lib/inbox/types";
import type {
  ApplyContactInput,
  ClaimInput,
  ClaimResult,
  ContactListResult,
  ContactRecord,
  FriendStatus,
  InboundMessageInput,
  MessageRecord,
  WebhookMetrics,
  WebhookStore
} from "@/lib/webhook/store";

type ClaimRow = { claimed: boolean; event_id: string };
type ContactRow = Record<string, unknown> & { id: string };
type MessageRow = Record<string, unknown> & { id: string };

function mapContact(row: ContactRow): ContactRecord {
  return {
    id: row.id,
    organizationId: String(row.organization_id),
    lineUserId: String(row.line_user_id),
    displayName: (row.display_name as string | null) || null,
    pictureUrl: (row.picture_url as string | null) || null,
    statusMessage: (row.status_message as string | null) || null,
    language: (row.language as string | null) || null,
    friendStatus: row.friend_status as FriendStatus,
    followedAt: (row.followed_at as string | null) || null,
    unfollowedAt: (row.unfollowed_at as string | null) || null,
    firstSeenAt: String(row.first_seen_at),
    lastSeenAt: String(row.last_seen_at),
    lastMessageAt: (row.last_message_at as string | null) || null,
    lastLineEventAt: String(row.last_line_event_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapMessage(row: MessageRow): MessageRecord {
  return {
    id: row.id,
    organizationId: String(row.organization_id),
    contactId: String(row.contact_id),
    direction: "inbound",
    source: "line",
    lineMessageId: (row.line_message_id as string | null) || null,
    lineRequestId: (row.line_request_id as string | null) || null,
    messageType: String(row.message_type),
    textContent: (row.text_content as string | null) || null,
    payloadJson: (row.payload_json as Record<string, unknown>) || {},
    status: row.status as MessageRecord["status"],
    conversationId: (row.conversation_id as string | null) || null,
    clientRequestId: (row.client_request_id as string | null) || null,
    retryKey: (row.retry_key as string | null) || null,
    lineAcceptedRequestId: (row.line_accepted_request_id as string | null) || null,
    lineSentMessageId: (row.line_sent_message_id as string | null) || null,
    sentByProfileId: (row.sent_by_profile_id as string | null) || null,
    attemptCount: Number(row.attempt_count || 0),
    errorClass: (row.error_class as string | null) || null,
    errorCode: (row.error_code as string | null) || null,
    errorMessageSafe: (row.error_message_safe as string | null) || null,
    acceptedAt: (row.accepted_at as string | null) || null,
    failedAt: (row.failed_at as string | null) || null,
    cancelledAt: (row.cancelled_at as string | null) || null,
    lineEventTimestamp: String(row.line_event_timestamp),
    deletedAt: (row.deleted_at as string | null) || null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export class SupabaseWebhookStore implements WebhookStore {
  constructor(
    private readonly client: SupabaseClient,
    private readonly organizationId: string
  ) {}

  async claimEvent(input: ClaimInput): Promise<ClaimResult> {
    const { data, error } = await this.client.rpc("claim_webhook_event", {
      target_organization_id: input.organizationId,
      target_webhook_event_id: input.webhookEventId,
      target_event_type: input.eventType,
      target_line_user_id: input.lineUserId,
      target_line_message_id: input.lineMessageId,
      target_event_timestamp: input.eventTimestamp,
      target_is_redelivery: input.isRedelivery,
      target_payload_redacted_json: input.payloadRedactedJson
    });
    if (error) throw new Error("Webhookイベントのclaimに失敗しました。");
    const row = (Array.isArray(data) ? data[0] : data) as ClaimRow | null;
    if (!row) throw new Error("Webhookイベントclaimの応答が空です。");
    return { claimed: Boolean(row.claimed), eventId: row.event_id };
  }

  async applyContact(input: ApplyContactInput): Promise<ContactRecord> {
    const { data, error } = await this.client.rpc("apply_line_contact_event", {
      target_organization_id: input.organizationId,
      target_line_user_id: input.lineUserId,
      target_event_type: input.eventType,
      target_event_at: input.eventAt,
      target_display_name: input.displayName || null,
      target_picture_url: input.pictureUrl || null,
      target_status_message: input.statusMessage || null,
      target_language: input.language || null
    });
    if (error || !data) throw new Error("顧客upsertに失敗しました。");
    const { data: row, error: selectError } = await this.client
      .from("contacts")
      .select("*")
      .eq("id", data as string)
      .eq("organization_id", input.organizationId)
      .single();
    if (selectError || !row) throw new Error("顧客の再取得に失敗しました。");
    return mapContact(row as ContactRow);
  }

  async insertInboundMessage(input: InboundMessageInput): Promise<{ inserted: boolean; message?: MessageRecord }> {
    const { data, error } = await this.client.rpc("insert_inbound_line_message", {
      target_organization_id: input.organizationId,
      target_contact_id: input.contactId,
      target_line_message_id: input.lineMessageId,
      target_line_request_id: input.lineRequestId,
      target_message_type: input.messageType,
      target_text_content: input.textContent,
      target_payload_json: input.payloadJson,
      target_event_at: input.eventAt
    });
    if (error) throw new Error("受信メッセージ保存に失敗しました。");
    if (!data) return { inserted: false };
    const { data: row, error: selectError } = await this.client
      .from("messages")
      .select("*")
      .eq("id", data as string)
      .single();
    if (selectError || !row) return { inserted: false };
    return { inserted: true, message: mapMessage(row as MessageRow) };
  }

  async redactMessage(organizationId: string, lineMessageId: string): Promise<boolean> {
    const { data, error } = await this.client.rpc("redact_line_message", {
      target_organization_id: organizationId,
      target_line_message_id: lineMessageId
    });
    if (error) throw new Error("unsend対象メッセージの匿名化に失敗しました。");
    return Boolean(data);
  }

  async completeEvent(eventId: string, status: "processed" | "ignored"): Promise<void> {
    const { error } = await this.client.rpc("complete_webhook_event", {
      target_event_id: eventId,
      target_status: status,
      target_error_message_safe: null
    });
    if (error) throw new Error("Webhookイベント完了更新に失敗しました。");
  }

  async failEvent(eventId: string, safeError: string): Promise<void> {
    const { error } = await this.client.rpc("complete_webhook_event", {
      target_event_id: eventId,
      target_status: "failed",
      target_error_message_safe: safeError.slice(0, 500)
    });
    if (error) throw new Error("Webhookイベント失敗更新に失敗しました。");
  }

  async recordSignatureError(): Promise<void> {
    // Signature failures are intentionally not written to business tables before
    // verification. The connection page reports DB-backed event failures only.
  }

  async listContacts(query: { search?: string; status?: FriendStatus; page: number; pageSize: number }): Promise<ContactListResult> {
    const start = (query.page - 1) * query.pageSize;
    let request = this.client
      .from("contacts")
      .select("*", { count: "exact" })
      .eq("organization_id", this.organizationId)
      .order("updated_at", { ascending: false })
      .range(start, start + query.pageSize - 1);
    if (query.status) request = request.eq("friend_status", query.status);
    if (query.search) request = request.ilike("display_name", `%${query.search}%`);
    const { data, error, count } = await request;
    if (error) throw new Error("顧客一覧の取得に失敗しました。");
    return { items: (data || []).map((row) => mapContact(row as ContactRow)), total: count || 0, page: query.page, pageSize: query.pageSize };
  }

  async getContact(organizationId: string, contactId: string): Promise<ContactRecord | null> {
    const { data, error } = await this.client
      .from("contacts")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("id", contactId)
      .maybeSingle();
    if (error) throw new Error("顧客詳細の取得に失敗しました。");
    return data ? mapContact(data as ContactRow) : null;
  }

  async listMessages(organizationId: string, contactId: string): Promise<MessageRecord[]> {
    const { data, error } = await this.client
      .from("messages")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("contact_id", contactId)
      .order("line_event_timestamp", { ascending: false })
      .limit(50);
    if (error) throw new Error("受信メッセージの取得に失敗しました。");
    return (data || []).map((row) => mapMessage(row as MessageRow));
  }

  async getMetrics(): Promise<WebhookMetrics> {
    const { data, error } = await this.client
      .from("webhook_events")
      .select("event_timestamp, processed_at, status", { count: "exact" })
      .eq("organization_id", this.organizationId)
      .order("event_timestamp", { ascending: false })
      .limit(100);
    if (error) throw new Error("Webhook状況の取得に失敗しました。");
    const rows = (data || []) as Array<{ event_timestamp: string; processed_at: string | null; status: string }>;
    return {
      lastWebhookAt: rows[0]?.event_timestamp || null,
      lastProcessedAt: rows.find((row) => row.processed_at)?.processed_at || null,
      failedCount: rows.filter((row) => row.status === "failed").length,
      signatureErrorCount: 0
    };
  }

  async ensureConversationForContact(organizationId: string, contactId: string, eventAt: string): Promise<ConversationRecord> {
    const { data, error } = await this.client.rpc("ensure_conversation_for_contact", {
      target_organization_id: organizationId,
      target_contact_id: contactId,
      target_event_at: eventAt
    });
    if (error) throw new Error("会話の作成に失敗しました。");
    const { data: row, error: selectError } = await this.client.from("conversations").select("*").eq("organization_id", organizationId).eq("id", data as string).single();
    if (selectError || !row) throw new Error("会話の再取得に失敗しました。");
    return {
      id: String(row.id),
      organizationId: String(row.organization_id),
      contactId: String(row.contact_id),
      status: row.status as ConversationRecord["status"],
      assigneeProfileId: (row.assignee_profile_id as string | null) || null,
      priority: row.priority as ConversationRecord["priority"],
      lastMessageAt: (row.last_message_at as string | null) || null,
      lastInboundAt: (row.last_inbound_at as string | null) || null,
      lastOutboundAt: (row.last_outbound_at as string | null) || null,
      lastMessagePreview: (row.last_message_preview as string | null) || null,
      lastMessageDirection: row.last_message_direction as ConversationRecord["lastMessageDirection"],
      reopenedAt: (row.reopened_at as string | null) || null,
      closedAt: (row.closed_at as string | null) || null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  async incrementUnreadForInbound(_organizationId: string, _conversationId: string, _messageId: string): Promise<void> {
    // The Milestone 2 inbound insert RPC increments read states atomically.
  }

  async recalculateConversationPreview(organizationId: string, conversationId: string): Promise<void> {
    const { error } = await this.client.rpc("refresh_conversation_preview", {
      target_organization_id: organizationId,
      target_conversation_id: conversationId
    });
    if (error) throw new Error("会話previewの更新に失敗しました。");
  }
}

export function createSupabaseWebhookStore(organizationId: string): SupabaseWebhookStore | null {
  const client = createSupabaseAdminClient();
  return client ? new SupabaseWebhookStore(client, organizationId) : null;
}
