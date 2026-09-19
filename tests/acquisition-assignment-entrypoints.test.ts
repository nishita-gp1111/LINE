import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const assign = vi.hoisted(() => vi.fn());
vi.mock("@/lib/acquisition/assignment-store", () => ({ assignAcquisitionContact: assign }));
import { applyLiveAcquisitionRouteTag, applyLiveAcquisitionRouteTagBySlug } from "@/lib/minimum-launch/live";

beforeEach(() => { assign.mockReset(); assign.mockRejectedValue(new Error("stop-before-tag-or-LINE-mutation")); });
describe("LIFF and webhook acquisition assignment entrypoints", () => {
  const client = {} as SupabaseClient;
  const common = { client, organizationId: "test-org", contactId: "test-contact" };
  it("assigns on a verified LIFF meeting claim before performing tag side effects", async () => {
    await expect(applyLiveAcquisitionRouteTagBySlug({ ...common, slug: "meeting" })).rejects.toThrow("stop-before-tag");
    expect(assign).toHaveBeenCalledWith(client, "test-org", "test-contact", "meeting");
  });
  it("uses the same assignment path for the fallback registration message", async () => {
    await expect(applyLiveAcquisitionRouteTag({ ...common, text: "面談経由で友だち追加しました" })).rejects.toThrow("stop-before-tag");
    expect(assign).toHaveBeenCalledWith(client, "test-org", "test-contact", "meeting");
  });
  it("does not assign for ordinary chats or unknown routes", async () => {
    expect(await applyLiveAcquisitionRouteTag({ ...common, text: "こんにちは" })).toEqual({ matched: false });
    expect(await applyLiveAcquisitionRouteTagBySlug({ ...common, slug: "unknown" })).toEqual({ matched: false });
    expect(assign).not.toHaveBeenCalled();
  });
});
