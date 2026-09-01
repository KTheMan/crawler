import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  collectBrowserFailures,
  commitExtrude,
  createQualifiedSketch,
  fixtureDescriptor,
  installWorkerMessageAudit,
  openExtrudeEdit,
  startExtrude,
  successScreenshot,
  waitUntilReady,
  writeBrowserFixtureEvidence,
} from "./solid-feature-qualification-helpers";

test.describe.configure({ timeout: 300_000 });

const roundedBounds = (bounds: number[]): number[] => bounds.map((value) => Math.round(value * 1_000) / 1_000);

async function installWorkerCommandAudit(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const nativePostMessage = Worker.prototype.postMessage;
    const commands: Array<{ type: string }> = [];
    Worker.prototype.postMessage = function postMessage(message: unknown, transfer?: Transferable[]): void {
      const type = typeof message === "object" && message !== null && "type" in message
        ? String((message as { type?: unknown }).type)
        : typeof message;
      commands.push({ type });
      if (transfer) nativePostMessage.call(this, message, transfer);
      else nativePostMessage.call(this, message);
    };
    (window as unknown as { __solidFeatureWorkerCommands: typeof commands }).__solidFeatureWorkerCommands = commands;
  });
}

async function canonicalExtrudeDefinition(page: Page): Promise<Record<string, unknown>> {
  const documentJson = await page.evaluate(() => {
    const documents = (window as unknown as { __solidFeatureAcceptedDocuments?: string[] }).__solidFeatureAcceptedDocuments ?? [];
    return documents.at(-1);
  });
  expect(documentJson, "worker audit must retain the latest accepted document").toBeTruthy();
  const durable = JSON.parse(documentJson!) as {
    feature_definitions_v2?: Record<string, {
      operation?: {
        kind?: string;
        profile?: { kind?: string };
        support?: { kind?: string; plane?: string };
        extent?: { kind?: string; distance?: string; direction?: string };
        modifiers?: string;
      };
      result?: { mode?: string };
    }>;
    parameters?: Record<string, { value?: { kind?: string; value?: number } }>;
  };
  const extrudes = Object.values(durable.feature_definitions_v2 ?? {}).filter((definition) => definition.operation?.kind === "extrude");
  expect(extrudes).toHaveLength(1);
  const definition = extrudes[0];
  const distance = definition.operation?.extent?.distance;
  return {
    operation: {
      kind: definition.operation?.kind,
      profile_kind: definition.operation?.profile?.kind,
      support: definition.operation?.support,
      extent_kind: definition.operation?.extent?.kind,
      direction: definition.operation?.extent?.direction,
      modifiers: definition.operation?.modifiers,
      distance: distance ? durable.parameters?.[distance]?.value : undefined,
    },
    result_mode: definition.result?.mode,
  };
}

type DurableExtrudeState = {
  featureId: string;
  bodyId: string;
  sketchId: string;
  regionId: string;
  supportKind: string;
  supportPlane: string;
  profileGeometryIds: string[];
  distanceNanometers: number;
};

async function durableExtrudeState(page: Page, requestedFeatureId?: string): Promise<DurableExtrudeState> {
  const documentJson = await page.evaluate(() => {
    const documents = (window as unknown as { __solidFeatureAcceptedDocuments?: string[] }).__solidFeatureAcceptedDocuments ?? [];
    return documents.at(-1);
  });
  expect(documentJson, "worker audit must retain the latest accepted document").toBeTruthy();
  const durable = JSON.parse(documentJson!) as {
    feature_definitions_v2?: Record<string, {
      operation?: {
        kind?: string;
        profile?: { kind?: string; sketch?: string; region?: string };
        support?: { kind?: string; plane?: string };
        extent?: { kind?: string; distance?: string };
      };
      result?: { body?: string };
    }>;
    region_definitions_v2?: Record<string, { sketch?: string; outer_geometry_ids?: string[] }>;
    parameters?: Record<string, { value?: { kind?: string; value?: number } }>;
  };
  const candidates = Object.entries(durable.feature_definitions_v2 ?? {})
    .filter(([featureId, definition]) => definition.operation?.kind === "extrude" && (!requestedFeatureId || featureId === requestedFeatureId));
  expect(candidates).toHaveLength(1);
  const [featureId, definition] = candidates[0];
  const profile = definition.operation?.profile;
  const distanceId = definition.operation?.extent?.distance;
  const region = profile?.region ? durable.region_definitions_v2?.[profile.region] : undefined;
  const distance = distanceId ? durable.parameters?.[distanceId]?.value : undefined;
  expect(profile?.kind).toBe("sketch_region");
  expect(profile?.sketch).toBeTruthy();
  expect(profile?.region).toBeTruthy();
  expect(region?.sketch).toBe(profile?.sketch);
  expect(region?.outer_geometry_ids?.length).toBeGreaterThan(0);
  expect(definition.operation?.support?.kind).toBeTruthy();
  expect(definition.operation?.support?.plane).toBeTruthy();
  expect(definition.result?.body).toBeTruthy();
  expect(distance).toEqual({ kind: "length_nanometers", value: expect.any(Number) });
  return {
    featureId,
    bodyId: definition.result!.body!,
    sketchId: profile!.sketch!,
    regionId: profile!.region!,
    supportKind: definition.operation!.support!.kind!,
    supportPlane: definition.operation!.support!.plane!,
    profileGeometryIds: [...region!.outer_geometry_ids!],
    distanceNanometers: distance!.value!,
  };
}

