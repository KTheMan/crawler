import { expect, test, type Page } from "@playwright/test";

test.setTimeout(120_000);

async function openSketch(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
  await page.locator("#edit-sketch").click();
  await expect(page.getByLabel("Sketch plane selection")).toHaveAttribute("data-selecting", "true");
  await page.evaluate(() => window.__crawlerApp.chooseOriginSketchSupport("xy"));
  await expect(page.getByLabel("Sketch plane selection")).toContainText("XY origin plane");
  const canvas = page.getByLabel("3D viewport");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("viewport has no bounds");
  return { canvas, box, overlay: page.getByLabel("Editable sketch geometry") };
}

async function clickSketchStroke(page: Page, locator: import("@playwright/test").Locator) {
  const point = await locator.evaluate((element) => {
    const geometry = element as SVGGeometryElement;
    const local = geometry.getPointAtLength(geometry.getTotalLength() * .37);
    const screen = local.matrixTransform(geometry.getScreenCTM()!);
    return { x: screen.x, y: screen.y };
  });
  await page.mouse.click(point.x, point.y);
}

test("Enter completes the command, Escape exits the command, and Finish explicitly exits the workspace", async ({ page }) => {
  const { canvas, box, overlay } = await openSketch(page);
  const points = [
    { x: box.width * .40, y: box.height * .55 },
    { x: box.width * .50, y: box.height * .48 },
    { x: box.width * .60, y: box.height * .56 },
  ];
  for (const point of points) await canvas.click({ position: point });
  await expect(overlay.locator(".sketch-entity")).toHaveCount(2, { timeout: 60_000 });
  await expect(page.locator("#active-tool-instruction")).toHaveText("Set end point");

  await canvas.click({ position: { x: box.width * .67, y: box.height * .61 }, button: "right" });
  await expect(page.locator("#active-tool-instruction")).toHaveText("Set start point");
  await canvas.click({ position: { x: box.width * .67, y: box.height * .61 } });
  await expect(page.locator("#active-tool-instruction")).toHaveText("Set end point");
  await page.keyboard.press("Enter");
  await expect(page.locator("#active-tool-phase")).toContainText("ready to use again");
  await expect(page.locator("#active-tool-instruction")).toHaveText("Set start point");
  await expect(page.locator('[data-workbench-ribbon="Sketcher"]')).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.locator("#inspector-tool-tab")).toHaveText("Select");
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-workbench-ribbon="Sketcher"]')).toBeVisible();
  await expect(page.locator("#active-tool-solver-state")).toContainText("Selection cleared");
  await expect(page.locator("#selection-readout")).toHaveText("Selection: none");

  await page.locator("#finish-sketch-ribbon").click();
  await expect(page.locator('[data-workbench-ribbon="Sketcher"]')).toBeHidden({ timeout: 60_000 });
});

