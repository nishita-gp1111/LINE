import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env/server";
import { assertLaunchAction, assertTestRecipient, isLaunchFlagEnabled } from "@/lib/launch/flags";
import { activeTagAssignmentKey, tagDefinitionSchema } from "@/lib/milestone3/foundation";
import { createOpaquePostbackToken, verifyOpaquePostbackToken } from "@/lib/milestone3/survey";
import { SupabaseInboxStore } from "@/lib/inbox/store-supabase";
import { sendInboxTextMessage } from "@/lib/inbox/send-service";
import type { MessageRecord } from "@/lib/webhook/store";
import { followSurveyClientRequestId, selectRichMenuRule, surveyResponseKey, type RichMenuRuleCandidate } from "@/lib/minimum-launch/domain";
import { validateRichMenuImage } from "@/lib/minimum-launch/rich-menu-image";

type Row = Record<string, unknown>;
type LineAction = { type: "uri" | "message"; value: string };
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
  const ids = getServerEnv().LINE_TEST_USER_IDS;
  if (ids.length !== 1) throw new Error("送信先の顧客を選択してください。");
  const { data, error } = await client.from("contacts").select("id, line_user_id, display_name, friend_status").eq("organization_id", organizationId).eq("line_user_id", ids[0]).maybeSingle();
  if (error || !data) throw new Error("許可済み顧客が見つかりません。");
  return row(data);
}

async function resolveContact(client: SupabaseClient, organizationId: string, contactId?: string): Promise<Row> {
  return contactId ? contactFor(client, organizationId, contactId) : allowlistedContact(client, organizationId);
}

function recipientIsAllowed(lineUserId: string): boolean {
  try { assertTestRecipient(lineUserId); return true; } catch { return false; }
}

