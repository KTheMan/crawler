import { expect, test, type Page } from "@playwright/test";
import { installWorkerMessageAudit } from "./solid-feature-qualification-helpers";

test.setTimeout(180_000);

async function openSketch(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
  await page.locator("#edit-sketch").click();
  await page.evaluate(() => window.__crawlerApp.chooseOriginSketchSupport("xy"));
}

test("a selected closed profile and construction axis survive Finish Sketch and drive exact feature input", async ({ page }) => {
  await openSketch(page);
  await page.evaluate(async () => window.__crawlerApp.applySketchCommands([
    { kind: "add_geometry", entity: { id: "profile:left", geometry: { kind: "rectangle", min: { x_nm: 0, y_nm: 0 }, max: { x_nm: 4_000_000, y_nm: 6_000_000 } } } },
    { kind: "add_geometry", entity: { id: "profile:right", geometry: { kind: "rectangle", min: { x_nm: 20_000_000, y_nm: 0 }, max: { x_nm: 30_000_000, y_nm: 8_000_000 } } } },
    { kind: "add_geometry", entity: { id: "construction:axis", construction: true, geometry: { kind: "line", start: { x_nm: 0, y_nm: -10_000_000 }, end: { x_nm: 0, y_nm: 15_000_000 } } } },
  ]));

  const overlay = page.getByLabel("Editable sketch geometry");
  await expect(overlay.locator("[data-sketch-profile-id]")).toHaveCount(2, { timeout: 60_000 });
  const rightProfile = overlay.locator('[data-sketch-profile-id][data-profile-geometry-ids*="profile:right"]');
  await rightProfile.dispatchEvent("pointerdown", { button: 0, pointerId: 81 });
  await expect(rightProfile).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Sketch selection actions")).toContainText("closed profile");
  await expect(page.getByLabel("Sketch selection properties")).toContainText("closed profile");

  await overlay.locator('[data-sketch-hit-geometry="construction:axis"]').dispatchEvent("pointerdown", { button: 0, pointerId: 82, shiftKey: true });
  await page.locator("#finish-sketch-ribbon").click();
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "committed", { timeout: 60_000 });
  await expect(page.locator("#start-pad")).toBeEnabled();

  await page.keyboard.press("Control+k");
  await page.locator("#command-query").fill("revolve");
  await page.locator('#command-results [data-operation-id="crawler.part.revolve"]').click();
  await expect(page.locator("[data-advanced-axis]")).toHaveValue("selected-construction");
  await expect(page.locator('[data-advanced-axis] option[value="selected-construction"]')).toHaveText("Selected construction line");
  await page.locator("#cancel-advanced-feature").click();

  await page.locator("#start-pad").click();
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "preview", { timeout: 60_000 });
  await expect.poll(async () => (await page.evaluate(() => window.__crawlerApp.geometryBounds())).map((value) => Math.round(value * 1_000) / 1_000), { timeout: 60_000 })
    .toEqual([20, 0, 0, 30, 8, 10]);
});

test("an incompatible cross-sketch profile cannot replace an Extrude source", async ({ page }) => {
  await installWorkerMessageAudit(page);
  await openSketch(page);
  await page.evaluate(async () => window.__crawlerApp.applySketchCommands([{
    kind: "add_geometry",
    entity: { id: "source:circle", geometry: { kind: "circle", center: { x_nm: 0, y_nm: 0 }, radius_nm: 10_000_000 } },
  }]));
  const overlay = page.getByLabel("Editable sketch geometry");
  const sourceProfile = overlay.locator('[data-sketch-profile-id][data-profile-geometry-ids*="source:circle"]');
  await expect(sourceProfile).toBeVisible({ timeout: 60_000 });
  await sourceProfile.dispatchEvent("pointerdown", { button: 0, pointerId: 91 });
  await page.locator("#finish-sketch-ribbon").click();
  await page.locator("#start-pad").click();
  const distance = page.getByRole("spinbutton", { name: "Extrude distance in millimeters" });
  await distance.fill("4");
  await expect(page.locator("#operation-state")).toHaveAttribute("data-preview-source", "worker-render-packet", { timeout: 60_000 });
  await distance.press("Enter");
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "committed", { timeout: 60_000 });

  const acceptedDocument = () => page.evaluate(() => {
    const documents = (window as unknown as { __solidFeatureAcceptedDocuments?: string[] }).__solidFeatureAcceptedDocuments ?? [];
    return documents.at(-1);
  });
  const originalDocument = await acceptedDocument();
  expect(originalDocument).toBeTruthy();
  const original = JSON.parse(originalDocument!) as {
    feature_definitions_v2: Record<string, { operation?: { kind?: string; profile?: { sketch?: string; region?: string } }; result?: { body?: string } }>;
  };
  const [featureId, originalDefinition] = Object.entries(original.feature_definitions_v2)
    .find(([, definition]) => definition.operation?.kind === "extrude")!;
  const originalSource = structuredClone(originalDefinition.operation!.profile!);
  const originalBody = originalDefinition.result!.body;

  // Create and select a second profile on the same resolved XY support. The
  // sketch identity alone makes it incompatible with the stored source.
  await page.locator('[data-origin-plane-id="origin-plane:xy"]').click();
  await page.locator("#edit-sketch").click();
  if (await page.evaluate(() => window.__crawlerApp.sketchSupportSelection().active)) {
    await page.evaluate(() => window.__crawlerApp.chooseOriginSketchSupport("xy"));
  }
  await page.evaluate(async () => window.__crawlerApp.applySketchCommands([{
    kind: "add_geometry",
    entity: { id: "cross:circle", geometry: { kind: "circle", center: { x_nm: 30_000_000, y_nm: 0 }, radius_nm: 6_000_000 } },
  }]));
  const crossProfile = overlay.locator('[data-sketch-profile-id][data-profile-geometry-ids*="cross:circle"]');
  await expect(crossProfile).toBeVisible({ timeout: 60_000 });
  await crossProfile.dispatchEvent("pointerdown", { button: 0, pointerId: 92 });
  await page.locator("#finish-sketch-ribbon").click();
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "committed", { timeout: 60_000 });

  const beforeEditDocument = await acceptedDocument();
  const beforeEditHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  const beforeEditBounds = await page.evaluate(() => window.__crawlerApp.geometryBounds());
  const beforeEditFeatureCount = await page.locator("[data-feature-id]").count();
  await page.locator(`[data-feature-id="${featureId}"]`).click();
  await page.locator('[data-feature-action="edit-extrude"]').click();
  await expect(page.locator("#action-error")).toBeVisible();
  await expect(page.locator("#action-error-title")).toHaveText("Edit Extrude couldn’t be completed");
  await expect(page.locator("#action-error-reason")).toHaveText("The selected replacement profile must belong to this Extrude's source sketch and resolved support.");
  await expect(page.locator("#operation-state")).not.toHaveAttribute("data-status", "preview");

  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(beforeEditHash);
  expect(await acceptedDocument()).toBe(beforeEditDocument);
  expect(await page.evaluate(() => window.__crawlerApp.geometryBounds())).toEqual(beforeEditBounds);
  expect(await page.locator("[data-feature-id]").count()).toBe(beforeEditFeatureCount);
  const after = JSON.parse((await acceptedDocument())!) as typeof original;
  expect(after.feature_definitions_v2[featureId].operation?.profile).toEqual(originalSource);
  expect(after.feature_definitions_v2[featureId].result?.body).toBe(originalBody);
});
