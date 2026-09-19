import { NextResponse } from "next/server";
import { canAdminister, getInboxAuthContext, isTrustedOrigin } from "@/lib/inbox/auth";
import { assignmentRuleSchema } from "@/lib/acquisition/assignment";
import { saveAssignmentRule } from "@/lib/acquisition/assignment-store";

export async function POST(request: Request) {
  const auth = await getInboxAuthContext();
  if (!auth) return NextResponse.json({ ok: false, error: "認証が必要です。" }, { status: 401 });
  if (!canAdminister(auth.role) || !isTrustedOrigin(request)) return NextResponse.json({ ok: false, error: "管理者のみ設定できます。" }, { status: 403 });
  const parsed = assignmentRuleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "担当者名は重複なしで1名40文字以内、最大20名まで指定してください。" }, { status: 400 });
  try {
    await saveAssignmentRule(auth.organizationId, auth.profileId, parsed.data);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "設定を保存できませんでした。DB設定と権限を確認してください。" }, { status: 503 });
  }
}
