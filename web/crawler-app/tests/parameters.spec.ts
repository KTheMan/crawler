import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ timeout: 120_000 });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
  await page.locator('[data-feature-id="feature:extrude"]').click();
  await expect(page.getByRole("region", { name: "Named parameters" })).toBeVisible();
});

function expression(page: Page, parameterId: string) {
  return page.locator(`[data-parameter-expression="${parameterId}"]`);
}

function parameterRow(page: Page, parameterId: string) {
  return page.locator(`[data-parameter-id="${parameterId}"]`);
}

test("unit-bearing expression drives the same exact dimensions and survives reload", async ({ page }) => {
  const height = expression(page, "parameter:height");
  await height.fill("Width + 2.5 mm");
  await height.press("Enter");
  await expect(page.locator("#operation-state")).toHaveText("Operation: Edit height committed");
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.dimensions().heightNanometers), { timeout: 30_000 }).toBe(42_500_000);
  await expect(page.locator("#part-height")).toHaveValue("42.5");
  await expect(parameterRow(page, "parameter:height").locator(".parameter-evaluated")).toHaveText("42.5 mm");
  const accepted = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  expect((await page.evaluate(() => window.__crawlerApp.parameters())).find((parameter) => parameter.id === "parameter:height")).toMatchObject({
    source: "Width + 2.5 mm",
    evaluated_value: { kind: "length_nanometers", value: 42_500_000 },
  });

  await page.reload();
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(accepted);
  expect(await page.evaluate(() => window.__crawlerApp.dimensions().heightNanometers)).toBe(42_500_000);
  await page.locator('[data-feature-id="feature:extrude"]').click();
  await expect(expression(page, "parameter:height")).toHaveValue("Width + 2.5 mm");
});

test("rename preserves structural references and undo restores only the name", async ({ page }) => {
  const width = expression(page, "parameter:width");
  await width.fill("Height * 2");
  await width.press("Enter");
  await expect(page.locator("#operation-state")).toHaveText("Operation: Edit width committed", { timeout: 90_000 });
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.dimensions().widthNanometers), { timeout: 30_000 }).toBe(56_000_000);

  const name = page.locator('[data-parameter-name="parameter:height"]');
  await name.fill("Overall Height");
  await name.press("Enter");
  await expect(page.locator("#operation-state")).toContainText("committed");
  await expect(parameterRow(page, "parameter:height").locator("header strong")).toHaveText("Overall Height");
  await expect(expression(page, "parameter:width")).toHaveValue("Height * 2");
  await expect(parameterRow(page, "parameter:width").locator(".parameter-display-expression")).toContainText("Overall Height");

  await page.locator("#undo").click();
  await expect(parameterRow(page, "parameter:height").locator("header strong")).toHaveText("Height");
  await expect(expression(page, "parameter:width")).toHaveValue("Height * 2");
  expect(await page.evaluate(() => window.__crawlerApp.dimensions().widthNanometers)).toBe(56_000_000);
});

test("syntax, unit, and cycle diagnostics preserve source, hash, and undo history", async ({ page }) => {
  const height = expression(page, "parameter:height");
  await height.fill("Width + 1 mm");
  await height.press("Enter");
  await expect(page.locator("#operation-state")).toHaveText("Operation: Edit height committed", { timeout: 90_000 });
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.dimensions().heightNanometers), { timeout: 30_000 }).toBe(41_000_000);
  const before = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  const width = expression(page, "parameter:width");

  for (const [source, message] of [["45 deg", "unit"], ["Height +", "value"], ["Height", "cycle"]] as const) {
    await width.fill(source);
    await width.press("Enter");
    await expect(width).toHaveAttribute("aria-invalid", "true");
    await expect(width).toHaveValue(source);
    await expect(parameterRow(page, "parameter:width").locator(".parameter-error")).toContainText(message, { ignoreCase: true });
    expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(before);
    expect(await page.evaluate(() => window.__crawlerApp.dimensions().widthNanometers)).toBe(40_000_000);
  }
  await expect(parameterRow(page, "parameter:width").locator(".parameter-error")).toContainText("parameter:height → parameter:width → parameter:height");

  await width.press("Escape");
  await expect(width).toHaveValue("40000000 nm");
  await expect(page.locator('[data-apply-parameter="parameter:width"]')).toBeFocused();
  await page.locator("#undo").click();
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.dimensions().heightNanometers), { timeout: 30_000 }).toBe(28_000_000);
});

test("feature fields promote their stable binding and reuse another named value", async ({ page }) => {
  const widthBinding = page.locator('[data-binding-field="width"]');
  await widthBinding.locator("select").selectOption("parameter:height");
  await widthBinding.getByRole("button", { name: "Promote / reuse" }).click();
  await expect(page.locator("#operation-state")).toContainText("committed", { timeout: 90_000 });
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.dimensions().widthNanometers), { timeout: 30_000 }).toBe(28_000_000);
  await expect(page.locator("#part-width")).toHaveValue("28");
  await expect(expression(page, "parameter:width")).toHaveValue("Height");

  const accepted = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  const distanceBinding = page.locator('[data-binding-field="distance"]');
  await distanceBinding.locator("select").selectOption("parameter:distance");
  await distanceBinding.getByRole("button", { name: "Promote / reuse" }).click();
  await expect(page.locator("#operation-state")).toContainText("committed", { timeout: 30_000 });
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(accepted);
});
