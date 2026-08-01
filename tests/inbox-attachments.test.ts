import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  buildLineAttachmentMessage,
  createImagePreview,
  publicAttachmentUrl,
  signAttachmentAccess,
  validateInboxAttachment,
  verifyAttachmentAccess
} from "@/lib/inbox/attachment-file";
import { MockLinePushClient } from "@/lib/line/send";

describe("inbox attachments", () => {
  it("accepts real JPG, PNG and PDF signatures and rejects spoofed files", () => {
    expect(validateInboxAttachment({ fileName: "photo.jpg", mimeType: "image/jpeg", sizeBytes: 4, bytes: new Uint8Array([0xff, 0xd8, 0xff, 0x00]) }).attachmentType).toBe("image");
    expect(validateInboxAttachment({ fileName: "form.pdf", mimeType: "application/pdf", sizeBytes: 5, bytes: new TextEncoder().encode("%PDF-") }).attachmentType).toBe("pdf");
    expect(() => validateInboxAttachment({ fileName: "fake.pdf", mimeType: "application/pdf", sizeBytes: 5, bytes: new TextEncoder().encode("hello") })).toThrow("一致しません");
    expect(() => validateInboxAttachment({ fileName: "large.pdf", mimeType: "application/pdf", sizeBytes: 4_000_001 })).toThrow("4MB以下");
  });

  it("creates a LINE-compatible preview smaller than 1MB", async () => {
    const source = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: "#10b981" } }).png().toBuffer();
    const preview = await createImagePreview(source);
    const metadata = await sharp(preview).metadata();
    expect(metadata.format).toBe("jpeg");
    expect(preview.byteLength).toBeLessThanOrEqual(1_000_000);
  });

  it("signs stable opaque attachment URLs", () => {
    const id = "9bb52420-17ef-4e53-b2ef-b49e34e89a14";
    const secret = "a".repeat(32);
    const signature = signAttachmentAccess(id, secret);
    expect(verifyAttachmentAccess(id, signature, secret)).toBe(true);
    expect(verifyAttachmentAccess(id, `${signature}x`, secret)).toBe(false);
    const url = publicAttachmentUrl({ appUrl: "https://line.example.com", attachmentId: id, secret, variant: "preview" });
    expect(url).toContain(`/api/public/attachments/${id}`);
    expect(url).toContain("variant=preview");
    expect(url).not.toContain(secret);
  });

  it("builds inline image and PDF-button LINE messages", async () => {
    const image = buildLineAttachmentMessage({ attachmentType: "image", fileName: "photo.png", originalUrl: "https://example.com/original", previewUrl: "https://example.com/preview" });
    expect(image).toEqual({ type: "image", originalContentUrl: "https://example.com/original", previewImageUrl: "https://example.com/preview" });

    const pdf = buildLineAttachmentMessage({ attachmentType: "pdf", fileName: "guide.pdf", originalUrl: "https://example.com/guide" });
    expect(pdf.type).toBe("flex");
    const accepted = await new MockLinePushClient("success").pushMessage({ lineUserId: "U1", message: pdf, retryKey: crypto.randomUUID() });
    expect(accepted.accepted).toBe(true);
  });
});
