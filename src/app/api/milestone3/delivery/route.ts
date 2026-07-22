import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth/server";
import { getServerEnv } from "@/lib/env/server";
import { canAdminister, getInboxAuthContext, isTrustedOrigin } from "@/lib/inbox/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createMockCampaign, createMockTemplate, dispatchMockCampaign, listMockCampaigns, listMockTemplates } from "@/lib/milestone3/delivery-store";
import { listLiveTagCampaigns, previewLiveTagAudience, sendLiveTagCampaign } from "@/lib/milestone3/delivery-live";

function reply(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}

export async function GET(request: Request) {
  if (!await getAuthenticatedUser()) return reply({ error: "unauthorized" }, 401);
  const resource = new URL(request.url).searchParams.get("resource");
  if (getServerEnv().MOCK_LINE_API) {
    return reply(resource === "templates" ? { templates: listMockTemplates() } : { campaigns: listMockCampaigns() });
  }
  const auth = await getInboxAuthContext();
  const client = createSupabaseAdminClient();
  if (!auth || !client) return reply({ error: "database_not_configured" }, 503);
  if (!canAdminister(auth.role)) return reply({ error: "管理者権限が必要です。" }, 403);
  return reply({ campaigns: await listLiveTagCampaigns(client, auth.organizationId) });
}

export async function POST(request: Request) {
  if (!await getAuthenticatedUser()) return reply({ error: "unauthorized" }, 401);
  if (!isTrustedOrigin(request)) return reply({ error: "origin_not_allowed" }, 403);
  try {
    const body = await request.json() as { action?: string; [key: string]: unknown };
    if (!getServerEnv().MOCK_LINE_API) {
      const auth = await getInboxAuthContext();
      const client = createSupabaseAdminClient();
      if (!auth || !client) return reply({ error: "database_not_configured" }, 503);
      if (!canAdminister(auth.role)) return reply({ error: "管理者権限が必要です。" }, 403);
      if (body.action === "tag_audience_preview") {
        return reply({ preview: await previewLiveTagAudience(client, auth.organizationId, body) });
      }
      if (body.action === "tag_campaign_send") {
        return reply({ campaign: await sendLiveTagCampaign({ client, organizationId: auth.organizationId, profileId: auth.profileId, payload: body }) });
      }
      return reply({ error: "unknown_action" }, 400);
    }

    if (body.action === "template_create") return reply({ template: createMockTemplate({ name: String(body.name || ""), items: Array.isArray(body.items) ? body.items as Array<Record<string, unknown>> : [{ type: "text", text: "" }] }) }, 201);
    if (body.action === "campaign_create") return reply({ campaign: createMockCampaign({ name: String(body.name || ""), templateId: body.templateId ? String(body.templateId) : null, recipientIds: Array.isArray(body.recipientIds) ? body.recipientIds.map(String) : [], scheduledAt: body.scheduledAt ? String(body.scheduledAt) : null }) }, 201);
    if (body.action === "campaign_dispatch" && body.id) return reply({ campaign: await dispatchMockCampaign(String(body.id)) });
    if (body.action === "tag_audience_preview") return reply({ preview: { recipientCount: 1, matchedCount: 1, excludedCount: 0, excludedByTagCount: 0, sample: ["Mock Contact"], sampleIsComplete: true, adminRecipient: { configured: false, found: false, included: false, displayName: null }, matchMode: body.matchMode, tagIds: body.tagIds, excludeTagIds: body.excludeTagIds || [] } });
    if (body.action === "tag_campaign_send") return reply({ campaign: { id: body.clientRequestId, name: body.name, status: "completed", recipientCount: body.expectedRecipientCount, excludedCount: 0, acceptedCount: body.expectedRecipientCount, failedBatches: 0, textPreview: String(body.text || "").slice(0, 120), createdAt: new Date().toISOString(), completedAt: new Date().toISOString() } });
    return reply({ error: "unknown_action" }, 400);
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : "delivery_action_failed" }, 400);
  }
}
