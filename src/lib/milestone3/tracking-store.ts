import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getServerEnv } from "@/lib/env/server";
import { MOCK_ORGANIZATION_ID } from "@/lib/line/config";
import { verifyRecipientToken, type AttributionType, validateTrackingDestination } from "@/lib/milestone3/tracking";

type TrackedLink = { id: string; slug: string; destinationUrl: string; sourceId: string | null; isActive: boolean };
type Click = { trackedLinkId: string; sourceId: string | null; contactId: string | null; attributionType: AttributionType; clickedAt: string };

const mockLinks = new Map<string, TrackedLink>([["mock-demo", { id: "00000000-0000-4000-8000-000000000010", slug: "mock-demo", destinationUrl: "https://example.com/", sourceId: null, isActive: true }]]);
const mockClicks: Click[] = [];

function organizationId(): string { return getServerEnv().LINE_ORGANIZATION_ID || MOCK_ORGANIZATION_ID; }

export async function resolveTrackedLink(slug: string): Promise<TrackedLink | null> {
  const env = getServerEnv();
  if (env.MOCK_LINE_API) return mockLinks.get(slug) ?? null;
  const client = createSupabaseAdminClient();
  if (!client) return null;
  const { data, error } = await client.from("tracked_links").select("id,slug,destination_url,source_id,is_active").eq("organization_id", organizationId()).eq("slug", slug).maybeSingle();
  if (error || !data || !data.is_active) return null;
  try { validateTrackingDestination(String(data.destination_url)); } catch { return null; }
  return { id: String(data.id), slug: String(data.slug), destinationUrl: String(data.destination_url), sourceId: data.source_id ? String(data.source_id) : null, isActive: Boolean(data.is_active) };
}

export async function recordTrackedClick(input: { link: TrackedLink; token?: string | null; now?: string }): Promise<Click> {
  const env = getServerEnv();
  const now = input.now ?? new Date().toISOString();
  let contactId: string | null = null;
  let attributionType: AttributionType = "estimated";
  if (input.token && env.TRACKING_SIGNING_SECRET) {
    const candidate = verifyRecipientToken(input.token, env.TRACKING_SIGNING_SECRET);
    if (candidate && /^[0-9a-f-]{36}$/i.test(candidate)) { contactId = candidate; attributionType = "deterministic"; }
  }
  const click = { trackedLinkId: input.link.id, sourceId: input.link.sourceId, contactId, attributionType, clickedAt: now };
  if (env.MOCK_LINE_API) {
    const recent = mockClicks.find((item) => item.trackedLinkId === click.trackedLinkId && item.contactId === click.contactId && Date.parse(now) - Date.parse(item.clickedAt) < 10_000);
    if (!recent) mockClicks.push(click);
    return recent ?? click;
  }
  const client = createSupabaseAdminClient();
  if (!client) throw new Error("tracking database is not configured");
  const { error } = await client.from("link_clicks").insert({ organization_id: organizationId(), tracked_link_id: click.trackedLinkId, contact_id: click.contactId, source_id: click.sourceId, attribution_type: click.attributionType, clicked_at: click.clickedAt, metadata_json: { dedupeWindowSeconds: 10 } });
  if (error) throw new Error("tracked click could not be stored");
  return click;
}

export function getMockClickCount(): number { return mockClicks.length; }
