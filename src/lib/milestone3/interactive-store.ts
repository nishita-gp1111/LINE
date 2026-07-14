import "server-only";

import { randomUUID } from "node:crypto";
import { getServerEnv } from "@/lib/env/server";
import { assertLaunchAction } from "@/lib/launch/flags";
import { chooseAutoReply, validateAutoReplyRule, validateScenario, type AutomationStep } from "@/lib/milestone3/automation";
import { assertRichMenuMutation, validateRichMenuDefinition } from "@/lib/milestone3/rich-menu";
import { createOpaquePostbackToken, selectMultiple, surveyInputPriority, verifyOpaquePostbackToken } from "@/lib/milestone3/survey";
import { assignTag, foundationState, setFieldValue } from "@/lib/milestone3/foundation-store";

export type Scenario = { id: string; name: string; triggerType: string; status: "draft" | "active" | "paused"; steps: AutomationStep[]; enrollments: Array<{ id: string; contactId: string; status: string; nextExecutionAt: string | null; history: string[] }> };
export type ReplyRule = { id: string; matchType: "exact" | "prefix" | "contains" | "regex"; pattern: string; priority: number; isActive: boolean; stopAfterMatch: boolean; action: string };
export type MockSurveyOption = { key: string; label: string; token: string; tagId: string | null; action?: { tagId?: string } };
export type MockSurveyQuestion = { key: string; title: string; type: string; options: MockSurveyOption[] };
export type MockSurvey = { id: string; name: string; status: string; sendOnFollow: boolean; completionMessage: string; question: MockSurveyQuestion; questions: MockSurveyQuestion[]; responses: Array<{ contactId: string; questionKey: string; optionKey: string; idempotencyKey: string }> };
export type MockRichMenu = { id: string; name: string; status: string; definition: Record<string, unknown>; links: string[]; managedBy: "api" };
const scenarios: Scenario[] = []; const rules: ReplyRule[] = []; const surveys: MockSurvey[] = []; const menus: MockRichMenu[] = [];

