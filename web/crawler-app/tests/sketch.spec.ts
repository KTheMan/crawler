import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.setTimeout(300_000);

test("shipped WASM advertises EZPZ graph decomposition and round-trips the static DXF golden", async ({ page }) => {
  const input = await readFile(new URL("../../../crates/crawler-sketch/tests/fixtures/all-geometry.input.dxf", import.meta.url), "utf8");
  const expected = await readFile(new URL("../../../crates/crawler-sketch/tests/fixtures/all-geometry.expected.dxf", import.meta.url), "utf8");
  await page.goto("/?qualificationReferencePart=1");
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
  const contract = await page.evaluate(() => window.__crawlerApp.sketchSolverContract());
  expect(contract).toMatchObject({ schema_version: 2, frontend: "planegcs_inspired_graph_decomposition", backend: "kittycad_ezpz", backend_version: "0.2.28" });
  expect(contract?.constraint_kinds).toHaveLength(28);
  const roundTrip = await page.evaluate(({ input }) => window.__crawlerApp.sketchDxfRoundTrip("sketch:browser-dxf", input), { input });
  expect(roundTrip.normalized).toBe(expected);
  expect(Object.keys(roundTrip.sketch.geometry)).toHaveLength(3);
  expect(roundTrip.decomposition.components).toHaveLength(3);
});

async function chooseOriginPlane(page: import("@playwright/test").Page, plane: "xy" | "xz" | "yz"): Promise<void> {
  await expect(page.getByLabel("Sketch plane selection")).toHaveAttribute("data-selecting", "true");
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.sketchSupportSelection())).toEqual({ active: true, surfacesVisible: true });
  await page.evaluate((value) => window.__crawlerApp.chooseOriginSketchSupport(value), plane);
  await expect(page.getByLabel("Sketch plane selection")).toContainText(`${plane.toUpperCase()} origin plane`);
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.sketchSupportSelection())).toEqual({ active: false, surfacesVisible: false });
}

async function selectCreatedSketch(page: import("@playwright/test").Page): Promise<void> {
  const sketch = page.locator('[data-sketch-id]:not([data-sketch-id="sketch:rectangle"])').last();
  await expect(sketch).toBeVisible();
  await sketch.click();
}

test("edits and atomically commits an origin-plane sketch", async ({ page }) => {
  await page.goto("/?qualificationReferencePart=1");
  await expect(page.locator('[data-stage="wasm"]')).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
  const committedBefore = await page.evaluate(() => window.__crawlerApp.committedSketchCount());
  await page.locator("#edit-sketch").click();
  await expect(page.locator("#sketch-toolbar")).toHaveCount(0);
  await expect(page.locator('[data-workbench="Sketcher"]')).toHaveClass(/active/);
  await expect(page.locator('[data-workbench-ribbon="Sketcher"]')).toBeVisible();
  await expect(page.locator("#inspector-tool-tab")).toHaveText("Line");
  await expect(page.locator("#inspector-tool-tab")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Sketch tool properties")).toBeVisible();
  await expect(page.locator("[data-sketch-tool]")).toHaveCount(27);
  await expect(page.locator("[data-sketch-constraint]")).toHaveCount(14);
  await expect(page.getByLabel("Sketch plane selection")).toContainText("Choose in the viewport");
  await chooseOriginPlane(page, "xy");

  const canvas = page.getByLabel("3D viewport");
  const acceptedEntityCount = await page.getByLabel("Editable sketch geometry").locator(".sketch-entity").count();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const drawingY = Math.max(320, Math.round(box!.height * 0.62));
  const drawingX = Math.max(650, Math.round(box!.width * 0.58));
  await canvas.click({ position: { x: drawingX, y: drawingY } });
  await canvas.hover({ position: { x: Math.min(box!.width - 80, drawingX + 70), y: drawingY - 24 } });
  await expect(page.getByLabel("Editable sketch geometry").locator(".sketch-facsimile")).toBeVisible();
  await expect(page.locator("#active-tool-instruction")).toHaveText("Set end point");
  await canvas.click({ position: { x: Math.min(box!.width - 80, drawingX + 110), y: drawingY } });
  await expect(page.locator("#active-tool-solver-state")).toContainText("under constrained", { timeout: 60_000 });
  await expect(page.locator("#active-tool-profile-state")).toContainText("open endpoint", { timeout: 60_000 });
  await expect(page.getByLabel("Editable sketch geometry").locator(".sketch-entity")).toHaveCount(acceptedEntityCount + 1);

  const cameraBeforeOrbit = await page.evaluate(() => window.__crawlerApp.cameraPosition());
  await page.mouse.move(box!.x + drawingX, box!.y + drawingY);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(box!.x + drawingX + 60, box!.y + drawingY + 30, { steps: 4 });
  await page.mouse.up({ button: "middle" });
  expect(await page.evaluate(() => window.__crawlerApp.cameraPosition())).not.toEqual(cameraBeforeOrbit);
  await expect(page.getByLabel("Editable sketch geometry").locator(".sketch-entity")).toHaveCount(acceptedEntityCount + 1);

  await page.locator("#active-tool-finish").click();
  await expect(page.locator('[data-workbench-ribbon="Sketcher"]')).toBeHidden({ timeout: 60_000 });
  await expect(page.locator("#inspector-tool-tab")).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.state().operation.status)).toBe("committed");
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.committedSketchCount())).toBeGreaterThan(committedBefore);
  await expect(page.locator("#storage-status")).toHaveText(/autosaved|saved/, { timeout: 60_000 });
  await page.reload();
  await expect(page.locator('[data-stage="wasm"]')).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.committedSketchCount())).toBeGreaterThan(committedBefore);
  await selectCreatedSketch(page);
  await page.locator("#edit-sketch").click();
  await expect(page.getByLabel("Sketch plane selection")).toContainText("XY origin plane");
  await expect(page.getByLabel("Editable sketch geometry").locator(".sketch-entity")).toHaveCount(acceptedEntityCount + 1);
});

