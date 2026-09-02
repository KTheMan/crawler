import { expect, test, type Page } from "@playwright/test";

import {
  collectBrowserFailures,
  commitExtrude,
  createQualifiedPlanarFaceSketch,
  currentPositiveZPlanarFace,
  installWorkerMessageAudit,
  startExtrude,
  successScreenshot,
  waitUntilReady,
  writeBrowserFixtureEvidence,
} from "./solid-feature-qualification-helpers";

test.describe.configure({ timeout: 600_000 });

async function dismissQuickTour(page: Page): Promise<void> {
  const tour = page.locator("#onboarding");
  const exit = page.locator("#tour-exit");
  if (await exit.isVisible()) await exit.click();
  await expect(tour).toBeHidden();
}

async function qualitativeScreenshot(page: Page, name: string): Promise<void> {
  await expect(page.locator("#onboarding")).toBeHidden();
  await successScreenshot(page, name);
}

async function acceptedDocument(page: Page): Promise<Record<string, any>> {
  const json = await page.evaluate(() => (window as unknown as { __solidFeatureAcceptedDocuments?: string[] })
    .__solidFeatureAcceptedDocuments?.at(-1));
  if (!json) throw new Error("No accepted worker document was captured");
  return JSON.parse(json) as Record<string, any>;
}

function v2Extrude(document: Record<string, any>): [string, Record<string, any>] {
  const entries = Object.entries(document.feature_definitions_v2 ?? {})
    .filter(([, value]) => (value as Record<string, any>).operation?.kind === "extrude");
  if (entries.length !== 1) throw new Error(`Expected one V2 Extrude, found ${entries.length}`);
  return entries[0] as [string, Record<string, any>];
}

