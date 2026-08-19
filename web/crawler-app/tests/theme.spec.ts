import { expect, test } from "@playwright/test";

const THEME_STORAGE_KEY = "crawler.theme";

async function openWithSystemTheme(page: import("@playwright/test").Page, colorScheme: "light" | "dark"): Promise<void> {
  await page.emulateMedia({ colorScheme });
  await page.addInitScript((key) => localStorage.removeItem(key), THEME_STORAGE_KEY);
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__crawlerApp));
}

test("defaults to the operating-system color scheme", async ({ page }) => {
  await openWithSystemTheme(page, "light");

  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveAttribute("data-theme-preference", "system");
  await expect(page.locator(".shell")).toHaveClass(/light/);
  await expect(page.locator("#theme-toggle")).toHaveAttribute("aria-label", "Switch to dark mode");

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("#theme-toggle")).toHaveAttribute("aria-label", "Switch to light mode");
});

test("light mode updates every Figma-derived chrome surface", async ({ page }) => {
  await openWithSystemTheme(page, "light");

  await expect(page.locator(".topbar")).toHaveCSS("background-color", "rgb(221, 224, 232)");
  await expect(page.locator(".browser-panel")).toHaveCSS("background-color", "rgb(232, 234, 240)");
  await expect(page.locator(".inspector-panel")).toHaveCSS("background-color", "rgb(232, 234, 240)");
  await expect(page.locator(".timeline-panel")).toHaveCSS("background-color", "rgb(232, 234, 240)");
  await expect(page.locator(".timeline-item.selected")).toHaveCSS("background-color", "rgba(14, 165, 233, 0.12)");
  await expect(page.locator(".inspector-selection-header")).toHaveCSS("background-color", "rgb(240, 242, 247)");
  await page.locator(".parameters-shortcut").click();
  await expect(page.locator(".dialog-card")).toHaveCSS("background-color", "rgb(232, 234, 240)");
});

test("viewport overlays and the timeline playhead follow the active theme", async ({ page }) => {
  await openWithSystemTheme(page, "light");

  await expect(page.locator(".viewport-nav")).toHaveCSS("background-color", "rgba(255, 255, 255, 0.88)");
  await expect(page.locator(".viewport-tools")).toHaveCSS("background-color", "rgba(255, 255, 255, 0.88)");
  await expect(page.locator(".viewport-tools label").first()).toHaveCSS("background-color", "rgb(224, 242, 254)");
  await expect(page.locator(".timeline-playhead")).toHaveCSS("background-color", "rgb(14, 165, 233)");
  expect(await page.locator(".timeline-playhead").evaluate((element) => getComputedStyle(element, "::before").backgroundColor)).toBe("rgb(2, 132, 199)");

  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator(".viewport-nav")).toHaveCSS("background-color", "rgba(17, 20, 25, 0.92)");
  await expect(page.locator(".viewport-tools")).toHaveCSS("background-color", "rgba(17, 20, 25, 0.92)");
  await expect(page.locator(".timeline-playhead")).toHaveCSS("background-color", "rgb(251, 191, 36)");
});

test("light mode themes the active Sketcher surfaces", async ({ page }) => {
  await openWithSystemTheme(page, "light");
  await page.waitForFunction(() => Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));

  await page.locator("#edit-sketch").click();
  await page.evaluate(() => window.__crawlerApp.chooseOriginSketchSupport("xy"));
  await page.locator('[data-sketch-tool="line"]').click();

  await expect(page.locator(".sketch-selection-filters")).toHaveCSS("background-color", "rgba(255, 255, 255, 0.88)");
  await expect(page.locator(".sketch-selection-filters label").first()).toHaveCSS("background-color", "rgb(224, 242, 254)");
  await expect(page.locator(".active-tool-header > span")).toHaveCSS("background-color", "rgb(238, 242, 255)");
  await expect(page.locator(".active-tool-prompt")).toHaveCSS("background-color", "rgb(246, 248, 251)");
  await expect(page.locator(".sketch-support-card")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.locator("#active-tool-operation-value")).toHaveCount(0);
  await expect(page.locator("#active-tool-auto-constraints")).toBeVisible();
});

test("an explicit theme choice persists across reloads", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await page.evaluate((key) => localStorage.removeItem(key), THEME_STORAGE_KEY);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme-preference", "dark");
  expect(await page.evaluate((key) => localStorage.getItem(key), THEME_STORAGE_KEY)).toBe("dark");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("#theme-toggle")).toHaveAttribute("aria-label", "Switch to light mode");
});
