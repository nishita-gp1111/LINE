import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login"); await page.getByLabel("メールアドレス").fill("owner@example.local");
  await page.getByRole("button", { name: "ログイン", exact: true }).click(); await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/tags"); await expect(page.getByRole("heading", { name: "タグ管理", exact: true })).toBeVisible();
}
async function create(page: Page, name: string) {
  await page.getByRole("textbox", { name: "新しいタグ名" }).fill(name);
  await page.getByRole("button", { name: "作成", exact: true }).click();
  await expect(page.getByRole("button", { name: `「${name}」を削除`, exact: true })).toBeVisible();
}
test("tag delete confirmation, cancellation, deletion and persistence", async ({ page }, info) => {
  await login(page); const name = `削除テスト-${randomUUID().slice(0,8)}`; await create(page, name);
  const target = page.getByRole("button", { name: `「${name}」を削除`, exact: true });
  await target.click(); const dialog = page.getByRole("dialog", { name: "タグを削除しますか？" });
  await expect(dialog.getByText("0人の顧客", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "タグを削除", exact: true })).toBeDisabled();
  await page.screenshot({ path: info.outputPath("tag-delete-desktop.png") });
  await dialog.getByRole("button", { name: "キャンセル" }).click(); await expect(target).toBeVisible();
  await target.click(); await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "タグを削除", exact: true }).click();
  await expect(dialog).not.toBeVisible(); await expect(target).not.toBeVisible();
  await expect(page.getByRole("status")).toContainText(`「${name}」を削除しました`);
  await page.reload(); await expect(target).not.toBeVisible();
  await create(page, name); // A new tag with the old name is allowed.
});
test("used acquisition tags stay protected on mobile", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 }); await login(page);
  const name = "HP経由";
  if (!await page.getByRole("button", { name: `「${name}」を削除`, exact: true }).isVisible()) await create(page, name);
  await page.getByRole("button", { name: `「${name}」を削除`, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("設定で使用中のため削除できません", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "タグを削除", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("link", { name: "流入経路URLの自動付与タグを確認 →" })).toHaveAttribute("href", "/admin/acquisition");
  const bounds = await dialog.boundingBox(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath("tag-delete-mobile-protected.png") });
  await dialog.getByRole("button", { name: "閉じる" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test("a failed preflight cannot enable deletion", async ({ page }) => {
  await login(page); const name = `通信テスト-${randomUUID().slice(0,8)}`; await create(page, name);
  await page.route("**/api/tags/delete?*", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "利用状況を確認できませんでした。" }) }));
  await page.getByRole("button", { name: `「${name}」を削除`, exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("確認できません");
  await expect(page.getByRole("dialog").getByRole("button", { name: "タグを削除", exact: true })).toHaveCount(0);
});
