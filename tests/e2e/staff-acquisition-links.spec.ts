import { expect, test } from "@playwright/test";

const staff = [["meeting-imafuku", "今福"], ["meeting-shimizu", "志水"], ["meeting-uoi", "魚井"], ["meeting-nishita", "西田"]];

test("four dedicated links are copyable while the existing shared links remain available", async ({ page, context, baseURL }, testInfo) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill("owner@example.local");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/acquisition");
  for (const [slug, name] of staff) {
    const card = page.getByRole("article", { name: `${name}さん専用URL` });
    await expect(card.getByText(`固定担当：${name}`, { exact: true })).toBeVisible();
    await expect(card.getByRole("link", { name: "開く", exact: true })).toHaveAttribute("href", `${baseURL}/add/${slug}`);
    await card.getByRole("button", { name: `${name}さん用URLをコピー` }).click();
    await expect(card.getByText("コピーしました ✓", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${baseURL}/add/${slug}`);
  }
  for (const slug of ["meeting", "survey", "hp"]) {
    await expect(page.locator(`a[href="${baseURL}/add/${slug}"]`)).toHaveCount(1);
  }
  await page.screenshot({ path: testInfo.outputPath("staff-links-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("staff-links-mobile.png"), fullPage: true });
});

test("each public landing page keeps its staff source in the LINE link and desktop QR", async ({ page }, testInfo) => {
  // Only inspect links; never open LINE or send messages in browser tests.
  for (const [slug, name] of staff) {
    await page.setViewportSize({ width: 1280, height: 900 });
    expect((await page.goto(`/add/${slug}`))?.status()).toBe(200);
    await expect(page.getByText(`${name}からのご案内`, { exact: true })).toBeVisible();
    const href = await page.getByRole("link", { name: "LINEアプリを開く", exact: true }).getAttribute("href");
    expect(decodeURIComponent(href || "")).toContain(`面談経由（${name}担当）で友だち追加しました`);
    await expect(page.locator("[data-qr-destination]")).toHaveAttribute("data-qr-destination", href!);
    await expect(page.getByRole("complementary", { name: "パソコン用QRコード" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${slug}-desktop.png`), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("link", { name: "LINEアプリを開く", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.locator("[data-qr-destination]")).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath(`${slug}-mobile.png`), fullPage: true });
  }
  expect((await page.goto("/add/meeting-arbitrary"))?.status()).toBe(404);
});
