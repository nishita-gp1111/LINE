import "server-only";

import { getAuthMode } from "@/lib/auth/config";
import { getServerEnv } from "@/lib/env/server";
import { MOCK_ORGANIZATION_ID } from "@/lib/line/config";
import { getMockWebhookStore } from "@/lib/webhook/store";
import { SupabaseInboxStore } from "@/lib/inbox/store-supabase";
import type { InboxStore } from "@/lib/inbox/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export function getInboxStore(organizationId?: string): InboxStore | null {
  const resolvedOrganizationId = organizationId || getServerEnv().LINE_ORGANIZATION_ID || MOCK_ORGANIZATION_ID;
  if (getAuthMode() === "mock") return getMockWebhookStore();
  const client = createSupabaseAdminClient();
  return client ? new SupabaseInboxStore(client, resolvedOrganizationId) : null;
}
