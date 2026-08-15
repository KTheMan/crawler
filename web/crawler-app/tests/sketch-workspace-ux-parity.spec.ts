import { expect, test, type Page } from "@playwright/test";

test.setTimeout(120_000);

async function ready(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
}

test("sketch support, tool, selection, construction, and disabled guidance share one visible state", async ({ page }) => {
  await ready(page);
  await page.locator("#edit-sketch").click();

  await expect(page.getByLabel("Sketch plane selection")).toHaveAttribute("data-selecting", "true");
  await expect(page.locator('[data-sketch-tool="line"]').first()).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#operation-state")).toHaveText("Operation: Choose sketch plane");

  await page.locator('[data-origin-plane-id="origin-plane:xy"]').click();
  await expect(page.getByLabel("Sketch plane selection")).toContainText("XY origin plane");
  await expect(page.locator('[data-sketch-tool="line"]').first()).toHaveAttribute("aria-pressed", "true");

  const canvas = page.getByLabel("3D viewport");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("viewport has no bounds");
  await canvas.click({ position: { x: box.width * .40, y: box.height * .52 } });
  await canvas.click({ position: { x: box.width * .58, y: box.height * .46 } });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");

  await expect(page.locator("#sketch-select-tool")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#operation-state")).toHaveText("Operation: Select · no active sketch tool");
  await expect(page.locator("#inspector-tool-tab")).toHaveText("Select");

  const overlay = page.getByLabel("Editable sketch geometry");
  const visibleLine = overlay.locator('.sketch-entity[data-sketch-geometry]').first();
  const hitLine = overlay.locator('.sketch-entity-hit[data-sketch-hit-geometry]').first();
  await expect(hitLine).toHaveCount(1);
  expect(await hitLine.evaluate((element) => getComputedStyle(element).strokeWidth)).toBe("12px");
  await page.keyboard.press("Escape");
  await expect(page.locator("#selection-readout")).toHaveText("Selection: none");
  await visibleLine.hover({ force: true });
  await expect(visibleLine).toHaveClass(/preselected/);
  await visibleLine.click({ force: true });

  await expect(page.locator("#selection-readout")).toContainText("1 entity");
  await expect(page.getByLabel("Sketch selection properties")).toContainText("line");
  await expect(page.locator("#sketch-selection-construction")).toHaveValue("standard");
  await page.locator("#sketch-selection-construction").selectOption("construction");
  await expect(visibleLine).toHaveClass(/construction/);
  await expect(page.locator("#sketch-selection-construction")).toHaveValue("construction");
  await expect(page.locator("#active-tool-phase")).toHaveText("Ready");

  await page.locator('[data-ribbon-flyout="dimension"]').click();
  await expect(page.locator('[data-ribbon-tool-row="smart-sketch-dimension"]')).toBeVisible();
  await expect(page.locator('[data-ribbon-tool-row="radius"]')).toHaveCount(0);

  await page.locator("#sketch-selection-filter-toggle").click();
  await expect(page.locator("#sketch-selection-filter-toggle")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator('[data-sketch-filter="points"]')).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.locator("#selection-readout")).toHaveText("Selection: none");
  await page.locator("#finish-sketch-ribbon").click();
  await expect(page.locator('[data-workbench-ribbon="Sketcher"]')).toBeHidden({ timeout: 60_000 });
  await expect(page.locator("#finish-sketch-ribbon")).toBeHidden();
});

test("Smart Dimension keeps one invocation active while normalizing its visible value", async ({ page }) => {
  await ready(page);
  await page.locator("#edit-sketch").click();
  await page.evaluate(() => window.__crawlerApp.chooseOriginSketchSupport("xy"));
  const canvas = page.getByLabel("3D viewport");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("viewport has no bounds");
  await canvas.click({ position: { x: box.width * .42, y: box.height * .55 } });
  await canvas.click({ position: { x: box.width * .59, y: box.height * .49 } });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await page.getByLabel("Editable sketch geometry").locator('.sketch-entity[data-sketch-geometry]').first().click({ force: true });
  await page.locator("#smart-sketch-dimension").click();
  await expect(page.locator("#operation-state")).toContainText("Smart Dimension");
  await expect(page.getByLabel("Dimension editor")).toBeVisible();
  await expect(page.locator("#inspector #active-tool-constraint-value")).toHaveCount(0);
  const value = await page.locator("#active-tool-constraint-value").inputValue();
  expect(value).toMatch(/^\d+(?:\.\d{1,3})? mm$/);
  await page.keyboard.press("Escape");
  await expect(page.locator("#smart-sketch-dimension")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator("#sketch-select-tool")).toHaveAttribute("aria-pressed", "true");
});
