import { describe, expect, it } from "vitest";
import { GP_AFTER_SURVEY_PRESET, gpAfterSurveyTagNames } from "@/lib/minimum-launch/survey-preset";

describe("GP after-survey preset", () => {
  it("contains the complete five-question, 28-tag flow", () => {
    expect(GP_AFTER_SURVEY_PRESET.name).toBe("アフターアンケート");
    expect(GP_AFTER_SURVEY_PRESET.sendOnFollow).toBe(true);
    expect(GP_AFTER_SURVEY_PRESET.richMenuFallbackMinutes).toBe(30);
    expect(GP_AFTER_SURVEY_PRESET.questions).toHaveLength(5);
    expect(GP_AFTER_SURVEY_PRESET.questions.map((question) => question.options.length)).toEqual([6, 2, 7, 6, 7]);
    expect(gpAfterSurveyTagNames()).toHaveLength(28);
  });

  it("stays within the production form and LINE limits", () => {
    expect(GP_AFTER_SURVEY_PRESET.greetingMessage.length).toBeLessThanOrEqual(500);
    expect(GP_AFTER_SURVEY_PRESET.completionMessage.length).toBeLessThanOrEqual(300);
    for (const question of GP_AFTER_SURVEY_PRESET.questions) {
      expect(question.title.length).toBeLessThanOrEqual(500);
      for (const option of question.options) expect(option.label.length).toBeLessThanOrEqual(20);
    }
  });
});
