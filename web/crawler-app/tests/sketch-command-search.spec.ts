import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ timeout: 120_000 });

test.beforeEach(async ({ page }) => {
  await page.goto("/?qualificationReferencePart=1");
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
});

async function openSketchCommand(page: Page, query: string, tool: string, label: string): Promise<void> {
  await page.locator("#edit-sketch").focus();
  await page.keyboard.press("Control+k");
  await page.locator("#command-query").fill(query);
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-workbench-ribbon="Sketcher"]')).toBeVisible();
  await expect(page.getByLabel("Sketch tool properties")).toBeVisible();
  if (await page.evaluate(() => window.__crawlerApp.sketchSupportSelection().active)) {
    // Construction is a creation property rather than a placement tool, so it
    // remains visibly active while the actual sketch support is being chosen.
    if (tool !== "construction") {
      await expect(page.locator(`[data-sketch-tool="${tool}"]`)).toHaveAttribute("aria-pressed", "false");
    }
    await expect(page.locator("#operation-state")).toHaveText("Operation: Choose sketch plane");
    await page.evaluate(() => window.__crawlerApp.chooseOriginSketchSupport("xy"));
  }
  await expect(page.locator(`[data-sketch-tool="${tool}"]`)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(`[data-sketch-tool="${tool}"]`)).toBeFocused();
  await expect(page.locator("#operation-state")).toContainText(`Operation: ${label}`);
  await expect(page.locator("#inspector")).not.toContainText("Execution is not connected");
}

for (const [query, tool, label] of [
  ["line", "line", "Line"],
  ["circle", "circle", "Circle"],
  ["arc", "arc", "Arc"],
  ["trim", "trim", "Trim"],
  ["construction geometry", "construction", "Construction geometry"],
] as const) {
  test(`${label} command search starts sketch edit with the requested tool active`, async ({ page }) => {
    await openSketchCommand(page, query, tool, label);
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-workbench-ribbon="Sketcher"]')).toBeVisible();
    await expect(page.locator("#inspector-tool-tab")).toHaveText("Select");
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-workbench-ribbon="Sketcher"]')).toBeVisible();
    await page.getByRole("button", { name: "Discard sketch draft" }).click();
    await expect(page.locator('[data-workbench-ribbon="Sketcher"]')).toBeHidden();
  });
}

test("Line command preserves pointer input and keyboard commit lifecycle", async ({ page }) => {
  await openSketchCommand(page, "line", "line", "Line");
  if (await page.evaluate(() => window.__crawlerApp.sketchSupportSelection().active)) {
    await page.evaluate(() => window.__crawlerApp.chooseOriginSketchSupport("xy"));
  }
  const canvas = page.getByLabel("3D viewport");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const x = Math.max(650, Math.round(box!.width * 0.58));
  const y = Math.max(320, Math.round(box!.height * 0.62));
  await canvas.click({ position: { x, y } });
  await canvas.click({ position: { x: Math.min(box!.width - 80, x + 100), y } });
  await expect(page.getByLabel("Editable sketch geometry").locator(".sketch-entity")).toHaveCount(1, { timeout: 60_000 });
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-workbench-ribbon="Sketcher"]')).toBeVisible();
  await expect(page.locator("#active-tool-phase")).toContainText("ready to use again");
  await page.locator("#finish-sketch-ribbon").click();
  await expect(page.locator('[data-workbench-ribbon="Sketcher"]')).toBeHidden({ timeout: 60_000 });
  await expect(page.locator("#operation-state")).toHaveText("Operation: Line committed");
  await expect(page.locator("#edit-sketch")).toBeFocused();
});
