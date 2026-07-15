import "server-only";

import { randomUUID } from "node:crypto";
import { getServerEnv } from "@/lib/env/server";
import { assertTestRecipient, isMockMode } from "@/lib/launch/flags";
import { createLinePushClient } from "@/lib/line/send";
import { linkLiveRichMenu } from "@/lib/minimum-launch/live";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type DispatchJob = { id: string; type: "campaign_batch" | "automation_step" | "survey_rich_menu_fallback" | "maintenance" | "analytics_rollup"; runAt: number; attempts: number; maxAttempts: number; retryKey: string; lineUserId?: string; text?: string; status: "pending" | "leased" | "running" | "retry_wait" | "succeeded" | "failed" | "cancelled" };
export type DispatchSummary = { processed: number; succeeded: number; retryWait: number; failed: number; cancelled: number; reclaimed: number };

type ClaimedScheduledJob = {
  id: string;
  organization_id: string;
  job_type: string;
  contact_id: string | null;
  resource_id: string | null;
  payload_json: Record<string, unknown> | null;
  attempt_count: number;
  max_attempts: number;
};

const mockJobs = new Map<string, DispatchJob>();

export function enqueueMockDispatchJob(input: Omit<DispatchJob, "id" | "status" | "attempts" | "retryKey"> & { id?: string; retryKey?: string }): string {
  const id = input.id ?? `mock-job-${randomUUID()}`;
  mockJobs.set(id, { ...input, id, attempts: 0, retryKey: input.retryKey ?? randomUUID(), status: "pending" });
  return id;
}

function flagForJob(job: DispatchJob): "LINE_BULK_SEND_ENABLED" | "LINE_AUTOMATION_SEND_ENABLED" | "LINE_RICH_MENU_MUTATION_ENABLED" | null {
  if (job.type === "campaign_batch") return "LINE_BULK_SEND_ENABLED";
  if (job.type === "automation_step") return "LINE_AUTOMATION_SEND_ENABLED";
  if (job.type === "survey_rich_menu_fallback") return "LINE_RICH_MENU_MUTATION_ENABLED";
  return null;
}

async function runMockJob(job: DispatchJob): Promise<"succeeded" | "retry_wait" | "failed" | "cancelled"> {
  const flag = flagForJob(job);
  const env = getServerEnv();
  if (flag && !env.MOCK_LINE_API && !env[flag]) return "cancelled";
  if (!job.lineUserId || !job.text || job.type === "maintenance" || job.type === "analytics_rollup") return "succeeded";
  try { assertTestRecipient(job.lineUserId); } catch { return "cancelled"; }
  const result = await createLinePushClient().pushTextMessage({ lineUserId: job.lineUserId, text: job.text, retryKey: job.retryKey });
  if (result.accepted) return "succeeded";
  if (result.retryable && job.attempts + 1 < job.maxAttempts) return "retry_wait";
  return "failed";
}

export async function dispatchMockJobs(now = Date.now(), limit = 50): Promise<DispatchSummary> {
  const summary: DispatchSummary = { processed: 0, succeeded: 0, retryWait: 0, failed: 0, cancelled: 0, reclaimed: 0 };
  for (const job of [...mockJobs.values()].filter((item) => (item.status === "pending" || item.status === "retry_wait") && item.runAt <= now).slice(0, Math.min(limit, 50))) {
    job.status = "leased";
    job.attempts += 1;
    job.status = "running";
    summary.processed += 1;
    const result = await runMockJob(job);
    job.status = result;
    summary[result === "retry_wait" ? "retryWait" : result] += 1;
    if (result === "retry_wait") job.runAt = now + 1000 * Math.min(60, job.attempts * 10);
  }
  return summary;
}

export async function dispatchDueJobs(now = new Date(), limit = 50): Promise<DispatchSummary> {
  if (isMockMode()) return dispatchMockJobs(now.getTime(), limit);
  const client = createSupabaseAdminClient();
  if (!client) throw new Error("scheduler database is not configured");
  const leaseOwner = `dispatch-${randomUUID()}`;
  const { data, error } = await client.rpc("claim_due_scheduled_jobs", { target_limit: Math.min(limit, 50), target_lease_owner: leaseOwner, target_now: now.toISOString(), target_lease_seconds: getServerEnv().AUTOMATION_LEASE_SECONDS });
  if (error) throw new Error("scheduled jobs could not be leased");
  const summary: DispatchSummary = { processed: 0, succeeded: 0, retryWait: 0, failed: 0, cancelled: 0, reclaimed: 0 };
  for (const row of (data ?? []) as ClaimedScheduledJob[]) {
    summary.processed += 1;
    let result: "succeeded" | "retry_wait" | "failed" | "cancelled" = "succeeded";
    let errorSafe: string | null = null;
    const flag = row.job_type.includes("campaign") ? "LINE_BULK_SEND_ENABLED" : row.job_type.includes("automation") ? "LINE_AUTOMATION_SEND_ENABLED" : row.job_type === "survey_rich_menu_fallback" ? "LINE_RICH_MENU_MUTATION_ENABLED" : null;
    if (flag && !getServerEnv()[flag]) {
      result = "cancelled";
      errorSafe = `${flag} is disabled`;
    } else if (row.job_type === "survey_rich_menu_fallback") {
      const richMenuId = typeof row.payload_json?.richMenuId === "string" ? row.payload_json.richMenuId : null;
      if (!row.organization_id || !row.contact_id || !row.resource_id || !richMenuId) {
        result = "failed";
        errorSafe = "survey rich-menu job payload is invalid";
      } else {
        try {
          await linkLiveRichMenu({ client, organizationId: row.organization_id, contactId: row.contact_id, richMenuId, sourceType: "survey" });
        } catch (jobError) {
          result = row.attempt_count < row.max_attempts ? "retry_wait" : "failed";
          errorSafe = jobError instanceof Error ? jobError.message.slice(0, 500) : "survey rich-menu link failed";
        }
      }
    }
    await client.rpc("complete_scheduled_job", { target_job_id: row.id, target_lease_owner: leaseOwner, target_status: result, target_error_safe: errorSafe });
    summary[result === "retry_wait" ? "retryWait" : result] += 1;
  }
  if (getServerEnv().LINE_ORGANIZATION_ID) await client.rpc("record_scheduler_heartbeat", { target_organization_id: getServerEnv().LINE_ORGANIZATION_ID, target_provider: getServerEnv().SCHEDULER_PROVIDER, target_status: "healthy", target_error_safe: null });
  return summary;
}
