import { beforeAll, describe, expect, it } from "vitest";
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
});
