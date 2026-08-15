import { expect, test } from "@playwright/test";

test("watchdog fixture deliberately blocks", async ({ page }) => {
  test.skip(process.env.SKETCH_PERF_WATCHDOG_FIXTURE !== "block");
  await page.goto("/");
  await page.evaluate(() => new Promise<void>(() => undefined));
});

test("watchdog fixture later child still runs", async ({ page }) => {
  test.skip(process.env.SKETCH_PERF_WATCHDOG_FIXTURE !== "continue");
  await page.goto("/");
  await expect(page).toHaveTitle(/Crawler Part Design/);
});
