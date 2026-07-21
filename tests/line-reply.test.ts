import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveLineReplyClient, MockLineReplyClient } from "../src/lib/line/send";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LINE Reply API client", () => {
  it("sends up to five messages with a reply token and never uses the quota-counted Push API", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(JSON.stringify({ sentMessages: [{ id: "sent-1" }, { id: "sent-2" }] }), {
        status: 200,
        headers: { "content-type": "application/json", "x-line-request-id": "request-1" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const replyToken = "single-use-reply-token";
    const result = await new LiveLineReplyClient("channel-access-token").replyMessages({
      replyToken,
      messages: [
        { type: "flex", altText: "挨拶", contents: { type: "bubble" } },
        { type: "flex", altText: "質問1", contents: { type: "bubble" } }
      ]
    });

    expect(result.accepted).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(requestUrl).toBe("https://api.line.me/v2/bot/message/reply");
    const headers = requestInit?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer channel-access-token");
    expect(headers["X-Line-Retry-Key"]).toBeUndefined();
    const body = JSON.parse(String(requestInit?.body)) as Record<string, unknown>;
    expect(body.replyToken).toBe(replyToken);
    expect(body.to).toBeUndefined();
    expect(body.messages).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain(replyToken);
    if (result.accepted) expect(result.lineSentMessageIds).toEqual(["sent-1", "sent-2"]);
  });

  it("rejects an empty or oversized reply without calling LINE", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = new LiveLineReplyClient("channel-access-token");
    expect((await client.replyMessages({ replyToken: "", messages: [{ type: "text" }] })).accepted).toBe(false);
    expect((await client.replyMessages({ replyToken: "token", messages: Array.from({ length: 6 }, () => ({ type: "text" })) })).accepted).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the mock path network-free", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await new MockLineReplyClient("success").replyMessages({ replyToken: "mock-token", messages: [{ type: "flex" }] });
    expect(result.accepted).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
