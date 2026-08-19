import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 120_000 });
test.use({ viewport: { width: 1280, height: 720 } });

async function openReady(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
}

async function openReferenceReady(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/?qualificationReferencePart=1");
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
}

test("Figma shell keeps the native 1280 by 720 geometry without overflow", async ({ page }) => {
  await openReady(page);
  const geometry = await page.evaluate(() => {
    const rect = (selector: string) => {
      const bounds = document.querySelector(selector)!.getBoundingClientRect();
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    };
    return {
      topbar: rect(".topbar"),
      tabs: rect(".workbench-tabs"),
      ribbon: rect(".commandbar"),
      workspace: rect(".workspace"),
      inspector: rect(".inspector-panel"),
      shellScrollWidth: document.querySelector<HTMLElement>(".shell")!.scrollWidth,
    };
  });
  expect(geometry.topbar).toEqual({ x: 0, y: 0, width: 1280, height: 30 });
  expect(geometry.tabs).toEqual({ x: 0, y: 30, width: 1280, height: 34 });
  expect(geometry.ribbon).toEqual({ x: 0, y: 64, width: 1280, height: 78 });
  expect(geometry.workspace.y).toBe(142);
  expect(geometry.inspector).toMatchObject({ x: 928, width: 352 });
  expect(geometry.shellScrollWidth).toBe(1280);
});

test("top menus escape the header and stay above legacy workspace overlays", async ({ page }) => {
  await openReady(page);
  await page.evaluate(() => {
    const tour = document.querySelector<HTMLElement>("#onboarding")!;
    tour.hidden = false;
    Object.assign(tour.style, { left: "32px", top: "24px", width: "300px", transform: "none" });
    const diagnostics = document.querySelector<HTMLElement>("#diagnostics")!;
    diagnostics.dataset.visible = "true";
    diagnostics.textContent = "WASM runtime error";
    Object.assign(diagnostics.style, { left: "32px", right: "auto", top: "24px", width: "300px" });
  });

  const fileMenu = page.locator(".app-menu").first();
  await fileMenu.locator("summary").click();
  const popover = fileMenu.locator(".menu-popover");
  await expect(popover).toBeVisible();
  await expect(page.locator(".topbar")).toHaveCSS("overflow", "visible");

  const layers = await page.evaluate(() => ({
    topbar: Number.parseInt(getComputedStyle(document.querySelector<HTMLElement>(".topbar")!).zIndex, 10),
    tour: Number.parseInt(getComputedStyle(document.querySelector<HTMLElement>("#onboarding")!).zIndex, 10),
    diagnostics: Number.parseInt(getComputedStyle(document.querySelector<HTMLElement>("#diagnostics")!).zIndex, 10),
  }));
  expect(layers.topbar).toBeGreaterThan(layers.tour);
  expect(layers.topbar).toBeGreaterThan(layers.diagnostics);

  const newCommand = popover.getByRole("menuitem", { name: /New/ });
  const commandBounds = await newCommand.boundingBox();
  if (!commandBounds) throw new Error("File menu command has no rendered bounds");
  const menuOwnsTopPoint = await page.evaluate(({ x, y }) =>
    Boolean(document.elementFromPoint(x, y)?.closest(".menu-popover")),
  { x: commandBounds.x + commandBounds.width / 2, y: commandBounds.y + commandBounds.height / 2 });
  expect(menuOwnsTopPoint).toBe(true);

  const topbarBounds = await page.locator(".topbar").boundingBox();
  if (!topbarBounds) throw new Error("Topbar has no rendered bounds");
  const visibleMenus = page.locator(".app-menu:visible");
  for (let index = 0; index < await visibleMenus.count(); index += 1) {
    const menu = visibleMenus.nth(index);
    await menu.locator("summary").click();
    const menuBounds = await menu.locator(".menu-popover").boundingBox();
    expect(menuBounds?.height ?? 0).toBeGreaterThan(0);
    expect(menuBounds?.y ?? 0).toBeGreaterThanOrEqual(topbarBounds.y + topbarBounds.height);
  }
});

