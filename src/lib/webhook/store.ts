import { randomUUID } from "node:crypto";
import type {
  ConversationDetail,
  ConversationListItem,
  ConversationListQuery,
  ConversationNote,
  ConversationReadState,
  ConversationRecord,
  ConversationUpdate,
  InboxRole,
  InboxStore,
  OutboundCreateInput,
  OutboundSendUpdate,
  ProfileSummary,
  QuickReplyTemplate
} from "@/lib/inbox/types";

export type FriendStatus = "following" | "blocked" | "unknown";
export type WebhookStatus = "processing" | "processed" | "ignored" | "failed";

export type ContactRecord = {
  id: string;
  organizationId: string;
  lineUserId: string;
  displayName: string | null;
  pictureUrl: string | null;
  statusMessage: string | null;
  language: string | null;
  friendStatus: FriendStatus;
  followedAt: string | null;
  unfollowedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  lastMessageAt: string | null;
  lastLineEventAt: string;
  createdAt: string;
  updatedAt: string;
};

export type MessageRecord = {
  id: string;
  organizationId: string;
  contactId: string;
  direction: "inbound" | "outbound";
  source: "line";
  lineMessageId: string | null;
  lineRequestId: string | null;
  messageType: string;
  textContent: string | null;
  payloadJson: Record<string, unknown>;
  status: "received" | "deleted" | "queued" | "sending" | "accepted" | "retryable_failed" | "permanently_failed" | "cancelled";
  conversationId: string | null;
  clientRequestId: string | null;
  retryKey: string | null;
  lineAcceptedRequestId: string | null;
  lineSentMessageId: string | null;
  sentByProfileId: string | null;
  attemptCount: number;
  errorClass: string | null;
  errorCode: string | null;
  errorMessageSafe: string | null;
  acceptedAt: string | null;
  failedAt: string | null;
  cancelledAt: string | null;
  lineEventTimestamp: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ContactListResult = {
  items: ContactRecord[];
  total: number;
  page: number;
  pageSize: number;
};

export type WebhookMetrics = {
  lastWebhookAt: string | null;
  lastProcessedAt: string | null;
  failedCount: number;
  signatureErrorCount: number;
};

export type ClaimInput = {
  organizationId: string;
  webhookEventId: string;
  eventType: string;
  lineUserId: string | null;
  lineMessageId: string | null;
  eventTimestamp: string;
  isRedelivery: boolean;
  payloadRedactedJson: Record<string, unknown>;
};

export type ApplyContactInput = {
  organizationId: string;
  lineUserId: string;
  eventType: "follow" | "unfollow" | "message";
  eventAt: string;
  displayName?: string;
  pictureUrl?: string;
  statusMessage?: string;
  language?: string;
};

export type InboundMessageInput = {
  organizationId: string;
  contactId: string;
  lineMessageId: string | null;
  lineRequestId: string;
  messageType: string;
  textContent: string | null;
  payloadJson: Record<string, unknown>;
  eventAt: string;
};

export type ClaimResult = {
  claimed: boolean;
  eventId: string;
};

export interface WebhookStore {
  claimEvent(input: ClaimInput): Promise<ClaimResult>;
  applyContact(input: ApplyContactInput): Promise<ContactRecord>;
  insertInboundMessage(input: InboundMessageInput): Promise<{ inserted: boolean; message?: MessageRecord }>;
  redactMessage(organizationId: string, lineMessageId: string): Promise<boolean>;
  completeEvent(eventId: string, status: "processed" | "ignored"): Promise<void>;
  failEvent(eventId: string, safeError: string): Promise<void>;
  recordSignatureError(): Promise<void>;
  listContacts(query: { search?: string; status?: FriendStatus; page: number; pageSize: number }): Promise<ContactListResult>;
  getContact(organizationId: string, contactId: string): Promise<ContactRecord | null>;
  listMessages(organizationId: string, contactId: string): Promise<MessageRecord[]>;
  getMetrics(): Promise<WebhookMetrics>;
  ensureConversationForContact?(organizationId: string, contactId: string, eventAt: string, message?: MessageRecord): Promise<ConversationRecord>;
  incrementUnreadForInbound?(organizationId: string, conversationId: string, messageId: string): Promise<void>;
  recalculateConversationPreview?(organizationId: string, conversationId: string): Promise<void>;
}

type MockWebhookEvent = ClaimInput & {
  id: string;
  status: WebhookStatus;
  processingStartedAt: string;
  processedAt: string | null;
  errorMessageSafe: string | null;
};

function isNewerOrEqual(eventAt: string, previousAt: string): boolean {
  return Date.parse(eventAt) >= Date.parse(previousAt);
}

export class MockWebhookStore implements WebhookStore, InboxStore {
  private readonly events = new Map<string, MockWebhookEvent>();
  private readonly contacts = new Map<string, ContactRecord>();
  private readonly messages = new Map<string, MessageRecord>();
  private readonly conversations = new Map<string, ConversationRecord>();
  private readonly readStates = new Map<string, ConversationReadState>();
  private readonly notes = new Map<string, ConversationNote>();
  private readonly quickReplies = new Map<string, QuickReplyTemplate>();
  private readonly unreadMessageIds = new Map<string, Set<string>>();
  private readonly profiles = new Map<string, ProfileSummary>([
    ["mock-user", { id: "mock-user", displayName: "LINE CRMオーナー", email: "owner@example.local", role: "owner" }]
  ]);
  private signatureErrorCount = 0;

  async claimEvent(input: ClaimInput): Promise<ClaimResult> {
    const key = `${input.organizationId}:${input.webhookEventId}`;
    const existing = this.events.get(key);
    if (existing) {
      const stale =
        existing.status === "processing" &&
        Date.now() - Date.parse(existing.processingStartedAt) > 5 * 60 * 1000;
      if (existing.status === "processed" || existing.status === "ignored") {
        return { claimed: false, eventId: existing.id };
      }
      if (existing.status === "processing" && !stale) {
        return { claimed: false, eventId: existing.id };
      }
      existing.status = "processing";
      existing.processingStartedAt = new Date().toISOString();
      existing.processedAt = null;
      existing.errorMessageSafe = null;
      return { claimed: true, eventId: existing.id };
    }

    const event: MockWebhookEvent = {
      ...input,
      id: `mock-event-${randomUUID()}`,
      status: "processing",
      processingStartedAt: new Date().toISOString(),
      processedAt: null,
      errorMessageSafe: null
    };
    this.events.set(key, event);
    return { claimed: true, eventId: event.id };
  }

  async applyContact(input: ApplyContactInput): Promise<ContactRecord> {
    const key = `${input.organizationId}:${input.lineUserId}`;
    const now = new Date().toISOString();
    const existing = this.contacts.get(key);
    if (!existing) {
      const contact: ContactRecord = {
        id: `mock-contact-${randomUUID()}`,
        organizationId: input.organizationId,
        lineUserId: input.lineUserId,
        displayName: input.displayName || null,
        pictureUrl: input.pictureUrl || null,
        statusMessage: input.statusMessage || null,
        language: input.language || null,
        friendStatus: input.eventType === "follow" ? "following" : input.eventType === "unfollow" ? "blocked" : "unknown",
        followedAt: input.eventType === "follow" ? input.eventAt : null,
        unfollowedAt: input.eventType === "unfollow" ? input.eventAt : null,
        firstSeenAt: input.eventAt,
        lastSeenAt: input.eventAt,
        lastMessageAt: input.eventType === "message" ? input.eventAt : null,
        lastLineEventAt: input.eventAt,
        createdAt: now,
        updatedAt: now
      };
      this.contacts.set(key, contact);
      return contact;
    }

    const isCurrent = isNewerOrEqual(input.eventAt, existing.lastLineEventAt);
    existing.firstSeenAt = new Date(Math.min(Date.parse(existing.firstSeenAt), Date.parse(input.eventAt))).toISOString();
    existing.lastSeenAt = new Date(Math.max(Date.parse(existing.lastSeenAt), Date.parse(input.eventAt))).toISOString();
    if (input.eventType === "message") {
      existing.lastMessageAt = existing.lastMessageAt
        ? new Date(Math.max(Date.parse(existing.lastMessageAt), Date.parse(input.eventAt))).toISOString()
        : input.eventAt;
    }
    if (isCurrent) {
      existing.lastLineEventAt = input.eventAt;
      if (input.eventType === "follow") {
        existing.friendStatus = "following";
        existing.followedAt = input.eventAt;
        existing.unfollowedAt = null;
      } else if (input.eventType === "unfollow") {
        existing.friendStatus = "blocked";
        existing.unfollowedAt = input.eventAt;
      }
      existing.displayName = input.displayName ?? existing.displayName;
      existing.pictureUrl = input.pictureUrl ?? existing.pictureUrl;
      existing.statusMessage = input.statusMessage ?? existing.statusMessage;
      existing.language = input.language ?? existing.language;
    }
    existing.updatedAt = now;
    return existing;
  }

  async insertInboundMessage(input: InboundMessageInput): Promise<{ inserted: boolean; message?: MessageRecord }> {
    const duplicate = input.lineMessageId
      ? [...this.messages.values()].find(
          (message) =>
            message.organizationId === input.organizationId && message.lineMessageId === input.lineMessageId
        )
      : undefined;
    if (duplicate) return { inserted: false, message: duplicate };

    const message: MessageRecord = {
      id: `mock-message-${randomUUID()}`,
      organizationId: input.organizationId,
      contactId: input.contactId,
      direction: "inbound",
      source: "line",
      lineMessageId: input.lineMessageId,
      lineRequestId: input.lineRequestId,
      messageType: input.messageType,
      textContent: input.textContent,
      payloadJson: input.payloadJson,
      status: "received",
      conversationId: null,
      clientRequestId: null,
      retryKey: null,
      lineAcceptedRequestId: null,
      lineSentMessageId: null,
      sentByProfileId: null,
      attemptCount: 0,
      errorClass: null,
      errorCode: null,
      errorMessageSafe: null,
      acceptedAt: null,
      failedAt: null,
      cancelledAt: null,
      lineEventTimestamp: input.eventAt,
      deletedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.messages.set(message.id, message);
    return { inserted: true, message };
  }

  async redactMessage(organizationId: string, lineMessageId: string): Promise<boolean> {
    const message = [...this.messages.values()].find(
      (candidate) => candidate.organizationId === organizationId && candidate.lineMessageId === lineMessageId
    );
    if (!message) return false;
    message.textContent = null;
    message.payloadJson = { deleted: true };
    message.status = "deleted";
    message.deletedAt = new Date().toISOString();
    message.updatedAt = message.deletedAt;
    return true;
  }

  async completeEvent(eventId: string, status: "processed" | "ignored"): Promise<void> {
    const event = [...this.events.values()].find((candidate) => candidate.id === eventId);
    if (!event) return;
    event.status = status;
    event.processedAt = new Date().toISOString();
  }

  async failEvent(eventId: string, safeError: string): Promise<void> {
    const event = [...this.events.values()].find((candidate) => candidate.id === eventId);
    if (!event) return;
    event.status = "failed";
    event.errorMessageSafe = safeError;
  }

  async recordSignatureError(): Promise<void> {
    this.signatureErrorCount += 1;
  }

  async listContacts(query: { search?: string; status?: FriendStatus; page: number; pageSize: number }): Promise<ContactListResult> {
    const search = query.search?.toLowerCase().trim();
    const filtered = [...this.contacts.values()]
      .filter((contact) => !query.status || contact.friendStatus === query.status)
      .filter((contact) => !search || contact.displayName?.toLowerCase().includes(search));
    const start = (query.page - 1) * query.pageSize;
    return { items: filtered.slice(start, start + query.pageSize), total: filtered.length, page: query.page, pageSize: query.pageSize };
  }

  async getContact(organizationId: string, contactId: string): Promise<ContactRecord | null> {
    return [...this.contacts.values()].find((contact) => contact.organizationId === organizationId && contact.id === contactId) || null;
  }

  async listMessages(organizationId: string, contactId: string): Promise<MessageRecord[]> {
    return [...this.messages.values()]
      .filter((message) => message.organizationId === organizationId && message.contactId === contactId)
      .sort((a, b) => Date.parse(b.lineEventTimestamp) - Date.parse(a.lineEventTimestamp))
      .slice(0, 50);
  }

  async getMetrics(): Promise<WebhookMetrics> {
    const events = [...this.events.values()];
    return {
      lastWebhookAt: events.length ? events.map((event) => event.eventTimestamp).sort().at(-1) || null : null,
      lastProcessedAt: events.map((event) => event.processedAt).filter((value): value is string => Boolean(value)).sort().at(-1) || null,
      failedCount: events.filter((event) => event.status === "failed").length,
      signatureErrorCount: this.signatureErrorCount
    };
  }

  private conversationKey(organizationId: string, contactId: string): string {
    return `${organizationId}:${contactId}`;
  }

  private readStateFor(organizationId: string, conversationId: string, profileId: string): ConversationReadState {
    const key = `${organizationId}:${conversationId}:${profileId}`;
    const existing = this.readStates.get(key);
    if (existing) return existing;
    const now = new Date().toISOString();
    const state: ConversationReadState = {
      id: `mock-read-${randomUUID()}`,
      organizationId,
      conversationId,
      profileId,
      unreadCount: 0,
      lastReadAt: null,
      lastReadMessageId: null,
      createdAt: now,
      updatedAt: now
    };
    this.readStates.set(key, state);
    return state;
  }

  private profile(profileId: string): ProfileSummary | null {
    return this.profiles.get(profileId) || null;
  }

  private preview(message: MessageRecord): string {
    if (message.status === "deleted") return "（メッセージが送信取消されました）";
    if (message.messageType !== "text") return `（${message.messageType}）`;
    return (message.textContent || "").slice(0, 200);
  }

  async ensureConversationForContact(organizationId: string, contactId: string, eventAt: string, message?: MessageRecord): Promise<ConversationRecord> {
    const key = this.conversationKey(organizationId, contactId);
    const existing = this.conversations.get(key);
    const now = new Date().toISOString();
    if (!existing) {
      const conversation: ConversationRecord = {
        id: `mock-conversation-${randomUUID()}`,
        organizationId,
        contactId,
        status: "open",
        assigneeProfileId: null,
        priority: "normal",
        lastMessageAt: message?.lineEventTimestamp || null,
        lastInboundAt: message?.direction === "inbound" ? message.lineEventTimestamp : null,
        lastOutboundAt: message?.direction === "outbound" ? message.lineEventTimestamp : null,
        lastMessagePreview: message ? this.preview(message) : null,
        lastMessageDirection: message?.direction || null,
        reopenedAt: null,
        closedAt: null,
        createdAt: now,
        updatedAt: now
      };
      this.conversations.set(key, conversation);
      if (message) message.conversationId = conversation.id;
      this.readStateFor(organizationId, conversation.id, "mock-user");
      return conversation;
    }
    if (message) {
      message.conversationId = existing.id;
      const current = existing.lastMessageAt ? Date.parse(existing.lastMessageAt) : 0;
      if (Date.parse(message.lineEventTimestamp) >= current) {
        if (existing.status === "closed" && message.direction === "inbound") {
          existing.status = "open";
          existing.reopenedAt = eventAt;
          existing.closedAt = null;
        }
        existing.lastMessageAt = message.lineEventTimestamp;
        existing.lastMessagePreview = this.preview(message);
        existing.lastMessageDirection = message.direction;
      }
      if (message.direction === "inbound") existing.lastInboundAt = existing.lastInboundAt && Date.parse(existing.lastInboundAt) > Date.parse(message.lineEventTimestamp) ? existing.lastInboundAt : message.lineEventTimestamp;
      if (message.direction === "outbound") existing.lastOutboundAt = existing.lastOutboundAt && Date.parse(existing.lastOutboundAt) > Date.parse(message.lineEventTimestamp) ? existing.lastOutboundAt : message.lineEventTimestamp;
      existing.updatedAt = now;
    }
    return existing;
  }

  async incrementUnreadForInbound(organizationId: string, conversationId: string, messageId: string): Promise<void> {
    const seen = this.unreadMessageIds.get(`${organizationId}:${conversationId}`) || new Set<string>();
    if (seen.has(messageId)) return;
    seen.add(messageId);
    this.unreadMessageIds.set(`${organizationId}:${conversationId}`, seen);
    for (const profile of this.profiles.values()) {
      const state = this.readStateFor(organizationId, conversationId, profile.id);
      state.unreadCount += 1;
      state.updatedAt = new Date().toISOString();
    }
  }

  async recalculateConversationPreview(organizationId: string, conversationId: string): Promise<void> {
    const conversation = [...this.conversations.values()].find((item) => item.organizationId === organizationId && item.id === conversationId);
    if (!conversation) return;
    const messages = [...this.messages.values()]
      .filter((message) => message.organizationId === organizationId && message.conversationId === conversationId)
      .sort((a, b) => Date.parse(b.lineEventTimestamp) - Date.parse(a.lineEventTimestamp));
    const latest = messages[0];
    conversation.lastMessageAt = latest?.lineEventTimestamp || null;
    conversation.lastMessagePreview = latest ? this.preview(latest) : null;
    conversation.lastMessageDirection = latest?.direction || null;
    conversation.lastInboundAt = messages.find((message) => message.direction === "inbound")?.lineEventTimestamp || null;
    conversation.lastOutboundAt = messages.find((message) => message.direction === "outbound")?.lineEventTimestamp || null;
    conversation.updatedAt = new Date().toISOString();
  }

  async listConversations(query: ConversationListQuery): Promise<{ items: ConversationListItem[]; total: number; page: number; pageSize: number }> {
    const search = query.search?.trim().toLowerCase();
    const items = [...this.conversations.values()]
      .filter((conversation) => conversation.organizationId === query.organizationId)
      .map((conversation) => {
        const contact = [...this.contacts.values()].find((item) => item.id === conversation.contactId);
        const state = this.readStateFor(query.organizationId, conversation.id, query.profileId);
        return contact ? { conversation, contact, readState: state, assignee: conversation.assigneeProfileId ? this.profile(conversation.assigneeProfileId) : null } : null;
      })
      .filter((item): item is ConversationListItem => Boolean(item))
      .filter((item) => {
        if (query.filter === "unread" && item.readState.unreadCount === 0) return false;
        if (query.filter === "mine" && item.conversation.assigneeProfileId !== query.profileId) return false;
        if (query.filter === "unassigned" && item.conversation.assigneeProfileId) return false;
        if (["open", "pending", "closed"].includes(query.filter) && item.conversation.status !== query.filter) return false;
        if (query.filter === "blocked" && item.contact.friendStatus !== "blocked") return false;
        if (query.filter === "high" && item.conversation.priority !== "high") return false;
        if (search && !`${item.contact.displayName || ""} ${item.contact.id}`.toLowerCase().includes(search)) return false;
        if (query.ownerSearchLineUserId && item.contact.lineUserId !== query.ownerSearchLineUserId) return false;
        return true;
      })
      .sort((a, b) => Date.parse(b.conversation.lastMessageAt || b.conversation.updatedAt) - Date.parse(a.conversation.lastMessageAt || a.conversation.updatedAt));
    const start = (query.page - 1) * query.pageSize;
    return { items: items.slice(start, start + query.pageSize), total: items.length, page: query.page, pageSize: query.pageSize };
  }

  async getConversation(organizationId: string, conversationId: string, profileId: string): Promise<ConversationDetail | null> {
    const conversation = [...this.conversations.values()].find((item) => item.organizationId === organizationId && item.id === conversationId);
    if (!conversation) return null;
    const contact = [...this.contacts.values()].find((item) => item.id === conversation.contactId);
    if (!contact) return null;
    const messages = [...this.messages.values()].filter((message) => message.organizationId === organizationId && message.conversationId === conversationId).sort((a, b) => Date.parse(a.lineEventTimestamp) - Date.parse(b.lineEventTimestamp));
    const notes = [...this.notes.values()].filter((note) => note.organizationId === organizationId && note.conversationId === conversationId && !note.deletedAt).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    return { conversation, contact, readState: this.readStateFor(organizationId, conversationId, profileId), assignee: conversation.assigneeProfileId ? this.profile(conversation.assigneeProfileId) : null, messages, notes };
  }

  async markConversationRead(organizationId: string, conversationId: string, profileId: string, lastMessageId?: string | null): Promise<ConversationReadState> {
    const state = this.readStateFor(organizationId, conversationId, profileId);
    state.unreadCount = 0;
    state.lastReadAt = new Date().toISOString();
    state.lastReadMessageId = lastMessageId || null;
    state.updatedAt = state.lastReadAt;
    return state;
  }

  async updateConversation(organizationId: string, conversationId: string, profileId: string, role: InboxRole, update: ConversationUpdate): Promise<ConversationRecord> {
    const conversation = [...this.conversations.values()].find((item) => item.organizationId === organizationId && item.id === conversationId);
    if (!conversation) throw new Error("会話が見つかりません。");
    if (role === "viewer") throw new Error("権限がありません。");
    if (update.assigneeProfileId !== undefined && role !== "admin" && role !== "owner" && update.assigneeProfileId !== null && update.assigneeProfileId !== profileId) throw new Error("担当者を変更できません。");
    if (update.assigneeProfileId && !this.profile(update.assigneeProfileId)) throw new Error("担当者が見つかりません。");
    if (update.status) {
      conversation.status = update.status;
      conversation.closedAt = update.status === "closed" ? new Date().toISOString() : null;
    }
    if (update.priority) conversation.priority = update.priority;
    if (update.assigneeProfileId !== undefined) conversation.assigneeProfileId = update.assigneeProfileId;
    conversation.updatedAt = new Date().toISOString();
    return conversation;
  }

  async addNote(organizationId: string, conversationId: string, profileId: string, role: InboxRole, body: string): Promise<ConversationNote> {
    if (role === "viewer") throw new Error("メモを作成できる権限がありません。");
    const trimmed = body.trim();
    if (!trimmed || trimmed.length > 5000) throw new Error("メモは1文字以上5000文字以内で入力してください。");
    const now = new Date().toISOString();
    const note: ConversationNote = { id: `mock-note-${randomUUID()}`, organizationId, conversationId, body: trimmed, createdByProfileId: profileId, updatedByProfileId: profileId, createdAt: now, updatedAt: now, deletedAt: null, author: this.profile(profileId) };
    this.notes.set(note.id, note);
    return note;
  }

  async updateNote(organizationId: string, noteId: string, profileId: string, role: InboxRole, body: string): Promise<ConversationNote> {
    const note = this.notes.get(noteId);
    if (!note || note.organizationId !== organizationId || note.deletedAt) throw new Error("メモが見つかりません。");
    if (role !== "admin" && role !== "owner" && note.createdByProfileId !== profileId) throw new Error("メモを編集できません。");
    const trimmed = body.trim();
    if (!trimmed || trimmed.length > 5000) throw new Error("メモは1文字以上5000文字以内で入力してください。");
    note.body = trimmed;
    note.updatedByProfileId = profileId;
    note.updatedAt = new Date().toISOString();
    return note;
  }

  async deleteNote(organizationId: string, noteId: string, profileId: string, role: InboxRole): Promise<void> {
    const note = this.notes.get(noteId);
    if (!note || note.organizationId !== organizationId || note.deletedAt) throw new Error("メモが見つかりません。");
    if (role !== "admin" && role !== "owner" && note.createdByProfileId !== profileId) throw new Error("メモを削除できません。");
    note.deletedAt = new Date().toISOString();
    note.updatedAt = note.deletedAt;
  }

  async listQuickReplies(organizationId: string, includeInactive = false): Promise<QuickReplyTemplate[]> {
    return [...this.quickReplies.values()].filter((item) => item.organizationId === organizationId && (includeInactive || item.isActive)).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }

  async createQuickReply(organizationId: string, profileId: string, name: string, textContent: string, sortOrder: number): Promise<QuickReplyTemplate> {
    if ([...this.quickReplies.values()].some((item) => item.organizationId === organizationId && item.name === name)) throw new Error("同じ名前のクイック返信が存在します。");
    const now = new Date().toISOString();
    const item: QuickReplyTemplate = { id: `mock-quick-${randomUUID()}`, organizationId, name, textContent, sortOrder, isActive: true, createdByProfileId: profileId, createdAt: now, updatedAt: now };
    this.quickReplies.set(item.id, item);
    return item;
  }

  async updateQuickReply(organizationId: string, id: string, name: string, textContent: string, sortOrder: number, isActive: boolean): Promise<QuickReplyTemplate> {
    const item = this.quickReplies.get(id);
    if (!item || item.organizationId !== organizationId) throw new Error("クイック返信が見つかりません。");
    if ([...this.quickReplies.values()].some((other) => other.id !== id && other.organizationId === organizationId && other.name === name)) throw new Error("同じ名前のクイック返信が存在します。");
    item.name = name; item.textContent = textContent; item.sortOrder = sortOrder; item.isActive = isActive; item.updatedAt = new Date().toISOString();
    return item;
  }

  async deleteQuickReply(organizationId: string, id: string): Promise<void> {
    const item = this.quickReplies.get(id);
    if (!item || item.organizationId !== organizationId) throw new Error("クイック返信が見つかりません。");
    this.quickReplies.delete(id);
  }

  async listProfiles(_organizationId: string): Promise<ProfileSummary[]> {
    return [...this.profiles.values()];
  }

  async findOutboundByClientRequest(organizationId: string, clientRequestId: string): Promise<MessageRecord | null> {
    return [...this.messages.values()].find((message) => message.organizationId === organizationId && message.clientRequestId === clientRequestId) || null;
  }

  async createOutboundMessage(input: OutboundCreateInput): Promise<{ created: boolean; message: MessageRecord }> {
    const existing = await this.findOutboundByClientRequest(input.organizationId, input.clientRequestId);
    if (existing) return { created: false, message: existing };
    if ([...this.messages.values()].some((message) => message.organizationId === input.organizationId && message.retryKey === input.retryKey)) throw new Error("Retry Keyが既に使用されています。");
    const now = new Date().toISOString();
    const message: MessageRecord = { id: `mock-message-${randomUUID()}`, organizationId: input.organizationId, contactId: input.contactId, direction: "outbound", source: "line", lineMessageId: null, lineRequestId: null, messageType: "text", textContent: input.textContent, payloadJson: { type: "text" }, status: "queued", conversationId: input.conversationId, clientRequestId: input.clientRequestId, retryKey: input.retryKey, lineAcceptedRequestId: null, lineSentMessageId: null, sentByProfileId: input.sentByProfileId, attemptCount: 0, errorClass: null, errorCode: null, errorMessageSafe: null, acceptedAt: null, failedAt: null, cancelledAt: null, lineEventTimestamp: now, deletedAt: null, createdAt: now, updatedAt: now };
    this.messages.set(message.id, message);
    return { created: true, message };
  }

  async claimOutboundMessage(organizationId: string, messageId: string, profileId: string): Promise<MessageRecord> {
    const message = this.messages.get(messageId);
    if (!message || message.organizationId !== organizationId || message.direction !== "outbound") throw new Error("送信メッセージが見つかりません。");
    if (message.sentByProfileId !== profileId) throw new Error("送信者が一致しません。");
    if (message.status !== "queued" && message.status !== "retryable_failed") throw new Error("このメッセージは再送できません。");
    message.status = "sending";
    message.attemptCount += 1;
    message.updatedAt = new Date().toISOString();
    return message;
  }

  async updateOutboundMessage(organizationId: string, messageId: string, update: OutboundSendUpdate): Promise<MessageRecord> {
    const message = this.messages.get(messageId);
    if (!message || message.organizationId !== organizationId) throw new Error("送信メッセージが見つかりません。");
    message.status = update.status;
    if (update.lineRequestId !== undefined) message.lineRequestId = update.lineRequestId;
    if (update.lineAcceptedRequestId !== undefined) message.lineAcceptedRequestId = update.lineAcceptedRequestId;
    if (update.lineSentMessageId !== undefined) message.lineSentMessageId = update.lineSentMessageId;
    if (update.errorClass !== undefined) message.errorClass = update.errorClass;
    if (update.errorCode !== undefined) message.errorCode = update.errorCode;
    if (update.errorMessageSafe !== undefined) message.errorMessageSafe = update.errorMessageSafe;
    if (update.attemptCount !== undefined) message.attemptCount = update.attemptCount;
    const now = new Date().toISOString();
    if (update.acceptedAt !== undefined) message.acceptedAt = update.acceptedAt;
    if (update.failedAt !== undefined) message.failedAt = update.failedAt;
    if (update.cancelledAt !== undefined) message.cancelledAt = update.cancelledAt;
    message.updatedAt = now;
    if (update.status === "accepted") await this.ensureConversationForContact(organizationId, message.contactId, message.lineEventTimestamp, message);
    return message;
  }

  async recordOutboundAttempt(_input: { organizationId: string; messageId: string; attemptNumber: number; httpStatus?: number | null; lineRequestId?: string | null; lineAcceptedRequestId?: string | null; errorClass?: string | null; errorMessageSafe?: string | null }): Promise<void> {
    return;
  }

  async recordAudit(_input: { organizationId: string; actorProfileId: string; action: string; resourceType: string; resourceId?: string | null; metadata?: Record<string, unknown> }): Promise<void> {
    return;
  }
}

const globalStore = globalThis as typeof globalThis & { __lineCrmMockWebhookStore?: MockWebhookStore };

export function getMockWebhookStore(): MockWebhookStore {
  globalStore.__lineCrmMockWebhookStore ??= new MockWebhookStore();
  return globalStore.__lineCrmMockWebhookStore;
}
