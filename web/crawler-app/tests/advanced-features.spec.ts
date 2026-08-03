import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.describe.configure({ timeout: 600_000 });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
});

async function openOperation(page: Page, query: string, operationId?: string): Promise<void> {
  await page.keyboard.press("Control+k");
  await page.locator("#command-query").fill(query);
  if (operationId) await page.locator(`#command-results [data-operation-id="${operationId}"]`).click();
  else await page.keyboard.press("Enter");
  await expect(page.locator("#execute-advanced-feature")).toBeVisible();
}

async function executeAccepted(page: Page, label: string): Promise<string> {
  const before = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  await page.locator("#execute-advanced-feature").click();
  await expect.poll(() => page.locator("#operation-state").getAttribute("data-status"), { timeout: 240_000 }).not.toBe("preview");
  if (await page.locator("#operation-state").getAttribute("data-status") === "cancelled") {
    throw new Error(`advanced feature refused: ${await page.locator("#operation-execution-status").textContent()}`);
  }
  await expect(page.locator("#operation-state")).toHaveText(`Operation: ${label} committed`, { timeout: 240_000 });
  await expect(page.locator("#storage-status")).toHaveText("autosaved");
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum())).not.toBe(before);
  return page.evaluate(() => window.__crawlerApp.durableChecksum());
}

const roundedBounds = (bounds: number[]): number[] => bounds.map((value) => Math.round(value * 1_000_000) / 1_000_000);

test("revolve executes atomically and survives suppression, undo, and reload", async ({ page }) => {
  await openOperation(page, "revolve");
  await page.locator('[data-operation-parameter="angle"]').fill("180");
  const accepted = await executeAccepted(page, "Revolve");
  await expect(page.locator("#feature-browser")).toContainText("Revolve");
  expect(await page.evaluate(() => window.__crawlerApp.geometryBounds())).not.toEqual([0, 0, 0, 40, 28, 12]);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(accepted);
  await expect(page.locator("#feature-browser")).toContainText("Revolve");

  await page.locator("[data-feature-id]").last().click();
  await page.locator('[data-feature-action="suppress"]').click();
  await expect(page.locator("#inspector")).toContainText("suppressed");
  await page.locator("#undo").click();
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(accepted);
});

test("advanced feature parameters edit in place and survive undo, redo, and reload", async ({ page }) => {
  await openOperation(page, "revolve");
  await page.locator('[data-operation-parameter="angle"]').fill("180");
  const createdChecksum = await executeAccepted(page, "Revolve");
  const createdBounds = roundedBounds(await page.evaluate(() => window.__crawlerApp.geometryBounds()));
  const featureCount = await page.locator("[data-feature-id]").count();

  await page.locator("[data-feature-id]").last().click();
  await expect(page.locator('[data-feature-action="edit-parameters"]')).toBeVisible();
  await page.locator('[data-feature-action="edit-parameters"]').click();
  await expect(page.locator("#execute-advanced-feature")).toHaveText("Update Revolve");
  await expect(page.locator('[data-operation-parameter="angle"]')).toHaveValue("180");
  await page.locator('[data-operation-parameter="angle"]').fill("270");
  const editedChecksum = await executeAccepted(page, "Revolve");
  expect(editedChecksum).not.toBe(createdChecksum);
  expect(await page.locator("[data-feature-id]").count()).toBe(featureCount);
  expect(roundedBounds(await page.evaluate(() => window.__crawlerApp.geometryBounds()))).not.toEqual(createdBounds);

  await page.locator("#undo").click();
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(createdChecksum);
  await expect.poll(async () => roundedBounds(await page.evaluate(() => window.__crawlerApp.geometryBounds()))).toEqual(createdBounds);
  await page.locator("#redo").click();
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(editedChecksum);
  await expect(page.locator("#storage-status")).toHaveText("autosaved");

  await page.reload();
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(editedChecksum);
  expect(await page.locator("[data-feature-id]").count()).toBe(featureCount);
  await page.locator("[data-feature-id]").last().click();
  await page.locator('[data-feature-action="edit-parameters"]').click();
  await expect(page.locator('[data-operation-parameter="angle"]')).toHaveValue("270");
});

