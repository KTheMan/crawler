import { expect, test } from "@playwright/test";

test.setTimeout(180_000);

test("startup and New Part expose a blank document, not the qualification body", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));

  await expect(page.locator("#browser-summary")).toHaveText("0 bodies · 0 sketches · 0 features");
  await expect(page.locator('[data-body-id="body:part"]')).toHaveCount(0);
  await expect(page.locator('[data-feature-id="feature:extrude"]')).toHaveCount(0);
  await expect(page.locator("#start-pad")).toBeDisabled();
  await expect(page.locator("#edit-sketch")).toBeEnabled();
  await expect(page.locator("#onboarding")).toBeHidden();
  await expect(page.locator("#empty-document-actions")).toBeVisible();
  await expect(page.locator("#empty-document-actions")).toContainText("Create sketch");
  await expect(page.locator("#empty-document-actions")).toContainText("Import STEP");
  await expect(page.locator("#empty-document-actions")).toContainText("Open part");

  const initialHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  await page.keyboard.press("Control+n");
  await expect(page.locator("#storage-status")).toHaveText("new part");
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum())).not.toBe(initialHash);
  await expect(page.locator("#browser-summary")).toHaveText("0 bodies · 0 sketches · 0 features");
  expect(await page.evaluate(() => window.__crawlerApp.dimensions())).toEqual({
    widthNanometers: 0,
    heightNanometers: 0,
    distanceNanometers: 0,
  });
});

test("a closed sketch profile previews and commits as an Extrude body", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));

  await page.locator("#edit-sketch").click();
  await page.evaluate(() => window.__crawlerApp.chooseOriginSketchSupport("xy"));
  await page.locator('[data-sketch-tool="rectangle"]').click();
  const canvas = page.getByLabel("3D viewport");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("viewport has no bounds");
  await page.mouse.move(box.x + box.width * .38, box.y + box.height * .38);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .58, box.y + box.height * .58, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByLabel("Editable sketch geometry").locator(".sketch-entity")).toHaveCount(4, { timeout: 60_000 });
  await page.locator("#finish-sketch-ribbon").click();

  await expect(page.locator("#start-pad")).toBeEnabled({ timeout: 60_000 });
  await page.locator("#start-pad").click();
  await expect(page.locator("#operation-state")).toContainText("Extrude preview");
  await expect(page.locator("#operation-state")).toHaveAttribute("data-preview-source", "worker-render-packet", { timeout: 60_000 });
  await page.locator("#pad-length").fill("15");
  await page.locator("#pad-length").press("Enter");

  await expect(page.locator("#browser-summary")).toContainText("1 body", { timeout: 60_000 });
  await expect(page.locator('[data-feature-id^="feature:extrude:"]')).toHaveCount(1);
  await expect(page.locator("#operation-state")).toContainText("committed");
});
