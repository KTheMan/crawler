import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 120_000 });

test.beforeEach(async ({ page }) => {
  await page.goto("/?qualificationReferencePart=1");
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
});

test("Save Copy writes a separate portable part without replacing the Save association", async ({ page }) => {
  await page.evaluate(() => {
    const state = { associatedWrites: 0, copyWrites: 0, pickCount: 0 };
    const handle = (kind: "associated" | "copy") => ({
      name: `${kind}.crawlerpart`,
      async getFile() { return new File([], this.name); },
      async createWritable() {
        return {
          async write() { if (kind === "associated") state.associatedWrites += 1; else state.copyWrites += 1; },
          async close() {},
        };
      },
    });
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: async () => handle(state.pickCount++ === 0 ? "associated" : "copy"),
    });
    (window as unknown as { __saveCopyState: typeof state }).__saveCopyState = state;
  });

  await page.keyboard.press("Control+Shift+s");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __saveCopyState: { associatedWrites: number } }).__saveCopyState.associatedWrites)).toBe(1);

  const fileMenu = page.locator(".app-menu").filter({ hasText: /^File/ });
  await fileMenu.locator("summary").click();
  await fileMenu.locator("#save-copy-part").click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __saveCopyState: { copyWrites: number } }).__saveCopyState.copyWrites)).toBe(1);

  await page.keyboard.press("Control+s");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __saveCopyState: { associatedWrites: number } }).__saveCopyState.associatedWrites)).toBe(2);
  expect(await page.evaluate(() => (window as unknown as { __saveCopyState: { copyWrites: number } }).__saveCopyState.copyWrites)).toBe(1);
});

test("menus expose implemented workbenches, modeling commands, and every supported interchange format", async ({ page }) => {
  const menu = (name: string) => page.locator(".app-menu").filter({ hasText: new RegExp(`^${name}`) });
  await expect(page.locator("#top-document-name")).toHaveText(/\.crawlerpart$/);

  await menu("File").locator("summary").click();
  await expect(menu("File")).toContainText("Import STEP");
  await expect(menu("File")).toContainText("Import Sketch SVG / DXF");
  await expect(menu("File")).toContainText("Export STEP");
  await expect(menu("File")).toContainText("Export STL");
  await expect(menu("File")).toContainText("Export OBJ");

  await menu("Export").locator("summary").click();
  for (const format of ["STEP", "STL", "OBJ", "SVG", "DXF"]) await expect(menu("Export")).toContainText(format);

  await menu("Model").locator("summary").click();
  for (const command of ["Boolean Union", "Boolean Subtract", "Boolean Intersect"]) await expect(menu("Model")).toContainText(command);

  await menu("Sketch").locator("summary").click();
  await expect(menu("Sketch")).toContainText("Polygon");
  await expect(menu("Sketch")).toContainText("Spline");

  await menu("View").locator("summary").click();
  await menu("View").getByRole("menuitem", { name: "Sketcher Workbench" }).click();
  await expect(page.getByRole("button", { name: "Sketcher" })).toHaveAttribute("aria-current", "page");
});

test("blank documents disable solid exports without faulting the runtime", async ({ page }) => {
  await page.keyboard.press("Control+n");
  await expect(page.locator("#browser-summary")).toHaveText("0 bodies · 0 sketches · 0 features");

  for (const format of ["step", "stl", "obj"]) {
    await expect(page.locator(`[data-export="${format}"]`)).toBeDisabled();
  }

  const fileMenu = page.locator(".app-menu").filter({ hasText: /^File/ });
  await fileMenu.locator("summary").click();
  for (const format of ["STEP", "STL", "OBJ"]) {
    await expect(fileMenu.getByRole("menuitem", { name: `Export ${format}…` })).toBeDisabled();
  }

  expect(await page.evaluate(() => window.__crawlerApp.safeMode())).toBe(false);
  expect(await page.evaluate(() => window.__crawlerApp.state().operation.status)).not.toBe("cancelled");
  expect(await page.evaluate(() => window.__crawlerApp.readiness())).toEqual({ ui: "ready", wasm: "ready", worker: "ready", renderer: "ready" });
});

