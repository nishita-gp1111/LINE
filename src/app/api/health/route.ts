import { NextResponse } from "next/server";
import { getAuthMode } from "@/lib/auth/config";
import { getServerEnv } from "@/lib/env/server";
import { launchBlockers, launchFlagStatus, MINIMUM_PRODUCTION_APP_URL, MINIMUM_PRODUCTION_SUPABASE_URL } from "@/lib/launch/flags";
import { publicLaunchStatus } from "@/lib/launch/cron";
import { configuredRecipientCount } from "@/lib/launch/recipient-policy";

export function GET() {
  const env = getServerEnv();

  return NextResponse.json({
    ok: true,
    environment: env.APP_ENV,
    timezone: env.APP_TIMEZONE,
    authMode: getAuthMode(),
    mockLineApi: env.MOCK_LINE_API,
    configured: {
      appUrl: Boolean(env.NEXT_PUBLIC_APP_URL),
      productionAppUrl: env.NEXT_PUBLIC_APP_URL === MINIMUM_PRODUCTION_APP_URL,
      supabaseUrl: Boolean(env.NEXT_PUBLIC_SUPABASE_URL),
      productionSupabase: env.NEXT_PUBLIC_SUPABASE_URL === MINIMUM_PRODUCTION_SUPABASE_URL,
      supabaseAnonKey: Boolean(env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      supabaseServiceRoleKey: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
      adminEmailAllowlist: env.ADMIN_EMAIL_ALLOWLIST.length > 0,
      lineOrganizationId: Boolean(env.LINE_ORGANIZATION_ID),
      lineChannelId: Boolean(env.LINE_CHANNEL_ID),
      lineChannelSecret: Boolean(env.LINE_CHANNEL_SECRET),
      lineChannelAccessToken: Boolean(env.LINE_CHANNEL_ACCESS_TOKEN),
      expectedLineAccount: Boolean(env.LINE_EXPECTED_BASIC_ID && env.LINE_EXPECTED_DISPLAY_NAME),
      surveyPostbackSecret: Boolean(env.SURVEY_POSTBACK_TOKEN_SECRET && env.SURVEY_POSTBACK_TOKEN_SECRET.length >= 32)
    },
    launch: {
      flags: launchFlagStatus(),
      recipientPolicy: {
        failClosed: !env.MOCK_LINE_API,
        allowedRecipientCount: configuredRecipientCount(env.LINE_TEST_USER_IDS, env.LINE_TEST_USER_HASHES),
        productionRequiresSingleRecipient: true
      },
      defaultRichMenuMutationAllowed: false,
      scheduler: publicLaunchStatus(),
      blockers: launchBlockers()
    }
  });
}
