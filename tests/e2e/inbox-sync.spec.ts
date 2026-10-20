import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";

test.use({ actionTimeout: 10_000 });

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill("owner@example.local");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

async function inbound(request: APIRequestContext, userId: string, text: string) {
  const body = JSON.stringify({ events: [{ type: "message", webhookEventId: randomUUID(), timestamp: Date.now(), source: { type: "user", userId }, message: { id: `M${randomUUID()}`, type: "text", text } }] });
  expect((await request.post("/api/line/webhook", { data: body, headers: { "content-type": "application/json", "x-line-signature": createHmac("sha256", "e2e-secret").update(body).digest("base64") } })).status()).toBe(200);
}

async function simulatedWindow(page: Page) {
  await page.addInitScript(() => {
    // Two independently logged-in, visible windows, as on two different PCs.
    // Keep focus false to ensure background synchronization never marks a chat read.
    Object.assign(window, { __inboxVisible: true });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (window as unknown as { __inboxVisible: boolean }).__inboxVisible ? "visible" : "hidden" });
    Object.defineProperty(document, "hasFocus", { configurable: true, value: () => false });
  });
}

test("another operator's reply and notes sync without a reload and preserve drafts", async ({ page, browser, request, baseURL }, testInfo) => {
  test.setTimeout(65_000);
  const other = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  try {
    const second = await other.newPage();
    await simulatedWindow(page); await simulatedWindow(second);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await login(page); await login(second);
    const id = randomUUID(); const user = `Usync-${id}`; const initial = `同期確認 ${id}`;
    await inbound(request, user, initial);
    await page.goto("/admin/inbox");
    const href = await page.getByRole("link").filter({ hasText: initial }).getAttribute("href");
    expect(href).toBeTruthy();
    await page.goto(href!); await second.goto(href!);
    await expect(page.getByRole("status", { name: "トーク同期状態" })).toHaveText("自動更新中（約5秒ごと）");
    const draft = page.getByLabel("送信するメッセージ");
    await draft.fill("入力中の文章は残してください");
    const noteDraft = page.getByPlaceholder("対応内容などをメモ");
    await noteDraft.fill("入力途中の内部メモ");
    await page.locator('input[type="file"]').setInputFiles({ name: "unsent-draft.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF") });
    let reloads = 0; let reads = 0; let sends = 0;
    page.on("request", req => {
      if (req.isNavigationRequest() && req.frame() === page.mainFrame()) reloads++;
      if (req.url().endsWith("/api/inbox/action") && req.method() === "POST" && req.postDataJSON().action === "read") reads++;
      if (req.method() === "POST" && /\/api\/inbox\/(messages\/send|attachments)/.test(req.url())) sends++;
    });
    const reply = `別の担当者からの返信 ${id}`;
    const started = Date.now();
    await second.getByLabel("送信するメッセージ").fill(reply);
    await second.getByRole("button", { name: "送信", exact: true }).click();
    await expect(second.locator("article").filter({ hasText: reply })).toContainText("LINE受付済み");
    await expect(page.locator("article").filter({ hasText: reply })).toContainText("LINE受付済み", { timeout: 15_000 });
    const replySyncMs = Date.now() - started;
    await second.getByPlaceholder("対応内容などをメモ").fill("別ブラウザーで保存したメモ");
    await second.getByRole("button", { name: "メモを追加", exact: true }).click();
    await expect(page.getByText("別ブラウザーで保存したメモ", { exact: true })).toBeVisible({ timeout: 15_000 });
    await second.getByLabel("ステータス").selectOption("pending");
    await expect(page.getByLabel("ステータス")).toHaveValue("pending", { timeout: 15_000 });
    await inbound(request, user, "新着も自動で反映されます");
    await expect(page.locator("article").filter({ hasText: "新着も自動で反映されます" })).toBeVisible({ timeout: 15_000 });
    await expect(draft).toHaveValue("入力中の文章は残してください");
    await expect(noteDraft).toHaveValue("入力途中の内部メモ");
    await expect(page.getByText("unsent-draft.pdf", { exact: true })).toBeVisible();
    expect({ reloads, reads, sends }).toEqual({ reloads: 0, reads: 0, sends: 0 });
    await testInfo.attach("sync-timing", { body: JSON.stringify({ replySyncMs }), contentType: "application/json" });
    await page.screenshot({ path: testInfo.outputPath("inbox-sync-desktop.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("status", { name: "トーク同期状態" }).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("inbox-sync-mobile.png") });
  } finally { await other.close(); }
});

test("idle checks are lightweight, failures recover, and returning to a tab catches up", async ({ page, request }) => {
  test.setTimeout(65_000);
  await simulatedWindow(page); await login(page);
  const id = randomUUID(); const user = `Ureconnect-${id}`; const initial = `再接続確認 ${id}`;
  await inbound(request, user, initial);
  await page.goto("/admin/inbox");
  await expect(page.getByRole("status", { name: "トーク同期状態" })).toHaveText("自動更新中（約5秒ごと）");
  let refreshes = 0; let syncs = 0; let fail = false;
  page.on("request", req => { if (req.headers().rsc === "1" && !req.headers()["next-router-prefetch"]) refreshes++; });
  await page.route("**/api/inbox/sync", route => { syncs++; return fail ? route.fulfill({ status: 503, body: "{}" }) : route.continue(); });
  await expect.poll(() => syncs, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  expect(refreshes).toBe(0);
  fail = true;
  await expect(page.getByRole("status", { name: "トーク同期状態" })).toContainText("自動で再接続", { timeout: 10_000 });
  await inbound(request, user, "通信障害中の新着");
  fail = false;
  await expect(page.locator("article").filter({ hasText: "通信障害中の新着" })).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => { (window as unknown as { __inboxVisible: boolean }).__inboxVisible = false; document.dispatchEvent(new Event("visibilitychange")); });
  await inbound(request, user, "タブに戻ったときの新着");
  await expect(page.locator("article").filter({ hasText: "タブに戻ったときの新着" })).toHaveCount(0);
  await page.evaluate(() => { (window as unknown as { __inboxVisible: boolean }).__inboxVisible = true; document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("online")); });
  await expect(page.locator("article").filter({ hasText: "タブに戻ったときの新着" })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("button", { name: "今すぐ更新", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "今すぐ更新", exact: true }).click();
  await expect(page.getByRole("button", { name: "今すぐ更新", exact: true })).toBeEnabled();
  await page.unroute("**/api/inbox/sync");
  await page.route("**/api/inbox/sync", route => route.fulfill({ status: 401, body: "{}" }));
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByRole("status", { name: "トーク同期状態" })).toContainText("ログイン状態を再確認中");
  await expect(page.getByRole("link", { name: "再ログイン", exact: true })).toHaveAttribute("href", "/login");
  await page.unroute("**/api/inbox/sync");
  await page.getByRole("button", { name: "今すぐ更新", exact: true }).click();
  await expect(page.getByRole("status", { name: "トーク同期状態" })).toHaveText("自動更新中（約5秒ごと）", { timeout: 10_000 });
});