export function listScenarios() { return scenarios; } export function listRules() { return rules; } export function listSurveys() { return surveys.map(({ responses: _responses, ...survey }) => survey); } export function listMenus() { return menus; }
export function createScenario(input: { name: string; triggerType: string; steps: unknown }): Scenario { const parsed = validateScenario({ name: input.name, triggerType: input.triggerType, steps: input.steps }); const item = { id: randomUUID(), name: parsed.name, triggerType: parsed.triggerType, status: "draft" as const, steps: parsed.steps, enrollments: [] }; scenarios.push(item); return item; }
export function activateScenario(id: string): Scenario { const item = scenarios.find((scenario) => scenario.id === id); if (!item) throw new Error("scenario not found"); item.status = "active"; return item; }
export async function enrollAndRunScenario(id: string, contactId: string): Promise<Scenario> { const item = scenarios.find((scenario) => scenario.id === id); if (!item) throw new Error("scenario not found"); if (item.status !== "active") throw new Error("scenario is not active"); const existing = item.enrollments.find((enrollment) => enrollment.contactId === contactId && enrollment.status !== "stopped"); if (existing) return item; const enrollment = { id: randomUUID(), contactId, status: "active", nextExecutionAt: null as string | null, history: [] as string[] }; item.enrollments.push(enrollment); for (const step of item.steps.sort((a, b) => a.order - b.order)) { enrollment.history.push(`${step.order}:${step.type}`); if (step.type === "send_message") { assertLaunchAction("LINE_AUTOMATION_SEND_ENABLED"); } if (step.type === "add_tag" && typeof step.config.tagId === "string") assignTag({ contactId, tagId: step.config.tagId, sourceType: "automation", sourceId: item.id }); if (step.type === "remove_tag") enrollment.history.push("remove_tag_provenance_safe"); if (step.type === "wait_duration") enrollment.nextExecutionAt = new Date(Date.now() + Number(step.config.seconds) * 1000).toISOString(); if (step.type === "end") enrollment.status = "completed"; } if (enrollment.status === "active" && !enrollment.nextExecutionAt) enrollment.status = "completed"; return item; }
export function createRule(input: unknown): ReplyRule { const parsed = validateAutoReplyRule(input); const item = { id: randomUUID(), ...parsed, action: String((input as { action?: string }).action || "record") }; rules.push(item); return item; }
export function previewRule(input: string) { const selected = chooseAutoReply(input, rules); return selected ? { matched: true, ruleId: selected.id, action: selected.action } : { matched: false, ruleId: null, action: null }; }
export function createSurvey(input: { name: string; questionTitle: string; type: string; options: Array<{ key: string; label: string; tagId?: string }>; questions?: Array<{ key?: string; title: string; options: Array<{ key?: string; label: string; tagId?: string }> }>; completionMessage?: string; sendOnFollow?: boolean }): MockSurvey {
  const secret = getServerEnv().SURVEY_POSTBACK_TOKEN_SECRET || "mock-survey-secret";
  if (input.sendOnFollow) surveys.forEach((item) => { item.sendOnFollow = false; });
  const source = input.questions?.length ? input.questions : [{ title: input.questionTitle, options: input.options }];
  if (source.length < 1 || source.length > 10) throw new Error("質問は1〜10件で設定してください。");
  const questions = source.map((question, questionIndex): MockSurveyQuestion => {
    if (!question.title.trim() || question.options.length < 1 || question.options.length > 13) throw new Error("質問または選択肢を確認してください。");
    return {
      key: `question_${questionIndex + 1}`,
      title: question.title.trim(),
      type: input.type,
      options: question.options.map((option, optionIndex) => ({ key: option.key || `option_${optionIndex + 1}`, label: option.label.trim(), token: createOpaquePostbackToken(secret, Date.now() + 24 * 60 * 60 * 1000), tagId: option.tagId ?? null, action: option.tagId ? { tagId: option.tagId } : undefined }))
    };
  });
  const survey: MockSurvey = { id: randomUUID(), name: input.name, status: "active", sendOnFollow: input.sendOnFollow === true, completionMessage: input.completionMessage?.trim() || "回答ありがとうございました。", question: questions[0], questions, responses: [] };
  surveys.push(survey);
  return survey;
}
export function setFollowSurveyForMock(id: string | null): string | null { if (id && !surveys.some((survey) => survey.id === id && survey.status === "active")) throw new Error("survey not found"); surveys.forEach((survey) => { survey.sendOnFollow = survey.id === id; }); return id; }
export function answerSurvey(input: { surveyId: string; contactId: string; token: string; idempotencyKey: string }) {
  const survey = surveys.find((item) => item.id === input.surveyId);
  if (!survey) throw new Error("survey not found");
  const secret = getServerEnv().SURVEY_POSTBACK_TOKEN_SECRET || "mock-survey-secret";
  if (!verifyOpaquePostbackToken(input.token, secret)) throw new Error("invalid or expired survey token");
  const questionIndex = survey.questions.findIndex((question) => question.options.some((candidate) => candidate.token === input.token));
  if (questionIndex < 0) throw new Error("option not found");
  const question = survey.questions[questionIndex];
  const option = question.options.find((candidate) => candidate.token === input.token)!;
  const nextQuestion = survey.questions[questionIndex + 1] || null;
  const existing = survey.responses.find((response) => response.idempotencyKey === input.idempotencyKey || (response.contactId === input.contactId && response.questionKey === question.key));
  if (existing) return { duplicate: true, survey, nextQuestion, completed: !nextQuestion };
  if (option.action?.tagId) assignTag({ contactId: input.contactId, tagId: option.action.tagId, sourceType: "survey", sourceId: survey.id });
  survey.responses.push({ contactId: input.contactId, questionKey: question.key, optionKey: option.key, idempotencyKey: input.idempotencyKey });
  return { duplicate: false, survey, nextQuestion, completed: !nextQuestion };
}
export function createRichMenu(input: { name: string; definition: unknown }): MockRichMenu { const definition = validateRichMenuDefinition(input.definition); const item = { id: randomUUID(), name: input.name, status: "draft", definition, links: [], managedBy: "api" as const }; menus.push(item); return item; }
export function validateRichMenuForMock(id: string) { const item = menus.find((menu) => menu.id === id); if (!item) throw new Error("rich menu not found"); validateRichMenuDefinition(item.definition); return { valid: true, id }; }
export function linkRichMenuForTest(id: string, lineUserId: string, role: string) { const item = menus.find((menu) => menu.id === id); if (!item) throw new Error("rich menu not found"); assertRichMenuMutation({ mock: getServerEnv().MOCK_LINE_API, enabled: getServerEnv().LINE_RICH_MENU_MUTATION_ENABLED, role, isDefaultChange: false, confirmation: "" }); if (!item.links.includes(lineUserId)) item.links.push(lineUserId); return item; }
export function chooseSurveyInput(hasWaitingText: boolean, hasPostback: boolean) { return surveyInputPriority(hasWaitingText, hasPostback); }
export function toggleSurveySelection(current: string[], option: string, max: number) { return selectMultiple(current, option, max); }
export function foundationCounts() { const state = foundationState(); return { tags: state.tags.length, assignments: state.assignments.filter((item) => !item.removedAt).length, fields: state.fields.length }; }