test("editing an upstream advanced feature recomputes its accepted consumer chain", async ({ page }) => {
  await openOperation(page, "revolve");
  await page.locator('[data-operation-parameter="angle"]').fill("180");
  await executeAccepted(page, "Revolve");
  await openOperation(page, "transform", "crawler.part.transform");
  await page.locator('[data-operation-parameter="x"]').fill("5");
  const chainChecksum = await executeAccepted(page, "Transform");
  const chainBounds = roundedBounds(await page.evaluate(() => window.__crawlerApp.geometryBounds()));
  const featureCount = await page.locator("[data-feature-id]").count();

  await page.locator("[data-feature-id]").filter({ hasText: "Revolve" }).last().click();
  await page.locator('[data-history-action="recompute"]').click();
  await expect(page.locator("#history-action-status")).toContainText("Recomputed");
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum())).not.toBe(chainChecksum);
  await expect.poll(async () => roundedBounds(await page.evaluate(() => window.__crawlerApp.geometryBounds()))).toEqual(chainBounds);
  await page.locator("#undo").click();
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(chainChecksum);

  await page.locator("[data-feature-id]").filter({ hasText: "Revolve" }).last().click();
  await page.locator('[data-feature-action="edit-parameters"]').click();
  await page.locator('[data-operation-parameter="angle"]').fill("270");
  const editedChecksum = await executeAccepted(page, "Revolve");
  expect(editedChecksum).not.toBe(chainChecksum);
  expect(await page.locator("[data-feature-id]").count()).toBe(featureCount);
  expect(roundedBounds(await page.evaluate(() => window.__crawlerApp.geometryBounds()))).not.toEqual(chainBounds);

  await page.locator("#undo").click();
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(chainChecksum);
  await expect.poll(async () => roundedBounds(await page.evaluate(() => window.__crawlerApp.geometryBounds()))).toEqual(chainBounds);
});

test("boolean union executes overlapping non-identical STEP boxes in the browser kernel", async ({ page }) => {
  const source = await readFile("../../fixtures/reference-models/step-roundtrip-cube/samples/cube-brep.step", "utf8");
  const translated = source.replace(
    /CARTESIAN_POINT\('', \(([-+\d.eE]+), ([-+\d.eE]+), ([-+\d.eE]+)\)\)/g,
    (_match, x: string, y: string, z: string) => `CARTESIAN_POINT('', (${Number(x) + 5}, ${y}, ${z}))`,
  );
  for (const [name, contents] of [["target-box.step", source], ["overlapping-tool-box.step", translated]] as const) {
    const beforeImport = await page.evaluate(() => window.__crawlerApp.durableChecksum());
    await page.locator("#import-step-file").setInputFiles({
      name,
      mimeType: "model/step",
      buffer: Buffer.from(contents),
    });
    await expect(page.locator("#import-status")).toContainText("STEP: 6 faces", { timeout: 30_000 });
    await expect(page.locator("#operation-state")).toHaveText("Operation: STEP import committed");
    await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum()), { timeout: 30_000 }).not.toBe(beforeImport);
  }

  await openOperation(page, "boolean union");
  const importedBodyIds = await page.locator("[data-advanced-target-body] option").evaluateAll((options) =>
    options.map((option) => (option as HTMLOptionElement).value).filter((value) => value.startsWith("body:import:")),
  );
  expect(importedBodyIds).toHaveLength(2);
  await page.locator("[data-advanced-target-body]").selectOption(importedBodyIds[0]);
  await page.locator("[data-advanced-tool-bodies]").selectOption([importedBodyIds[1]]);
  await executeAccepted(page, "Boolean union");
  await expect(page.locator("#feature-browser")).toContainText("Boolean union");
  expect(await page.evaluate(() => window.__crawlerApp.geometryBounds())).toEqual([0, 0, 0, 15, 10, 10]);
});