test("timeline pips are opaque and the view cube is anchored to the viewport corner", async ({ page }) => {
  await openReady(page);
  const pipStyles = await page.locator(".timeline-item").evaluateAll((items) => items.map((item) => ({
    background: getComputedStyle(item).backgroundColor,
    opacity: getComputedStyle(item).opacity,
  })));
  expect(pipStyles.every((style) => style.opacity === "1" && !style.background.endsWith(", 0)"))).toBe(true);

  const viewport = await page.getByTestId("viewport-region").boundingBox();
  const cube = await page.locator("#view-cube").boundingBox();
  if (!viewport || !cube) throw new Error("Viewport or view cube has no rendered bounds");
  expect(cube.x - viewport.x).toBeCloseTo(8, 0);
  expect(viewport.y + viewport.height - cube.y - cube.height).toBeCloseTo(8, 0);
});

test("workbench ribbons expose dropdown pinning and omit future controls", async ({ page }) => {
  await openReady(page);
  await page.locator('[data-workbench="Sketcher"]').click();
  await expect(page.locator('[data-workbench-ribbon="Sketcher"]')).toBeVisible();
  await expect(page.locator('[data-workbench-ribbon="Sketcher"] .finish-sketch')).toBeHidden();

  await page.locator('[data-workbench="Part Design"]').click();
  const unavailable = page.locator('[data-workbench-ribbon="Part Design"] [data-ribbon-tool="box-select"]');
  await expect(unavailable).toHaveCount(0);

  await page.locator('[data-workbench-ribbon="Part Design"] [data-ribbon-flyout="sketch"]').click();
  const panel = page.locator('[data-workbench-ribbon="Part Design"] [data-ribbon-flyout-panel="sketch"]');
  await expect(panel).toBeVisible();
  await expect(panel.locator('[data-ribbon-run="rectangle"]')).toBeVisible();
  await expect(panel.locator('[data-ribbon-pin]')).toHaveCount(2);
  await expect(panel.locator('[data-ribbon-pin="rectangle"]')).toHaveAccessibleName("Pin Rectangle to toolbar");

  await page.locator("#toolbar-customize").click();
  const customize = page.getByRole("dialog", { name: "Customize toolbar" });
  await expect(customize).toBeVisible();
  await expect(customize.getByRole("button", { name: /Hide New Sketch in toolbar/ })).toBeVisible();
  await expect(customize.getByRole("button", { name: "Restore defaults" })).toBeVisible();
});

test("dynamic inspector tabs and parameter editor expose the complete designed surfaces", async ({ page }) => {
  await openReferenceReady(page);
  await page.locator('[data-inspector-tab="constraints"]').click();
  await expect(page.locator("#inspector")).toContainText("Sketch constraint system");
  await expect(page.locator(".constraint-summary")).toContainText("Solver");

  await page.locator('[data-inspector-tab="appearance"]').click();
  await expect(page.locator("#inspector")).toContainText("Material");
  await expect(page.locator("#inspector")).toContainText("Opacity");
  const density = page.locator(".inspector-unavailable-row").filter({ hasText: "Density" });
  await expect(density).toContainText("Unavailable");
  await expect(density).not.toHaveAttribute("role", "button");

  await page.locator(".parameters-shortcut").click();
  const dialog = page.getByRole("dialog", { name: "Parameters" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".parameters-empty")).toContainText("No defined parameters");
  await expect(page.locator("#parameters-filter")).toBeVisible();
});

test("every disabled feature advertises its exact coming-soon hover copy", async ({ page }) => {
  await openReady(page);
  const missing = await page.locator('[aria-disabled="true"]').evaluateAll((elements) => elements
    .filter((element) => element instanceof HTMLElement && element.offsetParent !== null)
    .filter((element) => !element.getAttribute("data-coming-soon")?.endsWith(" - coming soon!"))
    .map((element) => element.textContent?.trim()));
  expect(missing).toEqual([]);
});
