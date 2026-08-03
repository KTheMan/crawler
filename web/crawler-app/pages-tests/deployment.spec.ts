import { expect, test } from "@playwright/test";

test("GitHub Pages base path starts the complete browser/WASM application", async ({ page }) => {
  await page.goto("./");
  await page.waitForFunction(
    () => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"),
    undefined,
    { timeout: 120_000 },
  );
  expect(new URL(page.url()).pathname).toBe("/crawler/");
  expect(await page.evaluate(() => window.__crawlerApp.transferredBytes())).toBeGreaterThan(0);

  await page.reload();
  await page.waitForFunction(
    () => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"),
    undefined,
    { timeout: 120_000 },
  );
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.pwaStatus().controlled), { timeout: 30_000 }).toBe(true);
});
