import { describe, expect, it } from "vitest";
import { configuredRecipientCount, evaluateRecipientPolicy, hashLineUserId } from "@/lib/launch/recipient-policy";

describe("live recipient policy", () => {
  it("allows mock traffic without an allowlist", () => {
    expect(evaluateRecipientPolicy({
      appEnvironment: "test",
      mockLineApi: true,
      allowedLineUserIds: [],
      allowedLineUserHashes: [],
      lineUserId: "Uany"
    }).allowed).toBe(true);
  });

  it("fails closed when the live allowlist is empty", () => {
    expect(evaluateRecipientPolicy({
      appEnvironment: "production",
      mockLineApi: false,
      allowedLineUserIds: [],
      allowedLineUserHashes: [],
      lineUserId: "Usho"
    }).allowed).toBe(false);
  });

  it("allows only the single configured Production recipient", () => {
    expect(evaluateRecipientPolicy({
      appEnvironment: "production",
      mockLineApi: false,
      allowedLineUserIds: ["Usho"],
      allowedLineUserHashes: [],
      lineUserId: "Usho"
    }).allowed).toBe(true);
    expect(evaluateRecipientPolicy({
      appEnvironment: "production",
      mockLineApi: false,
      allowedLineUserIds: ["Usho"],
      allowedLineUserHashes: [],
      lineUserId: "Uother"
    }).allowed).toBe(false);
  });

  it("rejects multiple Production recipients even when one matches", () => {
    expect(evaluateRecipientPolicy({
      appEnvironment: "production",
      mockLineApi: false,
      allowedLineUserIds: ["Usho", "Uother"],
      allowedLineUserHashes: [],
      lineUserId: "Usho"
    }).allowed).toBe(false);
  });

  it("accepts a SHA-256 allowlist entry without storing the raw LINE user ID", async () => {
    expect(evaluateRecipientPolicy({
      appEnvironment: "production",
      mockLineApi: false,
      allowedLineUserIds: [],
      allowedLineUserHashes: [hashLineUserId("Usho")],
      lineUserId: "Usho"
    }).allowed).toBe(true);
  });

  it("counts duplicate raw and hashed entries as one recipient", () => {
    expect(configuredRecipientCount(["Usho"], [hashLineUserId("Usho")])).toBe(1);
  });

  it("rejects multiple recipients in Preview live mode too", () => {
    expect(evaluateRecipientPolicy({
      appEnvironment: "development",
      mockLineApi: false,
      allowedLineUserIds: ["Usho", "Uother"],
      allowedLineUserHashes: [],
      lineUserId: "Usho"
    }).allowed).toBe(false);
  });
});
