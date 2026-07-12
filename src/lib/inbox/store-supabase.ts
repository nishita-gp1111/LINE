import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContactRecord, MessageRecord } from "@/lib/webhook/store";
import type { ConversationDetail, ConversationListItem, ConversationListQuery, ConversationNote, ConversationReadState, ConversationRecord, ConversationUpdate, InboxRole, InboxStore, OutboundCreateInput, OutboundSendUpdate, ProfileSummary, QuickReplyTemplate } from "@/lib/inbox/types";

type Row = Record<string, unknown>;

function asString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function mapContact(row: Row): ContactRecord {
  return { id: String(row.id), organizationId: String(row.organization_id), lineUserId: String(row.line_user_id), displayName: asString(row.display_name), pictureUrl: asString(row.picture_url), statusMessage: asString(row.status_message), language: asString(row.language), friendStatus: row.friend_status as ContactRecord["friendStatus"], followedAt: asString(row.followed_at), unfollowedAt: asString(row.unfollowed_at), firstSeenAt: String(row.first_seen_at), lastSeenAt: String(row.last_seen_at), lastMessageAt: asString(row.last_message_at), lastLineEventAt: String(row.last_line_event_at), createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

function mapMessage(row: Row): MessageRecord {
  return { id: String(row.id), organizationId: String(row.organization_id), contactId: String(row.contact_id), direction: row.direction as MessageRecord["direction"], source: "line", lineMessageId: asString(row.line_message_id), lineRequestId: asString(row.line_request_id), messageType: String(row.message_type), textContent: asString(row.text_content), payloadJson: (row.payload_json as Record<string, unknown>) || {}, status: row.status as MessageRecord["status"], conversationId: asString(row.conversation_id), clientRequestId: asString(row.client_request_id), retryKey: asString(row.retry_key), lineAcceptedRequestId: asString(row.line_accepted_request_id), lineSentMessageId: asString(row.line_sent_message_id), sentByProfileId: asString(row.sent_by_profile_id), attemptCount: Number(row.attempt_count || 0), errorClass: asString(row.error_class), errorCode: asString(row.error_code), errorMessageSafe: asString(row.error_message_safe), acceptedAt: asString(row.accepted_at), failedAt: asString(row.failed_at), cancelledAt: asString(row.cancelled_at), lineEventTimestamp: String(row.line_event_timestamp), deletedAt: asString(row.deleted_at), createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

function mapConversation(row: Row): ConversationRecord {
  return { id: String(row.id), organizationId: String(row.organization_id), contactId: String(row.contact_id), status: row.status as ConversationRecord["status"], assigneeProfileId: asString(row.assignee_profile_id), priority: row.priority as ConversationRecord["priority"], lastMessageAt: asString(row.last_message_at), lastInboundAt: asString(row.last_inbound_at), lastOutboundAt: asString(row.last_outbound_at), lastMessagePreview: asString(row.last_message_preview), lastMessageDirection: row.last_message_direction as ConversationRecord["lastMessageDirection"], reopenedAt: asString(row.reopened_at), closedAt: asString(row.closed_at), createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

function mapReadState(row: Row, organizationId: string, conversationId: string, profileId: string): ConversationReadState {
  return { id: String(row.id || `read-${conversationId}-${profileId}`), organizationId, conversationId, profileId, unreadCount: Number(row.unread_count || 0), lastReadAt: asString(row.last_read_at), lastReadMessageId: asString(row.last_read_message_id), createdAt: String(row.created_at || new Date().toISOString()), updatedAt: String(row.updated_at || new Date().toISOString()) };
}

function mapProfile(row: Row, role: string): ProfileSummary {
  return { id: String(row.id), displayName: String(row.display_name || row.email || "管理者"), email: String(row.email || ""), role: (role === "owner" || role === "admin" || role === "operator" || role === "viewer" ? role : "viewer") as InboxRole };
}

function mapNote(row: Row, profiles: Map<string, ProfileSummary>): ConversationNote {
  return { id: String(row.id), organizationId: String(row.organization_id), conversationId: String(row.conversation_id), body: String(row.body), createdByProfileId: String(row.created_by_profile_id), updatedByProfileId: String(row.updated_by_profile_id), createdAt: String(row.created_at), updatedAt: String(row.updated_at), deletedAt: asString(row.deleted_at), author: profiles.get(String(row.created_by_profile_id)) || null };
}

function mapQuick(row: Row): QuickReplyTemplate {
  return { id: String(row.id), organizationId: String(row.organization_id), name: String(row.name), textContent: String(row.text_content), sortOrder: Number(row.sort_order || 0), isActive: Boolean(row.is_active), createdByProfileId: String(row.created_by_profile_id), createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

export class SupabaseInboxStore implements InboxStore {
  constructor(private readonly client: SupabaseClient, private readonly organizationId: string) {}

  private async profileMap(): Promise<Map<string, ProfileSummary>> {
    const { data } = await this.client.from("organization_members").select("role, profiles(id, email, display_name)").eq("organization_id", this.organizationId);
    const profiles = new Map<string, ProfileSummary>();
    for (const row of (data || []) as Row[]) {
      const profile = Array.isArray(row.profiles) ? row.profiles[0] as Row | undefined : row.profiles as Row | undefined;
      if (profile) profiles.set(String(profile.id), mapProfile(profile, String(row.role)));
    }
    return profiles;
  }

  private async readState(conversationId: string, profileId: string): Promise<ConversationReadState> {
    const { data } = await this.client.from("conversation_read_states").select("*").eq("organization_id", this.organizationId).eq("conversation_id", conversationId).eq("profile_id", profileId).maybeSingle();
    return mapReadState((data || {}) as Row, this.organizationId, conversationId, profileId);
  }

  async listConversations(query: ConversationListQuery): Promise<{ items: ConversationListItem[]; total: number; page: number; pageSize: number }> {
    const start = (query.page - 1) * query.pageSize;
    let matchingContactIds: string[] | null = null;
    if (query.search || query.ownerSearchLineUserId || query.filter === "blocked") {
      let contactRequest = this.client.from("contacts").select("id").eq("organization_id", query.organizationId);
      if (query.search) contactRequest = /^[0-9a-f-]{36}$/i.test(query.search) ? contactRequest.eq("id", query.search) : contactRequest.ilike("display_name", `%${query.search}%`);
      if (query.ownerSearchLineUserId) contactRequest = contactRequest.eq("line_user_id", query.ownerSearchLineUserId);
      if (query.filter === "blocked") contactRequest = contactRequest.eq("friend_status", "blocked");
      const contacts = await contactRequest;
      matchingContactIds = ((contacts.data || []) as Row[]).map((row) => String(row.id));
      if (!matchingContactIds.length) return { items: [], total: 0, page: query.page, pageSize: query.pageSize };
    }
    let request = this.client.from("conversations").select("*", { count: "exact" }).eq("organization_id", query.organizationId).order("last_message_at", { ascending: false, nullsFirst: false }).range(start, start + query.pageSize - 1);
    if (matchingContactIds) request = request.in("contact_id", matchingContactIds);
    if (["open", "pending", "closed"].includes(query.filter)) request = request.eq("status", query.filter);
    if (query.filter === "mine") request = request.eq("assignee_profile_id", query.profileId);
    if (query.filter === "unassigned") request = request.is("assignee_profile_id", null);
    if (query.filter === "high") request = request.eq("priority", "high");
    if (query.filter === "unread") {
      const unread = await this.client.from("conversation_read_states").select("conversation_id").eq("organization_id", query.organizationId).eq("profile_id", query.profileId).gt("unread_count", 0);
      const unreadIds = ((unread.data || []) as Row[]).map((row) => String(row.conversation_id));
      if (!unreadIds.length) return { items: [], total: 0, page: query.page, pageSize: query.pageSize };
      request = request.in("id", unreadIds);
    }
    const { data, error, count } = await request;
    if (error) throw new Error("会話一覧を取得できませんでした。");
    const rows = (data || []) as Row[];
    const conversationIds = rows.map((row) => String(row.id));
    const contactIds = rows.map((row) => String(row.contact_id));
    const contactsResponse = contactIds.length ? await this.client.from("contacts").select("*").eq("organization_id", query.organizationId).in("id", contactIds) : { data: [] };
    const contacts = new Map<string, ContactRecord>((((contactsResponse.data || []) as Row[]).map((row) => [String(row.id), mapContact(row)])));
    const statesResponse = conversationIds.length ? await this.client.from("conversation_read_states").select("*").eq("organization_id", query.organizationId).eq("profile_id", query.profileId).in("conversation_id", conversationIds) : { data: [] };
    const states = new Map<string, ConversationReadState>((((statesResponse.data || []) as Row[]).map((row) => [String(row.conversation_id), mapReadState(row, query.organizationId, String(row.conversation_id), query.profileId)])));
    const profiles = await this.profileMap();
    const items = rows.map((row) => {
      const conversation = mapConversation(row);
      const contact = contacts.get(conversation.contactId);
      if (!contact) return null;
      return { conversation, contact, readState: states.get(conversation.id) || mapReadState({}, query.organizationId, conversation.id, query.profileId), assignee: conversation.assigneeProfileId ? profiles.get(conversation.assigneeProfileId) || null : null };
    }).filter((item): item is ConversationListItem => Boolean(item));
    return { items, total: count || 0, page: query.page, pageSize: query.pageSize };
  }

  async getConversation(organizationId: string, conversationId: string, profileId: string): Promise<ConversationDetail | null> {
    const { data: conversationRow, error } = await this.client.from("conversations").select("*").eq("organization_id", organizationId).eq("id", conversationId).maybeSingle();
    if (error || !conversationRow) return null;
    const conversation = mapConversation(conversationRow as Row);
    const [contactResponse, messageResponse, noteResponse, profiles] = await Promise.all([
      this.client.from("contacts").select("*").eq("organization_id", organizationId).eq("id", conversation.contactId).single(),
      this.client.from("messages").select("*").eq("organization_id", organizationId).eq("conversation_id", conversationId).order("line_event_timestamp", { ascending: true }).limit(200),
      this.client.from("conversation_notes").select("*").eq("organization_id", organizationId).eq("conversation_id", conversationId).is("deleted_at", null).order("created_at", { ascending: true }),
      this.profileMap()
    ]);
    if (!contactResponse.data) return null;
    const contact = mapContact(contactResponse.data as Row);
    return { conversation, contact, readState: await this.readState(conversationId, profileId), assignee: conversation.assigneeProfileId ? profiles.get(conversation.assigneeProfileId) || null : null, messages: ((messageResponse.data || []) as Row[]).map(mapMessage), notes: ((noteResponse.data || []) as Row[]).map((row) => mapNote(row, profiles)) };
  }

  async markConversationRead(organizationId: string, conversationId: string, profileId: string, lastMessageId?: string | null): Promise<ConversationReadState> {
    const { data, error } = await this.client.from("conversation_read_states").upsert({ organization_id: organizationId, conversation_id: conversationId, profile_id: profileId, unread_count: 0, last_read_at: new Date().toISOString(), last_read_message_id: lastMessageId || null }, { onConflict: "organization_id,conversation_id,profile_id" }).select("*").single();
    if (error) throw new Error("確認状態を更新できませんでした。");
    return mapReadState(data as Row, organizationId, conversationId, profileId);
  }

  async updateConversation(organizationId: string, conversationId: string, _profileId: string, _role: InboxRole, update: ConversationUpdate): Promise<ConversationRecord> {
    const payload: Row = { updated_at: new Date().toISOString() };
    if (update.status) { payload.status = update.status; payload.closed_at = update.status === "closed" ? new Date().toISOString() : null; }
    if (update.priority) payload.priority = update.priority;
    if (update.assigneeProfileId !== undefined) payload.assignee_profile_id = update.assigneeProfileId;
    const { data, error } = await this.client.from("conversations").update(payload).eq("organization_id", organizationId).eq("id", conversationId).select("*").single();
    if (error) throw new Error("会話を更新できませんでした。");
    return mapConversation(data as Row);
  }

  async addNote(organizationId: string, conversationId: string, profileId: string, _role: InboxRole, body: string): Promise<ConversationNote> {
    const { data, error } = await this.client.from("conversation_notes").insert({ organization_id: organizationId, conversation_id: conversationId, body: body.trim(), created_by_profile_id: profileId, updated_by_profile_id: profileId }).select("*").single();
    if (error) throw new Error("内部メモを作成できませんでした。");
    const profiles = await this.profileMap();
    return mapNote(data as Row, profiles);
  }

  async updateNote(organizationId: string, noteId: string, profileId: string, _role: InboxRole, body: string): Promise<ConversationNote> {
    const { data, error } = await this.client.from("conversation_notes").update({ body: body.trim(), updated_by_profile_id: profileId, updated_at: new Date().toISOString() }).eq("organization_id", organizationId).eq("id", noteId).select("*").single();
    if (error) throw new Error("内部メモを更新できませんでした。");
    return mapNote(data as Row, await this.profileMap());
  }

  async deleteNote(organizationId: string, noteId: string, _profileId: string, _role: InboxRole): Promise<void> {
    const { error } = await this.client.from("conversation_notes").update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("organization_id", organizationId).eq("id", noteId);
    if (error) throw new Error("内部メモを削除できませんでした。");
  }

  async listQuickReplies(organizationId: string, includeInactive = false): Promise<QuickReplyTemplate[]> {
    let request = this.client.from("quick_reply_templates").select("*").eq("organization_id", organizationId).order("sort_order", { ascending: true });
    if (!includeInactive) request = request.eq("is_active", true);
    const { data, error } = await request;
    if (error) throw new Error("クイック返信を取得できませんでした。");
    return ((data || []) as Row[]).map(mapQuick);
  }

  async createQuickReply(organizationId: string, profileId: string, name: string, textContent: string, sortOrder: number): Promise<QuickReplyTemplate> {
    const { data, error } = await this.client.from("quick_reply_templates").insert({ organization_id: organizationId, name, text_content: textContent, sort_order: sortOrder, created_by_profile_id: profileId }).select("*").single();
    if (error) throw new Error("クイック返信を作成できませんでした。");
    return mapQuick(data as Row);
  }

  async updateQuickReply(organizationId: string, id: string, name: string, textContent: string, sortOrder: number, isActive: boolean): Promise<QuickReplyTemplate> {
    const { data, error } = await this.client.from("quick_reply_templates").update({ name, text_content: textContent, sort_order: sortOrder, is_active: isActive, updated_at: new Date().toISOString() }).eq("organization_id", organizationId).eq("id", id).select("*").single();
    if (error) throw new Error("クイック返信を更新できませんでした。");
    return mapQuick(data as Row);
  }

  async deleteQuickReply(organizationId: string, id: string): Promise<void> {
    const { error } = await this.client.from("quick_reply_templates").delete().eq("organization_id", organizationId).eq("id", id);
    if (error) throw new Error("クイック返信を削除できませんでした。");
  }

  async listProfiles(organizationId: string): Promise<ProfileSummary[]> {
    const { data, error } = await this.client.from("organization_members").select("role, profiles(id, email, display_name)").eq("organization_id", organizationId);
    if (error) throw new Error("担当者を取得できませんでした。");
    return ((data || []) as Row[]).flatMap((row) => { const profile = Array.isArray(row.profiles) ? row.profiles[0] as Row | undefined : row.profiles as Row | undefined; return profile ? [mapProfile(profile, String(row.role))] : []; });
  }

  async findOutboundByClientRequest(organizationId: string, clientRequestId: string): Promise<MessageRecord | null> {
    const { data } = await this.client.from("messages").select("*").eq("organization_id", organizationId).eq("client_request_id", clientRequestId).maybeSingle();
    return data ? mapMessage(data as Row) : null;
  }

  async createOutboundMessage(input: OutboundCreateInput): Promise<{ created: boolean; message: MessageRecord }> {
    const { data, error } = await this.client.rpc("create_outbound_line_message", { target_organization_id: input.organizationId, target_conversation_id: input.conversationId, target_contact_id: input.contactId, target_text_content: input.textContent, target_client_request_id: input.clientRequestId, target_retry_key: input.retryKey, target_sent_by_profile_id: input.sentByProfileId });
    if (error) throw new Error("送信メッセージを作成できませんでした。");
    const row = (Array.isArray(data) ? data[0] : data) as Row;
    const { data: message, error: messageError } = await this.client.from("messages").select("*").eq("organization_id", input.organizationId).eq("id", row.message_id).single();
    if (messageError || !message) throw new Error("送信メッセージを取得できませんでした。");
    return { created: Boolean(row.created), message: mapMessage(message as Row) };
  }

  async claimOutboundMessage(organizationId: string, messageId: string, profileId: string): Promise<MessageRecord> {
    const { error } = await this.client.rpc("claim_outbound_line_message", { target_organization_id: organizationId, target_message_id: messageId, target_profile_id: profileId });
    if (error) throw new Error("送信処理を開始できませんでした。");
    const { data } = await this.client.from("messages").select("*").eq("organization_id", organizationId).eq("id", messageId).single();
    if (!data) throw new Error("送信メッセージが見つかりません。");
    return mapMessage(data as Row);
  }

  async updateOutboundMessage(organizationId: string, messageId: string, update: OutboundSendUpdate): Promise<MessageRecord> {
    const { error } = await this.client.rpc("update_outbound_line_message", { target_organization_id: organizationId, target_message_id: messageId, target_status: update.status, target_line_request_id: update.lineRequestId || null, target_line_accepted_request_id: update.lineAcceptedRequestId || null, target_line_sent_message_id: update.lineSentMessageId || null, target_error_class: update.errorClass || null, target_error_code: update.errorCode || null, target_error_message_safe: update.errorMessageSafe || null, target_accepted_at: update.acceptedAt || null, target_failed_at: update.failedAt || null, target_cancelled_at: update.cancelledAt || null });
    if (error) throw new Error("送信結果を保存できませんでした。");
    const { data } = await this.client.from("messages").select("*").eq("organization_id", organizationId).eq("id", messageId).single();
    if (!data) throw new Error("送信メッセージが見つかりません。");
    return mapMessage(data as Row);
  }

  async recordOutboundAttempt(input: { organizationId: string; messageId: string; attemptNumber: number; httpStatus?: number | null; lineRequestId?: string | null; lineAcceptedRequestId?: string | null; errorClass?: string | null; errorMessageSafe?: string | null }): Promise<void> {
    await this.client.from("outbound_message_attempts").insert({ organization_id: input.organizationId, message_id: input.messageId, attempt_number: input.attemptNumber, http_status: input.httpStatus || null, line_request_id: input.lineRequestId || null, line_accepted_request_id: input.lineAcceptedRequestId || null, error_class: input.errorClass || null, error_message_safe: input.errorMessageSafe || null, completed_at: new Date().toISOString() });
  }

  async recordAudit(input: { organizationId: string; actorProfileId: string; action: string; resourceType: string; resourceId?: string | null; metadata?: Record<string, unknown> }): Promise<void> {
    const { error } = await this.client.rpc("record_inbox_audit", { target_organization_id: input.organizationId, target_actor_profile_id: input.actorProfileId, target_action: input.action, target_resource_type: input.resourceType, target_resource_id: input.resourceId || null, target_metadata_json: input.metadata || {} });
    if (error) throw new Error("監査ログを保存できませんでした。");
  }

  async ensureConversationForContact(organizationId: string, contactId: string, _eventAt: string, _message?: MessageRecord): Promise<ConversationRecord> {
    const { data, error } = await this.client.rpc("ensure_conversation_for_contact", { target_organization_id: organizationId, target_contact_id: contactId, target_event_at: new Date().toISOString() });
    if (error) throw new Error("会話を作成できませんでした。");
    const { data: row } = await this.client.from("conversations").select("*").eq("organization_id", organizationId).eq("id", data as string).single();
    if (!row) throw new Error("会話を取得できませんでした。");
    return mapConversation(row as Row);
  }

  async incrementUnreadForInbound(_organizationId: string, _conversationId: string, _messageId: string): Promise<void> {
    // insert_inbound_line_message performs this in the same database transaction.
  }

  async recalculateConversationPreview(organizationId: string, conversationId: string): Promise<void> {
    const { error } = await this.client.rpc("refresh_conversation_preview", { target_organization_id: organizationId, target_conversation_id: conversationId });
    if (error) throw new Error("会話previewを更新できませんでした。");
  }
}
