import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 120_000 });

test.beforeEach(async ({ page }) => {
  await page.goto("/?qualificationReferencePart=1");
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
});

test("menu actions hand off to one modal layer and restore focus", async ({ page }) => {
  const tools = page.locator(".app-menu").filter({ hasText: "Tools" });
  const summary = tools.locator("summary");
  await summary.click();
  await tools.getByRole("menuitem", { name: /Command search/ }).click();

  await expect(tools).not.toHaveAttribute("open", "");
  await expect(page.locator("#command-search")).toBeVisible();
  await expect(page.locator("#modal-scrim")).toBeVisible();
  await expect(page.locator(".topbar")).toHaveJSProperty("inert", true);
  await expect(page.locator("#command-query")).toBeFocused();

  const activeDescendant = await page.locator("#command-query").getAttribute("aria-activedescendant");
  expect(activeDescendant).toBeTruthy();
  await expect(page.locator(`#${activeDescendant}`)).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("Escape");
  await expect(page.locator("#command-search")).toBeHidden();
  await expect(page.locator("#modal-scrim")).toBeHidden();
  await expect(page.locator(".topbar")).toHaveJSProperty("inert", false);
  await expect(summary).toBeFocused();
});

test("application menus support directional keyboard navigation", async ({ page }) => {
  const file = page.locator(".app-menu").filter({ hasText: /^File/ });
  const summary = file.locator("summary");
  await summary.focus();
  await page.keyboard.press("ArrowDown");
  await expect(file).toHaveAttribute("open", "");
  await expect(summary).toHaveAttribute("aria-expanded", "true");
  await expect(file.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(file).not.toHaveAttribute("open", "");
  await expect(summary).toBeFocused();

  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".app-menu").filter({ hasText: /^Edit/ }).locator("summary")).toBeFocused();
});

test("only usable workbenches are exposed and Appearance themes opens its named destination", async ({ page }) => {
  await expect(page.locator("[data-workbench]" )).toHaveCount(2);
  await expect(page.locator("[data-workbench='Part Design']")).toBeVisible();
  await expect(page.locator("[data-workbench='Sketcher']")).toBeVisible();
  await expect(page.locator("[data-workbench='Assembly'], [data-workbench='Drawing'], [data-workbench='Mesh']")).toHaveCount(0);

  const file = page.locator(".app-menu").filter({ hasText: /^File/ });
  const summary = file.locator("summary");
  await summary.click();
  await file.getByRole("menuitem", { name: "Appearance themes…" }).click();
  await expect(page.getByRole("dialog", { name: "Appearance themes" })).toBeVisible();
  await expect(page.locator(".shell")).toHaveJSProperty("inert", true);
  await expect(page.getByLabel("GitHub theme repository")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Appearance themes" })).toBeHidden();
  await expect(page.locator(".shell")).toHaveJSProperty("inert", false);
  await expect(summary).toBeFocused();
});

test("Appearance themes Escape closes only the modal and preserves sketch selection", async ({ page }) => {
  await page.locator("#edit-sketch").click();
  await page.evaluate(() => window.__crawlerApp.chooseOriginSketchSupport("xy"));
  await page.evaluate(() => window.__crawlerApp.applySketchCommands([{ kind: "add_geometry", entity: { id: "sketch:escape-layer", geometry: { kind: "line", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 10_000_000, y_nm: 0 } } } }]));
  const line = page.getByLabel("Editable sketch geometry").locator('[data-sketch-geometry="sketch:escape-layer"]');
  await expect(line).toHaveCount(1);
  await line.click({ force: true });
  await expect(page.locator("#selection-readout")).toContainText("1 entity");

  const file = page.locator(".app-menu").filter({ hasText: /^File/ });
  await file.locator("summary").click();
  await file.getByRole("menuitem", { name: "Appearance themes…" }).click();
  await expect(page.getByRole("dialog", { name: "Appearance themes" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Appearance themes" })).toBeHidden();
  await expect(page.locator("#selection-readout")).toContainText("1 entity");
});
