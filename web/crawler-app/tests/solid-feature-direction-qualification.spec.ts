import { expect, test, type Page } from "@playwright/test";
import {
  collectBrowserFailures,
  createQualifiedSketch,
  installWorkerMessageAudit,
  successScreenshot,
  waitUntilReady,
} from "./solid-feature-qualification-helpers";

test.describe.configure({ timeout: 300_000 });

const roundedBounds = (bounds: number[]): number[] => bounds.map((value) => Math.round(value * 1_000_000) / 1_000_000);

type DurableDirectionState = {
  featureId: string;
  direction: string;
  distanceNanometers: number;
};

async function rendererPacketResources(page: Page) {
  const resources = await page.evaluate(() => window.__crawlerApp.rendererPacketResources());
  expect(resources).toBeDefined();
  expect(resources!.packetInstallCount).toBe(resources!.packetDisposeCount + 1);
  expect(resources!.faceRangeCount).toBe(resources!.facePickRecordCount);
  expect(resources!.edgeObjectCount).toBe(resources!.edgePickRecordCount);
  expect(resources!.vertexObjectCount).toBe(resources!.vertexPickRecordCount);
  expect(resources!.modelRadius).toBeGreaterThan(0);
  expect(resources!.gridScale).toBeGreaterThan(0);
  return resources!;
}

async function durableDirectionState(page: Page): Promise<DurableDirectionState> {
  const documentJson = await page.evaluate(() => {
    const documents = (window as unknown as { __solidFeatureAcceptedDocuments?: string[] }).__solidFeatureAcceptedDocuments ?? [];
    return documents.at(-1);
  });
  expect(documentJson).toBeTruthy();
  const durable = JSON.parse(documentJson!) as {
    feature_definitions_v2?: Record<string, {
      operation?: { kind?: string; extent?: { kind?: string; distance?: string; direction?: string } };
    }>;
    parameters?: Record<string, { value?: { kind?: string; value?: number } }>;
  };
  const extrudes = Object.entries(durable.feature_definitions_v2 ?? {})
    .filter(([, definition]) => definition.operation?.kind === "extrude");
  expect(extrudes).toHaveLength(1);
  const [featureId, definition] = extrudes[0];
  expect(definition.operation?.extent?.kind).toBe("blind");
  const distanceId = definition.operation?.extent?.distance;
  const value = distanceId ? durable.parameters?.[distanceId]?.value : undefined;
  expect(value?.kind).toBe("length_nanometers");
  expect(value?.value).toEqual(expect.any(Number));
  return {
    featureId,
    direction: definition.operation!.extent!.direction!,
    distanceNanometers: value!.value!,
  };
}

async function openDirectionEdit(page: Page, featureId: string): Promise<void> {
  await page.locator(`[data-feature-id="${featureId}"]`).click();
  await page.locator('[data-feature-action="edit-extrude"]').click();
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "preview");
}

