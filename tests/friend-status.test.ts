import { describe, expect, it } from "vitest";
import { friendStatusPresentation } from "@/lib/contacts/status";

describe("friend status presentation", () => {
  it("shows block only for a LINE unfollow-derived blocked state", () => {
    expect(friendStatusPresentation("blocked")).toEqual({
      label: "ブロック",
      detail: "LINEのブロックイベントを受信済み",
      isBlocked: true
    });
    expect(friendStatusPresentation("following").isBlocked).toBe(false);
    expect(friendStatusPresentation("unknown").isBlocked).toBe(false);
  });

  it("uses clear Japanese labels for every persisted LINE friend state", () => {
    expect(friendStatusPresentation("following").label).toBe("友だち");
    expect(friendStatusPresentation("blocked").label).toBe("ブロック");
    expect(friendStatusPresentation("unknown").label).toBe("未確認");
  });
});
