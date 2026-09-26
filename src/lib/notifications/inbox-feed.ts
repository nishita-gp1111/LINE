import { z } from "zod";

export type InboxNotification = { id: string; conversationId: string; createdAt: string; displayName: string; messageType: string };
export type InboxNotificationFeed = { items: InboxNotification[]; cursor: string; hasMore: boolean; scope: string };
const cursorSchema = z.object({ at: z.iso.datetime({ offset: true }), id: z.string().regex(/^(?:mock-message-)?[0-9a-f-]{36}$/i) });
export type NotificationCursor = z.infer<typeof cursorSchema>;
export const NOTIFICATION_PAGE_SIZE = 50;

export function parseNotificationCursor(value: string): NotificationCursor | null {
  if (value.length > 250) return null;
  try { return cursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8"))); } catch { return null; }
}
export function encodeNotificationCursor(cursor: NotificationCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}
export function notificationText(type: string): string {
  const labels: Record<string, string> = { image: "写真", video: "動画", audio: "音声", file: "ファイル", sticker: "スタンプ" };
  return `${labels[type] || "メッセージ"}が届きました`;
}
