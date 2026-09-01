import { expect, test, type Page } from "@playwright/test";
import {
  collectBrowserFailures,
  commitExtrude,
  createQualifiedSketch,
  fixtureDescriptor,
  installWorkerMessageAudit,
  mergeBrowserFixtureAssertions,
  observedTopologyFingerprint,
  sha256,
  successScreenshot,
  waitUntilReady,
  writeBrowserFixtureEvidence,
} from "./solid-feature-qualification-helpers";

test.describe.configure({ timeout: 600_000 });

async function dismissQuickTour(page: Page): Promise<void> {
  const exit = page.locator("#tour-exit");
  if (await exit.isVisible()) await exit.click();
  await expect(page.locator("#onboarding")).toBeHidden();
}

async function currentTargetBody(page: Page): Promise<string> {
  return page.evaluate(() => {
    const durable = window.__crawlerApp.durableDocument() as { bodies?: Record<string, { suppressed?: boolean }> };
    const bodies = Object.entries(durable.bodies ?? {}).filter(([, body]) => !body.suppressed).map(([bodyId]) => bodyId);
    if (bodies.length !== 1) throw new Error(`Expected one current Cut target, got ${bodies.length}`);
    return bodies[0]!;
  });
}

async function postedExtrudeDispatchCount(page: Page): Promise<number> {
  return page.evaluate(() => ((window as unknown as { __solidFeaturePostedMessages?: { type: string }[] }).__solidFeaturePostedMessages ?? [])
    .filter((message) => message.type === "preview-extrude" || message.type === "commit-pad").length);
}

async function acceptedStateSnapshot(page: Page): Promise<{
  checksum: string;
  durable: unknown;
  rendererFingerprint: string;
  rendererBodyId?: string;
  selection: unknown;
}> {
  return page.evaluate(() => {
    const state = window.__crawlerApp.state();
    return {
      checksum: window.__crawlerApp.durableChecksum(),
      durable: window.__crawlerApp.durableDocument(),
      rendererFingerprint: window.__crawlerApp.rendererTopologyFingerprint(),
      rendererBodyId: window.__crawlerApp.rendererPacketResources()?.bodyId,
      selection: { selection: state.selection, selections: state.selections },
    };
  });
}

async function lastCutPreviewBinding(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const messages = (window as unknown as { __solidFeaturePostedMessages?: Array<{ type: string; source?: Record<string, unknown> }> }).__solidFeaturePostedMessages ?? [];
    const source = [...messages].reverse().find((message) => message.type === "preview-extrude" && message.source?.resultMode === "cut")?.source;
    if (!source) throw new Error("No bounded Cut preview dispatch was observed");
    const sketch = source.sketch as { id?: string } | undefined;
    return {
      sketchId: sketch?.id,
      support: source.support,
      profileGeometryIds: source.profileGeometryIds,
      resultMode: source.resultMode,
      targetBodyId: source.targetBodyId,
      bodyId: source.bodyId,
    };
  });
}

function expectAcceptedStateEqual(actual: Awaited<ReturnType<typeof acceptedStateSnapshot>>, expected: Awaited<ReturnType<typeof acceptedStateSnapshot>>): void {
  expect(actual.checksum).toBe(expected.checksum);
  expect(actual.durable).toEqual(expected.durable);
  expect(actual.rendererFingerprint).toBe(expected.rendererFingerprint);
  expect(actual.rendererBodyId).toBe(expected.rendererBodyId);
  expect(actual.selection).toEqual(expected.selection);
}

const cutRibbonTool = (page: Page) => page.locator('.ribbon-tool[data-catalog-operation="crawler.part.extrude.cut"]');

type CutDefinition = {
  operation?: { kind?: string; profile?: { kind?: string; sketch?: string; region?: string }; extent?: { direction?: string } };
  result?: { mode?: string; body?: string };
  participant_bodies?: { role?: string; body?: string }[];
};

function cutDefinition(documentValue: any): [string, CutDefinition] {
  const entries = Object.entries(documentValue.feature_definitions_v2 ?? {})
    .filter(([, definition]) => (definition as CutDefinition).result?.mode === "cut");
  if (entries.length !== 1) throw new Error(`Expected one durable Cut definition, got ${entries.length}`);
  return entries[0] as [string, CutDefinition];
}

