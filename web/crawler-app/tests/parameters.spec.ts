import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ timeout: 120_000 });

test.beforeEach(async ({ page }) => {
  await page.goto("/?qualificationReferencePart=1");
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
  await page.locator('[data-feature-id="feature:rectangle-sketch"]:visible').first().click();
  await expect(page.getByRole("region", { name: "Sketch parameter setup" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Sketch parameter setup" })).toContainText("Promote a canvas dimension");
});

function dimensionRow(page: Page, dimension: "width" | "height") {
  return page.locator(`[data-sketch-dimension="${dimension === "width" ? "d1" : "d2"}"]`);
}

async function defineParameter(page: Page, dimension: "width" | "height", name: string): Promise<void> {
  const row = dimensionRow(page, dimension);
  await row.getByRole("button", { name: "Define parameter" }).click();
  const form = row.locator("[data-define-parameter-form]");
  await form.locator("input").fill(name);
  await form.getByRole("button", { name: "Define", exact: true }).click();
  await expect(page.locator("#operation-state")).toContainText("committed", { timeout: 90_000 });
  await expect(dimensionRow(page, dimension)).toContainText(`Defined as ${name}`);
}

async function openParameters(page: Page): Promise<void> {
  await page.locator("[data-open-parameters]:visible").first().click();
  await expect(page.locator("#parameters-dialog")).toBeVisible();
}

function expression(page: Page, parameterId: string) {
  return page.locator(`[data-dialog-expression="${parameterId}"]`);
}

test("canvas dimension references are stable and only promoted parameters enter the global table", async ({ page }) => {
  const stableReference = await dimensionRow(page, "width").locator(".sketch-reference code").first().textContent();
  expect(stableReference).toMatch(/^\{\{sketch\.s[0-9a-f]{8}\.d1\}\}$/);
  await expect(dimensionRow(page, "width").locator(".sketch-reference code").nth(1)).toHaveText('{{sketch.alias."Rectangle".d1}}');
  await expect(page.locator("#sketch-alias")).toHaveValue("Rectangle");
  await expect(page.locator(".sketch-identity code")).toHaveText(/^s[0-9a-f]{8}$/);

  await page.locator("#sketch-alias").fill("Right Control Sketch");
  await page.locator("#sketch-alias").press("Enter");
  await expect(page.locator("#inspector .inspector-selection-header h2")).toContainText("Right Control Sketch");
  await expect(dimensionRow(page, "width").locator(".sketch-reference code").first()).toHaveText(stableReference!);
  await expect(dimensionRow(page, "width").locator(".sketch-reference code").nth(1)).toHaveText('{{sketch.alias."Right Control Sketch".d1}}');

  await openParameters(page);
  await expect(page.locator(".parameters-empty")).toContainText("No defined parameters");
  await page.locator("#close-parameters").click();

  await defineParameter(page, "height", "Overall Height");
  await openParameters(page);
  await expect(page.locator(".dialog-parameter-row")).toHaveCount(1);
  await expect(page.locator(".parameter-name strong")).toHaveText("Overall Height");
  await expect(page.locator('[data-dialog-parameter="parameter:width"]')).toHaveCount(0);
  await expect(page.locator('[data-dialog-parameter="parameter:distance"]')).toHaveCount(0);
});

test("a defined sketch parameter expression drives exact dimensions and survives reload", async ({ page }) => {
  await defineParameter(page, "height", "Overall Height");
  await openParameters(page);
  const height = expression(page, "parameter:height");
  const stableReference = await dimensionRow(page, "width").locator(".sketch-reference code").first().textContent();
  await height.fill(`${stableReference} + 2.5 mm`);
  await height.press("Enter");
  await expect(page.locator("#operation-state")).toHaveText("Operation: Edit height committed");
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.dimensions().heightNanometers), { timeout: 30_000 }).toBe(42_500_000);
  await expect(page.locator("#part-height")).toHaveValue("42.5");
  const accepted = await page.evaluate(() => window.__crawlerApp.durableChecksum());

  await page.reload();
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(accepted);
  expect(await page.evaluate(() => window.__crawlerApp.dimensions().heightNanometers)).toBe(42_500_000);
  await openParameters(page);
  await expect(expression(page, "parameter:height")).toHaveValue("Width + 2.5 mm");
});

test("defining a name preserves structural references and undo restores the implicit state", async ({ page }) => {
  await defineParameter(page, "width", "Overall Width");
  await openParameters(page);
  const width = expression(page, "parameter:width");
  await width.fill("Height * 2");
  await width.press("Enter");
  await expect(page.locator("#operation-state")).toContainText("committed", { timeout: 90_000 });
  await page.locator("#close-parameters").click();

  await defineParameter(page, "height", "Overall Height");
  const parameters = await page.evaluate(() => window.__crawlerApp.parameters());
  expect(parameters.find((parameter) => parameter.id === "parameter:width")?.source).toBe("Height * 2");
  expect(parameters.find((parameter) => parameter.id === "parameter:width")?.display_expression).toContain("Overall Height");

  await page.keyboard.press("Control+z");
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.parameters().find((parameter) => parameter.id === "parameter:height")?.name)).toBe("Height");
  await openParameters(page);
  await expect(page.locator(".dialog-parameter-row")).toHaveCount(1);
  await expect(page.locator(".parameter-name strong")).toHaveText("Overall Width");
});

test("defined parameter diagnostics preserve source, hash, and accepted expression", async ({ page }) => {
  await defineParameter(page, "width", "Overall Width");
  await defineParameter(page, "height", "Overall Height");
  await openParameters(page);
  const before = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  const width = expression(page, "parameter:width");

  await width.fill("45 deg");
  await width.press("Enter");
  await expect(width).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator('[data-dialog-parameter="parameter:width"] .parameter-description')).toContainText("unit", { ignoreCase: true });
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(before);

  await width.press("Escape");
  await expect(width).toHaveValue("40 mm");
  await expect(width).not.toHaveAttribute("aria-invalid", "true");
});

test("non-sketch properties do not expose sketch bindings or the global parameter catalog", async ({ page }) => {
  await page.locator('[data-feature-id="feature:extrude"]:visible').first().click();
  await expect(page.locator('#inspector [data-parameter-key="distance"]')).toHaveCount(1);
  await expect(page.locator('#inspector [data-parameter-key="width"]')).toHaveCount(0);
  await expect(page.locator('#inspector [data-parameter-key="height"]')).toHaveCount(0);
  await expect(page.locator("#inspector .parameter-bindings")).toHaveCount(0);
  await expect(page.locator("#inspector .parameter-panel")).toHaveCount(0);
  await expect(page.getByText("Promote or reuse", { exact: true })).toHaveCount(0);
});
