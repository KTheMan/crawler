import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 120_000 });

test.beforeEach(async ({ page }) => {
  await page.goto("/?qualificationReferencePart=1");
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
});

test("Command Search groups contextual results and promotes recent commands", async ({ page }) => {
  await page.keyboard.press("Control+k");
  const results = page.locator("#command-results");
  await expect(results.getByRole("group", { name: "Suggested" })).toBeVisible();
  await expect(results.getByRole("group", { name: "Part Design commands" })).toBeVisible();
  await expect(page.locator("#command-result-status")).toContainText(/results in \d+ groups/);

  const before = await results.getByRole("group", { name: "Suggested" }).getByRole("option").allTextContents();
  await results.getByRole("option", { name: /^Save part/ }).click();
  await page.keyboard.press("Control+k");
  const suggested = results.getByRole("group", { name: "Suggested" });
  const after = await suggested.getByRole("option").allTextContents();
  expect(after.findIndex((label) => label.startsWith("Save part"))).toBeLessThan(before.findIndex((label) => label.startsWith("Save part")));
  const activeId = await page.locator("#command-query").getAttribute("aria-activedescendant");
  await expect(page.locator(`#${activeId}`)).toHaveAttribute("aria-selected", "true");
});

test("ribbon dropdowns expose persistent pinning alongside customization and contextual pinning", async ({ page }) => {
  await page.locator('[data-ribbon-flyout="sketch"]').click();
  const flyout = page.locator('[data-ribbon-flyout-panel="sketch"]');
  await expect(flyout).toBeVisible();
  await expect(flyout.locator("[data-ribbon-pin]")).toHaveCount(2);
  expect(await flyout.locator(".ribbon-flyout-row").evaluateAll((rows) => rows.every((row) => row.querySelectorAll("button").length === 2))).toBe(true);

  const ribbonRectangle = page.locator('[data-workbench-ribbon="Part Design"] [data-ribbon-tool="rectangle"]');
  const dropdownPin = flyout.locator('[data-ribbon-pin="rectangle"]');
  await expect(dropdownPin).toHaveAccessibleName("Pin Rectangle to toolbar");
  await expect(dropdownPin).toHaveAttribute("aria-pressed", "false");
  await dropdownPin.click();
  await expect(ribbonRectangle).toHaveClass(/pinned/);
  await expect(dropdownPin).toHaveAccessibleName("Unpin Rectangle from toolbar");

  await page.reload();
  await expect(ribbonRectangle).toHaveClass(/pinned/);
  await page.locator('[data-ribbon-flyout="sketch"]').click();
  const persistedDropdownPin = page.locator('[data-ribbon-flyout-panel="sketch"] [data-ribbon-pin="rectangle"]');
  await expect(persistedDropdownPin).toHaveAttribute("aria-pressed", "true");
  await persistedDropdownPin.click();
  await expect(ribbonRectangle).not.toHaveClass(/pinned/);

  await page.locator("#toolbar-customize").click();
  const panel = page.getByRole("dialog", { name: "Customize toolbar" });
  await expect(panel).toBeVisible();
  await expect(page.locator(".commandbar")).toHaveAttribute("data-customizing", "");
  const rectangle = panel.locator('[data-toolbar-visibility="rectangle"]');
  await expect(rectangle).toHaveAccessibleName("Show Rectangle in toolbar");
  await rectangle.click();
  await expect(page.locator('[data-workbench-ribbon="Part Design"] [data-ribbon-tool="rectangle"]')).toHaveClass(/pinned/);
  await expect(rectangle).toHaveAttribute("aria-pressed", "true");
  await expect(rectangle).toHaveAccessibleName("Hide Rectangle in toolbar");
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page.locator("#toolbar-customize")).toBeFocused();

  await ribbonRectangle.click({ button: "right" });
  const commandContext = page.getByRole("menu", { name: "Toolbar command context menu" });
  const pinCommand = commandContext.getByRole("menuitem").first();
  await expect(pinCommand).toHaveAccessibleName(/Unpin Rectangle from toolbar/);
  await pinCommand.click();
  await expect(ribbonRectangle).not.toHaveClass(/pinned/);

  await page.locator('[data-ribbon-flyout="sketch"]').click();
  await page.locator('[data-ribbon-flyout-panel="sketch"] [data-ribbon-run="rectangle"]').click({ button: "right" });
  await expect(pinCommand).toHaveAccessibleName(/Pin Rectangle to toolbar/);
  await pinCommand.click();
  await expect(ribbonRectangle).toHaveClass(/pinned/);
  await page.reload();
  await expect(page.locator('[data-workbench-ribbon="Part Design"] [data-ribbon-tool="rectangle"]')).toHaveClass(/pinned/);
});

test("production command surfaces omit future capabilities and menus support type-ahead", async ({ page }) => {
  await expect(page.locator(".app-menu [data-coming-soon], .ribbon-workbench [data-coming-soon]")).toHaveCount(0);

  const viewport = page.getByLabel("3D viewport");
  await viewport.click({ button: "right", position: { x: 120, y: 120 } });
  await expect(page.locator("#viewport-context-menu")).toBeVisible();
  await expect(page.locator("#viewport-context-menu [data-coming-soon]")).toHaveCount(0);
  await expect(page.locator("#viewport-context-menu")).not.toContainText("Fit Selection");
  await page.keyboard.press("Escape");

  const file = page.locator(".app-menu").filter({ hasText: /^File/ });
  await file.locator("summary").focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("s");
  await expect(file.getByRole("menuitem", { name: /^Save/ }).first()).toBeFocused();
  await page.keyboard.press("Home");
  await expect(file.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(file.locator("summary")).toBeFocused();
});
