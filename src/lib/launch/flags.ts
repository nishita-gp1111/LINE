import "server-only";

import { getServerEnv } from "@/lib/env/server";
import { configuredRecipientCount, evaluateRecipientPolicy } from "@/lib/launch/recipient-policy";

export const MINIMUM_PRODUCTION_APP_URL = "https://line-gp-1111.vercel.app";
export const MINIMUM_PRODUCTION_SUPABASE_URL = "https://pwlmvpqabndiaujcfrsp.supabase.co";

export type LaunchFlag =
  | "LINE_MANUAL_SEND_ENABLED"
  | "LINE_BULK_SEND_ENABLED"
  | "LINE_SCHEDULED_SEND_ENABLED"
  | "LINE_AUTOMATION_SEND_ENABLED"
  | "LINE_AUTO_REPLY_ENABLED"
  | "LINE_MEDIA_SEND_ENABLED"
  | "LINE_RICH_MENU_MUTATION_ENABLED"
  | "LINE_TRACKING_ENABLED";

export function isMockMode(): boolean {
  return getServerEnv().MOCK_LINE_API;
}

export function isLaunchFlagEnabled(flag: LaunchFlag): boolean {
  const env = getServerEnv();
  return Boolean(env[flag]);
}

export function assertLaunchAction(flag: LaunchFlag): void {
  if (isMockMode()) return;
  if (!isLaunchFlagEnabled(flag)) {
    throw new Error(`${flag} is disabled`);
  }
}

export function assertTestRecipient(lineUserId: string): void {
  const env = getServerEnv();
  const policy = evaluateRecipientPolicy({
    appEnvironment: env.APP_ENV,
    mockLineApi: env.MOCK_LINE_API,
    allowedLineUserIds: env.LINE_TEST_USER_IDS,
    allowedLineUserHashes: env.LINE_TEST_USER_HASHES,
    lineUserId
  });
  if (!policy.allowed) throw new Error(policy.reason || "送信先が許可されていません。");
}

export function launchFlagStatus(): Record<LaunchFlag, boolean> {
  return {
    LINE_MANUAL_SEND_ENABLED: isLaunchFlagEnabled("LINE_MANUAL_SEND_ENABLED"),
    LINE_BULK_SEND_ENABLED: isLaunchFlagEnabled("LINE_BULK_SEND_ENABLED"),
    LINE_SCHEDULED_SEND_ENABLED: isLaunchFlagEnabled("LINE_SCHEDULED_SEND_ENABLED"),
    LINE_AUTOMATION_SEND_ENABLED: isLaunchFlagEnabled("LINE_AUTOMATION_SEND_ENABLED"),
    LINE_AUTO_REPLY_ENABLED: isLaunchFlagEnabled("LINE_AUTO_REPLY_ENABLED"),
    LINE_MEDIA_SEND_ENABLED: isLaunchFlagEnabled("LINE_MEDIA_SEND_ENABLED"),
    LINE_RICH_MENU_MUTATION_ENABLED: isLaunchFlagEnabled("LINE_RICH_MENU_MUTATION_ENABLED"),
    LINE_TRACKING_ENABLED: isLaunchFlagEnabled("LINE_TRACKING_ENABLED")
  };
}

export function launchBlockers(): string[] {
  const env = getServerEnv();
  const blockers: string[] = [];
  if (!env.MOCK_LINE_API && !env.LINE_ORGANIZATION_ID) blockers.push("LINE_ORGANIZATION_IDが未設定です。");
  if (!env.MOCK_LINE_API && !env.LINE_CHANNEL_ID) blockers.push("LINE_CHANNEL_IDが未設定です。");
  if (!env.MOCK_LINE_API && !env.LINE_CHANNEL_SECRET) blockers.push("LINE_CHANNEL_SECRETが未設定です。");
  if (!env.MOCK_LINE_API && !env.LINE_CHANNEL_ACCESS_TOKEN) blockers.push("LINE_CHANNEL_ACCESS_TOKENが未設定です。");

  if (env.APP_ENV === "production") {
    if (env.MOCK_LINE_API) blockers.push("ProductionではMOCK_LINE_APIをfalseにしてください。");
    if (env.NEXT_PUBLIC_AUTH_MODE !== "auto") blockers.push("ProductionではNEXT_PUBLIC_AUTH_MODEをautoにしてください。");
    if (env.NEXT_PUBLIC_APP_URL !== MINIMUM_PRODUCTION_APP_URL) {
      blockers.push(`NEXT_PUBLIC_APP_URLを${MINIMUM_PRODUCTION_APP_URL}にしてください。`);
    }
    if (env.NEXT_PUBLIC_SUPABASE_URL !== MINIMUM_PRODUCTION_SUPABASE_URL) {
      blockers.push("NEXT_PUBLIC_SUPABASE_URLをProduction Supabaseへ設定してください。");
    }
    if (!env.NEXT_PUBLIC_SUPABASE_ANON_KEY) blockers.push("NEXT_PUBLIC_SUPABASE_ANON_KEYが未設定です。");
    if (!env.SUPABASE_SERVICE_ROLE_KEY) blockers.push("SUPABASE_SERVICE_ROLE_KEYが未設定です。");
    if (env.APP_TIMEZONE !== "Asia/Tokyo") blockers.push("APP_TIMEZONEをAsia/Tokyoにしてください。");
    if (env.ADMIN_EMAIL_ALLOWLIST.length === 0) blockers.push("ADMIN_EMAIL_ALLOWLISTが未設定です。");
    if (!env.LINE_EXPECTED_BASIC_ID) blockers.push("LINE_EXPECTED_BASIC_IDが未設定です。");
    if (!env.LINE_EXPECTED_DISPLAY_NAME) blockers.push("LINE_EXPECTED_DISPLAY_NAMEが未設定です。");
    if (!env.SURVEY_POSTBACK_TOKEN_SECRET || env.SURVEY_POSTBACK_TOKEN_SECRET.length < 32) {
      blockers.push("SURVEY_POSTBACK_TOKEN_SECRETを32文字以上で設定してください。");
    }
    if (configuredRecipientCount(env.LINE_TEST_USER_IDS, env.LINE_TEST_USER_HASHES) !== 1) {
      blockers.push("Production送信allowlistをSho本人1名だけに設定してください。");
    }
    if (!env.LINE_MANUAL_SEND_ENABLED) blockers.push("LINE_MANUAL_SEND_ENABLEDをtrueにしてください。");
    if (!env.LINE_AUTOMATION_SEND_ENABLED) blockers.push("LINE_AUTOMATION_SEND_ENABLEDをtrueにしてください。");
    if (!env.LINE_RICH_MENU_MUTATION_ENABLED) blockers.push("LINE_RICH_MENU_MUTATION_ENABLEDをtrueにしてください。");
    if (env.LINE_BULK_SEND_ENABLED) blockers.push("LINE_BULK_SEND_ENABLEDをfalseにしてください。");
    if (env.LINE_SCHEDULED_SEND_ENABLED) blockers.push("LINE_SCHEDULED_SEND_ENABLEDをfalseにしてください。");
    if (env.LINE_AUTO_REPLY_ENABLED) blockers.push("LINE_AUTO_REPLY_ENABLEDをfalseにしてください。");
    if (env.LINE_MEDIA_SEND_ENABLED) blockers.push("LINE_MEDIA_SEND_ENABLEDをfalseにしてください。");
  }
  return blockers;
}
