import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env/server";
import { assertLaunchAction, assertTestRecipient } from "@/lib/launch/flags";
import { activeTagAssignmentKey, tagDefinitionSchema } from "@/lib/milestone3/foundation";
import { createOpaquePostbackToken } from "@/lib/milestone3/survey";
import { SupabaseInboxStore } from "@/lib/inbox/store-supabase";
import { sendInboxTextMessage } from "@/lib/inbox/send-service";
import type { MessageRecord } from "@/lib/webhook/store";

type Row = Record<string, unknown>;

function row(value: unknown): Row {
  return value && typeof value === "object" ? value as Row : {};
}

async function lineRequest(path: string, init: RequestInit = {}): Promise<{ status: number; body: Row; headers: Headers }> {
  const token = getServerEnv().LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error("LINE_CHANNEL_ACCESS_TOKENが設定されていません。");
  const response = await fetch(`https://api.line.me${path}`, { ...init, redirect: "error", headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  let body: Row = {};
  try { body = row(await response.json()); } catch { body = {}; }
  if (!response.ok) throw new Error(`LINE API request failed (${response.status})`);
  return { status: response.status, body, headers: response.headers };
}

async function systemProfileId(client: SupabaseClient, organizationId: string): Promise<string> {
  const { data, error } = await client.from("organization_members").select("profile_id, role").eq("organization_id", organizationId).in("role", ["owner", "admin", "operator"]).order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (error || !data) throw new Error("送信元プロフィールが見つかりません。");
  return String(data.profile_id);
}

async function contactFor(client: SupabaseClient, organizationId: string, contactId: string): Promise<Row> {
  const { data, error } = await client.from("contacts").select("id, line_user_id, friend_status").eq("organization_id", organizationId).eq("id", contactId).maybeSingle();
  if (error || !data) throw new Error("顧客が見つかりません。");
  return row(data);
}

async function testContactFor(client: SupabaseClient, organizationId: string): Promise<Row> {
  const testUserId = getServerEnv().LINE_TEST_USER_IDS[0];
  if (!testUserId) throw new Error("LINE_TEST_USER_IDSにテストユーザーが1名設定されていません。");
  const { data, error } = await client.from("contacts").select("id, line_user_id, friend_status").eq("organization_id", organizationId).eq("line_user_id", testUserId).maybeSingle();
  if (error || !data) throw new Error("テストユーザーの顧客レコードが見つかりません。");
  return row(data);
}

async function resolveContact(client: SupabaseClient, organizationId: string, contactId?: string): Promise<Row> {
  return contactId ? contactFor(client, organizationId, contactId) : testContactFor(client, organizationId);
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
  if (error || !data) throw new Error("タグを作成できませんでした。");
  return row(data);
}

export async function assignLiveTag(input: { client: SupabaseClient; organizationId: string; contactId: string; tagId: string; sourceType: "manual" | "survey"; sourceId?: string | null; actorProfileId: string }): Promise<{ assignment: Row; duplicate: boolean; automation: string }> {
  const db = input.client;
  await contactFor(db, input.organizationId, input.contactId);
  const { data: tag, error: tagError } = await db.from("tags").select("id").eq("organization_id", input.organizationId).eq("id", input.tagId).eq("is_active", true).maybeSingle();
  if (tagError || !tag) throw new Error("タグが見つかりません。");
  const assignmentKey = activeTagAssignmentKey(input.contactId, input.tagId, input.sourceType, input.sourceId || null);
  const { data: existing } = await db.from("contact_tag_assignments").select("*").eq("organization_id", input.organizationId).eq("assignment_key", assignmentKey).maybeSingle();
  if (existing && !row(existing).removed_at) return { assignment: row(existing), duplicate: true, automation: "duplicate" };
  const assignmentResult = existing
    ? await db.from("contact_tag_assignments").update({ removed_at: null, removed_by_profile_id: null, assigned_by_profile_id: input.actorProfileId, assigned_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("organization_id", input.organizationId).eq("id", row(existing).id).select("*").single()
    : await db.from("contact_tag_assignments").insert({ organization_id: input.organizationId, contact_id: input.contactId, tag_id: input.tagId, source_type: input.sourceType, source_id: input.sourceId || null, assignment_key: assignmentKey, assigned_by_profile_id: input.actorProfileId }).select("*").single();
  if (assignmentResult.error || !assignmentResult.data) throw new Error("タグの保存に失敗しました。");
  const automation = await runTagAddedAutomation({ client: db, organizationId: input.organizationId, contactId: input.contactId, tagId: input.tagId, assignmentId: String(row(assignmentResult.data).id) });
  const richMenu = await runTagRichMenuRule({ client: db, organizationId: input.organizationId, contactId: input.contactId, tagId: input.tagId });
  return { assignment: row(assignmentResult.data), duplicate: false, automation: richMenu === "linked" ? `${automation}:rich_menu_linked` : automation };
}

export async function removeLiveTag(input: { client: SupabaseClient; organizationId: string; assignmentId: string; profileId: string }): Promise<Row> {
  const { data, error } = await input.client.from("contact_tag_assignments").update({ removed_at: new Date().toISOString(), removed_by_profile_id: input.profileId, updated_at: new Date().toISOString() }).eq("organization_id", input.organizationId).eq("id", input.assignmentId).is("removed_at", null).select("*").single();
  if (error || !data) throw new Error("タグを解除できませんでした。");
  return row(data);
}

async function runTagAddedAutomation(input: { client: SupabaseClient; organizationId: string; contactId: string; tagId: string; assignmentId: string }): Promise<string> {
  const { data: scenarios, error } = await input.client.from("automation_scenarios").select("id, version").eq("organization_id", input.organizationId).eq("trigger_type", "tag_added").eq("status", "active").order("created_at", { ascending: true }).limit(10);
  if (error) throw new Error("タグ起点automationの取得に失敗しました。");
  for (const scenarioValue of scenarios || []) {
    const scenario = row(scenarioValue);
    const { data: steps, error: stepError } = await input.client.from("automation_steps").select("step_type, config_json, step_order").eq("organization_id", input.organizationId).eq("scenario_id", String(scenario.id)).order("step_order", { ascending: true });
    if (stepError) throw new Error("タグ起点automationのstep取得に失敗しました。");
    const step = (steps || []).map(row).find((candidate) => candidate.step_type === "send_message" && row(candidate.config_json).tagId === input.tagId);
    if (!step) continue;
    const text = row(step.config_json).text;
    if (typeof text !== "string" || !text.trim()) throw new Error("タグ起点メッセージ本文が未設定です。");
    const contact = await contactFor(input.client, input.organizationId, input.contactId);
    assertLaunchAction("LINE_AUTOMATION_SEND_ENABLED");
    assertTestRecipient(String(contact.line_user_id));
    const idempotencyKey = `minimum-tag:${input.assignmentId}:${String(scenario.id)}`;
    const { data: existingEnrollment } = await input.client.from("automation_enrollments").select("id").eq("organization_id", input.organizationId).eq("idempotency_key", idempotencyKey).maybeSingle();
    if (existingEnrollment) return "duplicate";
    const profileId = await systemProfileId(input.client, input.organizationId);
    const { data: enrollment, error: enrollmentError } = await input.client.from("automation_enrollments").insert({ organization_id: input.organizationId, scenario_id: scenario.id, scenario_version: Number(scenario.version || 1), contact_id: input.contactId, status: "active", current_step_order: Number(row(step).step_order || 0), idempotency_key: idempotencyKey }).select("id").single();
    if (enrollmentError || !enrollment) throw new Error("タグ起点automationの登録に失敗しました。");
    const store = new SupabaseInboxStore(input.client, input.organizationId);
    const conversation = await store.ensureConversationForContact(input.organizationId, input.contactId, new Date().toISOString());
    try {
      await sendInboxTextMessage({ store, organizationId: input.organizationId, profileId, role: "owner", gate: "automation", conversationId: conversation.id, text, clientRequestId: `minimum-tag-message:${input.assignmentId}:${scenario.id}` });
      await input.client.from("automation_enrollments").update({ status: "completed", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("organization_id", input.organizationId).eq("id", enrollment.id);
      return "sent";
    } catch (error) {
      await input.client.from("automation_enrollments").update({ status: "failed", last_error_safe: error instanceof Error ? error.message.slice(0, 500) : "送信失敗", updated_at: new Date().toISOString() }).eq("organization_id", input.organizationId).eq("id", enrollment.id);
      throw error;
    }
  }
  return "not_configured";
}

type QuickReplyOption = { id: string; label: string; token: string };

async function pushQuickReply(lineUserId: string, text: string, options: QuickReplyOption[], retryKey: string): Promise<{ accepted: boolean; status: number; lineRequestId: string | null; lineAcceptedRequestId: string | null }> {
  const token = getServerEnv().LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error("LINE_CHANNEL_ACCESS_TOKENが設定されていません。");
  const response = await fetch("https://api.line.me/v2/bot/message/push", { method: "POST", redirect: "error", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Line-Retry-Key": retryKey }, body: JSON.stringify({ to: lineUserId, messages: [{ type: "text", text, quickReply: { items: options.map((option) => ({ type: "action", action: { type: "postback", label: option.label, data: `minimum-survey:${option.token}`, displayText: option.label } })) } }] }) });
  return { accepted: response.status === 200 || response.status === 409, status: response.status, lineRequestId: response.headers.get("x-line-request-id"), lineAcceptedRequestId: response.headers.get("x-line-accepted-request-id") };
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
  return { id: survey.id, name: survey.name, status: survey.status, question: { id: question.id, title: question.title, type: question.question_type, options: options.map((option) => ({ id: option.id, key: option.option_key, label: option.label })) } };
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

export async function createLiveSurvey(input: { client: SupabaseClient; organizationId: string; profileId: string; name: string; questionTitle: string; options: Array<{ key: string; label: string; tagId?: string }> }): Promise<Row> {
  for (const option of input.options) {
    if (option.tagId) {
      const { data } = await input.client.from("tags").select("id").eq("organization_id", input.organizationId).eq("id", option.tagId).eq("is_active", true).maybeSingle();
      if (!data) throw new Error("アンケートのタグアクションに指定したタグが見つかりません。");
    }
  }
  const { data: survey, error: surveyError } = await input.client.from("surveys").insert({ organization_id: input.organizationId, name: input.name.trim(), status: "active", allow_multiple_responses: false, created_by_profile_id: input.profileId }).select("*").single();
  if (surveyError || !survey) throw new Error("アンケートを作成できませんでした。");
  try {
    const { data: question, error: questionError } = await input.client.from("survey_questions").insert({ organization_id: input.organizationId, survey_id: survey.id, question_key: "main", title: input.questionTitle.trim(), question_type: "single_choice", is_required: true, sort_order: 0 }).select("*").single();
    if (questionError || !question) throw new Error("アンケート質問を作成できませんでした。");
    const secret = getServerEnv().SURVEY_POSTBACK_TOKEN_SECRET;
    if (!secret) throw new Error("SURVEY_POSTBACK_TOKEN_SECRETが設定されていません。");
    const options = input.options.map((option, index) => ({ organization_id: input.organizationId, question_id: question.id, option_key: option.key, label: option.label.trim(), value: option.label.trim(), sort_order: index, postback_token: createOpaquePostbackToken(secret, Date.now() + 30 * 24 * 60 * 60 * 1000), action_config_json: option.tagId ? { type: "add_tag", tagId: option.tagId } : {} }));
    const { data: createdOptions, error: optionError } = await input.client.from("survey_options").insert(options).select("*");
    if (optionError || !createdOptions) throw new Error("アンケート選択肢を作成できませんでした。");
    return surveyPublic(row(survey), row(question), createdOptions.map(row));
  } catch (error) {
    await input.client.from("surveys").delete().eq("organization_id", input.organizationId).eq("id", survey.id);
    throw error;
  }
}

export async function startLiveSurvey(input: { client: SupabaseClient; organizationId: string; surveyId: string; contactId?: string; profileId: string }): Promise<MessageRecord> {
  assertLaunchAction("LINE_MANUAL_SEND_ENABLED");
  const contact = await resolveContact(input.client, input.organizationId, input.contactId);
  const contactId = String(contact.id);
  assertTestRecipient(String(contact.line_user_id));
  const { data: survey, error: surveyError } = await input.client.from("surveys").select("*").eq("organization_id", input.organizationId).eq("id", input.surveyId).eq("status", "active").single();
  if (surveyError || !survey) throw new Error("有効なアンケートが見つかりません。");
  const { data: question, error: questionError } = await input.client.from("survey_questions").select("*").eq("organization_id", input.organizationId).eq("survey_id", input.surveyId).order("sort_order").limit(1).single();
  if (questionError || !question) throw new Error("アンケート質問が見つかりません。");
  const { data: options, error: optionError } = await input.client.from("survey_options").select("id, label, postback_token").eq("organization_id", input.organizationId).eq("question_id", question.id).eq("is_active", true).order("sort_order");
  if (optionError || !options?.length) throw new Error("アンケート選択肢が見つかりません。");
  const { data: session, error: sessionError } = await input.client.from("survey_sessions").insert({ organization_id: input.organizationId, survey_id: input.surveyId, contact_id: contactId, status: "active", current_question_id: question.id, expires_at: new Date(Date.now() + getServerEnv().SURVEY_DEFAULT_SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString() }).select("id").single();
  if (sessionError || !session) throw new Error("アンケートセッションを作成できませんでした。");
  return sendQuickReplyMessage({ client: input.client, organizationId: input.organizationId, contactId, profileId: input.profileId, text: String(question.title), options: options.map((option) => ({ id: String(option.id), label: String(option.label), token: String(option.postback_token) })), clientRequestId: `minimum-survey:${input.surveyId}:${contactId}:${session.id}` });
}

export async function handleLiveSurveyPostback(input: { client: SupabaseClient; organizationId: string; contactId: string; data: string; webhookEventId: string }): Promise<{ handled: boolean; duplicate: boolean; tagId?: string }> {
  const prefix = "minimum-survey:";
  if (!input.data.startsWith(prefix)) return { handled: false, duplicate: false };
  const { data: option, error: optionError } = await input.client.from("survey_options").select("*").eq("organization_id", input.organizationId).eq("postback_token", input.data.slice(prefix.length)).eq("is_active", true).maybeSingle();
  if (optionError || !option) throw new Error("アンケートの選択肢が見つかりません。");
  const optionRow = row(option);
  const { data: question, error: questionError } = await input.client.from("survey_questions").select("*").eq("organization_id", input.organizationId).eq("id", String(optionRow.question_id)).single();
  if (questionError || !question) throw new Error("アンケート質問が見つかりません。");
  const { data: survey, error: surveyError } = await input.client.from("surveys").select("*").eq("organization_id", input.organizationId).eq("id", String(row(question).survey_id)).single();
  if (surveyError || !survey) throw new Error("アンケートが見つかりません。");
  const { data: session, error: sessionError } = await input.client.from("survey_sessions").select("*").eq("organization_id", input.organizationId).eq("survey_id", String(row(survey).id)).eq("contact_id", input.contactId).eq("current_question_id", String(row(question).id)).eq("status", "active").gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (sessionError || !session) throw new Error("有効なアンケートセッションがありません。");
  const sessionRow = row(session);
  const { data: existing } = await input.client.from("survey_responses").select("id").eq("organization_id", input.organizationId).eq("session_id", String(sessionRow.id)).eq("question_id", String(question.id)).eq("option_id", String(optionRow.id)).maybeSingle();
  if (existing) return { handled: true, duplicate: true };
  const { data: response, error: responseError } = await input.client.from("survey_responses").insert({ organization_id: input.organizationId, survey_id: survey.id, question_id: question.id, option_id: optionRow.id, contact_id: input.contactId, session_id: sessionRow.id, answer_text: optionRow.value, webhook_event_id: input.webhookEventId }).select("id").single();
  if (responseError || !response) throw new Error("アンケート回答を保存できませんでした。");
  const actionConfig = row(optionRow.action_config_json);
  const tagId = typeof actionConfig.tagId === "string" ? actionConfig.tagId : undefined;
  if (tagId) {
    const profileId = await systemProfileId(input.client, input.organizationId);
    const result = await assignLiveTag({ client: input.client, organizationId: input.organizationId, contactId: input.contactId, tagId, sourceType: "survey", sourceId: String(survey.id), actorProfileId: profileId });
    if (!result.assignment) throw new Error("回答タグを保存できませんでした。");
    await input.client.from("survey_action_executions").upsert({ organization_id: input.organizationId, survey_response_id: response.id, action_type: "add_tag", idempotency_key: `survey-tag:${sessionRow.id}:${optionRow.id}`, status: "succeeded", executed_at: new Date().toISOString() }, { onConflict: "organization_id,idempotency_key" });
  }
  await input.client.from("survey_sessions").update({ status: "completed", completed_at: new Date().toISOString(), last_interaction_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("organization_id", input.organizationId).eq("id", sessionRow.id);
  return { handled: true, duplicate: false, tagId };
}

export async function listLiveScenarios(client: SupabaseClient, organizationId: string): Promise<Row[]> {
  const { data, error } = await client.from("automation_scenarios").select("id, name, trigger_type, status, version, created_at").eq("organization_id", organizationId).order("created_at", { ascending: false });
  if (error) throw new Error("automationの取得に失敗しました。");
  return (data || []).map((value) => ({ ...row(value), triggerType: row(value).trigger_type }));
}

export async function createLiveTagScenario(input: { client: SupabaseClient; organizationId: string; profileId: string; name: string; tagId: string; text: string }): Promise<Row> {
  const { data: tag } = await input.client.from("tags").select("id").eq("organization_id", input.organizationId).eq("id", input.tagId).eq("is_active", true).maybeSingle();
  if (!tag) throw new Error("起点タグが見つかりません。");
  const { data: scenario, error } = await input.client.from("automation_scenarios").insert({ organization_id: input.organizationId, name: input.name.trim(), trigger_type: "tag_added", trigger_config_json: { tagId: input.tagId }, status: "draft", allow_reentry: false, created_by_profile_id: input.profileId }).select("*").single();
  if (error || !scenario) throw new Error("tag_added automationを作成できませんでした。");
  const { error: stepError } = await input.client.from("automation_steps").insert({ organization_id: input.organizationId, scenario_id: scenario.id, step_order: 0, step_type: "send_message", config_json: { tagId: input.tagId, text: input.text.trim() } });
  if (stepError) { await input.client.from("automation_scenarios").delete().eq("organization_id", input.organizationId).eq("id", scenario.id); throw new Error("tag_added automationのメッセージを保存できませんでした。"); }
  return row(scenario);
}

export async function activateLiveScenario(client: SupabaseClient, organizationId: string, scenarioId: string): Promise<Row> {
  const { data, error } = await inputlessUpdate(client, organizationId, scenarioId);
  if (error || !data) throw new Error("automationを有効化できませんでした。");
  return row(data);
}

async function inputlessUpdate(client: SupabaseClient, organizationId: string, scenarioId: string) {
  return client.from("automation_scenarios").update({ status: "active", updated_at: new Date().toISOString() }).eq("organization_id", organizationId).eq("id", scenarioId).eq("trigger_type", "tag_added").select("*").single();
}

export async function createLiveRichMenu(input: { client: SupabaseClient; organizationId: string; profileId: string; name: string; definition: Record<string, unknown>; tagId?: string }): Promise<Row> {
  assertLaunchAction("LINE_RICH_MENU_MUTATION_ENABLED");
  if (input.tagId) {
    const { data: tag } = await input.client.from("tags").select("id").eq("organization_id", input.organizationId).eq("id", input.tagId).eq("is_active", true).maybeSingle();
    if (!tag) throw new Error("rich menuのタグ条件が見つかりません。");
  }
  const line = await lineRequest("/v2/bot/richmenu", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input.definition) });
  const lineId = typeof line.body.richMenuId === "string" ? line.body.richMenuId : null;
  if (!lineId) throw new Error("LINE rich menu IDを取得できませんでした。");
  const { data: menu, error } = await input.client.from("rich_menus").insert({ organization_id: input.organizationId, name: input.name.trim(), line_rich_menu_id: lineId, chat_bar_text: input.definition.chatBarText || null, width: input.definition.width || null, height: input.definition.height || null, selected: Boolean(input.definition.selected), definition_json: input.definition, status: "active", is_default: false, managed_by: "api", created_by_profile_id: input.profileId }).select("*").single();
  if (error || !menu) { await lineRequest(`/v2/bot/richmenu/${encodeURIComponent(lineId)}`, { method: "DELETE" }).catch(() => undefined); throw new Error("rich menuを保存できませんでした。"); }
  const areas = Array.isArray(input.definition.areas) ? input.definition.areas as Array<Record<string, unknown>> : [];
  if (areas.length) await input.client.from("rich_menu_areas").insert(areas.map((area, index) => ({ organization_id: input.organizationId, rich_menu_id: menu.id, area_order: index, x: area.x, y: area.y, width: area.width, height: area.height, action_type: row(area.action).type, action_config_json: row(area.action) })));
  if (input.tagId) {
    const { error: ruleError } = await input.client.from("rich_menu_rules").insert({ organization_id: input.organizationId, rich_menu_id: menu.id, priority: 0, conditions_json: { tagId: input.tagId }, is_active: true });
    if (ruleError) {
      await input.client.from("rich_menus").delete().eq("organization_id", input.organizationId).eq("id", menu.id);
      await lineRequest(`/v2/bot/richmenu/${encodeURIComponent(lineId)}`, { method: "DELETE" }).catch(() => undefined);
      throw new Error("rich menuのタグ条件を保存できませんでした。");
    }
  }
  return row(menu);
}

async function runTagRichMenuRule(input: { client: SupabaseClient; organizationId: string; contactId: string; tagId: string }): Promise<"linked" | "not_configured"> {
  const { data: rules, error } = await input.client.from("rich_menu_rules").select("rich_menu_id, conditions_json").eq("organization_id", input.organizationId).eq("is_active", true).order("priority", { ascending: true }).limit(20);
  if (error) throw new Error("タグ起点rich menuの取得に失敗しました。");
  const rule = (rules || []).map(row).find((candidate) => row(candidate.conditions_json).tagId === input.tagId);
  if (!rule) return "not_configured";
  await linkLiveRichMenuForTest({ client: input.client, organizationId: input.organizationId, contactId: input.contactId, richMenuId: String(rule.rich_menu_id) });
  return "linked";
}

export async function listLiveRichMenus(client: SupabaseClient, organizationId: string): Promise<Row[]> {
  const { data, error } = await client.from("rich_menus").select("*").eq("organization_id", organizationId).neq("status", "deleted").order("created_at", { ascending: false });
  if (error) throw new Error("rich menuの取得に失敗しました。");
  const result: Row[] = [];
  for (const menuValue of data || []) {
    const menu = row(menuValue);
    const { count } = await client.from("rich_menu_assignments").select("contact_id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("rich_menu_id", String(menu.id)).eq("status", "synced");
    result.push({ ...menu, links: [], linkCount: count || 0 });
  }
  return result;
}

async function currentUserRichMenu(lineUserId: string): Promise<string | null> {
  const token = getServerEnv().LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error("LINE_CHANNEL_ACCESS_TOKENが設定されていません。");
  const response = await fetch(`https://api.line.me/v2/bot/user/${encodeURIComponent(lineUserId)}/richmenu`, { headers: { Authorization: `Bearer ${token}` }, redirect: "error" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`LINE rich menu取得に失敗しました (${response.status})`);
  const body = row(await response.json());
  return typeof body.richMenuId === "string" ? String(body.richMenuId) : null;
}

export async function getLiveRichMenuForTest(input: { client: SupabaseClient; organizationId: string; contactId?: string }): Promise<string | null> {
  const contact = await resolveContact(input.client, input.organizationId, input.contactId);
  assertTestRecipient(String(contact.line_user_id));
  return currentUserRichMenu(String(contact.line_user_id));
}

export async function linkLiveRichMenuForTest(input: { client: SupabaseClient; organizationId: string; contactId?: string; richMenuId: string }): Promise<{ lineRichMenuId: string; previousRichMenuId: string | null }> {
  assertLaunchAction("LINE_RICH_MENU_MUTATION_ENABLED");
  const contact = await resolveContact(input.client, input.organizationId, input.contactId);
  const contactId = String(contact.id);
  assertTestRecipient(String(contact.line_user_id));
  const { data: menu, error } = await input.client.from("rich_menus").select("id, line_rich_menu_id").eq("organization_id", input.organizationId).eq("id", input.richMenuId).eq("status", "active").single();
  if (error || !menu || !row(menu).line_rich_menu_id) throw new Error("rich menuが見つかりません。");
  const { data: existingAssignment } = await input.client.from("rich_menu_assignments").select("rich_menu_id, source_id, status").eq("organization_id", input.organizationId).eq("contact_id", contactId).maybeSingle();
  if (existingAssignment && String(row(existingAssignment).rich_menu_id) === input.richMenuId && row(existingAssignment).status === "synced") {
    return { lineRichMenuId: String(row(menu).line_rich_menu_id), previousRichMenuId: row(existingAssignment).source_id ? String(row(existingAssignment).source_id) : null };
  }
  const previousRichMenuId = await currentUserRichMenu(String(contact.line_user_id));
  await lineRequest(`/v2/bot/user/${encodeURIComponent(String(contact.line_user_id))}/richmenu/${encodeURIComponent(String(row(menu).line_rich_menu_id))}`, { method: "POST" });
  const { error: assignmentError } = await input.client.from("rich_menu_assignments").upsert({ organization_id: input.organizationId, contact_id: contactId, rich_menu_id: input.richMenuId, source_type: "tag", source_id: previousRichMenuId, status: "synced", line_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "organization_id,contact_id" });
  if (assignmentError) throw new Error("rich menuの紐付けを保存できませんでした。");
  return { lineRichMenuId: String(row(menu).line_rich_menu_id), previousRichMenuId };
}

export async function restoreLiveRichMenuForTest(input: { client: SupabaseClient; organizationId: string; contactId?: string }): Promise<string | null> {
  assertLaunchAction("LINE_RICH_MENU_MUTATION_ENABLED");
  const contact = await resolveContact(input.client, input.organizationId, input.contactId);
  const contactId = String(contact.id);
  assertTestRecipient(String(contact.line_user_id));
  const { data: assignment, error } = await input.client.from("rich_menu_assignments").select("source_id").eq("organization_id", input.organizationId).eq("contact_id", contactId).maybeSingle();
  if (error || !assignment) throw new Error("復旧対象のrich menu紐付けが見つかりません。");
  const previous = row(assignment).source_id ? String(row(assignment).source_id) : null;
  if (previous) await lineRequest(`/v2/bot/user/${encodeURIComponent(String(contact.line_user_id))}/richmenu/${encodeURIComponent(previous)}`, { method: "POST" });
  else await lineRequest(`/v2/bot/user/${encodeURIComponent(String(contact.line_user_id))}/richmenu`, { method: "DELETE" });
  await input.client.from("rich_menu_assignments").update({ status: "removed", line_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("organization_id", input.organizationId).eq("contact_id", contactId);
  return previous;
}
