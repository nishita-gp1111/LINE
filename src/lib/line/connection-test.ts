import { getWebhookUrl } from "@/lib/line/webhook-url";

export type ConnectionCheck = {
  status: "ok" | "ng" | "skip" | "warn";
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
    signatureProtection: ConnectionCheck;
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
const PROBE_BODY = JSON.stringify({ destination: "connection-test", events: [] });

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
    ...(config.mode === "live"
      ? [
          ["LINE_CHANNEL_SECRET", config.channelSecret],
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
    : {
        status: "ok",
        detail: config.mode === "live" ? "live modeの必須設定が揃っています。" : "mock modeのWebhook疎通確認に必要な設定が揃っています。"
      };
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
): Promise<{ webhook: ConnectionCheck; signatureProtection: ConnectionCheck }> {
  const webhookUrl = getWebhookUrl(config.appUrl);
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(webhookUrl);
  } catch {
    return {
      webhook: { status: "ng", detail: "絶対URLを確認できません。NEXT_PUBLIC_APP_URLを設定してください。" },
      signatureProtection: { status: "skip", detail: "Webhook URLを確認できないため、署名保護は判定していません。" }
    };
  }

  if ((config.mode === "live" || config.environment === "production") && parsedUrl.protocol !== "https:") {
    return {
      webhook: { status: "ng", detail: "本番Webhook URLはHTTPSである必要があります。" },
      signatureProtection: { status: "skip", detail: "HTTPSではないため、署名保護は判定していません。" }
    };
  }

  try {
    const response = await requestWithTimeout(
      parsedUrl.toString(),
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: PROBE_BODY
      },
      fetchImpl
    );
    const webhookFailed = response.status === 404 || response.status === 500;
    const webhook: ConnectionCheck = webhookFailed
      ? { status: "ng", detail: `Webhook URLがHTTP ${response.status}を返しました。` }
      : { status: "ok", detail: `Webhook URLへ到達しました（HTTP ${response.status}）。` };

    if (config.mode === "mock") {
      return {
        webhook,
        signatureProtection: { status: "skip", detail: "mock modeでは署名保護の確認を行っていません。" }
      };
    }
    if (response.status === 401) {
      return {
        webhook,
        signatureProtection: { status: "ok", detail: "Webhookは署名保護されています（未署名リクエストにHTTP 401）。LINE Developers ConsoleのVerifyで署名付き確認を行ってください。" }
      };
    }
    return {
      webhook,
      signatureProtection: {
        status: "warn",
        detail: "署名保護はこの未署名プローブでは確定できません。LINE Developers ConsoleのVerifyで確認してください。"
      }
    };
  } catch {
    return {
      webhook: { status: "ng", detail: "Webhook URLへ接続できませんでした。" },
      signatureProtection: { status: "skip", detail: "Webhookへ接続できないため、署名保護は判定していません。" }
    };
  }
}

export async function runLineConnectionTest(
  config: LineConnectionTestConfig,
  fetchImpl: typeof fetch = fetch
): Promise<LineConnectionTestResult> {
  const webhookChecks = await webhookCheck(config, fetchImpl);
  const checks = {
    environment: environmentCheck(config),
    lineApi: await lineApiCheck(config, fetchImpl),
    webhook: webhookChecks.webhook,
    signatureProtection: webhookChecks.signatureProtection
  };
  return {
    ok: [checks.environment, checks.lineApi, checks.webhook].every((check) => check.status === "ok"),
    environment: config.environment,
    mode: config.mode,
    checks
  };
}
