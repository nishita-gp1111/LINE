import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import sharp from "sharp";
import type { LinePushMessageObject } from "@/lib/line/send";
import type { MessageAttachmentType } from "@/lib/inbox/types";

export const INBOX_ATTACHMENT_REQUEST_MAX_BYTES = 4_000_000;
export const LINE_IMAGE_PREVIEW_MAX_BYTES = 1_000_000;

export type InboxAttachmentMimeType = "image/jpeg" | "image/png" | "application/pdf";

export type ValidatedInboxAttachment = {
  attachmentType: MessageAttachmentType;
  fileName: string;
  mimeType: InboxAttachmentMimeType;
  sizeBytes: number;
};

const mimeTypes = new Set<InboxAttachmentMimeType>(["image/jpeg", "image/png", "application/pdf"]);

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

export function normalizeAttachmentFileName(value: string): string {
  const leaf = value.split(/[\\/]/).at(-1) || "file";
  const cleaned = leaf.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (cleaned || "file").slice(0, 200);
}

export function validateInboxAttachment(input: {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  bytes?: Uint8Array;
}): ValidatedInboxAttachment {
  if (!mimeTypes.has(input.mimeType as InboxAttachmentMimeType)) {
    throw new Error("送信できるのはJPG・PNG・PDFです。");
  }
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    throw new Error("空のファイルは送信できません。");
  }
  if (input.sizeBytes > INBOX_ATTACHMENT_REQUEST_MAX_BYTES) {
    throw new Error("ファイルは4MB以下にしてください。");
  }

  const mimeType = input.mimeType as InboxAttachmentMimeType;
  if (input.bytes) {
    const matches = mimeType === "image/jpeg"
      ? startsWith(input.bytes, [0xff, 0xd8, 0xff])
      : mimeType === "image/png"
        ? startsWith(input.bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        : startsWith(input.bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    if (!matches) throw new Error("ファイル形式と内容が一致しません。");
  }

  return {
    attachmentType: mimeType === "application/pdf" ? "pdf" : "image",
    fileName: normalizeAttachmentFileName(input.fileName),
    mimeType,
    sizeBytes: input.sizeBytes
  };
}

export function attachmentChecksum(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function createImagePreview(bytes: Uint8Array): Promise<Buffer> {
  const candidates = [
    { width: 1200, quality: 82 },
    { width: 1024, quality: 76 },
    { width: 900, quality: 70 },
    { width: 760, quality: 64 }
  ];

  for (const candidate of candidates) {
    const preview = await sharp(bytes)
      .rotate()
      .resize({ width: candidate.width, height: candidate.width, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: candidate.quality, mozjpeg: true })
      .toBuffer();
    if (preview.byteLength <= LINE_IMAGE_PREVIEW_MAX_BYTES) return preview;
  }
  throw new Error("画像のプレビューを作成できませんでした。別の画像をお試しください。");
}

export function signAttachmentAccess(attachmentId: string, secret: string): string {
  return createHmac("sha256", secret).update(`line-crm-attachment:${attachmentId}`).digest("base64url");
}

export function verifyAttachmentAccess(attachmentId: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = signAttachmentAccess(attachmentId, secret);
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function publicAttachmentUrl(input: { appUrl: string; attachmentId: string; secret: string; variant?: "original" | "preview" }): string {
  const url = new URL(`/api/public/attachments/${encodeURIComponent(input.attachmentId)}`, input.appUrl);
  url.searchParams.set("token", signAttachmentAccess(input.attachmentId, input.secret));
  if (input.variant === "preview") url.searchParams.set("variant", "preview");
  return url.toString();
}

function truncatedAltText(fileName: string): string {
  const value = `PDFをお送りします：${fileName}`;
  return value.length <= 400 ? value : `${value.slice(0, 397)}…`;
}

export function buildLineAttachmentMessage(input: {
  attachmentType: MessageAttachmentType;
  fileName: string;
  originalUrl: string;
  previewUrl?: string;
}): LinePushMessageObject {
  if (input.attachmentType === "image") {
    if (!input.previewUrl) throw new Error("画像プレビューURLがありません。");
    return { type: "image", originalContentUrl: input.originalUrl, previewImageUrl: input.previewUrl };
  }

  return {
    type: "flex",
    altText: truncatedAltText(input.fileName),
    contents: {
      type: "bubble",
      size: "kilo",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: "PDFファイル", weight: "bold", size: "lg", color: "#1F2937" },
          { type: "text", text: input.fileName, size: "sm", color: "#4B5563", wrap: true }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#10B981",
            action: { type: "uri", label: "PDFを開く", uri: input.originalUrl }
          }
        ]
      }
    }
  };
}