test("native planar-face sketch support survives Extrude lifecycle, upstream recompute, explicit repair, history, and reopen", async ({ page }) => {
  const failures = collectBrowserFailures(page);
  await installWorkerMessageAudit(page);
  await page.goto("/?qualificationReferencePart=1");
  await waitUntilReady(page);
  await dismissQuickTour(page);
  console.log("[lifecycle] ready");

  // Tool-first support binding starts with no selected face, then chooses an
  // actual current renderer face. It must resolve to the same native authority
  // as selection-first without ever authorizing from the legacy fallback ID.
  const currentPositiveZFace = await currentPositiveZPlanarFace(page);
  await page.evaluate(() => window.__crawlerApp.selectFirst("body"));
  await page.locator("#edit-sketch").click();
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.sketchSupportSelection().active), { timeout: 60_000 }).toBe(true);
  const toolFirstFace = await page.evaluate((stableId) => window.__crawlerApp.selectTopology("face", stableId), currentPositiveZFace.stable_kernel_id);
  expect(toolFirstFace?.kind).toBe("face");
  await page.evaluate((selection) => window.__crawlerApp.choosePlanarFaceSketchSupport(selection!), toolFirstFace);
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.sketchPlane()), { timeout: 60_000 }).toMatchObject({ source: "planar_face" });
  const toolFirstPlane = await page.evaluate(() => window.__crawlerApp.sketchPlane());
  await page.locator("#active-tool-cancel").click();
  await expect(page.locator(".workspace")).not.toHaveClass(/sketch-active/);
  console.log("[lifecycle] tool-first binding complete");

  const support = await createQualifiedPlanarFaceSketch(page, "qualification:planar-face", true, { width: 4_000_000, height: 3_000_000 });
  const bindingEqual = toolFirstPlane?.source === "planar_face"
    && toolFirstPlane.support.kind === "topology"
    && toolFirstPlane.support.reference === support.topologyReferenceId
    && JSON.stringify(toolFirstPlane.origin_nanometers) === JSON.stringify(support.originNanometers)
    && JSON.stringify(toolFirstPlane.x_axis_millionths) === JSON.stringify(support.xAxisMillionths)
    && JSON.stringify(toolFirstPlane.y_axis_millionths) === JSON.stringify(support.yAxisMillionths)
    && JSON.stringify(toolFirstPlane.normal_millionths) === JSON.stringify(support.normalMillionths);
  expect(bindingEqual).toBe(true);
  expect(toolFirstPlane).toMatchObject({
    source: "planar_face",
    support: { kind: "topology", reference: support.topologyReferenceId },
    origin_nanometers: support.originNanometers,
    normal_millionths: [0, 0, 1_000_000],
  });
  expect(support.faceStableId).toBe(currentPositiveZFace.stable_kernel_id);
  expect(support.topologyReferenceId).toMatch(/^topology:/);
  expect(support.faceStableId).toMatch(/^(0|[1-9][0-9]*)$/);
  const sketchDocument = await acceptedDocument(page);
  const retainedSupport = sketchDocument.topology_references?.[support.topologyReferenceId];
  expect(retainedSupport).toMatchObject({
    schema_version: 1,
    id: support.topologyReferenceId,
    component: "component:root",
    body: support.bodyId,
    kind: "face",
    stable_kernel_id: support.faceStableId,
  });
  await qualitativeScreenshot(page, "planar-face-sketch-native-frame.png");
  console.log("[lifecycle] selection-first sketch complete");

  const beforePreviewHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  await startExtrude(page, 2);
  const previewHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  await expect(page.locator("#operation-state")).toHaveAttribute("data-preview-source", "worker-render-packet");
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(previewHash);
  expect(previewHash).toBe(beforePreviewHash);
  await commitExtrude(page);
  const committed = await acceptedDocument(page);
  const [featureId, definition] = v2Extrude(committed);
  const bodyId = definition.result?.body as string;
  const sketchId = definition.operation?.profile?.sketch as string;
  const regionId = definition.operation?.profile?.region as string;
  const profileGeometryIds = [...(committed.region_definitions_v2?.[regionId]?.outer_geometry_ids ?? [])];
  expect(definition.operation?.support).toEqual({ kind: "topology_face", reference: support.topologyReferenceId });
  expect(definition.operation?.profile?.kind).toBe("sketch_region");
  expect(featureId).toMatch(/^feature:extrude:/);
  expect(bodyId).toMatch(/^body:extrude:/);
  await qualitativeScreenshot(page, "accepted-face-extrude.png");
  console.log("[lifecycle] initial extrude committed");

  const acceptedPositiveHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  await page.locator(`[data-feature-id="${featureId}"]`).click();
  await page.locator('[data-feature-action="edit-extrude"]').click();
  const directionMode = page.locator("#extrude-direction-mode");
  await expect(directionMode).toBeEnabled({ timeout: 60_000 });
  await directionMode.selectOption("negative");
  const distance = page.getByRole("spinbutton", { name: "Extrude distance in millimeters" });
  await distance.fill("6");
  await expect(page.locator("#operation-state")).toHaveAttribute("data-preview-source", "worker-render-packet", { timeout: 60_000 });
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(acceptedPositiveHash);
  await distance.press("Escape");
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "cancelled");
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(acceptedPositiveHash);

  await page.locator(`[data-feature-id="${featureId}"]`).click();
  await page.locator('[data-feature-action="edit-extrude"]').click();
  await expect(directionMode).toBeEnabled({ timeout: 60_000 });
  await directionMode.selectOption("symmetric");
  await page.getByRole("spinbutton", { name: "Extrude total length in millimeters" }).fill("8");
  await expect(page.locator("#operation-state")).toHaveAttribute("data-preview-source", "worker-render-packet", { timeout: 60_000 });
  await page.getByRole("spinbutton", { name: "Extrude total length in millimeters" }).press("Enter");
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "committed", { timeout: 60_000 });
  expect(v2Extrude(await acceptedDocument(page))[1].operation?.extent?.direction).toBe("symmetric");

  await page.locator(`[data-feature-id="${featureId}"]`).click();
  await page.locator('[data-feature-action="edit-extrude"]').click();
  await expect(directionMode).toBeEnabled({ timeout: 60_000 });
  await directionMode.selectOption("positive");
  await distance.fill("7");
  await expect(page.locator("#operation-state")).toHaveAttribute("data-preview-source", "worker-render-packet", { timeout: 60_000 });
  await commitExtrude(page);
  const edited = await acceptedDocument(page);
  const [editedFeatureId, editedDefinition] = v2Extrude(edited);
  expect(editedFeatureId).toBe(featureId);
  expect(editedDefinition.result?.body).toBe(bodyId);
  expect(editedDefinition.operation?.support).toEqual(definition.operation?.support);
  expect(editedDefinition.operation?.extent?.direction).toBe("positive");
  console.log("[lifecycle] direction previews and edits complete");

  const beforeSuppressionBounds = await page.evaluate(() => window.__crawlerApp.geometryBounds());
  await page.locator(`[data-feature-id="${featureId}"]`).click();
  await page.locator('[data-feature-action="suppress"]').click();
  await expect(page.locator('[data-feature-action="suppress"]')).toHaveText("Resume", { timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.geometryBounds()), { timeout: 60_000 }).not.toEqual(beforeSuppressionBounds);
  await page.locator('[data-feature-action="suppress"]').click();
  await expect(page.locator('[data-feature-action="suppress"]')).toHaveText("Suppress", { timeout: 60_000 });
  // Resuming a suppressed feature intentionally restores it as dirty. Execute
  // the production history action that accepts a fresh native result.
  const recomputeFeature = page.locator('[data-history-action="recompute"]');
  await expect(recomputeFeature).toBeVisible({ timeout: 60_000 });
  await recomputeFeature.click();
  await expect(page.locator("#timeline-status")).toContainText("Recomputed", { timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.geometryBounds()), { timeout: 60_000 }).toEqual(beforeSuppressionBounds);
  expect(v2Extrude(await acceptedDocument(page))[0]).toBe(featureId);
  console.log("[lifecycle] suppression and resume recompute complete");

  const sketchFeatureId = Object.entries(edited.features as Record<string, any>)
    .find(([, feature]) => feature.operation?.schema_id === "crawler.operation.sketch"
      && feature.inputs?.support?.id === support.topologyReferenceId)?.[0];
  expect(sketchFeatureId).toBeTruthy();

  // Edit the actual upstream seed Extrude height. Its accepted commit must
  // traverse producer -> face-supported sketch -> descendant Extrude and move
  // the result in Z; a width-only edit would not prove face-frame movement.
  const beforeUpstream = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  const beforeUpstreamBounds = await page.evaluate(() => window.__crawlerApp.geometryBounds());
  await page.locator('[data-origin-plane-id="origin-plane:xy"]').click();
  await page.locator("#start-pad").click();
  await page.getByRole("spinbutton", { name: "Extrude distance in millimeters" }).fill("18");
  await page.getByRole("spinbutton", { name: "Extrude distance in millimeters" }).press("Enter");
  console.log("[lifecycle] upstream commit input submitted");
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "committed", { timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum()), { timeout: 60_000 }).not.toBe(beforeUpstream);
  const upstreamEvaluationOrder = await page.evaluate(() => window.__crawlerApp.recompute().evaluationOrder);
  console.log("[lifecycle] upstream recompute order read");
  expect(upstreamEvaluationOrder).toContain("feature:extrude");
  expect(upstreamEvaluationOrder).toContain(sketchFeatureId);
  expect(upstreamEvaluationOrder).toContain(featureId);
  expect(upstreamEvaluationOrder.indexOf("feature:extrude")).toBeLessThan(upstreamEvaluationOrder.indexOf(sketchFeatureId!));
  expect(upstreamEvaluationOrder.indexOf(sketchFeatureId!)).toBeLessThan(upstreamEvaluationOrder.indexOf(featureId));
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.geometryBounds()), { timeout: 60_000 }).not.toEqual(beforeUpstreamBounds);
  const afterUpstreamBounds = await page.evaluate(() => window.__crawlerApp.geometryBounds());
  expect(afterUpstreamBounds[5] - beforeUpstreamBounds[5]).toBeCloseTo(6, 6);
  const recomputed = await acceptedDocument(page);
  expect(v2Extrude(recomputed)[0]).toBe(featureId);
  expect(v2Extrude(recomputed)[1].result?.body).toBe(bodyId);
  expect(recomputed.topology_references?.[support.topologyReferenceId]).toMatchObject({
    body: support.bodyId, stable_kernel_id: support.faceStableId,
  });
  await page.locator(`[data-sketch-id="${sketchId}"]`).click();
  await page.locator("#edit-sketch").click();
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.sketchPlane()), { timeout: 60_000 }).toMatchObject({
    source: "planar_face", origin_nanometers: [0, 0, 18_000_000], normal_millionths: [0, 0, 1_000_000],
  });
  const upstreamPlane = await page.evaluate(() => window.__crawlerApp.sketchPlane());
  await page.locator("#active-tool-cancel").click();
  console.log("[lifecycle] upstream moved face frame verified");
  expect(support.observedFace).toMatchObject({ body: support.bodyId, stable_kernel_id: support.faceStableId, kind: "face" });

  // Hydrate a production-format broken naming state: the retained support is
  // now absent from the native body while its last-good accepted body result
  // remains available. This is the same reopen boundary used for durable files,
  // not a renderer or synthetic repair response.
  const brokenDocument = structuredClone(recomputed);
  brokenDocument.topology_references[support.topologyReferenceId].stable_kernel_id = "18446744073709551615";
  brokenDocument.topology_references[support.topologyReferenceId].stable_token = `${retainedSupport.stable_token}:missing`;
  const beforeBrokenHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  await page.evaluate((documentValue) => window.__crawlerApp.hydrateDocument(documentValue), brokenDocument);
  console.log("[lifecycle] broken document hydration submitted");
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum()), { timeout: 60_000 }).not.toBe(beforeBrokenHash);
  await page.locator(`[data-feature-id="${sketchFeatureId}"]`).click();
  const repairBaseHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  const lastGoodBounds = await page.evaluate(() => window.__crawlerApp.geometryBounds());
  const repairCandidateId = `observed:repair:${support.bodyId}:${support.faceStableId}`;
  const currentRepairFace = {
    ...support.observedFace,
    id: repairCandidateId,
    stable_token: `${support.observedFace.stable_token}:repair-observed`,
  };
  const observed = [
    ...(await page.evaluate(() => window.__crawlerApp.observedTopology())).filter((candidate) =>
      candidate.kind !== "face"
      || candidate.body !== support.bodyId
      || candidate.stable_kernel_id !== support.faceStableId),
    currentRepairFace,
  ];
  await page.evaluate((value) => window.__crawlerApp.inspectRepair(value as any), observed);
  await expect(page.locator(".repair-preview")).toContainText("Evaluation stopped", { timeout: 60_000 });
  await expect(page.locator(`[data-repair-candidate="${repairCandidateId}"]`)).toBeVisible();
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(repairBaseHash);
  expect(await page.evaluate(() => window.__crawlerApp.geometryBounds())).toEqual(lastGoodBounds);
  const inspection = await page.evaluate(() => window.__crawlerApp.historyServices().repair);
  expect(inspection).toMatchObject({
    status: "evaluation_blocked",
    preview: {
      explicit_rebind_required: true,
      unresolved: { feature: sketchFeatureId, input_name: "support", reference: support.topologyReferenceId },
      candidates: [{ rank: 1, candidate: { id: repairCandidateId, body: support.bodyId, stable_kernel_id: support.faceStableId } }],
    },
  });
  await qualitativeScreenshot(page, "broken-last-good.png");
  console.log("[lifecycle] broken last-good and candidates verified");

  await page.locator(`[data-repair-candidate="${repairCandidateId}"]`).click();
  await expect(page.locator('[data-repair-preview-state="ready"]')).toBeVisible({ timeout: 60_000 });
  const cancelledPreviewBasis = await page.evaluate(() => window.__crawlerApp.topologyRebindPreview());
  expect(cancelledPreviewBasis).toMatchObject({
    selected: repairCandidateId,
    phase: "ready",
    baseDocumentHash: repairBaseHash,
    candidateFrame: {
      origin_nanometers: upstreamPlane!.origin_nanometers,
      x_axis_millionths: upstreamPlane!.x_axis_millionths,
      y_axis_millionths: upstreamPlane!.y_axis_millionths,
      normal_millionths: upstreamPlane!.normal_millionths,
    },
  });
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(repairBaseHash);
  console.log("[lifecycle] repair preview cancellation verified");
  await qualitativeScreenshot(page, "repair-preview.png");
  await page.locator("[data-cancel-repair]").click();
  await expect(page.locator("[data-repair-preview-state]")).toHaveCount(0, { timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.geometryBounds()), { timeout: 60_000 }).toEqual(lastGoodBounds);
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(repairBaseHash);

  await page.locator(`[data-repair-candidate="${repairCandidateId}"]`).click();
  await expect(page.locator('[data-repair-preview-state="ready"]')).toBeVisible({ timeout: 60_000 });
  const committedPreviewBasis = await page.evaluate(() => window.__crawlerApp.topologyRebindPreview());
  expect(committedPreviewBasis).toMatchObject({
    selected: repairCandidateId,
    phase: "ready",
    baseDocumentHash: repairBaseHash,
    baseRevision: cancelledPreviewBasis!.baseRevision,
    candidateFrame: cancelledPreviewBasis!.candidateFrame,
  });
  await page.locator("[data-apply-repair]").click();
  await expect(page.locator("#timeline-status")).toContainText("Rebound explicitly", { timeout: 60_000 });
  const repairedHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  expect(repairedHash).not.toBe(repairBaseHash);
  const repaired = await acceptedDocument(page);
  const repairedTransaction = repaired.transactions.at(-1);
  expect(repairedTransaction.changes).toHaveLength(2);
  expect(repairedTransaction.changes[0]).toMatchObject({
    kind: "rebind_topology", feature: sketchFeatureId, input_name: "support",
    from_reference: support.topologyReferenceId, replacement: { id: repairCandidateId },
  });
  expect(repairedTransaction.changes[1]).toMatchObject({ kind: "accept_feature_result", feature: featureId, body: bodyId });
  const [repairedFeatureId, repairedDefinition] = v2Extrude(repaired);
  expect(repairedFeatureId).toBe(featureId);
  expect(repairedDefinition.result?.body).toBe(bodyId);
  expect(repairedDefinition.operation?.profile).toEqual({ kind: "sketch_region", sketch: sketchId, region: regionId });
  expect(repairedDefinition.operation?.support).toEqual({ kind: "topology_face", reference: repairCandidateId });
  expect(repaired.topology_references[repairCandidateId]).toMatchObject({
    id: repairCandidateId,
    body: currentRepairFace!.body,
    producer: currentRepairFace!.producer,
    kind: "face",
    stable_kernel_id: currentRepairFace!.stable_kernel_id,
  });
  expect(repaired.features[sketchFeatureId!].inputs.support.id).toBe(repairCandidateId);
  expect(repaired.region_definitions_v2[regionId].outer_geometry_ids).toEqual(profileGeometryIds);
  expect(repaired.sketches[sketchId].support).toEqual({ kind: "topology", reference: repairCandidateId });
  const repairedBounds = await page.evaluate(() => window.__crawlerApp.geometryBounds());
  expect(repairedBounds).toEqual(lastGoodBounds);
  await qualitativeScreenshot(page, "explicitly-repaired.png");
  console.log("[lifecycle] explicit repair committed");

  await page.keyboard.press("Control+z");
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum()), { timeout: 60_000 }).toBe(repairBaseHash);
  expect(v2Extrude(await acceptedDocument(page))[1].operation?.support).toEqual({ kind: "topology_face", reference: support.topologyReferenceId });
  await page.keyboard.press("Control+y");
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum()), { timeout: 60_000 }).toBe(repairedHash);
  expect(v2Extrude(await acceptedDocument(page))[1].operation?.support).toEqual({ kind: "topology_face", reference: repairCandidateId });
  await page.keyboard.press("Control+s");
  await expect(page.locator("#storage-status")).toHaveText("saved", { timeout: 60_000 });
  expect(await page.evaluate(() => window.__crawlerApp.hasExplicitSave())).toBe(true);
  console.log("[lifecycle] undo redo and save verified");
  // Leave qualification seeding behind so startup must reopen the explicit
  // durable state rather than constructing another canonical reference part.
  await page.goto("/");
  await waitUntilReady(page);
  await dismissQuickTour(page);
  await expect(page.locator("#storage-status")).toHaveText("recovered", { timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum()), { timeout: 60_000 }).toBe(repairedHash);
  const reopened = await acceptedDocument(page);
  expect(v2Extrude(reopened)[0]).toBe(featureId);
  expect(v2Extrude(reopened)[1].result?.body).toBe(bodyId);
  expect(v2Extrude(reopened)[1].operation?.support).toEqual({ kind: "topology_face", reference: repairCandidateId });
  expect(reopened.sketches[sketchId].support).toEqual({ kind: "topology", reference: repairCandidateId });
  expect(reopened.region_definitions_v2[regionId].outer_geometry_ids).toEqual(profileGeometryIds);
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.geometryBounds()), { timeout: 60_000 }).toEqual(repairedBounds);
  await qualitativeScreenshot(page, "repaired-reopen.png");
  console.log("[lifecycle] reopen verified");
  const generatedWorkerEvidence = await page.evaluate(() => ({
    urls: (window as unknown as { __solidFeatureWorkerUrls?: string[] }).__solidFeatureWorkerUrls ?? [],
    messages: (window as unknown as { __solidFeatureWorkerMessages?: { type: string }[] }).__solidFeatureWorkerMessages ?? [],
  }));
  console.log("[lifecycle] generated worker evidence read");
  const generatedWasmVerified = generatedWorkerEvidence.urls.some((url) => /model\.worker-[A-Za-z0-9_-]+\.js/.test(url))
    && generatedWorkerEvidence.messages.some((message) => message.type === "planar-face-frame");
  expect(generatedWasmVerified).toBe(true);
  const reopenedHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  console.log("[lifecycle] reopened checksum read");
  const actualResult = {
    selection_first_tool_first_binding_equal: bindingEqual,
    preview_nonmutating: previewHash === beforePreviewHash,
    commit_edit_reopen_equal: v2Extrude(reopened)[0] === featureId
      && v2Extrude(reopened)[1].result?.body === bodyId
      && reopened.sketches[sketchId].support.reference === repairCandidateId
      && JSON.stringify(reopened.region_definitions_v2[regionId].outer_geometry_ids) === JSON.stringify(profileGeometryIds),
    upstream_recompute_transitive: upstreamEvaluationOrder.includes("feature:extrude")
      && upstreamEvaluationOrder.includes(sketchFeatureId!)
      && upstreamEvaluationOrder.includes(featureId)
      && JSON.stringify(afterUpstreamBounds) !== JSON.stringify(beforeUpstreamBounds)
      && upstreamPlane?.origin_nanometers[2] === 18_000_000,
    broken_state_retains_last_good: JSON.stringify(lastGoodBounds) === JSON.stringify(repairedBounds),
    repair_preview_actual: inspection?.status === "evaluation_blocked"
      && inspection.preview.candidates[0]?.candidate.id === repairCandidateId
      && cancelledPreviewBasis?.baseDocumentHash === repairBaseHash
      && JSON.stringify(cancelledPreviewBasis?.candidateFrame) === JSON.stringify(committedPreviewBasis?.candidateFrame),
    repair_commit_atomic: repairedTransaction.changes.length === 2
      && repairedTransaction.changes[0].kind === "rebind_topology"
      && repairedTransaction.changes[1].kind === "accept_feature_result"
      && committedPreviewBasis?.baseRevision === repairedTransaction.base_revision,
    repair_undo_redo_reopen_equal: reopenedHash === repairedHash,
    generated_wasm_verified: generatedWasmVerified,
    screenshots: ["accepted-face-extrude", "broken-last-good", "repair-preview", "repaired-reopen"],
  };
  console.log("[lifecycle] writing fixture evidence");
  await writeBrowserFixtureEvidence(
    "production-planar-face-lifecycle",
    "web/crawler-app/tests/solid-feature-planar-face-qualification.spec.ts",
    { kind: "success", result: actualResult },
    {
      support_body: support.bodyId,
      support_face_stable_id: support.faceStableId,
      topology_reference_before: support.topologyReferenceId,
      topology_reference_after: repairCandidateId,
      feature_id: featureId,
      body_id: bodyId,
      sketch_id: sketchId,
      region_id: regionId,
      profile_geometry_ids: profileGeometryIds,
      directions_executed: ["positive", "negative", "symmetric"],
      lifecycle_executed: ["preview", "cancel", "commit", "edit", "recompute", "suppress", "unsuppress", "save", "reopen", "repair", "undo", "redo"],
      upstream_evaluation_order: upstreamEvaluationOrder,
      upstream_planar_face_frame: upstreamPlane,
      cancelled_repair_preview_basis: cancelledPreviewBasis,
      committed_repair_preview_basis: committedPreviewBasis,
      repair_transaction_changes: repairedTransaction.changes,
      generated_worker_urls: generatedWorkerEvidence.urls,
    },
  );
  console.log("[lifecycle] fixture evidence written");
  expect(failures.consoleErrors).toEqual([]);
  expect(failures.pageErrors).toEqual([]);
  console.log("[lifecycle] browser failure audit clean");
});
