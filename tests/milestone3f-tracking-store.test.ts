import { beforeEach, describe, expect, it } from "vitest";

beforeEach(() => {
  process.env.MOCK_LINE_API = "true";
  process.env.APP_ENV = "test";
});

describe("persistent tracking adapter", () => {
  it("resolves a mock link and deduplicates a short burst", async () => {
    const { getMockClickCount, recordTrackedClick, resolveTrackedLink } = await import("@/lib/milestone3/tracking-store");
    const link = await resolveTrackedLink("mock-demo");
    expect(link?.destinationUrl).toBe("https://example.com/");
    if (!link) throw new Error("mock link missing");
    await recordTrackedClick({ link, now: "2026-07-13T00:00:00.000Z" });
    await recordTrackedClick({ link, now: "2026-07-13T00:00:05.000Z" });
    expect(getMockClickCount()).toBe(1);
  });
});
