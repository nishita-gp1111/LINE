import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { chunk, classifyLineBatchResult, dedupeAndExclude, jobIdempotencyKey, quotaAllows } from "@/lib/milestone3/delivery";
import { mediaMessageFromAsset, outboundMessageListSchema, validateMediaUpload } from "@/lib/line/media";

describe("Milestone 3B delivery", () => {
  it("dedupes and excludes blocked/suppressed contacts", () => {
    const result = dedupeAndExclude([{ id: "a", friendStatus: "following" }, { id: "a", friendStatus: "following" }, { id: "b", friendStatus: "blocked" }, { id: "c", friendStatus: "following", marketingStatus: "suppressed" }], 50);
    expect(result.recipients.map((item) => item.id)).toEqual(["a"]);
    expect(result.excluded).toBe(3);
  });
  it("creates LINE multicast-sized batches and respects quota reserve", () => {
    expect(chunk(Array.from({ length: 1001 }, (_, index) => index), 500)).toHaveLength(3);
    expect(chunk(Array.from({ length: 50000 }, (_, index) => index), 500)).toHaveLength(100);
    expect(quotaAllows({ quotaTotal: 1000, quotaUsed: 900, recipientCount: 70, reservePercent: 3 })).toBe(true);
    expect(quotaAllows({ quotaTotal: 1000, quotaUsed: 900, recipientCount: 100, reservePercent: 3 })).toBe(false);
  });
  it("classifies Retry Key outcomes", () => {
    expect(classifyLineBatchResult(409)).toBe("accepted");
    expect(classifyLineBatchResult(429)).toBe("quota_pause");
    expect(classifyLineBatchResult(500)).toBe("retryable");
    expect(jobIdempotencyKey("campaign_batch", "b")).toBe("campaign_batch:b:run");
  });
  it("validates media and caps message objects", () => {
    expect(() => validateMediaUpload({ type: "video", mimeType: "video/mp4", sizeBytes: 1, hasPreview: false }, { image: 10, video: 10, audio: 10 })).toThrow();
    const asset = { id: "00000000-0000-4000-8000-000000000001", assetType: "audio" as const, publicUrl: "https://cdn.example.test/a.mp3", mimeType: "audio/mpeg", sizeBytes: 10, durationMs: 1000 };
    expect(mediaMessageFromAsset(asset).type).toBe("audio");
    expect(() => outboundMessageListSchema.parse(Array.from({ length: 6 }, () => ({ type: "text", text: "x" })))).toThrow();
  });
  it("backfills accepted campaigns into 1:1 inbox history without resending", () => {
    const migration = readFileSync(new URL("../supabase/migrations/20260722010000_campaign_inbox_history.sql", import.meta.url), "utf8");
    expect(migration).toContain("record_campaign_outbound_batch_history");
    expect(migration).toContain("format('campaign:%s:%s'");
    expect(migration).toContain("on conflict (organization_id, client_request_id)");
    expect(migration).toContain("where cb.status = 'accepted'");
    expect(migration).toContain("last_outbound_at");
    expect(migration).not.toContain("api.line.me");
  });
});
