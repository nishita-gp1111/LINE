import { describe, expect, it } from "vitest";
import {
  liffAcquisitionClaimSchema,
  verifyLiffAcquisitionUser
} from "@/lib/acquisition/liff-verification";

const lineUserId = "U0123456789abcdef0123456789abcdef";
const loginChannelId = "2000000000";
const accessToken = "access-token-with-enough-characters";
const idToken = "id-token-with-enough-characters";
const messagingToken = "messaging-token-with-enough-characters";

function lineFetch(overrides: {
  accessClientId?: string;
  idAudience?: string;
  idSubject?: string;
  profileUserId?: string;
  friendFlag?: boolean;
  messagingUserId?: string;
  messagingStatus?: number;
} = {}) {
  const calls: Array<{ url: string; authorization: string | null; method: string }> = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers = new Headers(init?.headers);
    calls.push({ url, authorization: headers.get("authorization"), method: init?.method || "GET" });

    if (url.startsWith("https://api.line.me/oauth2/v2.1/verify?") && init?.method === "GET") {
      return Response.json({
        scope: "openid profile",
        client_id: overrides.accessClientId || loginChannelId,
        expires_in: 3600
      });
    }
    if (url === "https://api.line.me/oauth2/v2.1/verify" && init?.method === "POST") {
      return Response.json({
        iss: "https://access.line.me",
        sub: overrides.idSubject || lineUserId,
        aud: overrides.idAudience || loginChannelId,
        exp: 2_000_000_000,
        name: "LINE User"
      });
    }
    if (url === "https://api.line.me/v2/profile") {
      return Response.json({
        userId: overrides.profileUserId || lineUserId,
        displayName: "LINE User"
      });
    }
    if (url === "https://api.line.me/friendship/v1/status") {
      return Response.json({ friendFlag: overrides.friendFlag ?? true });
    }
    if (url.startsWith("https://api.line.me/v2/bot/profile/")) {
      return Response.json({
        userId: overrides.messagingUserId || lineUserId,
        displayName: "Messaging User",
        pictureUrl: "https://profile.line-scdn.net/example",
        language: "ja"
      }, { status: overrides.messagingStatus || 200 });
    }
    return Response.json({ message: "unexpected" }, { status: 404 });
  };
  return { fetchImpl, calls };
}

function verify(fetchImpl: typeof fetch) {
  return verifyLiffAcquisitionUser({
    idToken,
    accessToken,
    lineLoginChannelId: loginChannelId,
    lineChannelAccessToken: messagingToken,
    fetchImpl,
    now: new Date("2026-07-18T00:00:00.000Z")
  });
}

describe("LIFF acquisition verification", () => {
  it("accepts only the three public source slugs and rejects extra fields", () => {
    expect(liffAcquisitionClaimSchema.safeParse({ source: "meeting", idToken, accessToken }).success).toBe(true);
    expect(liffAcquisitionClaimSchema.safeParse({ source: "survey", idToken, accessToken }).success).toBe(true);
    expect(liffAcquisitionClaimSchema.safeParse({ source: "hp", idToken, accessToken }).success).toBe(true);
    expect(liffAcquisitionClaimSchema.safeParse({ source: "unknown", idToken, accessToken }).success).toBe(false);
    expect(liffAcquisitionClaimSchema.safeParse({ source: "survey", idToken, accessToken, lineUserId }).success).toBe(false);
  });

  it("verifies both LINE Login tokens, friendship, and the Messaging API identity", async () => {
    const { fetchImpl, calls } = lineFetch();
    await expect(verify(fetchImpl)).resolves.toEqual({
      lineUserId,
      displayName: "Messaging User",
      pictureUrl: "https://profile.line-scdn.net/example",
      language: "ja"
    });
    expect(calls).toHaveLength(5);
    expect(calls.find((call) => call.url.includes("/v2/bot/profile/"))?.authorization).toBe(`Bearer ${messagingToken}`);
    expect(calls.find((call) => call.url === "https://api.line.me/v2/profile")?.authorization).toBe(`Bearer ${accessToken}`);
  });

  it("rejects a token issued for another LINE Login channel", async () => {
    const { fetchImpl } = lineFetch({ accessClientId: "different-channel" });
    await expect(verify(fetchImpl)).rejects.toMatchObject({
      code: "invalid_line_credentials",
      status: 401
    });
  });

  it("requires friendship before calling the Messaging API profile endpoint", async () => {
    const { fetchImpl, calls } = lineFetch({ friendFlag: false });
    await expect(verify(fetchImpl)).rejects.toMatchObject({
      code: "friendship_required",
      status: 409
    });
    expect(calls.some((call) => call.url.includes("/v2/bot/profile/"))).toBe(false);
  });

  it("rejects LINE Login and Messaging API channels that do not resolve to the same user", async () => {
    const otherUserId = "Uffffffffffffffffffffffffffffffff";
    const { fetchImpl } = lineFetch({ messagingUserId: otherUserId });
    await expect(verify(fetchImpl)).rejects.toMatchObject({
      code: "channel_link_mismatch",
      status: 409
    });
  });

  it("does not include raw credentials in a safe verification error", async () => {
    const { fetchImpl } = lineFetch({ idAudience: "different-channel" });
    try {
      await verify(fetchImpl);
      throw new Error("expected verification to fail");
    } catch (error) {
      const serialized = JSON.stringify(error, Object.getOwnPropertyNames(error));
      expect(serialized).not.toContain(accessToken);
      expect(serialized).not.toContain(idToken);
      expect(serialized).not.toContain(messagingToken);
    }
  });
});
