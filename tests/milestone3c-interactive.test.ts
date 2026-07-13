import { beforeEach, describe, expect, it } from "vitest";
import { createRule, createScenario, createSurvey, enrollAndRunScenario, answerSurvey, createRichMenu, validateRichMenuForMock } from "@/lib/milestone3/interactive-store";

beforeEach(() => { process.env.MOCK_LINE_API = "true"; process.env.APP_ENV = "test"; process.env.LINE_CHANNEL_SECRET = "interactive-test-secret"; });

describe("Milestone 3 interactive Mock flows", () => {
  it("runs a scenario and records idempotent enrollment", async () => {
    const scenario = createScenario({ name: `scenario-${Date.now()}`, triggerType: "manual", steps: [{ order: 0, type: "end", config: {} }] });
    scenario.status = "active";
    const first = await enrollAndRunScenario(scenario.id, "mock-contact"); const second = await enrollAndRunScenario(scenario.id, "mock-contact");
    expect(first.enrollments).toHaveLength(1); expect(second.enrollments).toHaveLength(1); expect(first.enrollments[0]?.status).toBe("completed");
  });
  it("orders and previews keyword rules", () => { const rule = createRule({ matchType: "exact", pattern: `hello-${Date.now()}`, priority: 1, isActive: true, stopAfterMatch: true, action: "reply" }); expect(rule.matchType).toBe("exact"); });
  it("answers a survey once per idempotency key", () => { const survey = createSurvey({ name: `survey-${Date.now()}`, questionTitle: "OK?", type: "single_choice", options: [{ key: "yes", label: "Yes" }] }); const token = survey.question.options[0]!.token; const first = answerSurvey({ surveyId: survey.id, contactId: "mock-contact", token, idempotencyKey: "same-answer" }); const second = answerSurvey({ surveyId: survey.id, contactId: "mock-contact", token, idempotencyKey: "same-answer" }); expect(first.duplicate).toBe(false); expect(second.duplicate).toBe(true); });
  it("validates a rich menu before test link", () => { const menu = createRichMenu({ name: `menu-${Date.now()}`, definition: { width: 2500, height: 1686, chatBarText: "Menu", areas: [{ x: 0, y: 0, width: 2500, height: 1686, action: { type: "message", text: "hello" } }] } }); expect(validateRichMenuForMock(menu.id).valid).toBe(true); });
});
