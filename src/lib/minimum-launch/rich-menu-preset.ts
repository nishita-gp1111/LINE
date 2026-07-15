import type { RichMenuActionInput } from "@/lib/minimum-launch/rich-menu-layouts";

export const FRIENDLY_RICH_MENU_WIDTH = 1_536;
export const FRIENDLY_RICH_MENU_HEIGHT = 1_024;

export const GP_FRIENDLY_RICH_MENU_PRESET = {
  name: "GP PRモニター 基本メニュー（入力対応）",
  tagName: "基本メニュー表示",
  chatBarText: "メニュー",
  layoutId: "hero-3-friendly" as const,
  applyExisting: false,
  actions: [
    { type: "uri", value: "https://timerex.net/s/s.nishita_b272/a237d2aa" },
    { type: "openKeyboard", value: "" },
    { type: "uri", value: "https://www.growth-path.jp/" }
  ] satisfies RichMenuActionInput[]
};

export function buildFriendlyRichMenuSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${FRIENDLY_RICH_MENU_WIDTH}" height="${FRIENDLY_RICH_MENU_HEIGHT}" viewBox="0 0 ${FRIENDLY_RICH_MENU_WIDTH} ${FRIENDLY_RICH_MENU_HEIGHT}">
  <defs>
    <linearGradient id="hero" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#e4f8ee"/>
      <stop offset="1" stop-color="#f7fcf8"/>
    </linearGradient>
    <linearGradient id="chat" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#eaf7ff"/>
      <stop offset="1" stop-color="#f6fbff"/>
    </linearGradient>
    <linearGradient id="company" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff3d9"/>
      <stop offset="1" stop-color="#fffaf0"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="12" stdDeviation="18" flood-color="#185c47" flood-opacity="0.12"/>
    </filter>
  </defs>

  <rect width="1536" height="1024" fill="#f7fbf8"/>
  <rect x="20" y="20" width="1496" height="553" rx="42" fill="url(#hero)" filter="url(#shadow)"/>
  <circle cx="96" cy="83" r="14" fill="#69d0a2" opacity="0.75"/>
  <circle cx="1452" cy="97" r="20" fill="#ffd56a" opacity="0.88"/>
  <circle cx="1410" cy="158" r="8" fill="#74bff2" opacity="0.7"/>

  <text x="112" y="104" fill="#248366" font-family="-apple-system,BlinkMacSystemFont,'Noto Sans JP',sans-serif" font-size="27" font-weight="800" letter-spacing="3">GP PR MONITOR</text>
  <text x="112" y="226" fill="#153f35" font-family="-apple-system,BlinkMacSystemFont,'Noto Sans JP',sans-serif" font-size="78" font-weight="900">無料相談予約</text>
  <text x="116" y="298" fill="#527169" font-family="-apple-system,BlinkMacSystemFont,'Noto Sans JP',sans-serif" font-size="34" font-weight="650">副業・お仕事の悩みを、気軽に相談できます</text>
  <rect x="112" y="354" width="250" height="76" rx="38" fill="#ffd45f"/>
  <text x="237" y="405" text-anchor="middle" fill="#493b16" font-family="-apple-system,BlinkMacSystemFont,'Noto Sans JP',sans-serif" font-size="31" font-weight="900">30分無料</text>
  <rect x="386" y="354" width="340" height="76" rx="38" fill="#ffffff" opacity="0.9"/>
  <text x="556" y="404" text-anchor="middle" fill="#26775f" font-family="-apple-system,BlinkMacSystemFont,'Noto Sans JP',sans-serif" font-size="28" font-weight="800">オンラインで相談</text>

  <g transform="translate(1170 118)">
    <circle cx="138" cy="138" r="132" fill="#ffffff" opacity="0.92"/>
    <rect x="64" y="58" width="148" height="146" rx="28" fill="#54c391"/>
    <rect x="64" y="58" width="148" height="42" rx="22" fill="#269c72"/>
    <rect x="84" y="38" width="18" height="46" rx="9" fill="#ffd45f"/>
    <rect x="174" y="38" width="18" height="46" rx="9" fill="#ffd45f"/>
    <circle cx="104" cy="128" r="12" fill="#ffffff"/>
    <circle cx="140" cy="128" r="12" fill="#ffffff"/>
    <circle cx="176" cy="128" r="12" fill="#ffffff"/>
    <circle cx="104" cy="164" r="12" fill="#ffffff"/>
    <path d="M139 174l18 18 36-43" fill="none" stroke="#fff4b7" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>
  </g>

  <rect x="20" y="613" width="728" height="391" rx="42" fill="url(#chat)" filter="url(#shadow)"/>
  <circle cx="132" cy="748" r="72" fill="#7cc9f4"/>
  <path d="M94 716h76a24 24 0 0 1 24 24v30a24 24 0 0 1-24 24h-29l-27 23 5-23H94a24 24 0 0 1-24-24v-30a24 24 0 0 1 24-24z" fill="#ffffff"/>
  <circle cx="112" cy="755" r="7" fill="#60aeda"/>
  <circle cx="136" cy="755" r="7" fill="#60aeda"/>
  <circle cx="160" cy="755" r="7" fill="#60aeda"/>
  <text x="232" y="744" fill="#193e51" font-family="-apple-system,BlinkMacSystemFont,'Noto Sans JP',sans-serif" font-size="55" font-weight="900">チャット相談</text>
  <text x="234" y="807" fill="#557784" font-family="-apple-system,BlinkMacSystemFont,'Noto Sans JP',sans-serif" font-size="29" font-weight="650">LINEで気軽に相談</text>
  <rect x="232" y="850" width="294" height="64" rx="32" fill="#ffffff" opacity="0.92"/>
  <text x="379" y="893" text-anchor="middle" fill="#2878a7" font-family="-apple-system,BlinkMacSystemFont,'Noto Sans JP',sans-serif" font-size="25" font-weight="800">メッセージを送る</text>

  <rect x="788" y="613" width="728" height="391" rx="42" fill="url(#company)" filter="url(#shadow)"/>
  <circle cx="900" cy="748" r="72" fill="#ffce67"/>
  <path d="M850 795h100v-94l-50-31-50 31v94z" fill="#ffffff"/>
  <rect x="879" y="724" width="17" height="17" rx="3" fill="#f2b841"/>
  <rect x="905" y="724" width="17" height="17" rx="3" fill="#f2b841"/>
  <rect x="879" y="751" width="17" height="17" rx="3" fill="#f2b841"/>
  <rect x="905" y="751" width="17" height="44" rx="3" fill="#f2b841"/>
  <text x="1000" y="744" fill="#51411c" font-family="-apple-system,BlinkMacSystemFont,'Noto Sans JP',sans-serif" font-size="55" font-weight="900">会社情報</text>
  <text x="1002" y="807" fill="#806c3e" font-family="-apple-system,BlinkMacSystemFont,'Noto Sans JP',sans-serif" font-size="29" font-weight="650">Growth Pathについて</text>
  <rect x="1000" y="850" width="286" height="64" rx="32" fill="#ffffff" opacity="0.92"/>
  <text x="1143" y="893" text-anchor="middle" fill="#8c691d" font-family="-apple-system,BlinkMacSystemFont,'Noto Sans JP',sans-serif" font-size="25" font-weight="800">公式サイトを見る</text>
</svg>`;
}

export async function createFriendlyRichMenuFile(): Promise<File> {
  const svg = buildFriendlyRichMenuSvg();
  const source = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const sourceUrl = URL.createObjectURL(source);
  try {
    const sourceImage = new Image();
    sourceImage.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      sourceImage.onload = () => resolve();
      sourceImage.onerror = () => reject(new Error("おすすめデザインを生成できませんでした。"));
      sourceImage.src = sourceUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = FRIENDLY_RICH_MENU_WIDTH;
    canvas.height = FRIENDLY_RICH_MENU_HEIGHT;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("おすすめデザインを生成できませんでした。");
    context.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);
    const jpeg = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("おすすめデザインを生成できませんでした。")), "image/jpeg", 0.92);
    });
    return new File([jpeg], "growthpath-friendly-rich-menu.jpg", { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}
