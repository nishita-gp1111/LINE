import type { Page } from "@playwright/test";

// Advance the browser's real production timers, not an alternate polling config.
export async function advancePoll(page: Page, path = "/api/inbox/sync", milliseconds = 60_000) {
  const response = page.waitForResponse(result => new URL(result.url()).pathname === path);
  await page.clock.fastForward(milliseconds);
  await response;
}
