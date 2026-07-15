import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env/server";
import { assertLaunchAction, assertTestRecipient } from "@/lib/launch/flags";
import { evaluateRecipientPolicy } from "@/lib/launch/recipient-policy";
import { chunk } from "@/lib/milestone3/delivery";
import { selectTagAudience, tagAudienceSelectionSchema, tagCampaignSendSchema, type TagMatchMode } from "@/lib/milestone3/tag-campaign";
import { createLineMulticastClient } from "@/lib/line/send";

type Row = Record<string, unknown>;
type AudienceContact = { id: string; lineUserId: string; displayName: string; friendStatus: string; marketingStatus: string };

function row(value: unknown): Row {
  return value && typeof value === "object" ? value as Row : {};
}

async function listTagAssignments(client: SupabaseClient, organizationId: string, tagIds: string[]): Promise<Array<{ contactId: string; tagId: string }>> {
  const values: Array<{ contactId: string; tagId: string }> = [];
  const pageSize = 1_000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client.from("contact_tag_assignments")
      .select("contact_id, tag_id")
      .eq("organization_id", organizationId)
      .in("tag_id", tagIds)
      .is("removed_at", null)
      .range(from, from + pageSize - 1);
    if (error) throw new Error("タグ保有顧客を取得できませんでした。");
    const page = data || [];
    values.push(...page.map((value) => ({ contactId: String(row(value).contact_id), tagId: String(row(value).tag_id) })));
    if (page.length < pageSize) break;
  }
  return values;
}

async function listAudienceContacts(client: SupabaseClient, organizationId: string, contactIds: string[]): Promise<AudienceContact[]> {
  if (!contactIds.length) return [];
  const contactRows: Row[] = [];
  const preferenceRows: Row[] = [];
  for (const ids of chunk(contactIds, 200)) {
    const [contacts, preferences] = await Promise.all([
      client.from("contacts").select("id, line_user_id, display_name, friend_status").eq("organization_id", organizationId).in("id", ids),
      client.from("contact_delivery_preferences").select("contact_id, marketing_status").eq("organization_id", organizationId).in("contact_id", ids)
    ]);
    if (contacts.error || preferences.error) throw new Error("配信対象の顧客情報を取得できませんでした。");
    contactRows.push(...(contacts.data || []).map(row));
    preferenceRows.push(...(preferences.data || []).map(row));
  }
  const preferenceByContact = new Map(preferenceRows.map((value) => [String(value.contact_id), String(value.marketing_status)]));
  return contactRows.map((value) => ({
    id: String(value.id),
    lineUserId: String(value.line_user_id),
    displayName: String(value.display_name || "名称未取得"),
    friendStatus: String(value.friend_status),
    marketingStatus: preferenceByContact.get(String(value.id)) || "eligible"
  }));
}

async function resolveTagAudience(client: SupabaseClient, organizationId: string, input: { tagIds: string[]; matchMode: TagMatchMode }): Promise<{ contacts: AudienceContact[]; matchedCount: number; excludedCount: number; sample: string[] }> {
  const parsed = tagAudienceSelectionSchema.parse(input);
  const { data: tags, error: tagError } = await client.from("tags").select("id").eq("organization_id", organizationId).eq("is_active", true).in("id", parsed.tagIds);
  if (tagError || (tags || []).length !== parsed.tagIds.length) throw new Error("選択したタグが見つかりません。");
  const assignments = await listTagAssignments(client, organizationId, parsed.tagIds);
  const candidateIds = [...new Set(assignments.map((value) => value.contactId))];
  const contacts = await listAudienceContacts(client, organizationId, candidateIds);
  const selection = selectTagAudience({
    tagIds: parsed.tagIds,
    matchMode: parsed.matchMode,
    contacts: contacts.map((contact) => ({ id: contact.id, friendStatus: contact.friendStatus, marketingStatus: contact.marketingStatus })),
    assignments,
    maxRecipients: getServerEnv().MAX_CAMPAIGN_RECIPIENTS
  });
  const selected = new Set(selection.recipientIds);
  const env = getServerEnv();
  const allowed = contacts.filter((contact) => selected.has(contact.id)).filter((contact) => evaluateRecipientPolicy({
    appEnvironment: env.APP_ENV,
    mockLineApi: env.MOCK_LINE_API,
    recipientMode: env.LINE_RECIPIENT_MODE,
    allowedLineUserIds: env.LINE_TEST_USER_IDS,
    allowedLineUserHashes: env.LINE_TEST_USER_HASHES,
    lineUserId: contact.lineUserId
  }).allowed).sort((left, right) => left.id.localeCompare(right.id));
  return {
    contacts: allowed,
    matchedCount: selection.matchedCount,
    excludedCount: selection.excludedCount + selection.recipientIds.length - allowed.length,
    sample: allowed.slice(0, 20).map((contact) => contact.displayName)
  };
}

