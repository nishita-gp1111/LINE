import { z } from "zod";

export const mediaTypeSchema = z.enum(["image", "video", "audio"]);
export type MediaType = z.infer<typeof mediaTypeSchema>;

export const mediaAssetSchema = z.object({
  id: z.string().uuid(),
  assetType: mediaTypeSchema,
  publicUrl: z.string().url(),
  previewUrl: z.string().url().optional(),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  durationMs: z.number().int().positive().optional()
});
export type MediaAsset = z.infer<typeof mediaAssetSchema>;

export const lineMediaMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().trim().min(1).max(5000) }),
  z.object({ type: z.literal("image"), originalContentUrl: z.string().url(), previewImageUrl: z.string().url() }),
  z.object({ type: z.literal("video"), originalContentUrl: z.string().url(), previewImageUrl: z.string().url() }),
  z.object({ type: z.literal("audio"), originalContentUrl: z.string().url(), duration: z.number().int().positive() })
]);
export type LineMediaMessage = z.infer<typeof lineMediaMessageSchema>;

export function mediaMessageFromAsset(asset: MediaAsset): LineMediaMessage {
  const parsed = mediaAssetSchema.parse(asset);
  if (parsed.assetType === "image") return { type: "image", originalContentUrl: parsed.publicUrl, previewImageUrl: parsed.previewUrl ?? parsed.publicUrl };
  if (parsed.assetType === "video") {
    if (!parsed.previewUrl) throw new Error("動画にはpreview画像が必要です。");
    return { type: "video", originalContentUrl: parsed.publicUrl, previewImageUrl: parsed.previewUrl };
  }
  if (!parsed.durationMs) throw new Error("音声にはdurationが必要です。");
  return { type: "audio", originalContentUrl: parsed.publicUrl, duration: parsed.durationMs };
}

export const outboundMessageListSchema = z.array(lineMediaMessageSchema).min(1).max(5);

export function validateMediaUpload(input: { type: MediaType; mimeType: string; sizeBytes: number; hasPreview?: boolean; durationMs?: number }, limits: { image: number; video: number; audio: number }): void {
  const allowed: Record<MediaType, string[]> = { image: ["image/jpeg", "image/png"], video: ["video/mp4"], audio: ["audio/mpeg", "audio/mp4", "audio/x-m4a"] };
  if (!allowed[input.type].includes(input.mimeType)) throw new Error("LINE送信用に許可されていないMIME typeです。");
  if (input.sizeBytes > limits[input.type]) throw new Error("ファイルサイズ上限を超えています。");
  if (input.type === "video" && !input.hasPreview) throw new Error("動画にはpreview画像が必要です。");
  if (input.type === "audio" && (!input.durationMs || input.durationMs <= 0)) throw new Error("音声durationが必要です。");
}
