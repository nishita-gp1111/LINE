import { z } from "zod";
import { getServerEnv } from "@/lib/env/server";

export const lineTextMessageSchema = z.string().refine((value) => value.trim().length > 0, "本文を入力してください。").refine((value) => value.length <= 5000, "本文は5000文字以内で入力してください。");

export type LinePushTextInput = {
  lineUserId: string;
  text: string;
  retryKey: string;
};

export type LinePushAccepted = {
  accepted: true;
  lineRequestId: string | null;
  lineAcceptedRequestId: string | null;
  lineSentMessageId: string | null;
};

export type LinePushRejected = {
  accepted: false;
  retryable: boolean;
  httpStatus: number | null;
  errorClass: string;
  errorCode: string | null;
  safeMessage: string;
  lineRequestId: string | null;
  lineAcceptedRequestId: string | null;
};

export type LinePushResult = LinePushAccepted | LinePushRejected;

export interface LinePushClient {
  pushTextMessage(input: LinePushTextInput): Promise<LinePushResult>;
}

export class LineSendConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LineSendConfigurationError";
  }
}

const sentMessagesSchema = z.object({
  sentMessages: z.array(z.object({ id: z.string().optional() })).optional()
});

const SEND_TIMEOUT_MS = 7_000;

function header(response: Response, name: string): string | null {
  return response.headers.get(name) || response.headers.get(name.toLowerCase());
}

async function parseSentMessageId(response: Response): Promise<string | null> {
  try {
    const json = (await response.json()) as unknown;
    return sentMessagesSchema.safeParse(json).data?.sentMessages?.[0]?.id || null;
  } catch {
    return null;
  }
}

export class LiveLinePushClient implements LinePushClient {
  constructor(private readonly accessToken: string) {}

  async pushTextMessage(input: LinePushTextInput): Promise<LinePushResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    try {
      const response = await fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
          "X-Line-Retry-Key": input.retryKey
        },
        body: JSON.stringify({ to: input.lineUserId, messages: [{ type: "text", text: input.text }] }),
        signal: controller.signal
      });
      const lineRequestId = header(response, "x-line-request-id");
      const lineAcceptedRequestId = header(response, "x-line-accepted-request-id");
      if (response.status === 200) {
        return { accepted: true, lineRequestId, lineAcceptedRequestId, lineSentMessageId: await parseSentMessageId(response) };
      }
      if (response.status === 409) {
        return { accepted: true, lineRequestId, lineAcceptedRequestId, lineSentMessageId: null };
      }
      if (response.status >= 500 && response.status <= 599) {
        return { accepted: false, retryable: true, httpStatus: response.status, errorClass: "line_5xx", errorCode: String(response.status), safeMessage: "LINE APIの一時的なエラーです。", lineRequestId, lineAcceptedRequestId };
      }
      return { accepted: false, retryable: false, httpStatus: response.status, errorClass: response.status === 429 ? "rate_limited" : "line_rejected", errorCode: String(response.status), safeMessage: response.status === 429 ? "LINE APIの送信上限に達しました。時間を置いて再試行してください。" : "LINE APIが送信を拒否しました。設定と送信先を確認してください。", lineRequestId, lineAcceptedRequestId };
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === "AbortError";
      return { accepted: false, retryable: true, httpStatus: null, errorClass: timedOut ? "timeout" : "connection_error", errorCode: null, safeMessage: timedOut ? "LINE APIがタイムアウトしました。" : "LINE APIへ接続できませんでした。", lineRequestId: null, lineAcceptedRequestId: null };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class MockLinePushClient implements LinePushClient {
  constructor(private readonly outcome: "success" | "409" | "429" | "500" | "timeout") {}

  async pushTextMessage(input: LinePushTextInput): Promise<LinePushResult> {
    const lineRequestId = `mock-request-${input.retryKey.slice(0, 8)}`;
    if (this.outcome === "timeout") return { accepted: false, retryable: true, httpStatus: null, errorClass: "timeout", errorCode: null, safeMessage: "Mock送信をタイムアウトとして扱いました。", lineRequestId: null, lineAcceptedRequestId: null };
    if (this.outcome === "409") return { accepted: true, lineRequestId, lineAcceptedRequestId: `mock-accepted-${input.retryKey.slice(0, 8)}`, lineSentMessageId: null };
    if (this.outcome === "429") return { accepted: false, retryable: false, httpStatus: 429, errorClass: "rate_limited", errorCode: "429", safeMessage: "Mock送信をレート制限として扱いました。", lineRequestId, lineAcceptedRequestId: null };
    if (this.outcome === "500") return { accepted: false, retryable: true, httpStatus: 500, errorClass: "line_5xx", errorCode: "500", safeMessage: "Mock送信を一時エラーとして扱いました。", lineRequestId, lineAcceptedRequestId: null };
    return { accepted: true, lineRequestId, lineAcceptedRequestId: null, lineSentMessageId: `mock-sent-${input.retryKey.slice(0, 8)}` };
  }
}

export function createLinePushClient(): LinePushClient {
  const env = getServerEnv();
  if (env.MOCK_LINE_API) return new MockLinePushClient(env.MOCK_LINE_SEND_OUTCOME);
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) throw new LineSendConfigurationError("LINE_CHANNEL_ACCESS_TOKENが設定されていません。");
  return new LiveLinePushClient(env.LINE_CHANNEL_ACCESS_TOKEN);
}

export type LineMulticastInput = { lineUserIds: string[]; messages: Array<Record<string, unknown>>; retryKey: string };
export type LineMulticastResult = { accepted: boolean; retryable: boolean; httpStatus: number | null; lineRequestId: string | null; safeMessage?: string };

export interface LineMulticastClient { multicast(input: LineMulticastInput): Promise<LineMulticastResult>; }

export class MockLineMulticastClient implements LineMulticastClient {
  async multicast(input: LineMulticastInput): Promise<LineMulticastResult> {
    return { accepted: input.lineUserIds.length > 0 && input.messages.length > 0, retryable: false, httpStatus: 200, lineRequestId: `mock-multicast-${input.retryKey.slice(0, 8)}` };
  }
}

export class LiveLineMulticastClient implements LineMulticastClient {
  constructor(private readonly accessToken: string) {}
  async multicast(input: LineMulticastInput): Promise<LineMulticastResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch("https://api.line.me/v2/bot/message/multicast", { method: "POST", redirect: "error", headers: { Authorization: `Bearer ${this.accessToken}`, "Content-Type": "application/json", "X-Line-Retry-Key": input.retryKey }, body: JSON.stringify({ to: input.lineUserIds, messages: input.messages }), signal: controller.signal });
      const lineRequestId = response.headers.get("x-line-request-id");
      if (response.status === 200 || response.status === 409) return { accepted: true, retryable: false, httpStatus: response.status, lineRequestId };
      return { accepted: false, retryable: response.status === 429 || response.status >= 500, httpStatus: response.status, lineRequestId, safeMessage: response.status === 429 ? "LINE quota/rate limitです。" : "LINE multicastが拒否されました。" };
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === "AbortError";
      return { accepted: false, retryable: true, httpStatus: null, lineRequestId: null, safeMessage: timedOut ? "LINE multicastがタイムアウトしました。" : "LINE multicastへ接続できませんでした。" };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createLineMulticastClient(): LineMulticastClient {
  const env = getServerEnv();
  if (env.MOCK_LINE_API) return new MockLineMulticastClient();
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) throw new LineSendConfigurationError("LINE_CHANNEL_ACCESS_TOKENが設定されていません。");
  return new LiveLineMulticastClient(env.LINE_CHANNEL_ACCESS_TOKEN);
}