async function openExtrudeEditById(page: Page, featureId: string): Promise<void> {
  await page.locator(`[data-feature-id="${featureId}"]`).click();
  const edit = page.locator('[data-feature-action="edit-extrude"]');
  await expect(edit).toBeVisible();
  await edit.click();
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "preview");
  await expect(page.getByRole("spinbutton", { name: "Extrude distance in millimeters" })).toBeFocused();
}

async function exerciseSelectedRegionReplacement(
  browser: Browser,
  baseURL: string,
): Promise<{
  featureIdRetained: boolean;
  bodyIdRetained: boolean;
  sourceSketchRetained: boolean;
  replacementRegionPersisted: boolean;
  cancelRestoredAcceptedState: boolean;
  recomputeCorrect: boolean;
  reloadPersisted: boolean;
  crossSketchReplacementRejected: boolean;
  crossSketchAcceptedStateUnchanged: boolean;
  crossSketchReferencesUnchanged: boolean;
  crossSketchFeatureAndBodyIdsRetained: boolean;
  crossSketchGeometryUnchanged: boolean;
  crossSketchFeatureCountUnchanged: boolean;
  crossSketchNoInvalidPreviewOrCommit: boolean;
  crossSketchExplicitError: boolean;
  crossSketchZeroPreviewOrCommitDispatch: boolean;
  crossSketchEditBlocked: boolean;
  crossSketchErrorReason: string;
  workerCount: number;
  consoleErrors: number;
  pageErrors: number;
}> {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const failures = collectBrowserFailures(page);
  await installWorkerCommandAudit(page);
  await installWorkerMessageAudit(page);
  try {
    await page.goto("/");
    await waitUntilReady(page);
    await page.locator("#edit-sketch").click();
    await page.evaluate(() => window.__crawlerApp.chooseOriginSketchSupport("xy"));
    await page.evaluate(async () => window.__crawlerApp.applySketchCommands([
      {
        kind: "add_geometry",
        entity: { id: "qualification:replacement:original", geometry: { kind: "circle", center: { x_nm: 0, y_nm: 0 }, radius_nm: 12_000_000 } },
      },
      {
        kind: "add_geometry",
        entity: { id: "qualification:replacement:new", geometry: { kind: "circle", center: { x_nm: 30_000_000, y_nm: 0 }, radius_nm: 6_000_000 } },
      },
    ]));
    const overlay = page.getByLabel("Editable sketch geometry");
    await expect(overlay.locator("[data-sketch-profile-id]")).toHaveCount(2, { timeout: 60_000 });
    const originalProfile = overlay.locator('[data-sketch-profile-id][data-profile-geometry-ids*="qualification:replacement:original"]');
    await originalProfile.dispatchEvent("pointerdown", { button: 0, pointerId: 402 });
    await expect(originalProfile).toHaveAttribute("aria-pressed", "true");
    await page.locator("#finish-sketch-ribbon").click();
    await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "committed", { timeout: 60_000 });
    await expect(page.locator("#start-pad")).toBeEnabled();
    await startExtrude(page, 4);
    await commitExtrude(page);
    const original = await durableExtrudeState(page);
    expect(original.profileGeometryIds).toEqual(["qualification:replacement:original"]);
    expect(original.distanceNanometers).toBe(4_000_000);

    // Select the second compatible region from the source sketch immediately
    // before opening timeline edit so explicit selection wins over stored refs.
    await page.locator(`[data-sketch-id="${original.sketchId}"]`).click();
    await page.locator("#edit-sketch").click();
    const replacementProfile = page.getByLabel("Editable sketch geometry")
      .locator('[data-sketch-profile-id][data-profile-geometry-ids*="qualification:replacement:new"]');
    await expect(replacementProfile).toBeVisible({ timeout: 60_000 });
    await replacementProfile.dispatchEvent("pointerdown", { button: 0, pointerId: 403 });
    await expect(replacementProfile).toHaveAttribute("aria-pressed", "true");
    await page.locator("#finish-sketch-ribbon").click();
    await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "committed", { timeout: 60_000 });

    const acceptedBeforeEditHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());
    const acceptedBeforeEditBounds = roundedBounds(await page.evaluate(() => window.__crawlerApp.geometryBounds()));
    const acceptedBeforeEditState = await durableExtrudeState(page, original.featureId);
    const featureCount = await page.locator("[data-feature-id]").count();
    expect(acceptedBeforeEditState).toEqual(original);

    // A cancelled replacement edit may preview the new region, but must
    // restore the accepted document, old references, and old render packet.
    await openExtrudeEditById(page, original.featureId);
    const distance = page.getByRole("spinbutton", { name: "Extrude distance in millimeters" });
    await expect(distance).toHaveValue("4");
    await distance.fill("4.001");
    await expect.poll(async () => roundedBounds(await page.evaluate(() => window.__crawlerApp.geometryBounds()))).toEqual([24, -6, 0, 36, 6, 4.001]);
    await distance.press("Escape");
    await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "cancelled");
    await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(acceptedBeforeEditHash);
    await expect.poll(async () => roundedBounds(await page.evaluate(() => window.__crawlerApp.geometryBounds()))).toEqual(acceptedBeforeEditBounds);
    expect(await durableExtrudeState(page, original.featureId)).toEqual(acceptedBeforeEditState);

    // The selected replacement survives cancellation. Commit it at the
    // original extent and retain the Extrude feature and result body IDs.
    await openExtrudeEditById(page, original.featureId);
    await distance.fill("4.001");
    await expect.poll(async () => roundedBounds(await page.evaluate(() => window.__crawlerApp.geometryBounds()))).toEqual([24, -6, 0, 36, 6, 4.001]);
    await distance.fill("4");
    await expect.poll(async () => roundedBounds(await page.evaluate(() => window.__crawlerApp.geometryBounds()))).toEqual([24, -6, 0, 36, 6, 4]);
    await commitExtrude(page);
    const committedHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());
    const committedBounds = roundedBounds(await page.evaluate(() => window.__crawlerApp.geometryBounds()));
    const committed = await durableExtrudeState(page, original.featureId);
    expect(committedHash).not.toBe(acceptedBeforeEditHash);
    expect(await page.locator("[data-feature-id]").count()).toBe(featureCount);
    expect(committed.featureId).toBe(original.featureId);
    expect(committed.bodyId).toBe(original.bodyId);
    expect(committed.sketchId).toBe(original.sketchId);
    expect(committed.regionId).not.toBe(original.regionId);
    expect(committed.profileGeometryIds).toEqual(["qualification:replacement:new"]);
    expect(committed.distanceNanometers).toBe(4_000_000);
    expect(committedBounds).toEqual([24, -6, 0, 36, 6, 4]);

    const recompute = await page.evaluate(() => window.__crawlerApp.recompute());
    expect(recompute.dirtyRoots).toEqual([original.featureId]);
    expect(recompute.evaluationOrder).toEqual([original.featureId]);
    expect(roundedBounds(await page.evaluate(() => window.__crawlerApp.geometryBounds()))).toEqual(committedBounds);
    await expect(page.locator("#storage-status")).toHaveText("autosaved", { timeout: 60_000 });

    await page.reload();
    await waitUntilReady(page);
    expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(committedHash);
    expect(await durableExtrudeState(page, original.featureId)).toEqual(committed);
    expect(roundedBounds(await page.evaluate(() => window.__crawlerApp.geometryBounds()))).toEqual(committedBounds);
    expect(await page.locator("[data-feature-id]").count()).toBe(featureCount);

    // A profile selected from another sketch/support is not a compatible
    // replacement. Timeline edit must reject it before preview or commit.
    await page.locator('[data-origin-plane-id="origin-plane:yz"]').click();
    await page.locator("#edit-sketch").click();
    await page.evaluate(async () => window.__crawlerApp.applySketchCommands([{
      kind: "add_geometry",
      entity: {
        id: "qualification:replacement:cross-sketch",
        geometry: { kind: "circle", center: { x_nm: 0, y_nm: 0 }, radius_nm: 3_000_000 },
      },
    }]));
    const crossSketchProfile = page.getByLabel("Editable sketch geometry")
      .locator('[data-sketch-profile-id][data-profile-geometry-ids*="qualification:replacement:cross-sketch"]');
    await expect(crossSketchProfile).toBeVisible({ timeout: 60_000 });
    await crossSketchProfile.dispatchEvent("pointerdown", { button: 0, pointerId: 404 });
    await expect(crossSketchProfile).toHaveAttribute("aria-pressed", "true");
    await page.locator("#finish-sketch-ribbon").click();
    await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "committed", { timeout: 60_000 });
    await expect(page.locator("#storage-status")).toHaveText("autosaved", { timeout: 60_000 });

    const crossSketchId = await page.locator('[data-sketch-id].selected').getAttribute("data-sketch-id");
    expect(crossSketchId).toBeTruthy();
    expect(crossSketchId).not.toBe(original.sketchId);
    const crossBeforeHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());
    const crossBeforeState = await durableExtrudeState(page, original.featureId);
    const crossBeforeBounds = roundedBounds(await page.evaluate(() => window.__crawlerApp.geometryBounds()));
    const crossBeforeFeatureCount = await page.locator("[data-feature-id]").count();
    const commandsBefore = await page.evaluate(() =>
      [...((window as unknown as { __solidFeatureWorkerCommands: Array<{ type: string }> }).__solidFeatureWorkerCommands ?? [])],
    );
    const previewDispatchesBefore = commandsBefore.filter((command) => command.type === "preview-extrude").length;
    const commitDispatchesBefore = commandsBefore.filter((command) => command.type === "commit-pad").length;

    await page.locator(`[data-feature-id="${original.featureId}"]`).click();
    const edit = page.locator('[data-feature-action="edit-extrude"]');
    await expect(edit).toBeVisible();
    await edit.click();
    const editError = page.locator("#action-error");
    await expect(editError).toBeVisible();
    await expect(page.locator("#action-error-title")).toHaveText("Edit Extrude couldn’t be completed");
    const expectedCrossSketchError = "The selected replacement profile must belong to this Extrude's source sketch and resolved support.";
    await expect(page.locator("#action-error-reason")).toHaveText(expectedCrossSketchError);
    const explicitErrorVisible = await editError.isVisible();
    await expect(page.locator("#operation-state")).not.toHaveAttribute("data-status", "preview");
    await expect(page.locator("#extrude-manipulator")).toBeHidden();

    const commandsAfter = await page.evaluate(() =>
      [...((window as unknown as { __solidFeatureWorkerCommands: Array<{ type: string }> }).__solidFeatureWorkerCommands ?? [])],
    );
    const previewDispatchesAfter = commandsAfter.filter((command) => command.type === "preview-extrude").length;
    const commitDispatchesAfter = commandsAfter.filter((command) => command.type === "commit-pad").length;
    const crossBlockedHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());
    const crossBlockedState = await durableExtrudeState(page, original.featureId);
    const crossBlockedBounds = roundedBounds(await page.evaluate(() => window.__crawlerApp.geometryBounds()));
    const crossBlockedFeatureCount = await page.locator("[data-feature-id]").count();
    expect(previewDispatchesAfter).toBe(previewDispatchesBefore);
    expect(commitDispatchesAfter).toBe(commitDispatchesBefore);
    expect(crossBlockedHash).toBe(crossBeforeHash);
    expect(crossBlockedState).toEqual(crossBeforeState);
    expect(crossBlockedBounds).toEqual(crossBeforeBounds);
    expect(crossBlockedFeatureCount).toBe(crossBeforeFeatureCount);

    await page.evaluate(() => window.__crawlerApp.recompute());
    expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(crossBeforeHash);
    expect(await durableExtrudeState(page, original.featureId)).toEqual(crossBeforeState);
    expect(roundedBounds(await page.evaluate(() => window.__crawlerApp.geometryBounds()))).toEqual(crossBeforeBounds);
    await page.reload();
    await waitUntilReady(page);
    const crossReloadHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());
    const crossReloadState = await durableExtrudeState(page, original.featureId);
    const crossReloadBounds = roundedBounds(await page.evaluate(() => window.__crawlerApp.geometryBounds()));
    const crossReloadFeatureCount = await page.locator("[data-feature-id]").count();
    expect(crossReloadHash).toBe(crossBeforeHash);
    expect(crossReloadState).toEqual(crossBeforeState);
    expect(crossReloadBounds).toEqual(crossBeforeBounds);
    expect(crossReloadFeatureCount).toBe(crossBeforeFeatureCount);

    const referencesUnchanged = crossBlockedState.sketchId === crossBeforeState.sketchId
      && crossBlockedState.supportKind === crossBeforeState.supportKind
      && crossBlockedState.supportPlane === crossBeforeState.supportPlane
      && crossBlockedState.regionId === crossBeforeState.regionId
      && JSON.stringify(crossBlockedState.profileGeometryIds) === JSON.stringify(crossBeforeState.profileGeometryIds);
    const idsRetained = crossBlockedState.featureId === crossBeforeState.featureId
      && crossBlockedState.bodyId === crossBeforeState.bodyId;
    const acceptedStateUnchanged = crossBlockedHash === crossBeforeHash
      && crossReloadHash === crossBeforeHash;
    const geometryUnchanged = JSON.stringify(crossBlockedBounds) === JSON.stringify(crossBeforeBounds)
      && JSON.stringify(crossReloadBounds) === JSON.stringify(crossBeforeBounds);
    const featureCountUnchanged = crossBlockedFeatureCount === crossBeforeFeatureCount
      && crossReloadFeatureCount === crossBeforeFeatureCount;
    const zeroPreviewOrCommitDispatch = previewDispatchesAfter === previewDispatchesBefore
      && commitDispatchesAfter === commitDispatchesBefore;
    const noInvalidPreviewOrCommit = zeroPreviewOrCommitDispatch
      && acceptedStateUnchanged && referencesUnchanged && idsRetained && geometryUnchanged && featureCountUnchanged;

    const workerCount = await page.evaluate(() =>
      ((window as unknown as { __solidFeatureWorkerUrls: string[] }).__solidFeatureWorkerUrls ?? [])
        .filter((url) => url.includes("model.worker")).length,
    );
    expect(workerCount).toBe(1);
    expect(failures.consoleErrors).toEqual([]);
    expect(failures.pageErrors).toEqual([]);
    return {
      featureIdRetained: committed.featureId === original.featureId,
      bodyIdRetained: committed.bodyId === original.bodyId,
      sourceSketchRetained: committed.sketchId === original.sketchId,
      replacementRegionPersisted: committed.regionId !== original.regionId && committed.profileGeometryIds[0] === "qualification:replacement:new",
      cancelRestoredAcceptedState: true,
      recomputeCorrect: true,
      reloadPersisted: true,
      crossSketchReplacementRejected: crossSketchId !== original.sketchId && referencesUnchanged,
      crossSketchAcceptedStateUnchanged: acceptedStateUnchanged,
      crossSketchReferencesUnchanged: referencesUnchanged,
      crossSketchFeatureAndBodyIdsRetained: idsRetained,
      crossSketchGeometryUnchanged: geometryUnchanged,
      crossSketchFeatureCountUnchanged: featureCountUnchanged,
      crossSketchNoInvalidPreviewOrCommit: noInvalidPreviewOrCommit,
      crossSketchExplicitError: explicitErrorVisible,
      crossSketchZeroPreviewOrCommitDispatch: zeroPreviewOrCommitDispatch,
      crossSketchEditBlocked: explicitErrorVisible && zeroPreviewOrCommitDispatch,
      crossSketchErrorReason: expectedCrossSketchError,
      workerCount,
      consoleErrors: failures.consoleErrors.length,
      pageErrors: failures.pageErrors.length,
    };
  } finally {
    if (context.pages().length) await context.close();
  }
}