test("creation HUD locks only explicitly entered dimensions and leaves later freeform geometry undimensioned", async ({ page }) => {
  const { canvas, box } = await openSketch(page);
  await canvas.click({ position: { x: box.width * .35, y: box.height * .48 } });
  const hud = page.getByLabel("Dimension editor");
  await expect(hud).toBeVisible();
  await expect(hud).toHaveAttribute("data-source", "creation");
  await expect(hud.getByLabel("Length")).toBeVisible();
  await expect(hud.getByLabel("Angle")).toBeVisible();
  await hud.getByLabel("Angle").click();
  await expect(hud.getByLabel("Angle")).toBeFocused();
  await hud.getByLabel("Length").click();
  await hud.getByLabel("Length").fill("25 mm");
  await hud.getByLabel("Length").press("Tab");
  await expect(hud.locator('[data-inline-field-label="length"]')).toHaveAttribute("data-locked", "true");
  await hud.getByLabel("Angle").fill("0 deg");
  await hud.getByLabel("Angle").press("Tab");
  await expect(hud.locator('[data-inline-field-label="angle"]')).toHaveAttribute("data-locked", "true");
  await canvas.click({ position: { x: box.width * .55, y: box.height * .57 } });
  await expect.poll(() => page.evaluate(() => {
    const draft = window.__crawlerApp.sketchDraft();
    return draft ? Object.values(draft.constraints).filter((constraint) => ["distance", "distance_x", "distance_y", "radius", "diameter", "ellipse_radius", "angle", "angle_to_axis"].includes(constraint.kind)).length : 0;
  }), { timeout: 60_000 }).toBe(2);
  const committedDimension = page.getByLabel("Editable sketch geometry").locator(".sketch-constraint-annotation.dimension");
  await expect(committedDimension.locator(".dimension-witness")).toHaveCount(2);
  await expect(committedDimension.locator(".dimension-measure")).toHaveCount(1);
  await expect(committedDimension.locator(".dimension-arrow")).toHaveCount(2);
  const lockedLength = await page.evaluate(() => {
    const draft = window.__crawlerApp.sketchDraft()!;
    const line = Object.values(draft.geometry).find((entity) => entity.geometry.kind === "line")!.geometry as { kind: "line"; start: { x_nm: number; y_nm: number }; end: { x_nm: number; y_nm: number } };
    return Math.round(Math.hypot(line.end.x_nm - line.start.x_nm, line.end.y_nm - line.start.y_nm));
  });
  expect(lockedLength).toBe(25_000_000);
  expect(await page.evaluate(() => {
    const draft = window.__crawlerApp.sketchDraft()!;
    const line = Object.values(draft.geometry).find((entity) => entity.geometry.kind === "line")!.geometry as { kind: "line"; start: { x_nm: number; y_nm: number }; end: { x_nm: number; y_nm: number } };
    return Math.round(Math.atan2(line.end.y_nm - line.start.y_nm, line.end.x_nm - line.start.x_nm) * 180 / Math.PI);
  })).toBe(0);

  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await page.locator('[data-sketch-tool="line"]').first().click();
  await canvas.click({ position: { x: box.width * .62, y: box.height * .42 } });
  await canvas.click({ position: { x: box.width * .73, y: box.height * .64 } });
  await expect.poll(() => page.evaluate(() => Object.keys(window.__crawlerApp.sketchDraft()?.geometry ?? {}).length), { timeout: 60_000 }).toBe(2);
  expect(await page.evaluate(() => {
    const draft = window.__crawlerApp.sketchDraft();
    return draft ? Object.values(draft.constraints).filter((constraint) => ["distance", "distance_x", "distance_y", "radius", "diameter", "ellipse_radius", "angle", "angle_to_axis"].includes(constraint.kind)).length : 0;
  })).toBe(2);
});

test("native control-point spline creates one entity, edits by stable handle, and finishes onto its 3D plane", async ({ page }) => {
  const { canvas, box, overlay } = await openSketch(page);
  await page.locator('[data-ribbon-flyout="draw"]').click();
  await page.locator('[data-ribbon-run="spline"]').click();
  const points = [
    { x: box.width * .35, y: box.height * .58 },
    { x: box.width * .45, y: box.height * .38 },
    { x: box.width * .56, y: box.height * .68 },
    { x: box.width * .68, y: box.height * .48 },
  ];
  for (const point of points) await canvas.click({ position: point });

  const spline = overlay.locator('.sketch-entity[data-sketch-geometry]');
  await expect(spline).toHaveCount(1, { timeout: 60_000 });
  await expect(overlay.locator('[data-sketch-handle][data-anchor^="control:"]')).toHaveCount(4);
  await expect(page.locator(".sketch-spline-panel")).toContainText("Control points");
  await expect(page.locator(".sketch-spline-panel")).toContainText("Open");
  const before = await spline.getAttribute("d");
  const cp2x = page.locator('[data-spline-control="1"][data-axis="x"]');
  const value = Number(await cp2x.inputValue());
  await cp2x.fill(String(value + 4));
  await page.locator(".sketch-spline-summary").click();
  await expect.poll(() => spline.getAttribute("d"), { timeout: 60_000 }).not.toBe(before);

  await page.keyboard.press("Escape");
  await overlay.locator('[data-sketch-handle][data-anchor="control:0"]').click({ force: true });
  await page.locator('[data-sketch-constraint="fixed"]').first().click();
  await expect(overlay.locator(".sketch-constraint-annotation")).not.toHaveCount(0, { timeout: 60_000 });

  await page.locator("#finish-sketch-ribbon").click();
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.committedSketchState().at(-1)?.pointCount), { timeout: 60_000 }).toBe(49);
});

