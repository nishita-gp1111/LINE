import { expect, test, type Page, type APIRequestContext } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import type { QuickReplyTemplate } from "@/lib/inbox/types";

// Use the browser's authenticated fetch: mock login sets a Secure cookie, which
// Chromium accepts on loopback but Playwright's standalone HTTP client omits.
async function templates(page: Page, method: string, data?: Record<string, unknown>) {
  return page.evaluate(async input => {
    const response = await fetch("/api/inbox/quick-replies", { method: input.method, headers: { "content-type": "application/json" }, ...(input.data ? { body: JSON.stringify(input.data) } : {}) });
    const result = await response.json() as { ok: boolean; item: QuickReplyTemplate; items: QuickReplyTemplate[] };
    return { ...result, status: response.status };
  }, { method, data });
}

async function prepare(page: Page, request: APIRequestContext) {
  await page.goto("/login"); await page.getByLabel("メールアドレス").fill("owner@example.local");
  await page.getByRole("button", { name: "ログイン", exact: true }).click(); await expect(page).toHaveURL(/\/admin$/);
  const body = JSON.stringify({ events: [{ type: "message", webhookEventId: randomUUID(), timestamp: Date.now(), source: { type: "user", userId: `Utemplates-${randomUUID()}` }, message: { id: `M${randomUUID()}`, type: "text", text: "テンプレート画面確認用" } }] });
  expect((await request.post("/api/line/webhook", { data: body, headers: { "content-type": "application/json", "x-line-signature": createHmac("sha256", "e2e-secret").update(body).digest("base64") } })).status()).toBe(200);
  await page.goto("/admin/inbox");
}

test("create, search all templates, insert without sending, edit and persist; desktop/mobile", async ({ page, request }, testInfo) => {
  await prepare(page, request);
  const sendRequests: string[] = [];
  page.on("request", req => { if (req.url().includes("/api/inbox/messages/send")) sendRequests.push(req.url()); });
  const composer = page.getByRole("textbox", { name: "送信するメッセージ" });
  const open = page.getByRole("button", { name: "📝 テンプレート", exact: true });
  const dialog = page.getByRole("dialog", { name: "文章テンプレート" });
  const suffix = randomUUID().slice(0, 8);
  const name = `面談のお礼-${suffix}`;
  const message = "本日は面談のお時間をいただき、ありがとうございました。\nご不明な点がございましたら、お気軽にご連絡ください。";
  const ids: string[] = [];
  try {
    for (let i = 0; i < 5; i++) {
      const response = await templates(page, "POST", { name: `既存の案内${i}-${suffix}`, textContent: `案内${i}`, sortOrder: 0 });
      expect(response.status).toBe(200); ids.push(response.item.id);
    }
    await composer.fill(message);
    await open.click(); await dialog.getByRole("button", { name: "＋ 新規作成" }).click();
    await expect(dialog.getByRole("textbox", { name: "メッセージ本文", exact: true })).toHaveValue(message);
    await dialog.getByLabel("テンプレート名", { exact: true }).fill(name);
    await dialog.getByRole("button", { name: "テンプレートを保存" }).click();
    await expect(dialog.getByRole("status")).toContainText("保存しました");
    const all = await templates(page, "GET");
    ids.push(all.items.find(item => item.name === name)!.id);
    await expect(dialog.getByRole("button", { name: /を入力欄に入れる$/ })).toHaveCount(all.items.length);
    await dialog.getByRole("textbox", { name: "テンプレートを検索" }).fill("ご不明な点");
    await expect(dialog.getByRole("button", { name: /を入力欄に入れる$/ })).toHaveCount(1);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: testInfo.outputPath("templates-desktop.png") });
    await dialog.getByRole("button", { name: `${name}を入力欄に入れる`, exact: true }).click();
    await expect(dialog).not.toBeVisible(); await expect(composer).toHaveValue(`${message}\n${message}`); await expect(composer).toBeFocused();
    await composer.fill(""); await open.click(); await dialog.getByRole("button", { name: `${name}を編集`, exact: true }).click();
    await dialog.getByRole("textbox", { name: "メッセージ本文", exact: true }).fill("更新したお礼の文面です。\nよろしくお願いいたします。");
    await dialog.getByRole("button", { name: "テンプレートを保存" }).click(); await expect(dialog.getByRole("status")).toContainText("保存しました");
    await page.reload(); await open.click();
    await dialog.getByRole("textbox", { name: "テンプレートを検索" }).fill(name);
    await expect(dialog).toContainText("更新したお礼の文面です。");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("templates-mobile.png") });
    await dialog.getByRole("button", { name: `${name}を入力欄に入れる`, exact: true }).click();
    await expect(composer).toHaveValue("更新したお礼の文面です。\nよろしくお願いいたします。");
    await composer.scrollIntoViewIfNeeded(); await page.screenshot({ path: testInfo.outputPath("templates-composer-mobile.png") });
    expect(sendRequests).toHaveLength(0);
  } finally { for (const id of ids) await templates(page, "DELETE", { id }); }
});

