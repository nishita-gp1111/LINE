import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth/server";
import { runLineConnectionTest } from "@/lib/line/connection-test";
import { getServerEnv } from "@/lib/env/server";

export const runtime = "nodejs";

export async function POST() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ ok: false, error: "認証が必要です。" }, { status: 401 });

  try {
    const env = getServerEnv();
    const result = await runLineConnectionTest({
      environment: env.APP_ENV,
      mode: env.MOCK_LINE_API ? "mock" : "live",
      appUrl: env.NEXT_PUBLIC_APP_URL,
      organizationId: env.LINE_ORGANIZATION_ID,
      channelId: env.LINE_CHANNEL_ID,
      channelSecret: env.LINE_CHANNEL_SECRET,
      channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN,
      expectedBasicId: env.LINE_EXPECTED_BASIC_ID,
      expectedDisplayName: env.LINE_EXPECTED_DISPLAY_NAME
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { ok: false, error: "接続確認を実行できませんでした。設定とサーバー状態を確認してください。" },
      { status: 500 }
    );
  }
}
