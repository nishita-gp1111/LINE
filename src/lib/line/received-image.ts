import sharp from "sharp";

export class ReceivedImageError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

const MAX_SOURCE_BYTES = 20_000_000;

// Do not accept a client-supplied URL: only the LINE content endpoint is trusted.
export async function fetchReceivedImage(lineMessageId: string, token: string, fetchImpl: typeof fetch = fetch): Promise<Buffer> {
  if (!token) throw new ReceivedImageError(503, "LINEの画像取得設定が不足しています。");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetchImpl(`https://api-data.line.me/v2/bot/message/${encodeURIComponent(lineMessageId)}/content`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store", redirect: "error", signal: controller.signal
    });
    if (response.status === 404 || response.status === 410) throw new ReceivedImageError(410, "LINE側の保存期限切れなどにより、この写真は取得できません。必要な場合は再送をご依頼ください。");
    if (!response.ok) throw new ReceivedImageError(502, "LINEから写真を取得できませんでした。時間をおいて再試行してください。");
    if (!/^image\/(jpeg|png|webp|gif)(;|$)/i.test(response.headers.get("content-type") || "")) throw new ReceivedImageError(415, "対応していない画像形式です。");
    if (Number(response.headers.get("content-length") || 0) > MAX_SOURCE_BYTES) throw new ReceivedImageError(413, "写真のサイズが大きすぎます。");
    const reader = response.body?.getReader();
    if (!reader) throw new ReceivedImageError(502, "写真を取得できませんでした。");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > MAX_SOURCE_BYTES) { await reader.cancel(); throw new ReceivedImageError(413, "写真のサイズが大きすぎます。"); }
      chunks.push(result.value);
    }
    // A display copy without EXIF, bounded below the hosting response-size limit.
    const source = Buffer.concat(chunks);
    for (const quality of [88, 72, 55]) {
      const image = await sharp(source, { limitInputPixels: 64_000_000 }).rotate()
        .resize({ width: 2560, height: 2560, fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" }).jpeg({ quality }).toBuffer();
      if (image.byteLength <= 3_000_000) return image;
    }
    throw new ReceivedImageError(413, "写真のサイズが大きすぎます。");
  } catch (error) {
    if (error instanceof ReceivedImageError) throw error;
    throw new ReceivedImageError(502, "写真を読み込めませんでした。時間をおいて再試行してください。");
  } finally { clearTimeout(timeout); }
}
