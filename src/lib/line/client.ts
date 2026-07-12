import { z } from "zod";
import { LineConfigurationError, LineTemporaryError } from "@/lib/line/errors";
import type { LineProfile, ProfileLookup } from "@/lib/line/types";

const profileResponseSchema = z.object({
  displayName: z.string().optional(),
  pictureUrl: z.string().url().optional(),
  statusMessage: z.string().optional(),
  language: z.string().optional()
});

type LineProfileConfig = {
  mode: "mock" | "live";
  channelAccessToken?: string;
};

const PROFILE_TIMEOUT_MS = 5_000;

export function mockProfile(userId: string): LineProfile {
  return {
    displayName: `Mock Contact ${userId.slice(-4)}`,
    pictureUrl: "https://example.invalid/mock-profile.png",
    statusMessage: "mock profile",
    language: "ja"
  };
}

export async function getLineProfile(
  userId: string,
  config: LineProfileConfig,
  fetchImpl: typeof fetch = fetch
): Promise<ProfileLookup> {
  if (config.mode === "mock") return { profile: mockProfile(userId) };
  if (!config.channelAccessToken) {
    return {
      error: { kind: "configuration", message: "LINE_CHANNEL_ACCESS_TOKENが設定されていません。" }
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROFILE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(
      `https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`,
      {
        headers: { Authorization: `Bearer ${config.channelAccessToken}` },
        signal: controller.signal
      }
    );

    if (response.status === 404) {
      return { error: { kind: "not_found", message: "LINEプロフィールが見つかりません。" } };
    }
    if (!response.ok) {
      return { error: { kind: "temporary", message: `LINEプロフィール取得に失敗しました (${response.status})。` } };
    }

    const parsed = profileResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      return { error: { kind: "invalid", message: "LINEプロフィールの形式が不正です。" } };
    }
    return { profile: parsed.data };
  } catch (error) {
    if (error instanceof LineConfigurationError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      return { error: { kind: "temporary", message: "LINEプロフィール取得がタイムアウトしました。" } };
    }
    return { error: { kind: "temporary", message: "LINEプロフィール取得に失敗しました。" } };
  } finally {
    clearTimeout(timeout);
  }
}

export function assertLiveProfileConfig(config: LineProfileConfig): void {
  if (config.mode === "live" && !config.channelAccessToken) {
    throw new LineConfigurationError("LINE_CHANNEL_ACCESS_TOKENが設定されていません。");
  }
}

export class LineProfileClient {
  constructor(private readonly config: LineProfileConfig) {}

  getProfile(userId: string): Promise<ProfileLookup> {
    return getLineProfile(userId, this.config);
  }
}
