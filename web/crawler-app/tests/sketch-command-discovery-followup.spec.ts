import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ timeout: 120_000 });

test.beforeEach(async ({ page }) => {
  await page.goto("/?qualificationReferencePart=1");
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
});

async function openResolvedSketch(page: Page): Promise<void> {
  await page.locator("#edit-sketch").click();
  if (await page.evaluate(() => window.__crawlerApp.sketchSupportSelection().active)) {
    await page.evaluate(() => window.__crawlerApp.chooseOriginSketchSupport("xy"));
  }
  await expect(page.locator('[data-workbench-ribbon="Sketcher"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.sketchSupportSelection().active)).toBe(false);
}

async function addAndSelectLine(page: Page): Promise<void> {
  await page.evaluate(async () => window.__crawlerApp.applySketchCommands([{
    kind: "add_geometry",
    entity: {
      id: "discovery:line",
      geometry: { kind: "line", start: { x_nm: -12_000_000, y_nm: -4_000_000 }, end: { x_nm: 14_000_000, y_nm: 9_000_000 } },
    },
  }]));
  await page.locator("#sketch-select-tool").click();
  const line = page.getByLabel("Editable sketch geometry").locator('[data-sketch-geometry="discovery:line"]');
  await expect(line).toHaveCount(1);
  await line.click({ force: true });
  await expect(page.locator("#selection-readout")).toContainText("1 entity");
}

test("Sketch menu exposes constraints and applies Horizontal through a real menu click", async ({ page }) => {
  await openResolvedSketch(page);
  await addAndSelectLine(page);

  const sketchMenu = page.locator(".app-menu").filter({ hasText: /^Sketch/ });
  await sketchMenu.locator("summary").click();
  for (const label of ["Coincident", "Horizontal", "Perpendicular", "Concentric", "Point On Object", "Smart Dimension"]) {
    await expect(sketchMenu.getByRole("menuitem", { name: label, exact: true })).toBeVisible();
  }
  const horizontal = sketchMenu.getByRole("menuitem", { name: "Horizontal", exact: true });
  await expect(horizontal).toHaveAttribute("aria-disabled", "false");
  await horizontal.click();

  await expect(sketchMenu).not.toHaveAttribute("open", "");
  await expect.poll(() => page.evaluate(() => Object.values(window.__crawlerApp.sketchDraft()?.constraints ?? {}).some((constraint) => constraint.kind === "horizontal"))).toBe(true);
  await expect(page.locator('[data-workbench-ribbon="Sketcher"] [data-ribbon-tool="horizontal"]')).toHaveAttribute("aria-pressed", "true");
});

test("Sketch menu Smart Dimension enters the existing contextual dimension state", async ({ page }) => {
  await openResolvedSketch(page);
  await addAndSelectLine(page);

  const sketchMenu = page.locator(".app-menu").filter({ hasText: /^Sketch/ });
  await sketchMenu.locator("summary").click();
  await sketchMenu.getByRole("menuitem", { name: "Smart Dimension", exact: true }).click();

  await expect(page.locator("#smart-sketch-dimension")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#active-tool-phase")).toContainText(/Ready|Waiting for input/);
  await expect(page.locator("#operation-state")).toContainText("Smart Dimension");
});

test("command search discovers Sketcher surfaces and updates contextual constraint availability", async ({ page }) => {
  await page.keyboard.press("Control+k");
  const results = page.locator("#command-results");
  const labels = await results.getByRole("option").locator(":scope > span").allTextContents();
  for (const expected of ["Point", "Fit Spline", "Offset", "Concentric", "Smart Dimension"]) expect(labels).toContain(expected);

  await page.locator("#command-query").fill("parallel");
  const unavailableParallel = results.getByRole("option", { name: /^Parallel/ });
  await expect(unavailableParallel).toBeDisabled();
  await expect(unavailableParallel).toContainText("Start or edit a sketch to use constraints");
  await page.keyboard.press("Escape");

  await openResolvedSketch(page);
  await page.keyboard.press("Control+k");
  await page.locator("#command-query").fill("parallel");
  const availableParallel = results.getByRole("option", { name: /^Parallel/ });
  await expect(availableParallel).toBeEnabled();
  await availableParallel.click();

  await expect(page.locator('[data-workbench-ribbon="Sketcher"] [data-ribbon-tool="parallel"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#active-tool-phase")).toContainText("Waiting for input");
  await expect(page.locator("#operation-state")).toContainText("Parallel");
});