test("reopening a committed closed sketch renders profile fills before any edit command", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
  await page.locator("#edit-sketch").click();
  await chooseOriginPlane(page, "xy");
  await page.evaluate(async () => window.__crawlerApp.applySketchCommands([{
    kind: "add_geometry",
    entity: { id: "reopen:circle", geometry: { kind: "circle", center: { x_nm: 0, y_nm: 0 }, radius_nm: 10_000_000 } },
  }]));
  const overlay = page.getByLabel("Editable sketch geometry");
  await expect(overlay.locator(".sketch-profile-fill")).toHaveCount(1, { timeout: 60_000 });
  const acceptedRevision = await page.evaluate(() => window.__crawlerApp.sketchDraft()?.revision);
  await page.locator("#finish-sketch-ribbon").click();
  await expect(page.locator("#operation-state")).toHaveAttribute("data-status", "committed", { timeout: 60_000 });

  await selectCreatedSketch(page);
  await page.locator("#edit-sketch").click();

  await expect(overlay.locator(".sketch-profile-fill")).toHaveCount(1, { timeout: 60_000 });
  await expect(overlay.locator('[data-profile-geometry-ids*="reopen:circle"]')).toBeVisible();
  expect(await page.evaluate(() => window.__crawlerApp.sketchDraft()?.revision)).toBe(acceptedRevision);
});

test("press-drag rectangles and lines remain visible and degenerate retries stay inside sketch edit", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
  await page.locator("#edit-sketch").click();
  await chooseOriginPlane(page, "xy");

  const canvas = page.getByLabel("3D viewport");
  const overlay = page.getByLabel("Editable sketch geometry");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down({ button: "left" });
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up({ button: "left" });
  };

  await page.locator('[data-sketch-tool="rectangle"]').click();
  await drag(
    { x: box!.x + box!.width * 0.36, y: box!.y + box!.height * 0.36 },
    { x: box!.x + box!.width * 0.48, y: box!.y + box!.height * 0.50 },
  );
  await expect(overlay.locator(".sketch-entity")).toHaveCount(4, { timeout: 60_000 });
  await drag(
    { x: box!.x + box!.width * 0.55, y: box!.y + box!.height * 0.38 },
    { x: box!.x + box!.width * 0.67, y: box!.y + box!.height * 0.52 },
  );
  await expect(overlay.locator(".sketch-entity")).toHaveCount(8, { timeout: 60_000 });

  await page.locator('[data-sketch-tool="line"]').click();
  const handle = await overlay.locator(".sketch-handle").first().boundingBox();
  expect(handle).not.toBeNull();
  await drag(
    { x: handle!.x + handle!.width / 2, y: handle!.y + handle!.height / 2 },
    { x: box!.x + box!.width * 0.75, y: box!.y + box!.height * 0.34 },
  );
  await expect(overlay.locator(".sketch-entity")).toHaveCount(9, { timeout: 60_000 });

  const retry = { x: box!.x + box!.width * 0.72, y: box!.y + box!.height * 0.68 };
  await page.mouse.click(retry.x, retry.y);
  await expect(overlay.locator(".sketch-entity")).toHaveCount(10, { timeout: 60_000 });
  await page.mouse.click(retry.x, retry.y);
  await expect(page.locator("#active-tool-solver-state")).toContainText("positive length");
  await expect(page.locator("#action-error")).toBeVisible();
  await expect(page.locator("#action-error-title")).toHaveText("Line couldn’t be completed");
  await expect(page.locator("#action-error-reason")).toHaveText("The start and end points overlap.");
  await expect(page.locator("#action-error-next")).toHaveText("Choose a different endpoint.");
  expect(await page.evaluate(() => window.__crawlerApp.safeMode())).toBe(false);
  await expect(overlay.locator(".sketch-entity")).toHaveCount(10);
  await page.mouse.click(box!.x + box!.width * 0.58, retry.y);
  await expect(overlay.locator(".sketch-entity")).toHaveCount(11, { timeout: 60_000 });
  await expect(page.locator("#action-error")).toBeHidden();

  await page.locator("#active-tool-finish").click();
  await expect(page.locator('[data-workbench-ribbon="Sketcher"]')).toBeHidden({ timeout: 60_000 });
  expect(await page.evaluate(() => window.__crawlerApp.safeMode())).toBe(false);
});

test("absolute sketch origin is a permanent selectable constraint reference", async ({ page }) => {
  await page.goto("/?qualificationReferencePart=1");
  await expect(page.locator('[data-stage="wasm"]')).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
  await page.locator("#edit-sketch").click();
  await chooseOriginPlane(page, "xy");

  const overlay = page.getByLabel("Editable sketch geometry");
  const origin = overlay.getByRole("button", { name: "Absolute origin reference" });
  await expect(origin).toBeVisible();
  const originCircle = origin.locator("circle");
  const originX = Number(await originCircle.getAttribute("cx"));
  const originY = Number(await originCircle.getAttribute("cy"));
  await origin.click();

  const canvas = page.getByLabel("3D viewport");
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  await canvas.click({ position: { x: Math.min(canvasBox!.width - 50, originX + 110), y: originY } });
  await expect(overlay.locator(".sketch-entity")).toHaveCount(1, { timeout: 60_000 });
  const start = overlay.locator('[data-anchor="start"]').last();
  expect(Number(await start.getAttribute("cx"))).toBeCloseTo(originX, 4);
  expect(Number(await start.getAttribute("cy"))).toBeCloseTo(originY, 4);
  await expect.poll(async () => page.evaluate(async () => {
    const decomposition = await window.__crawlerApp.sketchDecomposition();
    return decomposition?.components.reduce((count, component) => count + component.constraints.length, 0) ?? 0;
  }), { timeout: 60_000 }).toBe(2);

  await page.locator("#active-tool-finish").click();
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.committedSketchCount())).toBeGreaterThan(0);
});

