import { describe, expect, it } from "vitest";
import { assignmentEffectMetadata, followSurveyClientRequestId, parseSurveyPostbackData, selectRichMenuRule, shouldRunTagAddedEffects, surveyCompletionClientRequestId, surveyGreetingClientRequestId, surveyPostbackData, surveyQuestionClientRequestId, surveyResponseKey, surveyRichMenuJobKey, surveyRichMenuRunAt } from "@/lib/minimum-launch/domain";
import { validateRichMenuImage } from "@/lib/minimum-launch/rich-menu-image";

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function jpeg(width: number, height: number): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00, 0xff, 0xd9]);
}

describe("minimum internal launch domain", () => {
  it("creates one stable response key per session question", () => {
    expect(surveyResponseKey("session-1", "question-1")).toBe("survey-response:session-1:question-1");
  });

  it("creates one stable outbound id for a redelivered follow event", () => {
    expect(followSurveyClientRequestId("event-1", "survey-1", "contact-1")).toBe("minimum-follow-survey:event-1:survey-1:contact-1");
    expect(followSurveyClientRequestId("event-1", "survey-1", "contact-1")).toBe(followSurveyClientRequestId("event-1", "survey-1", "contact-1"));
    expect(surveyGreetingClientRequestId("event-1", "survey-1", "contact-1")).toBe("minimum-survey-greeting:event-1:survey-1:contact-1");
  });

  it("binds survey postbacks and follow-up sends to one session", () => {
    const data = surveyPostbackData("session-1", "opaque.token");
    expect(data).toBe("minimum-survey:session-1:opaque.token");
    expect(parseSurveyPostbackData(data)).toEqual({ sessionId: "session-1", token: "opaque.token" });
    expect(parseSurveyPostbackData("minimum-survey:legacy.token")).toEqual({ sessionId: null, token: "legacy.token" });
    expect(parseSurveyPostbackData("not-a-survey")).toBeNull();
    expect(surveyQuestionClientRequestId("session-1", "question-2")).toBe("minimum-survey-question:session-1:question-2");
    expect(surveyCompletionClientRequestId("session-1")).toBe("minimum-survey-complete:session-1");
    expect(surveyRichMenuJobKey("session-1")).toBe("survey-rich-menu:session-1");
    expect(surveyRichMenuRunAt(new Date("2026-07-15T00:00:00.000Z"), 30)).toBe("2026-07-15T00:30:00.000Z");
  });

  it("records whether a tag assignment was the effective transition", () => {
    expect(shouldRunTagAddedEffects(assignmentEffectMetadata(true))).toBe(true);
    expect(shouldRunTagAddedEffects(assignmentEffectMetadata(false))).toBe(false);
    expect(shouldRunTagAddedEffects({})).toBe(false);
  });

  it("selects the highest priority active tag rich-menu rule deterministically", () => {
    const rules = [
      { id: "later", tagId: "tag-b", richMenuId: "menu-b", priority: 10, createdAt: "2026-07-14T02:00:00Z" },
      { id: "first", tagId: "tag-a", richMenuId: "menu-a", priority: 0, createdAt: "2026-07-14T01:00:00Z" }
    ];
    expect(selectRichMenuRule(["tag-a", "tag-b"], rules)?.richMenuId).toBe("menu-a");
    expect(selectRichMenuRule(["tag-c"], rules)).toBeNull();
  });
});

describe("rich-menu image validation", () => {
  it("accepts LINE-compatible PNG and JPEG dimensions", () => {
    expect(validateRichMenuImage(png(2500, 1686), "image/png")).toMatchObject({ width: 2500, height: 1686 });
    expect(validateRichMenuImage(jpeg(1200, 600), "image/jpeg")).toMatchObject({ width: 1200, height: 600 });
  });

  it("rejects unsupported dimensions and content types", () => {
    expect(() => validateRichMenuImage(png(700, 300), "image/png")).toThrow(/幅800/);
    expect(() => validateRichMenuImage(png(2500, 1686), "image/gif")).toThrow(/JPEGまたはPNG/);
  });
});
