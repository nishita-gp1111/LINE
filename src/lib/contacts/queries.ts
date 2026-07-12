import "server-only";

import { getAuthMode } from "@/lib/auth/config";
import { getServerEnv } from "@/lib/env/server";
import { MOCK_ORGANIZATION_ID } from "@/lib/line/config";
import { getMockWebhookStore } from "@/lib/webhook/store";
import type { ContactListResult, ContactRecord, FriendStatus, MessageRecord, WebhookMetrics } from "@/lib/webhook/store";
import { createSupabaseWebhookStore } from "@/lib/webhook/store-supabase";

function organizationId(): string {
  return getServerEnv().LINE_ORGANIZATION_ID || MOCK_ORGANIZATION_ID;
}

function readStore() {
  if (getAuthMode() === "mock") return getMockWebhookStore();
  return createSupabaseWebhookStore(organizationId());
}

export async function listContacts(query: {
  search?: string;
  status?: FriendStatus;
  page: number;
  pageSize: number;
}): Promise<ContactListResult> {
  const store = readStore();
  if (!store) return { items: [], total: 0, page: query.page, pageSize: query.pageSize };
  return store.listContacts(query);
}

export async function getContact(contactId: string): Promise<ContactRecord | null> {
  const store = readStore();
  return store ? store.getContact(organizationId(), contactId) : null;
}

export async function listContactMessages(contactId: string): Promise<MessageRecord[]> {
  const store = readStore();
  return store ? store.listMessages(organizationId(), contactId) : [];
}

export async function getWebhookMetrics(): Promise<WebhookMetrics> {
  const store = readStore();
  return store
    ? store.getMetrics()
    : { lastWebhookAt: null, lastProcessedAt: null, failedCount: 0, signatureErrorCount: 0 };
}
