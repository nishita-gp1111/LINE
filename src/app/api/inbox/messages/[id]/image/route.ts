import { NextResponse } from "next/server";
import { getInboxAuthContext } from "@/lib/inbox/auth";
import { getReceivedImage } from "@/lib/inbox/received-image";
import { ReceivedImageError } from "@/lib/line/received-image";

export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await getInboxAuthContext();
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  if (!auth) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401, headers });
  const { id } = await context.params;
  if (!/^(?:mock-message-)?[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "写真が見つかりません。" }, { status: 404, headers });
  try {
    const image = await getReceivedImage(auth.organizationId, id);
    return new NextResponse(image, { headers: { ...headers, "Content-Type": "image/jpeg", "Content-Disposition": "inline; filename=received-photo.jpg" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof ReceivedImageError ? error.message : "写真を取得できませんでした。" }, { status: error instanceof ReceivedImageError ? error.status : 503, headers });
  }
}
