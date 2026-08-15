import { expect, test } from "@playwright/test";

test("view-cube timing uses the supported timer without changing animation behavior", async ({ page }) => {
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "warning") warnings.push(message.text());
  });

  await page.goto("/?qualificationReferencePart=1");
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));

  const cube = page.locator("#view-cube > div");
  await expect(cube).toBeVisible();
  const bounds = await cube.boundingBox();
  if (!bounds) throw new Error("view cube bounds are unavailable");
  const before = await page.evaluate(() => window.__crawlerApp.cameraPosition());

  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height * 0.18);
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.cameraPosition()), { timeout: 10_000 }).not.toEqual(before);

  expect(warnings.filter((warning) => /THREE\.Clock.*deprecated/i.test(warning))).toEqual([]);
});