test("overflow and duplicate errors preserve draft and form; inactive templates hidden", async ({ page, request }) => {
  await prepare(page, request);
  const composer = page.getByRole("textbox", { name: "送信するメッセージ" });
  const dialog = page.getByRole("dialog", { name: "文章テンプレート" });
  const name = `文字数確認-${randomUUID()}`;
  const response = await templates(page, "POST", { name, textContent: "お礼", sortOrder: 0 });
  expect(response.status).toBe(200);
  const item = response.item;
  try {
    await composer.fill("あ".repeat(4998)); await page.getByRole("button", { name: "📝 テンプレート", exact: true }).click();
    await dialog.getByRole("button", { name: `${name}を入力欄に入れる`, exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("5000文字を超えます"); await expect(composer).toHaveValue("あ".repeat(4998));
    await dialog.getByRole("button", { name: "＋ 新規作成" }).click();
    await dialog.getByLabel("テンプレート名", { exact: true }).fill(name); await dialog.getByRole("textbox", { name: "メッセージ本文", exact: true }).fill("保存できなくても残す本文");
    await dialog.getByRole("button", { name: "テンプレートを保存" }).click();
    await expect(dialog.getByRole("alert")).toContainText("別の名前"); await expect(dialog.getByRole("textbox", { name: "メッセージ本文", exact: true })).toHaveValue("保存できなくても残す本文");
    await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible();
    expect((await templates(page, "PATCH", { id: item.id, name, textContent: "お礼", sortOrder: 0, isActive: false })).status).toBe(200);
    await page.getByRole("button", { name: "📝 テンプレート", exact: true }).click();
    await expect(dialog.getByText("読み込み中…", { exact: true })).not.toBeVisible();
    await expect(dialog.getByRole("button", { name: `${name}を入力欄に入れる`, exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape"); await expect(composer).toHaveValue("あ".repeat(4998));
  } finally { await templates(page, "DELETE", { id: item.id }); }
});

test("failed loading can be retried without losing the message draft", async ({ page, request }) => {
  await prepare(page, request);
  const composer = page.getByRole("textbox", { name: "送信するメッセージ" });
  await composer.fill("消してはいけない下書き");
  await page.route("**/api/inbox/quick-replies", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "一時的に読み込めません。" }) }));
  await page.getByRole("button", { name: "📝 テンプレート", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "文章テンプレート" });
  await expect(dialog.getByRole("alert")).toContainText("一時的に読み込めません。");
  await page.unroute("**/api/inbox/quick-replies");
  await dialog.getByRole("button", { name: "一覧を再読み込み" }).click();
  await expect(dialog.getByRole("alert")).toHaveCount(0); await expect(dialog.getByText("読み込み中…", { exact: true })).not.toBeVisible();
  await page.keyboard.press("Escape"); await expect(composer).toHaveValue("消してはいけない下書き");
});
