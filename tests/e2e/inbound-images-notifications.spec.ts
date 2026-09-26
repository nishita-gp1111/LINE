import { expect, test, type Page, type APIRequestContext } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import sharp from "sharp";

async function login(page: Page) {
  await page.goto("/login"); await page.getByLabel("メールアドレス").fill("owner@example.local");
  await page.getByRole("button", { name: "ログイン", exact: true }).click(); await expect(page).toHaveURL(/\/admin$/);
}
async function inbound(request: APIRequestContext, type: "image" | "text", userId: string, text = "通知テスト本文") {
  const messageId = `M${randomUUID()}`;
  const body = JSON.stringify({ events: [{ type: "message", webhookEventId: randomUUID(), timestamp: Date.now(), source: { type: "user", userId }, message: { id: messageId, type, ...(type === "text" ? { text } : {}) } }] });
  const result = await request.post("/api/line/webhook", { data: body, headers: { "content-type": "application/json", "x-line-signature": createHmac("sha256", "e2e-secret").update(body).digest("base64") } });
  expect(result.status()).toBe(200); return messageId;
}

test("received photos preview, expand, error/retry, and mobile layout", async ({ page, request }, testInfo) => {
  await login(page);
  await inbound(request, "image", "Uphoto-e2e-9001");
  const photo = await sharp({ create: { width: 720, height: 480, channels: 3, background: "#a7f3d0" } }).composite([{ input: Buffer.from('<svg width="720" height="480"><rect x="90" y="70" width="540" height="340" rx="24" fill="#fff"/><text x="360" y="260" font-size="50" text-anchor="middle" fill="#047857">PHOTO TEST</text></svg>') }]).jpeg().toBuffer();
  let fail = false;
  await page.route("**/api/inbox/messages/*/image", route => fail ? route.fulfill({ status: 410, contentType: "application/json", body: JSON.stringify({ error: "LINE側の保存期限切れなどにより、この写真は取得できません。" }) }) : route.fulfill({ contentType: "image/jpeg", body: photo }));
  await page.goto("/admin/inbox");
  const image = page.getByRole("img", { name: "お客様から届いた写真" });
  await expect(image).toBeVisible();
  expect(await image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(720);
  const expand = page.getByRole("link", { name: "受信した写真を拡大する" });
  await expect(expand).toHaveAttribute("target", "_blank"); await expect(expand).toHaveAttribute("href", /\/api\/inbox\/messages\/.*\/image/);
  await page.screenshot({ path: testInfo.outputPath("received-photo-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await image.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("received-photo-mobile.png") });
  fail = true; await page.reload(); await expect(page.getByText("LINE側の保存期限切れなどにより、この写真は取得できません。")).toBeVisible();
  fail = false; await page.getByRole("button", { name: "再読み込み" }).click(); await expect(image).toBeVisible();
});

test("new LINE notifies on another admin page, desktop opt-in, deduplication and click-through", async ({ page, request, context }, testInfo) => {
  // Mock the OS surface only. Notification polling, auth and webhook storage are real mock-mode routes.
  await context.addInitScript(() => {
    const calls: Array<{ title: string; body: string }> = [];
    Object.assign(window, { __notifications: calls });
    class TestNotification {
      static permission = "default";
      static async requestPermission() { this.permission = "granted"; return "granted"; }
      onclick: (() => void) | null = null;
      onclose: (() => void) | null = null;
      constructor(title: string, options: { body: string }) { calls.push({ title, body: options.body }); }
      close() {}
    }
    Object.defineProperty(window, "Notification", { value: TestNotification });
  });
  await login(page);
  await page.getByRole("button", { name: "新着通知", exact: true }).click();
  await expect(page.getByRole("region", { name: "新着LINE通知" })).toContainText("新着通知を受信中");
  await page.getByRole("button", { name: "デスクトップ通知をONにする" }).click();
  await expect(page.getByRole("button", { name: "デスクトップ通知をOFFにする" })).toBeVisible();
  await page.getByRole("button", { name: "新着通知", exact: true }).click();
  const otherTab = await context.newPage();
  await otherTab.goto("/admin");
  await otherTab.getByRole("button", { name: "新着通知", exact: true }).click();
  await expect(otherTab.getByRole("region", { name: "新着LINE通知" })).toContainText("新着通知を受信中");
  await otherTab.getByRole("button", { name: "デスクトップ通知をONにする" }).click();
  await inbound(request, "text", "Unotify-e2e-9002", "通知から開いたトークです");
  await expect(page.getByRole("button", { name: "新着通知 1件", exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(otherTab.getByRole("button", { name: "新着通知 1件", exact: true })).toBeVisible({ timeout: 20_000 });
  const count = (target: Page) => target.evaluate(() => (window as unknown as { __notifications: unknown[] }).__notifications.length);
  expect(await count(page) + await count(otherTab)).toBe(1);
  await otherTab.close(); await page.bringToFront();
  expect(await page.evaluate(() => JSON.stringify((window as unknown as { __notifications: unknown[] }).__notifications))).not.toContain("通知から開いたトークです");
  await page.getByRole("button", { name: "新着通知 1件", exact: true }).click();
  const panel = page.getByRole("region", { name: "新着LINE通知" });
  await expect(panel.getByRole("link")).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("notifications-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("notifications-mobile.png") });
  await panel.getByRole("link").click();
  await expect(page).toHaveURL(/\/admin\/inbox\?conversation=/);
  await expect(page.getByText("通知から開いたトークです", { exact: true }).last()).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  const input = page.getByPlaceholder(/さんへメッセージを入力/); await input.fill("未送信の下書き");
  await inbound(request, "text", "Unotify-e2e-9002", "トークが自動更新されました");
  await expect(page.getByText("トークが自動更新されました", { exact: true }).last()).toBeVisible({ timeout: 20_000 });
  await expect(input).toHaveValue("未送信の下書き");
});

test("notification denial keeps in-app alerts; background conversations are not marked read", async ({ page, request }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "hasFocus", { configurable: true, value: () => false });
    Object.defineProperty(window, "Notification", { value: class {
      static permission = "denied";
      constructor() { throw new Error("Must not notify without permission"); }
    } });
  });
  await login(page);
  await page.getByRole("button", { name: "新着通知", exact: true }).click();
  const panel = page.getByRole("region", { name: "新着LINE通知" });
  await expect(panel).toContainText("新着通知を受信中");
  await expect(panel.getByRole("button", { name: "デスクトップ通知をONにする" })).toBeDisabled();
  await expect(panel).toContainText("画面内通知は有効です");
  await inbound(request, "text", "Udenied-e2e-9003", "画面内の通知だけでも届きます");
  await expect(panel.getByRole("link")).toHaveCount(1, { timeout: 20_000 });
  const readRequests: unknown[] = [];
  page.on("request", req => { if (req.url().endsWith("/api/inbox/action") && req.method() === "POST" && req.postDataJSON().action === "read") readRequests.push(req.postDataJSON()); });
  await panel.getByRole("link").click();
  await expect(page.getByText("画面内の通知だけでも届きます", { exact: true }).last()).toBeVisible();
  expect(readRequests).toHaveLength(0);
  await page.evaluate(() => { Object.defineProperty(document, "hasFocus", { configurable: true, value: () => true }); window.dispatchEvent(new Event("focus")); });
  await expect.poll(() => readRequests.length).toBe(1);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "ログアウト" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get("/api/inbox/notifications")).status()).toBe(401);
  expect((await page.request.get("/api/inbox/messages/00000000-0000-4000-8000-000000000001/image")).status()).toBe(401);
});
