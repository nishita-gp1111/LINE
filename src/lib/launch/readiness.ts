import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getServerEnv } from "@/lib/env/server";
import { launchBlockers, launchFlagStatus } from "@/lib/launch/flags";

export type ReadinessState = "BLOCKED" | "INTERNAL TEST ONLY" | "READY FOR CONTROLLED LAUNCH" | "LIVE";
export type ReadinessCheck = { key: string; label: string; ok: boolean; note: string };

export async function getLaunchReadiness(): Promise<{ state: ReadinessState; checks: ReadinessCheck[]; blockers: string[] }> {
  const env = getServerEnv();
  const admin = createSupabaseAdminClient();
  const checks: ReadinessCheck[] = [];
  const connectionOk = env.MOCK_LINE_API || Boolean(env.LINE_CHANNEL_SECRET && env.LINE_CHANNEL_ACCESS_TOKEN);
  checks.push({ key: "line", label: "LINE connection", ok: connectionOk, note: connectionOk ? "configured state only" : "Channel Secret / Access Token未設定" });
  checks.push({ key: "flags", label: "Live feature flags", ok: Object.values(launchFlagStatus()).every((value) => value === false || env.LINE_TRACKING_ENABLED), note: "送信・自動化・rich menu flagは初期OFF" });

  let storageOk = env.MOCK_LINE_API;
  let storageNote = env.MOCK_LINE_API ? "Mockでは未接続" : "未確認";
  let trackerOk = env.MOCK_LINE_API;
  let trackerNote = env.MOCK_LINE_API ? "Mock store" : "未確認";
  let schedulerOk = false;
  let schedulerNote = "heartbeat未確認";
  let migrationOk = false;
  let migrationNote = "migration適用状態未確認";
  let dispatcherOk = env.MOCK_LINE_API;
  let analyticsOk = env.MOCK_LINE_API;
  if (admin && !env.MOCK_LINE_API) {
    const buckets = await admin.storage.listBuckets();
    storageOk = !buckets.error && buckets.data.some((bucket) => bucket.id === env.LINE_MEDIA_BUCKET);
    storageNote = storageOk ? "private bucket configured" : "private bucket未設定";
    const tracker = await admin.from("tracked_links").select("id", { count: "exact", head: true }).eq("organization_id", env.LINE_ORGANIZATION_ID || "");
    trackerOk = !tracker.error;
    trackerNote = trackerOk ? "tracked_links query OK" : "tracked_links query failed";
    const heartbeat = await admin.from("scheduler_heartbeats").select("status,updated_at").eq("organization_id", env.LINE_ORGANIZATION_ID || "").eq("provider", env.SCHEDULER_PROVIDER).maybeSingle();
    schedulerOk = heartbeat.data?.status === "healthy" && Boolean(heartbeat.data.updated_at) && Date.now() - Date.parse(String(heartbeat.data.updated_at)) < env.SCHEDULER_STALE_AFTER_MINUTES * 60_000;
    schedulerNote = schedulerOk ? "healthy heartbeat" : "stale or missing heartbeat";
    const migrationProbe = await admin.from("scheduled_jobs").select("id", { head: true, count: "exact" }).limit(1);
    migrationOk = !migrationProbe.error;
    migrationNote = migrationOk ? "runtime tables query OK" : "runtime migration未適用または接続失敗";
    dispatcherOk = migrationOk;
    analyticsOk = !(await admin.from("behavior_events").select("id", { head: true, count: "exact" }).limit(1)).error;
  }
  checks.push({ key: "migration", label: "Milestone 3 migrations", ok: migrationOk, note: migrationNote });
  checks.push({ key: "storage", label: "Private Storage bucket / RLS", ok: storageOk, note: storageNote });
  checks.push({ key: "tracker", label: "Tracked link database", ok: trackerOk, note: trackerNote });
  checks.push({ key: "scheduler", label: "Scheduler heartbeat", ok: schedulerOk, note: schedulerNote });
  checks.push({ key: "dispatcher", label: "Dispatcher state transition", ok: dispatcherOk, note: dispatcherOk ? "runtime dispatcher available" : "dispatcher DB未確認" });
  checks.push({ key: "analytics", label: "Analytics database query", ok: analyticsOk, note: analyticsOk ? "analytics tables query available" : "analytics query未確認" });
  checks.push({ key: "allowlist", label: "LINE recipient allowlist", ok: true, note: env.MOCK_LINE_API ? "Mock mode" : env.LINE_TEST_USER_IDS.length ? `${env.LINE_TEST_USER_IDS.length}名に制限中` : "未設定（organization内の選択顧客を許可）" });
  checks.push({ key: "ci-e2e", label: "CI E2E result", ok: false, note: "GitHub Actionsの実行結果を人間が確認" });
  checks.push({ key: "backup", label: "Backup / rollback human confirmation", ok: false, note: "人間の記録が必要" });
  checks.push({ key: "e2e", label: "Critical E2E", ok: false, note: "未完了の場合はローンチ阻害" });

  const blockers = [...launchBlockers(), ...checks.filter((check) => !check.ok).map((check) => `${check.label}: ${check.note}`)];
  const state: ReadinessState = env.MOCK_LINE_API ? "INTERNAL TEST ONLY" : blockers.length ? "BLOCKED" : "READY FOR CONTROLLED LAUNCH";
  return { state, checks, blockers: [...new Set(blockers)] };
}
