import "server-only";

import { getServerEnv } from "@/lib/env/server";

export type LaunchFlag =
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

export function launchFlagStatus(): Record<LaunchFlag, boolean> {
  return {
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
  if (env.APP_ENV === "production" && !env.HOSTING_COMMERCIAL_USE_CONFIRMED) {
    blockers.push("商用利用可能なホスティングプランの確認が未完了です。");
  }
  if (!env.MOCK_LINE_API && !env.LINE_CHANNEL_SECRET) blockers.push("LINE_CHANNEL_SECRETが未設定です。");
  if (!env.MOCK_LINE_API && !env.LINE_CHANNEL_ACCESS_TOKEN) blockers.push("LINE_CHANNEL_ACCESS_TOKENが未設定です。");
  if (!env.MOCK_LINE_API && !env.CRON_SECRET) blockers.push("CRON_SECRETが未設定です。");
  return blockers;
}
