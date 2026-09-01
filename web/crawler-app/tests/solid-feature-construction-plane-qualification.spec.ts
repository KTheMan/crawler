import { expect, test, type Page } from "@playwright/test";
import {
  collectBrowserFailures,
  createQualifiedSketch,
  installWorkerMessageAudit,
  openExtrudeEdit,
  successScreenshot,
  waitUntilReady,
} from "./solid-feature-qualification-helpers";

test.describe.configure({ timeout: 420_000 });

type DurableDocument = {
  construction_planes?: Record<string, { id?: string; suppressed?: boolean; definition?: { base_plane?: string; offset?: string } }>;
  sketches?: Record<string, { id?: string; support?: { kind?: string; plane?: string } }>;
  feature_definitions_v2?: Record<string, { operation?: { kind?: string; extent?: { distance?: string; direction?: string } }; result_body?: string }>;
  parameters?: Record<string, { value?: { kind?: string; value?: number } }>;
  bodies?: Record<string, { id?: string; generated_by?: string }>;
};

async function latestDurable(page: Page): Promise<DurableDocument> {
  const json = await page.evaluate(() => (window as unknown as { __solidFeatureAcceptedDocuments?: string[] }).__solidFeatureAcceptedDocuments?.at(-1));
  expect(json).toBeTruthy();
  return JSON.parse(json!);
}

async function roundedBounds(page: Page): Promise<number[]> {
  return page.evaluate(() => window.__crawlerApp.geometryBounds().map((value) => Math.round(value * 1_000_000) / 1_000_000));
}

async function expectBounds(page: Page, expected: number[]): Promise<void> {
  await expect.poll(() => roundedBounds(page), { timeout: 60_000 }).toEqual(expected);
}

async function packetResources(page: Page) {
  const resources = await page.evaluate(() => window.__crawlerApp.rendererPacketResources());
  expect(resources).toBeDefined();
  expect(resources!.packetInstallCount).toBe(resources!.packetDisposeCount + 1);
  expect(resources!.faceRangeCount).toBe(resources!.facePickRecordCount);
  expect(resources!.edgeObjectCount).toBe(resources!.edgePickRecordCount);
  expect(resources!.vertexObjectCount).toBe(resources!.vertexPickRecordCount);
  return resources!;
}

async function extrudeDispatchCount(page: Page): Promise<number> {
  return page.evaluate(() => ((window as unknown as { __solidFeaturePostedMessages?: Array<{ type?: string }> }).__solidFeaturePostedMessages ?? [])
    .filter((message) => message.type === "preview-extrude" || message.type === "commit-pad").length);
}

async function planeDispatchCount(page: Page): Promise<number> {
  return page.evaluate(() => ((window as unknown as { __solidFeaturePostedMessages?: Array<{ type?: string }> }).__solidFeaturePostedMessages ?? [])
    .filter((message) => message.type === "preview-offset-construction-plane" || message.type === "commit-offset-construction-plane").length);
}

async function latestExtrudeBinding(page: Page) {
  return page.evaluate(() => {
    type Posted = { type?: string; requestId?: number; valueNanometers?: number; direction?: string; source?: Record<string, unknown> };
    type Received = { type?: string; requestId?: number; semanticHash?: string };
    const posted = ((window as unknown as { __solidFeaturePostedMessages?: Posted[] }).__solidFeaturePostedMessages ?? [])
      .filter((message) => message.type === "preview-extrude" && message.source).at(-1);
    if (!posted?.source) return undefined;
    const source = posted.source;
    const sketch = source.sketch as { id?: unknown; geometry?: Record<string, unknown> } | undefined;
    const response = ((window as unknown as { __solidFeatureWorkerMessages?: Received[] }).__solidFeatureWorkerMessages ?? [])
      .findLast((message) => message.type === "extrude-preview" && message.requestId === posted.requestId);
    return {
      acceptedSemanticHash: response?.semanticHash,
      distanceNanometers: posted.valueNanometers,
      distanceTyped: typeof posted.valueNanometers === "number",
      direction: posted.direction,
      sketchId: sketch?.id,
      sketchGeometryIds: Object.keys(sketch?.geometry ?? {}).sort(),
      support: source.support,
      profileGeometryIds: Array.isArray(source.profileGeometryIds) ? [...source.profileGeometryIds].sort() : undefined,
      featureIdentityTyped: typeof source.featureId === "string" && source.featureId.startsWith("feature:extrude:"),
      bodyIdentityTyped: typeof source.bodyId === "string" && source.bodyId.startsWith("body:extrude:"),
      transactionIdentityTyped: typeof source.transactionId === "string" && source.transactionId.startsWith("transaction:") && source.transactionId.endsWith(":extrude"),
    };
  });
}

