import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { acquisitionRouteByMessage, acquisitionRouteBySlug, type AcquisitionRoute } from "@/lib/acquisition/routes";
import { getServerEnv } from "@/lib/env/server";
import {
  assertControlledRecipient,
  getControlledRecipientRecord,
  getEffectiveControlledRecipientHashes
} from "@/lib/launch/controlled-recipient";
import { assertLaunchAction, isLaunchFlagEnabled } from "@/lib/launch/flags";
import { hashLineUserId } from "@/lib/launch/recipient-policy";
import { activeTagAssignmentKey, tagDefinitionSchema } from "@/lib/milestone3/foundation";
import { createOpaquePostbackToken, verifyOpaquePostbackToken } from "@/lib/milestone3/survey";
import { SupabaseInboxStore } from "@/lib/inbox/store-supabase";
import { sendInboxTextMessage } from "@/lib/inbox/send-service";
import { createLineReplyClient } from "@/lib/line/send";
import type { MessageRecord } from "@/lib/webhook/store";
import { followSurveyClientRequestId, parseSurveyPostbackData, selectEligibleSurveyRichMenu, selectRichMenuRule, surveyCompletionClientRequestId, surveyGreetingClientRequestId, surveyPostbackData, surveyQuestionClientRequestId, surveyResponseKey, surveyRichMenuJobKey, surveyRichMenuRunAt, type RichMenuRuleCandidate, type SurveyRichMenuCandidate } from "@/lib/minimum-launch/domain";
import { validateRichMenuImage } from "@/lib/minimum-launch/rich-menu-image";
import { RICH_MENU_OPENS_BY_DEFAULT, scaleRichMenuLayout, type RichMenuActionInput } from "@/lib/minimum-launch/rich-menu-layouts";
import { buildSurveyCompletionMessage, buildSurveyGreetingMessage, buildSurveyQuestionMessage, type LineFlexMessage } from "@/lib/minimum-launch/survey-flex-message";
import { assertDefaultRichMenuPath, assertPerUserRichMenuPath } from "@/lib/milestone3/rich-menu";

type Row = Record<string, unknown>;
type RichMenuSync = "linked" | "restored" | "unchanged" | "not_configured" | "disabled" | "blocked" | "recipient_not_allowed";

function row(value: unknown): Row {
  return value && typeof value === "object" ? value as Row : {};
}

function firstRow(value: unknown): Row {
  return row(Array.isArray(value) ? value[0] : value);
}

function isUniqueViolation(error: unknown): boolean {
  return row(error).code === "23505";
}