test("first-class workspace shows inference, profiles, external references, box selection, and entity drag", async ({ page }) => {
  page.setDefaultTimeout(15_000);
  await page.goto("/?qualificationReferencePart=1");
  await expect(page.locator('[data-stage="wasm"]')).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
  const edge = await page.evaluate(() => window.__crawlerApp.selectFirst("edge"));
  expect(edge?.kind).toBe("edge");
  await page.locator("#edit-sketch").click();
  await chooseOriginPlane(page, "xy");

  const canvas = page.getByLabel("3D viewport");
  const overlay = page.getByLabel("Editable sketch geometry");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const p = (x: number, y: number) => ({ x: Math.round(box!.width * x), y: Math.round(box!.height * y) });

  await page.locator('[data-ribbon-flyout="draw"]').click();
  await page.locator('[data-ribbon-run="project"]').click();
  await expect(overlay.locator(".sketch-entity.external")).toHaveCount(1, { timeout: 60_000 });
  await expect(overlay.locator(".sketch-constraint-annotation")).toHaveCount(2);

  await page.locator('[data-sketch-tool="line"]').click();
  await canvas.click({ position: p(0.42, 0.74) });
  await canvas.hover({ position: { ...p(0.53, 0.74), y: p(0.53, 0.74).y + 5 } });
  await expect(overlay.locator(".sketch-cursor.snapped")).toBeVisible();
  await expect(overlay.locator(".sketch-cursor")).toContainText("Horizontal");
  await canvas.click({ position: { ...p(0.53, 0.74), y: p(0.53, 0.74).y + 5 } });
  await expect(overlay.locator(".sketch-constraint-annotation").filter({ hasText: "H" })).toHaveCount(1, { timeout: 60_000 });

  await page.keyboard.press("Escape");
  await page.locator('[data-ribbon-flyout="dimension"]').click();
  await expect(page.locator('[data-ribbon-tool-row="smart-sketch-dimension"]')).toBeVisible();
  await expect(page.locator('[data-ribbon-tool-row="distance"]')).toHaveCount(0);
  await expect(page.locator('[data-ribbon-tool-row="radius"]')).toHaveCount(0);
  await page.locator('[data-workbench-ribbon="Sketcher"] [data-ribbon-run="smart-sketch-dimension"]').click();
  await expect(page.getByLabel("Dimension editor")).toBeVisible();
  await expect(page.locator("#active-tool-instruction")).toContainText("snap Horizontal, Vertical, or Aligned");
  await page.locator("#active-tool-constraint-value").press("Enter");
  const distance = overlay.locator(".sketch-constraint-annotation.dimension");
  await expect(distance).toHaveCount(1, { timeout: 60_000 });
  await expect(page.locator("#smart-sketch-dimension")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".workspace")).toHaveAttribute("data-sketch-tool-state", "complete");
  await expect(page.locator("#active-tool-phase")).toContainText("ready to use again");
  await distance.click();
  const dimensionInput = page.locator("#active-tool-constraint-value");
  await dimensionInput.fill("12");
  await dimensionInput.press("Enter");
  await expect(distance).toContainText("12 mm", { timeout: 60_000 });

  await page.locator('[data-sketch-tool="rectangle"]').click();
  await canvas.click({ position: p(0.54, 0.48) });
  await canvas.click({ position: p(0.67, 0.63) });
  await expect(overlay.locator(".sketch-profile-fill")).toHaveCount(1, { timeout: 60_000 });
  await expect(overlay.locator(".sketch-dof-badge")).toHaveCount(0);

  await page.keyboard.press("Escape");
  const overlayBox = await overlay.boundingBox();
  expect(overlayBox).not.toBeNull();
  const selectionStart = p(0.51, 0.44); const selectionEnd = p(0.70, 0.67);
  await page.mouse.move(overlayBox!.x + selectionStart.x, overlayBox!.y + selectionStart.y);
  await page.mouse.down();
  await page.mouse.move(overlayBox!.x + selectionEnd.x, overlayBox!.y + selectionEnd.y, { steps: 4 });
  await page.mouse.up();
  await expect(overlay.locator(".sketch-entity.selected")).not.toHaveCount(0);
  await expect(overlay.locator(".sketch-dof-badge")).not.toHaveCount(0);

  const selectedEdge = overlay.locator(".sketch-entity.selected").last();
  const beforeX = Number(await selectedEdge.getAttribute("x1"));
  const selectedBox = await selectedEdge.boundingBox();
  expect(selectedBox).not.toBeNull();
  await page.mouse.move(selectedBox!.x + selectedBox!.width / 2, selectedBox!.y + selectedBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(selectedBox!.x + selectedBox!.width / 2 + 28, selectedBox!.y + selectedBox!.height / 2 + 18, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => Number(await overlay.locator(".sketch-entity.selected").last().getAttribute("x1"))).toBeGreaterThan(beforeX + 10);
});

test("Escape returns to Select while Finish remains the explicit sketch-workspace exit", async ({ page }) => {
  await page.goto("/?qualificationReferencePart=1");
  await expect(page.locator('[data-stage="wasm"]')).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
  await expect(page.locator("#finish-sketch-menu")).toHaveAttribute("hidden", "");
  await page.locator("#edit-sketch").click();
  if (await page.evaluate(() => window.__crawlerApp.sketchSupportSelection().active)) await page.evaluate(() => window.__crawlerApp.chooseOriginSketchSupport("xy"));
  await expect(page.locator("#finish-sketch-menu")).not.toHaveAttribute("hidden", "");
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-workbench-ribbon="Sketcher"]')).toBeVisible();
  await expect(page.locator("#inspector-tool-tab")).toHaveText("Select");
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-workbench-ribbon="Sketcher"]')).toBeVisible();
  await expect(page.locator("#finish-sketch-menu")).not.toHaveAttribute("hidden", "");
  await page.locator("#finish-sketch-ribbon").click();
  await expect(page.locator('[data-workbench-ribbon="Sketcher"]')).toBeHidden();
});

