import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";

async function inbound(request: APIRequestContext, userId: string, text: string) {
  const body = JSON.stringify({ events: [{ type: "message", webhookEventId: randomUUID(), timestamp: Date.now(), source: { type: "user", userId }, message: { id: `M${randomUUID()}`, type: "text", text } }] });
  const response = await request.post("/api/line/webhook", { data: body, headers: { "content-type": "application/json", "x-line-signature": createHmac("sha256", "e2e-secret").update(body).digest("base64") } });
  expect(response.status()).toBe(200);
}

async function sendMockReply(page: Page, text: string) {
  await page.getByLabel("送信するメッセージ").fill(text);
  await page.getByRole("button", { name: "送信", exact: true }).click();
  await expect(page.locator("article").filter({ hasText: text })).toContainText("LINE受付済み");
}

for (const width of [320, 390, 1280, 1440]) {
  test(`long URLs cannot push inbound or outbound bubbles outside the conversation at ${width}px`, async ({ page, request }, testInfo) => {
    // Never send these synthetic fixtures to a real LINE account.
    expect((await (await request.get("/api/health")).json()).mockLineApi).toBe(true);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/login");
    await page.getByLabel("メールアドレス").fill("owner@example.local");
    await page.getByRole("button", { name: "ログイン", exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/);

    const userId = `Ulayout-${randomUUID()}`;
    const longUrl = `https://example.com/booking?reference=${"a".repeat(900)}&source=layout-test`;
    const inboundText = `受信した長いURL\n${longUrl}\n末尾まで読めます。`;
    await inbound(request, userId, inboundText);
    await page.goto("/admin/inbox");
    await expect(page).toHaveURL(/conversation=/);
    await sendMockReply(page, `送信した長いURL\n${longUrl}\n改行も維持します。`);
    await sendMockReply(page, "短い返信も右端から消えません。");
    await inbound(request, userId, "確認しました。");
    await page.reload();

    const conversation = page.locator("section").filter({ has: page.getByLabel("送信するメッセージ") });
    const viewport = conversation.locator("header + div");
    await expect(viewport.locator("article")).toHaveCount(4);
    const layout = await viewport.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const grid = element.firstElementChild as HTMLElement;
      return {
        viewportWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        gridWidth: grid.clientWidth,
        gridScrollWidth: grid.scrollWidth,
        left: bounds.left,
        right: bounds.right,
        bubbles: [...element.querySelectorAll("article")].map(article => {
          const box = article.getBoundingClientRect();
          const body = article.querySelector("p")!;
          return { left: box.left, right: box.right, width: box.width, bodyWidth: body.clientWidth, bodyScrollWidth: body.scrollWidth };
        })
      };
    });
    await testInfo.attach("message-layout", { body: JSON.stringify(layout), contentType: "application/json" });
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
    expect(layout.gridScrollWidth).toBeLessThanOrEqual(layout.gridWidth + 1);
    for (const bubble of layout.bubbles) {
      expect(bubble.left).toBeGreaterThanOrEqual(layout.left);
      expect(bubble.right).toBeLessThanOrEqual(layout.right);
      expect(bubble.width).toBeLessThanOrEqual(layout.gridWidth * 0.86 + 1);
      expect(bubble.bodyScrollWidth).toBeLessThanOrEqual(bubble.bodyWidth + 1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await viewport.locator("article").first().locator("p").textContent()).toBe(inboundText);
    await expect(page.getByRole("status", { name: "トーク同期状態" })).toHaveText("自動更新中（約1分ごと）");
    await viewport.locator("article").filter({ hasText: "短い返信も右端から消えません。" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`message-layout-${width}.png`) });
  });
}