async function lineRequest(path: string, init: RequestInit = {}, dataApi = false): Promise<{ status: number; body: Row; headers: Headers }> {
  assertPerUserRichMenuPath(path);
  const token = getServerEnv().LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error("LINE_CHANNEL_ACCESS_TOKENが設定されていません。");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`https://${dataApi ? "api-data" : "api"}.line.me${path}`, { ...init, headers, redirect: "error", signal: controller.signal });
    let body: Row = {};
    if (response.headers.get("content-type")?.includes("json")) {
      try { body = row(await response.json()); } catch { body = {}; }
    }
    if (!response.ok) throw new Error(`LINE API request failed (${response.status})`);
    return { status: response.status, body, headers: response.headers };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("LINE API request timed out");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function defaultRichMenuRequest(path: string, init: RequestInit = {}): Promise<{ status: number; body: Row }> {
  assertDefaultRichMenuPath(path);
  const token = getServerEnv().LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error("LINE_CHANNEL_ACCESS_TOKENが設定されていません。");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`https://api.line.me${path}`, { ...init, headers, redirect: "error", signal: controller.signal });
    let body: Row = {};
    if (response.headers.get("content-type")?.includes("json")) {
      try { body = row(await response.json()); } catch { body = {}; }
    }
    if (!response.ok) throw new Error(`LINE default rich menu request failed (${response.status})`);
    return { status: response.status, body };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("LINE default rich menu request timed out");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function lineContentRequest(path: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  assertPerUserRichMenuPath(path);
  const token = getServerEnv().LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error("LINE_CHANNEL_ACCESS_TOKENが設定されていません。");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`https://api-data.line.me${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`LINE rich menu image request failed (${response.status})`);
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() || "";
    const bytes = new Uint8Array(await response.arrayBuffer());
    validateRichMenuImage(bytes, contentType);
    return { bytes, contentType };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("LINE API request timed out");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function systemProfileId(client: SupabaseClient, organizationId: string): Promise<string> {
  const { data, error } = await client.from("organization_members").select("profile_id, role").eq("organization_id", organizationId).in("role", ["owner", "admin", "operator"]).order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (error || !data) throw new Error("送信元プロフィールが見つかりません。");
  return String(data.profile_id);
}

async function contactFor(client: SupabaseClient, organizationId: string, contactId: string): Promise<Row> {
  const { data, error } = await client.from("contacts").select("id, line_user_id, display_name, friend_status").eq("organization_id", organizationId).eq("id", contactId).maybeSingle();
  if (error || !data) throw new Error("顧客が見つかりません。");
  return row(data);
}

async function allowlistedContact(client: SupabaseClient, organizationId: string): Promise<Row> {
  const controlled = await getControlledRecipientRecord(client, organizationId);
  if (controlled) {
    const { data, error } = await client.from("contacts").select("id, line_user_id, display_name, friend_status").eq("organization_id", organizationId).eq("id", controlled.contactId).maybeSingle();
    if (error || !data) throw new Error("許可済み顧客が見つかりません。");
    return row(data);
  }
  const hashes = await getEffectiveControlledRecipientHashes(client, organizationId);
  if (hashes.length !== 1) throw new Error("送信先の顧客を1名だけ設定してください。");
  const { data, error } = await client.from("contacts").select("id, line_user_id, display_name, friend_status").eq("organization_id", organizationId).limit(500);
  if (error) throw new Error("許可済み顧客を取得できませんでした。");
  const matches = (data || []).filter((value) => hashes.includes(hashLineUserId(String(row(value).line_user_id))));
  if (matches.length !== 1) throw new Error("許可済み顧客が見つかりません。");
  return row(matches[0]);
}

async function resolveContact(client: SupabaseClient, organizationId: string, contactId?: string): Promise<Row> {
  return contactId ? contactFor(client, organizationId, contactId) : allowlistedContact(client, organizationId);
}

async function recipientIsAllowed(client: SupabaseClient, organizationId: string, lineUserId: string): Promise<boolean> {
  try { await assertControlledRecipient(client, organizationId, lineUserId); return true; } catch { return false; }
}

export async function listLiveContacts(client: SupabaseClient, organizationId: string): Promise<Row[]> {
  const { data, error } = await client.from("contacts").select("id, line_user_id, display_name, friend_status, last_message_at").eq("organization_id", organizationId).neq("friend_status", "blocked").order("last_message_at", { ascending: false, nullsFirst: false }).limit(500);
  if (error) throw new Error("送信可能な顧客を取得できませんでした。");
  const contactRows = data || [];
  if (getServerEnv().LINE_RECIPIENT_MODE === "all_followers") {
    return contactRows.map((value) => ({ id: row(value).id, displayName: row(value).display_name || "名称未取得", friendStatus: row(value).friend_status, lastMessageAt: row(value).last_message_at }));
  }
  const hashes = await getEffectiveControlledRecipientHashes(client, organizationId);
  if (hashes.length !== 1) return [];
  return contactRows
    .filter((value) => hashes.includes(hashLineUserId(String(row(value).line_user_id))))
    .map((value) => ({ id: row(value).id, displayName: row(value).display_name || "名称未取得", friendStatus: row(value).friend_status, lastMessageAt: row(value).last_message_at }));
}

export async function listLiveTags(client: SupabaseClient, organizationId: string): Promise<{ tags: Row[]; assignments: Row[] }> {
  const [tags, assignments] = await Promise.all([
    client.from("tags").select("*").eq("organization_id", organizationId).eq("is_active", true).order("created_at", { ascending: false }),
    client.from("contact_tag_assignments").select("*").eq("organization_id", organizationId).is("removed_at", null).order("assigned_at", { ascending: false })
  ]);
  if (tags.error || assignments.error) throw new Error("タグの取得に失敗しました。");
  return {
    tags: (tags.data || []).map((value) => ({ ...row(value), isActive: row(value).is_active })),
    assignments: (assignments.data || []).map((value) => ({ ...row(value), contactId: row(value).contact_id, tagId: row(value).tag_id, sourceType: row(value).source_type, removedAt: row(value).removed_at }))
  };
}

export async function createLiveTag(input: { client: SupabaseClient; organizationId: string; profileId: string; name: string }): Promise<Row> {
  const parsed = tagDefinitionSchema.parse({ name: input.name, description: "", colorToken: "moss", tagGroupId: null, isExclusive: false });
  const { data, error } = await input.client.from("tags").insert({ organization_id: input.organizationId, name: parsed.name, description: parsed.description, color_token: parsed.colorToken, tag_group_id: null, is_active: true, created_by_profile_id: input.profileId }).select("*").single();
  if (error || !data) throw new Error("タグを作成できませんでした。同名タグがないか確認してください。");
  return row(data);
}

export async function assignLiveTag(input: { client: SupabaseClient; organizationId: string; contactId: string; tagId: string; sourceType: "manual" | "survey" | "system"; sourceId?: string | null; actorProfileId: string }): Promise<{ assignment: Row; duplicate: boolean; effectiveAdded: boolean; automation: string; richMenu: RichMenuSync }> {
  const contact = await contactFor(input.client, input.organizationId, input.contactId);
  await assertControlledRecipient(input.client, input.organizationId, String(contact.line_user_id));
  const assignmentKey = activeTagAssignmentKey(input.contactId, input.tagId, input.sourceType, input.sourceId || null);
  const { data: rpcData, error: rpcError } = await input.client.rpc("minimum_assign_contact_tag", {
    target_organization_id: input.organizationId,
    target_contact_id: input.contactId,
    target_tag_id: input.tagId,
    target_source_type: input.sourceType,
    target_source_id: input.sourceId || null,
    target_assignment_key: assignmentKey,
    target_actor_profile_id: input.actorProfileId
  });
  if (rpcError) throw new Error(rpcError.code === "23503" ? "顧客またはタグが見つかりません。" : "タグの保存に失敗しました。");
  const result = firstRow(rpcData);
  const assignmentId = String(result.assignment_id || "");
  const { data: assignment, error } = await input.client.from("contact_tag_assignments").select("*").eq("organization_id", input.organizationId).eq("id", assignmentId).single();
  if (error || !assignment) throw new Error("保存したタグ付与を取得できませんでした。");
  const effectiveAdded = result.effective_added === true;
  const automation = effectiveAdded ? await runTagAddedAutomation({ client: input.client, organizationId: input.organizationId, contactId: input.contactId, tagId: input.tagId, assignmentId }) : "not_triggered";
  const richMenu = await reconcileContactRichMenu({ client: input.client, organizationId: input.organizationId, contactId: input.contactId });
  return { assignment: row(assignment), duplicate: result.duplicate === true, effectiveAdded, automation, richMenu };
}

async function applyAcquisitionRoute(input: { client: SupabaseClient; organizationId: string; contactId: string; route: AcquisitionRoute }): Promise<{ matched: true; slug: string; tagName: string; duplicate: boolean }> {
  const route = input.route;
  const profileId = await systemProfileId(input.client, input.organizationId);
  const existing = await input.client.from("tags").select("id, name").eq("organization_id", input.organizationId).eq("name", route.tagName).eq("is_active", true).maybeSingle();
  if (existing.error) throw new Error("流入経路タグを取得できませんでした。");

  let tagId = existing.data?.id ? String(existing.data.id) : "";
  if (!tagId) {
    const parsed = tagDefinitionSchema.parse({ name: route.tagName, description: `${route.label}の自動流入タグ`, colorToken: "teal", tagGroupId: null, isExclusive: false });
    const created = await input.client.from("tags").insert({ organization_id: input.organizationId, name: parsed.name, description: parsed.description, color_token: parsed.colorToken, tag_group_id: null, is_active: true, created_by_profile_id: profileId }).select("id").single();
    if (created.error && isUniqueViolation(created.error)) {
      const retry = await input.client.from("tags").select("id").eq("organization_id", input.organizationId).eq("name", route.tagName).eq("is_active", true).maybeSingle();
      if (retry.error || !retry.data) throw new Error("流入経路タグを準備できませんでした。");
      tagId = String(retry.data.id);
    } else if (created.error || !created.data) {
      throw new Error("流入経路タグを準備できませんでした。");
    } else {
      tagId = String(created.data.id);
    }
  }

  const result = await assignLiveTag({
    client: input.client,
    organizationId: input.organizationId,
    contactId: input.contactId,
    tagId,
    sourceType: "system",
    sourceId: `acquisition:${route.slug}`,
    actorProfileId: profileId
  });
  return { matched: true, slug: route.slug, tagName: route.tagName, duplicate: result.duplicate };
}

export async function applyLiveAcquisitionRouteTag(input: { client: SupabaseClient; organizationId: string; contactId: string; text: string }): Promise<{ matched: boolean; slug?: string; tagName?: string; duplicate?: boolean }> {
  const route = acquisitionRouteByMessage(input.text);
  if (!route) return { matched: false };
  return applyAcquisitionRoute({ ...input, route });
}

export async function applyLiveAcquisitionRouteTagBySlug(input: { client: SupabaseClient; organizationId: string; contactId: string; slug: string }): Promise<{ matched: boolean; slug?: string; tagName?: string; duplicate?: boolean }> {
  const route = acquisitionRouteBySlug(input.slug);
  if (!route) return { matched: false };
  return applyAcquisitionRoute({ ...input, route });
}

export async function removeLiveTag(input: { client: SupabaseClient; organizationId: string; assignmentId: string; profileId: string }): Promise<Row> {
  const { data: existing, error: existingError } = await input.client.from("contact_tag_assignments").select("contact_id").eq("organization_id", input.organizationId).eq("id", input.assignmentId).is("removed_at", null).maybeSingle();
  if (existingError || !existing) throw new Error("有効なタグ付与が見つかりません。");
  const contact = await contactFor(input.client, input.organizationId, String(existing.contact_id));
  await assertControlledRecipient(input.client, input.organizationId, String(contact.line_user_id));
  const { data: rpcData, error: rpcError } = await input.client.rpc("minimum_remove_contact_tag", { target_organization_id: input.organizationId, target_assignment_id: input.assignmentId, target_actor_profile_id: input.profileId });
  if (rpcError) throw new Error("タグを解除できませんでした。");
  const result = firstRow(rpcData);
  const { data: assignment, error } = await input.client.from("contact_tag_assignments").select("*").eq("organization_id", input.organizationId).eq("id", input.assignmentId).single();
  if (error || !assignment) throw new Error("解除したタグ付与を取得できませんでした。");
  const richMenu = await reconcileContactRichMenu({ client: input.client, organizationId: input.organizationId, contactId: String(result.contact_id) });
  return { ...row(assignment), effectiveRemoved: result.effective_removed === true, richMenu };
}

async function runTagAddedAutomation(input: { client: SupabaseClient; organizationId: string; contactId: string; tagId: string; assignmentId: string }): Promise<string> {
  const { data: scenarios, error } = await input.client.from("automation_scenarios").select("id, version").eq("organization_id", input.organizationId).eq("trigger_type", "tag_added").eq("status", "active").contains("trigger_config_json", { tagId: input.tagId }).order("created_at", { ascending: true }).limit(1);
  if (error) throw new Error("タグ起点automationの取得に失敗しました。");
  const scenario = row((scenarios || [])[0]);
  if (!scenario.id) return "not_configured";
  if (!isLaunchFlagEnabled("LINE_AUTOMATION_SEND_ENABLED")) return "disabled";
  const { data: steps, error: stepError } = await input.client.from("automation_steps").select("step_type, config_json, step_order").eq("organization_id", input.organizationId).eq("scenario_id", String(scenario.id)).eq("step_type", "send_message").order("step_order", { ascending: true }).limit(1);
  if (stepError) throw new Error("タグ起点automationのstep取得に失敗しました。");
  const step = row((steps || [])[0]);
  const text = row(step.config_json).text;
  if (typeof text !== "string" || !text.trim()) throw new Error("タグ起点メッセージ本文が未設定です。");
  const contact = await contactFor(input.client, input.organizationId, input.contactId);
  if (String(contact.friend_status) === "blocked") return "blocked";
  if (!await recipientIsAllowed(input.client, input.organizationId, String(contact.line_user_id))) return "recipient_not_allowed";
  assertLaunchAction("LINE_AUTOMATION_SEND_ENABLED");
  const idempotencyKey = `minimum-tag:${input.assignmentId}:${String(scenario.id)}`;
  const { data: existing, error: existingError } = await input.client.from("automation_enrollments").select("id, status, updated_at").eq("organization_id", input.organizationId).eq("idempotency_key", idempotencyKey).maybeSingle();
  if (existingError) throw new Error("タグ起点automationの実行状態を取得できませんでした。");
  if (existing && row(existing).status === "completed") return "duplicate";
  let enrollmentId = existing ? String(row(existing).id) : "";
  if (existing) {
    const status = String(row(existing).status);
    const now = new Date().toISOString();
    let claim;
    if (status === "failed") {
      claim = await input.client.from("automation_enrollments").update({ status: "active", last_error_safe: null, updated_at: now }).eq("organization_id", input.organizationId).eq("id", enrollmentId).eq("status", "failed").select("id").maybeSingle();
    } else if (status === "active" && Date.parse(String(row(existing).updated_at)) < Date.now() - 5 * 60 * 1000) {
      claim = await input.client.from("automation_enrollments").update({ last_error_safe: null, updated_at: now }).eq("organization_id", input.organizationId).eq("id", enrollmentId).eq("status", "active").lt("updated_at", new Date(Date.now() - 5 * 60 * 1000).toISOString()).select("id").maybeSingle();
    } else {
      return "in_progress";
    }
    if (claim.error) throw new Error("タグ起点automationの再実行を開始できませんでした。");
    if (!claim.data) return "in_progress";
  } else {
    const created = await input.client.from("automation_enrollments").insert({ organization_id: input.organizationId, scenario_id: scenario.id, scenario_version: Number(scenario.version || 1), contact_id: input.contactId, status: "active", current_step_order: Number(step.step_order || 0), idempotency_key: idempotencyKey }).select("id").single();
    if (created.error && !isUniqueViolation(created.error)) throw new Error("タグ起点automationの登録に失敗しました。");
    if (created.data) enrollmentId = String(created.data.id);
    else {
      const raced = await input.client.from("automation_enrollments").select("id, status").eq("organization_id", input.organizationId).eq("idempotency_key", idempotencyKey).single();
      if (raced.error || !raced.data) throw new Error("タグ起点automationの登録を確認できませんでした。");
      if (row(raced.data).status === "completed") return "duplicate";
      return "in_progress";
    }
  }
  const profileId = await systemProfileId(input.client, input.organizationId);
  const store = new SupabaseInboxStore(input.client, input.organizationId);
  const conversation = await store.ensureConversationForContact(input.organizationId, input.contactId, new Date().toISOString());
  try {
    const sent = await sendInboxTextMessage({ store, organizationId: input.organizationId, profileId, role: "owner", gate: "automation", conversationId: conversation.id, text, clientRequestId: `minimum-tag-message:${input.assignmentId}:${scenario.id}` });
    if (sent.message.status !== "accepted") throw new Error(sent.message.errorMessageSafe || "LINE APIにメッセージが受け付けられませんでした。");
    const completed = await input.client.from("automation_enrollments").update({ status: "completed", completed_at: new Date().toISOString(), last_error_safe: null, updated_at: new Date().toISOString() }).eq("organization_id", input.organizationId).eq("id", enrollmentId);
    if (completed.error) throw new Error("タグ起点automationの完了状態を保存できませんでした。");
    return sent.reused ? "duplicate" : "sent";
  } catch (error) {
    await input.client.from("automation_enrollments").update({ status: "failed", last_error_safe: error instanceof Error ? error.message.slice(0, 500) : "送信失敗", updated_at: new Date().toISOString() }).eq("organization_id", input.organizationId).eq("id", enrollmentId);
    throw error;
  }
}

type QuickReplyOption = { id: string; label: string; token: string };

function safeLineApiError(body: unknown): string {
  const parsed = row(body);
  const summary = typeof parsed.message === "string" ? parsed.message : "アンケート送信がLINE APIに拒否されました。";
  const details = Array.isArray(parsed.details)
    ? parsed.details.slice(0, 5).map((detail) => {
      const item = row(detail);
      const property = typeof item.property === "string" ? item.property : "request";
      const message = typeof item.message === "string" ? item.message : "invalid";
      return `${property}: ${message}`;
    })
    : [];
  return [summary, ...details].join(" / ").slice(0, 500);
}

async function pushSurveyFlexMessage(lineUserId: string, message: LineFlexMessage, retryKey: string): Promise<{ accepted: boolean; status: number; lineRequestId: string | null; lineAcceptedRequestId: string | null; errorMessageSafe: string | null }> {
  const token = getServerEnv().LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error("LINE_CHANNEL_ACCESS_TOKENが設定されていません。");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch("https://api.line.me/v2/bot/message/push", { method: "POST", redirect: "error", signal: controller.signal, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Line-Retry-Key": retryKey }, body: JSON.stringify({ to: lineUserId, messages: [message] }) });
    const accepted = response.status === 200 || response.status === 409;
    let responseBody: unknown = null;
    if (!accepted && response.headers.get("content-type")?.includes("json")) {
      try { responseBody = await response.json(); } catch { responseBody = null; }
    }
    return { accepted, status: response.status, lineRequestId: response.headers.get("x-line-request-id"), lineAcceptedRequestId: response.headers.get("x-line-accepted-request-id"), errorMessageSafe: accepted ? null : safeLineApiError(responseBody) };
  } finally {
    clearTimeout(timeout);
  }
}

async function sendSurveyFlexMessage(input: { client: SupabaseClient; organizationId: string; contactId: string; profileId: string; textContent: string; message: LineFlexMessage; clientRequestId: string; gate: "manual" | "automation" }): Promise<MessageRecord> {
  assertLaunchAction(input.gate === "automation" ? "LINE_AUTOMATION_SEND_ENABLED" : "LINE_MANUAL_SEND_ENABLED");
  const contact = await contactFor(input.client, input.organizationId, input.contactId);
  if (String(contact.friend_status) === "blocked") throw new Error("ブロック中の顧客には送信できません。");
  await assertControlledRecipient(input.client, input.organizationId, String(contact.line_user_id));
  const store = new SupabaseInboxStore(input.client, input.organizationId);
  const conversation = await store.ensureConversationForContact(input.organizationId, input.contactId, new Date().toISOString());
  const existing = await store.findOutboundByClientRequest(input.organizationId, input.clientRequestId);
  if (existing?.status === "accepted" || existing?.status === "sending") return existing;
  const created = existing ? { message: existing } : await store.createOutboundMessage({ organizationId: input.organizationId, conversationId: conversation.id, contactId: input.contactId, textContent: input.textContent, clientRequestId: input.clientRequestId, retryKey: randomUUID(), sentByProfileId: input.profileId });
  const claimed = await store.claimOutboundMessage(input.organizationId, created.message.id, input.profileId);
  const result = await pushSurveyFlexMessage(String(contact.line_user_id), input.message, String(claimed.retryKey));
  await store.recordOutboundAttempt({ organizationId: input.organizationId, messageId: claimed.id, attemptNumber: claimed.attemptCount, httpStatus: result.status, lineRequestId: result.lineRequestId, lineAcceptedRequestId: result.lineAcceptedRequestId, errorClass: result.accepted ? null : "line_rejected", errorMessageSafe: result.errorMessageSafe });
  if (!result.accepted) return store.updateOutboundMessage(input.organizationId, claimed.id, { status: result.status >= 500 ? "retryable_failed" : "permanently_failed", lineRequestId: result.lineRequestId, lineAcceptedRequestId: result.lineAcceptedRequestId, errorClass: "line_rejected", errorCode: String(result.status), errorMessageSafe: result.errorMessageSafe || "アンケート送信がLINE APIに拒否されました。", failedAt: new Date().toISOString() });
  return store.updateOutboundMessage(input.organizationId, claimed.id, { status: "accepted", lineRequestId: result.lineRequestId, lineAcceptedRequestId: result.lineAcceptedRequestId, acceptedAt: new Date().toISOString() });
}

type SurveyReplyEntry = {
  textContent: string;
  message: LineFlexMessage;
  clientRequestId: string;
};

function surveyReplyClientRequestId(clientRequestId: string): string {
  // Reply delivery uses a distinct key so a survey that previously failed through
  // the quota-counted Push API can resume on the next user interaction.
  return `${clientRequestId}:reply-v1`;
}

async function sendSurveyReplyMessages(input: { client: SupabaseClient; organizationId: string; contactId: string; profileId: string; replyToken: string; entries: SurveyReplyEntry[]; gate: "manual" | "automation" }): Promise<MessageRecord[]> {
  assertLaunchAction(input.gate === "automation" ? "LINE_AUTOMATION_SEND_ENABLED" : "LINE_MANUAL_SEND_ENABLED");
  if (!input.replyToken.trim()) throw new Error("LINE Reply Tokenがありません。");
  if (input.entries.length < 1 || input.entries.length > 5) throw new Error("LINE Reply APIは1回につき1〜5件のメッセージを送信できます。");
  const contact = await contactFor(input.client, input.organizationId, input.contactId);
  if (String(contact.friend_status) === "blocked") throw new Error("ブロック中の顧客には送信できません。");
  await assertControlledRecipient(input.client, input.organizationId, String(contact.line_user_id));
  const store = new SupabaseInboxStore(input.client, input.organizationId);
  const conversation = await store.ensureConversationForContact(input.organizationId, input.contactId, new Date().toISOString());
  const records = new Map<string, MessageRecord>();
  const pending: Array<{ entry: SurveyReplyEntry; message: MessageRecord }> = [];

  for (const entry of input.entries) {
    const clientRequestId = surveyReplyClientRequestId(entry.clientRequestId);
    const existing = await store.findOutboundByClientRequest(input.organizationId, clientRequestId);
    if (existing?.status === "accepted" || existing?.status === "sending") {
      records.set(entry.clientRequestId, existing);
      continue;
    }
    const created = existing
      ? { message: existing }
      : await store.createOutboundMessage({ organizationId: input.organizationId, conversationId: conversation.id, contactId: input.contactId, textContent: entry.textContent, clientRequestId, retryKey: randomUUID(), sentByProfileId: input.profileId });
    const claimed = await store.claimOutboundMessage(input.organizationId, created.message.id, input.profileId);
    records.set(entry.clientRequestId, claimed);
    pending.push({ entry, message: claimed });
  }

  if (pending.length) {
    const result = await createLineReplyClient().replyMessages({ replyToken: input.replyToken, messages: pending.map((item) => item.entry.message) });
    const completedAt = new Date().toISOString();
    for (const [index, item] of pending.entries()) {
      await store.recordOutboundAttempt({
        organizationId: input.organizationId,
        messageId: item.message.id,
        attemptNumber: item.message.attemptCount,
        httpStatus: result.httpStatus,
        lineRequestId: result.lineRequestId,
        lineAcceptedRequestId: result.lineAcceptedRequestId,
        errorClass: result.accepted ? null : result.errorClass,
        errorMessageSafe: result.accepted ? null : result.safeMessage
      });
      const updated = result.accepted
        ? await store.updateOutboundMessage(input.organizationId, item.message.id, { status: "accepted", lineRequestId: result.lineRequestId, lineAcceptedRequestId: result.lineAcceptedRequestId, lineSentMessageId: result.lineSentMessageIds[index] || null, acceptedAt: completedAt })
        : await store.updateOutboundMessage(input.organizationId, item.message.id, { status: result.retryable ? "retryable_failed" : "permanently_failed", lineRequestId: result.lineRequestId, lineAcceptedRequestId: result.lineAcceptedRequestId, errorClass: result.errorClass, errorCode: result.errorCode, errorMessageSafe: result.safeMessage, failedAt: completedAt });
      records.set(item.entry.clientRequestId, updated);
    }
  }

  return input.entries.map((entry) => {
    const message = records.get(entry.clientRequestId);
    if (!message) throw new Error("アンケート返信の送信結果を取得できませんでした。");
    return message;
  });
}

function surveyQuestionFlexMessage(input: { text: string; options: QuickReplyOption[]; sessionId: string; questionNumber: number; questionTotal: number }): LineFlexMessage {
  return buildSurveyQuestionMessage({
    accountName: getServerEnv().LINE_EXPECTED_DISPLAY_NAME,
    title: input.text,
    questionNumber: input.questionNumber,
    questionTotal: input.questionTotal,
    answers: input.options.map((option) => ({ label: option.label, data: surveyPostbackData(input.sessionId, option.token) }))
  });
}

async function sendSurveyQuestionMessage(input: { client: SupabaseClient; organizationId: string; contactId: string; profileId: string; text: string; options: QuickReplyOption[]; clientRequestId: string; sessionId: string; gate: "manual" | "automation"; questionNumber: number; questionTotal: number; replyToken?: string }): Promise<MessageRecord> {
  const message = surveyQuestionFlexMessage(input);
  if (input.replyToken?.trim()) {
    const [sent] = await sendSurveyReplyMessages({
      client: input.client,
      organizationId: input.organizationId,
      contactId: input.contactId,
      profileId: input.profileId,
      replyToken: input.replyToken,
      gate: input.gate,
      entries: [{ textContent: input.text, clientRequestId: input.clientRequestId, message }]
    });
    return sent;
  }
  return sendSurveyFlexMessage({
    client: input.client,
    organizationId: input.organizationId,
    contactId: input.contactId,
    profileId: input.profileId,
    textContent: input.text,
    clientRequestId: input.clientRequestId,
    gate: input.gate,
    message
  });
}

type SurveyOptionInput = { key?: string; label: string; tagId?: string };
type SurveyQuestionInput = { key?: string; title: string; options: SurveyOptionInput[] };
type NormalizedSurveyQuestion = { key: string; title: string; options: Array<{ label: string; tagId?: string }> };

function surveyQuestionPublic(question: Row, options: Row[]): Row {
  return {
    id: question.id,
    key: question.question_key,
    title: question.title,
    type: question.question_type,
    options: options.map((option) => ({
      id: option.id,
      key: option.option_key,
      label: option.label,
      tagId: typeof row(option.action_config_json).tagId === "string" ? row(option.action_config_json).tagId : null
    }))
  };
}

function surveyPublic(survey: Row, entries: Array<{ question: Row; options: Row[] }>): Row {
  const questions = entries.map((entry) => surveyQuestionPublic(entry.question, entry.options));
  const settings = row(survey.settings_json);
  return {
    id: survey.id,
    name: survey.name,
    status: survey.status,
    sendOnFollow: survey.send_on_follow === true,
    greetingMessage: typeof settings.greetingMessage === "string" ? settings.greetingMessage : "",
    completionMessage: typeof settings.completionMessage === "string" ? settings.completionMessage : "回答ありがとうございました。",
    postSurveyRichMenuId: typeof settings.postSurveyRichMenuId === "string" ? settings.postSurveyRichMenuId : null,
    richMenuFallbackMinutes: typeof settings.richMenuFallbackMinutes === "number" ? settings.richMenuFallbackMinutes : 30,
    question: questions[0] || null,
    questions
  };
}

function normalizeSurveyQuestions(input: { questionTitle?: string; options?: SurveyOptionInput[]; questions?: SurveyQuestionInput[] }): NormalizedSurveyQuestion[] {
  const source = input.questions?.length ? input.questions : [{ title: input.questionTitle || "", options: input.options || [] }];
  if (source.length < 1 || source.length > 10) throw new Error("質問は1〜10件で設定してください。");
  return source.map((question, questionIndex) => {
    const title = question.title.trim();
    const options = question.options.map((option) => ({ label: option.label.trim(), tagId: option.tagId || undefined })).filter((option) => option.label);
    if (!title || title.length > 500) throw new Error(`質問${questionIndex + 1}の文面を確認してください。`);
    if (options.length < 1 || options.length > 13) throw new Error(`質問${questionIndex + 1}の選択肢は1〜13件で設定してください。`);
    if (options.some((option) => option.label.length > 20)) throw new Error("選択肢名は20文字以内にしてください。");
    return { key: `question_${questionIndex + 1}`, title, options };
  });
}

export async function listLiveSurveys(client: SupabaseClient, organizationId: string): Promise<Row[]> {
  const { data: surveys, error } = await client.from("surveys").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false });
  if (error) throw new Error("アンケートの取得に失敗しました。");
  const result: Row[] = [];
  for (const surveyValue of surveys || []) {
    const survey = row(surveyValue);
    const { data: questions, error: questionError } = await client.from("survey_questions").select("*").eq("organization_id", organizationId).eq("survey_id", String(survey.id)).order("sort_order");
    if (questionError) throw new Error("アンケート質問の取得に失敗しました。");
    const questionRows = (questions || []).map(row);
    let optionRows: Row[] = [];
    if (questionRows.length) {
      const { data: options, error: optionError } = await client.from("survey_options").select("*").eq("organization_id", organizationId).in("question_id", questionRows.map((question) => String(question.id))).eq("is_active", true).order("sort_order");
      if (optionError) throw new Error("アンケート選択肢の取得に失敗しました。");
      optionRows = (options || []).map(row);
    }
    result.push(surveyPublic(survey, questionRows.map((question) => ({ question, options: optionRows.filter((option) => String(option.question_id) === String(question.id)) }))));
  }
  return result;
}

export async function createLiveSurvey(input: { client: SupabaseClient; organizationId: string; profileId: string; name: string; questionTitle?: string; options?: SurveyOptionInput[]; questions?: SurveyQuestionInput[]; greetingMessage?: string; completionMessage?: string; postSurveyRichMenuId?: string; richMenuFallbackMinutes?: number; sendOnFollow?: boolean }): Promise<Row> {
  const name = input.name.trim();
  const questions = normalizeSurveyQuestions(input);
  const greetingMessage = input.greetingMessage?.trim() || "";
  const completionMessage = input.completionMessage?.trim() || "回答ありがとうございました。";
  const postSurveyRichMenuId = input.postSurveyRichMenuId?.trim() || null;
  const richMenuFallbackMinutes = Math.min(Math.max(Math.round(input.richMenuFallbackMinutes ?? 30), 1), 1_440);
  if (!name || name.length > 150) throw new Error("アンケート名を確認してください。");
  if (greetingMessage.length > 500) throw new Error("友だち追加時の挨拶は500文字以内にしてください。");
  if (completionMessage.length > 300) throw new Error("完了メッセージは300文字以内にしてください。");
  const tagIds = [...new Set(questions.flatMap((question) => question.options.map((option) => option.tagId).filter((tagId): tagId is string => Boolean(tagId))))];
  if (tagIds.length) {
    const { data: tags, error: tagError } = await input.client.from("tags").select("id").eq("organization_id", input.organizationId).eq("is_active", true).in("id", tagIds);
    if (tagError || (tags || []).length !== tagIds.length) throw new Error("選択肢に指定したタグが見つかりません。");
  }
  if (postSurveyRichMenuId) {
    const { data: menu, error: menuError } = await input.client.from("rich_menus").select("id, line_rich_menu_id").eq("organization_id", input.organizationId).eq("id", postSurveyRichMenuId).eq("status", "active").maybeSingle();
    if (menuError || !menu || !row(menu).line_rich_menu_id) throw new Error("アンケート完了後に表示する有効なリッチメニューが見つかりません。");
  }
  const { data: survey, error: surveyError } = await input.client.from("surveys").insert({ organization_id: input.organizationId, name, status: "active", allow_multiple_responses: false, settings_json: { greetingMessage, completionMessage, postSurveyRichMenuId, richMenuFallbackMinutes }, created_by_profile_id: input.profileId }).select("*").single();
  if (surveyError || !survey) throw new Error("アンケートを作成できませんでした。同名アンケートがないか確認してください。");
  try {
    const questionRecords = questions.map((question, index) => ({ organization_id: input.organizationId, survey_id: survey.id, question_key: question.key, title: question.title, question_type: "single_choice", is_required: true, sort_order: index }));
    const { data: createdQuestions, error: questionError } = await input.client.from("survey_questions").insert(questionRecords).select("*");
    if (questionError || !createdQuestions || createdQuestions.length !== questions.length) throw new Error("アンケート質問を作成できませんでした。");
    const questionByKey = new Map(createdQuestions.map((question) => [String(question.question_key), row(question)]));
    const orderedQuestions = questions.map((question) => questionByKey.get(question.key)).filter((question): question is Row => Boolean(question));
    if (orderedQuestions.length !== questions.length) throw new Error("作成したアンケート質問を確認できませんでした。");
    const secret = getServerEnv().SURVEY_POSTBACK_TOKEN_SECRET;
    if (!secret) throw new Error("SURVEY_POSTBACK_TOKEN_SECRETが設定されていません。");
    const records = questions.flatMap((question, questionIndex) => question.options.map((option, optionIndex) => ({ organization_id: input.organizationId, question_id: orderedQuestions[questionIndex].id, option_key: `option_${optionIndex + 1}`, label: option.label, value: option.label, sort_order: optionIndex, postback_token: createOpaquePostbackToken(secret, Date.now() + 365 * 24 * 60 * 60 * 1000), action_config_json: option.tagId ? { type: "add_tag", tagId: option.tagId } : {}, next_question_id: orderedQuestions[questionIndex + 1]?.id || null })));
    const { data: createdOptions, error: optionError } = await input.client.from("survey_options").insert(records).select("*");
    if (optionError || !createdOptions) throw new Error("アンケート選択肢を作成できませんでした。");
    if (input.sendOnFollow) await setLiveFollowSurvey(input.client, input.organizationId, String(survey.id));
    const optionRows = createdOptions.map(row);
    return surveyPublic({ ...row(survey), send_on_follow: input.sendOnFollow === true }, orderedQuestions.map((question) => ({ question, options: optionRows.filter((option) => String(option.question_id) === String(question.id)) })));
  } catch (error) {
    await input.client.from("surveys").delete().eq("organization_id", input.organizationId).eq("id", survey.id);
    throw error;
  }
}

export async function updateLiveSurveyExperience(input: { client: SupabaseClient; organizationId: string; surveyId: string; greetingMessage?: string; completionMessage?: string; postSurveyRichMenuId?: string | null; richMenuFallbackMinutes?: number }): Promise<Row> {
  const greetingMessage = input.greetingMessage?.trim() || "";
  const completionMessage = input.completionMessage?.trim() || "回答ありがとうございました。";
  const postSurveyRichMenuId = input.postSurveyRichMenuId?.trim() || null;
  const richMenuFallbackMinutes = Math.min(Math.max(Math.round(input.richMenuFallbackMinutes ?? 30), 1), 1_440);
  if (greetingMessage.length > 500) throw new Error("友だち追加時の挨拶は500文字以内にしてください。");
  if (completionMessage.length > 300) throw new Error("完了メッセージは300文字以内にしてください。");
  const existing = await input.client.from("surveys").select("id, settings_json").eq("organization_id", input.organizationId).eq("id", input.surveyId).maybeSingle();
  if (existing.error || !existing.data) throw new Error("アンケートが見つかりません。");
  if (postSurveyRichMenuId) {
    const menu = await input.client.from("rich_menus").select("id, line_rich_menu_id").eq("organization_id", input.organizationId).eq("id", postSurveyRichMenuId).eq("status", "active").maybeSingle();
    if (menu.error || !menu.data || !row(menu.data).line_rich_menu_id) throw new Error("アンケート後に表示する有効なリッチメニューが見つかりません。");
  }
  const settings = { ...row(existing.data.settings_json), greetingMessage, completionMessage, postSurveyRichMenuId, richMenuFallbackMinutes };
  const updated = await input.client.from("surveys").update({ settings_json: settings, updated_at: new Date().toISOString() }).eq("organization_id", input.organizationId).eq("id", input.surveyId).select("*").single();
  if (updated.error || !updated.data) throw new Error("アンケートの配信体験設定を保存できませんでした。");
  return row(updated.data);
}

export async function setLiveFollowSurvey(client: SupabaseClient, organizationId: string, surveyId: string | null): Promise<string | null> {
  const { data, error } = await client.rpc("minimum_set_follow_survey", { target_organization_id: organizationId, target_survey_id: surveyId });
  if (error) throw new Error(error.code === "23503" ? "有効なアンケートが見つかりません。" : "友だち追加時アンケートを更新できませんでした。");
  return typeof data === "string" ? data : null;
}

async function sendSurveyGreeting(input: { client: SupabaseClient; organizationId: string; contactId: string; profileId: string; greeting: string; questionTotal: number; clientRequestId: string; gate?: "manual" | "automation" }): Promise<void> {
  const greeting = input.greeting.trim();
  if (!greeting) return;
  const sent = await sendSurveyFlexMessage({
    client: input.client,
    organizationId: input.organizationId,
    contactId: input.contactId,
    profileId: input.profileId,
    textContent: greeting,
    clientRequestId: input.clientRequestId,
    gate: input.gate || "automation",
    message: buildSurveyGreetingMessage({ accountName: getServerEnv().LINE_EXPECTED_DISPLAY_NAME, greeting, questionTotal: input.questionTotal })
  });
  if (sent.status !== "accepted") throw new Error(sent.errorMessageSafe || "友だち追加時の挨拶がLINE APIに受け付けられませんでした。");
}

async function scheduleSurveyRichMenuFallback(input: { client: SupabaseClient; organizationId: string; contactId: string; sessionId: string; richMenuId: string | null; delayMinutes: number }): Promise<void> {
  if (!input.richMenuId) return;
  const runAt = surveyRichMenuRunAt(new Date(), input.delayMinutes);
  const { error } = await input.client.from("scheduled_jobs").upsert({
    organization_id: input.organizationId,
    job_type: "survey_rich_menu_fallback",
    resource_type: "survey_session",
    resource_id: input.sessionId,
    contact_id: input.contactId,
    run_at: runAt,
    status: "pending",
    max_attempts: 5,
    idempotency_key: surveyRichMenuJobKey(input.sessionId),
    payload_json: { richMenuId: input.richMenuId },
    updated_at: new Date().toISOString()
  }, { onConflict: "organization_id,idempotency_key", ignoreDuplicates: true });
  if (error) throw new Error("アンケート未完了時のリッチメニュー表示を予約できませんでした。");
}

async function finishSurveyRichMenuFallback(client: SupabaseClient, organizationId: string, sessionId: string): Promise<void> {
  await client.from("scheduled_jobs").update({ status: "succeeded", completed_at: new Date().toISOString(), lease_owner: null, lease_expires_at: null, updated_at: new Date().toISOString() }).eq("organization_id", organizationId).eq("idempotency_key", surveyRichMenuJobKey(sessionId)).in("status", ["pending", "retry_wait", "leased", "running"]);
}

function surveyContinuationGate(): "manual" | "automation" {
  return isLaunchFlagEnabled("LINE_AUTOMATION_SEND_ENABLED") ? "automation" : "manual";
}

async function sendSurveyCompletion(input: { client: SupabaseClient; organizationId: string; contactId: string; survey: Row; sessionId: string; replyToken?: string }): Promise<void> {
  const settings = row(input.survey.settings_json);
  const text = typeof settings.completionMessage === "string" ? settings.completionMessage.trim() : "回答ありがとうございました。";
  const richMenuId = typeof settings.postSurveyRichMenuId === "string" ? settings.postSurveyRichMenuId : null;
  const profileId = await systemProfileId(input.client, input.organizationId);
  if (text) {
    const gate = surveyContinuationGate();
    const clientRequestId = surveyCompletionClientRequestId(input.sessionId);
    const message = buildSurveyCompletionMessage({ accountName: getServerEnv().LINE_EXPECTED_DISPLAY_NAME, message: text, richMenuLinked: Boolean(richMenuId) });
    const sent = input.replyToken?.trim()
      ? (await sendSurveyReplyMessages({ client: input.client, organizationId: input.organizationId, contactId: input.contactId, profileId, replyToken: input.replyToken, gate, entries: [{ textContent: text, clientRequestId, message }] }))[0]
      : await sendSurveyFlexMessage({ client: input.client, organizationId: input.organizationId, contactId: input.contactId, profileId, textContent: text, clientRequestId, gate, message });
    if (sent.status !== "accepted") throw new Error(sent.errorMessageSafe || "アンケート完了メッセージがLINE APIに受け付けられませんでした。");
  }
  if (richMenuId) {
    await linkLiveRichMenu({ client: input.client, organizationId: input.organizationId, contactId: input.contactId, richMenuId, sourceType: "survey" });
    await finishSurveyRichMenuFallback(input.client, input.organizationId, input.sessionId);
  }
}

export async function startLiveSurvey(input: { client: SupabaseClient; organizationId: string; surveyId: string; contactId?: string; profileId: string; gate?: "manual" | "automation"; clientRequestId?: string; includeGreeting?: boolean; greetingClientRequestId?: string; replyToken?: string }): Promise<MessageRecord> {
  assertLaunchAction(input.gate === "automation" ? "LINE_AUTOMATION_SEND_ENABLED" : "LINE_MANUAL_SEND_ENABLED");
  const contact = await resolveContact(input.client, input.organizationId, input.contactId);
  const contactId = String(contact.id);
  await assertControlledRecipient(input.client, input.organizationId, String(contact.line_user_id));
  const { data: survey, error: surveyError } = await input.client.from("surveys").select("*").eq("organization_id", input.organizationId).eq("id", input.surveyId).eq("status", "active").single();
  if (surveyError || !survey) throw new Error("有効なアンケートが見つかりません。");
  const settings = row(survey.settings_json);
  const richMenuId = typeof settings.postSurveyRichMenuId === "string" ? settings.postSurveyRichMenuId : null;
  const fallbackMinutes = typeof settings.richMenuFallbackMinutes === "number" ? Math.min(Math.max(Math.round(settings.richMenuFallbackMinutes), 1), 1_440) : 30;
  const { data: questions, error: questionError } = await input.client.from("survey_questions").select("*").eq("organization_id", input.organizationId).eq("survey_id", input.surveyId).order("sort_order");
  const question = questions?.[0];
  if (questionError || !question || !questions?.length) throw new Error("アンケート質問が見つかりません。");
  const { data: options, error: optionError } = await input.client.from("survey_options").select("id, label, postback_token").eq("organization_id", input.organizationId).eq("question_id", question.id).eq("is_active", true).order("sort_order");
  if (optionError || !options?.length) throw new Error("アンケート選択肢が見つかりません。");
  const { data: cancelledSessions } = await input.client.from("survey_sessions").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("organization_id", input.organizationId).eq("survey_id", input.surveyId).eq("contact_id", contactId).eq("status", "active").select("id");
  const cancelledSessionIds = (cancelledSessions || []).map((value) => String(row(value).id));
  if (cancelledSessionIds.length) await input.client.from("scheduled_jobs").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("organization_id", input.organizationId).eq("job_type", "survey_rich_menu_fallback").in("resource_id", cancelledSessionIds).in("status", ["pending", "retry_wait"]);
  const { data: session, error: sessionError } = await input.client.from("survey_sessions").insert({ organization_id: input.organizationId, survey_id: input.surveyId, contact_id: contactId, status: "active", current_question_id: question.id, expires_at: new Date(Date.now() + getServerEnv().SURVEY_DEFAULT_SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString() }).select("id").single();
  if (sessionError || !session) throw new Error("アンケートセッションを作成できませんでした。");
  try {
    await scheduleSurveyRichMenuFallback({ client: input.client, organizationId: input.organizationId, contactId, sessionId: String(session.id), richMenuId, delayMinutes: fallbackMinutes });
    const greeting = input.includeGreeting && typeof settings.greetingMessage === "string" ? settings.greetingMessage.trim() : "";
    const gate: "manual" | "automation" = input.gate || "manual";
    const questionInput = {
      client: input.client,
      organizationId: input.organizationId,
      contactId,
      profileId: input.profileId,
      text: String(question.title),
      options: options.map((option) => ({ id: String(option.id), label: String(option.label), token: String(option.postback_token) })),
      clientRequestId: input.clientRequestId || surveyQuestionClientRequestId(String(session.id), String(question.id)),
      sessionId: String(session.id),
      gate,
      questionNumber: 1,
      questionTotal: questions.length
    };
    if (input.replyToken?.trim()) {
      const entries: SurveyReplyEntry[] = [];
      if (greeting) {
        entries.push({
          textContent: greeting,
          clientRequestId: input.greetingClientRequestId || surveyGreetingClientRequestId(`manual-${String(session.id)}`, input.surveyId, contactId),
          message: buildSurveyGreetingMessage({ accountName: getServerEnv().LINE_EXPECTED_DISPLAY_NAME, greeting, questionTotal: questions.length })
        });
      }
      entries.push({ textContent: questionInput.text, clientRequestId: questionInput.clientRequestId, message: surveyQuestionFlexMessage(questionInput) });
      const sent = await sendSurveyReplyMessages({ client: input.client, organizationId: input.organizationId, contactId, profileId: input.profileId, replyToken: input.replyToken, entries, gate: questionInput.gate });
      const questionMessage = sent[sent.length - 1];
      if (!questionMessage || sent.some((message) => message.status !== "accepted")) throw new Error(questionMessage?.errorMessageSafe || "アンケートがLINE Reply APIに受け付けられませんでした。");
      return questionMessage;
    }
    if (input.includeGreeting) {
      await sendSurveyGreeting({
        client: input.client,
        organizationId: input.organizationId,
        contactId,
        profileId: input.profileId,
        greeting,
        questionTotal: questions.length,
        clientRequestId: input.greetingClientRequestId || surveyGreetingClientRequestId(`manual-${String(session.id)}`, input.surveyId, contactId),
        gate: input.gate || "manual"
      });
    }
    const message = await sendSurveyQuestionMessage(questionInput);
    if (message.status !== "accepted") throw new Error(message.errorMessageSafe || "アンケートがLINE APIに受け付けられませんでした。");
    return message;
  } catch (error) {
    await input.client.from("survey_sessions").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("organization_id", input.organizationId).eq("id", session.id);
    await input.client.from("scheduled_jobs").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("organization_id", input.organizationId).eq("idempotency_key", surveyRichMenuJobKey(String(session.id))).in("status", ["pending", "retry_wait"]);
    throw error;
  }
}

export async function sendFollowSurveyIfConfigured(input: { client: SupabaseClient; organizationId: string; contactId: string; webhookEventId: string; replyToken?: string }): Promise<"sent" | "not_configured" | "disabled" | "recipient_not_allowed"> {
  if (!isLaunchFlagEnabled("LINE_AUTOMATION_SEND_ENABLED")) return "disabled";
  const { data: survey, error } = await input.client.from("surveys").select("id, settings_json").eq("organization_id", input.organizationId).eq("status", "active").eq("send_on_follow", true).maybeSingle();
  if (error) throw new Error("友だち追加時アンケートを取得できませんでした。");
  if (!survey) return "not_configured";
  const contact = await contactFor(input.client, input.organizationId, input.contactId);
  if (!await recipientIsAllowed(input.client, input.organizationId, String(contact.line_user_id))) return "recipient_not_allowed";
  const profileId = await systemProfileId(input.client, input.organizationId);
  const surveyId = String(row(survey).id);
  await startLiveSurvey({
    client: input.client,
    organizationId: input.organizationId,
    surveyId,
    contactId: input.contactId,
    profileId,
    gate: "automation",
    clientRequestId: followSurveyClientRequestId(input.webhookEventId, surveyId, input.contactId),
    greetingClientRequestId: surveyGreetingClientRequestId(input.webhookEventId, surveyId, input.contactId),
    includeGreeting: true,
    replyToken: input.replyToken
  });
  return "sent";
}

async function applySurveyTagAction(input: { client: SupabaseClient; organizationId: string; contactId: string; survey: Row; option: Row; responseId: string; sessionId: string }): Promise<string | undefined> {
  const action = row(input.option.action_config_json);
  const tagId = typeof action.tagId === "string" ? action.tagId : undefined;
  if (!tagId || action.type !== "add_tag") return undefined;
  const idempotencyKey = `survey-tag:${input.sessionId}:${String(input.option.id)}`;
  const { data: existing } = await input.client.from("survey_action_executions").select("id, status").eq("organization_id", input.organizationId).eq("idempotency_key", idempotencyKey).maybeSingle();
  if (existing && row(existing).status === "succeeded") return tagId;
  const execution = await input.client.from("survey_action_executions").upsert({ organization_id: input.organizationId, survey_response_id: input.responseId, action_type: "add_tag", idempotency_key: idempotencyKey, status: "pending", error_message_safe: null, executed_at: null }, { onConflict: "organization_id,idempotency_key" }).select("id").single();
  if (execution.error || !execution.data) throw new Error("アンケート回答アクションを登録できませんでした。");
  try {
    const profileId = await systemProfileId(input.client, input.organizationId);
    await assignLiveTag({ client: input.client, organizationId: input.organizationId, contactId: input.contactId, tagId, sourceType: "survey", sourceId: String(input.survey.id), actorProfileId: profileId });
    await input.client.from("survey_action_executions").update({ status: "succeeded", error_message_safe: null, executed_at: new Date().toISOString() }).eq("organization_id", input.organizationId).eq("id", execution.data.id);
    return tagId;
  } catch (error) {
    await input.client.from("survey_action_executions").update({ status: "failed", error_message_safe: error instanceof Error ? error.message.slice(0, 500) : "回答アクション失敗", executed_at: new Date().toISOString() }).eq("organization_id", input.organizationId).eq("id", execution.data.id);
    throw error;
  }
}

export async function handleLiveSurveyPostback(input: { client: SupabaseClient; organizationId: string; contactId: string; data: string; webhookEventId: string; replyToken?: string }): Promise<{ handled: boolean; duplicate: boolean; tagId?: string; nextQuestionId?: string; completed?: boolean }> {
  const postback = parseSurveyPostbackData(input.data);
  if (!postback) return { handled: false, duplicate: false };
  const contact = await contactFor(input.client, input.organizationId, input.contactId);
  if (!await recipientIsAllowed(input.client, input.organizationId, String(contact.line_user_id))) {
    return { handled: false, duplicate: false };
  }
  const secret = getServerEnv().SURVEY_POSTBACK_TOKEN_SECRET;
  if (!secret || !verifyOpaquePostbackToken(postback.token, secret)) throw new Error("アンケート回答トークンが無効または期限切れです。");
  const { data: tappedOption, error: optionError } = await input.client.from("survey_options").select("*").eq("organization_id", input.organizationId).eq("postback_token", postback.token).eq("is_active", true).maybeSingle();
  if (optionError || !tappedOption) throw new Error("アンケートの選択肢が見つかりません。");
  const { data: question, error: questionError } = await input.client.from("survey_questions").select("*").eq("organization_id", input.organizationId).eq("id", String(row(tappedOption).question_id)).single();
  if (questionError || !question) throw new Error("アンケート質問が見つかりません。");
  const { data: survey, error: surveyError } = await input.client.from("surveys").select("*").eq("organization_id", input.organizationId).eq("id", String(row(question).survey_id)).eq("status", "active").single();
  if (surveyError || !survey) throw new Error("有効なアンケートが見つかりません。");
  const sessionResult = postback.sessionId
    ? await input.client.from("survey_sessions").select("*").eq("organization_id", input.organizationId).eq("id", postback.sessionId).eq("survey_id", String(row(survey).id)).eq("contact_id", input.contactId).in("status", ["active", "completed"]).maybeSingle()
    : await input.client.from("survey_sessions").select("*").eq("organization_id", input.organizationId).eq("survey_id", String(row(survey).id)).eq("contact_id", input.contactId).in("status", ["active", "completed"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data: session, error: sessionError } = sessionResult;
  if (sessionError || !session) throw new Error("アンケートセッションがありません。");
  const sessionRow = row(session);
  const responseKey = surveyResponseKey(String(sessionRow.id), String(row(question).id));
  let { data: response } = await input.client.from("survey_responses").select("id, option_id").eq("organization_id", input.organizationId).eq("response_key", responseKey).maybeSingle();
  let duplicate = Boolean(response);
  if (!response) {
    if (sessionRow.status !== "active" || Date.parse(String(sessionRow.expires_at)) <= Date.now()) throw new Error("アンケートセッションが期限切れです。");
    if (String(sessionRow.current_question_id) !== String(row(question).id)) throw new Error("この回答ボタンは現在の質問ではありません。");
    const inserted = await input.client.from("survey_responses").insert({ organization_id: input.organizationId, survey_id: survey.id, question_id: question.id, option_id: row(tappedOption).id, contact_id: input.contactId, session_id: sessionRow.id, response_key: responseKey, answer_text: row(tappedOption).value, webhook_event_id: input.webhookEventId }).select("id, option_id").single();
    if (inserted.error && !isUniqueViolation(inserted.error)) throw new Error("アンケート回答を保存できませんでした。");
    response = inserted.data;
    if (!response) {
      const raced = await input.client.from("survey_responses").select("id, option_id").eq("organization_id", input.organizationId).eq("response_key", responseKey).single();
      if (raced.error || !raced.data) throw new Error("保存済みアンケート回答を取得できませんでした。");
      response = raced.data;
      duplicate = true;
    }
  }
  let selectedOption = row(tappedOption);
  if (String(row(response).option_id) !== String(selectedOption.id)) {
    const selected = await input.client.from("survey_options").select("*").eq("organization_id", input.organizationId).eq("id", String(row(response).option_id)).single();
    if (selected.error || !selected.data) throw new Error("保存済み回答の選択肢が見つかりません。");
    selectedOption = row(selected.data);
  }
  const tagId = await applySurveyTagAction({ client: input.client, organizationId: input.organizationId, contactId: input.contactId, survey: row(survey), option: selectedOption, responseId: String(row(response).id), sessionId: String(sessionRow.id) });
  const questionId = String(row(question).id);
  const currentQuestionId = String(sessionRow.current_question_id);
  const nextQuestionId = typeof selectedOption.next_question_id === "string" ? selectedOption.next_question_id : null;
  const now = new Date().toISOString();

  if (nextQuestionId) {
    if (sessionRow.status === "completed" || (currentQuestionId !== questionId && currentQuestionId !== nextQuestionId)) {
      return { handled: true, duplicate: true, tagId, completed: sessionRow.status === "completed" };
    }
    if (currentQuestionId === questionId) {
      const advanced = await input.client.from("survey_sessions").update({ current_question_id: nextQuestionId, last_interaction_at: now, updated_at: now }).eq("organization_id", input.organizationId).eq("id", sessionRow.id).eq("status", "active").eq("current_question_id", questionId);
      if (advanced.error) throw new Error("アンケートの次の質問へ進めませんでした。");
    }
    const { data: surveyQuestions, error: nextQuestionError } = await input.client.from("survey_questions").select("*").eq("organization_id", input.organizationId).eq("survey_id", String(row(survey).id)).order("sort_order");
    const nextQuestionIndex = (surveyQuestions || []).findIndex((item) => String(row(item).id) === nextQuestionId);
    const nextQuestion = nextQuestionIndex >= 0 ? surveyQuestions?.[nextQuestionIndex] : null;
    if (nextQuestionError || !nextQuestion || !surveyQuestions?.length) throw new Error("次のアンケート質問が見つかりません。");
    const { data: nextOptions, error: nextOptionError } = await input.client.from("survey_options").select("id, label, postback_token").eq("organization_id", input.organizationId).eq("question_id", nextQuestionId).eq("is_active", true).order("sort_order");
    if (nextOptionError || !nextOptions?.length) throw new Error("次のアンケート選択肢が見つかりません。");
    const profileId = await systemProfileId(input.client, input.organizationId);
    const message = await sendSurveyQuestionMessage({ client: input.client, organizationId: input.organizationId, contactId: input.contactId, profileId, text: String(nextQuestion.title), options: nextOptions.map((option) => ({ id: String(option.id), label: String(option.label), token: String(option.postback_token) })), clientRequestId: surveyQuestionClientRequestId(String(sessionRow.id), nextQuestionId), sessionId: String(sessionRow.id), gate: surveyContinuationGate(), questionNumber: nextQuestionIndex + 1, questionTotal: surveyQuestions.length, replyToken: input.replyToken });
    if (message.status !== "accepted") throw new Error(message.errorMessageSafe || "次のアンケート質問がLINE APIに受け付けられませんでした。");
    return { handled: true, duplicate, tagId, nextQuestionId, completed: false };
  }

  if (sessionRow.status === "active" && currentQuestionId !== questionId) {
    return { handled: true, duplicate: true, tagId, completed: false };
  }
  const completed = await input.client.from("survey_sessions").update({ status: "completed", completed_at: sessionRow.completed_at || now, last_interaction_at: now, updated_at: now }).eq("organization_id", input.organizationId).eq("id", sessionRow.id);
  if (completed.error) throw new Error("アンケート完了状態を保存できませんでした。");
  await sendSurveyCompletion({ client: input.client, organizationId: input.organizationId, contactId: input.contactId, survey: row(survey), sessionId: String(sessionRow.id), replyToken: input.replyToken });
  return { handled: true, duplicate, tagId, completed: true };
}

export async function listLiveScenarios(client: SupabaseClient, organizationId: string): Promise<Row[]> {
  const { data, error } = await client.from("automation_scenarios").select("id, name, trigger_type, trigger_config_json, status, version, created_at").eq("organization_id", organizationId).eq("trigger_type", "tag_added").order("created_at", { ascending: false });
  if (error) throw new Error("automationの取得に失敗しました。");
  const result: Row[] = [];
  for (const value of data || []) {
    const scenario = row(value);
    const { data: steps } = await client.from("automation_steps").select("config_json").eq("organization_id", organizationId).eq("scenario_id", String(scenario.id)).eq("step_type", "send_message").order("step_order").limit(1);
    result.push({ ...scenario, triggerType: scenario.trigger_type, tagId: row(scenario.trigger_config_json).tagId || null, text: row(row((steps || [])[0]).config_json).text || "" });
  }
  return result;
}

export async function createLiveTagScenario(input: { client: SupabaseClient; organizationId: string; profileId: string; name: string; tagId: string; text: string }): Promise<Row> {
  const name = input.name.trim();
  const text = input.text.trim();
  if (!name || name.length > 150 || !text || text.length > 5000) throw new Error("automation名または本文を確認してください。");
  const { data: tag } = await input.client.from("tags").select("id").eq("organization_id", input.organizationId).eq("id", input.tagId).eq("is_active", true).maybeSingle();
  if (!tag) throw new Error("起点タグが見つかりません。");
  const { data: scenario, error } = await input.client.from("automation_scenarios").insert({ organization_id: input.organizationId, name, trigger_type: "tag_added", trigger_config_json: { tagId: input.tagId }, status: "draft", allow_reentry: false, created_by_profile_id: input.profileId }).select("*").single();
  if (error || !scenario) throw new Error("タグ起点の即時配信を作成できませんでした。");
  const { error: stepError } = await input.client.from("automation_steps").insert({ organization_id: input.organizationId, scenario_id: scenario.id, step_order: 0, step_type: "send_message", config_json: { tagId: input.tagId, text } });
  if (stepError) { await input.client.from("automation_scenarios").delete().eq("organization_id", input.organizationId).eq("id", scenario.id); throw new Error("即時配信メッセージを保存できませんでした。"); }
  return row(scenario);
}

export async function activateLiveScenario(client: SupabaseClient, organizationId: string, scenarioId: string): Promise<Row> {
  const selected = await client.from("automation_scenarios").select("id, trigger_config_json").eq("organization_id", organizationId).eq("id", scenarioId).eq("trigger_type", "tag_added").single();
  if (selected.error || !selected.data) throw new Error("即時配信設定が見つかりません。");
  const tagId = row(row(selected.data).trigger_config_json).tagId;
  if (typeof tagId !== "string") throw new Error("起点タグが未設定です。");
  const active = await client.from("automation_scenarios").select("id, trigger_config_json").eq("organization_id", organizationId).eq("trigger_type", "tag_added").eq("status", "active");
  const conflicts = (active.data || []).map(row).filter((value) => value.id !== scenarioId && row(value.trigger_config_json).tagId === tagId).map((value) => String(value.id));
  if (conflicts.length) await client.from("automation_scenarios").update({ status: "paused", updated_at: new Date().toISOString() }).eq("organization_id", organizationId).in("id", conflicts);
  const { data, error } = await client.from("automation_scenarios").update({ status: "active", updated_at: new Date().toISOString() }).eq("organization_id", organizationId).eq("id", scenarioId).select("*").single();
  if (error || !data) throw new Error("即時配信を有効化できませんでした。");
  return row(data);
}

function richMenuAction(action: RichMenuActionInput): Row {
  const value = action.value.trim();
  if (action.type === "uri") {
    if (!value || value.length > 1_000) throw new Error("リッチメニューURLは1〜1000文字にしてください。");
    let url: URL;
    try { url = new URL(value); } catch { throw new Error("リッチメニューのURLが不正です。"); }
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("リッチメニューURLはhttpまたはhttpsにしてください。");
    return { type: "uri", label: "開く", uri: url.toString() };
  }
  if (action.type === "openKeyboard") {
    if (value.length > 300) throw new Error("リッチメニューの入力文は300文字以内にしてください。");
    return {
      type: "postback",
      label: "相談する",
      data: "minimum_launch_action=chat_consultation",
      inputOption: "openKeyboard",
      ...(value ? { fillInText: value } : {})
    };
  }
  if (!value || value.length > 300) throw new Error("リッチメニューの送信文は1〜300文字にしてください。");
  return { type: "message", label: "送信", text: value };
}

export async function createLiveRichMenu(input: { client: SupabaseClient; organizationId: string; profileId: string; name: string; tagId: string; chatBarText: string; layoutId: string; actions: RichMenuActionInput[]; imageBytes: Uint8Array; imageContentType: string; applyExisting?: boolean }): Promise<Row> {
  assertLaunchAction("LINE_RICH_MENU_MUTATION_ENABLED");
  const name = input.name.trim();
  const chatBarText = input.chatBarText.trim();
  if (!name || name.length > 150) throw new Error("リッチメニュー名は1〜150文字にしてください。");
  if (!chatBarText || chatBarText.length > 14) throw new Error("チャットバー文字は1〜14文字にしてください。");
  const { data: tag } = await input.client.from("tags").select("id").eq("organization_id", input.organizationId).eq("id", input.tagId).eq("is_active", true).maybeSingle();
  if (!tag) throw new Error("リッチメニューの対象タグが見つかりません。");
  const image = validateRichMenuImage(input.imageBytes, input.imageContentType);
  const bounds = scaleRichMenuLayout(input.layoutId, image.width, image.height);
  if (input.actions.length !== bounds.length) throw new Error("レイアウト内のすべてのボタンを設定してください。");
  const definition = {
    size: { width: image.width, height: image.height },
    selected: RICH_MENU_OPENS_BY_DEFAULT,
    name,
    chatBarText,
    areas: bounds.map((area, index) => ({ bounds: area, action: richMenuAction(input.actions[index]) }))
  };
  await lineRequest("/v2/bot/richmenu/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(definition) });
  const created = await lineRequest("/v2/bot/richmenu", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(definition) });
  const lineId = typeof created.body.richMenuId === "string" ? created.body.richMenuId : null;
  if (!lineId) throw new Error("LINE rich menu IDを取得できませんでした。");
  let previousRuleIds: string[] = [];
  try {
    const body = input.imageBytes.buffer.slice(input.imageBytes.byteOffset, input.imageBytes.byteOffset + input.imageBytes.byteLength) as ArrayBuffer;
    await lineRequest(`/v2/bot/richmenu/${encodeURIComponent(lineId)}/content`, { method: "POST", headers: { "Content-Type": image.contentType }, body }, true);
    const { data: menu, error } = await input.client.from("rich_menus").insert({ organization_id: input.organizationId, name, line_rich_menu_id: lineId, chat_bar_text: chatBarText, width: image.width, height: image.height, selected: RICH_MENU_OPENS_BY_DEFAULT, definition_json: definition, status: "active", is_default: false, managed_by: "api", created_by_profile_id: input.profileId }).select("*").single();
    if (error || !menu) throw new Error("リッチメニューをDBへ保存できませんでした。");
    const areaResult = await input.client.from("rich_menu_areas").insert(definition.areas.map((area, areaOrder) => ({ organization_id: input.organizationId, rich_menu_id: menu.id, area_order: areaOrder, ...area.bounds, action_type: area.action.type, action_config_json: area.action })));
    if (areaResult.error) throw new Error("リッチメニュー領域を保存できませんでした。");
    const previousRules = await input.client.from("rich_menu_rules").select("id").eq("organization_id", input.organizationId).eq("tag_id", input.tagId).eq("is_active", true);
    if (previousRules.error) throw new Error("既存のリッチメニュー条件を取得できませんでした。");
    previousRuleIds = (previousRules.data || []).map((value) => String(row(value).id));
    if (previousRuleIds.length) {
      const paused = await input.client.from("rich_menu_rules").update({ is_active: false, updated_at: new Date().toISOString() }).eq("organization_id", input.organizationId).in("id", previousRuleIds);
      if (paused.error) throw new Error("既存のリッチメニュー条件を停止できませんでした。");
    }
    const rule = await input.client.from("rich_menu_rules").insert({ organization_id: input.organizationId, rich_menu_id: menu.id, tag_id: input.tagId, priority: 0, conditions_json: { tagId: input.tagId }, is_active: true }).select("id").single();
    if (rule.error || !rule.data) {
      throw new Error("リッチメニューのタグ条件を保存できませんでした。");
    }
    const applied = input.applyExisting === false ? { applied: 0, failed: 0 } : await applyRichMenuRuleToExistingContacts(input.client, input.organizationId, input.tagId);
    return { ...row(menu), tagId: input.tagId, appliedCount: applied.applied, failedCount: applied.failed };
  } catch (error) {
    await input.client.from("rich_menus").delete().eq("organization_id", input.organizationId).eq("line_rich_menu_id", lineId);
    if (previousRuleIds.length) {
      await input.client.from("rich_menu_rules").update({ is_active: true, updated_at: new Date().toISOString() }).eq("organization_id", input.organizationId).in("id", previousRuleIds);
    }
    await lineRequest(`/v2/bot/richmenu/${encodeURIComponent(lineId)}`, { method: "DELETE" }).catch(() => undefined);
    throw error;
  }
}

export async function listLiveRichMenus(client: SupabaseClient, organizationId: string): Promise<Row[]> {
  const [menus, rules, tags] = await Promise.all([
    client.from("rich_menus").select("*").eq("organization_id", organizationId).neq("status", "deleted").order("created_at", { ascending: false }),
    client.from("rich_menu_rules").select("rich_menu_id, tag_id, is_active, priority").eq("organization_id", organizationId).eq("is_active", true),
    client.from("tags").select("id, name").eq("organization_id", organizationId)
  ]);
  if (menus.error || rules.error || tags.error) throw new Error("リッチメニューの取得に失敗しました。");
  const tagNames = new Map((tags.data || []).map((value) => [String(row(value).id), String(row(value).name)]));
  const result: Row[] = [];
  for (const menuValue of menus.data || []) {
    const menu = row(menuValue);
    const rule = row((rules.data || []).find((value) => String(row(value).rich_menu_id) === String(menu.id)));
    const { count } = await client.from("rich_menu_assignments").select("contact_id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("rich_menu_id", String(menu.id)).eq("status", "synced");
    result.push({ ...menu, isDefault: menu.is_default === true, opensByDefault: menu.selected === true && row(menu.definition_json).selected === true, linkCount: count || 0, tagId: rule.tag_id || null, tagName: rule.tag_id ? tagNames.get(String(rule.tag_id)) || "削除済みタグ" : null });
  }
  return result;
}

export async function setLiveDefaultRichMenu(input: {
  client: SupabaseClient;
  organizationId: string;
  richMenuId: string;
}): Promise<{ lineRichMenuId: string; unchanged: boolean }> {
  assertLaunchAction("LINE_RICH_MENU_MUTATION_ENABLED");
  const selected = await input.client.from("rich_menus").select("id, line_rich_menu_id, is_default, status").eq("organization_id", input.organizationId).eq("id", input.richMenuId).eq("status", "active").maybeSingle();
  if (selected.error || !selected.data || !row(selected.data).line_rich_menu_id) throw new Error("基本リッチメニューが見つかりません。");
  const menu = row(selected.data);
  const lineRichMenuId = String(menu.line_rich_menu_id);
  const previous = await input.client.from("rich_menus").select("id, line_rich_menu_id").eq("organization_id", input.organizationId).eq("is_default", true).neq("id", input.richMenuId).maybeSingle();

  await defaultRichMenuRequest(`/v2/bot/user/all/richmenu/${encodeURIComponent(lineRichMenuId)}`, { method: "POST" });
  const now = new Date().toISOString();
  const cleared = await input.client.from("rich_menus").update({ is_default: false, updated_at: now }).eq("organization_id", input.organizationId).eq("is_default", true).neq("id", input.richMenuId);
  const marked = await input.client.from("rich_menus").update({ is_default: true, updated_at: now }).eq("organization_id", input.organizationId).eq("id", input.richMenuId);
  if (cleared.error || marked.error) {
    const previousLineId = previous.data && row(previous.data).line_rich_menu_id ? String(row(previous.data).line_rich_menu_id) : null;
    if (previousLineId) await defaultRichMenuRequest(`/v2/bot/user/all/richmenu/${encodeURIComponent(previousLineId)}`, { method: "POST" }).catch(() => undefined);
    else await defaultRichMenuRequest("/v2/bot/user/all/richmenu", { method: "DELETE" }).catch(() => undefined);
    await input.client.from("rich_menus").update({ is_default: false, updated_at: now }).eq("organization_id", input.organizationId).eq("id", input.richMenuId);
    if (previous.data?.id) await input.client.from("rich_menus").update({ is_default: true, updated_at: now }).eq("organization_id", input.organizationId).eq("id", String(previous.data.id));
    throw new Error("基本リッチメニューの設定状態を保存できませんでした。");
  }
  return { lineRichMenuId, unchanged: menu.is_default === true };
}

async function intendedRichMenuContactIds(client: SupabaseClient, organizationId: string, richMenuId: string): Promise<string[]> {
  const ids = new Set<string>();
  const [assignments, rules, surveys] = await Promise.all([
    client.from("rich_menu_assignments").select("contact_id").eq("organization_id", organizationId).eq("rich_menu_id", richMenuId).neq("status", "removed"),
    client.from("rich_menu_rules").select("tag_id").eq("organization_id", organizationId).eq("rich_menu_id", richMenuId).eq("is_active", true),
    client.from("surveys").select("id, settings_json").eq("organization_id", organizationId).contains("settings_json", { postSurveyRichMenuId: richMenuId })
  ]);
  if (assignments.error || rules.error || surveys.error) throw new Error("リッチメニューの対象顧客を取得できませんでした。");
  for (const value of assignments.data || []) ids.add(String(row(value).contact_id));

  const tagIds = (rules.data || []).map((value) => String(row(value).tag_id));
  if (tagIds.length) {
    const tagAssignments = await client.from("contact_tag_assignments").select("contact_id").eq("organization_id", organizationId).in("tag_id", tagIds).is("removed_at", null);
    if (tagAssignments.error) throw new Error("リッチメニュー対象タグを取得できませんでした。");
    for (const value of tagAssignments.data || []) ids.add(String(row(value).contact_id));
  }

  for (const surveyValue of surveys.data || []) {
    const survey = row(surveyValue);
    const settings = row(survey.settings_json);
    const fallbackMinutes = typeof settings.richMenuFallbackMinutes === "number"
      ? Math.min(Math.max(Math.round(settings.richMenuFallbackMinutes), 1), 1_440)
      : 30;
    const sessions = await client.from("survey_sessions").select("contact_id, status, started_at").eq("organization_id", organizationId).eq("survey_id", String(survey.id)).in("status", ["active", "completed"]);
    if (sessions.error) throw new Error("アンケートのリッチメニュー対象者を取得できませんでした。");
    const fallbackAt = Date.now() - fallbackMinutes * 60 * 1000;
    for (const value of sessions.data || []) {
      const session = row(value);
      if (session.status === "completed" || Date.parse(String(session.started_at)) <= fallbackAt) {
        ids.add(String(session.contact_id));
      }
    }
  }
  return [...ids];
}

export async function repairLiveRichMenuDisplay(input: {
  client: SupabaseClient;
  organizationId: string;
  richMenuId: string;
}): Promise<{ recreated: boolean; relinked: number; failed: number }> {
  assertLaunchAction("LINE_RICH_MENU_MUTATION_ENABLED");
  const selected = await input.client.from("rich_menus").select("id, name, line_rich_menu_id, definition_json, selected, is_default, status").eq("organization_id", input.organizationId).eq("id", input.richMenuId).eq("status", "active").maybeSingle();
  if (selected.error || !selected.data || !row(selected.data).line_rich_menu_id) throw new Error("修復するリッチメニューが見つかりません。");
  const menu = row(selected.data);
  let recreated = false;
  const currentLineId = String(menu.line_rich_menu_id);
  const remote = await lineRequest(`/v2/bot/richmenu/${encodeURIComponent(currentLineId)}`);

  if (remote.body.selected !== true || menu.selected !== true || row(menu.definition_json).selected !== true) {
    const image = await lineContentRequest(`/v2/bot/richmenu/${encodeURIComponent(currentLineId)}/content`);
    const definition = {
      size: row(remote.body.size),
      selected: RICH_MENU_OPENS_BY_DEFAULT,
      name: typeof remote.body.name === "string" ? remote.body.name : String(menu.name),
      chatBarText: typeof remote.body.chatBarText === "string" ? remote.body.chatBarText : "メニュー",
      areas: Array.isArray(remote.body.areas) ? remote.body.areas : []
    };
    await lineRequest("/v2/bot/richmenu/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(definition) });
    const created = await lineRequest("/v2/bot/richmenu", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(definition) });
    const newLineId = typeof created.body.richMenuId === "string" ? created.body.richMenuId : null;
    if (!newLineId) throw new Error("自動表示用のLINE rich menu IDを取得できませんでした。");
    try {
      const body = image.bytes.buffer.slice(image.bytes.byteOffset, image.bytes.byteOffset + image.bytes.byteLength) as ArrayBuffer;
      await lineRequest(`/v2/bot/richmenu/${encodeURIComponent(newLineId)}/content`, { method: "POST", headers: { "Content-Type": image.contentType }, body }, true);
      const updated = await input.client.from("rich_menus").update({ line_rich_menu_id: newLineId, selected: RICH_MENU_OPENS_BY_DEFAULT, definition_json: definition, updated_at: new Date().toISOString() }).eq("organization_id", input.organizationId).eq("id", input.richMenuId);
      if (updated.error) throw new Error("自動表示用リッチメニューをDBへ保存できませんでした。");
      if (menu.is_default === true) await defaultRichMenuRequest(`/v2/bot/user/all/richmenu/${encodeURIComponent(newLineId)}`, { method: "POST" });
      recreated = true;
    } catch (error) {
      await lineRequest(`/v2/bot/richmenu/${encodeURIComponent(newLineId)}`, { method: "DELETE" }).catch(() => undefined);
      throw error;
    }
  }

  const contactIds = await intendedRichMenuContactIds(input.client, input.organizationId, input.richMenuId);
  let relinked = 0;
  let failed = 0;
  for (const contactId of contactIds) {
    try {
      await linkLiveRichMenu({ client: input.client, organizationId: input.organizationId, contactId, richMenuId: input.richMenuId, sourceType: "survey" });
      relinked += 1;
    } catch {
      failed += 1;
    }
  }
  return { recreated, relinked, failed };
}

async function currentUserRichMenu(lineUserId: string): Promise<string | null> {
  const token = getServerEnv().LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error("LINE_CHANNEL_ACCESS_TOKENが設定されていません。");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`https://api.line.me/v2/bot/user/${encodeURIComponent(lineUserId)}/richmenu`, { headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: controller.signal });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`LINE rich menu取得に失敗しました (${response.status})`);
    const body = row(await response.json());
    return typeof body.richMenuId === "string" ? String(body.richMenuId) : null;
  } finally {
    clearTimeout(timeout);
  }
}