async function exerciseCreateFlow(
  browser: Browser,
  baseURL: string,
  flow: "tool_first" | "selection_first",
): Promise<{
  definition: Record<string, unknown>;
  timelineDefinition?: Record<string, unknown>;
  cameraInvariant: boolean;
  lifecycle: Record<string, boolean>;
  workerCount: number;
  consoleErrors: number;
  pageErrors: number;
}> {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const failures = collectBrowserFailures(page);
  await installWorkerMessageAudit(page);
  try {
    await page.goto("/");
    await waitUntilReady(page);
    const selectionFirst = flow === "selection_first";
    await createQualifiedSketch(page, "rectangle", `qualification:${flow}`, selectionFirst);
    const sketchHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());
    await startExtrude(page, 4);
    const handle = page.locator("#extrude-manipulator");
    await expect(handle).toHaveAttribute("aria-valuenow", "4");
    const cameraBefore = await page.evaluate(() => window.__crawlerApp.cameraPosition());
    await page.locator('[data-view="front"]').dispatchEvent("click");
    await expect.poll(() => page.evaluate(() => window.__crawlerApp.cameraPosition())).not.toEqual(cameraBefore);
    await expect(handle).toHaveAttribute("aria-valuenow", "4");
    const cameraInvariant = (await handle.getAttribute("aria-valuenow")) === "4";
    expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(sketchHash);
    await commitExtrude(page);
    const createdHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());
    expect(createdHash).not.toBe(sketchHash);
    const definition = await canonicalExtrudeDefinition(page);
    let timelineDefinition: Record<string, unknown> | undefined;
    const lifecycle = { preview: true, cancel: false, commit: true, edit: false };
    if (selectionFirst) {
      const featureId = await page.locator("[data-feature-id]").last().getAttribute("data-feature-id");
      await openExtrudeEdit(page);
      lifecycle.edit = true;
      const distance = page.getByRole("spinbutton", { name: "Extrude distance in millimeters" });
      await distance.fill("5");
      await expect.poll(async () => roundedBounds(await page.evaluate(() => window.__crawlerApp.geometryBounds()))[5]).toBe(5);
      await distance.press("Escape");
      await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "cancelled");
      expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(createdHash);
      lifecycle.cancel = true;
      await openExtrudeEdit(page);
      await distance.fill("4.001");
      await expect.poll(async () => roundedBounds(await page.evaluate(() => window.__crawlerApp.geometryBounds()))[5]).toBe(4.001);
      await distance.fill("4");
      await expect.poll(async () => roundedBounds(await page.evaluate(() => window.__crawlerApp.geometryBounds()))[5]).toBe(4);
      await commitExtrude(page);
      expect(await page.locator("[data-feature-id]").last().getAttribute("data-feature-id")).toBe(featureId);
      timelineDefinition = await canonicalExtrudeDefinition(page);
    }
    const workerCount = await page.evaluate(() =>
      ((window as unknown as { __solidFeatureWorkerUrls: string[] }).__solidFeatureWorkerUrls ?? [])
        .filter((url) => url.includes("model.worker")).length,
    );
    expect(workerCount).toBe(1);
    expect(failures.consoleErrors).toEqual([]);
    expect(failures.pageErrors).toEqual([]);
    return {
      definition,
      ...(timelineDefinition ? { timelineDefinition } : {}),
      cameraInvariant,
      lifecycle,
      workerCount,
      consoleErrors: failures.consoleErrors.length,
      pageErrors: failures.pageErrors.length,
    };
  } finally {
    if (context.pages().length) await context.close();
  }
}

