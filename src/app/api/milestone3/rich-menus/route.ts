import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth/server";
import { canAdminister, getInboxAuthContext } from "@/lib/inbox/auth";
import { getServerEnv } from "@/lib/env/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createLiveRichMenu, repairLiveRichMenuDisplay } from "@/lib/minimum-launch/live";
import { getRichMenuLayout, type RichMenuActionInput } from "@/lib/minimum-launch/rich-menu-layouts";

export const runtime = "nodejs";

function reply(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}

function parseActions(form: FormData): RichMenuActionInput[] {
  const serialized = form.get("actions");
  if (typeof serialized === "string" && serialized.trim()) {
    let parsed: unknown;
    try { parsed = JSON.parse(serialized); } catch { throw new Error("ボタンの動作設定を読み取れませんでした。"); }
    if (!Array.isArray(parsed)) throw new Error("ボタンの動作設定を確認してください。");
    return parsed.map((value) => {
      if (!value || typeof value !== "object") throw new Error("ボタンの動作設定を確認してください。");
      const action = value as { type?: unknown; value?: unknown };
      if (action.type !== "uri" && action.type !== "message" && action.type !== "openKeyboard") throw new Error("ボタンの動作を確認してください。");
      if (typeof action.value !== "string") throw new Error("ボタンの入力内容を確認してください。");
      return { type: action.type, value: action.value };
    });
  }

  const actionType = String(form.get("actionType") || "");
  if (actionType !== "uri" && actionType !== "message" && actionType !== "openKeyboard") throw new Error("リッチメニューのアクションを確認してください。");
  return [{ type: actionType, value: String(form.get("actionValue") || "") }];
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
    const layoutId = String(form.get("layoutId") || "single");
    const layout = getRichMenuLayout(layoutId);
    const actions = parseActions(form);
    if (!(image instanceof File)) return reply({ error: "リッチメニュー画像を選択してください。" }, 400);
    if (actions.length !== layout.areas.length) return reply({ error: "レイアウト内のすべてのボタンを設定してください。" }, 400);
    const menu = await createLiveRichMenu({
      client,
      organizationId: auth.organizationId,
      profileId: auth.profileId,
      name: String(form.get("name") || ""),
      tagId: String(form.get("tagId") || ""),
      chatBarText: String(form.get("chatBarText") || "メニュー"),
      layoutId,
      actions,
      imageBytes: new Uint8Array(await image.arrayBuffer()),
      imageContentType: image.type,
      applyExisting: String(form.get("applyExisting") || "true") !== "false"
    });
    return reply({ menu }, 201);
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : "rich_menu_create_failed" }, 400);
  }
}

export async function PATCH(request: Request) {
  if (!await getAuthenticatedUser()) return reply({ error: "unauthorized" }, 401);
  if (getServerEnv().MOCK_LINE_API) return reply({ error: "Live modeで利用してください。" }, 400);
  const auth = await getInboxAuthContext();
  const client = createSupabaseAdminClient();
  if (!auth || !client) return reply({ error: "database_not_configured" }, 503);
  if (!canAdminister(auth.role)) return reply({ error: "管理者権限が必要です。" }, 403);
  try {
    const body = await request.json() as { menuId?: unknown };
    if (typeof body.menuId !== "string" || !body.menuId) return reply({ error: "リッチメニューを選択してください。" }, 400);
    const repair = await repairLiveRichMenuDisplay({
      client,
      organizationId: auth.organizationId,
      richMenuId: body.menuId
    });
    return reply({ repair });
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : "rich_menu_repair_failed" }, 400);
  }
}
