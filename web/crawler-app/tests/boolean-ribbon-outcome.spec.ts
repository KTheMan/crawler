import { expect, test } from "@playwright/test";

test("Combine operation and its flyout have distinct actions and invalid input stays recoverable", async ({ page }) => {
  await page.goto("/?qualificationReferencePart=1");
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));

  const executeCombine = page.getByRole("button", { name: "Combine", exact: true });
  const moreCombine = page.getByRole("button", { name: "More Combine operations", exact: true });
  await expect(executeCombine).toHaveCount(1);
  await expect(moreCombine).toHaveCount(1);

  await moreCombine.click();
  await expect(page.locator('[data-ribbon-flyout-panel="boolean"]')).toBeVisible();
  await moreCombine.click();
  await expect(page.locator('[data-ribbon-flyout-panel="boolean"]')).toBeHidden();

  await executeCombine.click();
  await expect(page.locator("#execute-advanced-feature")).toBeVisible();
  await expect(page.locator("#execute-advanced-feature")).toBeDisabled();
  await expect(page.locator("#operation-execution-status")).toContainText("require at least one tool body", { timeout: 30_000 });
  expect(await page.evaluate(() => window.__crawlerApp.safeMode())).toBe(false);
});