test("fit spline, ellipse, elliptical arc, and conic remain native through contextual edit and 3D finish", async ({ page }) => {
  const { canvas, box, overlay } = await openSketch(page);
  const invoke = async (key: string) => {
    await page.locator('[data-ribbon-flyout="draw"]').click();
    await page.locator(`[data-ribbon-run="${key}"]`).click();
  };

  await invoke("fit-spline");
  for (const point of [{ x: .28, y: .52 }, { x: .38, y: .36 }, { x: .48, y: .66 }, { x: .58, y: .48 }]) await canvas.click({ force: true, position: { x: box.width * point.x, y: box.height * point.y } });
  await expect(overlay.locator('[data-anchor^="fit:"]')).toHaveCount(4, { timeout: 60_000 });
  await expect(page.locator(".sketch-spline-panel")).toContainText("Fit point spline");

  await invoke("ellipse");
  for (const point of [{ x: .62, y: .48 }, { x: .68, y: .48 }, { x: .62, y: .38 }]) await canvas.click({ force: true, position: { x: box.width * point.x, y: box.height * point.y } });
  await expect(overlay.locator('[data-anchor="major"]')).toHaveCount(1, { timeout: 60_000 });
  await expect(overlay.locator('[data-anchor="minor"]')).toHaveCount(1);

  await invoke("elliptical-arc");
  // Axis endpoints are valid sweep endpoints. Exercise the overlapping-handle
  // and inline-HUD hit route instead of avoiding this common CAD workflow.
  const ellipticalArcPoints = [{ x: .58, y: .28 }, { x: .66, y: .28 }, { x: .58, y: .20 }, { x: .66, y: .28 }, { x: .58, y: .20 }];
  for (const [index, point] of ellipticalArcPoints.entries()) {
    await page.keyboard.down("Alt");
    try { await canvas.click({ force: true, position: { x: box.width * point.x, y: box.height * point.y } }); }
    finally { await page.keyboard.up("Alt"); }
    if (index < ellipticalArcPoints.length - 1) await expect(page.locator("#active-tool-point-progress")).toContainText(`${index + 1} / 5`);
  }
  await expect(overlay.locator('[data-anchor="major"]')).toHaveCount(2, { timeout: 60_000 });
  await expect(overlay.locator('[data-anchor="start"]')).toHaveCount(1);
  await expect(overlay.locator('[data-anchor="end"]')).toHaveCount(1);

  await invoke("conic");
  for (const point of [{ x: .30, y: .76 }, { x: .44, y: .60 }, { x: .58, y: .76 }]) await canvas.click({ force: true, position: { x: box.width * point.x, y: box.height * point.y } });
  await expect(overlay.locator('[data-anchor="control"]')).toHaveCount(1, { timeout: 60_000 });
  const weight = page.locator("#active-tool-conic-weight");
  await expect(weight).toBeVisible(); await weight.fill("0.707107"); await weight.press("Tab");
  await expect(weight).toHaveValue("0.707107");
  await expect.poll(() => page.locator(".workspace").getAttribute("data-sketch-cursor")).not.toBe("applying");

  await expect(overlay.locator('.sketch-entity[data-sketch-geometry]')).toHaveCount(4);

  await page.locator("#finish-sketch-ribbon").click();
  await expect(page.locator('[data-workbench-ribbon="Sketcher"]')).toBeHidden({ timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.committedSketchState().at(-1)?.pointCount ?? 0)).toBeGreaterThan(210);
});

test("native sketch point keeps its stable position reference through 3D finish", async ({ page }) => {
  const { canvas, box, overlay } = await openSketch(page);
  await page.locator('[data-ribbon-flyout="draw"]').click();
  await page.locator('[data-ribbon-run="point"]').click();
  await canvas.click({ position: { x: box.width * .45, y: box.height * .55 } });
  await expect(overlay.locator('[data-anchor="position"]')).toHaveCount(1, { timeout: 60_000 });
  await page.locator("#finish-sketch-ribbon").click();
  await expect(page.locator('[data-workbench-ribbon="Sketcher"]')).toBeHidden({ timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.committedSketchState().at(-1)?.pointCount ?? 0)).toBeGreaterThanOrEqual(4);
});

