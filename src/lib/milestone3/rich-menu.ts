import { z } from "zod";

export const richMenuActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("uri"), uri: z.string().url() }),
  z.object({ type: z.literal("message"), text: z.string().trim().min(1).max(5000) }),
  z.object({
    type: z.literal("postback"),
    data: z.string().trim().min(1).max(300),
    inputOption: z.enum(["closeRichMenu", "openRichMenu", "openKeyboard", "openVoice"]).optional(),
    fillInText: z.string().max(300).optional()
  })
]);
export const richMenuAreaSchema = z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), width: z.number().int().positive(), height: z.number().int().positive(), action: richMenuActionSchema });
export const richMenuDefinitionSchema = z.object({ width: z.union([z.literal(2500), z.literal(1200)]), height: z.union([z.literal(1686), z.literal(843)]), chatBarText: z.string().trim().min(1).max(14), selected: z.boolean().default(false), areas: z.array(richMenuAreaSchema).min(1).max(20) });

export function validateRichMenuDefinition(input: unknown) {
  const definition = richMenuDefinitionSchema.parse(input);
  for (const area of definition.areas) {
    if (area.x + area.width > definition.width || area.y + area.height > definition.height) throw new Error("リッチメニュー領域が画像範囲外です。");
    if (area.action.type === "uri" && !area.action.uri.startsWith("https://")) throw new Error("URI actionはHTTPSのみ許可します。");
  }
  return definition;
}

export function assertRichMenuMutation(input: { mock: boolean; enabled: boolean; role: string; isDefaultChange: boolean; confirmation: string }): void {
  if (input.isDefaultChange) {
    if (!input.mock && !input.enabled) throw new Error("LINE_RICH_MENU_MUTATION_ENABLED is disabled");
    if (!["owner", "admin"].includes(input.role)) throw new Error("デフォルトリッチメニューの変更権限がありません。");
    if (input.confirmation !== "SET_DEFAULT_RICH_MENU") throw new Error("全員へ表示する確認が必要です。");
    return;
  }
  if (input.mock) return;
  if (!input.enabled) throw new Error("LINE_RICH_MENU_MUTATION_ENABLED is disabled");
  if (!["owner", "admin"].includes(input.role)) throw new Error("リッチメニュー操作権限がありません。");
}

export function assertPerUserRichMenuPath(path: string): void {
  if (/^\/v2\/bot\/user\/all\/richmenu(?:\/|$)/.test(path)) {
    throw new Error("デフォルトリッチメニュー変更APIは使用できません。");
  }
}

export function assertDefaultRichMenuPath(path: string): void {
  if (!/^\/v2\/bot\/user\/all\/richmenu(?:\/[^/]+)?$/.test(path)) {
    throw new Error("デフォルトリッチメニュー専用API以外は使用できません。");
  }
}
