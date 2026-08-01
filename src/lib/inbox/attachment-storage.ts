import "server-only";

import { randomUUID } from "node:crypto";
import { getServerEnv } from "@/lib/env/server";
import { attachmentChecksum, createImagePreview, INBOX_ATTACHMENT_REQUEST_MAX_BYTES, validateInboxAttachment } from "@/lib/inbox/attachment-file";
import type { MessageAttachmentRecord, OutboundAttachmentCreateInput } from "@/lib/inbox/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Row = Record<string, unknown>;

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function mapAttachment(row: Row): MessageAttachmentRecord {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    messageId: String(row.message_id),
    conversationId: String(row.conversation_id),
    contactId: String(row.contact_id),
    attachmentType: row.attachment_type as MessageAttachmentRecord["attachmentType"],
    fileName: String(row.file_name),
    mimeType: row.mime_type as MessageAttachmentRecord["mimeType"],
    sizeBytes: Number(row.size_bytes),
    storageBucket: String(row.storage_bucket),
    storagePath: String(row.storage_path),
    previewStoragePath: optionalString(row.preview_storage_path),
    checksumSha256: String(row.checksum_sha256),
    createdByProfileId: String(row.created_by_profile_id),
    createdAt: String(row.created_at),
    deletedAt: optionalString(row.deleted_at)
  };
}

function extension(mimeType: MessageAttachmentRecord["mimeType"]): string {
  return mimeType === "image/jpeg" ? "jpg" : mimeType === "image/png" ? "png" : "pdf";
}

export async function storeInboxAttachment(input: {
  organizationId: string;
  conversationId: string;
  contactId: string;
  createdByProfileId: string;
  file: File;
}): Promise<OutboundAttachmentCreateInput> {
  const client = createSupabaseAdminClient();
  if (!client) throw new Error("ファイル保存先が設定されていません。");
  const env = getServerEnv();
  const configuredLimit = input.file.type === "application/pdf" ? env.MEDIA_PDF_MAX_BYTES : env.MEDIA_IMAGE_MAX_BYTES;
  if (input.file.size > Math.min(configuredLimit, INBOX_ATTACHMENT_REQUEST_MAX_BYTES)) throw new Error("ファイルは4MB以下にしてください。");

  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const validated = validateInboxAttachment({
    fileName: input.file.name,
    mimeType: input.file.type,
    sizeBytes: input.file.size,
    bytes
  });
  const id = randomUUID();
  const bucket = env.LINE_MEDIA_BUCKET;
  const basePath = `${input.organizationId}/inbox/${id}`;
  const storagePath = `${basePath}/original.${extension(validated.mimeType)}`;
  const previewStoragePath = validated.attachmentType === "image" ? `${basePath}/preview.jpg` : null;
  const uploadedPaths: string[] = [];

  try {
    const originalUpload = await client.storage.from(bucket).upload(storagePath, bytes, {
      contentType: validated.mimeType,
      cacheControl: "3600",
      upsert: false
    });
    if (originalUpload.error) throw new Error("ファイルを保存できませんでした。");
    uploadedPaths.push(storagePath);

    if (previewStoragePath) {
      const preview = await createImagePreview(bytes);
      const previewUpload = await client.storage.from(bucket).upload(previewStoragePath, preview, {
        contentType: "image/jpeg",
        cacheControl: "3600",
        upsert: false
      });
      if (previewUpload.error) throw new Error("画像プレビューを保存できませんでした。");
      uploadedPaths.push(previewStoragePath);
    }

    return {
      id,
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      contactId: input.contactId,
      attachmentType: validated.attachmentType,
      fileName: validated.fileName,
      mimeType: validated.mimeType,
      sizeBytes: validated.sizeBytes,
      storageBucket: bucket,
      storagePath,
      previewStoragePath,
      checksumSha256: attachmentChecksum(bytes),
      createdByProfileId: input.createdByProfileId
    };
  } catch (error) {
    if (uploadedPaths.length) await client.storage.from(bucket).remove(uploadedPaths);
    throw error;
  }
}

export async function removeStoredInboxAttachment(attachment: Pick<MessageAttachmentRecord, "storageBucket" | "storagePath" | "previewStoragePath">): Promise<void> {
  const client = createSupabaseAdminClient();
  if (!client) return;
  const paths = [attachment.storagePath, attachment.previewStoragePath].filter((path): path is string => Boolean(path));
  if (paths.length) await client.storage.from(attachment.storageBucket).remove(paths);
}

export async function getInboxAttachmentById(attachmentId: string, organizationId?: string): Promise<MessageAttachmentRecord | null> {
  const client = createSupabaseAdminClient();
  if (!client) return null;
  let query = client.from("message_attachments").select("*").eq("id", attachmentId).is("deleted_at", null);
  if (organizationId) query = query.eq("organization_id", organizationId);
  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  return mapAttachment(data as Row);
}

export async function downloadInboxAttachment(
  attachment: MessageAttachmentRecord,
  variant: "original" | "preview" = "original"
): Promise<{ body: Blob; contentType: string } | null> {
  const path = variant === "preview" ? attachment.previewStoragePath : attachment.storagePath;
  if (!path) return null;
  const client = createSupabaseAdminClient();
  if (!client) return null;
  const { data, error } = await client.storage.from(attachment.storageBucket).download(path);
  if (error || !data) return null;
  return { body: data, contentType: variant === "preview" ? "image/jpeg" : attachment.mimeType };
}

export function inlineContentDisposition(fileName: string): string {
  return `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
