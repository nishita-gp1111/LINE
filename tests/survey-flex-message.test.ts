import { describe, expect, it } from "vitest";
import { buildSurveyCompletionMessage, buildSurveyGreetingMessage, buildSurveyQuestionMessage } from "@/lib/minimum-launch/survey-flex-message";

type FlexComponent = {
  type?: string;
  text?: string;
  contents?: FlexComponent[];
  action?: { type?: string; label?: string; data?: string; displayText?: string };
};

function block(message: ReturnType<typeof buildSurveyQuestionMessage>, name: "header" | "body" | "footer"): FlexComponent {
  return message.contents[name] as FlexComponent;
}

describe("customer-facing survey Flex Messages", () => {
  it("builds a branded greeting before the first question", () => {
    const message = buildSurveyGreetingMessage({
      accountName: "GP PRモニター窓口",
      greeting: "簡単なアンケートにご協力ください。",
      questionTotal: 2
    });

    expect(message.type).toBe("flex");
    expect(message.altText).toBe("簡単なアンケートにご協力ください。");
    expect(JSON.stringify(message)).toContain("友だち追加ありがとうございます");
    expect(JSON.stringify(message)).toContain("2問・タップだけで回答できます");
  });

  it("renders progress and persistent postback buttons inside the card", () => {
    const message = buildSurveyQuestionMessage({
      accountName: "GP PRモニター窓口",
      title: "当窓口をどこで知りましたか？",
      questionNumber: 1,
      questionTotal: 2,
      answers: [
        { label: "Web広告", data: "minimum-survey:session:token-1" },
        { label: "SNS", data: "minimum-survey:session:token-2" }
      ]
    });
    const body = block(message, "body");
    const footer = block(message, "footer");
    const progress = body.contents?.find((component) => component.type === "box" && component.contents?.length === 2);
    const buttons = footer.contents?.filter((component) => component.type === "button") ?? [];

    expect(message.altText).toBe("アンケート 1/2｜当窓口をどこで知りましたか？");
    expect(progress?.contents).toHaveLength(2);
    expect(buttons).toHaveLength(2);
    expect(footer.contents?.[0]?.type).toBe("separator");
    expect(buttons[0]?.action).toEqual({
      type: "postback",
      label: "Web広告",
      data: "minimum-survey:session:token-1",
      displayText: "Web広告"
    });
    expect(JSON.stringify(message)).not.toContain("quickReply");
  });

  it("shows the post-survey menu guidance only when a menu is linked", () => {
    const linked = buildSurveyCompletionMessage({ accountName: "GP PRモニター窓口", message: "内容を確認してご連絡します。", richMenuLinked: true });
    const unlinked = buildSurveyCompletionMessage({ accountName: "GP PRモニター窓口", message: "内容を確認してご連絡します。", richMenuLinked: false });

    expect(JSON.stringify(linked)).toContain("画面下のメニュー");
    expect(JSON.stringify(unlinked)).not.toContain("画面下のメニュー");
  });
});
