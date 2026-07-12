import { createLineSignature } from "@/lib/line/signature";
import { getWebhookUrl } from "@/lib/line/webhook-url";

export type ConnectionCheck = {
  status: "ok" | "ng";
  detail: string;
};

export type LineConnectionTestResult = {
  ok: boolean;
  environment: string;
  mode: "mock" | "live";
  checks: {
    environment: ConnectionCheck;
    lineApi: ConnectionCheck;
    webhook: ConnectionCheck;
  };
};

export type LineConnectionTestConfig = {
  environment: string;
  mode: "mock" | "live";
  appUrl?: string;
  organizationId?: string;
  channelId?: string;
  channelSecret?: string;
  channelAccessToken?: string;
};

const CONNECTION_TIMEOUT_MS = 5_000;
const VERIFY_BODY = JSON.stringify({ destination: "connection-test", events: [] });

async function requestWithTimeout(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONNECTION_TIMEOUT_MS);
  try {
    return await fetchImpl(url, {
      ...init,
      redirect: "error",
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function environmentCheck(config: LineConnectionTestConfig): ConnectionCheck {
  const missing = [
    ["LINE_CHANNEL_SECRET", config.channelSecret],
    ...(config.mode === "live"
      ? [
          ["LINE_ORGANIZATION_ID", config.organizationId],
          ["LINE_CHANNEL_ID", config.channelId],
          ["LINE_CHANNEL_ACCESS_TOKEN", config.channelAccessToken],
          ["NEXT_PUBLIC_APP_URL", config.appUrl]
        ]
      : [])
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  return missing.length
    ? { status: "ng", detail: `必須設定が不足しています: ${missing.join("、")}` }
    : { status: "ok", detail: config.mode === "live" ? "live modeの必須設定が揃っています。" : "mock modeの署名検証設定が揃っています。" };
}

async function lineApiCheck(
  config: LineConnectionTestConfig,
  fetchImpl: typeof fetch
): Promise<ConnectionCheck> {
  if (config.mode === "mock") {
    return { status: "ok", detail: "mock modeのため、実LINE APIへの認証確認はスキップしました。" };
  }
  if (!config.channelAccessToken) {
    return { status: "ng", detail: "LINE_CHANNEL_ACCESS_TOKENが未設定です。" };
  }

  try {
    const response = await requestWithTimeout(
      "https://api.line.me/v2/bot/info",
      { headers: { Authorization: `Bearer ${config.channelAccessToken}` } },
      fetchImpl
    );
    if (response.status === 200) return { status: "ok", detail: "LINE APIの認証に成功しました。" };
    if (response.status === 401 || response.status === 403) {
      return { status: "ng", detail: "LINE APIの認証に失敗しました。Channel Access Tokenを確認してください。" };
    }
    return { status: "ng", detail: `LINE APIがHTTP ${response.status}を返しました。` };
  } catch {
    return { status: "ng", detail: "LINE APIへ接続できませんでした。" };
  }
}

async function webhookCheck(
  config: LineConnectionTestConfig,
  fetchImpl: typeof fetch
): Promise<ConnectionCheck> {
  const webhookUrl = getWebhookUrl(config.appUrl);
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(webhookUrl);
  } catch {
    return { status: "ng", detail: "絶対URLを確認できません。NEXT_PUBLIC_APP_URLを設定してください。" };
  }

  if ((config.mode === "live" || config.environment === "production") && parsedUrl.protocol !== "https:") {
    return { status: "ng", detail: "本番Webhook URLはHTTPSである必要があります。" };
  }
  if (!config.channelSecret) {
    return { status: "ng", detail: "LINE_CHANNEL_SECRETが未設定のため署名付き疎通確認ができません。" };
  }

  try {
    const response = await requestWithTimeout(
      parsedUrl.toString(),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-line-signature": createLineSignature(VERIFY_BODY, config.channelSecret)
        },
        body: VERIFY_BODY
      },
      fetchImpl
    );
    return response.status === 200
      ? { status: "ok", detail: "署名付きの空イベントを送信し、WebhookがHTTP 200を返しました。" }
      : { status: "ng", detail: `Webhook URLがHTTP ${response.status}を返しました。` };
  } catch {
    return { status: "ng", detail: "Webhook URLへ接続できませんでした。" };
  }
}

export async function runLineConnectionTest(
  config: LineConnectionTestConfig,
  fetchImpl: typeof fetch = fetch
): Promise<LineConnectionTestResult> {
  const checks = {
    environment: environmentCheck(config),
    lineApi: await lineApiCheck(config, fetchImpl),
    webhook: await webhookCheck(config, fetchImpl)
  };
  return {
    ok: Object.values(checks).every((check) => check.status === "ok"),
    environment: config.environment,
    mode: config.mode,
    checks
  };
}
