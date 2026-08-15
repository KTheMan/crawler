import { expect, test, type Page } from "@playwright/test";

test.setTimeout(120_000);

async function openLineSketch(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
  await page.locator("#edit-sketch").click();
  await page.evaluate(() => window.__crawlerApp.chooseOriginSketchSupport("xy"));
  const canvas = page.getByLabel("3D viewport");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("viewport has no bounds");
  await canvas.click({ position: { x: bounds.width * .38, y: bounds.height * .55 } });
  await canvas.click({ position: { x: bounds.width * .62, y: bounds.height * .45 } });
  await page.keyboard.press("Enter");
  await page.locator("#sketch-select-tool").click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#selection-readout")).toHaveText("Selection: none");
  await expect(page.getByLabel("Editable sketch geometry").locator(".sketch-entity[data-sketch-geometry]").first()).toBeVisible();
}

async function dispatchSweep(page: Page, finalTarget: "geometry" | "viewport"): Promise<void> {
  await page.evaluate((finalTarget) => {
    const canvas = document.querySelector<HTMLCanvasElement>("#viewport")!;
    const geometry = document.querySelector<SVGGeometryElement>("#sketch-overlay .sketch-entity[data-sketch-geometry]")!;
    const geometryBounds = geometry.getBoundingClientRect();
    const canvasBounds = canvas.getBoundingClientRect();
    const onGeometry = () => geometry.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      clientX: geometryBounds.left + geometryBounds.width / 2,
      clientY: geometryBounds.top + geometryBounds.height / 2,
    }));
    const onViewport = () => canvas.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      clientX: canvasBounds.left + 24,
      clientY: canvasBounds.top + 24,
    }));
    onGeometry();
    onViewport();
    onGeometry();
    if (finalTarget === "viewport") onViewport();
  }, finalTarget);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

test("pointer sweeps keep stable SVG layers untouched and the final event wins", async ({ page }) => {
  await openLineSketch(page);
  const geometry = page.getByLabel("Editable sketch geometry").locator(".sketch-entity[data-sketch-geometry]").first();
  const before = await page.evaluate(() => ({
    stable: window.__crawlerApp.sketchRenderIndexCounters().stableLayerGenerations,
    pointer: window.__crawlerApp.sketchPointerRenderCounters(),
    stableMarkup: document.querySelector<SVGGElement>('[data-sketch-layer="geometry"] > [data-sketch-render-key]')?.dataset.sketchMarkup,
    identity: (() => {
      const wrapper = document.querySelector<SVGGElement>('[data-sketch-layer="geometry"] > [data-sketch-render-key]')!;
      wrapper.dataset.pointerRenderIdentity = crypto.randomUUID();
      return wrapper.dataset.pointerRenderIdentity;
    })(),
  }));

  await dispatchSweep(page, "viewport");
  await expect(geometry).not.toHaveClass(/(^|\s)preselected(\s|$)/);
  await expect(geometry).not.toHaveClass(/(^|\s)invalid-preselection(\s|$)/);

  await dispatchSweep(page, "geometry");
  await expect(geometry).toHaveClass(/(^|\s)preselected(\s|$)/);
  await expect(geometry).toHaveAttribute("aria-label", /Preselected/);

  const after = await page.evaluate(() => ({
    stable: window.__crawlerApp.sketchRenderIndexCounters().stableLayerGenerations,
    pointer: window.__crawlerApp.sketchPointerRenderCounters(),
    stableMarkup: document.querySelector<SVGGElement>('[data-sketch-layer="geometry"] > [data-sketch-render-key]')?.dataset.sketchMarkup,
    identity: document.querySelector<SVGGElement>('[data-sketch-layer="geometry"] > [data-sketch-render-key]')?.dataset.pointerRenderIdentity,
  }));
  expect(after.stable).toBe(before.stable);
  expect(after.stableMarkup).toBe(before.stableMarkup);
  expect(after.identity).toBe(before.identity);
  expect(after.pointer.stablePassesSkipped).toBeGreaterThan(before.pointer.stablePassesSkipped);
  expect(after.pointer.dynamicClasses.fullScans).toBe(before.pointer.dynamicClasses.fullScans);
  expect(after.pointer.pointerFrames.coalesced).toBeGreaterThan(before.pointer.pointerFrames.coalesced);

  // A view invalidation queued after a pointer must not replace its latest
  // hover/snap payload, and the reverse order must still use the new pointer.
  for (const pointerFirst of [true, false]) {
    await page.evaluate((pointerFirst) => {
      const target = document.querySelector<SVGGeometryElement>("#sketch-overlay .sketch-entity[data-sketch-geometry]")!;
      const point = target.getPointAtLength(target.getTotalLength() * .37).matrixTransform(target.getScreenCTM()!);
      const pointer = () => target.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: point.x, clientY: point.y }));
      if (pointerFirst) pointer();
      window.dispatchEvent(new Event("resize"));
      if (!pointerFirst) pointer();
    }, pointerFirst);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(geometry).toHaveClass(/(^|\s)preselected(\s|$)/);
  }
  const afterView = await page.evaluate(() => ({
    stable: window.__crawlerApp.sketchRenderIndexCounters().stableLayerGenerations,
    pointer: window.__crawlerApp.sketchPointerRenderCounters(),
  }));
  expect(afterView.stable).toBeGreaterThan(after.stable);

  await page.evaluate(() => {
    const target = document.querySelector<SVGGeometryElement>("#sketch-overlay .sketch-entity[data-sketch-geometry]")!;
    const bounds = target.getBoundingClientRect();
    const init = { bubbles: true, clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2, pointerId: 23, button: 0 };
    target.dispatchEvent(new PointerEvent("pointerdown", init));
    target.dispatchEvent(new PointerEvent("pointerup", init));
  });
  await expect(page.locator("#selection-readout")).toContainText("1 entity");
  await expect(geometry).toHaveClass(/(^|\s)selected(\s|$)/);
  await expect(geometry).toHaveAttribute("aria-pressed", "true");
  await expect(geometry).toHaveAttribute("aria-label", /Selected/);
  await expect(page.getByLabel("Editable sketch geometry").locator('[data-sketch-layer="handles"] .sketch-handle')).toHaveCount(2);
  expect(await page.evaluate(() => window.__crawlerApp.sketchRenderIndexCounters().stableLayerGenerations)).toBe(afterView.stable);
  expect((await page.evaluate(() => window.__crawlerApp.sketchPointerRenderCounters())).dynamicClasses.fullScans).toBe(afterView.pointer.dynamicClasses.fullScans);
});