test("fillet consumes exact viewport edge IDs and reports accepted geometry", async ({ page }) => {
  await openOperation(page, "revolve");
  await executeAccepted(page, "Revolve");
  const edge = await page.evaluate(() => window.__crawlerApp.selectFirst("edge"));
  expect(edge?.stableId).toMatch(/^\d+$/);
  await openOperation(page, "fillet");
  await expect(page.locator("[data-advanced-edge-selection]")).toContainText(edge!.stableId);
  await page.locator('[data-operation-parameter="radius"]').fill("0.1");
  await executeAccepted(page, "Fillet");
  await expect(page.locator("#feature-browser")).toContainText("Fillet");
});

test("mirror and linear pattern execute from the active durable source", async ({ page }) => {
  await openOperation(page, "revolve");
  await executeAccepted(page, "Revolve");
  await openOperation(page, "mirror");
  await page.locator("[data-advanced-axis]").selectOption("x");
  await executeAccepted(page, "Mirror");
  await openOperation(page, "linear pattern");
  await page.locator('[data-operation-parameter="count"]').fill("2");
  await page.locator('[data-operation-parameter="spacing"]').fill("5");
  await executeAccepted(page, "Linear pattern");
  await expect(page.locator("#feature-browser")).toContainText("Linear pattern");
});

test("Transform translates one durable body by exact signed XYZ lengths", async ({ page }) => {
  await page.locator("#start-pad").click();
  await page.keyboard.press("Enter");
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "committed");
  await expect(page.locator("#storage-status")).toHaveText("autosaved");
  expect(await page.evaluate(() => window.__crawlerApp.geometryBounds())).toEqual([0, 0, 0, 40, 28, 12]);

  await page.keyboard.press("Control+k");
  await page.locator("#command-query").fill("transform");
  await page.locator('[data-operation-id="crawler.part.transform"]').click();
  await expect(page.locator("#execute-advanced-feature")).toBeVisible();
  await expect(page.locator("[data-advanced-source-body] option")).toHaveCount(1);
  await page.locator('[data-operation-parameter="x"]').fill("-5");
  await page.locator('[data-operation-parameter="y"]').fill("3");
  await page.locator('[data-operation-parameter="z"]').fill("2");
  const accepted = await executeAccepted(page, "Transform");
  expect(await page.evaluate(() => window.__crawlerApp.geometryBounds())).toEqual([-5, 3, 2, 35, 31, 14]);
  await expect(page.locator("#feature-browser")).toContainText("Transform");

  await page.reload();
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(accepted);
  expect(await page.evaluate(() => window.__crawlerApp.geometryBounds())).toEqual([-5, 3, 2, 35, 31, 14]);
});

test("shell removes one stable box face and persists an exact hollow body", async ({ page }) => {
  // Materialize the default rectangular extrusion as a durable kernel body before
  // selecting the face that Shell will remove. The viewport's bootstrap packet is
  // display geometry only and must not be treated as an accepted feature result.
  await page.locator("#start-pad").click();
  await page.keyboard.press("Enter");
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "committed");
  await expect(page.locator("#storage-status")).toHaveText("autosaved");
  const face = await page.evaluate(() => window.__crawlerApp.selectFirst("face"));
  expect(face?.stableId).toMatch(/^\d+$/);
  await openOperation(page, "shell");
  await expect(page.locator("[data-advanced-face-selection]")).toContainText(face!.stableId);
  await page.locator('[data-operation-parameter="thickness"]').fill("1");
  const accepted = await executeAccepted(page, "Shell");
  await expect(page.locator("#feature-browser")).toContainText("Shell");
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(accepted);
  await expect(page.locator("#feature-browser")).toContainText("Shell");
});
