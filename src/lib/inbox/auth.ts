import "server-only";

import { getAuthMode } from "@/lib/auth/config";
import { getAuthenticatedUser } from "@/lib/auth/server";
import { getServerEnv } from "@/lib/env/server";
import { MOCK_ORGANIZATION_ID } from "@/lib/line/config";
import { ensureInitialOrganization } from "@/lib/auth/organization";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { InboxRole, ProfileSummary } from "@/lib/inbox/types";

export type InboxAuthContext = {
  profileId: string;
  organizationId: string;
  role: InboxRole;
  profile: ProfileSummary;
};

function normalizeRole(value: string): InboxRole {
  if (value === "owner" || value === "admin" || value === "operator" || value === "viewer") return value;
  return "viewer";
}

export async function getInboxAuthContext(): Promise<InboxAuthContext | null> {
  const user = await getAuthenticatedUser();
  if (!user) return null;
  const env = getServerEnv();
  if (getAuthMode() === "mock") {
    return { profileId: user.id, organizationId: env.LINE_ORGANIZATION_ID || MOCK_ORGANIZATION_ID, role: "owner", profile: { id: user.id, displayName: user.name || "LINE CRMオーナー", email: user.email || "", role: "owner" } };
  }
  const bootstrapped = await ensureInitialOrganization(user);
  const organizationId = bootstrapped?.organizationId || env.LINE_ORGANIZATION_ID || MOCK_ORGANIZATION_ID;
  const client = createSupabaseAdminClient();
  if (!client) return null;
  const { data, error } = await client.from("organization_members").select("role, profiles(id, email, display_name)").eq("organization_id", organizationId).eq("profile_id", user.id).maybeSingle();
  if (error || !data) return null;
  const profile = Array.isArray(data.profiles) ? data.profiles[0] : data.profiles;
  return { profileId: user.id, organizationId, role: normalizeRole(String(data.role)), profile: { id: user.id, displayName: String(profile?.display_name || user.name || user.email || "管理者"), email: String(profile?.email || user.email || ""), role: normalizeRole(String(data.role)) } };
}

export function canOperate(role: InboxRole): boolean {
  return role !== "viewer";
}

export function canAdminister(role: InboxRole): boolean {
  return role === "admin" || role === "owner";
}

export function isTrustedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const requestOrigin = new URL(request.url).origin;
    const appUrl = getServerEnv().NEXT_PUBLIC_APP_URL;
    const configured = appUrl ? new URL(appUrl).origin : requestOrigin;
    return origin === requestOrigin || origin === configured;
  } catch {
    return false;
  }
}
