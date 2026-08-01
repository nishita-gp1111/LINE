import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env/server";
import { verifyAttachmentAccess } from "@/lib/inbox/attachment-file";
import { downloadInboxAttachment, getInboxAttachmentById, inlineContentDisposition } from "@/lib/inbox/attachment-storage";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return new NextResponse("Not found", { status: 404 });
  const env = getServerEnv();
  const token = new URL(request.url).searchParams.get("token") || "";
  if (!env.MEDIA_DOWNLOAD_SIGNING_SECRET || !verifyAttachmentAccess(id, token, env.MEDIA_DOWNLOAD_SIGNING_SECRET)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const attachment = await getInboxAttachmentById(id);
  if (!attachment) return new NextResponse("Not found", { status: 404 });
  const requestedVariant = new URL(request.url).searchParams.get("variant") === "preview" ? "preview" : "original";
  if (requestedVariant === "preview" && attachment.attachmentType !== "image") return new NextResponse("Not found", { status: 404 });
  const download = await downloadInboxAttachment(attachment, requestedVariant);
  if (!download) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(download.body, {
    status: 200,
    headers: {
      "Content-Type": download.contentType,
      "Content-Length": String(download.body.size),
      "Content-Disposition": inlineContentDisposition(attachment.fileName),
      "Cache-Control": "private, max-age=300, no-transform",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, noarchive"
    }
  });
}
