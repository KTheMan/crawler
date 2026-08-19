import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ timeout: 180_000 });

async function openLinearPatternFromRibbon(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Linear Pattern", exact: true }).click();
  await expect(page.locator("#inspector h2")).toHaveText("Linear pattern");
  await expect(page.locator("#execute-advanced-feature")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/?qualificationReferencePart=1");
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
});

test("Enter in a valid advanced parameter applies the ready preview", async ({ page }) => {
  const before = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  await openLinearPatternFromRibbon(page);

  const count = page.locator('[data-operation-parameter="count"]');
  await count.fill("2");
  await count.press("Enter");

  await expect(page.locator("#operation-state")).toHaveText("Operation: Linear pattern committed", { timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum())).not.toBe(before);
  await expect(page.locator("#feature-browser")).toContainText("Linear pattern");
});

test("invalid Enter announces validation and never mutates durable state", async ({ page }) => {
  const before = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  await openLinearPatternFromRibbon(page);

  const count = page.locator('[data-operation-parameter="count"]');
  await count.fill("0");
  await count.press("Enter");

  await expect(count).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#operation-execution-status")).toContainText("Count:");
  await expect(page.locator("#execute-advanced-feature")).toBeDisabled();
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(before);
});

test("Escape from an advanced parameter cancels its preview and restores accepted geometry", async ({ page }) => {
  const beforeHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  const beforeBounds = await page.evaluate(() => window.__crawlerApp.geometryBounds());
  await openLinearPatternFromRibbon(page);

  const count = page.locator('[data-operation-parameter="count"]');
  await count.fill("4");
  await expect(page.locator("#execute-advanced-feature")).toBeEnabled({ timeout: 60_000 });
  await count.press("Escape");

  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "cancelled");
  await expect(page.locator("#execute-advanced-feature")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(beforeHash);
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.geometryBounds())).toEqual(beforeBounds);
});
