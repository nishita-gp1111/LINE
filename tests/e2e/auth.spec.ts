import { expect, test } from "@playwright/test";

test("redirects unauthenticated admin visitors to login", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login$/);
});

test("logs in through mock mode", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill("owner@example.local");
  await page.getByRole("button", { name: "ログイン" }).click();

  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "管理画面" })).toBeVisible();
});