test("production generated-worker Cut retains one explicit target through lifecycle and refuses target inference", async ({ page }) => {
  const candidateWasmSha256 = process.env.SOLID_FEATURE_WASM_SHA256;
  expect(candidateWasmSha256, "SOLID_FEATURE_WASM_SHA256 must be manifest-locked").toMatch(/^[a-f0-9]{64}$/);
  const failures = collectBrowserFailures(page);
  await installWorkerMessageAudit(page);
  const runtimeWasmResponses: Promise<Buffer>[] = [];
  page.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    if (/crawler_part_runtime_bg(?:-[a-zA-Z0-9_-]+)?\.wasm$/.test(pathname)) {
      expect(response.ok(), `release runtime WASM returned HTTP ${response.status()}`).toBe(true);
      runtimeWasmResponses.push(response.body());
    }
  });
  await page.goto("/?qualificationReferencePart=1");
  await waitUntilReady(page);
  await expect.poll(() => runtimeWasmResponses.length, { timeout: 60_000 }).toBeGreaterThanOrEqual(1);
  const servedWasmSha256 = sha256(await runtimeWasmResponses[0]!);
  expect(servedWasmSha256).toBe(candidateWasmSha256);
  await dismissQuickTour(page);

  const targetBodyId = await currentTargetBody(page);
  const initialDocument = await page.evaluate(() => window.__crawlerApp.durableDocument()) as any;
  const initialBodyIds = Object.keys(initialDocument.bodies ?? {}).sort();
  await createQualifiedSketch(page, "rectangle", "qualification:cut", true, { kind: "origin", plane: "xy" }, {
    rectangle: { min: { x_nm: 2_000_000, y_nm: 1_000_000 }, max: { x_nm: 8_000_000, y_nm: 5_000_000 } },
  });
  const acceptedBeforePreview = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  const acceptedTopologyBeforePreview = await observedTopologyFingerprint(page);
  const acceptedStateBeforeTool = await acceptedStateSnapshot(page);

  // Tool-first must use the public Cut command and must not infer a target.
  await cutRibbonTool(page).click();
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "preview");
  await expect(page.locator("#extrude-result-mode")).toHaveValue("cut");
  await expect(page.locator("#preview-advanced-feature")).toHaveCount(0);
  const dispatchesBeforeMissingTarget = await postedExtrudeDispatchCount(page);
  await expect(page.locator("#extrude-normalization-status")).toContainText("Select one current target body for Cut");
  const dispatchesAfterMissingTarget = await postedExtrudeDispatchCount(page);
  expect(dispatchesAfterMissingTarget).toBe(dispatchesBeforeMissingTarget);
  expectAcceptedStateEqual(await acceptedStateSnapshot(page), acceptedStateBeforeTool);

  await expect(page.locator("#extrude-target-body")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("#extrude-target-body")).toBeEnabled({ timeout: 60_000 });
  await page.locator("#extrude-target-body").selectOption(targetBodyId);
  await expect(page.locator("#operation-state")).toHaveAttribute("data-target-body-id", targetBodyId, { timeout: 60_000 });
  await expect.poll(() => observedTopologyFingerprint(page), { timeout: 60_000 }).not.toBe(acceptedTopologyBeforePreview);
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.cutRemovalPreviewState()), { timeout: 60_000 }).toMatchObject({
    visible: true,
    triangleCount: expect.any(Number),
    color: "#f97316",
  });
  const removalPreview = await page.evaluate(() => window.__crawlerApp.cutRemovalPreviewState());
  expect(removalPreview?.triangleCount).toBeGreaterThan(0);
  expect(removalPreview?.topologyFingerprint).not.toBe("");
  const removalVolumeDistinguished = Boolean(removalPreview?.visible && removalPreview.triangleCount > 0 && removalPreview.topologyFingerprint);
  const toolFirstBinding = await lastCutPreviewBinding(page);
  const previewTopology = await observedTopologyFingerprint(page);
  const previewHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  expect(previewHash).toBe(acceptedBeforePreview);
  await successScreenshot(page, "cut-preview.png");
  await page.locator("#pad-length").press("Escape");
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "cancelled");
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(acceptedBeforePreview);
  await expect.poll(() => observedTopologyFingerprint(page), { timeout: 60_000 }).toBe(acceptedTopologyBeforePreview);
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.cutRemovalPreviewState()?.visible), { timeout: 60_000 }).toBe(false);
  expectAcceptedStateEqual(await acceptedStateSnapshot(page), acceptedStateBeforeTool);
  const cancelledTopology = await observedTopologyFingerprint(page);

  // Selection-first must produce the same normalized profile/support/target
  // binding through the Model menu and still route through preview-extrude.
  expect(await page.evaluate(() => window.__crawlerApp.selectFirst("body")?.bodyId)).toBe(targetBodyId);
  const acceptedStateBeforeSelectionFirst = await acceptedStateSnapshot(page);
  const modelMenu = page.locator("details.app-menu").filter({ has: page.locator("summary", { hasText: "Model" }) });
  await modelMenu.locator("summary").click();
  await modelMenu.locator('[data-catalog-operation="crawler.part.extrude.cut"]').click();
  await expect(page.locator("#operation-state")).toHaveAttribute("data-target-body-id", targetBodyId, { timeout: 60_000 });
  const selectionFirstBinding = await lastCutPreviewBinding(page);
  expect(selectionFirstBinding).toEqual(toolFirstBinding);
  const noLegacyAdvancedDispatch = await page.evaluate(() => !((window as unknown as { __solidFeaturePostedMessages?: Array<{ type: string }> }).__solidFeaturePostedMessages ?? [])
    .some((message) => message.type === "preview-advanced-feature" || message.type === "execute-advanced-feature"));
  expect(noLegacyAdvancedDispatch).toBe(true);
  const actualToolEntryParity = JSON.stringify(selectionFirstBinding) === JSON.stringify(toolFirstBinding) && noLegacyAdvancedDispatch;
  await page.locator("#pad-length").press("Escape");
  await expect.poll(() => observedTopologyFingerprint(page), { timeout: 60_000 }).toBe(acceptedTopologyBeforePreview);
  expectAcceptedStateEqual(await acceptedStateSnapshot(page), acceptedStateBeforeSelectionFirst);

  await cutRibbonTool(page).click();
  await expect(page.locator("#operation-state")).toHaveAttribute("data-target-body-id", targetBodyId, { timeout: 60_000 });
  await page.locator("#pad-length").fill("2");
  await expect(page.locator("#operation-state")).toHaveAttribute("data-target-body-id", targetBodyId, { timeout: 60_000 });
  await expect.poll(() => observedTopologyFingerprint(page), { timeout: 60_000 }).not.toBe(acceptedTopologyBeforePreview);
  const commitPreviewTopology = await observedTopologyFingerprint(page);
  await commitExtrude(page);
  await expect.poll(() => observedTopologyFingerprint(page), { timeout: 60_000 }).toBe(commitPreviewTopology);
  const committedTopology = await observedTopologyFingerprint(page);
  const committed = await page.evaluate(() => window.__crawlerApp.durableDocument()) as any;
  const [featureId, committedDefinition] = cutDefinition(committed);
  expect(committedDefinition.result).toEqual({ mode: "cut" });
  expect(committedDefinition.participant_bodies).toEqual([{ role: "target", body: targetBodyId }]);
  expect(Object.keys(committed.bodies ?? {}).sort()).toEqual(initialBodyIds);
  expect(committed.bodies[targetBodyId]).toBeTruthy();
  await successScreenshot(page, "cut-committed.png");

  const committedHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  await page.locator(`[data-feature-id="${featureId}"]`).click();
  await page.locator('[data-feature-action="edit-extrude"]').click();
  await expect(page.locator("#extrude-result-mode")).toHaveValue("cut");
  await expect(page.locator("#extrude-result-mode")).toBeDisabled();
  await expect(page.locator("#extrude-target-body")).toHaveValue(targetBodyId);
  await expect(page.locator("#extrude-target-body")).toBeDisabled();
  await expect(page.locator('[data-parameter-key="result_mode"] dd')).toHaveText("cut");
  await expect(page.locator('[data-parameter-key="target_body"] dd')).toHaveText(targetBodyId);
  await expect(page.locator('[data-input-slot="target"] span')).toHaveText("body · 1 required");
  await expect(page.locator('[data-input-slot="target_body"]')).toHaveCount(0);
  await expect(page.locator("#operation-state")).toHaveAttribute("data-preview-source", "worker-render-packet", { timeout: 60_000 });
  await page.evaluate(() => {
    (window as unknown as { __solidFeaturePreviewDeliveryDistances: number[] }).__solidFeaturePreviewDeliveryDistances.length = 0;
    (window as unknown as { __solidFeatureReverseNextTwoExtrudePreviews: boolean }).__solidFeatureReverseNextTwoExtrudePreviews = true;
  });
  await page.locator("#pad-length").fill("1.25");
  await page.locator("#pad-length").fill("1.5");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __solidFeaturePreviewDeliveryDistances: number[] }).__solidFeaturePreviewDeliveryDistances), { timeout: 60_000 }).toEqual([1_500_000, 1_250_000]);
  const cutPreviewDeliveries = await page.evaluate(() => (window as unknown as { __solidFeaturePreviewDeliveryDistances: number[] }).__solidFeaturePreviewDeliveryDistances);
  const stalePreviewRejected = cutPreviewDeliveries[0] === 1_500_000 && cutPreviewDeliveries[1] === 1_250_000;
  await expect(page.locator("#operation-state")).toHaveAttribute("data-target-body-id", targetBodyId, { timeout: 60_000 });
  await expect.poll(() => observedTopologyFingerprint(page), { timeout: 60_000 }).not.toBe(committedTopology);
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(committedHash);
  await successScreenshot(page, "cut-edit.png");

  const beforeBaseChangeHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  await page.evaluate((id) => window.__crawlerApp.commitDocumentChanges([{
    kind: "rename_entity",
    entity: { kind: "feature", id },
    display_name: "Cut qualification",
  }]), featureId);
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum()), { timeout: 60_000 }).not.toBe(beforeBaseChangeHash);
  await expect.poll(() => observedTopologyFingerprint(page), { timeout: 60_000 }).toBe(committedTopology);
  const beforeStaleBasisRefusal = await acceptedStateSnapshot(page);
  await page.locator("#pad-length").press("Enter");
  await expect(page.locator("#operation-state")).toHaveAttribute("data-error-code", "extrude_stale_preview_basis", { timeout: 60_000 });
  await expect(page.locator("#operation-state")).toHaveAttribute("data-error-category", "stale_reference");
  await expect(page.locator("#operation-state")).toHaveAttribute("data-error-field", "extrude.preview_basis");
  await expect(page.locator("#operation-state")).toHaveAttribute("data-error-references", JSON.stringify([targetBodyId]));
  await expect.poll(() => observedTopologyFingerprint(page), { timeout: 60_000 }).toBe(committedTopology);
  const afterStaleBasisRefusal = await acceptedStateSnapshot(page);
  expect(afterStaleBasisRefusal.checksum).toBe(beforeStaleBasisRefusal.checksum);
  expect(afterStaleBasisRefusal.durable).toEqual(beforeStaleBasisRefusal.durable);
  expect(afterStaleBasisRefusal.selection).toEqual(beforeStaleBasisRefusal.selection);
  expect(afterStaleBasisRefusal.rendererBodyId).toBe(targetBodyId);
  const staleBasisAtomic = afterStaleBasisRefusal.checksum === beforeStaleBasisRefusal.checksum
    && afterStaleBasisRefusal.rendererFingerprint === committedTopology;

  await page.locator(`[data-feature-id="${featureId}"]`).click();
  await page.locator('[data-feature-action="edit-extrude"]').click();
  await expect(page.locator("#operation-state")).toHaveAttribute("data-preview-source", "worker-render-packet", { timeout: 60_000 });
  await page.locator("#pad-length").fill("1.5");
  await expect.poll(() => observedTopologyFingerprint(page), { timeout: 60_000 }).not.toBe(committedTopology);
  const beforeWorkerRefusal = await acceptedStateSnapshot(page);
  await page.evaluate(() => { (window as unknown as { __solidFeatureNextCutCommitFault?: "missing_target" }).__solidFeatureNextCutCommitFault = "missing_target"; });
  await page.locator("#pad-length").press("Enter");
  await expect(page.locator("#operation-state")).toHaveAttribute("data-error-code", "missing_cut_target", { timeout: 60_000 });
  await expect(page.locator("#operation-state")).toHaveAttribute("data-error-category", "reference");
  await expect(page.locator("#operation-state")).toHaveAttribute("data-error-field", "participant_bodies.target");
  await expect(page.locator("#operation-state")).toHaveAttribute("data-error-references", JSON.stringify(["body:missing:qualification-cut-target"]));
  await expect.poll(() => observedTopologyFingerprint(page), { timeout: 60_000 }).toBe(committedTopology);
  const afterWorkerRefusal = await acceptedStateSnapshot(page);
  expect(afterWorkerRefusal.checksum).toBe(beforeWorkerRefusal.checksum);
  expect(afterWorkerRefusal.durable).toEqual(beforeWorkerRefusal.durable);
  expect(afterWorkerRefusal.selection).toEqual(beforeWorkerRefusal.selection);
  expect(afterWorkerRefusal.rendererBodyId).toBe(targetBodyId);
  const workerRefusalAtomic = afterWorkerRefusal.checksum === beforeWorkerRefusal.checksum
    && afterWorkerRefusal.rendererFingerprint === committedTopology;

  await page.locator(`[data-feature-id="${featureId}"]`).click();
  await page.locator('[data-feature-action="edit-extrude"]').click();
  await expect(page.locator("#operation-state")).toHaveAttribute("data-preview-source", "worker-render-packet", { timeout: 60_000 });
  await page.locator("#pad-length").fill("1.5");
  await expect.poll(() => observedTopologyFingerprint(page), { timeout: 60_000 }).not.toBe(committedTopology);
  const finalEditPreviewTopology = await observedTopologyFingerprint(page);
  await commitExtrude(page);
  await expect.poll(() => observedTopologyFingerprint(page), { timeout: 60_000 }).toBe(finalEditPreviewTopology);
  let editedTopology = await observedTopologyFingerprint(page);
  const edited = await page.evaluate(() => window.__crawlerApp.durableDocument()) as any;
  const [editedFeatureId, editedDefinition] = cutDefinition(edited);
  expect(editedFeatureId).toBe(featureId);
  expect(editedDefinition.participant_bodies).toEqual([{ role: "target", body: targetBodyId }]);
  expect(Object.keys(edited.bodies ?? {}).sort()).toEqual(initialBodyIds);
  let editedHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());

  // Change an upstream, solver-owned sketch dimension through the production
  // sketch worker. The downstream Cut must recompute without changing its
  // feature identity or explicit target-body intent.
  const sourceSketchId = editedDefinition.operation?.profile?.sketch;
  expect(sourceSketchId).toBeTruthy();
  await page.locator(`[data-sketch-id="${sourceSketchId}"]`).click();
  await page.locator("#edit-sketch").click();
  await page.evaluate(async () => window.__crawlerApp.applySketchCommands([{
    kind: "add_constraint",
    id: "qualification:cut:width-dimension",
    constraint: {
      kind: "distance_x",
      a: { geometry: "qualification:cut:outer", anchor: "min" },
      b: { geometry: "qualification:cut:outer", anchor: "max" },
      distance_nm: 6_000_000,
    },
  }]));
  await page.locator("#finish-sketch-ribbon").click();
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "committed", { timeout: 60_000 });
  await expect(page.locator("#storage-status")).toHaveText("autosaved", { timeout: 60_000 });
  await page.locator(`[data-sketch-id="${sourceSketchId}"]`).click();
  await page.locator("#edit-sketch").click();
  await page.evaluate(async () => window.__crawlerApp.applySketchCommands([{
    kind: "set_constraint",
    id: "qualification:cut:width-dimension",
    constraint: {
      kind: "distance_x",
      a: { geometry: "qualification:cut:outer", anchor: "min" },
      b: { geometry: "qualification:cut:outer", anchor: "max" },
      distance_nm: 5_000_000,
    },
  }]));
  const beforeDimensionTopology = editedTopology;
  await page.locator("#finish-sketch-ribbon").click();
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "committed", { timeout: 60_000 });
  await expect(page.locator("#storage-status")).toHaveText("autosaved", { timeout: 60_000 });
  await expect.poll(() => observedTopologyFingerprint(page), { timeout: 60_000 }).not.toBe(beforeDimensionTopology);
  editedTopology = await observedTopologyFingerprint(page);
  const dimensionEdited = await page.evaluate(() => window.__crawlerApp.durableDocument()) as any;
  const [dimensionEditedFeatureId, dimensionEditedDefinition] = cutDefinition(dimensionEdited);
  expect(dimensionEditedFeatureId).toBe(featureId);
  expect(dimensionEditedDefinition.participant_bodies).toEqual([{ role: "target", body: targetBodyId }]);
  const upstreamRecompute = await page.evaluate(() => window.__crawlerApp.recompute());
  expect(upstreamRecompute).toMatchObject({ evaluationOrder: expect.arrayContaining([featureId]) });
  const upstreamDimensionRecomputed = upstreamRecompute.evaluationOrder.includes(featureId)
    && dimensionEditedFeatureId === featureId
    && dimensionEditedDefinition.participant_bodies?.[0]?.body === targetBodyId;
  editedHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());

  const beforeSuppressionHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  await page.locator(`[data-feature-id="${featureId}"]`).click();
  await page.locator('[data-feature-action="suppress"]').click();
  await expect(page.locator('[data-feature-action="suppress"]')).toHaveText("Resume", { timeout: 60_000 });
  await expect.poll(() => page.evaluate((id) => {
    const durable = window.__crawlerApp.durableDocument() as { features?: Record<string, { suppressed?: boolean }> };
    return durable.features?.[id]?.suppressed;
  }, featureId), { timeout: 60_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum()), { timeout: 60_000 }).not.toBe(beforeSuppressionHash);
  await expect.poll(() => observedTopologyFingerprint(page), { timeout: 60_000 }).not.toBe(editedTopology);
  await page.locator('[data-feature-action="suppress"]').click();
  await expect(page.locator('[data-feature-action="suppress"]')).toHaveText("Suppress", { timeout: 60_000 });
  await expect.poll(() => page.evaluate((id) => {
    const durable = window.__crawlerApp.durableDocument() as { features?: Record<string, { suppressed?: boolean }> };
    return durable.features?.[id]?.suppressed;
  }, featureId), { timeout: 60_000 }).toBe(false);
  await expect(page.locator('[data-history-action="recompute"]')).toBeVisible({ timeout: 60_000 });
  await page.locator('[data-history-action="recompute"]').click();
  await expect(page.locator("#timeline-status")).toContainText("Recomputed", { timeout: 60_000 });
  await expect.poll(() => page.evaluate((expectedTarget) => {
    const durable = window.__crawlerApp.durableDocument() as { bodies?: Record<string, unknown>; feature_definitions_v2?: Record<string, CutDefinition> };
    return Boolean(durable.bodies?.[expectedTarget])
      && Object.values(durable.feature_definitions_v2 ?? {}).some((definition) =>
        definition.result?.mode === "cut" && definition.participant_bodies?.[0]?.body === expectedTarget);
  }, targetBodyId), { timeout: 60_000 }).toBe(true);
  await expect.poll(() => observedTopologyFingerprint(page), { timeout: 60_000 }).toBe(editedTopology);
  const resumedHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());

  await page.keyboard.press("Control+z");
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum()), { timeout: 60_000 }).not.toBe(resumedHash);
  await page.keyboard.press("Control+y");
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum()), { timeout: 60_000 }).toBe(resumedHash);
  await expect(page.locator("#storage-status")).toHaveText("autosaved", { timeout: 60_000 });
  await page.keyboard.press("Control+s");
  await expect(page.locator("#storage-status")).toHaveText("saved", { timeout: 60_000 });
  expect(await page.evaluate(() => window.__crawlerApp.hasExplicitSave())).toBe(true);

  // Init scripts create fresh audit arrays after navigation, so retain the
  // lifecycle worker exchange before reopening the durable document.
  const lifecycleWorkerEvidence = await page.evaluate(() => ({
    urls: (window as unknown as { __solidFeatureWorkerUrls?: string[] }).__solidFeatureWorkerUrls ?? [],
    messages: (window as unknown as { __solidFeatureWorkerMessages?: { type: string }[] }).__solidFeatureWorkerMessages ?? [],
  }));

  await page.goto("/");
  await waitUntilReady(page);
  await dismissQuickTour(page);
  await expect(page.locator("#storage-status")).toHaveText("recovered", { timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum()), { timeout: 60_000 }).toBe(resumedHash);
  const reopened = await page.evaluate(() => window.__crawlerApp.durableDocument()) as any;
  const [reopenedFeatureId, reopenedDefinition] = cutDefinition(reopened);
  expect(reopenedFeatureId).toBe(featureId);
  expect(reopenedDefinition.participant_bodies).toEqual([{ role: "target", body: targetBodyId }]);
  expect(Object.keys(reopened.bodies ?? {}).sort()).toEqual(initialBodyIds);
  await expect.poll(() => observedTopologyFingerprint(page), { timeout: 60_000 }).toBe(editedTopology);
  await successScreenshot(page, "cut-reopened.png");

  const reopenedWorkerEvidence = await page.evaluate(() => ({
    urls: (window as unknown as { __solidFeatureWorkerUrls?: string[] }).__solidFeatureWorkerUrls ?? [],
    messages: (window as unknown as { __solidFeatureWorkerMessages?: { type: string }[] }).__solidFeatureWorkerMessages ?? [],
  }));
  const lifecycleWorkerExecuted = lifecycleWorkerEvidence.urls.some((url) => /model\.worker-[A-Za-z0-9_-]+\.js/.test(url))
    && lifecycleWorkerEvidence.messages.some((message) => message.type === "extrude-preview");
  const reopenedWorkerExecuted = reopenedWorkerEvidence.urls.some((url) => /model\.worker-[A-Za-z0-9_-]+\.js/.test(url));
  const generatedWasmVerified = lifecycleWorkerExecuted
    && reopenedWorkerExecuted
    && servedWasmSha256 === candidateWasmSha256;
  expect(generatedWasmVerified).toBe(true);
  expect(failures.consoleErrors).toEqual([]);
  expect(failures.pageErrors).toEqual([]);

  const committedBodyIds = Object.keys(committed.bodies ?? {}).sort();
  const createdBodyIds = committedBodyIds.filter((bodyId) => !initialBodyIds.includes(bodyId));
  const affectedBodyIds = (committedDefinition.participant_bodies ?? [])
    .filter((participant) => participant.role === "target" && participant.body && committedTopology !== acceptedTopologyBeforePreview)
    .map((participant) => participant.body!);
  expect(affectedBodyIds).toEqual([targetBodyId]);
  expect(createdBodyIds).toEqual([]);

  const descriptor = await fixtureDescriptor("production-single-target-cut-lifecycle");
  const observedResult: Record<string, unknown> = {
    explicit_target_required: dispatchesAfterMissingTarget === dispatchesBeforeMissingTarget,
    preview_nonmutating: previewHash === acceptedBeforePreview,
    cancel_restores_accepted: cancelledTopology === acceptedTopologyBeforePreview && previewTopology !== acceptedTopologyBeforePreview,
    commit_retains_target: committedDefinition.participant_bodies?.[0]?.body === targetBodyId && Boolean(committed.bodies[targetBodyId]),
    edit_recompute_retains_identity: editedFeatureId === featureId && editedDefinition.participant_bodies?.[0]?.body === targetBodyId,
    suppress_unsuppress_roundtrip: await page.evaluate((id) => {
      const durable = window.__crawlerApp.durableDocument() as { features?: Record<string, { suppressed?: boolean }> };
      return durable.features?.[id]?.suppressed === false;
    }, featureId),
    undo_redo_roundtrip: await page.evaluate(() => window.__crawlerApp.durableChecksum()) === resumedHash,
    save_reopen_equal: reopenedFeatureId === featureId && reopenedDefinition.participant_bodies?.[0]?.body === targetBodyId,
    failure_atomic: dispatchesAfterMissingTarget === dispatchesBeforeMissingTarget,
    actual_tool_entry_parity: actualToolEntryParity,
    removal_volume_distinguished: removalVolumeDistinguished,
    stale_preview_rejected: stalePreviewRejected,
    stale_basis_atomic: staleBasisAtomic,
    upstream_dimension_recomputed: upstreamDimensionRecomputed,
    worker_refusal_atomic: workerRefusalAtomic,
    generated_wasm_verified: generatedWasmVerified,
    screenshots: ["cut-preview", "cut-committed", "cut-edit", "cut-reopened"],
  };
  const expectedKeys = Object.keys((descriptor.expected as { result?: Record<string, unknown> }).result ?? {});
  const actualResult = Object.fromEntries(expectedKeys.map((key) => {
    if (!(key in observedResult)) throw new Error(`Production Cut descriptor declares an unobserved result field: ${key}`);
    return [key, observedResult[key]];
  }));
  await writeBrowserFixtureEvidence(
    "production-single-target-cut-lifecycle",
    "web/crawler-app/tests/solid-feature-cut-qualification.spec.ts",
    { kind: "success", result: actualResult },
    {
      source_spec: "tests/solid-feature-cut-qualification.spec.ts",
      lifecycle_executed: ["preview", "cancel", "commit", "edit", "recompute", "suppress", "unsuppress", "undo", "redo", "save", "reopen"],
      explicit_target_selected: true,
      preview_source: "worker-render-packet",
      result_mode: "cut",
      target_body_id: targetBodyId,
      target_body_retained: Boolean(reopened.bodies?.[targetBodyId]),
      affected_body_count: affectedBodyIds.length,
      created_body_count: createdBodyIds.length,
      missing_target_zero_dispatch: dispatchesAfterMissingTarget === dispatchesBeforeMissingTarget,
      accepted_state_unchanged_on_failure: true,
      actual_tool_entry_parity: actualToolEntryParity,
      tool_entry_bindings: { ribbon: toolFirstBinding, model_menu: selectionFirstBinding },
      legacy_advanced_dispatch_observed: !noLegacyAdvancedDispatch,
      removal_volume_distinguished: removalVolumeDistinguished,
      removal_preview_state: removalPreview,
      stale_preview_rejected: stalePreviewRejected,
      stale_preview_delivery_distances_nm: cutPreviewDeliveries,
      stale_basis_atomic: staleBasisAtomic,
      stale_basis_diagnostic: { code: "extrude_stale_preview_basis", category: "stale_reference", field: "extrude.preview_basis", referenced_entity_ids: [targetBodyId] },
      upstream_dimension_recomputed: upstreamDimensionRecomputed,
      upstream_dimension_transition_nm: [6_000_000, 5_000_000],
      upstream_recompute_evaluation_order: upstreamRecompute.evaluationOrder,
      worker_refusal_atomic: workerRefusalAtomic,
      worker_refusal_diagnostic: { code: "missing_cut_target", category: "reference", field: "participant_bodies.target", referenced_entity_ids: ["body:missing:qualification-cut-target"] },
      feature_id: featureId,
      committed_hash: committedHash,
      edited_hash: editedHash,
      reopened_hash: resumedHash,
      accepted_topology_fingerprint: acceptedTopologyBeforePreview,
      preview_topology_fingerprint: previewTopology,
      committed_topology_fingerprint: committedTopology,
      edited_topology_fingerprint: editedTopology,
      generated_worker_urls: [...lifecycleWorkerEvidence.urls, ...reopenedWorkerEvidence.urls],
      lifecycle_worker_message_types: lifecycleWorkerEvidence.messages.map((message) => message.type),
      served_wasm_sha256: servedWasmSha256,
      console_errors: failures.consoleErrors.length,
      page_errors: failures.pageErrors.length,
    },
  );
});