test("context menus expose only actionable state and custom backgrounds validate on blur", async ({ page }) => {
  await page.getByLabel("3D viewport").click({ button: "right", position: { x: 100, y: 100 } });
  const viewportMenu = page.getByRole("menu", { name: "Viewport context menu" });
  await expect(viewportMenu).toBeVisible();
  expect(await viewportMenu.getByRole("menuitem", { name: /Extrude…/ }).isDisabled()).toBe(await page.locator("#start-pad").isDisabled());
  expect(await viewportMenu.getByRole("menuitem", { name: /Toggle Visibility/ }).isDisabled()).toBe((await page.locator("[data-body-visibility]").count()) === 0);
  await expect(viewportMenu).toContainText("Extrude Cut");
  await page.keyboard.press("Escape");

  const feature = page.locator("#timeline [data-feature-id]").last();
  await feature.click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Model tree context menu" })).toBeVisible();
  await expect(page.getByRole("menu", { name: "Model tree context menu" })).toContainText("Properties");
  await page.keyboard.press("Escape");

  await page.locator("#viewport-background").click();
  const custom = page.locator("#viewport-background-custom");
  await custom.fill("not-a-color");
  await custom.press("Tab");
  await expect(custom).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#viewport-background-menu")).toBeVisible();

  await custom.fill("#123456");
  await custom.press("Tab");
  await expect(custom).toHaveAttribute("aria-invalid", "false");
  await expect(page.locator("#viewport-background-menu")).toBeHidden();
});

test("sketch-only interchange explains how to make the command available", async ({ page }) => {
  const fileMenu = page.locator(".app-menu").filter({ hasText: /^File/ });
  await fileMenu.locator("summary").click();
  await fileMenu.locator("#import-sketch-command").click();
  await expect(page.locator("#action-error")).toBeVisible();
  await expect(page.locator("#action-error-reason")).toHaveText("Sketch interchange needs an active sketch.");
  await expect(page.locator("#action-error-next")).toContainText("Start or edit a sketch");

  await page.locator("#dismiss-action-error").click();
  const insertMenu = page.locator(".app-menu").filter({ hasText: /^Insert/ });
  await insertMenu.locator("summary").click();
  await insertMenu.getByRole("menuitem", { name: /Import Sketch/ }).click();
  await expect(page.locator("#action-error-title")).toHaveText("Sketch import couldn’t be completed");

  await page.locator("#dismiss-action-error").click();
  const exportMenu = page.locator(".app-menu").filter({ hasText: /^Export/ });
  await exportMenu.locator("summary").click();
  await exportMenu.getByRole("menuitem", { name: /SVG/ }).click();
  await expect(page.locator("#action-error-title")).toHaveText("Sketch export couldn’t be completed");
});

test("visible Import STEP button materializes the checked-in CSG cube", async ({ page }) => {
  const step = await readFile("../../fixtures/reference-models/step-roundtrip-cube/samples/cube-import.step");
  const before = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  const fileMenu = page.locator(".app-menu").filter({ hasText: /^File/ });
  await fileMenu.locator("summary").click();
  const chooserPromise = page.waitForEvent("filechooser");

  await fileMenu.getByRole("menuitem", { name: "Import STEP" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: "csg-button-cube.step", mimeType: "model/step", buffer: step });

  await expect(page.locator("#operation-state")).toHaveText("Operation: STEP import committed", { timeout: 30_000 });
  await expect(page.locator("#import-status")).toContainText("STEP: 6 faces");
  await expect(page.locator("#feature-browser")).toContainText("csg-button-cube");
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).not.toBe(before);
  expect(await page.evaluate(() => window.__crawlerApp.geometryBounds())).toEqual([0, 0, 0, 10, 10, 10]);
});

test("STEP parse failure is reported as failed rather than cancelled", async ({ page }) => {
  const fileMenu = page.locator(".app-menu").filter({ hasText: /^File/ });
  await fileMenu.locator("summary").click();
  const chooserPromise = page.waitForEvent("filechooser");
  await fileMenu.getByRole("menuitem", { name: "Import STEP" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "invalid.step",
    mimeType: "model/step",
    buffer: Buffer.from("ISO-10303-21;\nDATA;\n#broken\nENDSEC;\nEND-ISO-10303-21;\n"),
  });

  await expect(page.locator("#operation-state")).toContainText("Operation: STEP import failed", { timeout: 30_000 });
  await expect(page.locator("#operation-state")).not.toContainText("cancelled");
  await expect(page.locator("#action-error-title")).toHaveText("STEP import couldn’t be completed");
  expect(await page.evaluate(() => window.__crawlerApp.state().operation.status)).toBe("failed");
});