function durableIdentities(document: DurableDocument, planeId: string) {
  const sketchId = Object.entries(document.sketches ?? {}).find(([, sketch]) => sketch.support?.kind === "construction_plane_reference" && sketch.support.plane === planeId)?.[0];
  const extrude = Object.entries(document.feature_definitions_v2 ?? {}).find(([, definition]) => definition.operation?.kind === "extrude");
  const featureId = extrude?.[0];
  const bodyId = extrude?.[1].result_body ?? Object.entries(document.bodies ?? {}).find(([, body]) => body.generated_by === featureId)?.[0];
  return { planeId, sketchId, featureId, bodyId };
}

test("production construction-plane and New Body Extrude lifecycle", async ({ page }) => {
  const failures = collectBrowserFailures(page);
  await installWorkerMessageAudit(page);
  await page.goto("/");
  await waitUntilReady(page);

  const initialHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  const initialPacket = await packetResources(page);

  // Cancelled plane previews are exact, visible, non-mutating, and do not
  // replace the accepted body's packet resources.
  // Tool-first and selection-first entry both bind the same typed XY support,
  // exact numeric offset, and owned length-parameter identity shape.
  await page.locator("#create-offset-plane").first().click();
  await page.locator("#construction-plane-offset").fill("5.000001");
  await expect(page.locator("#construction-plane-status")).toContainText("Preview ready", { timeout: 60_000 });
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(initialHash);
  expect(await page.evaluate(() => window.__crawlerApp.constructionPlaneEditState()?.previewFrame?.origin_nanometers)).toEqual([0, 0, 5_000_001]);
  expect(await packetResources(page)).toEqual(initialPacket);
  const toolFirstBinding = await page.evaluate(() => {
    const request = ((window as unknown as { __solidFeaturePostedMessages?: Array<{ type?: string; request?: Record<string, unknown> }> }).__solidFeaturePostedMessages ?? [])
      .filter((message) => message.type === "preview-offset-construction-plane").at(-1)?.request;
    return request && {
      base: request.base_plane_id,
      component: request.component_id,
      offsetType: typeof request.offset_nanometers,
      suppressedType: typeof request.suppressed,
      planeIdentityTyped: typeof request.plane_id === "string" && request.plane_id.startsWith("construction-plane:"),
      parameterIdentityTyped: typeof request.offset_parameter_id === "string" && request.offset_parameter_id.startsWith("parameter:construction-plane-offset:"),
    };
  });
  await page.locator("#cancel-construction-plane").click();
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(initialHash);
  expect(await page.evaluate(() => window.__crawlerApp.constructionPlanes())).toHaveLength(0);

  // Create the durable offset plane, exercise its real tree visibility
  // control, then build a closed rectangle profile on that support.
  await page.locator('[data-origin-plane-id="origin-plane:xy"]').click();
  await page.locator("#create-offset-plane").first().click();
  await page.locator("#construction-plane-offset").fill("5.000001");
  await expect(page.locator("#apply-construction-plane")).toBeEnabled({ timeout: 60_000 });
  const selectionFirstBinding = await page.evaluate(() => {
    const request = ((window as unknown as { __solidFeaturePostedMessages?: Array<{ type?: string; request?: Record<string, unknown> }> }).__solidFeaturePostedMessages ?? [])
      .filter((message) => message.type === "preview-offset-construction-plane").at(-1)?.request;
    return request && {
      base: request.base_plane_id,
      component: request.component_id,
      offsetType: typeof request.offset_nanometers,
      suppressedType: typeof request.suppressed,
      planeIdentityTyped: typeof request.plane_id === "string" && request.plane_id.startsWith("construction-plane:"),
      parameterIdentityTyped: typeof request.offset_parameter_id === "string" && request.offset_parameter_id.startsWith("parameter:construction-plane-offset:"),
    };
  });
  expect(selectionFirstBinding).toEqual(toolFirstBinding);
  await page.locator("#apply-construction-plane").click();
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "committed", { timeout: 60_000 });
  const plane = (await page.evaluate(() => window.__crawlerApp.constructionPlanes()))[0];
  expect(plane).toMatchObject({ basePlaneId: "origin-plane:xy", offsetNanometers: 5_000_001, suppressed: false });
  const planeId = plane.id;
  expect(await page.evaluate(() => window.__crawlerApp.recompute())).toEqual({ dirtyRoots: [planeId], evaluationOrder: [] });
  const visibility = page.locator(`[data-construction-plane-visibility="${planeId}"]`);
  await visibility.click();
  expect(await page.evaluate(() => window.__crawlerApp.constructionPlaneRendererState())).toHaveLength(0);
  await visibility.click();
  expect(await page.evaluate(() => window.__crawlerApp.constructionPlaneRendererState())).toEqual([{ id: planeId, visible: true, preview: false }]);
  await successScreenshot(page, "construction-plane-created.png");

  await createQualifiedSketch(page, "rectangle", "qualification:offset-plane", true, { kind: "construction", plane: planeId });
  const sketchDocument = await latestDurable(page);
  const sketchIdentity = Object.entries(sketchDocument.sketches ?? {}).find(([, sketch]) => sketch.support?.plane === planeId);
  expect(sketchIdentity?.[1].support).toEqual({ kind: "construction_plane_reference", plane: planeId });

  // Selection-first and tool-first entry both dispatch the same stable sketch,
  // exact profile region, construction-plane support, direction/distance, and
  // accepted-document hash. Newly allocated result and transaction identities
  // differ by value but retain the same typed shapes.
  await page.locator("#start-pad").click();
  await page.locator("#extrude-direction-mode").selectOption("positive");
  await page.locator("#pad-length").fill("10");
  await expectBounds(page, [0, 0, 5.000001, 12, 8, 15.000001]);
  const sketchHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  expect(sketchHash).not.toBe(initialHash);
  const selectionFirstExtrudeBinding = await latestExtrudeBinding(page);
  expect(selectionFirstExtrudeBinding?.acceptedSemanticHash).toBe(sketchHash);
  await page.locator("#pad-length").press("Escape");

  // Selecting the datum clears the explicit profile selection. With one
  // unambiguous closed region, starting Extrude first resolves that same
  // durable profile rather than inventing a different source.
  await page.locator(`[data-construction-plane-id="${planeId}"]`).click();
  await expect(page.locator(`[data-construction-plane-id="${planeId}"]`)).toHaveClass(/selected/);
  await expect(page.locator("[data-sketch-id].selected")).toHaveCount(0);
  expect(await page.evaluate(() => window.__crawlerApp.extrudeSelectionContext())).toEqual({ selectedFeatureId: "origin" });
  await page.locator("#start-pad").click();
  await page.locator("#extrude-direction-mode").selectOption("positive");
  await page.locator("#pad-length").fill("10");
  await expectBounds(page, [0, 0, 5.000001, 12, 8, 15.000001]);
  const toolFirstExtrudeBinding = await latestExtrudeBinding(page);
  expect(toolFirstExtrudeBinding).toEqual(selectionFirstExtrudeBinding);

  // Commit the tool-first Forward blind New Body Extrude.
  await page.locator("#pad-length").press("Enter");
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "committed", { timeout: 60_000 });
  const forwardHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  const identities = durableIdentities(await latestDurable(page), planeId);
  expect(Object.values(identities).every(Boolean)).toBe(true);

  // Reverse is a real kernel preview. Cancelling restores the accepted
  // Forward body, document hash, exact fields, and stable packet ownership.
  await openExtrudeEdit(page);
  const packetBeforeReverse = await packetResources(page);
  await page.locator("#extrude-direction-mode").selectOption("negative");
  await page.locator("#pad-length").fill("6");
  await expectBounds(page, [0, 0, -0.999999, 12, 8, 5.000001]);
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(forwardHash);
  await page.locator("#pad-length").press("Escape");
  await expectBounds(page, [0, 0, 5.000001, 12, 8, 15.000001]);
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(forwardHash);
  expect((await packetResources(page)).instanceId).toBe(packetBeforeReverse.instanceId);

  // Commit Symmetric total length and retain every durable identity.
  await openExtrudeEdit(page);
  await page.locator("#extrude-direction-mode").selectOption("symmetric");
  await page.locator("#pad-length").fill("8");
  await expectBounds(page, [0, 0, 1.000001, 12, 8, 9.000001]);
  await page.locator("#pad-length").press("Enter");
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "committed", { timeout: 60_000 });
  const symmetricDocument = await latestDurable(page);
  expect(durableIdentities(symmetricDocument, planeId)).toEqual(identities);
  const symmetricHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  await page.locator(`[data-feature-id="${identities.featureId}"]`).click();
  await expect(page.locator('[data-parameter-key="distance"] dd')).toHaveText("8 mm");
  await expect(page.locator('[data-parameter-key="direction"] dd')).toHaveText("symmetric");
  await successScreenshot(page, "construction-plane-symmetric-extrude.png");

  // Field-addressed reference failures must remain in the plane editor, clear
  // its candidate preview, disable Apply, and dispatch no Extrude work. The
  // missing-base request is rejected by the real release-WASM worker. The
  // The missing-parameter request is forwarded to the real release-WASM worker
  // with an absent existing-plane binding; only the wrong-type response is a
  // boundary injection for UI routing (native/WASM fixture evidence is real).
  const extrudeDispatchesBeforeRepair = await extrudeDispatchCount(page);
  await page.locator(`[data-construction-plane-id="${planeId}"]`).dblclick();
  await expect(page.locator("#apply-construction-plane")).toBeEnabled({ timeout: 60_000 });
  await page.evaluate(() => {
    (window as unknown as { __solidFeatureNextPlaneRequestFault?: "missing_base" }).__solidFeatureNextPlaneRequestFault = "missing_base";
  });
  await page.locator("#construction-plane-offset").fill("5.000002");
  await expect(page.locator("#construction-plane-status")).toContainText("construction_plane.base_plane", { timeout: 60_000 });
  await expect(page.locator("#construction-plane-status")).toContainText("select an existing unsuppressed origin plane");
  await expect(page.locator("#apply-construction-plane")).toBeDisabled();
  expect(await page.evaluate(() => window.__crawlerApp.constructionPlaneEditState()?.previewFrame)).toBeUndefined();
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(symmetricHash);
  await expectBounds(page, [0, 0, 1.000001, 12, 8, 9.000001]);
  await page.locator("#cancel-construction-plane").click();

  await page.locator(`[data-construction-plane-id="${planeId}"]`).dblclick();
  await expect(page.locator("#apply-construction-plane")).toBeEnabled({ timeout: 60_000 });
  await page.evaluate(() => {
    (window as unknown as { __solidFeatureNextPlaneRequestFault?: "missing_parameter" }).__solidFeatureNextPlaneRequestFault = "missing_parameter";
  });
  await page.locator("#apply-construction-plane").click();
  await expect(page.locator("#construction-plane-status")).toContainText("construction_plane.offset_parameter", { timeout: 60_000 });
  await expect(page.locator("#construction-plane-status")).toContainText("restore or replace the missing length parameter");
  await expect(page.locator("#apply-construction-plane")).toBeDisabled();
  expect(await page.evaluate(() => window.__crawlerApp.constructionPlaneEditState()?.previewFrame)).toBeUndefined();
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(symmetricHash);
  await expectBounds(page, [0, 0, 1.000001, 12, 8, 9.000001]);
  await page.locator("#cancel-construction-plane").click();

  await page.locator(`[data-construction-plane-id="${planeId}"]`).dblclick();
  await expect(page.locator("#apply-construction-plane")).toBeEnabled({ timeout: 60_000 });
  await page.evaluate(() => {
    (window as unknown as { __solidFeatureNextPlaneRequestFault?: "wrong_type" }).__solidFeatureNextPlaneRequestFault = "wrong_type";
  });
  await page.locator("#apply-construction-plane").click();
  await expect(page.locator("#construction-plane-status")).toContainText("construction_plane.offset_parameter", { timeout: 60_000 });
  await expect(page.locator("#construction-plane-status")).toContainText("replace the referenced value with an exact length parameter");
  await expect(page.locator("#construction-plane-status")).toHaveAttribute("data-error-references", JSON.stringify(["parameter:wrong-type:qualification"]));
  await expect(page.locator("#apply-construction-plane")).toBeDisabled();
  expect(await page.evaluate(() => window.__crawlerApp.constructionPlaneEditState()?.previewFrame)).toBeUndefined();
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(symmetricHash);
  await expectBounds(page, [0, 0, 1.000001, 12, 8, 9.000001]);
  await page.locator("#cancel-construction-plane").click();
  expect(await extrudeDispatchCount(page)).toBe(extrudeDispatchesBeforeRepair);

  // Unsafe offsets are rejected locally before any worker request, without
  // rounding the durable nanometer value or disturbing accepted geometry.
  await page.locator(`[data-construction-plane-id="${planeId}"]`).dblclick();
  await expect(page.locator("#apply-construction-plane")).toBeEnabled({ timeout: 60_000 });
  const planeDispatchesBeforeUnsafe = await planeDispatchCount(page);
  await page.locator("#construction-plane-offset").fill("9007199254.740992");
  await expect(page.locator("#construction-plane-status")).toContainText("construction_plane.offset_parameter");
  await expect(page.locator("#construction-plane-status")).toContainText("exact safe nanometer range");
  await expect(page.locator("#apply-construction-plane")).toBeDisabled();
  expect(await page.evaluate(() => window.__crawlerApp.constructionPlaneEditState()?.previewFrame)).toBeUndefined();
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(symmetricHash);
  await expectBounds(page, [0, 0, 1.000001, 12, 8, 9.000001]);
  expect(await planeDispatchCount(page)).toBe(planeDispatchesBeforeUnsafe);
  await page.locator("#cancel-construction-plane").click();

  // Reverse two true runtime plane previews. The late stale response must not
  // replace the newest frame or mutate accepted geometry/document state.
  await page.locator(`[data-construction-plane-id="${planeId}"]`).dblclick();
  await page.evaluate(() => {
    (window as unknown as { __solidFeaturePlanePreviewDeliveryOrigins: number[] }).__solidFeaturePlanePreviewDeliveryOrigins.length = 0;
    (window as unknown as { __solidFeatureReverseNextTwoPlanePreviews: boolean }).__solidFeatureReverseNextTwoPlanePreviews = true;
  });
  await page.locator("#construction-plane-offset").fill("7");
  await page.locator("#construction-plane-offset").fill("9");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __solidFeaturePlanePreviewDeliveryOrigins: number[] }).__solidFeaturePlanePreviewDeliveryOrigins), { timeout: 60_000 }).toEqual([9_000_000, 7_000_000]);
  expect(await page.evaluate(() => window.__crawlerApp.constructionPlaneEditState()?.previewFrame?.origin_nanometers)).toEqual([0, 0, 9_000_000]);
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(symmetricHash);
  await expectBounds(page, [0, 0, 1.000001, 12, 8, 9.000001]);
  await page.locator("#cancel-construction-plane").click();
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(symmetricHash);

  // Signed plane edit recomputes descendants atomically while retaining plane,
  // sketch, feature, and body identities.
  await page.locator(`[data-construction-plane-id="${planeId}"]`).dblclick();
  await page.locator("#construction-plane-offset").fill("-2.000001");
  await expect(page.locator("#apply-construction-plane")).toBeEnabled({ timeout: 60_000 });
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(symmetricHash);
  await expectBounds(page, [0, 0, 1.000001, 12, 8, 9.000001]);
  await page.locator("#apply-construction-plane").click();
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "committed", { timeout: 60_000 });
  await expectBounds(page, [0, 0, -6.000001, 12, 8, 1.999999]);
  expect(durableIdentities(await latestDurable(page), planeId)).toEqual(identities);
  expect(await page.evaluate(() => window.__crawlerApp.recompute())).toEqual({ dirtyRoots: [planeId], evaluationOrder: [identities.featureId] });
  const editedHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());

  // Undo/redo restores exact accepted offset geometry without identity churn.
  await page.keyboard.press("Control+z");
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.constructionPlanes()[0]?.offsetNanometers), { timeout: 60_000 }).toBe(5_000_001);
  await expectBounds(page, [0, 0, 1.000001, 12, 8, 9.000001]);
  await page.keyboard.press("Control+y");
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum()), { timeout: 60_000 }).toBe(editedHash);
  await expectBounds(page, [0, 0, -6.000001, 12, 8, 1.999999]);

  // Suppress and unsuppress through the durable edit workflow. A suppressed
  // plane cannot be selected as sketch support and has no renderer surface.
  await page.locator(`[data-construction-plane-id="${planeId}"]`).dblclick();
  await page.locator("#construction-plane-suppressed").check();
  await expect(page.locator("#apply-construction-plane")).toBeEnabled({ timeout: 60_000 });
  expect(await page.evaluate(() => window.__crawlerApp.constructionPlaneEditState()?.previewFrame)).toBeNull();
  await page.locator("#apply-construction-plane").click();
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.constructionPlanes()[0]?.suppressed), { timeout: 60_000 }).toBe(true);
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "committed", { timeout: 60_000 });
  expect(await page.evaluate(() => window.__crawlerApp.recompute())).toEqual({ dirtyRoots: [planeId], evaluationOrder: [] });
  expect(await page.evaluate(() => window.__crawlerApp.constructionPlaneRendererState())).toHaveLength(0);
  expect(await page.evaluate(() => window.__crawlerApp.selectedSketchSupport())).toBeUndefined();
  const suppressedHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  await page.locator(`[data-feature-id="${identities.featureId}"]`).click();
  await page.locator('[data-feature-action="edit-extrude"]').click();
  await expect(page.locator("#operation-state")).toContainText("suppressed_construction_plane_support", { timeout: 60_000 });
  await expect(page.locator("#operation-state")).toHaveAttribute("data-error-field", "extrude.support");
  await expect(page.locator("#operation-state")).toHaveAttribute("data-error-references", JSON.stringify([planeId]));
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(suppressedHash);
  await expectBounds(page, [0, 0, -6.000001, 12, 8, 1.999999]);
  await page.locator(`[data-construction-plane-id="${planeId}"]`).dblclick();
  await page.locator("#construction-plane-suppressed").uncheck();
  await expect(page.locator("#apply-construction-plane")).toBeEnabled({ timeout: 60_000 });
  expect(await page.evaluate(() => window.__crawlerApp.constructionPlaneEditState()?.previewFrame)).not.toBeNull();
  await page.locator("#apply-construction-plane").click();
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.constructionPlanes()[0]?.suppressed), { timeout: 60_000 }).toBe(false);
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "committed", { timeout: 60_000 });
  expect(await page.evaluate(() => window.__crawlerApp.recompute())).toEqual({ dirtyRoots: [planeId], evaluationOrder: [identities.featureId] });
  await expectBounds(page, [0, 0, -6.000001, 12, 8, 1.999999]);
  expect(durableIdentities(await latestDurable(page), planeId)).toEqual(identities);

  // Commit preflight also routes a real generated-worker support failure as a
  // field-addressed, atomic operation error rather than entering safe mode.
  const beforeMissingCommitHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  await openExtrudeEdit(page);
  await page.evaluate(() => {
    (window as unknown as { __solidFeatureNextExtrudeCommitSupportFault?: "missing" }).__solidFeatureNextExtrudeCommitSupportFault = "missing";
  });
  await page.locator("#pad-length").press("Enter");
  await expect(page.locator("#operation-state")).toContainText("missing_construction_plane_support", { timeout: 60_000 });
  await expect(page.locator("#operation-state")).toHaveAttribute("data-error-field", "extrude.support");
  await expect(page.locator("#operation-state")).toHaveAttribute("data-error-references", JSON.stringify(["construction-plane:missing-commit-support"]));
  expect(await page.evaluate(() => window.__crawlerApp.safeMode())).toBe(false);
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(beforeMissingCommitHash);
  await expectBounds(page, [0, 0, -6.000001, 12, 8, 1.999999]);

  // Explicit save, reload/recovery, and deterministic recompute preserve the
  // exact accepted state and resource ownership.
  const preReloadHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  await page.keyboard.press("Control+s");
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.hasExplicitSave()), { timeout: 60_000 }).toBe(true);
  await page.reload();
  await waitUntilReady(page);
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum()), { timeout: 60_000 }).toBe(preReloadHash);
  expect(durableIdentities(await latestDurable(page), planeId)).toEqual(identities);
  await expectBounds(page, [0, 0, -6.000001, 12, 8, 1.999999]);
  const reloadPacket = await packetResources(page);
  expect(reloadPacket.bodyId).toBe(identities.bodyId);

  await page.locator(`[data-feature-id="${identities.featureId}"]`).click();
  await expect(page.locator('[data-parameter-key="distance"] dd')).toHaveText("8 mm");
  await expect(page.locator('[data-parameter-key="direction"] dd')).toHaveText("symmetric");
  await expect(page.locator('[data-history-action="recompute"]')).toBeVisible({ timeout: 60_000 });
  await page.locator('[data-history-action="recompute"]').click();
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.recompute().evaluationOrder), { timeout: 60_000 }).toContain(identities.featureId);
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).not.toBe(preReloadHash);
  expect(durableIdentities(await latestDurable(page), planeId)).toEqual(identities);
  await expectBounds(page, [0, 0, -6.000001, 12, 8, 1.999999]);
  await successScreenshot(page, "construction-plane-reloaded-recomputed.png");

  expect(failures.consoleErrors).toEqual([]);
  expect(failures.pageErrors).toEqual([]);
});
