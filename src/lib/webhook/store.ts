import { randomUUID } from "node:crypto";

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
  direction: "inbound";
  source: "line";
  lineMessageId: string | null;
  lineRequestId: string | null;
  messageType: string;
  textContent: string | null;
  payloadJson: Record<string, unknown>;
  status: "received" | "deleted";
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

export class MockWebhookStore implements WebhookStore {
  private readonly events = new Map<string, MockWebhookEvent>();
  private readonly contacts = new Map<string, ContactRecord>();
  private readonly messages = new Map<string, MessageRecord>();
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
}

const globalStore = globalThis as typeof globalThis & { __lineCrmMockWebhookStore?: MockWebhookStore };

export function getMockWebhookStore(): MockWebhookStore {
  globalStore.__lineCrmMockWebhookStore ??= new MockWebhookStore();
  return globalStore.__lineCrmMockWebhookStore;
}