test("points and shape segments select directly while Escape preserves completed work", async ({ page }) => {
  await page.goto("/?qualificationReferencePart=1");
  await expect(page.locator('[data-stage="wasm"]')).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
  await page.locator("#edit-sketch").click();
  await chooseOriginPlane(page, "xy");
  const before = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  const canvas = page.getByLabel("3D viewport");
  const overlay = page.getByLabel("Editable sketch geometry");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const start = { x: box!.width * 0.52, y: box!.height * 0.61 };
  await canvas.click({ position: start });
  await canvas.click({ position: { x: start.x + 95, y: start.y } });
  const completed = overlay.locator('[data-sketch-segment="0"]').last();
  await expect(overlay.locator('[data-sketch-segment="0"]')).not.toHaveCount(0);
  const completedCount = await overlay.locator(".sketch-entity").count();

  await canvas.click({ position: { x: start.x + 135, y: start.y + 45 } });
  await expect(overlay.locator(".sketch-entity")).toHaveCount(completedCount + 1, { timeout: 60_000 });
  await expect(page.locator("#active-tool-instruction")).toHaveText("Set end point");
  await page.keyboard.press("Escape");
  await expect(page.locator("#active-tool-instruction")).toHaveText("Set start point");
  await expect(overlay.locator('[data-sketch-segment="0"]')).not.toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(page.locator("#inspector-tool-tab")).toHaveText("Select");
  const overlayBox = await overlay.boundingBox();
  const x1 = Number(await completed.getAttribute("x1"));
  const x2 = Number(await completed.getAttribute("x2"));
  const y1 = Number(await completed.getAttribute("y1"));
  expect(overlayBox).not.toBeNull();
  await completed.click({ force: true });
  await expect(overlay.locator(".sketch-entity.segment-selected")).toHaveCount(1);
  const point = overlay.locator(".sketch-handle").last();
  await point.click();
  await expect(overlay.locator(".sketch-handle.selected")).toHaveCount(1);

  await page.keyboard.press("Escape");
  await expect(page.locator('[data-workbench-ribbon="Sketcher"]')).toBeVisible();
  await page.locator("#finish-sketch-ribbon").click();
  await expect(page.locator('[data-workbench-ribbon="Sketcher"]')).toBeHidden({ timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum())).not.toBe(before);
});

test("viewport handles run constrained drag preview without mutating the accepted document", async ({ page }) => {
  await page.goto("/?qualificationReferencePart=1");
  await expect(page.locator('[data-stage="wasm"]')).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
  const accepted = await page.evaluate(() => window.__crawlerApp.durableChecksum());
  await page.locator("#edit-sketch").click();
  await chooseOriginPlane(page, "xy");
  const canvas = page.getByLabel("3D viewport");
  const overlay = page.getByLabel("Editable sketch geometry");
  const acceptedEntityCount = await overlay.locator(".sketch-entity").count();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const start = { x: Math.round(box!.width * 0.55), y: Math.round(box!.height * 0.64) };
  const end = { x: start.x + 90, y: start.y };
  await canvas.click({ position: start });
  await canvas.click({ position: end });

  await expect(overlay).toBeVisible();
  await expect(overlay.locator(".sketch-entity")).toHaveCount(acceptedEntityCount + 1);
  await page.keyboard.press("Escape");
  await expect(page.locator("#inspector-tool-tab")).toHaveText("Line");
  await page.keyboard.press("Escape");
  await expect(page.locator("#inspector-tool-tab")).toHaveText("Select");
  const endHandle = overlay.locator('[data-anchor="end"]').last();
  const beforeX = Number(await endHandle.getAttribute("cx"));
  const handleBox = await endHandle.boundingBox();
  expect(handleBox).not.toBeNull();
  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox!.x + handleBox!.width / 2 + 45, handleBox!.y + handleBox!.height / 2 - 20, { steps: 4 });
  await page.mouse.up();

  await expect(page.locator("#active-tool-solver-state")).toHaveAttribute("data-last-drag", "accepted", { timeout: 60_000 });
  await expect.poll(async () => Number(await overlay.locator('[data-anchor="end"]').last().getAttribute("cx"))).toBeGreaterThan(beforeX + 30);
  expect(await page.evaluate(() => window.__crawlerApp.durableChecksum())).toBe(accepted);
  await page.locator("#active-tool-finish").click();
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.durableChecksum())).not.toBe(accepted);
});

for (const plane of ["xz", "yz"] as const) {
  test(`${plane.toUpperCase()} uses a normal-to camera, plane-local input, and durable support`, async ({ page }) => {
    await page.goto("/?qualificationReferencePart=1");
    await expect(page.locator('[data-stage="wasm"]')).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
    await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
    const beforeCamera = await page.evaluate(() => window.__crawlerApp.cameraPosition());
    await page.locator("#edit-sketch").click();
    await chooseOriginPlane(page, plane);
    await expect.poll(() => page.evaluate(() => window.__crawlerApp.sketchPlane()?.support)).toEqual({ kind: "origin_plane_reference", plane: `origin-plane:${plane}` });

    const camera = await page.evaluate(() => window.__crawlerApp.cameraPosition());
    if (plane === "xz") {
      expect(camera[1]).toBeLessThan(-1);
      expect(Math.abs(camera[0])).toBeLessThan(0.001);
    } else {
      expect(camera[0]).toBeGreaterThan(1);
      expect(Math.abs(camera[1])).toBeLessThan(0.001);
    }
    expect(camera).not.toEqual(beforeCamera);

    const canvas = page.getByLabel("3D viewport");
    const overlay = page.getByLabel("Editable sketch geometry");
    const acceptedEntityCount = await overlay.locator(".sketch-entity").count();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const start = { x: Math.round(box!.width * 0.55), y: Math.round(box!.height * 0.62) };
    await canvas.click({ position: start });
    await canvas.click({ position: { x: start.x + 80, y: start.y - 25 } });
    await expect(overlay.locator(".sketch-entity")).toHaveCount(acceptedEntityCount + 1, { timeout: 60_000 });
    await expect(page.locator("#active-tool-solver-state")).toContainText("under constrained", { timeout: 60_000 });

    await page.locator("#active-tool-finish").click();
    await expect(page.locator('[data-workbench-ribbon="Sketcher"]')).toBeHidden({ timeout: 60_000 });
    const restoredCamera = await page.evaluate(() => window.__crawlerApp.cameraPosition());
    restoredCamera.forEach((value, index) => expect(value).toBeCloseTo(beforeCamera[index], 5));
    await expect(page.locator("#storage-status")).toHaveText(/autosaved|saved/, { timeout: 60_000 });
    await page.reload();
    await expect(page.locator('[data-stage="wasm"]')).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
    await selectCreatedSketch(page);
    await page.locator("#edit-sketch").click();
    await expect(page.getByLabel("Sketch plane selection")).toContainText(`${plane.toUpperCase()} origin plane`);
  });
}

