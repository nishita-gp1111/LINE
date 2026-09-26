import "server-only";
import { getAuthMode } from "@/lib/auth/config";
import { getServerEnv } from "@/lib/env/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getMockWebhookStore } from "@/lib/webhook/store";
import { fetchReceivedImage, ReceivedImageError } from "@/lib/line/received-image";

export async function getReceivedImage(organizationId: string, messageId: string): Promise<Blob> {
  if (getAuthMode() === "mock") {
    const message = getMockWebhookStore().getMessageById(organizationId, messageId);
    if (!message || message.direction !== "inbound" || message.messageType !== "image" || message.deletedAt || message.status === "deleted") throw new ReceivedImageError(404, "写真が見つかりません。");
    // No LINE network access in mock mode. UI tests provide an isolated image fixture.
    throw new ReceivedImageError(410, "Mock Modeでは実際のLINE写真を取得しません。");
  }
  const client = createSupabaseAdminClient();
  if (!client) throw new ReceivedImageError(503, "保存先が設定されていません。");
  const lookup = () => client.from("messages").select("id, line_message_id").eq("organization_id", organizationId)
    .eq("id", messageId).eq("direction", "inbound").eq("message_type", "image").eq("status", "received").is("deleted_at", null).maybeSingle();
  const { data: message, error } = await lookup();
  if (error) throw new ReceivedImageError(503, "写真の情報を確認できませんでした。");
  if (!message?.line_message_id) throw new ReceivedImageError(404, "写真が見つかりません。送信取消された可能性があります。");
  const env = getServerEnv();
  const storage = client.storage.from(env.LINE_MEDIA_BUCKET);
  const path = `${organizationId}/inbound/${messageId}/display.jpg`;
  const { data: cached } = await storage.download(path);
  if (cached) return cached;
  if (env.MOCK_LINE_API) throw new ReceivedImageError(410, "Mock Modeでは実際のLINE写真を取得しません。");
  const bytes = await fetchReceivedImage(String(message.line_message_id), env.LINE_CHANNEL_ACCESS_TOKEN || "");
  // Never archive customer photos in a public bucket, even if its configuration changes.
  const bucket = await client.storage.getBucket(env.LINE_MEDIA_BUCKET);
  if (bucket.data && !bucket.data.public) {
    const saved = await storage.upload(path, bytes, { contentType: "image/jpeg", upsert: true });
    if (saved.error) console.error("[received-image] private archive unavailable");
  } else { console.error("[received-image] private archive unavailable"); }
  // An unsend may race the download. Never return that image; remove the cached copy.
  const current = await lookup();
  if (current.error || !current.data) {
    await storage.remove([path]);
    throw new ReceivedImageError(404, "写真が見つかりません。送信取消された可能性があります。");
  }
  return new Blob([new Uint8Array(bytes)], { type: "image/jpeg" });
}

export async function removeReceivedImage(organizationId: string, lineMessageId: string): Promise<void> {
  const client = createSupabaseAdminClient();
  if (!client) return;
  const { data } = await client.from("messages").select("id").eq("organization_id", organizationId).eq("line_message_id", lineMessageId).eq("status", "deleted").maybeSingle();
  if (data) await client.storage.from(getServerEnv().LINE_MEDIA_BUCKET).remove([`${organizationId}/inbound/${data.id}/display.jpg`]);
}
