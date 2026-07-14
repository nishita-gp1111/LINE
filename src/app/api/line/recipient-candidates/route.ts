import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth/server";
import { getServerEnv } from "@/lib/env/server";
import { discoverLineRecipientCandidates } from "@/lib/line/recipient-discovery";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ ok: false, error: "認証が必要です。" }, { status: 401 });

  const env = getServerEnv();
  const admin = createSupabaseAdminClient();
  if (!admin || !env.LINE_ORGANIZATION_ID) {
    return NextResponse.json({ ok: false, error: "Production organizationを確認できません。" }, { status: 503 });
  }
  const membership = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", env.LINE_ORGANIZATION_ID)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (membership.error || !membership.data || !["owner", "admin"].includes(String(membership.data.role))) {
    return NextResponse.json({ ok: false, error: "管理者権限が必要です。" }, { status: 403 });
  }
  if (env.MOCK_LINE_API || !env.LINE_CHANNEL_ACCESS_TOKEN) {
    return NextResponse.json({ ok: false, error: "Live LINE APIが設定されていません。" }, { status: 409 });
  }

  try {
    const result = await discoverLineRecipientCandidates(env.LINE_CHANNEL_ACCESS_TOKEN);
    return NextResponse.json({ ok: true, ...result });
  } catch {
    return NextResponse.json(
      { ok: false, error: "LINE follower ID APIを利用できません。アカウント権限を確認してください。" },
      { status: 424 }
    );
  }
}
