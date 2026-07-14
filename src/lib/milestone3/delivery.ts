import { z } from "zod";

export const campaignStatusSchema = z.enum(["draft", "validating", "ready", "approved", "scheduled", "preparing", "sending", "completed", "partially_failed", "paused_quota", "paused_manual", "cancelled", "failed"]);
export const campaignModeSchema = z.enum(["multicast", "broadcast"]);
export const scheduledJobStatusSchema = z.enum(["pending", "leased", "running", "succeeded", "retry_wait", "failed", "cancelled"]);

export function chunk<T>(values: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1 || size > 500) throw new Error("batch sizeは1〜500です。");
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

export function dedupeAndExclude<T extends { id: string; friendStatus: string; marketingStatus?: string }>(contacts: readonly T[], maxRecipients: number): { recipients: T[]; excluded: number } {
  const seen = new Set<string>();
  const recipients: T[] = [];
  let excluded = 0;
  for (const contact of contacts) {
    if (seen.has(contact.id) || contact.friendStatus !== "following" || (contact.marketingStatus ?? "eligible") !== "eligible") { excluded += 1; continue; }
    seen.add(contact.id);
    if (recipients.length >= maxRecipients) throw new Error(`配信対象は${maxRecipients}件以内です。`);
    recipients.push(contact);
  }
  return { recipients, excluded };
}

export function quotaAllows(input: { quotaTotal: number; quotaUsed: number; recipientCount: number; reservePercent: number }): boolean {
  const available = Math.floor(input.quotaTotal * (1 - input.reservePercent / 100)) - input.quotaUsed;
  return input.recipientCount <= Math.max(0, available);
}

export function classifyLineBatchResult(status: number | "timeout"): "accepted" | "retryable" | "quota_pause" | "permanent_failure" {
  if (status === 200 || status === 409) return "accepted";
  if (status === 429) return "quota_pause";
  if (status === "timeout" || (typeof status === "number" && status >= 500)) return "retryable";
  return "permanent_failure";
}

export function jobIdempotencyKey(jobType: string, resourceId: string, suffix = "run"): string {
  return `${jobType}:${resourceId}:${suffix}`;
}