async function restoreLineRichMenu(lineUserId: string, previous: string | null): Promise<void> {
  if (previous) await lineRequest(`/v2/bot/user/${encodeURIComponent(lineUserId)}/richmenu/${encodeURIComponent(previous)}`, { method: "POST" });
  else await lineRequest(`/v2/bot/user/${encodeURIComponent(lineUserId)}/richmenu`, { method: "DELETE" });
}

export async function linkLiveRichMenu(input: { client: SupabaseClient; organizationId: string; contactId: string; richMenuId: string; sourceType?: "tag" | "survey" }): Promise<{ lineRichMenuId: string; previousRichMenuId: string | null; unchanged: boolean }> {
  assertLaunchAction("LINE_RICH_MENU_MUTATION_ENABLED");
  const contact = await contactFor(input.client, input.organizationId, input.contactId);
  if (String(contact.friend_status) === "blocked") throw new Error("ブロック中の顧客にはリッチメニューを設定できません。");
  await assertControlledRecipient(input.client, input.organizationId, String(contact.line_user_id));
  const { data: menu, error } = await input.client.from("rich_menus").select("id, line_rich_menu_id").eq("organization_id", input.organizationId).eq("id", input.richMenuId).eq("status", "active").single();
  if (error || !menu || !row(menu).line_rich_menu_id) throw new Error("リッチメニューが見つかりません。");
  const { data: existing } = await input.client.from("rich_menu_assignments").select("rich_menu_id, source_id, status").eq("organization_id", input.organizationId).eq("contact_id", input.contactId).maybeSingle();
  const current = await currentUserRichMenu(String(contact.line_user_id));
  const targetLineRichMenuId = String(row(menu).line_rich_menu_id);
  const previous = existing && row(existing).status !== "removed" ? (row(existing).source_id ? String(row(existing).source_id) : null) : current;
  if (existing && String(row(existing).rich_menu_id) === input.richMenuId && row(existing).status === "synced" && current === targetLineRichMenuId) {
    return { lineRichMenuId: targetLineRichMenuId, previousRichMenuId: previous, unchanged: true };
  }
  await lineRequest(`/v2/bot/user/${encodeURIComponent(String(contact.line_user_id))}/richmenu/${encodeURIComponent(targetLineRichMenuId)}`, { method: "POST" });
  const assignment = await input.client.from("rich_menu_assignments").upsert({ organization_id: input.organizationId, contact_id: input.contactId, rich_menu_id: input.richMenuId, source_type: input.sourceType || "tag", source_id: previous, status: "synced", line_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "organization_id,contact_id" });
  if (assignment.error) {
    await restoreLineRichMenu(String(contact.line_user_id), current).catch(() => undefined);
    throw new Error("リッチメニューの紐付けを保存できませんでした。");
  }
  return { lineRichMenuId: targetLineRichMenuId, previousRichMenuId: previous, unchanged: false };
}

