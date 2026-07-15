import { beforeAll, describe, expect, it } from "vitest";
import { deriveSupabaseCronSecret } from "@/lib/launch/cron";
import { dispatchMockJobs, enqueueMockDispatchJob } from "@/lib/launch/dispatcher";
import { parseEnv } from "@/lib/env/schema";

beforeAll(() => {
  process.env.MOCK_LINE_API = "true";
  process.env.APP_ENV = "test";
  process.env.LINE_CHANNEL_SECRET = "runtime-test-secret";
});

describe("Milestone 3 runtime", () => {
  it("leases due jobs and transitions them instead of no-op", async () => {
    enqueueMockDispatchJob({ type: "maintenance", runAt: Date.now() - 1, maxAttempts: 3 });
    const summary = await dispatchMockJobs();
    expect(summary.processed).toBeGreaterThanOrEqual(1);
    expect(summary.succeeded).toBeGreaterThanOrEqual(1);
  });
  it("keeps safety flags disabled by default", () => {
    const env = parseEnv({});
    expect(env.LINE_BULK_SEND_ENABLED).toBe(false);
    expect(env.LINE_RICH_MENU_MUTATION_ENABLED).toBe(false);
    expect(env.LINE_TEST_USER_IDS).toEqual([]);
    expect(env.LINE_TEST_USER_HASHES).toEqual([]);
  });
  it("derives a domain-separated Cron credential without exposing the service key", () => {
    const first = deriveSupabaseCronSecret("service-role-secret-a");
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toBe(deriveSupabaseCronSecret("service-role-secret-a"));
    expect(first).not.toBe(deriveSupabaseCronSecret("service-role-secret-b"));
    expect(first).not.toContain("service-role-secret-a");
  });
});
