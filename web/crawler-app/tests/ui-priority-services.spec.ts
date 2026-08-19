import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ timeout: 120_000 });

async function openReferencePart(page: Page): Promise<void> {
  await page.goto("/?qualificationReferencePart=1");
  await page.waitForFunction(() => Boolean(window.__crawlerApp)
    && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
}

test.beforeEach(async ({ page }) => {
  await openReferencePart(page);
});

test("Parameters shortcut and inspector disclosure have distinct accessible names", async ({ page }) => {
  const shortcut = page.getByRole("button", { name: "Parameters", exact: true });
  const disclosure = page.getByRole("button", { name: "Collapse Parameters section", exact: true });

  await expect(shortcut).toHaveCount(1);
  await expect(shortcut).toBeVisible();
  await expect(disclosure).toHaveCount(1);
  await expect(disclosure).toBeVisible();

  await disclosure.click();
  await expect(page.getByRole("button", { name: "Expand Parameters section", exact: true })).toBeVisible();

  await shortcut.click();
  await expect(page.getByRole("dialog", { name: "Parameters" })).toBeVisible();
});

test("body context Rename commits through the document service and Dependencies opens producer history", async ({ page }) => {
  const body = page.locator('#feature-browser [data-body-id="body:part"]');
  await expect(body).toContainText("Part Body");
  const checksumBeforeRename = await page.evaluate(() => window.__crawlerApp.durableChecksum());

  await body.click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Model tree context menu" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Delete", exact: true })).toHaveCount(0);
  await menu.getByRole("menuitem", { name: /^Rename\b/ }).click();

  const rename = page.getByRole("textbox", { name: "Rename Part Body", exact: true });
  await expect(rename).toBeFocused();
  await rename.fill("Primary Solid");
  await rename.press("Enter");

  await expect(body).toContainText("Primary Solid", { timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum())).not.toBe(checksumBeforeRename);

  await body.click({ button: "right" });
  await expect(menu.getByRole("menuitem", { name: "Delete", exact: true })).toHaveCount(0);
  await menu.getByRole("menuitem", { name: "Dependencies", exact: true }).click();

  await expect(page.locator("#inspector .history-services")).toBeVisible();
  await expect(page.locator('[data-timeline-id="feature:extrude"]')).toHaveClass(/selected/);
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.state().selectedFeatureId)).toBe("feature:extrude");
});

test("modeling commands track runtime health and recover to enabled", async ({ page }) => {
  const rectangle = page.locator("#start-rectangle");
  const extrude = page.locator("#start-pad");
  const importStep = page.locator("#import-step");
  const ribbonRevolve = page.locator('.ribbon-tool[data-catalog-operation="crawler.part.revolve"]');

  await expect(rectangle).toBeEnabled();
  await expect(extrude).toBeEnabled();
  await expect(importStep).toBeEnabled();
  await expect(ribbonRevolve).toBeEnabled();

  await page.evaluate(() => window.__crawlerApp.faultWorker("command availability probe"));
  await expect(page.getByRole("alert")).toContainText("Editing couldn’t continue");
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.safeMode())).toBe(true);
  await expect(rectangle).toBeDisabled();
  await expect(extrude).toBeDisabled();
  await expect(importStep).toBeDisabled();
  await expect(ribbonRevolve).toBeDisabled();

  await page.keyboard.press("Control+k");
  await page.locator("#command-query").fill("revolve");
  await expect(page.locator('#command-results [data-operation-id="crawler.part.revolve"]')).toBeDisabled();
  await page.locator("#command-query").fill("restore last good");
  await expect(page.getByRole("option", { name: /^Restore last good model state/ })).toBeEnabled();
  await page.keyboard.press("Escape");

  await page.locator("#recover-runtime").click();
  await page.waitForFunction(() => !window.__crawlerApp.safeMode()
    && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"), undefined, { timeout: 60_000 });
  await expect(rectangle).toBeEnabled();
  await expect(extrude).toBeEnabled();
  await expect(importStep).toBeEnabled();
  await expect(ribbonRevolve).toBeEnabled();
  await page.keyboard.press("Control+k");
  await page.locator("#command-query").fill("revolve");
  await expect(page.locator('#command-results [data-operation-id="crawler.part.revolve"]')).toBeEnabled();
});
