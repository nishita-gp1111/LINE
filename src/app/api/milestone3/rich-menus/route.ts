import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth/server";
import { canAdminister, getInboxAuthContext } from "@/lib/inbox/auth";
import { getServerEnv } from "@/lib/env/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createLiveRichMenu } from "@/lib/minimum-launch/live";

export const runtime = "nodejs";

function reply(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  if (!await getAuthenticatedUser()) return reply({ error: "unauthorized" }, 401);
  if (getServerEnv().MOCK_LINE_API) return reply({ error: "Live modeで利用してください。" }, 400);
  const auth = await getInboxAuthContext();
  const client = createSupabaseAdminClient();
  if (!auth || !client) return reply({ error: "database_not_configured" }, 503);
  if (!canAdminister(auth.role)) return reply({ error: "管理者権限が必要です。" }, 403);
  try {
    const form = await request.formData();
    const image = form.get("image");
    const actionType = String(form.get("actionType") || "");
    if (!(image instanceof File)) return reply({ error: "リッチメニュー画像を選択してください。" }, 400);
    if (actionType !== "uri" && actionType !== "message") return reply({ error: "リッチメニューのアクションを確認してください。" }, 400);
    const menu = await createLiveRichMenu({
      client,
      organizationId: auth.organizationId,
      profileId: auth.profileId,
      name: String(form.get("name") || ""),
      tagId: String(form.get("tagId") || ""),
      chatBarText: String(form.get("chatBarText") || "メニュー"),
      action: { type: actionType, value: String(form.get("actionValue") || "") },
      imageBytes: new Uint8Array(await image.arrayBuffer()),
      imageContentType: image.type,
      applyExisting: String(form.get("applyExisting") || "true") !== "false"
    });
    return reply({ menu }, 201);
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : "rich_menu_create_failed" }, 400);
  }
}
