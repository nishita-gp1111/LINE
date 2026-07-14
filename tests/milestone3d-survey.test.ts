import { describe, expect, it } from "vitest";
import { answerIsEligible, createOpaquePostbackToken, selectMultiple, surveyInputPriority, verifyOpaquePostbackToken } from "@/lib/milestone3/survey";

describe("Milestone 3D surveys", () => {
  it("uses an expiring opaque signed postback token", () => {
    const token = createOpaquePostbackToken("test-secret", Date.now() + 60_000);
    expect(verifyOpaquePostbackToken(token, "test-secret")).toBe(true);
    expect(verifyOpaquePostbackToken(token, "wrong-secret")).toBe(false);
    expect(token).not.toContain("contact");
  });
  it("supports bounded multiple selection and free text priority", () => {
    expect(selectMultiple(["a"], "b", 2)).toEqual(["a", "b"]);
    expect(selectMultiple(["a", "b"], "a", 2)).toEqual(["b"]);
    expect(() => selectMultiple(["a", "b"], "c", 2)).toThrow();
    expect(surveyInputPriority(true, true)).toBe("free_text");
  });
  it("rejects expired or duplicate one-shot answers", () => {
    expect(answerIsEligible({ status: "active", expiresAt: new Date(Date.now() + 1000).toISOString(), allowMultipleResponses: false, hasPreviousResponse: true })).toBe(false);
  });
});
