// Keep both inbox refresh and notification polling within the same usage budget.
// These are client timers, not a guarantee of delivery latency (sleep/network add delay).
export const INBOX_POLL_INTERVAL_MS = 60_000;
export const INBOX_RECONCILE_INTERVAL_MS = 5 * 60_000;
export const INBOX_SYNC_LABEL = "自動更新中（約1分ごと）";

export function notificationPollInterval(visible: boolean): number {
  return visible ? INBOX_POLL_INTERVAL_MS : 5 * 60_000;
}
