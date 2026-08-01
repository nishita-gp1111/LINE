import { NextResponse } from "next/server";
import { getInboxAuthContext } from "@/lib/inbox/auth";
import { downloadInboxAttachment, getInboxAttachmentById, inlineContentDisposition } from "@/lib/inbox/attachment-storage";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await getInboxAuthContext();
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const attachment = await getInboxAttachmentById(id, auth.organizationId);
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
      "X-Content-Type-Options": "nosniff"
    }
  });
}
