import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ timeout: 300_000 });

async function waitUntilReady(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
}

async function createRectangleSketch(page: Page, plane: "xy" | "xz" | "yz"): Promise<void> {
  if (await page.locator(`[data-origin-plane-id="origin-plane:${plane}"]`).count()) {
    await page.locator(`[data-origin-plane-id="origin-plane:${plane}"]`).click();
  }
  await page.locator("#edit-sketch").click();
  await page.evaluate((selectedPlane) => window.__crawlerApp.chooseOriginSketchSupport(selectedPlane), plane);
  await page.evaluate(async (selectedPlane) => window.__crawlerApp.applySketchCommands([{
    kind: "add_geometry",
    entity: { id: `browser:${selectedPlane}:rectangle`, geometry: { kind: "rectangle", min: { x_nm: 1_000_000, y_nm: 1_000_000 }, max: { x_nm: 4_000_000, y_nm: 3_000_000 } } },
  }]), plane);
  await expect.poll(() => page.getByLabel("Editable sketch geometry").locator(".sketch-entity").count(), { timeout: 60_000 }).toBeGreaterThan(0);
  await page.locator("#finish-sketch-ribbon").click();
  await expect(page.locator("#operation-state")).toContainText("committed", { timeout: 60_000 });
}

async function openOperation(page: Page, operationId: string): Promise<void> {
  await page.keyboard.press("Control+k");
  await page.locator("#command-query").fill(operationId.replace("crawler.part.", "").replaceAll(".", " "));
  await page.locator(`#command-results [data-operation-id="${operationId}"]`).click();
  await expect(page.locator("#execute-advanced-feature")).toBeVisible();
}

async function applyPreview(page: Page, label: string): Promise<void> {
  const before = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  await expect(page.locator("#execute-advanced-feature")).toBeEnabled({ timeout: 60_000 }).catch(async () => {
    throw new Error(`${label} preview refused: ${await page.locator("#operation-execution-status").textContent()} · ${await page.locator("#diagnostics").textContent()}`);
  });
  await expect(page.locator("#operation-state")).toHaveAttribute("data-preview-source", "worker-render-packet");
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(before);
  await page.locator("#execute-advanced-feature").click();
  await expect(page.locator("#operation-state")).toHaveText(`Operation: ${label} committed`, { timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum())).not.toBe(before);
}

test("Loft previews and commits from two ordered accepted sketch profiles", async ({ page }) => {
  await page.goto("/");
  await waitUntilReady(page);
  await createRectangleSketch(page, "xy");
  await createRectangleSketch(page, "xz");
  await openOperation(page, "crawler.part.loft");
  await expect(page.locator("[data-advanced-profile-sketches] option")).toHaveCount(2);
  await applyPreview(page, "Loft");
  await expect(page.locator("#timeline")).toContainText("Loft");
});

test("Draft consumes an exact selected face and commits through preview", async ({ page }) => {
  await page.goto("/?qualificationReferencePart=1");
  await waitUntilReady(page);
  const face = await page.evaluate(() => window.__crawlerApp.selectFirst("face"));
  if (!face) throw new Error("qualification body has no selectable face");
  await openOperation(page, "crawler.part.draft");
  await expect(page.locator("[data-advanced-face-selection]")).toContainText(face.stableId);
  await page.locator("#preview-advanced-feature").click();
  await applyPreview(page, "Draft");
  await expect(page.locator("#timeline")).toContainText("Draft");
});

test("an invalid Sweep path is recoverable and does not fault the modeling worker", async ({ page }) => {
  await page.goto("/?qualificationReferencePart=1");
  await waitUntilReady(page);
  await openOperation(page, "crawler.part.sweep");
  await page.locator("#preview-advanced-feature").click();
  await expect(page.locator("#operation-execution-status")).toContainText("Sweep path must be one open, unbranched chain", { timeout: 60_000 });
  await expect(page.locator("#execute-advanced-feature")).toBeDisabled();
  expect(await page.evaluate(() => window.__crawlerApp.safeMode())).toBe(false);
  expect(await page.evaluate(() => window.__crawlerApp.readiness())).toEqual({ ui: "ready", wasm: "ready", worker: "ready", renderer: "ready" });
});
