import { expect, test } from "@playwright/test";

test("New Sketch chooses support before arming a drawing tool", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));

  await page.locator("#edit-sketch").click();
  await expect(page.getByLabel("Sketch plane selection")).toHaveAttribute("data-selecting", "true");
  await expect(page.locator("#inspector-tool-tab")).toHaveText("Support");
  await expect(page.locator('[data-sketch-tool="line"]')).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#active-tool-finish")).toHaveCount(0);
  await expect(page.locator("#finish-sketch-ribbon")).toBeHidden();
  await expect(page.locator("#active-tool-cancel")).toHaveText("Cancel");

  await page.locator('[data-origin-plane-id="origin-plane:xy"]').click();
  await expect(page.getByLabel("Sketch plane selection")).toHaveAttribute("data-selecting", "false");
  await expect(page.locator("#inspector-tool-tab")).toHaveText("Select");
  await expect(page.locator("#sketch-select-tool")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-sketch-tool="line"]')).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#active-tool-finish")).toBeVisible();

  await page.locator('[data-sketch-tool="line"]').click();
  await expect(page.locator('[data-sketch-tool="line"]')).toHaveAttribute("aria-pressed", "true");
});
