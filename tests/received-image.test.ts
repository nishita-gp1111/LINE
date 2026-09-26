import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { fetchReceivedImage } from "@/lib/line/received-image";

describe("received LINE image download", () => {
  it("uses only LINE's fixed content API with a server token and strips metadata", async () => {
    const png = await sharp({ create: { width: 30, height: 20, channels: 3, background: "#10b981" } }).png().toBuffer();
    const fetcher = vi.fn().mockResolvedValue(new Response(new Uint8Array(png), { headers: { "content-type": "image/png" } }));
    const output = await fetchReceivedImage("image/123", "test-token-not-real", fetcher);
    expect(fetcher).toHaveBeenCalledWith("https://api-data.line.me/v2/bot/message/image%2F123/content", expect.objectContaining({ headers: { Authorization: "Bearer test-token-not-real" }, redirect: "error", cache: "no-store" }));
    const info = await sharp(output).metadata();
    expect(info.format).toBe("jpeg"); expect(info.width).toBe(30); expect(info.exif).toBeUndefined();
  });
  it.each([404, 410])("explains expired content for HTTP %s", async status => {
    await expect(fetchReceivedImage("123", "test", vi.fn().mockResolvedValue(new Response(null, { status })))).rejects.toMatchObject({ status: 410 });
  });
  it.each([401, 429, 500])("does not expose LINE errors or token for HTTP %s", async status => {
    await expect(fetchReceivedImage("123", "test-secret", vi.fn().mockResolvedValue(new Response("sensitive", { status })))).rejects.toMatchObject({ status: 502, message: expect.not.stringContaining("sensitive") });
  });
  it("rejects SVG/HTML rather than serving executable content", async () => {
    await expect(fetchReceivedImage("123", "test", vi.fn().mockResolvedValue(new Response("<svg />", { headers: { "content-type": "image/svg+xml" } })))).rejects.toMatchObject({ status: 415 });
  });
  it("bounds oversized downloads before reading them", async () => {
    await expect(fetchReceivedImage("123", "test", vi.fn().mockResolvedValue(new Response("", { headers: { "content-type": "image/jpeg", "content-length": "20000001" } })))).rejects.toMatchObject({ status: 413 });
  });
  it("requires configured credentials without making a request", async () => {
    const fetcher = vi.fn(); await expect(fetchReceivedImage("123", "", fetcher)).rejects.toMatchObject({ status: 503 }); expect(fetcher).not.toHaveBeenCalled();
  });
});