test("pointerdown flushes the latest coalesced preselection before selecting", async ({ page }) => {
  await openLineSketch(page);
  const geometry = page.getByLabel("Editable sketch geometry").locator(".sketch-entity[data-sketch-geometry]").first();
  await page.evaluate(() => {
    const target = document.querySelector<SVGGeometryElement>("#sketch-overlay .sketch-entity[data-sketch-geometry]")!;
    const bounds = target.getBoundingClientRect();
    const init = { bubbles: true, clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2, pointerId: 17, button: 0 };
    target.dispatchEvent(new PointerEvent("pointermove", init));
    target.dispatchEvent(new PointerEvent("pointerdown", init));
    target.dispatchEvent(new PointerEvent("pointerup", init));
  });
  await expect(geometry).toHaveClass(/selected/);
  await expect(page.locator("#selection-readout")).toContainText("1 entity");
  const counters = await page.evaluate(() => window.__crawlerApp.sketchPointerRenderCounters());
  expect(counters.pointerFrames.flushed).toBeGreaterThan(0);
});

test("Smart Dimension hover preserves stable geometry and editor focus", async ({ page }) => {
  await openLineSketch(page);
  const overlay = page.getByLabel("Editable sketch geometry");
  const geometry = overlay.locator(".sketch-entity[data-sketch-geometry]").first();
  await page.evaluate(() => {
    const target = document.querySelector<SVGGeometryElement>("#sketch-overlay .sketch-entity[data-sketch-geometry]")!;
    const bounds = target.getBoundingClientRect();
    const init = { bubbles: true, clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2, pointerId: 31, button: 0 };
    target.dispatchEvent(new PointerEvent("pointerdown", init));
    target.dispatchEvent(new PointerEvent("pointerup", init));
  });
  await expect(page.locator("#selection-readout")).toContainText("1 entity");
  await page.locator("#smart-sketch-dimension").click();
  const editorInput = page.locator("#sketch-dimension-editor #active-tool-constraint-value");
  await expect(editorInput).toBeVisible();
  await editorInput.focus();
  await expect(editorInput).toBeFocused();
  const beforeHover = await page.evaluate(() => window.__crawlerApp.sketchRenderIndexCounters().stableLayerGenerations);
  await geometry.hover({ force: true });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(editorInput).toBeFocused();
  expect(await page.evaluate(() => window.__crawlerApp.sketchRenderIndexCounters().stableLayerGenerations)).toBe(beforeHover);
});

