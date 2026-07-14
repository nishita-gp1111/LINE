import { describe, expect, it } from "vitest";
import { attributionLabel, csvHeaderInjectionSafe, signRecipientToken, validateTrackingDestination, verifyRecipientToken } from "@/lib/milestone3/tracking";

describe("Milestone 3F tracking", () => {
  it("rejects open redirects and unsafe URL forms", () => {
    expect(validateTrackingDestination("https://example.com/path").hostname).toBe("example.com");
    expect(() => validateTrackingDestination("http://example.com")).toThrow();
    expect(() => validateTrackingDestination("https://user:pass@example.com")).toThrow();
  });
  it("signs expiring personalized tokens without LINE IDs in the public URL", () => {
    const token = signRecipientToken("contact_token", Date.now() + 60_000, "secret");
    expect(verifyRecipientToken(token, "secret")).toBe("contact_token");
    expect(verifyRecipientToken(token, "wrong")).toBeNull();
  });
  it("keeps attribution and CSV safety explicit", () => {
    expect(attributionLabel("estimated")).toBe("推定");
    expect(csvHeaderInjectionSafe("=SUM(A1)")).toBe("'=SUM(A1)");
  });
});
