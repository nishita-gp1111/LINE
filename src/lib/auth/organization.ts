import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthMode } from "@/lib/auth/config";
import { getServerEnv } from "@/lib/env/server";
import { MOCK_ORGANIZATION_ID } from "@/lib/line/config";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const INITIAL_ORGANIZATION_NAME = "LINE CRM";

export type OrganizationBootstrapUser = {
  id: string;
  email?: string | null;
};

export type OrganizationBootstrapResult = {
  organizationId: string;
  role: "owner" | "admin" | "member" | "operator" | "viewer";
};

type OrganizationRow = {
  id: string;
  created_by: string;
};

type MembershipRow = {
  organization_id: string;
  role: OrganizationBootstrapResult["role"];
};

type BootstrapOptions = {
  organizationId: string;
  adminEmailAllowlist?: string[];
};

type BootstrapClient = SupabaseClient;

async function findMembership(
  client: BootstrapClient,
  userId: string,
  organizationId?: string
): Promise<MembershipRow | null> {
  let query = client
    .from("organization_members")
    .select("organization_id, role")
    .eq("profile_id", userId);
  if (organizationId) query = query.eq("organization_id", organizationId);

  const { data, error } = await query.order("created_at", { ascending: true }).limit(1);
  if (error) throw new Error("organization membership lookup failed");
  return ((data || [])[0] as MembershipRow | undefined) || null;
}

async function findFirstOrganization(client: BootstrapClient): Promise<OrganizationRow | null> {
  const { data, error } = await client
    .from("organizations")
    .select("id, created_by")
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw new Error("organization lookup failed");
  return ((data || [])[0] as OrganizationRow | undefined) || null;
}

async function findOrganizationById(client: BootstrapClient, organizationId: string): Promise<OrganizationRow | null> {
  const { data, error } = await client
    .from("organizations")
    .select("id, created_by")
    .eq("id", organizationId)
    .limit(1);
  if (error) throw new Error("organization lookup failed");
  return ((data || [])[0] as OrganizationRow | undefined) || null;
}

async function createOwnerMembership(
  client: BootstrapClient,
  userId: string,
  organizationId: string
): Promise<OrganizationBootstrapResult | null> {
  const { error } = await client.from("organization_members").upsert(
    {
      organization_id: organizationId,
      profile_id: userId,
      role: "owner"
    },
    { onConflict: "organization_id,profile_id", ignoreDuplicates: true }
  );
  if (error) return null;

  const membership = await findMembership(client, userId, organizationId);
  return membership
    ? { organizationId: membership.organization_id, role: membership.role }
    : null;
}

async function ensureInitialOrganizationWithClientUnsafe(
  user: OrganizationBootstrapUser,
  client: BootstrapClient,
  options: BootstrapOptions
): Promise<OrganizationBootstrapResult | null> {
  const email = user.email?.trim().toLowerCase();
  const allowlist = options.adminEmailAllowlist || [];
  if (allowlist.length > 0 && (!email || !allowlist.includes(email))) return null;

  const existingMembership = await findMembership(client, user.id, options.organizationId);
  if (existingMembership) {
    return { organizationId: existingMembership.organization_id, role: existingMembership.role };
  }

  const existingOrganization = await findFirstOrganization(client);
  if (existingOrganization) {
    // Recovery is limited to an organization created by this same first user.
    // Existing organizations are never claimed by a different authenticated user.
    if (existingOrganization.id !== options.organizationId || existingOrganization.created_by !== user.id) return null;
    return createOwnerMembership(client, user.id, existingOrganization.id);
  }

  const { data: createdRows, error: createError } = await client
    .from("organizations")
    .insert({
      id: options.organizationId,
      name: INITIAL_ORGANIZATION_NAME,
      created_by: user.id
    })
    .select("id, created_by")
    .limit(1);

  if (createError || !createdRows?.[0]) {
    // Another request may have created the first organization concurrently.
    // Only the request that owns the newly-created organization may add itself.
    const organizationAfterConflict = await findOrganizationById(client, options.organizationId);
    if (!organizationAfterConflict || organizationAfterConflict.created_by !== user.id) return null;
    return createOwnerMembership(client, user.id, organizationAfterConflict.id);
  }

  return createOwnerMembership(client, user.id, options.organizationId);
}

export async function ensureInitialOrganizationWithClient(
  user: OrganizationBootstrapUser,
  client: BootstrapClient,
  options: BootstrapOptions
): Promise<OrganizationBootstrapResult | null> {
  try {
    return await ensureInitialOrganizationWithClientUnsafe(user, client, options);
  } catch {
    return null;
  }
}

export async function ensureInitialOrganization(
  user: OrganizationBootstrapUser
): Promise<OrganizationBootstrapResult | null> {
  if (getAuthMode() === "mock") {
    return { organizationId: MOCK_ORGANIZATION_ID, role: "owner" };
  }

  const client = createSupabaseAdminClient();
  if (!client) return null;

  const env = getServerEnv();
  return ensureInitialOrganizationWithClient(user, client, {
    organizationId: env.LINE_ORGANIZATION_ID || MOCK_ORGANIZATION_ID,
    adminEmailAllowlist: env.ADMIN_EMAIL_ALLOWLIST
  });
}