export async function previewLiveTagAudience(client: SupabaseClient, organizationId: string, input: unknown): Promise<Row> {
  const parsed = tagAudienceSelectionSchema.parse(input);
  const audience = await resolveTagAudience(client, organizationId, parsed);
  return {
    recipientCount: audience.contacts.length,
    matchedCount: audience.matchedCount,
    excludedCount: audience.excludedCount,
    sample: audience.sample,
    matchMode: parsed.matchMode,
    tagIds: parsed.tagIds
  };
}

function publicCampaign(value: unknown): Row {
  const campaign = row(value);
  const message = Array.isArray(campaign.message_snapshot_json) ? row(campaign.message_snapshot_json[0]) : {};
  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    recipientCount: Number(campaign.estimated_recipients || 0),
    excludedCount: Number(campaign.excluded_recipients || 0),
    acceptedCount: Number(campaign.accepted_recipients || 0),
    failedBatches: Number(campaign.failed_batches || 0),
    textPreview: typeof message.text === "string" ? message.text.slice(0, 120) : "",
    createdAt: campaign.created_at,
    completedAt: campaign.completed_at
  };
}

export async function listLiveTagCampaigns(client: SupabaseClient, organizationId: string): Promise<Row[]> {
  const { data, error } = await client.from("campaigns")
    .select("id, name, status, message_snapshot_json, estimated_recipients, excluded_recipients, accepted_recipients, failed_batches, created_at, completed_at")
    .eq("organization_id", organizationId)
    .eq("delivery_mode", "multicast")
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw new Error("タグ配信履歴を取得できませんでした。");
  return (data || []).map(publicCampaign);
}

async function contactLineIds(client: SupabaseClient, organizationId: string, contactIds: string[]): Promise<string[]> {
  const [{ data, error }, preferences] = await Promise.all([
    client.from("contacts").select("id, line_user_id, friend_status").eq("organization_id", organizationId).in("id", contactIds),
    client.from("contact_delivery_preferences").select("contact_id, marketing_status").eq("organization_id", organizationId).in("contact_id", contactIds)
  ]);
  if (error || preferences.error) throw new Error("配信直前の送信先確認に失敗しました。");
  const byId = new Map((data || []).map((value) => [String(row(value).id), row(value)]));
  const marketingById = new Map((preferences.data || []).map((value) => [String(row(value).contact_id), String(row(value).marketing_status)]));
  return contactIds.map((contactId) => {
    const contact = byId.get(contactId);
    if (!contact || contact.friend_status !== "following" || (marketingById.get(contactId) || "eligible") !== "eligible") throw new Error("配信対象に送信できない顧客が含まれています。再度プレビューしてください。");
    const lineUserId = String(contact.line_user_id || "");
    assertTestRecipient(lineUserId);
    return lineUserId;
  });
}

async function finishCampaign(client: SupabaseClient, organizationId: string, campaignId: string): Promise<Row> {
  const batches = await client.from("campaign_batches").select("status, recipient_count").eq("organization_id", organizationId).eq("campaign_id", campaignId);
  if (batches.error) throw new Error("配信結果を集計できませんでした。");
  const rows = (batches.data || []).map(row);
  const acceptedCount = rows.filter((value) => value.status === "accepted").reduce((sum, value) => sum + Number(value.recipient_count || 0), 0);
  const failedBatches = rows.filter((value) => value.status === "failed" || value.status === "retry_wait").length;
  const inProgress = rows.some((value) => value.status === "pending" || value.status === "sending");
  const status = inProgress ? "sending" : failedBatches ? (acceptedCount ? "partially_failed" : "failed") : "completed";
  const completedAt = status === "completed" || status === "partially_failed" || status === "failed" ? new Date().toISOString() : null;
  const updated = await client.from("campaigns").update({ status, accepted_recipients: acceptedCount, failed_batches: failedBatches, completed_at: completedAt, updated_at: new Date().toISOString() }).eq("organization_id", organizationId).eq("id", campaignId).select("*").single();
  if (updated.error || !updated.data) throw new Error("配信結果を保存できませんでした。");
  return publicCampaign(updated.data);
}

