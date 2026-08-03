import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

test("STEP progress can be cancelled and retained source re-imports with durable measurements", async ({ page }) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => {
    Object.defineProperty(window, "showOpenFilePicker", { configurable: true, value: undefined });
    Object.defineProperty(window, "showSaveFilePicker", { configurable: true, value: undefined });
  });
  await page.goto("/?stepImportDelay=1000");
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
  const step = await readFile("../../fixtures/reference-models/step-roundtrip-cube/samples/cube-brep.step");
  const before = await page.evaluate(() => window.__crawlerApp.durableChecksum());

  await page.locator("#import-step-file").setInputFiles({ name: "cancelled-cube.step", mimeType: "model/step", buffer: step });
  await expect(page.locator("#cancel-step-import")).toBeEnabled();
  await expect(page.locator("#operation-state")).toContainText("STEP import running");
  await page.locator("#cancel-step-import").click();
  await expect(page.locator("#import-status")).toContainText("cancelled · source retained");
  await expect(page.locator("#reimport-step")).toBeEnabled();
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(before);

  await page.locator("#reimport-step").click();
  await expect(page.locator("#import-status")).toContainText(/STEP (worker start|kernel ready|parse|materialize)/i);
  await expect(page.locator("#import-status")).toContainText("STEP: 6 faces", { timeout: 30_000 });
  await expect(page.locator("#import-status")).toContainText("B-rep bytes");
  await expect(page.locator("#operation-state")).toHaveText("Operation: STEP import committed");
  await expect(page.locator("#feature-browser")).toContainText("cancelled-cube");

  const importedFeature = page.locator("[data-feature-id]").filter({ hasText: "cancelled-cube" });
  await importedFeature.click();
  const evidence = page.getByRole("region", { name: "Imported body measurements" });
  await expect(evidence).toContainText("6 faces");
  await expect(evidence).toContainText("24 edges");
  await expect(evidence).toContainText("24 vertices");
  await expect(evidence).toContainText("Volume");
  await expect(evidence).toContainText("B-rep");
  expect(await page.evaluate(() => window.__crawlerApp.geometryBounds())).toEqual([0, 0, 0, 10, 10, 10]);
  const imported = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  expect(imported).not.toBe(before);

  await page.reload();
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(imported);
  await page.locator("[data-feature-id]").filter({ hasText: "cancelled-cube" }).click();
  await expect(page.getByRole("region", { name: "Imported body measurements" })).toContainText("sha256:");
  expect(await page.evaluate(() => window.__crawlerApp.geometryBounds())).toEqual([0, 0, 0, 10, 10, 10]);

  const downloadEvent = page.waitForEvent("download");
  const exportFailure = page.locator("#safe-mode").waitFor({ state: "visible" }).then(async () => {
    throw new Error(`portable export failed: ${await page.locator("#safe-reason").textContent()}`);
  });
  await page.locator("#save-as-part").click();
  const download = await Promise.race([downloadEvent, exportFailure]);
  const portablePath = await download.path();
  expect(portablePath).not.toBeNull();

  await page.locator("#new-part").click();
  await expect(page.locator("#feature-browser")).not.toContainText("cancelled-cube");
  await page.locator("#open-part-file").setInputFiles(portablePath!);
  await expect(page.locator("#storage-status")).toHaveText("opened");
  await expect(page.locator("#feature-browser")).toContainText("cancelled-cube");
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(imported);
});