test("exact Extrude create, stale-preview rejection, cancel, edit, history, and reload share one durable lifecycle", async ({ page }, testInfo) => {
  const descriptor = await fixtureDescriptor("production-preview-interaction");
  const staleDescriptor = await fixtureDescriptor("extrude-stale-preview");
  expect(descriptor.input).toEqual({ schema_version: 2, kind: "browser_interaction", payload: { viewport: [1440, 900], workers: 1, device_scale_factor: 1 } });
  expect(staleDescriptor.input).toEqual({ schema_version: 2, kind: "extrude_preview_race", payload: { completion_order: ["second", "first"], first_distance_nm: 4_000_000, second_distance_nm: 9_000_000 } });
  expect(testInfo.config.workers).toBe(1);
  expect(testInfo.project.use.viewport).toEqual({ width: 1440, height: 900 });
  expect(testInfo.project.use.deviceScaleFactor).toBe(1);
  const failures = collectBrowserFailures(page);
  await installWorkerMessageAudit(page);
  await page.goto("/");
  await waitUntilReady(page);
  await createQualifiedSketch(page, "annulus", "qualification:annulus");

  const acceptedSketchHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  const acceptedSketchBounds = roundedBounds(await page.evaluate(() => window.__crawlerApp.geometryBounds()));
  await page.locator("#start-pad").click();
  const distance = page.getByRole("spinbutton", { name: "Extrude distance in millimeters" });

  // Hold the next two real worker responses and deliver the second before the
  // first. The stale 4 mm packet must not overwrite the newer 9 mm preview.
  await expect(page.locator("#operation-state")).toHaveAttribute("data-preview-source", "worker-render-packet", { timeout: 60_000 });
  await page.evaluate(() => {
    (window as unknown as { __solidFeaturePreviewDeliveryDistances: number[] }).__solidFeaturePreviewDeliveryDistances.length = 0;
    (window as unknown as { __solidFeatureReverseNextTwoExtrudePreviews: boolean }).__solidFeatureReverseNextTwoExtrudePreviews = true;
  });
  await distance.fill("4");
  await distance.fill("9");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __solidFeaturePreviewDeliveryDistances: number[] }).__solidFeaturePreviewDeliveryDistances), { timeout: 60_000 }).toEqual([9_000_000, 4_000_000]);
  await expect.poll(async () => roundedBounds(await page.evaluate(() => window.__crawlerApp.geometryBounds()))[5], { timeout: 60_000 }).toBe(9);
  await expect(page.locator("#extrude-manipulator")).toHaveAttribute("aria-valuenow", "9");
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(acceptedSketchHash);

  await distance.press("Escape");
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "cancelled");
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(acceptedSketchHash);
  await expect.poll(async () => roundedBounds(await page.evaluate(() => window.__crawlerApp.geometryBounds()))).toEqual(acceptedSketchBounds);

  await startExtrude(page, 10);
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(acceptedSketchHash);
  await commitExtrude(page);
  const createdHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  const createdBounds = roundedBounds(await page.evaluate(() => window.__crawlerApp.geometryBounds()));
  const featureCount = await page.locator("[data-feature-id]").count();
  expect(createdHash).not.toBe(acceptedSketchHash);
  expect(createdBounds[5]).toBe(10);

  await openExtrudeEdit(page);
  await distance.fill("16");
  await expect.poll(async () => roundedBounds(await page.evaluate(() => window.__crawlerApp.geometryBounds()))[5], { timeout: 60_000 }).toBe(16);
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(createdHash);
  await commitExtrude(page);
  const editedHash = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  const recomputeEvidence = await page.evaluate(() => window.__crawlerApp.recompute());
  expect(recomputeEvidence.dirtyRoots.length).toBe(1);
  expect(recomputeEvidence.evaluationOrder).toEqual(recomputeEvidence.dirtyRoots);
  expect(editedHash).not.toBe(createdHash);
  expect(await page.locator("[data-feature-id]").count()).toBe(featureCount);

  await page.keyboard.press("Control+z");
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(createdHash);
  await expect.poll(async () => roundedBounds(await page.evaluate(() => window.__crawlerApp.geometryBounds()))).toEqual(createdBounds);
  await page.keyboard.press("Control+y");
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(editedHash);
  await expect.poll(async () => roundedBounds(await page.evaluate(() => window.__crawlerApp.geometryBounds()))[5]).toBe(16);
  await expect(page.locator("#storage-status")).toHaveText("autosaved", { timeout: 60_000 });

  await page.reload();
  await waitUntilReady(page);
  const reloadEvidence = await page.evaluate(() => ({
    durableChecksum: window.__crawlerApp.durableChecksum(),
    recoveryProvenance: window.__crawlerApp.recoveryProvenance(),
    recoveryChoices: window.__crawlerApp.recoveryChoices(),
    bounds: window.__crawlerApp.geometryBounds(),
    workerMessages: (window as unknown as { __solidFeatureWorkerMessages?: unknown }).__solidFeatureWorkerMessages,
  }));
  expect(reloadEvidence.durableChecksum, JSON.stringify({ createdHash, editedHash, reloadEvidence })).toBe(editedHash);
  expect(await page.locator("[data-feature-id]").count()).toBe(featureCount);
  await openExtrudeEdit(page);
  await expect(distance).toHaveValue("16");
  await distance.press("Escape");
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(editedHash);

  expect(failures.consoleErrors, "production console errors").toEqual([]);
  expect(failures.pageErrors, "production page errors").toEqual([]);
  await successScreenshot(page, "extrude-create-edit-reload-passed.png");
  const workerUrls = await page.evaluate(() => (window as unknown as { __solidFeatureWorkerUrls: string[] }).__solidFeatureWorkerUrls);
  expect(workerUrls.filter((url) => url.includes("model.worker")).length, JSON.stringify(workerUrls)).toBe(1);
  await writeBrowserFixtureEvidence(
    "production-preview-interaction",
    "production-extrude-lifecycle",
    { kind: "success", result: { console_errors: 0, stale_preview_accepted: false, page_errors: 0 } },
    {
      source_spec: "tests/solid-feature-qualification.spec.ts",
      viewport: [1440, 900],
      playwright_workers: testInfo.config.workers,
      device_scale_factor: testInfo.project.use.deviceScaleFactor,
      model_worker_count: 1,
      recompute_dirty_roots: recomputeEvidence.dirtyRoots,
      recompute_evaluation_order: recomputeEvidence.evaluationOrder,
      stale_preview_final_distance_mm: 9,
    },
  );
  await writeBrowserFixtureEvidence(
    "extrude-stale-preview",
    "production-extrude-lifecycle",
    { kind: "success", result: { stale_result_ignored: true, accepted_distance_nm: 9_000_000 } },
    {
      source_spec: "tests/solid-feature-qualification.spec.ts",
      completion_order: ["second", "first"],
      requested_distances_nm: [4_000_000, 9_000_000],
      delivered_distances_nm: [9_000_000, 4_000_000],
      accepted_distance_nm: 9_000_000,
      accepted_document_unchanged_during_preview: true,
      lifecycle_steps_completed: staleDescriptor.lifecycle_steps,
      preview_completed: true,
      cancel_completed: true,
      commit_completed: true,
      edit_completed: true,
      recompute_completed: true,
      model_worker_count: 1,
    },
  );
});

