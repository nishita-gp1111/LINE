import { createLineSignature } from "@/lib/line/signature";
import { getWebhookUrl } from "@/lib/line/webhook-url";

export type ConnectionCheck = {
  status: "ok" | "ng" | "skip" | "warn";
  detail: string;
};

export type LineBotIdentity = {
  displayName: string;
  basicId: string;
};

export type LineConnectionTestResult = {
  ok: boolean;
  environment: string;
  mode: "mock" | "live";
  bot: LineBotIdentity | null;
  checks: {
    environment: ConnectionCheck;
    lineApi: ConnectionCheck;
    botIdentity: ConnectionCheck;
    webhook: ConnectionCheck;
    unsignedSignature: ConnectionCheck;
    invalidSignature: ConnectionCheck;
    validSignature: ConnectionCheck;
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
  expectedBasicId?: string;
  expectedDisplayName?: string;
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
  const required = config.mode === "live"
    ? [
        ["LINE_CHANNEL_SECRET", config.channelSecret],
        ["LINE_ORGANIZATION_ID", config.organizationId],
        ["LINE_CHANNEL_ID", config.channelId],
        ["LINE_CHANNEL_ACCESS_TOKEN", config.channelAccessToken],
        ["NEXT_PUBLIC_APP_URL", config.appUrl],
        ...(config.environment === "production"
          ? [
              ["LINE_EXPECTED_BASIC_ID", config.expectedBasicId],
              ["LINE_EXPECTED_DISPLAY_NAME", config.expectedDisplayName]
            ]
          : [])
      ]
    : [];
  const missing = required.filter(([, value]) => !value).map(([name]) => name);

  return missing.length
    ? { status: "ng", detail: `必須設定が不足しています: ${missing.join("、")}` }
    : {
        status: "ok",
        detail: config.mode === "live" ? "live modeの必須設定が揃っています。" : "mock modeのWebhook疎通確認に必要な設定が揃っています。"
      };
}

function safeBotIdentity(value: unknown): LineBotIdentity | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (typeof body.displayName !== "string" || typeof body.basicId !== "string") return null;
  return { displayName: body.displayName, basicId: body.basicId };
}

async function lineApiCheck(
  config: LineConnectionTestConfig,
  fetchImpl: typeof fetch
): Promise<{ lineApi: ConnectionCheck; botIdentity: ConnectionCheck; bot: LineBotIdentity | null }> {
  if (config.mode === "mock") {
    return {
      lineApi: { status: "skip", detail: "mock modeのため、実LINE APIへの認証確認は対象外です。" },
      botIdentity: { status: "skip", detail: "mock modeのため、接続先アカウントは確認していません。" },
      bot: null
    };
  }
  if (!config.channelAccessToken) {
    return {
      lineApi: { status: "ng", detail: "LINE_CHANNEL_ACCESS_TOKENが未設定です。" },
      botIdentity: { status: "skip", detail: "LINE API認証前のため確認できません。" },
      bot: null
    };
  }

  try {
    const response = await requestWithTimeout(
      "https://api.line.me/v2/bot/info",
      { headers: { Authorization: `Bearer ${config.channelAccessToken}` } },
      fetchImpl
    );
    if (response.status === 401 || response.status === 403) {
      return {
        lineApi: { status: "ng", detail: "LINE APIの認証に失敗しました。Channel Access Tokenを確認してください。" },
        botIdentity: { status: "skip", detail: "LINE API認証に失敗したため確認できません。" },
        bot: null
      };
    }
    if (response.status !== 200) {
      return {
        lineApi: { status: "ng", detail: `LINE APIがHTTP ${response.status}を返しました。` },
        botIdentity: { status: "skip", detail: "LINE API認証が完了していないため確認できません。" },
        bot: null
      };
    }

    let bot: LineBotIdentity | null = null;
    try {
      bot = safeBotIdentity(await response.json());
    } catch {
      bot = null;
    }
    if (!bot) {
      return {
        lineApi: { status: "ok", detail: "LINE APIの認証に成功しました。" },
        botIdentity: { status: "ng", detail: "LINE公式アカウント情報の形式を確認できませんでした。" },
        bot: null
      };
    }

    const mismatch =
      (config.expectedBasicId && bot.basicId !== config.expectedBasicId) ||
      (config.expectedDisplayName && bot.displayName !== config.expectedDisplayName);
    const expectedConfigured = Boolean(config.expectedBasicId && config.expectedDisplayName);
    return {
      lineApi: { status: "ok", detail: "LINE APIの認証に成功しました。" },
      botIdentity: mismatch
        ? { status: "ng", detail: "接続先が想定したLINE公式アカウントと一致しません。" }
        : expectedConfigured
          ? { status: "ok", detail: "接続先LINE公式アカウントが期待値と一致しました。" }
          : { status: "warn", detail: "接続先は取得できましたが、期待するアカウント名とBasic IDが未設定です。" },
      bot
    };
  } catch {
    return {
      lineApi: { status: "ng", detail: "LINE APIへ接続できませんでした。" },
      botIdentity: { status: "skip", detail: "LINE APIへ接続できないため確認できません。" },
      bot: null
    };
  }
}

function isReachabilityFailure(status: number): boolean {
  return status === 404 || status >= 500;
}

