type SurveyAnswer = {
  label: string;
  data: string;
};

export type LineFlexMessage = {
  type: "flex";
  altText: string;
  contents: Record<string, unknown>;
};

const BRAND = {
  ink: "#17322D",
  green: "#0B8F69",
  greenDark: "#087255",
  greenSoft: "#EAF7F2",
  line: "#D8E8E2",
  muted: "#657A73",
  paper: "#F7FAF9",
  white: "#FFFFFF"
} as const;

function accountLabel(accountName?: string): string {
  return accountName?.trim() || "LINE公式アカウント";
}

function progressSegments(current: number, total: number): Array<Record<string, unknown>> {
  return Array.from({ length: total }, (_, index) => ({
    type: "box",
    layout: "vertical",
    flex: 1,
    height: "5px",
    cornerRadius: "3px",
    backgroundColor: index < current ? BRAND.green : BRAND.line,
    contents: []
  }));
}

export function buildSurveyGreetingMessage(input: {
  accountName?: string;
  greeting: string;
  questionTotal: number;
}): LineFlexMessage {
  const greeting = input.greeting.trim();
  const count = Math.max(1, input.questionTotal);
  return {
    type: "flex",
    altText: greeting.slice(0, 1500),
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        paddingAll: "20px",
        backgroundColor: BRAND.greenDark,
        contents: [
          { type: "text", text: accountLabel(input.accountName), color: BRAND.white, size: "xs", weight: "bold" },
          { type: "text", text: "友だち追加ありがとうございます", color: BRAND.white, size: "xl", weight: "bold", margin: "sm", wrap: true }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "20px",
        contents: [
          { type: "text", text: greeting, color: BRAND.ink, size: "md", wrap: true },
          {
            type: "box",
            layout: "horizontal",
            margin: "xl",
            paddingAll: "14px",
            cornerRadius: "12px",
            backgroundColor: BRAND.greenSoft,
            contents: [
              { type: "text", text: "✓", color: BRAND.greenDark, size: "lg", weight: "bold", flex: 0 },
              { type: "text", text: `${count}問・タップだけで回答できます`, color: BRAND.greenDark, size: "sm", weight: "bold", margin: "md", wrap: true }
            ]
          }
        ]
      }
    }
  };
}

export function buildSurveyQuestionMessage(input: {
  accountName?: string;
  title: string;
  questionNumber: number;
  questionTotal: number;
  answers: SurveyAnswer[];
}): LineFlexMessage {
  const total = Math.max(1, input.questionTotal);
  const current = Math.min(Math.max(1, input.questionNumber), total);
  const title = input.title.trim();
  const buttons = input.answers.map((answer) => ({
    type: "button",
    style: "primary",
    height: "sm",
    color: BRAND.green,
    action: {
      type: "postback",
      label: answer.label,
      data: answer.data,
      displayText: answer.label
    }
  }));

  return {
    type: "flex",
    altText: `アンケート ${current}/${total}｜${title}`.slice(0, 1500),
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        paddingAll: "20px",
        backgroundColor: BRAND.greenDark,
        contents: [
          { type: "text", text: accountLabel(input.accountName), color: BRAND.white, size: "xs", weight: "bold" },
          { type: "text", text: "かんたんアンケート", color: BRAND.white, size: "xl", weight: "bold", margin: "sm" }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "20px",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: `QUESTION ${current}`, color: BRAND.greenDark, size: "xs", weight: "bold", flex: 1 },
              { type: "text", text: `${current} / ${total}`, color: BRAND.muted, size: "xs", align: "end", flex: 1 }
            ]
          },
          { type: "box", layout: "horizontal", spacing: "xs", margin: "sm", contents: progressSegments(current, total) },
          { type: "text", text: title, color: BRAND.ink, size: "xl", weight: "bold", margin: "xl", wrap: true },
          { type: "text", text: "当てはまるものを1つ選択してください", color: BRAND.muted, size: "sm", margin: "md", wrap: true }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        paddingAll: "16px",
        backgroundColor: BRAND.paper,
        separator: true,
        separatorColor: BRAND.line,
        contents: [
          ...buttons,
          { type: "text", text: current < total ? "回答すると次の質問へ進みます" : "回答するとアンケートは完了です", color: BRAND.muted, size: "xxs", align: "center", margin: "sm", wrap: true }
        ]
      }
    }
  };
}

export function buildSurveyCompletionMessage(input: {
  accountName?: string;
  message: string;
  richMenuLinked: boolean;
}): LineFlexMessage {
  const message = input.message.trim();
  return {
    type: "flex",
    altText: message.slice(0, 1500),
    contents: {
      type: "bubble",
      size: "mega",
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "24px",
        contents: [
          {
            type: "box",
            layout: "vertical",
            alignItems: "center",
            contents: [
              {
                type: "box",
                layout: "vertical",
                width: "48px",
                height: "48px",
                cornerRadius: "24px",
                backgroundColor: BRAND.green,
                justifyContent: "center",
                contents: [{ type: "text", text: "✓", color: BRAND.white, size: "xl", weight: "bold", align: "center" }]
              }
            ]
          },
          { type: "text", text: "ご回答ありがとうございました", color: BRAND.ink, size: "xl", weight: "bold", align: "center", margin: "xl", wrap: true },
          { type: "text", text: message, color: BRAND.muted, size: "sm", align: "center", margin: "md", wrap: true },
          ...(input.richMenuLinked ? [{ type: "separator", margin: "xl", color: BRAND.line }, { type: "text", text: "画面下のメニューから、いつでもご利用いただけます", color: BRAND.greenDark, size: "sm", weight: "bold", align: "center", margin: "xl", wrap: true }] : []),
          { type: "text", text: accountLabel(input.accountName), color: BRAND.muted, size: "xxs", align: "center", margin: "xl" }
        ]
      }
    }
  };
}