export async function sendLiveTagCampaign(input: { client: SupabaseClient; organizationId: string; profileId: string; payload: unknown }): Promise<Row> {
  assertLaunchAction("LINE_BULK_SEND_ENABLED");
  const parsed = tagCampaignSendSchema.parse(input.payload);
  const existing = await input.client.from("campaigns").select("*").eq("organization_id", input.organizationId).eq("id", parsed.clientRequestId).maybeSingle();
  if (existing.error) throw new Error("既存の配信状態を確認できませんでした。");
  if (existing.data && ["completed", "partially_failed", "failed"].includes(String(row(existing.data).status))) return publicCampaign(existing.data);

  if (!existing.data) {
    const audience = await resolveTagAudience(input.client, input.organizationId, parsed);
    if (audience.contacts.length !== parsed.expectedRecipientCount) throw new Error("対象人数がプレビュー時から変わりました。もう一度プレビューしてください。");
    if (!audience.contacts.length) throw new Error("配信できる対象者がいません。");
    const created = await input.client.from("campaigns").insert({
      id: parsed.clientRequestId,
      organization_id: input.organizationId,
      name: parsed.name,
      description: `AND:${parsed.tagIds.join(",")}`,
      status: "preparing",
      delivery_mode: "multicast",
      message_snapshot_json: [{ type: "text", text: parsed.text }],
      estimated_recipients: audience.contacts.length,
      excluded_recipients: audience.excludedCount,
      created_by_profile_id: input.profileId
    }).select("*").single();
    if (created.error || !created.data) throw new Error("配信を作成できませんでした。");
    const batches = chunk(audience.contacts.map((contact) => contact.id), getServerEnv().MAX_MULTICAST_BATCH_SIZE).map((contactIds, index) => ({
      organization_id: input.organizationId,
      campaign_id: parsed.clientRequestId,
      batch_number: index + 1,
      contact_ids: contactIds,
      recipient_count: contactIds.length,
      audience_hash: createHash("sha256").update(contactIds.join(","), "utf8").digest("hex"),
      retry_key: randomUUID(),
      status: "pending"
    }));
    const inserted = await input.client.from("campaign_batches").insert(batches);
    if (inserted.error) {
      await input.client.from("campaigns").update({ status: "failed", failed_batches: batches.length, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("organization_id", input.organizationId).eq("id", parsed.clientRequestId);
      throw new Error("配信対象を安全なバッチへ分割できませんでした。");
    }
    await input.client.from("campaign_events").insert({ organization_id: input.organizationId, campaign_id: parsed.clientRequestId, event_type: "tag_campaign_confirmed", metadata_redacted_json: { tagCount: parsed.tagIds.length, matchMode: parsed.matchMode, recipientCount: audience.contacts.length }, profile_id: input.profileId });
  }

  const campaign = await input.client.from("campaigns").select("message_snapshot_json").eq("organization_id", input.organizationId).eq("id", parsed.clientRequestId).single();
  if (campaign.error || !campaign.data) throw new Error("配信本文を取得できませんでした。");
  const message = Array.isArray(campaign.data.message_snapshot_json) ? row(campaign.data.message_snapshot_json[0]) : {};
  if (message.type !== "text" || typeof message.text !== "string") throw new Error("配信本文が不正です。");
  await input.client.from("campaigns").update({ status: "sending", started_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("organization_id", input.organizationId).eq("id", parsed.clientRequestId).in("status", ["preparing", "sending"]);

  const batches = await input.client.from("campaign_batches").select("id, contact_ids, retry_key, attempt_count, status").eq("organization_id", input.organizationId).eq("campaign_id", parsed.clientRequestId).order("batch_number");
  if (batches.error) throw new Error("配信バッチを取得できませんでした。");
  const line = createLineMulticastClient();
  for (const value of batches.data || []) {
    const batch = row(value);
    if (batch.status === "accepted") continue;
    const claimed = await input.client.from("campaign_batches").update({ status: "sending", attempt_count: Number(batch.attempt_count || 0) + 1, updated_at: new Date().toISOString() }).eq("organization_id", input.organizationId).eq("id", String(batch.id)).in("status", ["pending", "retry_wait"]).select("id").maybeSingle();
    if (claimed.error) throw new Error("配信バッチを開始できませんでした。");
    if (!claimed.data) continue;
    const contactIds = Array.isArray(batch.contact_ids) ? batch.contact_ids.map(String) : [];
    try {
      const lineUserIds = await contactLineIds(input.client, input.organizationId, contactIds);
      const result = await line.multicast({ lineUserIds, messages: [{ type: "text", text: message.text }], retryKey: String(batch.retry_key) });
      await input.client.from("campaign_batches").update(result.accepted ? {
        status: "accepted",
        line_request_id: result.lineRequestId,
        accepted_at: new Date().toISOString(),
        last_error_class: null,
        last_error_safe: null,
        updated_at: new Date().toISOString()
      } : {
        status: result.retryable ? "retry_wait" : "failed",
        line_request_id: result.lineRequestId,
        last_error_class: result.retryable ? "retryable" : "line_rejected",
        last_error_safe: result.safeMessage || "LINE APIが配信を拒否しました。",
        updated_at: new Date().toISOString()
      }).eq("organization_id", input.organizationId).eq("id", String(batch.id));
    } catch (error) {
      await input.client.from("campaign_batches").update({ status: "failed", last_error_class: "validation", last_error_safe: error instanceof Error ? error.message : "配信対象の確認に失敗しました。", updated_at: new Date().toISOString() }).eq("organization_id", input.organizationId).eq("id", String(batch.id));
    }
  }
  const finished = await finishCampaign(input.client, input.organizationId, parsed.clientRequestId);
  await input.client.from("campaign_events").insert({ organization_id: input.organizationId, campaign_id: parsed.clientRequestId, event_type: "tag_campaign_finished", metadata_redacted_json: { status: finished.status, acceptedCount: finished.acceptedCount, failedBatches: finished.failedBatches }, profile_id: input.profileId });
  return finished;
}
