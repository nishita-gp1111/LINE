import { NextResponse } from "next/server";
import { z } from "zod";
import { canAdminister, getInboxAuthContext, isTrustedOrigin } from "@/lib/inbox/auth";
import { getServerEnv } from "@/lib/env/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { checkMockTagDeletion } from "@/lib/tags/mock-deletion";
import type { TagDeletionCheck } from "@/lib/tags/deletion";

const idSchema = z.string().uuid();
const deleteSchema = z.object({ id: idSchema, name: z.string().min(1).max(100), confirmed: z.literal(true) });
function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}

async function handle(request: Request, remove: boolean) {
  try {
    const auth = await getInboxAuthContext();
    if (!auth) return json({ error: "ログインしてください。" }, 401);
    if (!canAdminister(auth.role) || (remove && !isTrustedOrigin(request))) return json({ error: "タグを削除できるのは管理者のみです。" }, 403);
    const input = remove ? deleteSchema.safeParse(await request.json().catch(() => null)) : z.object({ id: idSchema }).safeParse({ id: new URL(request.url).searchParams.get("id") });
    if (!input.success) return json({ error: "削除対象を確認してください。" }, 400);
    const name = "name" in input.data ? String(input.data.name) : undefined;
    let result: TagDeletionCheck;
    if (getServerEnv().MOCK_LINE_API) {
      result = checkMockTagDeletion(input.data.id, remove, name);
    } else {
      const client = createSupabaseAdminClient();
      if (!client) return json({ error: "データベースに接続できません。" }, 503);
      const { data, error } = await client.rpc("manage_crm_tag_deletion", {
        target_organization_id: auth.organizationId, target_actor_profile_id: auth.profileId,
        target_tag_id: input.data.id, perform_delete: remove, expected_name: name ?? null
      });
      if (error || !data) return json({ error: "タグを処理できませんでした。少し待ってから一覧を再読み込みしてください。" }, 503);
      result = data as TagDeletionCheck;
    }
    if (result.status === "not_found") return json({ error: "タグが見つかりません。一覧を再読み込みしてください。" }, 404);
    if (result.status === "forbidden") return json({ error: "権限がありません。" }, 403);
    if (result.status === "changed") return json({ error: "タグ名が変更されています。一覧を再読み込みしてください。" }, 409);
    return json(result, remove && result.status === "in_use" ? 409 : 200);
  } catch {
    return json({ error: "タグの処理に失敗しました。一覧を再読み込みしてください。" }, 503);
  }
}
export async function GET(request: Request) { return handle(request, false); }
export async function DELETE(request: Request) { return handle(request, true); }
