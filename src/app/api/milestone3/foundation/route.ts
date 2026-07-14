import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth/server";
import { canOperate, getInboxAuthContext } from "@/lib/inbox/auth";
import { getServerEnv } from "@/lib/env/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createField, createSegment, createTag, createTagGroup, assignTag, foundationState, previewSegment, removeTagAssignment, setFieldValue, updateTag } from "@/lib/milestone3/foundation-store";
import { assignLiveTag, createLiveTag, listLiveTags, removeLiveTag } from "@/lib/minimum-launch/live";

function json(data: unknown, status = 200) { return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } }); }

export async function GET(request: Request) {
  if (!await getAuthenticatedUser()) return json({ error: "unauthorized" }, 401);
  const resource = new URL(request.url).searchParams.get("resource") || "tags";
  if (getServerEnv().MOCK_LINE_API) {
    const state = foundationState();
    if (resource === "tags") return json({ groups: state.groups, tags: state.tags, assignments: state.assignments.filter((item) => !item.removedAt) });
    if (resource === "fields") return json({ fields: state.fields, values: state.values });
    if (resource === "segments") return json({ segments: state.segments });
    return json({ error: "unknown_resource" }, 400);
  }
  const client = createSupabaseAdminClient();
  if (!client) return json({ error: "database_not_configured" }, 503);
  const auth = await getInboxAuthContext();
  if (!auth) return json({ error: "unauthorized" }, 401);
  const liveTags = await listLiveTags(client, auth.organizationId);
  if (resource === "tags") return json(liveTags);
  const table = resource === "tags" ? "tags" : resource === "fields" ? "custom_field_definitions" : resource === "segments" ? "segments" : null;
  if (!table) return json({ error: "unknown_resource" }, 400);
  const { data, error } = await client.from(table).select("*").eq("organization_id", auth.organizationId).order("created_at", { ascending: false });
  if (error) return json({ error: "database_read_failed" }, 503);
  return json({ [resource]: data ?? [] });
}

export async function POST(request: Request) {
  if (!await getAuthenticatedUser()) return json({ error: "unauthorized" }, 401);
  const body = await request.json() as { action?: string; [key: string]: unknown };
  try {
    if (!getServerEnv().MOCK_LINE_API) {
      const auth = await getInboxAuthContext();
      const client = createSupabaseAdminClient();
      if (!auth || !client) return json({ error: "database_not_configured" }, 503);
      if (!canOperate(auth.role)) return json({ error: "権限がありません。" }, 403);
      if (body.action === "tag_create") return json({ tag: await createLiveTag({ client, organizationId: auth.organizationId, profileId: auth.profileId, name: String(body.name || "") }) }, 201);
      if (body.action === "tag_assign") return json({ ...(await assignLiveTag({ client, organizationId: auth.organizationId, contactId: String(body.contactId), tagId: String(body.tagId), sourceType: "manual", actorProfileId: auth.profileId })) }, 201);
      if (body.action === "tag_remove") return json({ assignment: await removeLiveTag({ client, organizationId: auth.organizationId, assignmentId: String(body.assignmentId), profileId: auth.profileId }) });
      return json({ error: "unknown_action" }, 400);
    }
    if (body.action === "group_create") return json({ group: createTagGroup({ name: String(body.name || ""), isExclusive: Boolean(body.isExclusive) }) }, 201);
    if (body.action === "tag_create") return json({ tag: createTag({ name: body.name, description: body.description, colorToken: body.colorToken, tagGroupId: body.tagGroupId ?? null, isExclusive: Boolean(body.isExclusive) }) }, 201);
    if (body.action === "tag_update") return json({ tag: updateTag(String(body.id), { name: String(body.name || ""), isActive: Boolean(body.isActive) }) });
    if (body.action === "tag_assign") return json({ assignment: assignTag({ contactId: String(body.contactId), tagId: String(body.tagId), sourceType: String(body.sourceType || "manual"), sourceId: body.sourceId ? String(body.sourceId) : null }) }, 201);
    if (body.action === "tag_remove") return json({ assignment: removeTagAssignment(String(body.assignmentId)) });
    if (body.action === "field_create") return json({ field: createField({ name: body.name, key: body.key, fieldType: body.fieldType, options: body.options, description: body.description }) }, 201);
    if (body.action === "field_value") return json({ value: setFieldValue({ contactId: String(body.contactId), fieldId: String(body.fieldId), value: body.value }) });
    if (body.action === "segment_create") return json({ segment: createSegment({ name: String(body.name || ""), conditions: body.conditions }) }, 201);
    if (body.action === "segment_preview") return json({ preview: previewSegment(String(body.id), []) });
    return json({ error: "unknown_action" }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "invalid_request" }, 400);
  }
}
