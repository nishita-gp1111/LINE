import { beforeEach, describe, expect, it } from "vitest";
import { activateScenario, createRule, createScenario, createSurvey, deactivateScenario, enrollAndRunScenario, answerSurvey, createRichMenu, listSurveys, validateRichMenuForMock } from "@/lib/milestone3/interactive-store";
import { createTag, foundationState } from "@/lib/milestone3/foundation-store";

beforeEach(() => { process.env.MOCK_LINE_API = "true"; process.env.APP_ENV = "test"; process.env.LINE_CHANNEL_SECRET = "interactive-test-secret"; });

describe("Milestone 3 interactive Mock flows", () => {
  it("runs a scenario and records idempotent enrollment", async () => {
    const scenario = createScenario({ name: `scenario-${Date.now()}`, triggerType: "manual", steps: [{ order: 0, type: "end", config: {} }] });
    scenario.status = "active";
    const first = await enrollAndRunScenario(scenario.id, "mock-contact"); const second = await enrollAndRunScenario(scenario.id, "mock-contact");
    expect(first.enrollments).toHaveLength(1); expect(second.enrollments).toHaveLength(1); expect(first.enrollments[0]?.status).toBe("completed");
  });
  it("pauses an active scenario, rejects new runs, and allows reactivation", async () => {
    const scenario = createScenario({ name: `pausable-${Date.now()}`, triggerType: "tag_added", steps: [{ order: 0, type: "end", config: {} }] });
    expect(activateScenario(scenario.id).status).toBe("active");
    expect(deactivateScenario(scenario.id).status).toBe("paused");
    await expect(enrollAndRunScenario(scenario.id, "paused-contact")).rejects.toThrow("scenario is not active");
    expect(activateScenario(scenario.id).status).toBe("active");
    await expect(enrollAndRunScenario(scenario.id, "reactivated-contact")).resolves.toMatchObject({ status: "active" });
  });
  it("orders and previews keyword rules", () => { const rule = createRule({ matchType: "exact", pattern: `hello-${Date.now()}`, priority: 1, isActive: true, stopAfterMatch: true, action: "reply" }); expect(rule.matchType).toBe("exact"); });
  it("answers a survey once per idempotency key", () => { const survey = createSurvey({ name: `survey-${Date.now()}`, questionTitle: "OK?", type: "single_choice", options: [{ key: "yes", label: "Yes" }] }); const token = survey.question.options[0]!.token; const first = answerSurvey({ surveyId: survey.id, contactId: "mock-contact", token, idempotencyKey: "same-answer" }); const second = answerSurvey({ surveyId: survey.id, contactId: "mock-contact", token, idempotencyKey: "same-answer" }); expect(first.duplicate).toBe(false); expect(second.duplicate).toBe(true); });
  it("assigns the mapped tag once when a LINE answer button is redelivered", () => {
    const tag = createTag({ name: `Web広告-${Date.now()}` });
    const contactId = `survey-contact-${Date.now()}`;
    const survey = createSurvey({
      name: `tag-survey-${Date.now()}`,
      questionTitle: "どこで私たちを知りましたか？",
      type: "single_choice",
      options: [{ key: "web_ad", label: "Web広告", tagId: tag.id }]
    });
    const token = survey.question.options[0]!.token;

    const first = answerSurvey({ surveyId: survey.id, contactId, token, idempotencyKey: "same-line-postback" });
    const redelivery = answerSurvey({ surveyId: survey.id, contactId, token, idempotencyKey: "same-line-postback" });
    const assignments = foundationState().assignments.filter((assignment) =>
      assignment.contactId === contactId && assignment.tagId === tag.id && assignment.removedAt === null
    );

    expect(first.duplicate).toBe(false);
    expect(redelivery.duplicate).toBe(true);
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({ sourceType: "survey", sourceId: survey.id });
    expect(listSurveys().find((item) => item.id === survey.id)?.question.options[0]).toMatchObject({
      label: "Web広告",
      tagId: tag.id
    });
  });
  it("moves to the next LINE question and assigns each answer tag once", () => {
    const firstTag = createTag({ name: `年代20代-${Date.now()}` });
    const secondTag = createTag({ name: `興味採用-${Date.now()}` });
    const contactId = `sequential-survey-contact-${Date.now()}`;
    const survey = createSurvey({
      name: `sequential-survey-${Date.now()}`,
      questionTitle: "",
      type: "single_choice",
      options: [],
      completionMessage: "回答ありがとうございました。",
      questions: [
        { title: "年代を教えてください", options: [{ key: "twenties", label: "20代", tagId: firstTag.id }] },
        { title: "興味のある内容を教えてください", options: [{ key: "recruit", label: "採用情報", tagId: secondTag.id }] }
      ]
    });

    const first = answerSurvey({ surveyId: survey.id, contactId, token: survey.questions[0]!.options[0]!.token, idempotencyKey: "question-1" });
    const firstRedelivery = answerSurvey({ surveyId: survey.id, contactId, token: survey.questions[0]!.options[0]!.token, idempotencyKey: "question-1-redelivery" });
    const second = answerSurvey({ surveyId: survey.id, contactId, token: survey.questions[1]!.options[0]!.token, idempotencyKey: "question-2" });
    const assignments = foundationState().assignments.filter((assignment) => assignment.contactId === contactId && assignment.removedAt === null);

    expect(first).toMatchObject({ duplicate: false, completed: false, nextQuestion: { title: "興味のある内容を教えてください" } });
    expect(firstRedelivery).toMatchObject({ duplicate: true, completed: false });
    expect(second).toMatchObject({ duplicate: false, completed: true, nextQuestion: null });
    expect(survey.responses).toHaveLength(2);
    expect(assignments.map((assignment) => assignment.tagId)).toEqual([firstTag.id, secondTag.id]);
  });
  it("validates a rich menu before test link", () => { const menu = createRichMenu({ name: `menu-${Date.now()}`, definition: { width: 2500, height: 1686, chatBarText: "Menu", areas: [{ x: 0, y: 0, width: 2500, height: 1686, action: { type: "message", text: "hello" } }] } }); expect(validateRichMenuForMock(menu.id).valid).toBe(true); });
});
