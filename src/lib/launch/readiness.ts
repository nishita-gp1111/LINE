import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getServerEnv } from "@/lib/env/server";
import { launchBlockers, launchFlagStatus } from "@/lib/launch/flags";
import { getEffectiveControlledRecipientHashes } from "@/lib/launch/controlled-recipient";
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
    flags.LINE_BULK_SEND_ENABLED &&
    !flags.LINE_SCHEDULED_SEND_ENABLED &&
    !flags.LINE_AUTO_REPLY_ENABLED &&
    !flags.LINE_MEDIA_SEND_ENABLED
  );
  checks.push({
    key: "flags",
    label: "Minimum Production feature flags",
    ok: minimumFlagsOk,
    note: env.MOCK_LINE_API ? "Mock mode" : minimumFlagsOk ? "個別送信・タグ配信・automation・ユーザー別rich menuを有効化" : "必須flagまたは禁止flagを確認してください"
  });

  let allowedRecipientCount = configuredRecipientCount(env.LINE_TEST_USER_IDS, env.LINE_TEST_USER_HASHES);
  let allowlistDatabaseOk = env.MOCK_LINE_API;

  let migrationOk = env.MOCK_LINE_API;
  let migrationNote = env.MOCK_LINE_API ? "Mock store" : "Supabase接続またはmigration未確認";
  let organizationOk = env.MOCK_LINE_API;
  let organizationNote = env.MOCK_LINE_API ? "Mock organization" : "organization未確認";
  if (admin && !env.MOCK_LINE_API) {
    const organization = await admin.from("organizations").select("id").eq("id", env.LINE_ORGANIZATION_ID || "").maybeSingle();
    organizationOk = !organization.error && Boolean(organization.data);
    organizationNote = organizationOk ? "LINE_ORGANIZATION_IDに一致" : "対象organizationが存在しません";

    try {
      allowedRecipientCount = (await getEffectiveControlledRecipientHashes(admin, env.LINE_ORGANIZATION_ID || "")).length;
      allowlistDatabaseOk = true;
    } catch {
      allowlistDatabaseOk = false;
    }

    const requiredTables = ["controlled_launch_recipients", "tags", "contact_tag_assignments", "surveys", "survey_responses", "automation_scenarios", "rich_menus", "rich_menu_rules", "rich_menu_assignments"];
    const probes = await Promise.all(requiredTables.map((table) => admin.from(table).select("*", { count: "exact", head: true }).limit(1)));
    const failedTables = requiredTables.filter((_, index) => Boolean(probes[index]?.error));
    migrationOk = failedTables.length === 0;
    migrationNote = migrationOk ? "Minimum Launch tables query OK" : `未確認: ${failedTables.join("、")}`;
  }
  checks.push({ key: "organization", label: "Production organization", ok: organizationOk, note: organizationNote });
  checks.push({ key: "migration", label: "Minimum Launch migrations", ok: migrationOk, note: migrationNote });

  const allowlistOk = env.MOCK_LINE_API || env.LINE_RECIPIENT_MODE === "all_followers" || (allowlistDatabaseOk && allowedRecipientCount === 1);
  checks.push({
    key: "allowlist",
    label: "LINE recipient allowlist",
    ok: allowlistOk,
    note: env.MOCK_LINE_API
      ? "Mock mode"
      : env.LINE_RECIPIENT_MODE === "all_followers"
        ? "Productionのフォロワーへ個別送信を許可"
      : allowlistOk
        ? `${allowedRecipientCount}名だけにサーバー側で制限`
        : allowlistDatabaseOk
          ? "Sho本人の署名済みWebhook登録を待っています"
          : "allowlist migrationまたはDB接続を確認してください"
  });

  const blockers = [...launchBlockers({ allowedRecipientCount }), ...checks.filter((check) => !check.ok).map((check) => `${check.label}: ${check.note}`)];
  const state: ReadinessState = env.MOCK_LINE_API ? "INTERNAL TEST ONLY" : blockers.length ? "BLOCKED" : env.LINE_RECIPIENT_MODE === "all_followers" ? "LIVE" : "READY FOR CONTROLLED LAUNCH";
  return { state, checks, blockers: [...new Set(blockers)] };
}
