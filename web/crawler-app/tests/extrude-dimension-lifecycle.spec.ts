import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 120_000 });

test.beforeEach(async ({ page }) => {
  await page.goto("/?qualificationReferencePart=1");
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
});

test("visible Extrude dimensions accept edits and Enter commits the result", async ({ page }) => {
  const dimensions = page.getByRole("group", { name: "Active operation dimensions" });
  const distance = page.getByRole("spinbutton", { name: "Extrude distance in millimeters" });

  await expect(dimensions).toBeHidden();
  await page.getByRole("button", { name: "Extrude", exact: true }).click();

  await expect(dimensions).toBeVisible();
  await expect(distance).toBeVisible();
  await expect(distance).toBeEnabled();
  await expect(distance).toBeFocused();
  await expect(dimensions).toContainText("Enter accepts · Escape cancels");

  await distance.fill("17.5");
  await distance.press("ArrowLeft");
  await expect(distance).toHaveValue("17.5");
  await distance.press("Enter");

  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "committed");
  await expect(page.locator("#operation-state")).toContainText("Extrude committed");
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.dimensions().distanceNanometers)).toBe(17_500_000);
  await expect(dimensions).toBeHidden();
});

test("keyboard-started Extrude focuses its dimension and Escape restores accepted state", async ({ page }) => {
  const extrude = page.getByRole("button", { name: "Extrude", exact: true });
  const distance = page.getByRole("spinbutton", { name: "Extrude distance in millimeters" });
  const acceptedChecksum = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  const acceptedDistance = await page.evaluate(() => window.__crawlerApp.dimensions().distanceNanometers);

  await extrude.focus();
  await extrude.press("Enter");
  await expect(distance).toBeVisible();
  await expect(distance).toBeFocused();

  await distance.fill("23");
  await distance.press("Escape");

  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "cancelled");
  await expect(extrude).toBeFocused();
  await expect(page.locator("#pad-length")).toHaveValue(String(acceptedDistance / 1_000_000));
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(acceptedChecksum);
});

test("the visible Rectangle command exposes both editable dimensions", async ({ page }) => {
  await page.locator('[data-ribbon-flyout="sketch"]').click();
  await page.locator('[data-ribbon-run="rectangle"]').click();

  const width = page.getByRole("spinbutton", { name: "Rectangle width in millimeters" });
  const height = page.getByRole("spinbutton", { name: "Rectangle height in millimeters" });
  await expect(width).toBeVisible();
  await expect(height).toBeVisible();
  await expect(width).toBeFocused();

  await width.fill("42");
  await height.fill("31");
  await height.press("Enter");

  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "committed");
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.dimensions())).toMatchObject({
    widthNanometers: 42_000_000,
    heightNanometers: 31_000_000,
  });
});
