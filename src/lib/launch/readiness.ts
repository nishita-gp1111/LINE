import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getServerEnv } from "@/lib/env/server";
import { launchBlockers, launchFlagStatus } from "@/lib/launch/flags";
import { configuredRecipientCount } from "@/lib/launch/recipient-policy";

export type ReadinessState = "BLOCKED" | "INTERNAL TEST ONLY" | "READY FOR CONTROLLED LAUNCH" | "LIVE";
export type ReadinessCheck = { key: string; label: string; ok: boolean; note: string };

export async function getLaunchReadiness(): Promise<{ state: ReadinessState; checks: ReadinessCheck[]; blockers: string[] }> {
  const env = getServerEnv();
  const admin = createSupabaseAdminClient();
  const checks: ReadinessCheck[] = [];
  const flags = launchFlagStatus();
  const connectionOk = env.MOCK_LINE_API || Boolean(
    env.LINE_ORGANIZATION_ID &&
    env.LINE_CHANNEL_ID &&
    env.LINE_CHANNEL_SECRET &&
    env.LINE_CHANNEL_ACCESS_TOKEN
  );
  checks.push({ key: "line", label: "LINE connection settings", ok: connectionOk, note: connectionOk ? "必要な設定は存在します（値は非表示）" : "LINE接続設定が不足しています" });

  const minimumFlagsOk = env.MOCK_LINE_API || (
    flags.LINE_MANUAL_SEND_ENABLED &&
    flags.LINE_AUTOMATION_SEND_ENABLED &&
    flags.LINE_RICH_MENU_MUTATION_ENABLED &&
    !flags.LINE_BULK_SEND_ENABLED &&
    !flags.LINE_SCHEDULED_SEND_ENABLED &&
    !flags.LINE_AUTO_REPLY_ENABLED &&
    !flags.LINE_MEDIA_SEND_ENABLED
  );
  checks.push({
    key: "flags",
    label: "Minimum Production feature flags",
    ok: minimumFlagsOk,
    note: env.MOCK_LINE_API ? "Mock mode" : minimumFlagsOk ? "個別送信・automation・ユーザー別rich menuだけ有効" : "必須flagまたは禁止flagを確認してください"
  });

  const allowedRecipientCount = configuredRecipientCount(env.LINE_TEST_USER_IDS, env.LINE_TEST_USER_HASHES);
  const allowlistOk = env.MOCK_LINE_API || (env.APP_ENV === "production" ? allowedRecipientCount === 1 : allowedRecipientCount > 0);
  checks.push({
    key: "allowlist",
    label: "LINE recipient allowlist",
    ok: allowlistOk,
    note: env.MOCK_LINE_API ? "Mock mode" : allowlistOk ? `${allowedRecipientCount}名だけにサーバー側で制限` : "実LINE送信はfail-closedです"
  });

  let migrationOk = env.MOCK_LINE_API;
  let migrationNote = env.MOCK_LINE_API ? "Mock store" : "Supabase接続またはmigration未確認";
  let organizationOk = env.MOCK_LINE_API;
  let organizationNote = env.MOCK_LINE_API ? "Mock organization" : "organization未確認";
  if (admin && !env.MOCK_LINE_API) {
    const organization = await admin.from("organizations").select("id").eq("id", env.LINE_ORGANIZATION_ID || "").maybeSingle();
    organizationOk = !organization.error && Boolean(organization.data);
    organizationNote = organizationOk ? "LINE_ORGANIZATION_IDに一致" : "対象organizationが存在しません";

    const requiredTables = ["tags", "contact_tag_assignments", "surveys", "survey_responses", "automation_scenarios", "rich_menus", "rich_menu_rules", "rich_menu_assignments"];
    const probes = await Promise.all(requiredTables.map((table) => admin.from(table).select("*", { count: "exact", head: true }).limit(1)));
    const failedTables = requiredTables.filter((_, index) => Boolean(probes[index]?.error));
    migrationOk = failedTables.length === 0;
    migrationNote = migrationOk ? "Minimum Launch tables query OK" : `未確認: ${failedTables.join("、")}`;
  }
  checks.push({ key: "organization", label: "Production organization", ok: organizationOk, note: organizationNote });
  checks.push({ key: "migration", label: "Minimum Launch migrations", ok: migrationOk, note: migrationNote });

  const blockers = [...launchBlockers(), ...checks.filter((check) => !check.ok).map((check) => `${check.label}: ${check.note}`)];
  const state: ReadinessState = env.MOCK_LINE_API ? "INTERNAL TEST ONLY" : blockers.length ? "BLOCKED" : "READY FOR CONTROLLED LAUNCH";
  return { state, checks, blockers: [...new Set(blockers)] };
}
