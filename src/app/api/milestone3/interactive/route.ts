import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth/server";
import { canAdminister, canOperate, getInboxAuthContext } from "@/lib/inbox/auth";
import { getServerEnv } from "@/lib/env/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { activateScenario, answerSurvey, createRichMenu, createRule, createScenario, createSurvey, deactivateScenario, enrollAndRunScenario, linkRichMenuForTest, listMenus, listRules, listScenarios, listSurveys, previewRule, setFollowSurveyForMock, validateRichMenuForMock, chooseSurveyInput } from "@/lib/milestone3/interactive-store";
import { activateLiveScenario, createLiveTagScenario, createLiveSurvey, deactivateLiveScenario, listLiveContacts, listLiveRichMenus, listLiveScenarios, listLiveSurveys, setLiveFollowSurvey, startLiveSurvey, updateLiveSurveyExperience } from "@/lib/minimum-launch/live";

function reply(data: unknown, status = 200) { return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } }); }
export async function GET(request: Request) {
  if (!await getAuthenticatedUser()) return reply({ error: "unauthorized" }, 401);
  const resource = new URL(request.url).searchParams.get("resource");
  if (!getServerEnv().MOCK_LINE_API) {
    const auth = await getInboxAuthContext();
    const client = createSupabaseAdminClient();
    if (!auth || !client) return reply({ error: "database_not_configured" }, 503);
    if (resource === "contacts") return reply({ contacts: await listLiveContacts(client, auth.organizationId) });
    if (resource === "surveys") return reply({ surveys: await listLiveSurveys(client, auth.organizationId) });
    if (resource === "menus") return reply({ menus: await listLiveRichMenus(client, auth.organizationId) });
    return reply({ scenarios: await listLiveScenarios(client, auth.organizationId) });
  }
  if (resource === "contacts") return reply({ contacts: [{ id: "mock-contact-test", displayName: "Mock Contact", friendStatus: "following" }] });
  if (resource === "rules") return reply({ rules: listRules() });
  if (resource === "surveys") return reply({ surveys: listSurveys() });
  if (resource === "menus") return reply({ menus: listMenus() });
  return reply({ scenarios: listScenarios() });
}