export async function listLiveContacts(client: SupabaseClient, organizationId: string): Promise<Row[]> {
  const { data, error } = await client.from("contacts").select("id, display_name, friend_status, last_message_at").eq("organization_id", organizationId).neq("friend_status", "blocked").order("last_message_at", { ascending: false, nullsFirst: false }).limit(500);
  if (error) throw new Error("送信可能な顧客を取得できませんでした。");
  return (data || []).map((value) => ({ id: row(value).id, displayName: row(value).display_name || "名称未取得", friendStatus: row(value).friend_status, lastMessageAt: row(value).last_message_at }));
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

export async function assignLiveTag(input: { client: SupabaseClient; organizationId: string; contactId: string; tagId: string; sourceType: "manual" | "survey"; sourceId?: string | null; actorProfileId: string }): Promise<{ assignment: Row; duplicate: boolean; effectiveAdded: boolean; automation: string; richMenu: RichMenuSync }> {
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

export async function removeLiveTag(input: { client: SupabaseClient; organizationId: string; assignmentId: string; profileId: string }): Promise<Row> {
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
  if (!recipientIsAllowed(String(contact.line_user_id))) return "recipient_not_allowed";
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

async function pushQuickReply(lineUserId: string, text: string, options: QuickReplyOption[], retryKey: string): Promise<{ accepted: boolean; status: number; lineRequestId: string | null; lineAcceptedRequestId: string | null }> {
  const token = getServerEnv().LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error("LINE_CHANNEL_ACCESS_TOKENが設定されていません。");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch("https://api.line.me/v2/bot/message/push", { method: "POST", redirect: "error", signal: controller.signal, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Line-Retry-Key": retryKey }, body: JSON.stringify({ to: lineUserId, messages: [{ type: "text", text, quickReply: { items: options.map((option) => ({ type: "action", action: { type: "postback", label: option.label, data: `minimum-survey:${option.token}`, displayText: option.label } })) } }] }) });
    return { accepted: response.status === 200 || response.status === 409, status: response.status, lineRequestId: response.headers.get("x-line-request-id"), lineAcceptedRequestId: response.headers.get("x-line-accepted-request-id") };
  } finally {
    clearTimeout(timeout);
  }
}

async function sendQuickReplyMessage(input: { client: SupabaseClient; organizationId: string; contactId: string; profileId: string; text: string; options: QuickReplyOption[]; clientRequestId: string }): Promise<MessageRecord> {
  const contact = await contactFor(input.client, input.organizationId, input.contactId);
  if (String(contact.friend_status) === "blocked") throw new Error("ブロック中の顧客には送信できません。");
  assertTestRecipient(String(contact.line_user_id));
  const store = new SupabaseInboxStore(input.client, input.organizationId);
  const conversation = await store.ensureConversationForContact(input.organizationId, input.contactId, new Date().toISOString());
  const existing = await store.findOutboundByClientRequest(input.organizationId, input.clientRequestId);
  if (existing?.status === "accepted" || existing?.status === "sending") return existing;
  const created = existing ? { message: existing } : await store.createOutboundMessage({ organizationId: input.organizationId, conversationId: conversation.id, contactId: input.contactId, textContent: input.text, clientRequestId: input.clientRequestId, retryKey: randomUUID(), sentByProfileId: input.profileId });
  const claimed = await store.claimOutboundMessage(input.organizationId, created.message.id, input.profileId);
  const result = await pushQuickReply(String(contact.line_user_id), input.text, input.options, String(claimed.retryKey));
  await store.recordOutboundAttempt({ organizationId: input.organizationId, messageId: claimed.id, attemptNumber: claimed.attemptCount, httpStatus: result.status, lineRequestId: result.lineRequestId, lineAcceptedRequestId: result.lineAcceptedRequestId, errorClass: result.accepted ? null : "line_rejected", errorMessageSafe: result.accepted ? null : "アンケート送信がLINE APIに拒否されました。" });
  if (!result.accepted) return store.updateOutboundMessage(input.organizationId, claimed.id, { status: result.status >= 500 ? "retryable_failed" : "permanently_failed", lineRequestId: result.lineRequestId, lineAcceptedRequestId: result.lineAcceptedRequestId, errorClass: "line_rejected", errorCode: String(result.status), errorMessageSafe: "アンケート送信がLINE APIに拒否されました。", failedAt: new Date().toISOString() });
  return store.updateOutboundMessage(input.organizationId, claimed.id, { status: "accepted", lineRequestId: result.lineRequestId, lineAcceptedRequestId: result.lineAcceptedRequestId, acceptedAt: new Date().toISOString() });
}

function surveyPublic(survey: Row, question: Row, options: Row[]): Row {
  return { id: survey.id, name: survey.name, status: survey.status, sendOnFollow: survey.send_on_follow === true, question: { id: question.id, title: question.title, type: question.question_type, options: options.map((option) => ({ id: option.id, key: option.option_key, label: option.label, tagId: typeof row(option.action_config_json).tagId === "string" ? row(option.action_config_json).tagId : null })) } };
}

export async function listLiveSurveys(client: SupabaseClient, organizationId: string): Promise<Row[]> {
  const { data: surveys, error } = await client.from("surveys").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false });
  if (error) throw new Error("アンケートの取得に失敗しました。");
  const result: Row[] = [];
  for (const surveyValue of surveys || []) {
    const survey = row(surveyValue);
    const { data: questions } = await client.from("survey_questions").select("*").eq("organization_id", organizationId).eq("survey_id", String(survey.id)).order("sort_order").limit(1);
    const question = row((questions || [])[0]);
    const { data: options } = await client.from("survey_options").select("*").eq("organization_id", organizationId).eq("question_id", String(question.id)).eq("is_active", true).order("sort_order");
    result.push(surveyPublic(survey, question, (options || []).map(row)));
  }
  return result;
}

export async function createLiveSurvey(input: { client: SupabaseClient; organizationId: string; profileId: string; name: string; questionTitle: string; options: Array<{ key?: string; label: string; tagId?: string }>; sendOnFollow?: boolean }): Promise<Row> {
  const name = input.name.trim();
  const title = input.questionTitle.trim();
  const options = input.options.map((option) => ({ label: option.label.trim(), tagId: option.tagId || undefined })).filter((option) => option.label);
  if (!name || name.length > 150 || !title || title.length > 500) throw new Error("アンケート名または質問を確認してください。");
  if (options.length < 1 || options.length > 13) throw new Error("選択肢は1〜13件で設定してください。");
  if (options.some((option) => option.label.length > 20)) throw new Error("選択肢名は20文字以内にしてください。");
  for (const option of options) {
    if (option.tagId) {
      const { data } = await input.client.from("tags").select("id").eq("organization_id", input.organizationId).eq("id", option.tagId).eq("is_active", true).maybeSingle();
      if (!data) throw new Error("選択肢に指定したタグが見つかりません。");
    }
  }
  const { data: survey, error: surveyError } = await input.client.from("surveys").insert({ organization_id: input.organizationId, name, status: "active", allow_multiple_responses: false, created_by_profile_id: input.profileId }).select("*").single();
  if (surveyError || !survey) throw new Error("アンケートを作成できませんでした。同名アンケートがないか確認してください。");
  try {
    const { data: question, error: questionError } = await input.client.from("survey_questions").insert({ organization_id: input.organizationId, survey_id: survey.id, question_key: "main", title, question_type: "single_choice", is_required: true, sort_order: 0 }).select("*").single();
    if (questionError || !question) throw new Error("アンケート質問を作成できませんでした。");
    const secret = getServerEnv().SURVEY_POSTBACK_TOKEN_SECRET;
    if (!secret) throw new Error("SURVEY_POSTBACK_TOKEN_SECRETが設定されていません。");
    const records = options.map((option, index) => ({ organization_id: input.organizationId, question_id: question.id, option_key: `option_${index + 1}`, label: option.label, value: option.label, sort_order: index, postback_token: createOpaquePostbackToken(secret, Date.now() + 365 * 24 * 60 * 60 * 1000), action_config_json: option.tagId ? { type: "add_tag", tagId: option.tagId } : {} }));
    const { data: createdOptions, error: optionError } = await input.client.from("survey_options").insert(records).select("*");
    if (optionError || !createdOptions) throw new Error("アンケート選択肢を作成できませんでした。");
    if (input.sendOnFollow) await setLiveFollowSurvey(input.client, input.organizationId, String(survey.id));
    return surveyPublic({ ...row(survey), send_on_follow: input.sendOnFollow === true }, row(question), createdOptions.map(row));
  } catch (error) {
    await input.client.from("surveys").delete().eq("organization_id", input.organizationId).eq("id", survey.id);
    throw error;
  }
}

export async function setLiveFollowSurvey(client: SupabaseClient, organizationId: string, surveyId: string | null): Promise<string | null> {
  const { data, error } = await client.rpc("minimum_set_follow_survey", { target_organization_id: organizationId, target_survey_id: surveyId });
  if (error) throw new Error(error.code === "23503" ? "有効なアンケートが見つかりません。" : "友だち追加時アンケートを更新できませんでした。");
  return typeof data === "string" ? data : null;
}

export async function startLiveSurvey(input: { client: SupabaseClient; organizationId: string; surveyId: string; contactId?: string; profileId: string; gate?: "manual" | "automation"; clientRequestId?: string }): Promise<MessageRecord> {
  assertLaunchAction(input.gate === "automation" ? "LINE_AUTOMATION_SEND_ENABLED" : "LINE_MANUAL_SEND_ENABLED");
  const contact = await resolveContact(input.client, input.organizationId, input.contactId);
  const contactId = String(contact.id);
  assertTestRecipient(String(contact.line_user_id));
  const { data: survey, error: surveyError } = await input.client.from("surveys").select("*").eq("organization_id", input.organizationId).eq("id", input.surveyId).eq("status", "active").single();
  if (surveyError || !survey) throw new Error("有効なアンケートが見つかりません。");
  const { data: question, error: questionError } = await input.client.from("survey_questions").select("*").eq("organization_id", input.organizationId).eq("survey_id", input.surveyId).order("sort_order").limit(1).single();
  if (questionError || !question) throw new Error("アンケート質問が見つかりません。");
  const { data: options, error: optionError } = await input.client.from("survey_options").select("id, label, postback_token").eq("organization_id", input.organizationId).eq("question_id", question.id).eq("is_active", true).order("sort_order");
  if (optionError || !options?.length) throw new Error("アンケート選択肢が見つかりません。");
  await input.client.from("survey_sessions").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("organization_id", input.organizationId).eq("survey_id", input.surveyId).eq("contact_id", contactId).eq("status", "active");
  const { data: session, error: sessionError } = await input.client.from("survey_sessions").insert({ organization_id: input.organizationId, survey_id: input.surveyId, contact_id: contactId, status: "active", current_question_id: question.id, expires_at: new Date(Date.now() + getServerEnv().SURVEY_DEFAULT_SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString() }).select("id").single();
  if (sessionError || !session) throw new Error("アンケートセッションを作成できませんでした。");
  try {
    const message = await sendQuickReplyMessage({ client: input.client, organizationId: input.organizationId, contactId, profileId: input.profileId, text: String(question.title), options: options.map((option) => ({ id: String(option.id), label: String(option.label), token: String(option.postback_token) })), clientRequestId: input.clientRequestId || `minimum-survey:${input.surveyId}:${contactId}:${session.id}` });
    if (message.status !== "accepted") throw new Error(message.errorMessageSafe || "アンケートがLINE APIに受け付けられませんでした。");
    return message;
  } catch (error) {
    await input.client.from("survey_sessions").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("organization_id", input.organizationId).eq("id", session.id);
    throw error;
  }
}

export async function sendFollowSurveyIfConfigured(input: { client: SupabaseClient; organizationId: string; contactId: string; webhookEventId: string }): Promise<"sent" | "not_configured" | "disabled" | "recipient_not_allowed"> {
  if (!isLaunchFlagEnabled("LINE_AUTOMATION_SEND_ENABLED")) return "disabled";
  const { data: survey, error } = await input.client.from("surveys").select("id").eq("organization_id", input.organizationId).eq("status", "active").eq("send_on_follow", true).maybeSingle();
  if (error) throw new Error("友だち追加時アンケートを取得できませんでした。");
  if (!survey) return "not_configured";
  const contact = await contactFor(input.client, input.organizationId, input.contactId);
  if (!recipientIsAllowed(String(contact.line_user_id))) return "recipient_not_allowed";
  const profileId = await systemProfileId(input.client, input.organizationId);
  const surveyId = String(row(survey).id);
  await startLiveSurvey({
    client: input.client,
    organizationId: input.organizationId,
    surveyId,
    contactId: input.contactId,
    profileId,
    gate: "automation",
    clientRequestId: followSurveyClientRequestId(input.webhookEventId, surveyId, input.contactId)
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

export async function handleLiveSurveyPostback(input: { client: SupabaseClient; organizationId: string; contactId: string; data: string; webhookEventId: string }): Promise<{ handled: boolean; duplicate: boolean; tagId?: string }> {
  const prefix = "minimum-survey:";
  if (!input.data.startsWith(prefix)) return { handled: false, duplicate: false };
  const token = input.data.slice(prefix.length);
  const secret = getServerEnv().SURVEY_POSTBACK_TOKEN_SECRET;
  if (!secret || !verifyOpaquePostbackToken(token, secret)) throw new Error("アンケート回答トークンが無効または期限切れです。");
  const { data: tappedOption, error: optionError } = await input.client.from("survey_options").select("*").eq("organization_id", input.organizationId).eq("postback_token", token).eq("is_active", true).maybeSingle();
  if (optionError || !tappedOption) throw new Error("アンケートの選択肢が見つかりません。");
  const { data: question, error: questionError } = await input.client.from("survey_questions").select("*").eq("organization_id", input.organizationId).eq("id", String(row(tappedOption).question_id)).single();
  if (questionError || !question) throw new Error("アンケート質問が見つかりません。");
  const { data: survey, error: surveyError } = await input.client.from("surveys").select("*").eq("organization_id", input.organizationId).eq("id", String(row(question).survey_id)).eq("status", "active").single();
  if (surveyError || !survey) throw new Error("有効なアンケートが見つかりません。");
  const { data: session, error: sessionError } = await input.client.from("survey_sessions").select("*").eq("organization_id", input.organizationId).eq("survey_id", String(row(survey).id)).eq("contact_id", input.contactId).eq("current_question_id", String(row(question).id)).in("status", ["active", "completed"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (sessionError || !session) throw new Error("アンケートセッションがありません。");
  const sessionRow = row(session);
  const responseKey = surveyResponseKey(String(sessionRow.id), String(row(question).id));
  let { data: response } = await input.client.from("survey_responses").select("id, option_id").eq("organization_id", input.organizationId).eq("response_key", responseKey).maybeSingle();
  let duplicate = Boolean(response);
  if (!response) {
    if (sessionRow.status !== "active" || Date.parse(String(sessionRow.expires_at)) <= Date.now()) throw new Error("アンケートセッションが期限切れです。");
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
  await input.client.from("survey_sessions").update({ status: "completed", completed_at: sessionRow.completed_at || new Date().toISOString(), last_interaction_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("organization_id", input.organizationId).eq("id", sessionRow.id);
  return { handled: true, duplicate, tagId };
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

function richMenuAction(action: LineAction): Row {
  const value = action.value.trim();
  if (action.type === "uri") {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error("リッチメニューのURLが不正です。"); }
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("リッチメニューURLはhttpまたはhttpsにしてください。");
    return { type: "uri", label: "開く", uri: url.toString() };
  }
  if (!value || value.length > 300) throw new Error("リッチメニューの送信文は1〜300文字にしてください。");
  return { type: "message", label: "送信", text: value };
}

export async function createLiveRichMenu(input: { client: SupabaseClient; organizationId: string; profileId: string; name: string; tagId: string; chatBarText: string; action: LineAction; imageBytes: Uint8Array; imageContentType: string; applyExisting?: boolean }): Promise<Row> {
  assertLaunchAction("LINE_RICH_MENU_MUTATION_ENABLED");
  const name = input.name.trim();
  const chatBarText = input.chatBarText.trim();
  if (!name || name.length > 150) throw new Error("リッチメニュー名は1〜150文字にしてください。");
  if (!chatBarText || chatBarText.length > 14) throw new Error("チャットバー文字は1〜14文字にしてください。");
  const { data: tag } = await input.client.from("tags").select("id").eq("organization_id", input.organizationId).eq("id", input.tagId).eq("is_active", true).maybeSingle();
  if (!tag) throw new Error("リッチメニューの対象タグが見つかりません。");
  const image = validateRichMenuImage(input.imageBytes, input.imageContentType);
  const definition = { size: { width: image.width, height: image.height }, selected: false, name, chatBarText, areas: [{ bounds: { x: 0, y: 0, width: image.width, height: image.height }, action: richMenuAction(input.action) }] };
  await lineRequest("/v2/bot/richmenu/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(definition) });
  const created = await lineRequest("/v2/bot/richmenu", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(definition) });
  const lineId = typeof created.body.richMenuId === "string" ? created.body.richMenuId : null;
  if (!lineId) throw new Error("LINE rich menu IDを取得できませんでした。");
  let previousRuleIds: string[] = [];
  try {
    const body = input.imageBytes.buffer.slice(input.imageBytes.byteOffset, input.imageBytes.byteOffset + input.imageBytes.byteLength) as ArrayBuffer;
    await lineRequest(`/v2/bot/richmenu/${encodeURIComponent(lineId)}/content`, { method: "POST", headers: { "Content-Type": image.contentType }, body }, true);
    const { data: menu, error } = await input.client.from("rich_menus").insert({ organization_id: input.organizationId, name, line_rich_menu_id: lineId, chat_bar_text: chatBarText, width: image.width, height: image.height, selected: false, definition_json: definition, status: "active", is_default: false, managed_by: "api", created_by_profile_id: input.profileId }).select("*").single();
    if (error || !menu) throw new Error("リッチメニューをDBへ保存できませんでした。");
    const area = definition.areas[0];
    const areaResult = await input.client.from("rich_menu_areas").insert({ organization_id: input.organizationId, rich_menu_id: menu.id, area_order: 0, ...area.bounds, action_type: area.action.type, action_config_json: area.action });
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
    result.push({ ...menu, linkCount: count || 0, tagId: rule.tag_id || null, tagName: rule.tag_id ? tagNames.get(String(rule.tag_id)) || "削除済みタグ" : null });
  }
  return result;
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

export async function linkLiveRichMenu(input: { client: SupabaseClient; organizationId: string; contactId: string; richMenuId: string }): Promise<{ lineRichMenuId: string; previousRichMenuId: string | null; unchanged: boolean }> {
  assertLaunchAction("LINE_RICH_MENU_MUTATION_ENABLED");
  const contact = await contactFor(input.client, input.organizationId, input.contactId);
  if (String(contact.friend_status) === "blocked") throw new Error("ブロック中の顧客にはリッチメニューを設定できません。");
  assertTestRecipient(String(contact.line_user_id));
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
  const assignment = await input.client.from("rich_menu_assignments").upsert({ organization_id: input.organizationId, contact_id: input.contactId, rich_menu_id: input.richMenuId, source_type: "tag", source_id: previous, status: "synced", line_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "organization_id,contact_id" });
  if (assignment.error) {
    await restoreLineRichMenu(String(contact.line_user_id), current).catch(() => undefined);
    throw new Error("リッチメニューの紐付けを保存できませんでした。");
  }
  return { lineRichMenuId: targetLineRichMenuId, previousRichMenuId: previous, unchanged: false };
}

export async function restoreLiveRichMenu(input: { client: SupabaseClient; organizationId: string; contactId: string }): Promise<string | null> {
  assertLaunchAction("LINE_RICH_MENU_MUTATION_ENABLED");
  const contact = await contactFor(input.client, input.organizationId, input.contactId);
  assertTestRecipient(String(contact.line_user_id));
  const { data: assignment, error } = await input.client.from("rich_menu_assignments").select("source_id, status").eq("organization_id", input.organizationId).eq("contact_id", input.contactId).maybeSingle();
  if (error || !assignment || row(assignment).status === "removed") return null;
  const previous = row(assignment).source_id ? String(row(assignment).source_id) : null;
  await restoreLineRichMenu(String(contact.line_user_id), previous);
  const updated = await input.client.from("rich_menu_assignments").update({ status: "removed", line_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("organization_id", input.organizationId).eq("contact_id", input.contactId);
  if (updated.error) throw new Error("リッチメニュー復旧状態を保存できませんでした。");
  return previous;
}

export async function reconcileContactRichMenu(input: { client: SupabaseClient; organizationId: string; contactId: string }): Promise<RichMenuSync> {
  if (!isLaunchFlagEnabled("LINE_RICH_MENU_MUTATION_ENABLED")) return "disabled";
  const contact = await contactFor(input.client, input.organizationId, input.contactId);
  if (String(contact.friend_status) === "blocked") return "blocked";
  if (!recipientIsAllowed(String(contact.line_user_id))) return "recipient_not_allowed";
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
  const { data: existing } = await input.client.from("rich_menu_assignments").select("status").eq("organization_id", input.organizationId).eq("contact_id", input.contactId).maybeSingle();
  if (!existing || row(existing).status === "removed") return "not_configured";
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