export async function restoreLiveRichMenu(input: { client: SupabaseClient; organizationId: string; contactId: string }): Promise<string | null> {
  assertLaunchAction("LINE_RICH_MENU_MUTATION_ENABLED");
  const contact = await contactFor(input.client, input.organizationId, input.contactId);
  await assertControlledRecipient(input.client, input.organizationId, String(contact.line_user_id));
  const { data: assignment, error } = await input.client.from("rich_menu_assignments").select("source_id, status").eq("organization_id", input.organizationId).eq("contact_id", input.contactId).maybeSingle();
  if (error || !assignment || row(assignment).status === "removed") return null;
  const previous = row(assignment).source_id ? String(row(assignment).source_id) : null;
  await restoreLineRichMenu(String(contact.line_user_id), previous);
  const updated = await input.client.from("rich_menu_assignments").update({ status: "removed", line_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("organization_id", input.organizationId).eq("contact_id", input.contactId);
  if (updated.error) throw new Error("リッチメニュー復旧状態を保存できませんでした。");
  return previous;
}

async function eligibleSurveyRichMenuId(client: SupabaseClient, organizationId: string, contactId: string): Promise<string | null> {
  const sessions = await client
    .from("survey_sessions")
    .select("survey_id, status, started_at")
    .eq("organization_id", organizationId)
    .eq("contact_id", contactId)
    .in("status", ["active", "completed"])
    .order("started_at", { ascending: false })
    .limit(20);
  if (sessions.error || !sessions.data?.length) return null;
  const surveyIds = [...new Set(sessions.data.map((value) => String(row(value).survey_id)))];
  const surveys = await client.from("surveys").select("id, settings_json").eq("organization_id", organizationId).in("id", surveyIds);
  if (surveys.error) return null;
  const settingsBySurvey = new Map((surveys.data || []).map((value) => [String(row(value).id), row(row(value).settings_json)]));
  const candidates: SurveyRichMenuCandidate[] = sessions.data.map((value) => {
    const session = row(value);
    const settings = settingsBySurvey.get(String(session.survey_id)) || {};
    return {
      richMenuId: typeof settings.postSurveyRichMenuId === "string" ? settings.postSurveyRichMenuId : null,
      status: String(session.status),
      startedAt: String(session.started_at),
      fallbackMinutes: typeof settings.richMenuFallbackMinutes === "number" ? settings.richMenuFallbackMinutes : 30
    };
  });
  const selected = selectEligibleSurveyRichMenu(candidates);
  if (!selected) return null;
  const menu = await client.from("rich_menus").select("id").eq("organization_id", organizationId).eq("id", selected).eq("status", "active").maybeSingle();
  return menu.data?.id ? String(menu.data.id) : null;
}

export async function reconcileContactRichMenu(input: { client: SupabaseClient; organizationId: string; contactId: string }): Promise<RichMenuSync> {
  if (!isLaunchFlagEnabled("LINE_RICH_MENU_MUTATION_ENABLED")) return "disabled";
  const contact = await contactFor(input.client, input.organizationId, input.contactId);
  if (String(contact.friend_status) === "blocked") return "blocked";
  if (!await recipientIsAllowed(input.client, input.organizationId, String(contact.line_user_id))) return "recipient_not_allowed";
  const assignments = await input.client.from("contact_tag_assignments").select("tag_id").eq("organization_id", input.organizationId).eq("contact_id", input.contactId).is("removed_at", null);
  if (assignments.error) throw new Error("顧客タグを取得できませんでした。");
  const activeTagIds = [...new Set((assignments.data || []).map((value) => String(row(value).tag_id)))];
  let desired: RichMenuRuleCandidate | null = null;
  if (activeTagIds.length) {
    const rules = await input.client.from("rich_menu_rules").select("id, tag_id, rich_menu_id, priority, created_at").eq("organization_id", input.organizationId).eq("is_active", true).in("tag_id", activeTagIds);
    if (rules.error) throw new Error("リッチメニュー条件を取得できませんでした。");
    desired = selectRichMenuRule(activeTagIds, (rules.data || []).map((value) => ({ id: String(row(value).id), tagId: String(row(value).tag_id), richMenuId: String(row(value).rich_menu_id), priority: Number(row(value).priority || 0), createdAt: String(row(value).created_at) })));
  }
  if (desired) {
    const linked = await linkLiveRichMenu({ client: input.client, organizationId: input.organizationId, contactId: input.contactId, richMenuId: desired.richMenuId });
    return linked.unchanged ? "unchanged" : "linked";
  }
  const surveyRichMenuId = await eligibleSurveyRichMenuId(input.client, input.organizationId, input.contactId);
  if (surveyRichMenuId) {
    const linked = await linkLiveRichMenu({ client: input.client, organizationId: input.organizationId, contactId: input.contactId, richMenuId: surveyRichMenuId, sourceType: "survey" });
    return linked.unchanged ? "unchanged" : "linked";
  }
  const { data: existing } = await input.client.from("rich_menu_assignments").select("status, source_type").eq("organization_id", input.organizationId).eq("contact_id", input.contactId).maybeSingle();
  if (!existing || row(existing).status === "removed") return "not_configured";
  if (row(existing).source_type === "survey") return "unchanged";
  await restoreLiveRichMenu({ client: input.client, organizationId: input.organizationId, contactId: input.contactId });
  return "restored";
}

async function applyRichMenuRuleToExistingContacts(client: SupabaseClient, organizationId: string, tagId: string): Promise<{ applied: number; failed: number }> {
  const { data, error } = await client.from("contact_tag_assignments").select("contact_id").eq("organization_id", organizationId).eq("tag_id", tagId).is("removed_at", null).limit(1000);
  if (error) throw new Error("タグ保有顧客を取得できませんでした。");
  const contactIds = [...new Set((data || []).map((value) => String(row(value).contact_id)))];
  let applied = 0;
  let failed = 0;
  for (let index = 0; index < contactIds.length; index += 10) {
    const batch = await Promise.all(contactIds.slice(index, index + 10).map(async (contactId) => {
      try { return await reconcileContactRichMenu({ client, organizationId, contactId }); } catch { return "failed" as const; }
    }));
    applied += batch.filter((value) => value === "linked" || value === "unchanged").length;
    failed += batch.filter((value) => value === "failed").length;
  }
  return { applied, failed };
}