async function webhookCheck(
  config: LineConnectionTestConfig,
  fetchImpl: typeof fetch
): Promise<Pick<LineConnectionTestResult["checks"], "webhook" | "unsignedSignature" | "invalidSignature" | "validSignature">> {
  const skipped = (detail: string): ConnectionCheck => ({ status: "skip", detail });
  const webhookUrl = getWebhookUrl(config.appUrl);
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(webhookUrl);
  } catch {
    return {
      webhook: { status: "ng", detail: "絶対URLを確認できません。NEXT_PUBLIC_APP_URLを設定してください。" },
      unsignedSignature: skipped("Webhook URLを確認できません。"),
      invalidSignature: skipped("Webhook URLを確認できません。"),
      validSignature: skipped("Webhook URLを確認できません。")
    };
  }

  if ((config.mode === "live" || config.environment === "production") && parsedUrl.protocol !== "https:") {
    return {
      webhook: { status: "ng", detail: "本番Webhook URLはHTTPSである必要があります。" },
      unsignedSignature: skipped("HTTPSではないため確認していません。"),
      invalidSignature: skipped("HTTPSではないため確認していません。"),
      validSignature: skipped("HTTPSではないため確認していません。")
    };
  }

  try {
    const unsigned = await requestWithTimeout(
      parsedUrl.toString(),
      { method: "POST", headers: { "content-type": "application/json" }, body: PROBE_BODY },
      fetchImpl
    );
    if (config.mode === "mock") {
      return {
        webhook: isReachabilityFailure(unsigned.status)
          ? { status: "ng", detail: `Webhook URLがHTTP ${unsigned.status}を返しました。` }
          : { status: "ok", detail: `Webhook URLへ到達しました（HTTP ${unsigned.status}）。` },
        unsignedSignature: skipped("mock modeでは署名保護を確認していません。"),
        invalidSignature: skipped("mock modeでは署名保護を確認していません。"),
        validSignature: skipped("mock modeでは署名付きプローブを送信していません。")
      };
    }

    if (!config.channelSecret) {
      return {
        webhook: isReachabilityFailure(unsigned.status)
          ? { status: "ng", detail: `Webhook URLがHTTP ${unsigned.status}を返しました。` }
          : { status: "ok", detail: `Webhook URLへ到達しました（HTTP ${unsigned.status}）。` },
        unsignedSignature: unsigned.status === 401
          ? { status: "ok", detail: "未署名リクエストはHTTP 401で拒否されました。" }
          : { status: "ng", detail: `未署名リクエストがHTTP ${unsigned.status}でした。` },
        invalidSignature: skipped("LINE_CHANNEL_SECRETが未設定です。"),
        validSignature: skipped("LINE_CHANNEL_SECRETが未設定です。")
      };
    }

    const invalid = await requestWithTimeout(
      parsedUrl.toString(),
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-line-signature": "invalid-connection-test-signature" },
        body: PROBE_BODY
      },
      fetchImpl
    );
    const valid = await requestWithTimeout(
      parsedUrl.toString(),
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-line-signature": createLineSignature(PROBE_BODY, config.channelSecret) },
        body: PROBE_BODY
      },
      fetchImpl
    );
    const reachabilityFailed = [unsigned, invalid, valid].some((response) => isReachabilityFailure(response.status));

    return {
      webhook: reachabilityFailed
        ? { status: "ng", detail: "Webhook URLが404または5xxを返しました。" }
        : { status: "ok", detail: "Webhook URLへ3種類の安全な空イベントプローブが到達しました。" },
      unsignedSignature: unsigned.status === 401
        ? { status: "ok", detail: "未署名リクエストはHTTP 401で拒否されました。" }
        : { status: "ng", detail: `未署名リクエストがHTTP ${unsigned.status}でした。` },
      invalidSignature: invalid.status === 401
        ? { status: "ok", detail: "不正署名リクエストはHTTP 401で拒否されました。" }
        : { status: "ng", detail: `不正署名リクエストがHTTP ${invalid.status}でした。` },
      validSignature: valid.status === 200
        ? { status: "ok", detail: "正しい署名の空イベントはHTTP 200で受理されました。" }
        : { status: "ng", detail: `正しい署名の空イベントがHTTP ${valid.status}でした。Deployment ProtectionとChannel Secretを確認してください。` }
    };
  } catch {
    return {
      webhook: { status: "ng", detail: "Webhook URLへ接続できませんでした。" },
      unsignedSignature: skipped("Webhookへ接続できないため確認していません。"),
      invalidSignature: skipped("Webhookへ接続できないため確認していません。"),
      validSignature: skipped("Webhookへ接続できないため確認していません。")
    };
  }
}

export async function runLineConnectionTest(
  config: LineConnectionTestConfig,
  fetchImpl: typeof fetch = fetch
): Promise<LineConnectionTestResult> {
  const webhookChecks = await webhookCheck(config, fetchImpl);
  const lineChecks = await lineApiCheck(config, fetchImpl);
  const checks = {
    environment: environmentCheck(config),
    lineApi: lineChecks.lineApi,
    botIdentity: lineChecks.botIdentity,
    ...webhookChecks
  };
  const requiredChecks = config.mode === "live"
    ? Object.values(checks)
    : [checks.environment, checks.webhook];
  return {
    ok: requiredChecks.every((check) => check.status === "ok"),
    environment: config.environment,
    mode: config.mode,
    bot: lineChecks.bot,
    checks
  };
}
