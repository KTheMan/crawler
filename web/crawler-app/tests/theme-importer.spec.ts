import { expect, test } from "@playwright/test";
import { strToU8, zipSync } from "fflate";

function fixtureTheme(): Buffer {
  return Buffer.from(zipSync({
    "theme.xml": strToU8(`
      <theme themefileversion="1.0">
        <name>Browser Theme</name><type>light</type>
        <stylesheet>browser.qss</stylesheet>
        <icons><icon name="PartDesign_Pad" path="icons/pad.svg" /></icons>
      </theme>`),
    "browser.qss": strToU8(`
      * { color: #172033; }
      QMainWindow, QDialog, QDockWidget { background-color: #dce8f5; }
      QMenu::item:selected { background-color: #3468b2; }
    `),
    "icons/pad.svg": strToU8(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#3468b2" d="M2 2h20v20H2z"/></svg>`),
  }));
}

test("imports, persists, applies, and removes an FCTheme archive", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__crawlerApp?.themeStatus().name === "FreeCAD Nut Icons");

  await page.getByText("File", { exact: true }).click();
  await page.getByRole("menuitem", { name: "Appearance themes…" }).click();
  await expect(page.getByRole("dialog", { name: "Appearance themes" })).toBeVisible();

  await page.locator("[data-theme-file]").setInputFiles({
    name: "browser.fctheme",
    mimeType: "application/zip",
    buffer: fixtureTheme(),
  });

  await expect(page.locator("[data-theme-import-status]")).toContainText("Browser Theme installed");
  await expect(page.locator("html")).toHaveAttribute("data-external-theme", "active");
  await expect(page.locator(".topbar")).toHaveCSS("background-color", "rgb(220, 232, 245)");
  expect(await page.locator('img[data-cad-icon="extrude"]').count()).toBeGreaterThan(0);
  await expect(page.locator('img[data-cad-icon="fillet"]')).toHaveCount(0);
  expect(await page.locator('svg[data-cad-icon="fillet"]').count()).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__crawlerApp.themeStatus())).toMatchObject({ active: true, name: "Browser Theme", iconCount: 1, mode: "light" });

  await page.reload();
  await page.waitForFunction(() => window.__crawlerApp?.themeStatus().active === true);
  expect(await page.locator('img[data-cad-icon="extrude"]').count()).toBeGreaterThan(0);

  await page.getByText("File", { exact: true }).click();
  await page.getByRole("menuitem", { name: "Appearance themes…" }).click();
  await page.getByRole("button", { name: "Use built-in appearance" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-external-theme", "none");
  await expect(page.locator('img[data-cad-icon="extrude"]')).toHaveCount(0);
  expect(await page.locator('svg[data-cad-icon="extrude"]').count()).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__crawlerApp.themeStatus().active)).toBe(false);
});
test("installs the bundled legacy compatibility pack in development", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__crawlerApp?.themeStatus().name === "FreeCAD Nut Icons");

  await page.getByText("File", { exact: true }).click();
  await page.getByRole("menuitem", { name: "Appearance themes…" }).click();
  const developmentSection = page.locator("[data-development-themes]");
  await expect(developmentSection).toBeVisible();
  const nutExtrudeSource = await page.locator('img[data-cad-icon="extrude"]').first().getAttribute("src");
  const nutFilletSource = await page.locator('img[data-cad-icon="fillet"]').first().getAttribute("src");
  await developmentSection.getByRole("button", { name: "MM Gray / Blue / Yellow" }).click();

  await expect(page.locator("[data-theme-import-status]")).toContainText("MM_Gray_blue_yellow installed", { timeout: 30_000 });
  expect(await page.evaluate(() => window.__crawlerApp.themeStatus())).toMatchObject({
    active: true,
    name: "MM_Gray_blue_yellow",
    iconCount: 67,
    source: { kind: "legacy-freecad-icons" },
  });
  expect(await page.locator('img[data-cad-icon="extrude"]').count()).toBeGreaterThan(0);
  const mmExtrudeSource = await page.locator('img[data-cad-icon="extrude"]').first().getAttribute("src");
  const mmFilletSource = await page.locator('img[data-cad-icon="fillet"]').first().getAttribute("src");
  expect(mmExtrudeSource).not.toBe(nutExtrudeSource);
  expect(mmFilletSource).not.toBe(nutFilletSource);

  await developmentSection.getByRole("button", { name: "FreeCAD Nut Icons (default)" }).click();
  await expect(page.locator("[data-theme-import-status]")).toContainText("FreeCAD Nut Icons installed");
  expect(await page.locator('img[data-cad-icon="extrude"]').first().getAttribute("src")).not.toBe(mmExtrudeSource);
  expect(await page.locator('img[data-cad-icon="fillet"]').first().getAttribute("src")).not.toBe(mmFilletSource);
});

test("uses FreeCAD Nut as the development default icon pack", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__crawlerApp?.themeStatus().name === "FreeCAD Nut Icons");

  expect(await page.evaluate(() => window.__crawlerApp.themeStatus())).toMatchObject({
    active: true,
    name: "FreeCAD Nut Icons",
    iconCount: 81,
    source: { kind: "fctheme" },
  });
  expect(await page.locator('img[data-cad-icon="extrude"]').count()).toBeGreaterThan(0);

  await page.getByText("File", { exact: true }).click();
  await page.getByRole("menuitem", { name: "Appearance themes…" }).click();
  await expect(page.locator("[data-active-imported-theme]")).toContainText("FreeCAD Nut Icons");
  await expect(page.locator("[data-development-themes]").getByRole("button", { name: "FreeCAD Nut Icons (default)" })).toBeVisible();
});