test("all visible geometry tools and trim execute through the XZ plane-local solver path", async ({ page }) => {
  await page.goto("/?qualificationReferencePart=1");
  await expect(page.locator('[data-stage="wasm"]')).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
  await page.locator("#edit-sketch").click();
  await chooseOriginPlane(page, "xz");
  const canvas = page.getByLabel("3D viewport");
  const overlay = page.getByLabel("Editable sketch geometry");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const p = (x: number, y: number) => ({ x: Math.round(box!.width * x), y: Math.round(box!.height * y) });
  let count = await overlay.locator(".sketch-entity").count();
  const draw = async (tool: "line" | "rectangle" | "circle" | "arc", points: { x: number; y: number }[], added: number) => {
    await page.locator(`[data-sketch-tool="${tool}"]`).click();
    for (const point of points) await canvas.click({ position: point });
    count += added;
    await expect(overlay.locator(".sketch-entity")).toHaveCount(count, { timeout: 60_000 });
  };

  await draw("line", [p(0.43, 0.58), p(0.53, 0.58)], 1);
  await draw("rectangle", [p(0.43, 0.63), p(0.51, 0.72)], 4);
  await draw("circle", [p(0.58, 0.62), p(0.63, 0.62)], 1);
  await draw("arc", [p(0.58, 0.74), p(0.63, 0.74), p(0.58, 0.68)], 1);

  const constructionBefore = await overlay.locator(".construction").count();
  await page.keyboard.press("Escape");
  await canvas.click({ position: p(0.32, 0.84) });
  await page.locator('[data-sketch-tool="construction"]').click();
  await draw("line", [p(0.43, 0.78), p(0.56, 0.78)], 1);
  await expect(overlay.locator(".construction")).toHaveCount(constructionBefore + 1);

  await page.locator('[data-sketch-tool="trim"]').click();
  await overlay.locator(".sketch-entity.construction").last().click({ force: true });
  // The isolated construction line has no interior trim boundary, so the
  // operation must be a non-destructive no-op.
  await expect(overlay.locator(".sketch-entity")).toHaveCount(count, { timeout: 60_000 });
  await expect(page.locator("#active-tool-solver-state")).toContainText("cannot be trimmed", { timeout: 60_000 });
  await page.getByRole("button", { name: "Discard sketch draft" }).click();
});

test("trimming a selected rectangle segment preserves the other three edges as selectable lines", async ({ page }) => {
  await page.goto("/?qualificationReferencePart=1");
  await expect(page.locator('[data-stage="wasm"]')).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
  await page.locator("#edit-sketch").click();
  await chooseOriginPlane(page, "xy");
  const canvas = page.getByLabel("3D viewport");
  const overlay = page.getByLabel("Editable sketch geometry");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.locator('[data-sketch-tool="rectangle"]').click();
  await canvas.click({ position: { x: box!.width * 0.46, y: box!.height * 0.57 } });
  await canvas.click({ position: { x: box!.width * 0.61, y: box!.height * 0.70 } });
  await expect(overlay.locator(".sketch-entity")).toHaveCount(4, { timeout: 60_000 });
  await page.keyboard.press("Escape");
  await page.locator('[data-sketch-tool="trim"]').click();
  const segment = overlay.locator('[data-sketch-segment="0"]').first();
  const overlayBox = await overlay.boundingBox();
  expect(overlayBox).not.toBeNull();
  const [x1, x2, y1, y2] = await Promise.all(["x1", "x2", "y1", "y2"].map((name) => segment.getAttribute(name).then(Number)));
  await page.mouse.click(overlayBox!.x + (x1 + x2) / 2, overlayBox!.y + (y1 + y2) / 2);
  await expect(overlay.locator(".sketch-entity")).toHaveCount(3, { timeout: 60_000 });
  await expect(overlay.locator('.sketch-entity[data-sketch-segment="0"]')).toHaveCount(3);
  await page.getByRole("button", { name: "Discard sketch draft" }).click();
});