test("Offset exposes bounded chain planning and separate preview/commit timings", async ({ page }) => {
  await openLineSketch(page);
  const overlay = page.getByLabel("Editable sketch geometry");
  await page.evaluate(() => {
    const target = document.querySelector<SVGGeometryElement>("#sketch-overlay .sketch-entity[data-sketch-geometry]")!;
    const point = target.getPointAtLength(target.getTotalLength() * .37).matrixTransform(target.getScreenCTM()!);
    const init = { bubbles: true, clientX: point.x, clientY: point.y, pointerId: 47, button: 0 };
    target.dispatchEvent(new PointerEvent("pointermove", init));
    target.dispatchEvent(new PointerEvent("pointerdown", init));
    target.dispatchEvent(new PointerEvent("pointerup", init));
  });
  await expect(page.locator("#selection-readout")).toContainText("1 entity");

  const workerCallsBefore = await page.evaluate(() => window.__crawlerApp.sketchBridgePerformance().filter((record) => record.type === "apply-sketch-commands").length);
  await page.locator('[data-ribbon-flyout="edit-sketch"]').click();
  await page.locator('[data-ribbon-run="offset"]').click();
  await expect(overlay.locator('.sketch-operation-preview[data-canonical-preview="true"]')).toBeVisible();
  await page.waitForFunction(() => window.__crawlerApp.offsetPerformanceCounters().some((record) => record.stage === "preview" && record.outcome === "ready"));
  expect(await page.evaluate(() => window.__crawlerApp.sketchBridgePerformance().filter((record) => record.type === "apply-sketch-commands").length)).toBe(workerCallsBefore + 1);
  const preview = await page.evaluate(() => window.__crawlerApp.offsetPerformanceCounters().at(-1)!);
  expect(preview.stage).toBe("preview");
  expect(preview.outcome).toBe("ready");
  for (const timing of [preview.planMs, preview.commandConstructionMs, preview.overlayMs, preview.stablePaintMs]) {
    expect(timing).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(timing)).toBe(true);
  }
  expect(preview.offsetChain?.sceneGeometryVisits).toBe(1);
  expect(preview.offsetChain?.reachableGeometryCount).toBe(1);
  expect(preview.offsetChain?.adjacencyVisits).toBeLessThanOrEqual(preview.offsetChain?.endpointIncidenceCount ?? -1);

  await page.keyboard.press("Enter");
  await expect(overlay.locator(".sketch-entity[data-sketch-geometry]")).toHaveCount(2, { timeout: 60_000 });
  await page.waitForFunction(() => window.__crawlerApp.offsetPerformanceCounters().some((record) => record.stage === "commit" && record.outcome === "accepted"));
  const retainedOffset = await page.evaluate(() => Object.values(window.__crawlerApp.sketchDraft()?.operations ?? {}).find((operation) => operation.kind === "offset"));
  expect(retainedOffset?.kind).toBe("offset");
  if (retainedOffset?.kind !== "offset") throw new Error("canonical offset operation was not retained");
  expect(retainedOffset.model_tolerance_nm).toBe(1_000);
  expect(retainedOffset.result_spans).toHaveLength(retainedOffset.result_chains.length);
  expect(retainedOffset.result_spans?.every((chain, group) => chain.length === retainedOffset.result_chains[group].length && chain.every((span) => span.certified_error_nm !== undefined && span.certified_error_nm <= retainedOffset.model_tolerance_nm!))).toBe(true);
  const commit = await page.evaluate(() => window.__crawlerApp.offsetPerformanceCounters().at(-1)!);
  expect(await page.evaluate(() => window.__crawlerApp.sketchBridgePerformance().filter((record) => record.type === "apply-sketch-commands").length)).toBe(workerCallsBefore + 1);
  expect(commit.stage).toBe("commit");
  expect(commit.outcome).toBe("accepted");
  for (const timing of [commit.planMs, commit.commandConstructionMs, commit.bridgeMs, commit.diagnosticsMs, commit.overlayMs, commit.stablePaintMs]) {
    expect(timing).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(timing)).toBe(true);
  }
  expect(commit.stableLayerDelta).toBe(1);
  expect(commit.offsetChain).toEqual(preview.offsetChain);
});
