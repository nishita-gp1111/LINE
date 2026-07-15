export type SurveyPresetQuestion = {
  title: string;
  options: Array<{ label: string; tagName: string }>;
};

export const GP_AFTER_SURVEY_PRESET = {
  name: "アフターアンケート",
  greetingMessage: `🎉 友だち追加ありがとうございます！
こちらは GP PRモニター窓口です😊

このLINEでは、

✅ モニター案件のご案内
✅ 副業・在宅ワークのご相談
✅ あなたに合った案件のご紹介

を行っています✨

まずは30秒で終わる簡単なアンケートにご回答ください！

回答内容をもとに、あなたに合ったご案内をさせていただきます😊

👇それではアンケートを開始します！`,
  completionMessage: `🎉 アンケートにご回答いただき、ありがとうございます！

ご本人確認のため、現在やり取りしているクラウドワークスのアカウント名（ユーザー名）を、このチャットに送信してください😊

また、副業に関するご相談やモニターについてのご相談は、リッチメニューからいつでも受け付けています！

「自分に合う副業を知りたい」
「他のモニター案件について詳しく知りたい」

など、気になることがありましたら、お気軽にご相談ください✨`,
  richMenuName: "GP PRモニター 基本メニュー（入力対応）",
  richMenuFallbackMinutes: 30,
  sendOnFollow: true,
  questions: [
    {
      title: "年代を教えてください",
      options: ["10代", "20代", "30代", "40代", "50代", "60代"].map((label) => ({ label, tagName: label }))
    },
    {
      title: "性別を教えてください",
      options: ["男性", "女性"].map((label) => ({ label, tagName: label }))
    },
    {
      title: "現在のご職業に近いものを教えてください",
      options: ["会社員", "主婦", "学生", "自営業・フリーランス", "パート・アルバイト", "無職", "その他"].map((label) => ({ label, tagName: label }))
    },
    {
      title: "副業で毎月どのくらい収入を増やしたいですか？",
      options: ["3万円未満", "3〜5万円", "5〜10万円", "10〜30万円", "30〜50万円", "副業に興味ない"].map((label) => ({ label, tagName: label }))
    },
    {
      title: "どんな副業に興味がありますか？",
      options: ["AIを使った副業", "営業代行", "Web制作", "SNS運用", "アフィリエイト", "起業・独立", "自分に合う副業を知りたい"].map((label) => ({ label, tagName: label }))
    }
  ] satisfies SurveyPresetQuestion[]
};

export function gpAfterSurveyTagNames(): string[] {
  return [...new Set(GP_AFTER_SURVEY_PRESET.questions.flatMap((question) => question.options.map((option) => option.tagName)))];
}