test("production Cut retains its last valid result across upstream invalidation, reopen, and repair", async ({ page }) => {
  const failures = collectBrowserFailures(page);
  await installWorkerMessageAudit(page);
  await page.goto("/?qualificationReferencePart=1");
  await waitUntilReady(page);
  await dismissQuickTour(page);

  const targetBodyId = await currentTargetBody(page);
  await page.locator('[data-origin-plane-id="origin-plane:xy"]').click();
  await page.locator("#create-offset-plane").first().click();
  await page.locator("#construction-plane-offset").fill("5");
  await expect(page.locator("#apply-construction-plane")).toBeEnabled({ timeout: 60_000 });
  await page.locator("#apply-construction-plane").click();
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "committed", { timeout: 60_000 });
  const planeId = (await page.evaluate(() => window.__crawlerApp.constructionPlanes()))[0]?.id;
  expect(planeId).toBeTruthy();
  await createQualifiedSketch(page, "rectangle", "qualification:cut-recovery", true, { kind: "construction", plane: planeId! }, {
    rectangle: { min: { x_nm: 2_000_000, y_nm: 1_000_000 }, max: { x_nm: 8_000_000, y_nm: 5_000_000 } },
  });
  expect(await page.evaluate(() => window.__crawlerApp.selectFirst("body")?.bodyId)).toBe(targetBodyId);
  await cutRibbonTool(page).click();
  await expect(page.locator("#operation-state")).toHaveAttribute("data-target-body-id", targetBodyId, { timeout: 60_000 });
  await page.locator("#pad-length").fill("2");
  await commitExtrude(page);

  const accepted = await page.evaluate(() => window.__crawlerApp.durableDocument()) as any;
  const [featureId, definition] = cutDefinition(accepted);
  const sourceSketchId = definition.operation?.profile?.sketch;
  expect(sourceSketchId).toBeTruthy();
  const sourceFeatureId = Object.entries(accepted.features ?? {}).find(([, candidate]) => {
    const feature = candidate as { operation?: { schema_id?: string }; inputs?: Record<string, { kind?: string; id?: string }> };
    return feature.operation?.schema_id === "crawler.operation.sketch"
      && Object.values(feature.inputs ?? {}).some((input) => input.kind === "sketch" && input.id === sourceSketchId);
  })?.[0];
  expect(sourceFeatureId).toBeTruthy();
  const beforeSupportEditTopology = await observedTopologyFingerprint(page);
  const lastValidBodyIds = Object.keys(accepted.bodies ?? {}).sort();

  await page.locator(`[data-construction-plane-id="${planeId}"]`).dblclick();
  await page.locator("#construction-plane-offset").fill("4");
  await expect(page.locator("#apply-construction-plane")).toBeEnabled({ timeout: 60_000 });
  await page.locator("#apply-construction-plane").click();
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "committed", { timeout: 60_000 });
  await expect.poll(() => observedTopologyFingerprint(page), { timeout: 60_000 }).not.toBe(beforeSupportEditTopology);
  const supportEdited = await page.evaluate(() => window.__crawlerApp.durableDocument()) as any;
  const [supportEditedFeatureId, supportEditedDefinition] = cutDefinition(supportEdited);
  expect(supportEditedFeatureId).toBe(featureId);
  expect(supportEditedDefinition.participant_bodies).toEqual([{ role: "target", body: targetBodyId }]);
  expect((await page.evaluate(() => window.__crawlerApp.constructionPlanes()))[0]?.id).toBe(planeId);
  const supportEditRecompute = await page.evaluate(() => window.__crawlerApp.recompute());
  expect(supportEditRecompute.evaluationOrder).toEqual([featureId]);
  const lastValidTopology = await observedTopologyFingerprint(page);

  await page.evaluate((sourceFeature) => window.__crawlerApp.commitDocumentChanges([{
    kind: "set_feature_suppressed",
    feature: sourceFeature,
    suppressed: true,
  }]), sourceFeatureId!);
  await expect.poll(() => page.evaluate((sourceFeature) => {
    const durable = window.__crawlerApp.durableDocument() as { features?: Record<string, { suppressed?: boolean }> };
    return durable.features?.[sourceFeature]?.suppressed;
  }, sourceFeatureId!), { timeout: 60_000 }).toBe(true);
  await expect.poll(() => observedTopologyFingerprint(page), { timeout: 60_000 }).toBe(lastValidTopology);

  await page.locator(`[data-feature-id="${featureId}"]`).click();
  await page.locator('[data-history-action="recompute"]').click();
  await expect(page.locator("#timeline-status")).toContainText("Recompute blocked", { timeout: 60_000 });
  expect(await page.evaluate(() => window.__crawlerApp.recompute())).toEqual({ dirtyRoots: [featureId], evaluationOrder: [] });
  const blockedOutcome = await page.evaluate(() => window.__crawlerApp.recomputeOutcome());
  expect(blockedOutcome).toMatchObject({
    accepted: false,
    plan: { requested_from: featureId, evaluation_order: [] },
    error: {
      code: "suppressed_required_input",
      category: "reference",
      field: "recompute.required_inputs",
      referenced_entity_ids: [sourceFeatureId],
    },
  });
  expect(await observedTopologyFingerprint(page)).toBe(lastValidTopology);
  const failedHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  const failedDocument = await page.evaluate(() => window.__crawlerApp.durableDocument()) as any;
  expect(Object.keys(failedDocument.bodies ?? {}).sort()).toEqual(lastValidBodyIds);
  expect(cutDefinition(failedDocument)[0]).toBe(featureId);

  await page.keyboard.press("Control+s");
  await expect(page.locator("#storage-status")).toHaveText("saved", { timeout: 60_000 });
  await page.goto("/");
  await waitUntilReady(page);
  await dismissQuickTour(page);
  await expect(page.locator("#storage-status")).toHaveText("recovered", { timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum()), { timeout: 60_000 }).toBe(failedHash);
  const reopenedFailedHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  await expect.poll(() => observedTopologyFingerprint(page), { timeout: 60_000 }).toBe(lastValidTopology);
  await page.locator(`[data-feature-id="${featureId}"]`).click();
  await page.locator('[data-history-action="recompute"]').click();
  await expect(page.locator("#timeline-status")).toContainText("Recompute blocked", { timeout: 60_000 });
  const reopenedBlockedOutcome = await page.evaluate(() => window.__crawlerApp.recomputeOutcome());
  expect(reopenedBlockedOutcome).toMatchObject({
    accepted: false,
    plan: { requested_from: featureId, evaluation_order: [] },
    error: { code: "suppressed_required_input", referenced_entity_ids: [sourceFeatureId] },
  });

  await page.evaluate((sourceFeature) => window.__crawlerApp.commitDocumentChanges([{
    kind: "set_feature_suppressed",
    feature: sourceFeature,
    suppressed: false,
  }]), sourceFeatureId!);
  await expect.poll(() => page.evaluate((sourceFeature) => {
    const durable = window.__crawlerApp.durableDocument() as { features?: Record<string, { suppressed?: boolean }> };
    return durable.features?.[sourceFeature]?.suppressed;
  }, sourceFeatureId!), { timeout: 60_000 }).toBe(false);
  await page.locator(`[data-feature-id="${featureId}"]`).click();
  await page.locator('[data-history-action="recompute"]').click();
  await expect(page.locator("#timeline-status")).toContainText("Recomputed", { timeout: 60_000 });
  const repairedOutcome = await page.evaluate(() => window.__crawlerApp.recomputeOutcome());
  expect(repairedOutcome).toMatchObject({
    accepted: true,
    plan: { requested_from: featureId, evaluation_order: [featureId] },
    recomputed: [{ feature: featureId, body: targetBodyId }],
    transaction: {
      changes: [expect.objectContaining({ kind: "accept_feature_result", feature: featureId, body: targetBodyId })],
    },
  });
  await expect.poll(() => observedTopologyFingerprint(page), { timeout: 60_000 }).toBe(lastValidTopology);
  const repaired = await page.evaluate(() => window.__crawlerApp.durableDocument()) as any;
  const [repairedFeatureId, repairedDefinition] = cutDefinition(repaired);
  expect(repairedFeatureId).toBe(featureId);
  expect(repairedDefinition.participant_bodies).toEqual([{ role: "target", body: targetBodyId }]);
  expect(Object.keys(repaired.bodies ?? {}).sort()).toEqual(lastValidBodyIds);
  await successScreenshot(page, "cut-last-valid-recovery.png");
  await mergeBrowserFixtureAssertions("production-single-target-cut-lifecycle", {
    support_edit_recomputed: true,
    support_edit_recompute_evaluation_order: supportEditRecompute.evaluationOrder,
    last_valid_result_retained: true,
    blocked_recompute_diagnostic: blockedOutcome.error,
    blocked_recompute_evaluation_order: blockedOutcome.plan?.evaluation_order,
    failed_state_save_reopen_equal: reopenedFailedHash === failedHash && reopenedBlockedOutcome?.accepted === false,
    reopened_failure_diagnostic_equal: JSON.stringify(reopenedBlockedOutcome?.error) === JSON.stringify(blockedOutcome.error),
    repaired_recompute_accepted: repairedOutcome?.accepted === true,
    repaired_recompute_requested_from: repairedOutcome?.plan?.requested_from,
    repaired_recompute_evaluation_order: repairedOutcome?.plan?.evaluation_order,
    repaired_recompute_transaction: repairedOutcome?.transaction,
    repaired_recomputed_results: repairedOutcome?.recomputed,
    recovery_cut_feature_id: featureId,
    repaired_feature_id_retained: repairedFeatureId === featureId,
    repaired_target_body_id_retained: repairedDefinition.participant_bodies?.[0]?.body === targetBodyId,
    repaired_body_set_retained: JSON.stringify(Object.keys(repaired.bodies ?? {}).sort()) === JSON.stringify(lastValidBodyIds),
    recovery_screenshot: "cut-last-valid-recovery",
  });
  expect(failures.consoleErrors).toEqual([]);
  expect(failures.pageErrors).toEqual([]);
});
