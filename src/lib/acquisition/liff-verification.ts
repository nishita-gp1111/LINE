import "server-only";

import { z } from "zod";
import { ACQUISITION_ROUTE_SLUGS } from "@/lib/acquisition/routes";

const lineUserIdSchema = z.string().regex(/^U[0-9a-f]{32}$/);

const accessTokenVerificationSchema = z.object({
  scope: z.string(),
  client_id: z.string(),
  expires_in: z.number().int().positive()
});

const idTokenVerificationSchema = z.object({
  iss: z.string(),
  sub: lineUserIdSchema,
  aud: z.string(),
  exp: z.number().int().positive(),
  name: z.string().optional(),
  picture: z.string().url().optional()
});

const lineLoginProfileSchema = z.object({
  userId: lineUserIdSchema,
  displayName: z.string().min(1),
  pictureUrl: z.string().url().optional(),
  statusMessage: z.string().optional()
});

const friendshipSchema = z.object({ friendFlag: z.boolean() });

const messagingProfileSchema = z.object({
  userId: lineUserIdSchema,
  displayName: z.string().min(1),
  pictureUrl: z.string().url().optional(),
  statusMessage: z.string().optional(),
  language: z.string().optional()
});

export const liffAcquisitionClaimSchema = z.object({
  source: z.enum(ACQUISITION_ROUTE_SLUGS),
  idToken: z.string().min(20).max(8192),
  accessToken: z.string().min(20).max(8192)
}).strict();

export type LiffAcquisitionErrorCode =
  | "invalid_request"
  | "invalid_line_credentials"
  | "friendship_required"
  | "channel_link_mismatch"
  | "line_service_unavailable";

export class LiffAcquisitionError extends Error {
  constructor(
    public readonly code: LiffAcquisitionErrorCode,
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "LiffAcquisitionError";
  }
}

export type VerifiedLiffAcquisitionUser = {
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
  statusMessage?: string;
  language?: string;
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

async function fetchLineJson(
  input: string | URL,
  init: RequestInit,
  fetchImpl: FetchLike
): Promise<{ response: Response; body: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetchImpl(input, {
      ...init,
      cache: "no-store",
      redirect: "error",
      signal: controller.signal
    });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { response, body };
  } catch {
    throw new LiffAcquisitionError(
      "line_service_unavailable",
      502,
      "LINEとの確認に失敗しました。時間をおいて再度お試しください。"
    );
  } finally {
    clearTimeout(timeout);
  }
}

function assertLineResponse(response: Response, message: string): void {
  if (response.ok) return;
  if (response.status === 429 || response.status >= 500) {
    throw new LiffAcquisitionError(
      "line_service_unavailable",
      502,
      "LINEが一時的に混み合っています。時間をおいて再度お試しください。"
    );
  }
  throw new LiffAcquisitionError("invalid_line_credentials", 401, message);
}

function parseLineBody<T>(schema: z.ZodType<T>, body: unknown, message: string): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new LiffAcquisitionError("invalid_line_credentials", 401, message);
  }
  return parsed.data;
}

export async function verifyLiffAcquisitionUser(input: {
  idToken: string;
  accessToken: string;
  lineLoginChannelId: string;
  lineChannelAccessToken: string;
  fetchImpl?: FetchLike;
  now?: Date;
}): Promise<VerifiedLiffAcquisitionUser> {
  const fetchImpl = input.fetchImpl || fetch;
  const now = input.now || new Date();

  const accessTokenUrl = new URL("https://api.line.me/oauth2/v2.1/verify");
  accessTokenUrl.searchParams.set("access_token", input.accessToken);
  const idTokenBody = new URLSearchParams({
    id_token: input.idToken,
    client_id: input.lineLoginChannelId
  });
  const bearerHeaders = { Authorization: `Bearer ${input.accessToken}` };

  const [accessResult, idResult] = await Promise.all([
    fetchLineJson(accessTokenUrl, { method: "GET" }, fetchImpl),
    fetchLineJson("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: idTokenBody.toString()
    }, fetchImpl)
  ]);

  assertLineResponse(accessResult.response, "LINEログイン情報を確認できませんでした。");
  assertLineResponse(idResult.response, "LINEログイン情報を確認できませんでした。");
  const access = parseLineBody(accessTokenVerificationSchema, accessResult.body, "LINEログイン情報を確認できませんでした。");
  const idToken = parseLineBody(idTokenVerificationSchema, idResult.body, "LINEログイン情報を確認できませんでした。");
  const scopes = new Set(access.scope.split(/\s+/).filter(Boolean));

  if (
    access.client_id !== input.lineLoginChannelId ||
    idToken.aud !== input.lineLoginChannelId ||
    idToken.exp <= Math.floor(now.getTime() / 1000) ||
    !scopes.has("openid") ||
    !scopes.has("profile")
  ) {
    throw new LiffAcquisitionError("invalid_line_credentials", 401, "LINEログイン情報を確認できませんでした。");
  }

  const [profileResult, friendshipResult] = await Promise.all([
    fetchLineJson("https://api.line.me/v2/profile", {
      method: "GET",
      headers: bearerHeaders
    }, fetchImpl),
    fetchLineJson("https://api.line.me/friendship/v1/status", {
      method: "GET",
      headers: bearerHeaders
    }, fetchImpl)
  ]);

  assertLineResponse(profileResult.response, "LINEプロフィールを確認できませんでした。");
  assertLineResponse(friendshipResult.response, "友だち追加状態を確認できませんでした。");

  const profile = parseLineBody(lineLoginProfileSchema, profileResult.body, "LINEプロフィールを確認できませんでした。");
  const friendship = parseLineBody(friendshipSchema, friendshipResult.body, "友だち追加状態を確認できませんでした。");

  if (idToken.sub !== profile.userId) {
    throw new LiffAcquisitionError("invalid_line_credentials", 401, "LINEログイン情報を確認できませんでした。");
  }

  if (!friendship.friendFlag) {
    throw new LiffAcquisitionError(
      "friendship_required",
      409,
      "GP PRモニター窓口を友だち追加してから、もう一度お試しください。"
    );
  }

  const messagingResult = await fetchLineJson(
    `https://api.line.me/v2/bot/profile/${encodeURIComponent(idToken.sub)}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${input.lineChannelAccessToken}` }
    },
    fetchImpl
  );
  if (!messagingResult.response.ok) {
    if (messagingResult.response.status === 429 || messagingResult.response.status >= 500) {
      throw new LiffAcquisitionError(
        "line_service_unavailable",
        502,
        "LINEが一時的に混み合っています。時間をおいて再度お試しください。"
      );
    }
    throw new LiffAcquisitionError(
      "channel_link_mismatch",
      409,
      "LINE Loginと公式アカウントの連携を確認できませんでした。"
    );
  }
  const messagingProfile = parseLineBody(
    messagingProfileSchema,
    messagingResult.body,
    "LINE公式アカウント側のプロフィールを確認できませんでした。"
  );
  if (messagingProfile.userId !== idToken.sub) {
    throw new LiffAcquisitionError(
      "channel_link_mismatch",
      409,
      "LINE Loginと公式アカウントの利用者が一致しませんでした。"
    );
  }

  return {
    lineUserId: messagingProfile.userId,
    displayName: messagingProfile.displayName,
    pictureUrl: messagingProfile.pictureUrl,
    statusMessage: messagingProfile.statusMessage,
    language: messagingProfile.language
  };
}
