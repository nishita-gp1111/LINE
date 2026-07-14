import { describe, expect, it } from "vitest";
import { finishAcceptanceRun, safeTokenEqual, startAcceptanceRun } from "@/lib/launch/acceptance";

describe("launch acceptance safety gates", () => {
  it("compares tokens without exposing their values", () => {
    expect(safeTokenEqual("a-secure-token", "a-secure-token")).toBe(true);
    expect(safeTokenEqual("a-secure-token", "different-token")).toBe(false);
    expect(safeTokenEqual(null, "a-secure-token")).toBe(false);
  });

  it("prevents concurrent runs", () => {
    expect(startAcceptanceRun(100_000)).toBe("started");
    expect(startAcceptanceRun(100_001)).toBe("busy");
    finishAcceptanceRun();
    expect(startAcceptanceRun(100_001)).toBe("rate_limited");
    expect(startAcceptanceRun(111_000)).toBe("started");
    finishAcceptanceRun();
  });
});
