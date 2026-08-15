import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/?qualificationReferencePart=1");
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
});

test("command search exposes the complete enabled alpha catalog", async ({ page }) => {
  await page.keyboard.press("Control+k");
  const operationCommands = page.locator("#command-results [data-operation-id]:not([data-operation-id=''])");
  await expect(operationCommands).toHaveCount(23);
  const labels = await operationCommands.locator(":scope > span").allTextContents();
  expect(labels.sort()).toEqual([
    "Line", "Circle", "Arc", "Rectangle", "Trim", "Construction geometry", "Extrude", "Revolve", "Loft", "Sweep", "Extrude cut", "Revolve cut", "Draft",
    "Combine", "Subtract", "Intersect", "Fillet", "Chamfer", "Mirror", "Transform",
    "Linear pattern", "Circular pattern", "Shell",
  ].sort());

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
  await expect(page.locator("#preview-advanced-feature")).toBeVisible();
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
  await expect(page.locator('[data-input-slot="profile"]')).toContainText("sketch_profile · 1 required");
  await expect(page.locator('[data-input-slot="axis"]')).toContainText("axis or edge · 1 required");
  await expect(page.locator('[data-operation-parameter="angle"]')).toHaveAttribute("type", "number");
  await expect(page.locator("#inspector .operation-fields")).toContainText("Angle · degrees");
  await expect(page.locator("#inspector")).toContainText("non-mutating geometry preview");
});

test("catalog-backed Extrude retains preview focus behavior", async ({ page }) => {
  await page.keyboard.press("Control+k");
  await page.locator("#command-query").fill("extrude");
  await page.keyboard.press("Enter");
  await expect(page.locator("#pad-length")).toBeFocused();
  await expect(page.locator("#operation-state")).toContainText("Extrude preview");
});

test("rendered transform contracts expose only qualified selection kinds", async ({ page }) => {
  const cases = [
    ["mirror", "crawler.part.mirror", "plane", "plane · 1 required"],
    ["linear pattern", "crawler.part.pattern.linear", "direction", "axis · 1 required"],
    ["circular pattern", "crawler.part.pattern.circular", "axis", "axis · 1 required"],
    ["shell", "crawler.part.shell", "remove_faces", "face · 1 required"],
  ] as const;
  for (const [query, operationId, slot, expected] of cases) {
    await page.keyboard.press("Control+k");
    await page.locator("#command-query").fill(query);
    await page.locator(`[data-operation-id="${operationId}"]`).click();
    await expect(page.locator(`[data-input-slot="${slot}"]`)).toContainText(expected);
  }
});
