import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
});

test("command search exposes the complete enabled alpha catalog", async ({ page }) => {
  await page.keyboard.press("Control+k");
  const operationCommands = page.locator("#command-results [data-operation-id]:not([data-operation-id=''])");
  await expect(operationCommands).toHaveCount(18);
  await expect(operationCommands).toContainText([
    "Line", "Circle", "Arc", "Rectangle", "Trim", "Construction geometry", "Extrude", "Revolve",
    "Boolean union", "Boolean cut", "Boolean intersect", "Fillet", "Chamfer", "Mirror", "Transform",
    "Linear pattern", "Circular pattern", "Shell",
  ]);

  await page.locator("#command-query").fill("shell");
  const shell = page.locator('[data-operation-id="crawler.part.shell"]');
  await expect(shell).toBeEnabled();
  await expect(shell).toContainText("Shell");
});

test("Transform exposes one body source and exact signed XYZ length fields", async ({ page }) => {
  await page.keyboard.press("Control+k");
  await page.locator("#command-query").fill("transform");
  await expect(page.locator('[data-operation-id="crawler.part.transform"]')).toHaveClass(/active/);
  await page.keyboard.press("Enter");
  await expect(page.locator("#inspector h2")).toHaveText("Transform");
  await expect(page.locator('[data-input-slot="source"]')).toContainText("body · 1 required");
  for (const key of ["x", "y", "z"]) {
    await expect(page.locator(`[data-operation-parameter="${key}"]`)).toHaveAttribute("type", "number");
  }
  await expect(page.locator('[data-operation-parameter="z"]')).toHaveValue("10");
  await expect(page.locator("#execute-advanced-feature")).toBeEnabled();
});

test("catalog commands render typed parameters, selection requirements, and lifecycle metadata", async ({ page }) => {
  await expect(page.locator("#start-rectangle")).toHaveText("Rectangle");
  await expect(page.locator("#start-pad")).toHaveText("Extrude");
  await expect(page.locator(".dimension-control").filter({ has: page.locator("#pad-length") })).toContainText("Distance");
  await page.keyboard.press("Control+k");
  await page.locator("#command-query").fill("revolve");
  await page.keyboard.press("Enter");

  await expect(page.locator("#command-search")).toBeHidden();
  await expect(page.locator("#inspector h2")).toHaveText("Revolve");
  await expect(page.locator("#inspector .operation-lifecycle")).toContainText("alpha · Preview · Editable · Suppressible");
  await expect(page.locator('[data-input-slot="profile"]')).toContainText("sketch_profile or face · 1 required");
  await expect(page.locator('[data-input-slot="axis"]')).toContainText("axis or edge · 1 required");
  await expect(page.locator('[data-operation-parameter="angle"]')).toHaveAttribute("type", "number");
  await expect(page.locator("#inspector .operation-fields")).toContainText("Angle · degrees");
  await expect(page.locator("#inspector")).toContainText("Schema ready");
});

test("catalog-backed Rectangle and Extrude commands retain preview focus behavior", async ({ page }) => {
  await page.keyboard.press("Control+k");
  await page.locator("#command-query").fill("rectangle");
  await page.keyboard.press("Enter");
  await expect(page.locator("#part-width")).toBeFocused();
  await expect(page.locator("#operation-state")).toContainText("Rectangle preview");
  await page.keyboard.press("Escape");

  await page.keyboard.press("Control+k");
  await page.locator("#command-query").fill("extrude");
  await page.keyboard.press("Enter");
  await expect(page.locator("#pad-length")).toBeFocused();
  await expect(page.locator("#operation-state")).toContainText("Extrude preview");
});