test("production-direction-lifecycle", async ({ page }) => {
  const failures = collectBrowserFailures(page);
  await installWorkerMessageAudit(page);
  await page.goto("/");
  await waitUntilReady(page);
  await createQualifiedSketch(page, "rectangle", "qualification:direction");

  const direction = page.locator("#extrude-direction-mode");
  const distance = page.locator("#pad-length");
  const normalization = page.locator("#extrude-normalization-status");
  const acceptedSketchHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  const rendererBeforePreview = await rendererPacketResources(page);

  // Create a real reverse Extrude. Direction changes are kernel previews, not
  // screen-space slider tricks, and the accepted sketch remains immutable.
  await page.locator("#start-pad").click();
  await expect(direction).toBeVisible();
  await expect(direction).toHaveAccessibleName("Extrude direction mode");
  await direction.selectOption("negative");
  await distance.fill("10");
  await expect.poll(async () => roundedBounds(await page.evaluate(() => window.__crawlerApp.geometryBounds())), { timeout: 60_000 })
    .toEqual([0, 0, -10, 12, 8, 0]);
  const reversePreviewRenderer = await rendererPacketResources(page);
  expect(reversePreviewRenderer.instanceId).toBe(rendererBeforePreview.instanceId);
  expect(reversePreviewRenderer.packetRevision).toBeGreaterThan(rendererBeforePreview.packetRevision);
  await expect(page.locator("#extrude-manipulator")).toContainText("Reverse");
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(acceptedSketchHash);
  await successScreenshot(page, "direction-reverse.png");
  await distance.press("Enter");
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "committed", { timeout: 60_000 });
  await expect(page.locator("#storage-status")).toHaveText("autosaved", { timeout: 60_000 });
  const reverseHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  const reverse = await durableDirectionState(page);
  expect(reverse).toMatchObject({ direction: "negative", distanceNanometers: 10_000_000 });

  // Force two genuine worker packets to arrive newest-first. A late reverse
  // packet must not replace the final symmetric preview, and Cancel restores
  // both accepted geometry and the accepted mode/value shown in the form.
  await openDirectionEdit(page, reverse.featureId);
  await expect(direction).toHaveValue("negative");
  await expect(distance).toHaveValue("10");
  await page.evaluate(() => {
    (window as unknown as { __solidFeaturePreviewDeliveryDistances: number[] }).__solidFeaturePreviewDeliveryDistances.length = 0;
    (window as unknown as { __solidFeatureReverseNextTwoExtrudePreviews: boolean }).__solidFeatureReverseNextTwoExtrudePreviews = true;
  });
  await distance.fill("8");
  await direction.selectOption("symmetric");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __solidFeaturePreviewDeliveryDistances: number[] }).__solidFeaturePreviewDeliveryDistances), { timeout: 60_000 })
    .toEqual([4_000_000, 8_000_000]);
  await expect.poll(async () => roundedBounds(await page.evaluate(() => window.__crawlerApp.geometryBounds())), { timeout: 60_000 })
    .toEqual([0, 0, -4, 12, 8, 4]);
  await distance.press("Escape");
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "cancelled");
  await expect(direction).toHaveValue("negative");
  await expect(distance).toHaveValue("10");
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(reverseHash);
  await expect.poll(async () => roundedBounds(await page.evaluate(() => window.__crawlerApp.geometryBounds())))
    .toEqual([0, 0, -10, 12, 8, 0]);
  const restoredRenderer = await rendererPacketResources(page);
  expect(restoredRenderer.instanceId).toBe(rendererBeforePreview.instanceId);
  expect(restoredRenderer.packetRevision).toBeGreaterThan(reversePreviewRenderer.packetRevision);

  // Symmetric mode exposes total length. The deliberately odd-nanometer total
  // is visibly canonicalized and persists only its exact one-sided half.
  await openDirectionEdit(page, reverse.featureId);
  await direction.selectOption("symmetric");
  await distance.fill("10.000001");
  await expect(distance).toHaveValue("10.000002");
  await expect(normalization).toContainText("normalized to 10.000002 mm");
  await expect(page.locator("#extrude-distance-label")).toHaveText("Total length");
  await expect.poll(async () => roundedBounds(await page.evaluate(() => window.__crawlerApp.geometryBounds())), { timeout: 60_000 })
    .toEqual([0, 0, -5.000001, 12, 8, 5.000001]);
  await distance.press("Enter");
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "committed", { timeout: 60_000 });
  await expect(page.locator("#storage-status")).toHaveText("autosaved", { timeout: 60_000 });
  const symmetricHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  const symmetric = await durableDirectionState(page);
  expect(symmetric.featureId).toBe(reverse.featureId);
  expect(symmetric).toMatchObject({ direction: "symmetric", distanceNanometers: 5_000_001 });

  await page.reload();
  await waitUntilReady(page);
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(symmetricHash);
  await openDirectionEdit(page, symmetric.featureId);
  await expect(direction).toHaveValue("symmetric");
  await expect(distance).toHaveValue("10.000002");
  await expect(distance).toHaveAttribute("aria-label", "Extrude total length in millimeters");
  await successScreenshot(page, "direction-symmetric-reopen.png");
  await distance.press("Escape");
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(symmetricHash);

  // One page reload intentionally creates one replacement worker; mode edits
  // and stale-preview rejection must not create any additional workers.
  expect(await page.evaluate(() => (window as unknown as { __solidFeatureWorkerCount: number }).__solidFeatureWorkerCount)).toBe(2);
  expect(failures.consoleErrors).toEqual([]);
  expect(failures.pageErrors).toEqual([]);
});
