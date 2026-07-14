import "server-only";

import { hashLineUserId } from "@/lib/launch/recipient-policy";

export type LineRecipientCandidate = {
  displayName: string;
  lineUserIdHash: string;
};

export type LineRecipientDiscovery = {
  candidates: LineRecipientCandidate[];
  truncated: boolean;
};

const REQUEST_TIMEOUT_MS = 5_000;
const MAX_CANDIDATES = 100;

async function lineGet(url: string, accessToken: string, fetchImpl: typeof fetch): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetchImpl(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      redirect: "error",
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function discoverLineRecipientCandidates(
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<LineRecipientDiscovery> {
  const followersResponse = await lineGet(
    `https://api.line.me/v2/bot/followers/ids?limit=${MAX_CANDIDATES}`,
    accessToken,
    fetchImpl
  );
  if (!followersResponse.ok) {
    throw new Error(`LINE follower lookup failed (${followersResponse.status})`);
  }
  const followersBody = await followersResponse.json() as Record<string, unknown>;
  const userIds = Array.isArray(followersBody.userIds)
    ? followersBody.userIds.filter((value): value is string => typeof value === "string").slice(0, MAX_CANDIDATES)
    : [];

  const candidates: LineRecipientCandidate[] = [];
  for (let index = 0; index < userIds.length; index += 5) {
    const batch = userIds.slice(index, index + 5);
    const profiles = await Promise.all(batch.map(async (lineUserId) => {
      const response = await lineGet(
        `https://api.line.me/v2/bot/profile/${encodeURIComponent(lineUserId)}`,
        accessToken,
        fetchImpl
      );
      if (!response.ok) return null;
      const body = await response.json() as Record<string, unknown>;
      if (typeof body.displayName !== "string") return null;
      return { displayName: body.displayName, lineUserIdHash: hashLineUserId(lineUserId) };
    }));
    candidates.push(...profiles.filter((value): value is LineRecipientCandidate => value !== null));
  }

  return {
    candidates: candidates.sort((left, right) => left.displayName.localeCompare(right.displayName, "ja")),
    truncated: typeof followersBody.next === "string" && followersBody.next.length > 0
  };
}