test("Smart Dimension dispatches by selection, accepts unit expressions, and exposes target and disabled reasons", async ({ page }) => {
  const { canvas, box, overlay } = await openSketch(page);
  await canvas.click({ position: { x: box.width * .42, y: box.height * .54 } });
  await canvas.click({ position: { x: box.width * .58, y: box.height * .54 } });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");

  const line = overlay.locator('.sketch-entity[data-sketch-geometry]').first();
  await line.click({ force: true });
  await page.locator("#smart-sketch-dimension").click();
  await expect(page.locator(".workspace")).toHaveAttribute("data-sketch-cursor", "dimension");
  await expect(page.locator("#active-tool-instruction")).toContainText("snap Horizontal, Vertical, or Aligned");
  await expect(page.getByLabel("Dimension editor")).toBeVisible();
  await expect(overlay.locator('[data-dimension-preview-mode="horizontal"]')).toBeVisible();

  const value = page.locator("#active-tool-constraint-value");
  await value.fill("1 in + 5 mm");
  await value.press("Enter");
  await expect(overlay.locator(".sketch-constraint-annotation.dimension")).toHaveCount(1, { timeout: 60_000 });
  await expect(page.locator("#smart-sketch-dimension")).toHaveAttribute("aria-pressed", "true");

  const annotation = overlay.locator(".sketch-constraint-annotation.dimension");
  const constraintId = await annotation.getAttribute("data-sketch-constraint-id");
  const annotationBox = await annotation.boundingBox();
  expect(constraintId).toBeTruthy(); expect(annotationBox).not.toBeNull();
  await page.mouse.move(annotationBox!.x + annotationBox!.width / 2, annotationBox!.y + annotationBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(annotationBox!.x + annotationBox!.width / 2 + 45, annotationBox!.y + annotationBox!.height / 2 - 25, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate((id) => window.__crawlerApp.sketchDraft()?.dimension_positions?.[id], constraintId!)).toBeTruthy();

  await page.keyboard.press("Escape");
  await overlay.locator(".sketch-constraint-annotation.dimension").click();
  await page.locator("[data-make-reference]").click();
  await expect(overlay.locator(".sketch-constraint-annotation.dimension.reference")).toHaveCount(1, { timeout: 60_000 });
  await line.click({ force: true });
  const radius = page.locator('[data-sketch-constraint="radius"]');
  await expect(radius).toHaveCount(0);
  await expect(page.locator("#smart-sketch-dimension")).toBeVisible();
  await expect(page.getByLabel("Sketch selection filters")).toBeVisible();
  await page.locator("#sketch-selection-filter-toggle").click();
  await page.locator('[data-sketch-filter="points"]').uncheck();
  await expect(page.locator('[data-sketch-filter="points"]')).not.toBeChecked();
});

test("Smart Dimension immediately edits a selected line, Enter resizes it, and Escape cancels the preview", async ({ page }) => {
  const { canvas, box, overlay } = await openSketch(page);
  await canvas.click({ position: { x: box.width * .38, y: box.height * .55 } });
  await canvas.click({ position: { x: box.width * .56, y: box.height * .55 } });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");

  const line = overlay.locator('.sketch-entity[data-sketch-geometry]').first();
  const lineId = await line.getAttribute("data-sketch-geometry");
  expect(lineId).toBeTruthy();
  const lineLengthNm = () => page.evaluate((id) => {
    const geometry = window.__crawlerApp.sketchDraft()?.geometry[id]?.geometry;
    return geometry?.kind === "line" ? Math.round(Math.hypot(geometry.end.x_nm - geometry.start.x_nm, geometry.end.y_nm - geometry.start.y_nm)) : 0;
  }, lineId!);
  const originalLength = await lineLengthNm();
  const originalConstraintCount = await page.evaluate(() => Object.keys(window.__crawlerApp.sketchDraft()?.constraints ?? {}).length);

  await line.click({ force: true });
  await page.locator("#smart-sketch-dimension").click();
  const value = page.locator("#sketch-dimension-editor #active-tool-constraint-value");
  await expect(value).toBeVisible();
  await expect(value).toBeFocused();
  await expect.poll(() => value.evaluate((input) => ({ start: input.selectionStart, end: input.selectionEnd, length: input.value.length }))).toEqual({ start: 0, end: await value.inputValue().then((text) => text.length), length: await value.inputValue().then((text) => text.length) });

  await value.press("Escape");
  await expect(value).toBeHidden();
  await expect.poll(() => page.evaluate(() => Object.keys(window.__crawlerApp.sketchDraft()?.constraints ?? {}).length)).toBe(originalConstraintCount);
  expect(await lineLengthNm()).toBe(originalLength);

  await page.locator("#smart-sketch-dimension").click();
  await expect(value).toBeFocused();
  const initialDisplay = await value.inputValue();
  await value.press("Enter");
  await expect(value).toBeHidden();
  expect(await lineLengthNm()).toBe(originalLength);
  expect(initialDisplay).toMatch(/^\d+(?:\.\d{1,3})? mm$/);
  const annotation = overlay.locator(".sketch-constraint-annotation.dimension");
  await expect(annotation).toHaveCount(1);
  const dimensionId = await annotation.getAttribute("data-sketch-constraint-id");
  expect(dimensionId).toBeTruthy();
  await page.keyboard.press("Escape");
  await annotation.click();
  await page.locator(`[data-delete-constraint="${dimensionId}"]`).click();
  await expect(annotation).toHaveCount(0);

  await line.click({ force: true });
  await page.locator("#smart-sketch-dimension").click();
  await expect(value).toBeFocused();
  await value.fill("25 mm");
  await value.press("Enter");
  await expect(value).toBeHidden();
  await expect.poll(lineLengthNm, { timeout: 60_000 }).toBe(25_000_000);
  await expect(overlay.locator(".sketch-constraint-annotation.dimension")).toHaveCount(1);
});

test("active Smart Dimension collects two point clicks without a modifier", async ({ page }) => {
  const { canvas, box, overlay } = await openSketch(page);
  await canvas.click({ position: { x: box.width * .40, y: box.height * .56 } });
  await canvas.click({ position: { x: box.width * .60, y: box.height * .56 } });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await canvas.click({ position: { x: box.width * .20, y: box.height * .25 } });
  await page.keyboard.press("Escape");

  await page.locator("#smart-sketch-dimension").click();
  const geometryId = await overlay.locator('[data-sketch-handle][data-geometry]').first().getAttribute("data-geometry");
  expect(geometryId).toBeTruthy();
  const start = overlay.locator(`[data-sketch-handle][data-geometry="${geometryId}"][data-anchor="start"]`);
  const end = overlay.locator(`[data-sketch-handle][data-geometry="${geometryId}"][data-anchor="end"]`);
  await start.click({ force: true });
  await expect(page.locator("#smart-sketch-dimension")).not.toBeDisabled();
  await expect(page.locator("#active-tool-instruction")).toContainText("two points");
  await end.click({ force: true });
  await expect(page.locator("#active-tool-instruction")).toContainText("Place the horizontal distance dimension");
  await page.locator("#active-tool-constraint-value").fill("18 mm");
  await page.locator("#active-tool-constraint-value").press("Enter");
  await expect(overlay.locator(".sketch-constraint-annotation.dimension")).toHaveCount(1, { timeout: 60_000 });
  await expect(page.locator("#smart-sketch-dimension")).toHaveAttribute("aria-pressed", "true");
});

test("active Smart Dimension accepts line, circle, and arc geometry clicks", async ({ page }) => {
  const { canvas, box, overlay } = await openSketch(page);
  const clearSelection = () => canvas.click({ position: { x: box.width * .18, y: box.height * .24 } });

  await canvas.click({ position: { x: box.width * .34, y: box.height * .44 } });
  await canvas.click({ position: { x: box.width * .49, y: box.height * .44 } });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await clearSelection();
  const line = overlay.locator(".sketch-entity[data-sketch-geometry]").first();
  const lineId = await line.getAttribute("data-sketch-geometry");
  await page.locator("#smart-sketch-dimension").click();
  await line.click({ force: true });
  await expect(page.locator("#active-tool-instruction")).toContainText("snap Horizontal, Vertical, or Aligned");
  await page.locator("#active-tool-constraint-value").fill("16 mm");
  await page.locator("#active-tool-constraint-value").press("Enter");

  await page.locator('[data-sketch-tool="circle"]').first().click();
  await canvas.click({ position: { x: box.width * .63, y: box.height * .43 } });
  await canvas.click({ position: { x: box.width * .68, y: box.height * .43 } });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(overlay.locator(".sketch-entity")).toHaveCount(2, { timeout: 60_000 });
  const circleId = await overlay.locator("[data-sketch-radius][data-geometry]").first().getAttribute("data-geometry");
  expect(circleId).toBeTruthy();
  await clearSelection();
  await page.locator("#smart-sketch-dimension").click();
  await clickSketchStroke(page, overlay.locator(`[data-sketch-geometry="${circleId}"]`).first());
  await expect(page.locator("#active-tool-instruction")).toContainText("Place the diameter dimension");
  await page.locator("#sketch-dimension-editor-mode").selectOption("radius");
  await expect(page.locator("#active-tool-instruction")).toContainText("Place the radius dimension");
  await page.locator("#active-tool-constraint-value").fill("7 mm");
  await page.locator("#active-tool-constraint-value").press("Enter");

  await page.locator('[data-sketch-tool="arc"]').first().click();
  await canvas.click({ position: { x: box.width * .46, y: box.height * .66 } });
  await canvas.click({ position: { x: box.width * .51, y: box.height * .66 } });
  await canvas.click({ position: { x: box.width * .46, y: box.height * .60 } });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(overlay.locator(".sketch-entity")).toHaveCount(3, { timeout: 60_000 });
  const allGeometryIds = await overlay.locator("[data-sketch-geometry]").evaluateAll((entities) => [...new Set(entities.map((entity) => (entity as SVGElement).dataset.sketchGeometry!))]);
  const arcId = allGeometryIds.find((id) => id !== circleId && id !== lineId);
  expect(arcId).toBeTruthy();
  await clearSelection();
  await page.locator("#smart-sketch-dimension").click();
  await clickSketchStroke(page, overlay.locator(`[data-sketch-geometry="${arcId}"]`).first());
  await expect(page.locator("#active-tool-instruction")).toContainText("Place the radius dimension");
  await page.locator("#active-tool-constraint-value").fill("6 mm");
  await page.locator("#active-tool-constraint-value").press("Enter");
  await expect(overlay.locator(".sketch-constraint-annotation.dimension")).toHaveCount(3, { timeout: 60_000 });
});

test("Smart Dimension snaps a segment preview by cursor sector and accepts a second line for an angle", async ({ page }) => {
  const { canvas, box, overlay } = await openSketch(page);
  const drawLine = async (start: { x: number; y: number }, end: { x: number; y: number }) => {
    await canvas.click({ position: start });
    await canvas.click({ position: end });
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
  };

  await drawLine({ x: box.width * .38, y: box.height * .62 }, { x: box.width * .55, y: box.height * .45 });
  const diagonal = overlay.locator('.sketch-entity[data-sketch-geometry]').first();
  await canvas.click({ position: { x: box.width * .18, y: box.height * .22 } });
  await page.locator("#smart-sketch-dimension").click();
  await clickSketchStroke(page, diagonal);

  await canvas.hover({ position: { x: box.width * .47, y: box.height * .24 } });
  await expect(overlay.locator('[data-dimension-preview-mode="horizontal"]')).toBeVisible();
  await expect(overlay.locator(".dimension-witness")).toHaveCount(2);
  await canvas.hover({ position: { x: box.width * .76, y: box.height * .53 } });
  await expect(overlay.locator('[data-dimension-preview-mode="vertical"]')).toBeVisible();
  await canvas.hover({ position: { x: box.width * .34, y: box.height * .37 } });
  await expect(overlay.locator('[data-dimension-preview-mode="aligned"]')).toBeVisible();
  await expect(overlay.locator(".dimension-snap-label")).toContainText("Aligned");
  await canvas.click({ position: { x: box.width * .34, y: box.height * .37 } });
  await page.locator("#active-tool-constraint-value").fill("24 mm");
  await page.locator("#active-tool-constraint-value").press("Enter");
  await expect(overlay.locator(".sketch-constraint-annotation.dimension")).toHaveCount(1, { timeout: 60_000 });

  await page.keyboard.press("Escape");
  await page.locator('[data-sketch-tool="line"]').first().click();
  await drawLine({ x: box.width * .61, y: box.height * .63 }, { x: box.width * .73, y: box.height * .46 });
  const lines = overlay.locator('.sketch-entity[data-sketch-geometry]');
  await expect(lines).toHaveCount(2, { timeout: 60_000 });
  await canvas.click({ position: { x: box.width * .18, y: box.height * .22 } });
  await page.locator("#smart-sketch-dimension").click();
  await clickSketchStroke(page, lines.nth(0));
  await clickSketchStroke(page, lines.nth(1));
  await expect(overlay.locator('[data-dimension-preview-mode="angle"]')).toBeVisible();
  await expect(page.locator("#sketch-dimension-editor-mode")).toHaveValue("angle");
  await expect(page.locator("#active-tool-instruction")).toContainText("Place the angle dimension");
  await page.locator("#active-tool-constraint-value").fill("32 deg");
  await page.locator("#active-tool-constraint-value").press("Enter");
  await expect(overlay.locator(".sketch-constraint-annotation.dimension")).toHaveCount(2, { timeout: 60_000 });
  await expect(overlay.locator(".sketch-constraint-annotation.dimension").last().locator(".dimension-arc")).toHaveCount(1);
});

test("active coincident and midpoint tools collect operands without Ctrl", async ({ page }) => {
  const { canvas, box, overlay } = await openSketch(page);
  const drawLine = async (a: { x: number; y: number }, b: { x: number; y: number }) => {
    await canvas.click({ position: a });
    await canvas.click({ position: b });
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
  };
  await drawLine({ x: box.width * .38, y: box.height * .52 }, { x: box.width * .48, y: box.height * .52 });
  await page.locator('[data-sketch-tool="line"]').first().click();
  await drawLine({ x: box.width * .60, y: box.height * .62 }, { x: box.width * .72, y: box.height * .58 });
  await expect(overlay.locator(".sketch-entity")).toHaveCount(2, { timeout: 60_000 });

  const entityIds = await overlay.locator("[data-sketch-geometry]").evaluateAll((entities) => [...new Set(entities.map((entity) => (entity as SVGElement).dataset.sketchGeometry!))]);
  expect(entityIds.length).toBeGreaterThanOrEqual(2);
  const firstEnd = overlay.locator(`[data-sketch-handle][data-geometry="${entityIds[0]}"][data-anchor="end"]`);
  const firstStart = overlay.locator(`[data-sketch-handle][data-geometry="${entityIds[0]}"][data-anchor="start"]`);
  const secondStart = overlay.locator(`[data-sketch-handle][data-geometry="${entityIds[1]}"][data-anchor="start"]`);

  const beforeCoincident = await overlay.locator(".sketch-constraint-annotation").count();
  await canvas.click({ position: { x: box.width * .20, y: box.height * .25 } });
  await page.locator('[data-sketch-constraint="coincident"]').first().click();
  await firstStart.click({ force: true });
  await expect(page.locator('[data-sketch-constraint="coincident"]').first()).not.toBeDisabled();
  await secondStart.click({ force: true });
  await expect(overlay.locator(".sketch-constraint-annotation")).toHaveCount(beforeCoincident + 1, { timeout: 60_000 });

  const beforeMidpoint = await overlay.locator(".sketch-constraint-annotation").count();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.locator('[data-ribbon-flyout="constrain"]').click();
  await page.locator('[data-ribbon-run="midpoint"]').evaluate((button) => (button as HTMLButtonElement).click());
  await firstEnd.click({ force: true });
  await expect(page.locator('[data-ribbon-run="midpoint"]')).not.toBeDisabled();
  await overlay.locator(`[data-sketch-geometry="${entityIds[1]}"]`).first().click({ force: true });
  await expect(overlay.locator(".sketch-constraint-annotation")).toHaveCount(beforeMidpoint + 1, { timeout: 60_000 });
  await expect(page.locator('[data-ribbon-run="midpoint"]')).toHaveAttribute("data-tool-state", "complete");
});

test("rectangle diagonal construction and circle center remain responsive for midpoint constraint", async ({ page }) => {
  const { canvas, box, overlay } = await openSketch(page);
  const at = (x: number, y: number) => ({ x: box.width * x, y: box.height * y });

  await page.locator('[data-sketch-tool="rectangle"]').first().click();
  await canvas.click({ position: at(.36, .34), force: true });
  await canvas.click({ position: at(.64, .68), force: true });
  await expect(overlay.locator(".sketch-entity")).toHaveCount(4, { timeout: 10_000 });

  await page.locator('[data-sketch-tool="construction"]').click();
  await expect(overlay.locator(".sketch-entity.construction")).toHaveCount(0);
  await page.locator('[data-sketch-tool="line"]').first().click();
  await canvas.click({ position: at(.36, .34), force: true });
  await canvas.click({ position: at(.64, .68), force: true });
  await page.keyboard.press("Enter");
  await expect(overlay.locator(".sketch-entity.construction")).toHaveCount(1, { timeout: 10_000 });

  await page.locator('[data-sketch-tool="construction"]').click();
  await page.locator('[data-sketch-tool="circle"]').first().click();
  await canvas.click({ position: at(.50, .51), force: true });
  await canvas.click({ position: at(.56, .51), force: true });
  await expect(overlay.locator("[data-sketch-radius][data-geometry]")).toHaveCount(1, { timeout: 10_000 });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  const center = overlay.locator('[data-sketch-handle][data-anchor="center"]').last();
  const started = performance.now();
  await center.hover();
  await center.click({ force: true });
  await overlay.locator(".sketch-entity.construction").click({ force: true, modifiers: ["Control"], position: { x: 90, y: 65 } });
  await page.locator('[data-ribbon-flyout="constrain"]').click();
  await expect(page.locator('[data-ribbon-run="midpoint"]')).not.toBeDisabled({ timeout: 2_000 });
  await page.locator('[data-ribbon-run="midpoint"]').evaluate((button) => (button as HTMLButtonElement).click());
  await expect(page.locator('[data-ribbon-run="midpoint"]')).toHaveAttribute("data-tool-state", "complete", { timeout: 5_000 });
  expect(performance.now() - started).toBeLessThan(2_000);
  const draft = await page.evaluate(() => window.__crawlerApp.sketchDraft());
  expect(Object.values(draft!.constraints).some((constraint) => constraint.kind === "midpoint" && constraint.point.anchor === "center")).toBe(true);
});

test("the implied origin can be selected as a line midpoint reference", async ({ page }) => {
  const { canvas, box, overlay } = await openSketch(page);
  await canvas.click({ position: { x: box.width * .42, y: box.height * .40 } });
  await canvas.click({ position: { x: box.width * .58, y: box.height * .44 } });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");

  const line = overlay.locator(".sketch-entity[data-sketch-geometry]").first();
  const origin = overlay.locator("[data-sketch-origin]");
  await line.click({ force: true });
  await origin.click({ force: true });
  await page.locator('[data-ribbon-flyout="constrain"]').click();
  await page.locator('[data-ribbon-run="midpoint"]').evaluate((button) => (button as HTMLButtonElement).click());
  await expect(page.locator('[data-ribbon-run="midpoint"]')).toHaveAttribute("data-tool-state", "complete", { timeout: 60_000 });

  const centered = await Promise.all([
    line.evaluate((element) => {
      const value = element as SVGLineElement;
      return { x: (value.x1.baseVal.value + value.x2.baseVal.value) / 2, y: (value.y1.baseVal.value + value.y2.baseVal.value) / 2 };
    }),
    origin.locator("circle").evaluate((element) => {
      const value = element as SVGCircleElement;
      return { x: value.cx.baseVal.value, y: value.cy.baseVal.value };
    }),
  ]);
  expect(centered[0].x).toBeCloseTo(centered[1].x, 3);
  expect(centered[0].y).toBeCloseTo(centered[1].y, 3);
  await expect(overlay.locator(".sketch-constraint-annotation")).not.toHaveCount(0);
});

test("modify previews are confirmed, construction preserves the active tool, and sketch visibility persists", async ({ page }) => {
  const { canvas, box, overlay } = await openSketch(page);
  await canvas.click({ position: { x: box.width * .40, y: box.height * .56 } });
  await canvas.click({ position: { x: box.width * .55, y: box.height * .49 } });
  await expect(overlay.locator(".sketch-entity")).toHaveCount(1, { timeout: 60_000 });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  const accepted = await overlay.locator(".sketch-entity").count();

  await overlay.locator(".sketch-entity").first().click({ force: true });
  await page.locator('[data-ribbon-flyout="edit-sketch"]').click();
  await page.locator('[data-ribbon-run="offset"]').click();
  await expect(overlay.locator(".sketch-operation-preview")).toBeVisible();
  await expect(overlay.locator(".sketch-entity")).toHaveCount(accepted);
  await page.keyboard.press("Enter");
  await expect(overlay.locator(".sketch-entity")).toHaveCount(accepted + 1, { timeout: 60_000 });

  await page.keyboard.press("Escape");
  const offsetResult = await page.evaluate(() => {
    const operation = Object.values(window.__crawlerApp.sketchDraft()?.operations ?? {}).find((candidate) => candidate.kind === "offset");
    return operation?.kind === "offset" ? operation.result_chains.flat()[0] : undefined;
  });
  expect(offsetResult).toBeTruthy();
  await clickSketchStroke(page, overlay.locator(`[data-sketch-geometry="${offsetResult}"]`));
  await expect(page.locator(".sketch-operation-panel")).toContainText("Retained operation");
  const distance = page.locator('[data-operation-field="distance_nm"]');
  await distance.fill("7.5");
  await distance.blur();
  await expect.poll(() => distance.inputValue(), { timeout: 60_000 }).toBe("7.5");
  await expect(overlay.locator(".sketch-entity").last()).toHaveAttribute("data-participation", /[1-9]/);
  await expect(page.locator(".sketch-context-palette")).toContainText("Look At");
  await page.locator(".sketch-context-palette > summary").click();
  await page.locator('[data-sketch-visibility="points"]').uncheck();
  await expect(overlay.locator(".sketch-handle")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await overlay.locator(".sketch-entity").first().click({ force: true });
  await page.locator('[data-sketch-tool="line"]').click();
  await page.locator('[data-sketch-tool="construction"]').click();
  await expect(page.locator("#inspector-tool-tab")).toHaveText("Line");
  // Construction is a mode for the armed creation tool; it must not silently
  // reinterpret the geometry that happened to be selected beforehand.
  await canvas.click({ force: true, position: { x: box.width * .28, y: box.height * .72 } });
  await canvas.click({ force: true, position: { x: box.width * .38, y: box.height * .78 } });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(overlay.locator(".sketch-entity.construction")).not.toHaveCount(0, { timeout: 60_000 });

  await page.locator("#finish-sketch-ribbon").click();
  await expect(page.locator('[data-workbench-ribbon="Sketcher"]')).toBeHidden({ timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.committedSketchCount())).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.committedSketchState().every((sketch) => sketch.visible && sketch.polylineCount > 0 && sketch.pointCount >= 2))).toBe(true);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("crawler.sketch.hidden-committed.v2") ?? "[]") as string[])).toEqual([]);
  const committedId = await page.evaluate(() => window.__crawlerApp.committedSketchState().at(-1)?.id);
  expect(committedId).toBeTruthy();
  await page.locator(`[data-sketch-visibility="${committedId}"]`).evaluate((button) => (button as HTMLButtonElement).click());
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.committedSketchState().some((sketch) => !sketch.visible))).toBe(true);
  const hiddenBeforeReload = await page.evaluate(() => JSON.parse(localStorage.getItem("crawler.sketch.hidden-committed.v2") ?? "[]") as string[]);
  expect(hiddenBeforeReload.length).toBeGreaterThan(0);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("crawler.sketch.hidden-committed.v2") ?? "[]") as string[])).toEqual(hiddenBeforeReload);
});
