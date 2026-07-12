import type { ContactRecord, MessageRecord } from "@/lib/webhook/store";

export type ConversationStatus = "open" | "pending" | "closed";
export type ConversationPriority = "normal" | "high";
export type InboxFilter = "all" | "unread" | "mine" | "unassigned" | "open" | "pending" | "closed" | "blocked" | "high";
export type InboxRole = "viewer" | "operator" | "admin" | "owner";

export type ProfileSummary = {
  id: string;
  displayName: string;
  email: string;
  role: InboxRole;
};

export type ConversationRecord = {
  id: string;
  organizationId: string;
  contactId: string;
  status: ConversationStatus;
  assigneeProfileId: string | null;
  priority: ConversationPriority;
  lastMessageAt: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  lastMessagePreview: string | null;
  lastMessageDirection: "inbound" | "outbound" | null;
  reopenedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ConversationReadState = {
  id: string;
  organizationId: string;
  conversationId: string;
  profileId: string;
  unreadCount: number;
  lastReadAt: string | null;
  lastReadMessageId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ConversationListItem = {
  conversation: ConversationRecord;
  contact: ContactRecord;
  readState: ConversationReadState;
  assignee: ProfileSummary | null;
};

export type ConversationDetail = ConversationListItem & {
  messages: MessageRecord[];
  notes: ConversationNote[];
};

export type ConversationNote = {
  id: string;
  organizationId: string;
  conversationId: string;
  body: string;
  createdByProfileId: string;
  updatedByProfileId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  author: ProfileSummary | null;
};

export type QuickReplyTemplate = {
  id: string;
  organizationId: string;
  name: string;
  textContent: string;
  sortOrder: number;
  isActive: boolean;
  createdByProfileId: string;
  createdAt: string;
  updatedAt: string;
};

export type ConversationListQuery = {
  organizationId: string;
  profileId: string;
  filter: InboxFilter;
  search?: string;
  page: number;
  pageSize: number;
  ownerSearchLineUserId?: string;
};

export type ConversationUpdate = {
  status?: ConversationStatus;
  assigneeProfileId?: string | null;
  priority?: ConversationPriority;
};

export type OutboundCreateInput = {
  organizationId: string;
  conversationId: string;
  contactId: string;
  textContent: string;
  clientRequestId: string;
  retryKey: string;
  sentByProfileId: string;
};

export type OutboundSendUpdate = {
  status: "sending" | "accepted" | "retryable_failed" | "permanently_failed" | "cancelled";
  lineRequestId?: string | null;
  lineAcceptedRequestId?: string | null;
  lineSentMessageId?: string | null;
  errorClass?: string | null;
  errorCode?: string | null;
  errorMessageSafe?: string | null;
  acceptedAt?: string | null;
  failedAt?: string | null;
  cancelledAt?: string | null;
  attemptCount?: number;
};

export type InboxStore = {
  listConversations(query: ConversationListQuery): Promise<{ items: ConversationListItem[]; total: number; page: number; pageSize: number }>;
  getConversation(organizationId: string, conversationId: string, profileId: string): Promise<ConversationDetail | null>;
  markConversationRead(organizationId: string, conversationId: string, profileId: string, lastMessageId?: string | null): Promise<ConversationReadState>;
  updateConversation(organizationId: string, conversationId: string, profileId: string, role: InboxRole, update: ConversationUpdate): Promise<ConversationRecord>;
  addNote(organizationId: string, conversationId: string, profileId: string, role: InboxRole, body: string): Promise<ConversationNote>;
  updateNote(organizationId: string, noteId: string, profileId: string, role: InboxRole, body: string): Promise<ConversationNote>;
  deleteNote(organizationId: string, noteId: string, profileId: string, role: InboxRole): Promise<void>;
  listQuickReplies(organizationId: string, includeInactive?: boolean): Promise<QuickReplyTemplate[]>;
  createQuickReply(organizationId: string, profileId: string, name: string, textContent: string, sortOrder: number): Promise<QuickReplyTemplate>;
  updateQuickReply(organizationId: string, id: string, name: string, textContent: string, sortOrder: number, isActive: boolean): Promise<QuickReplyTemplate>;
  deleteQuickReply(organizationId: string, id: string): Promise<void>;
  listProfiles(organizationId: string): Promise<ProfileSummary[]>;
  findOutboundByClientRequest(organizationId: string, clientRequestId: string): Promise<MessageRecord | null>;
  createOutboundMessage(input: OutboundCreateInput): Promise<{ created: boolean; message: MessageRecord }>;
  claimOutboundMessage(organizationId: string, messageId: string, profileId: string): Promise<MessageRecord>;
  updateOutboundMessage(organizationId: string, messageId: string, update: OutboundSendUpdate): Promise<MessageRecord>;
  recordOutboundAttempt(input: { organizationId: string; messageId: string; attemptNumber: number; httpStatus?: number | null; lineRequestId?: string | null; lineAcceptedRequestId?: string | null; errorClass?: string | null; errorMessageSafe?: string | null }): Promise<void>;
  recordAudit(input: { organizationId: string; actorProfileId: string; action: string; resourceType: string; resourceId?: string | null; metadata?: Record<string, unknown> }): Promise<void>;
  ensureConversationForContact(organizationId: string, contactId: string, eventAt: string, message?: MessageRecord): Promise<ConversationRecord>;
  incrementUnreadForInbound(organizationId: string, conversationId: string, messageId: string): Promise<void>;
  recalculateConversationPreview(organizationId: string, conversationId: string): Promise<void>;
};