test("trim removes the clicked side of a line at its real intersection", async ({ page }) => {
  await page.goto("/?qualificationReferencePart=1");
  await expect(page.locator('[data-stage="wasm"]')).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
  await page.locator("#edit-sketch").click();
  await chooseOriginPlane(page, "xy");

  const canvas = page.getByLabel("3D viewport");
  const overlay = page.getByLabel("Editable sketch geometry");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const p = (x: number, y: number) => ({ x: Math.round(box!.width * x), y: Math.round(box!.height * y) });

  await canvas.click({ position: p(0.38, 0.56) });
  await canvas.click({ position: p(0.74, 0.56) });
  await expect(overlay.locator("line.sketch-entity")).toHaveCount(1, { timeout: 60_000 });
  const firstLine = await overlay.locator("line.sketch-entity").evaluate((line) => ({
    x1: Number(line.getAttribute("x1")), y1: Number(line.getAttribute("y1")),
    x2: Number(line.getAttribute("x2")), y2: Number(line.getAttribute("y2")),
  }));
  const overlayBounds = await overlay.boundingBox();
  expect(overlayBounds).not.toBeNull();
  const crossing = {
    x: overlayBounds!.x + firstLine.x1 + (firstLine.x2 - firstLine.x1) * 0.64,
    y: overlayBounds!.y + firstLine.y1,
  };
  await page.keyboard.press("Enter");
  // Start the cutter on the rendered source curve. This makes the workload
  // independent of camera-axis orientation while retaining an interior trim
  // boundary on the source line.
  await page.mouse.click(crossing.x, crossing.y);
  await page.mouse.click(crossing.x, crossing.y - 140);
  await expect(overlay.locator("line.sketch-entity")).toHaveCount(2, { timeout: 60_000 });

  const initialLines = await overlay.locator("line.sketch-entity").evaluateAll((lines) => lines.map((line) => ({
    x1: Number(line.getAttribute("x1")),
    y1: Number(line.getAttribute("y1")),
    x2: Number(line.getAttribute("x2")),
    y2: Number(line.getAttribute("y2")),
  })));
  const horizontal = initialLines.find((line) => Math.abs(line.y2 - line.y1) < 1);
  const horizontalIndex = initialLines.findIndex((line) => Math.abs(line.y2 - line.y1) < 1);
  const vertical = initialLines.find((line) => Math.abs(line.x2 - line.x1) < 1);
  expect(horizontal).toBeDefined();
  expect(vertical).toBeDefined();
  const intersectionX = (vertical!.x1 + vertical!.x2) / 2;
  const originalLeftX = Math.min(horizontal!.x1, horizontal!.x2);
  const originalRightX = Math.max(horizontal!.x1, horizontal!.x2);
  const clickX = (Math.min(horizontal!.x1, horizontal!.x2) + intersectionX) / 2;

  await page.keyboard.press("Escape");
  await page.locator('[data-sketch-tool="trim"]').click();
  const overlayBox = await overlay.boundingBox();
  expect(overlayBox).not.toBeNull();
  const trimTarget = overlay.locator("line.sketch-entity").nth(horizontalIndex);
  const trimClient = { clientX: overlayBox!.x + clickX, clientY: overlayBox!.y + (horizontal!.y1 + horizontal!.y2) / 2 };
  await trimTarget.dispatchEvent("pointerdown", { button: 0, pointerId: 1, bubbles: true, ...trimClient });
  await trimTarget.dispatchEvent("pointerup", { button: 0, pointerId: 1, bubbles: true, ...trimClient });
  await expect(overlay.locator("line.sketch-entity")).toHaveCount(2, { timeout: 60_000 });

  const trimmedLines = await overlay.locator("line.sketch-entity").evaluateAll((lines) => lines.map((line) => ({
    x1: Number(line.getAttribute("x1")),
    y1: Number(line.getAttribute("y1")),
    x2: Number(line.getAttribute("x2")),
    y2: Number(line.getAttribute("y2")),
  })));
  const trimmedHorizontal = trimmedLines.find((line) => Math.abs(line.y2 - line.y1) < 1);
  expect(trimmedHorizontal).toBeDefined();
  const trimmedEndpoints = [trimmedHorizontal!.x1, trimmedHorizontal!.x2];
  expect(trimmedEndpoints.some((value) => Math.abs(value - intersectionX) < 0.001)).toBe(true);
  expect(trimmedEndpoints.some((value) => Math.abs(value - originalLeftX) < 0.001 || Math.abs(value - originalRightX) < 0.001)).toBe(true);
  expect(trimmedEndpoints.every((value) => Math.abs(value - clickX) > 20)).toBe(true);

  await page.getByRole("button", { name: "Discard sketch draft" }).click();
});

test("selecting an origin plane in the browser seeds the next sketch workspace", async ({ page }) => {
  await page.goto("/?qualificationReferencePart=1");
  await expect(page.locator('[data-stage="wasm"]')).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
  await page.locator('[data-origin-plane-id="origin-plane:yz"]').click();
  await page.locator("#edit-sketch").click();
  await expect(page.getByLabel("Sketch plane selection")).toContainText("YZ origin plane");
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.sketchPlane()?.support)).toEqual({ kind: "origin_plane_reference", plane: "origin-plane:yz" });
  const camera = await page.evaluate(() => window.__crawlerApp.cameraPosition());
  expect(camera[0]).toBeGreaterThan(1);
  await page.getByRole("button", { name: "Discard sketch draft" }).click();
});

test("a preselected planar body face immediately seeds and durably reloads a face sketch", async ({ page }) => {
  await page.goto("/?qualificationReferencePart=1");
  await expect(page.locator('[data-stage="wasm"]')).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
  await expect(page.locator('[data-stage="renderer"]')).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
  const canvas = page.getByLabel("3D viewport");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const facePoint = { x: Math.round(box!.width * 0.57), y: Math.round(box!.height * 0.31) };
  await canvas.click({ position: facePoint });
  await expect(page.locator("#selection-readout")).toContainText("face");
  await page.locator("#edit-sketch").click();
  await expect(page.getByLabel("Sketch plane selection")).toContainText("Selected planar face");
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.sketchSupportSelection())).toEqual({ active: false, surfacesVisible: false });

  const overlay = page.getByLabel("Editable sketch geometry");
  await expect(overlay.locator(".sketch-entity.external")).toHaveCount(4, { timeout: 60_000 });
  const supportBoundaryCount = await overlay.locator(".sketch-entity").count();
  const start = { x: Math.round(box!.width * 0.52), y: Math.round(box!.height * 0.62) };
  // Use viewport coordinates so the sketch overlay can legitimately receive
  // snaps through its enlarged entity hit targets.
  await page.mouse.click(box!.x + start.x, box!.y + start.y);
  await page.mouse.click(box!.x + start.x + 90, box!.y + start.y - 20);
  await expect(overlay.locator(".sketch-entity")).toHaveCount(supportBoundaryCount + 1, { timeout: 60_000 });
  await page.locator("#active-tool-finish").click();
  await expect(page.locator("#storage-status")).toHaveText(/autosaved|saved/, { timeout: 60_000 });

  await page.reload();
  await expect(page.locator('[data-stage="wasm"]')).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
  await selectCreatedSketch(page);
  await page.locator("#edit-sketch").click();
  await expect(page.getByLabel("Sketch plane selection")).toContainText("Selected planar face");
  await expect(page.getByLabel("Editable sketch geometry").locator(".sketch-entity")).toHaveCount(supportBoundaryCount + 1);
});

