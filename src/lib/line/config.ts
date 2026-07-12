import { getServerEnv } from "@/lib/env/server";
import { LineConfigurationError } from "@/lib/line/errors";

export const MOCK_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";

export type LineRuntimeConfig = {
  mode: "mock" | "live";
  organizationId: string;
  channelId?: string;
  channelSecret: string;
  channelAccessToken?: string;
};

export function getLineRuntimeConfig(): LineRuntimeConfig {
  const env = getServerEnv();
  const mode = env.MOCK_LINE_API ? "mock" : "live";
  const organizationId = env.LINE_ORGANIZATION_ID || (mode === "mock" ? MOCK_ORGANIZATION_ID : "");

  if (!organizationId) {
    throw new LineConfigurationError("LINE_ORGANIZATION_IDが設定されていません。");
  }
  if (!env.LINE_CHANNEL_SECRET) {
    throw new LineConfigurationError("LINE_CHANNEL_SECRETが設定されていません。");
  }
  if (mode === "live") {
    const missing = [
      ["LINE_CHANNEL_ID", env.LINE_CHANNEL_ID],
      ["LINE_CHANNEL_ACCESS_TOKEN", env.LINE_CHANNEL_ACCESS_TOKEN]
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (missing.length) {
      throw new LineConfigurationError(`${missing.join("、")}が設定されていません。`);
    }
  }

  return {
    mode,
    organizationId,
    channelId: env.LINE_CHANNEL_ID,
    channelSecret: env.LINE_CHANNEL_SECRET,
    channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN
  };
}
