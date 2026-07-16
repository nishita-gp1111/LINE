export type LineReadResult = {
  status: "marked" | "mock" | "failed";
  httpStatus?: number;
};

type LineReadConfig = {
  mode: "mock" | "live";
  channelAccessToken?: string;
  timeoutMs?: number;
};

export async function markLineChatAsRead(
  markAsReadToken: string,
  config: LineReadConfig,
  fetchImpl: typeof fetch = fetch
): Promise<LineReadResult> {
  if (config.mode === "mock") return { status: "mock" };
  if (!config.channelAccessToken || !markAsReadToken) return { status: "failed" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 7_000);
  try {
    const response = await fetchImpl("https://api.line.me/v2/bot/chat/markAsRead", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.channelAccessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ markAsReadToken }),
      redirect: "error",
      signal: controller.signal
    });
    return response.ok
      ? { status: "marked", httpStatus: response.status }
      : { status: "failed", httpStatus: response.status };
  } catch {
    return { status: "failed" };
  } finally {
    clearTimeout(timeout);
  }
}