export async function POST(request: Request) {
  if (!await getAuthenticatedUser()) return reply({ error: "unauthorized" }, 401);
  try {
    const body = await request.json() as { action?: string; [key: string]: unknown };
    if (!getServerEnv().MOCK_LINE_API) {
      const auth = await getInboxAuthContext();
      const client = createSupabaseAdminClient();
      if (!auth || !client) return reply({ error: "database_not_configured" }, 503);
      if (!canOperate(auth.role)) return reply({ error: "権限がありません。" }, 403);
      if (body.action === "scenario_create") {
        if (!canAdminister(auth.role)) return reply({ error: "管理者権限が必要です。" }, 403);
        return reply({ scenario: await createLiveTagScenario({ client, organizationId: auth.organizationId, profileId: auth.profileId, name: String(body.name || ""), tagId: String(body.tagId || ""), text: String(body.text || "") }) }, 201);
      }
      if (body.action === "scenario_activate") {
        if (!canAdminister(auth.role)) return reply({ error: "管理者権限が必要です。" }, 403);
        return reply({ scenario: await activateLiveScenario(client, auth.organizationId, String(body.id)) });
      }
      if (body.action === "scenario_deactivate") {
        if (!canAdminister(auth.role)) return reply({ error: "管理者権限が必要です。" }, 403);
        return reply({ scenario: await deactivateLiveScenario(client, auth.organizationId, String(body.id)) });
      }
      if (body.action === "survey_create") return reply({ survey: await createLiveSurvey({ client, organizationId: auth.organizationId, profileId: auth.profileId, name: String(body.name || ""), questionTitle: String(body.questionTitle || ""), options: Array.isArray(body.options) ? body.options as Array<{ key: string; label: string; tagId?: string }> : [], questions: Array.isArray(body.questions) ? body.questions as Array<{ key?: string; title: string; options: Array<{ key?: string; label: string; tagId?: string }> }> : undefined, greetingMessage: String(body.greetingMessage || ""), completionMessage: String(body.completionMessage || ""), postSurveyRichMenuId: body.postSurveyRichMenuId ? String(body.postSurveyRichMenuId) : undefined, richMenuFallbackMinutes: Number(body.richMenuFallbackMinutes || 30), sendOnFollow: body.sendOnFollow === true }) }, 201);
      if (body.action === "survey_experience_update") return reply({ survey: await updateLiveSurveyExperience({ client, organizationId: auth.organizationId, surveyId: String(body.surveyId || ""), greetingMessage: String(body.greetingMessage || ""), completionMessage: String(body.completionMessage || ""), postSurveyRichMenuId: body.postSurveyRichMenuId ? String(body.postSurveyRichMenuId) : null, richMenuFallbackMinutes: Number(body.richMenuFallbackMinutes || 30) }) });
      if (body.action === "survey_send") return reply({ message: await startLiveSurvey({ client, organizationId: auth.organizationId, surveyId: String(body.surveyId), contactId: body.contactId ? String(body.contactId) : undefined, profileId: auth.profileId, includeGreeting: body.includeGreeting === true }) });
      if (body.action === "survey_follow_set") return reply({ surveyId: await setLiveFollowSurvey(client, auth.organizationId, body.surveyId ? String(body.surveyId) : null) });
      if (body.action === "rich_menu_create") return reply({ error: "リッチメニュー画像を含む作成画面を使用してください。" }, 400);
      return reply({ error: "unknown_action" }, 400);
    }
    if (body.action === "scenario_create") return reply({ scenario: createScenario({ name: String(body.name || ""), triggerType: String(body.triggerType || "manual"), steps: body.steps || [] }) }, 201);
    if (body.action === "scenario_activate") return reply({ scenario: activateScenario(String(body.id)) });
    if (body.action === "scenario_deactivate") return reply({ scenario: deactivateScenario(String(body.id)) });
    if (body.action === "scenario_run") return reply({ scenario: await enrollAndRunScenario(String(body.id), String(body.contactId || "mock-contact-test")) });
    if (body.action === "rule_create") return reply({ rule: createRule(body) }, 201);
    if (body.action === "rule_preview") return reply(previewRule(String(body.input || "")));
    if (body.action === "survey_create") return reply({ survey: createSurvey({ name: String(body.name || ""), questionTitle: String(body.questionTitle || ""), type: String(body.type || "single_choice"), options: Array.isArray(body.options) ? body.options as Array<{ key: string; label: string; tagId?: string }> : [], questions: Array.isArray(body.questions) ? body.questions as Array<{ key?: string; title: string; options: Array<{ key?: string; label: string; tagId?: string }> }> : undefined, completionMessage: String(body.completionMessage || ""), sendOnFollow: body.sendOnFollow === true }) }, 201);
    if (body.action === "survey_follow_set") return reply({ surveyId: setFollowSurveyForMock(body.surveyId ? String(body.surveyId) : null) });
    if (body.action === "survey_answer") return reply(answerSurvey({ surveyId: String(body.surveyId), contactId: String(body.contactId || "mock-contact-test"), token: String(body.token), idempotencyKey: String(body.idempotencyKey) }));
    if (body.action === "survey_priority") return reply({ priority: chooseSurveyInput(Boolean(body.waitingText), Boolean(body.postback)) });
    if (body.action === "rich_menu_create") return reply({ menu: createRichMenu({ name: String(body.name || ""), definition: body.definition }) }, 201);
    if (body.action === "rich_menu_validate") return reply(validateRichMenuForMock(String(body.id)));
    if (body.action === "rich_menu_test_link") return reply({ menu: linkRichMenuForTest(String(body.id), String(body.lineUserId), "owner") });
    return reply({ error: "unknown_action" }, 400);
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : "interactive_action_failed" }, 400);
  }
}
