const MAX_RICH_MENU_IMAGE_BYTES = 1024 * 1024;

export type RichMenuImageInfo = {
  contentType: "image/jpeg" | "image/png";
  width: number;
  height: number;
};

function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24 || !signature.every((value, index) => bytes[index] === value)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > bytes.length) break;
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    if (sofMarkers.has(marker) && segmentLength >= 7) {
      return {
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
        width: (bytes[offset + 5] << 8) | bytes[offset + 6]
      };
    }
    offset += segmentLength;
  }
  return null;
}

export function validateRichMenuImage(bytes: Uint8Array, contentType: string): RichMenuImageInfo {
  if (bytes.length === 0) throw new Error("リッチメニュー画像が空です。");
  if (bytes.length > MAX_RICH_MENU_IMAGE_BYTES) throw new Error("リッチメニュー画像は1MB以下にしてください。");
  if (contentType !== "image/jpeg" && contentType !== "image/png") throw new Error("リッチメニュー画像はJPEGまたはPNGにしてください。");
  const dimensions = contentType === "image/png" ? pngDimensions(bytes) : jpegDimensions(bytes);
  if (!dimensions) throw new Error("リッチメニュー画像の形式またはサイズを読み取れませんでした。");
  if (dimensions.width < 800 || dimensions.width > 2500 || dimensions.height < 250 || dimensions.width / dimensions.height < 1.45) {
    throw new Error("画像は幅800〜2500px、高さ250px以上、縦横比1.45以上にしてください。");
  }
  return { contentType, ...dimensions };
}
