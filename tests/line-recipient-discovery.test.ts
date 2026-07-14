import { describe, expect, it } from "vitest";
import { hashLineUserId } from "@/lib/launch/recipient-policy";
import { discoverLineRecipientCandidates } from "@/lib/line/recipient-discovery";

describe("LINE recipient discovery", () => {
  it("returns only display names and SHA-256 hashes", async () => {
    const result = await discoverLineRecipientCandidates("token", async (url) => {
      const requestUrl = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (requestUrl.includes("followers/ids")) {
        return Response.json({ userIds: ["Usho-secret", "Uother-secret"] });
      }
      if (requestUrl.endsWith("Usho-secret")) return Response.json({ displayName: "Sho", userId: "Usho-secret" });
      return Response.json({ displayName: "Other", userId: "Uother-secret" });
    });

    expect(result).toEqual({
      candidates: [
        { displayName: "Other", lineUserIdHash: hashLineUserId("Uother-secret") },
        { displayName: "Sho", lineUserIdHash: hashLineUserId("Usho-secret") }
      ],
      truncated: false
    });
    expect(JSON.stringify(result)).not.toContain("Usho-secret");
    expect(JSON.stringify(result)).not.toContain("Uother-secret");
    expect(JSON.stringify(result)).not.toContain("token");
  });
});
