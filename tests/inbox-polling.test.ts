import { describe, expect, it } from "vitest";
import { INBOX_POLL_INTERVAL_MS, INBOX_RECONCILE_INTERVAL_MS, notificationPollInterval } from "@/lib/inbox/polling";

describe("inbox usage budget", () => {
  it("checks each feed at most once per minute while idle", () => {
    expect(INBOX_POLL_INTERVAL_MS).toBe(60_000);
    expect(notificationPollInterval(true)).toBe(60_000);
    expect(3_600_000 / INBOX_POLL_INTERVAL_MS + 3_600_000 / notificationPollInterval(true)).toBe(120);
  });
  it("reconciles at five minutes and slows hidden notifications", () => {
    expect(INBOX_RECONCILE_INTERVAL_MS).toBe(300_000);
    expect(notificationPollInterval(false)).toBe(300_000);
  });
});