test("visible datum planes can be selected directly in the viewport", async ({ page }) => {
  await page.goto("/?qualificationReferencePart=1");
  await expect(page.locator('[data-stage="wasm"]')).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
  await page.locator("#edit-sketch").click();
  const canvas = page.getByLabel("3D viewport");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const candidates = [[0.40, 0.25], [0.48, 0.22], [0.66, 0.26], [0.38, 0.76], [0.68, 0.74]] as const;
  let selectedOriginPlane = false;
  for (const [x, y] of candidates) {
    const clientX = box!.x + Math.round(box!.width * x);
    const clientY = box!.y + Math.round(box!.height * y);
    await page.mouse.move(clientX, clientY);
    await page.mouse.down({ button: "left" });
    await page.mouse.move(clientX + 2, clientY + 2);
    await page.mouse.up({ button: "left" });
    const support = await page.evaluate(() => window.__crawlerApp.sketchPlane()?.support);
    if (support?.kind === "origin_plane_reference") {
      selectedOriginPlane = true;
      break;
    }
    if (support) await page.getByRole("button", { name: "Choose another plane" }).click();
  }
  expect(selectedOriginPlane).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.sketchSupportSelection())).toEqual({ active: false, surfacesVisible: false });
  await page.getByRole("button", { name: "Discard sketch draft" }).click();
});

