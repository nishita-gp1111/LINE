import { NextResponse } from "next/server";
import { getInboxData } from "@/lib/inbox/queries";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET() {
  try {
    const data = await getInboxData();
    if (!data) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
    if (!data.store) throw new Error("not_configured");
    const revision = await data.store.getSyncRevision(data.auth.organizationId, data.auth.profileId);
    return NextResponse.json({ revision }, { headers });
  } catch {
    return NextResponse.json({ error: "同期情報を取得できませんでした。" }, { status: 503, headers });
  }
}
