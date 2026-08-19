import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.describe.configure({ timeout: 300_000 });

async function ready(page: Page): Promise<void> {
  await page.goto("/?qualificationReferencePart=1");
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
}

async function timelineOrder(page: Page): Promise<string[]> {
  return page.locator("[data-timeline-id]").evaluateAll((items) => items.map((item) => (item as HTMLElement).dataset.timelineId ?? ""));
}

test("feature context Move Down commits an existing reorder transaction and blocked moves remain recoverable", async ({ page }) => {
  await ready(page);
  const feature = (id: string, name: string) => ({
    kind: "create_feature",
    feature: {
      id,
      display_name: name,
      component: "component:root",
      operation: { schema_id: "crawler.operation.detail", schema_version: 1 },
      dependencies: [],
      inputs: {},
      parameters: {},
      suppressed: false,
    },
    before: null,
  });
  await page.evaluate(([first, second]) => window.__crawlerApp.commitDocumentChanges([first, second]), [
    feature("feature:independent-a", "Independent A"),
    feature("feature:independent-b", "Independent B"),
  ]);
  await expect(page.locator('[data-timeline-id="feature:independent-b"]')).toBeVisible();

  const beforeOrder = await timelineOrder(page);
  const beforeChecksum = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  await page.locator('[data-timeline-id="feature:independent-a"]').click({ button: "right" });
  const moveDown = page.getByRole("menu", { name: "Model tree context menu" }).getByRole("menuitem", { name: "Move Down" });
  await expect(moveDown).toBeEnabled();
  await moveDown.click();
  await expect.poll(() => timelineOrder(page)).toEqual([
    ...beforeOrder.filter((id) => id !== "feature:independent-a" && id !== "feature:independent-b"),
    "feature:independent-b",
    "feature:independent-a",
  ]);
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum())).not.toBe(beforeChecksum);

  await page.keyboard.press("Control+z");
  await expect.poll(() => timelineOrder(page)).toEqual(beforeOrder);
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(beforeChecksum);
  await page.keyboard.press("Control+y");
  await expect.poll(() => timelineOrder(page)).toEqual([
    ...beforeOrder.filter((id) => id !== "feature:independent-a" && id !== "feature:independent-b"),
    "feature:independent-b",
    "feature:independent-a",
  ]);

  await page.locator('[data-timeline-id="feature:independent-a"]').click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Model tree context menu" }).getByRole("menuitem", { name: "Move Down" })).toBeDisabled();
  await page.keyboard.press("Escape");

  const beforeBlocked = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  const orderBeforeBlocked = await timelineOrder(page);
  await page.locator('[data-timeline-id="feature:rectangle-sketch"]').click({ button: "right" });
  await page.getByRole("menu", { name: "Model tree context menu" }).getByRole("menuitem", { name: "Move Down" }).click();
  await expect(page.locator("#history-action-status")).toContainText(/reorder feature blocked/i);
  await expect(page.locator("#history-action-status")).toContainText(/feature:rectangle-sketch|feature:extrude/i);
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(beforeBlocked);
  expect(await timelineOrder(page)).toEqual(orderBeforeBlocked);
  expect(await page.evaluate(() => window.__crawlerApp.safeMode())).toBe(false);
});

test("viewport Edit Feature opens the active body's implemented parameter editor", async ({ page }) => {
  await ready(page);
  await page.keyboard.press("Control+k");
  await page.locator("#command-query").fill("revolve");
  await page.locator('#command-results [data-operation-id="crawler.part.revolve"]').click();
  await page.locator('[data-operation-parameter="angle"]').fill("180");
  await expect(page.locator("#execute-advanced-feature")).toBeEnabled();
  await page.locator("#execute-advanced-feature").click();
  await expect(page.locator("#operation-state")).toHaveText("Operation: Revolve committed");
  await expect(page.locator("#storage-status")).toHaveText("autosaved");
  await page.locator("[data-timeline-id]").filter({ hasText: "Revolve" }).click();
  await expect(page.locator('[data-feature-action="edit-parameters"]')).toBeVisible();

  await page.locator("#viewport").click({ button: "right", position: { x: 320, y: 240 } });
  const edit = page.getByRole("menu", { name: "Viewport context menu" }).getByRole("menuitem", { name: "Edit Feature" });
  await expect(edit).toBeEnabled();
  await edit.click();
  await expect(page.locator("#inspector h2")).toHaveText("Revolve");
  await expect(page.locator("#execute-advanced-feature")).toHaveText("Apply update Revolve");
  await expect(page.locator('[data-operation-parameter="angle"]')).toHaveValue("180");
  await page.locator("#cancel-advanced-feature").click();
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "cancelled");

  const step = await readFile("../../fixtures/reference-models/step-roundtrip-cube/samples/cube-brep.step");
  await page.locator("#import-step-file").setInputFiles({ name: "non-editable.step", mimeType: "model/step", buffer: step });
  await expect(page.locator("#operation-state")).toHaveText("Operation: STEP import committed", { timeout: 30_000 });
  await page.locator("#viewport").click({ button: "right", position: { x: 320, y: 240 } });
  await expect(page.getByRole("menu", { name: "Viewport context menu" }).getByRole("menuitem", { name: "Edit Feature" })).toBeDisabled();
});