test("advanced sketch generators and edit operations execute through shipped WASM", async ({ page }) => {
  await page.goto("/?qualificationReferencePart=1");
  await expect(page.locator('[data-stage="wasm"]')).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
  await page.locator("#edit-sketch").click();
  await chooseOriginPlane(page, "xy");
  const canvas = page.getByLabel("3D viewport");
  const overlay = page.getByLabel("Editable sketch geometry");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const p = (x: number, y: number) => ({ x: Math.round(box!.width * x), y: Math.round(box!.height * y) });
  const runDraw = async (key: string, points: Array<{ x: number; y: number }>, added: number) => {
    const before = await overlay.locator(".sketch-entity").count();
    await page.locator('[data-ribbon-flyout="draw"]').click();
    await page.locator(`[data-ribbon-run="${key}"]`).click();
    for (const point of points) await canvas.click({ position: point });
    await expect(overlay.locator(".sketch-entity")).toHaveCount(before + added, { timeout: 60_000 });
  };
  await runDraw("spline", [p(0.36, 0.40), p(0.40, 0.34), p(0.44, 0.46), p(0.48, 0.40)], 1);
  await runDraw("polygon", [p(0.58, 0.40), p(0.62, 0.40)], 6);
  await runDraw("slot", [p(0.38, 0.63), p(0.48, 0.63), p(0.38, 0.67)], 4);
  await runDraw("ellipse", [p(0.62, 0.63), p(0.68, 0.63), p(0.62, 0.67)], 1);

  await page.keyboard.press("Escape");
  const geometryCount = () => overlay.locator("[data-sketch-geometry]").evaluateAll((elements) => new Set(elements.map((element) => (element as SVGElement).dataset.sketchGeometry)).size);
  const beforeOffset = await geometryCount();
  await overlay.locator(".sketch-entity").first().click();
  await page.locator('[data-ribbon-flyout="edit-sketch"]').click();
  await page.locator('[data-ribbon-run="offset"]').click();
  await expect(overlay.locator(".sketch-operation-preview").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect.poll(geometryCount, { timeout: 60_000 }).toBeGreaterThan(beforeOffset + 4);
  await page.getByRole("button", { name: "Discard sketch draft" }).click();
});

test("sketch-local history and constraint suppression stay inside the sketch workspace", async ({ page }) => {
  await page.goto("/?qualificationReferencePart=1");
  await expect(page.locator('[data-stage="wasm"]')).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
  await page.locator("#edit-sketch").click();
  await chooseOriginPlane(page, "xy");
  const canvas = page.getByLabel("3D viewport");
  const overlay = page.getByLabel("Editable sketch geometry");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const before = await overlay.locator(".sketch-entity").count();
  await canvas.click({ position: { x: box!.width * 0.42, y: box!.height * 0.62 } });
  await canvas.click({ position: { x: box!.width * 0.55, y: box!.height * 0.62 } });
  await expect(overlay.locator(".sketch-entity")).toHaveCount(before + 1, { timeout: 60_000 });
  await page.keyboard.press("Control+z");
  await expect(overlay.locator(".sketch-entity")).toHaveCount(before);
  await page.keyboard.press("Control+y");
  await expect(overlay.locator(".sketch-entity")).toHaveCount(before + 1);

  await page.keyboard.press("Escape");
  await page.locator(".sketch-constraint-manager > summary").click();
  const row = page.locator("[data-constraint-row]").first();
  await expect(row).toBeVisible();
  await row.locator("[data-toggle-constraint]").click();
  await expect(page.locator("[data-constraint-row].suppressed")).toHaveCount(1);
  await page.getByRole("button", { name: "Discard sketch draft" }).click();
});

for (const constraint of ["coincident", "horizontal", "vertical", "parallel", "perpendicular", "tangent", "equal", "distance", "radius", "angle"] as const) {
  test(`${constraint} stages explicit viewport selection and crosses worker/WASM`, async ({ page }) => {
    page.setDefaultTimeout(10_000);
    await page.goto("/?qualificationReferencePart=1");
    await expect(page.locator('[data-stage="wasm"]')).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
    await page.locator("#edit-sketch").click();
    await chooseOriginPlane(page, "xy");
    const canvas = page.getByLabel("3D viewport");
    const overlay = page.getByLabel("Editable sketch geometry");
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const p = (x: number, y: number) => ({ x: Math.round(box!.width * x), y: Math.round(box!.height * y) });
    const clickOverlayTarget = async (target: import("@playwright/test").Locator, additive = false) => {
      let targetBox = await target.boundingBox();
      const tagName = await target.evaluate((element) => element.tagName.toLowerCase());
      if (!targetBox && tagName === "line") {
        const overlayBox = await overlay.boundingBox();
        expect(overlayBox).not.toBeNull();
        const [x1, x2, y1, y2] = await Promise.all(["x1", "x2", "y1", "y2"].map((name) => target.getAttribute(name).then(Number)));
        targetBox = { x: overlayBox!.x + (x1 + x2) / 2, y: overlayBox!.y + (y1 + y2) / 2, width: 0, height: 0 };
      }
      expect(targetBox).not.toBeNull();
      if (additive) await page.keyboard.down("Control");
      await page.mouse.click(
        targetBox!.x + targetBox!.width / 2,
        tagName === "path" ? targetBox!.y + Math.min(2, targetBox!.height / 2) : targetBox!.y + targetBox!.height / 2,
      );
      if (additive) await page.keyboard.up("Control");
    };
    const clickCircleStroke = async (index: number, additive = false) => {
      const center = overlay.locator('[data-anchor="center"]').nth(index);
      const radius = overlay.locator("[data-sketch-radius]").nth(index);
      const overlayBox = await overlay.boundingBox();
      expect(overlayBox).not.toBeNull();
      const [centerX, centerY, radiusX, radiusY] = await Promise.all([
        center.getAttribute("cx").then(Number), center.getAttribute("cy").then(Number),
        radius.getAttribute("cx").then(Number), radius.getAttribute("cy").then(Number),
      ]);
      const pixelRadius = Math.hypot(radiusX - centerX, radiusY - centerY);
      if (additive) await page.keyboard.down("Control");
      await page.mouse.click(overlayBox!.x + centerX, overlayBox!.y + centerY - pixelRadius);
      if (additive) await page.keyboard.up("Control");
    };
    const drawLine = async (a: { x: number; y: number }, b: { x: number; y: number }) => {
      await page.locator('[data-sketch-tool="line"]').click();
      const before = await overlay.locator('[data-sketch-geometry]').count();
      await canvas.click({ position: a });
      await canvas.click({ position: b });
      await expect(overlay.locator('[data-sketch-geometry]')).toHaveCount(before + 1, { timeout: 60_000 });
    };
    const drawCircle = async (center: { x: number; y: number }, edge: { x: number; y: number }) => {
      await page.locator('[data-sketch-tool="circle"]').click();
      const before = await overlay.locator('[data-sketch-geometry]').count();
      await canvas.click({ position: center });
      await canvas.click({ position: edge });
      await expect(overlay.locator('[data-sketch-geometry]')).toHaveCount(before + 1, { timeout: 60_000 });
    };

    if (constraint === "radius") {
      await drawCircle(p(0.56, 0.62), p(0.60, 0.62));
    } else if (constraint === "equal") {
      await drawCircle(p(0.52, 0.60), p(0.55, 0.60));
      await drawCircle(p(0.64, 0.62), p(0.69, 0.62));
    } else if (constraint === "tangent") {
      await drawLine(p(0.45, 0.67), p(0.64, 0.67));
      await drawCircle(p(0.55, 0.60), p(0.59, 0.60));
    } else {
      await drawLine(p(0.45, 0.62), p(0.58, 0.59));
      if (["coincident", "parallel", "perpendicular", "angle"].includes(constraint)) {
        await drawLine(p(0.60, 0.67), p(0.70, 0.61));
      }
    }

    const inferredConstraintCount = await page.evaluate(async () => {
      const decomposition = await window.__crawlerApp.sketchDecomposition();
      return decomposition?.components.reduce((count, component) => count + component.constraints.length, 0) ?? 0;
    });

    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await canvas.click({ position: p(0.50, 0.85) });
    await expect(overlay.locator(".sketch-entity.selected")).toHaveCount(0);
    const constraintButton = page.locator(`[data-sketch-constraint="${constraint}"]`);
    if (await constraintButton.isVisible()) {
      await constraintButton.click();
    } else {
      const section = ["distance", "radius", "angle"].includes(constraint) ? "dimension" : "constrain";
      const toolKey = constraint === "angle" ? "sketch-angle" : constraint;
      await page.locator(`[data-workbench-ribbon="Sketcher"] [data-ribbon-flyout="${section}"]`).click();
      await page.locator(`[data-workbench-ribbon="Sketcher"] [data-ribbon-run="${toolKey}"]`).evaluate((button) => (button as HTMLButtonElement).click());
    }
    await expect(page.locator("#active-tool-instruction")).toContainText("Select");

    if (constraint === "coincident") {
      await clickOverlayTarget(overlay.locator('[data-anchor="end"]').first());
      await clickOverlayTarget(overlay.locator('[data-anchor="start"]').nth(1), true);
    } else if (constraint === "distance") {
      await clickOverlayTarget(overlay.locator('[data-anchor="start"]').first());
      await clickOverlayTarget(overlay.locator('[data-anchor="end"]').first(), true);
    } else if (constraint === "radius") {
      await clickOverlayTarget(overlay.locator("[data-sketch-radius]").first());
    } else if (constraint === "tangent") {
      await clickOverlayTarget(overlay.locator('[data-sketch-geometry]').first());
      await clickCircleStroke(0, true);
    } else if (constraint === "equal") {
      await clickCircleStroke(0);
      await clickCircleStroke(1, true);
    } else {
      const entities = overlay.locator('[data-sketch-geometry]');
      await clickOverlayTarget(entities.first());
      if (["parallel", "perpendicular", "tangent", "equal", "angle"].includes(constraint)) {
        await clickOverlayTarget(entities.nth(1), true);
      }
    }

    if (["distance", "radius", "angle"].includes(constraint)) {
      await expect(page.locator("#active-tool-instruction")).toContainText("Place the");
      await page.keyboard.press("Enter");
    }

    await expect.poll(async () => page.evaluate(async () => {
      const decomposition = await window.__crawlerApp.sketchDecomposition();
      return decomposition?.components.reduce((count, component) => count + component.constraints.length, 0) ?? 0;
    }), { timeout: 60_000 }).toBe(inferredConstraintCount + 1);

    await page.locator("#finish-sketch-ribbon").click();
    await expect(page.locator('[data-workbench-ribbon="Sketcher"]')).toBeHidden({ timeout: 60_000 });
    await expect(page.locator("#storage-status")).toHaveText(/autosaved|saved/, { timeout: 60_000 });

    await page.reload();
    await expect(page.locator('[data-stage="wasm"]')).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
    await expect(page.locator('[data-stage="renderer"]')).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
    await selectCreatedSketch(page);
    await page.locator("#edit-sketch").click();
    await expect.poll(async () => page.evaluate(async () => {
      const decomposition = await window.__crawlerApp.sketchDecomposition();
      return decomposition?.components.reduce((count, component) => count + component.constraints.length, 0) ?? 0;
    }), { timeout: 60_000 }).toBe(inferredConstraintCount + 1);
  });
}