test("create/edit equivalence accepts same-sketch replacement and rejects cross-sketch replacement", async ({ browser }, testInfo) => {
  const descriptor = await fixtureDescriptor("extrude-create-edit-equivalence");
  expect(descriptor.input).toEqual({
    schema_version: 2,
    kind: "extrude_ui_equivalence",
    payload: {
      flows: [
        "tool_first",
        "selection_first",
        "timeline_edit",
        "timeline_edit_selected_region_replacement",
        "timeline_edit_cross_sketch_replacement_rejected",
      ],
      distance_nm: 4_000_000,
    },
  });
  const baseURL = String(testInfo.project.use.baseURL);
  expect(baseURL).toMatch(/^http:\/\/127\.0\.0\.1:/);
  const toolFirst = await exerciseCreateFlow(browser, baseURL, "tool_first");
  const selectionFirst = await exerciseCreateFlow(browser, baseURL, "selection_first");
  const replacement = await exerciseSelectedRegionReplacement(browser, baseURL);
  expect(selectionFirst.timelineDefinition).toBeDefined();
  expect(toolFirst.definition).toEqual(selectionFirst.definition);
  expect(selectionFirst.timelineDefinition).toEqual(selectionFirst.definition);
  expect(toolFirst.cameraInvariant).toBe(true);
  expect(selectionFirst.cameraInvariant).toBe(true);
  expect(toolFirst.lifecycle.preview && toolFirst.lifecycle.commit).toBe(true);
  expect(selectionFirst.lifecycle).toEqual({ preview: true, cancel: true, commit: true, edit: true });
  expect(replacement).toMatchObject({
    featureIdRetained: true,
    bodyIdRetained: true,
    sourceSketchRetained: true,
    replacementRegionPersisted: true,
    cancelRestoredAcceptedState: true,
    recomputeCorrect: true,
    reloadPersisted: true,
    crossSketchReplacementRejected: true,
    crossSketchAcceptedStateUnchanged: true,
    crossSketchReferencesUnchanged: true,
    crossSketchFeatureAndBodyIdsRetained: true,
    crossSketchGeometryUnchanged: true,
    crossSketchFeatureCountUnchanged: true,
    crossSketchNoInvalidPreviewOrCommit: true,
    crossSketchExplicitError: true,
    crossSketchZeroPreviewOrCommitDispatch: true,
    crossSketchEditBlocked: true,
    crossSketchErrorReason: "The selected replacement profile must belong to this Extrude's source sketch and resolved support.",
  });
  await writeBrowserFixtureEvidence(
    "extrude-create-edit-equivalence",
    "production-extrude-lifecycle",
    {
      kind: "success",
      result: {
        canonical_definitions_equal: true,
        camera_invariant_handle: true,
        selected_region_replacement_persisted: true,
        cancel_restored_accepted_state: true,
        feature_and_body_ids_retained: true,
        recompute_and_reload_persisted: true,
        cross_sketch_replacement_rejected: true,
        cross_sketch_accepted_state_unchanged: true,
        cross_sketch_references_unchanged: true,
        cross_sketch_feature_and_body_ids_retained: true,
        cross_sketch_geometry_unchanged: true,
        cross_sketch_feature_count_unchanged: true,
        cross_sketch_no_invalid_preview_or_commit: true,
        cross_sketch_explicit_error: true,
        cross_sketch_zero_preview_or_commit_dispatch: true,
        cross_sketch_edit_blocked: true,
        cross_sketch_error_reason_present: true,
      },
    },
    {
      source_spec: "tests/solid-feature-qualification.spec.ts",
      flows_exercised: [
        "tool_first",
        "selection_first",
        "timeline_edit",
        "timeline_edit_selected_region_replacement",
        "timeline_edit_cross_sketch_replacement_rejected",
      ],
      distance_nm: 4_000_000,
      canonical_definitions_equal: true,
      camera_invariant_handle: true,
      tool_first_without_profile_selection: true,
      selection_first_profile_selected: true,
      timeline_edit_retained_feature: true,
      selected_region_replacement_persisted: replacement.sourceSketchRetained && replacement.replacementRegionPersisted,
      selected_region_replacement_source_sketch_retained: replacement.sourceSketchRetained,
      selected_region_replacement_cancel_restored: replacement.cancelRestoredAcceptedState,
      selected_region_replacement_feature_id_retained: replacement.featureIdRetained,
      selected_region_replacement_body_id_retained: replacement.bodyIdRetained,
      selected_region_replacement_recompute_correct: replacement.recomputeCorrect,
      selected_region_replacement_reload_persisted: replacement.reloadPersisted,
      cross_sketch_replacement_rejected: replacement.crossSketchReplacementRejected,
      cross_sketch_accepted_document_hash_unchanged: replacement.crossSketchAcceptedStateUnchanged,
      cross_sketch_feature_id_retained: replacement.crossSketchFeatureAndBodyIdsRetained,
      cross_sketch_body_id_retained: replacement.crossSketchFeatureAndBodyIdsRetained,
      cross_sketch_source_sketch_reference_unchanged: replacement.crossSketchReferencesUnchanged,
      cross_sketch_support_reference_unchanged: replacement.crossSketchReferencesUnchanged,
      cross_sketch_region_reference_unchanged: replacement.crossSketchReferencesUnchanged,
      cross_sketch_geometry_bounds_unchanged: replacement.crossSketchGeometryUnchanged,
      cross_sketch_feature_count_unchanged: replacement.crossSketchFeatureCountUnchanged,
      cross_sketch_no_invalid_preview: replacement.crossSketchNoInvalidPreviewOrCommit,
      cross_sketch_no_invalid_commit: replacement.crossSketchNoInvalidPreviewOrCommit,
      cross_sketch_explicit_edit_error: replacement.crossSketchExplicitError,
      cross_sketch_edit_blocked: replacement.crossSketchEditBlocked,
      cross_sketch_error_reason: replacement.crossSketchErrorReason,
      cross_sketch_preview_dispatch_count: replacement.crossSketchZeroPreviewOrCommitDispatch ? 0 : -1,
      cross_sketch_commit_dispatch_count: replacement.crossSketchZeroPreviewOrCommitDispatch ? 0 : -1,
      cross_sketch_recompute_unchanged: replacement.crossSketchAcceptedStateUnchanged && replacement.crossSketchGeometryUnchanged,
      cross_sketch_reload_unchanged: replacement.crossSketchAcceptedStateUnchanged && replacement.crossSketchReferencesUnchanged && replacement.crossSketchGeometryUnchanged,
      lifecycle_steps_completed: descriptor.lifecycle_steps,
      preview_completed: true,
      cancel_completed: true,
      commit_completed: true,
      edit_completed: true,
      recompute_completed: true,
      reload_completed: true,
      model_worker_counts: [toolFirst.workerCount, selectionFirst.workerCount, replacement.workerCount],
      console_errors: toolFirst.consoleErrors + selectionFirst.consoleErrors + replacement.consoleErrors,
      page_errors: toolFirst.pageErrors + selectionFirst.pageErrors + replacement.pageErrors,
    },
  );
});
