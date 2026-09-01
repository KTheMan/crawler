import { expect, test, type Locator, type Page } from "@playwright/test";

test.setTimeout(120_000);

async function openSketch(page: Page): Promise<{ canvas: Locator; overlay: Locator; box: { x: number; y: number; width: number; height: number } }> {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
  await page.locator("#edit-sketch").click();
  await page.evaluate(() => window.__crawlerApp.chooseOriginSketchSupport("xy"));
  const canvas = page.getByLabel("3D viewport");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("viewport has no bounds");
  return { canvas, overlay: page.getByLabel("Editable sketch geometry"), box };
}

test("hover rails, persistent add/remove, and lazy overlap UI keep selection intent visible", async ({ page }) => {
  const { overlay } = await openSketch(page);

  await page.evaluate(async () => window.__crawlerApp.applySketchCommands([
    { kind: "add_geometry", entity: { id: "selection:line:a", geometry: { kind: "line", start: { x_nm: -8_000_000, y_nm: 3_000_000 }, end: { x_nm: 2_000_000, y_nm: 8_000_000 } } } },
    { kind: "add_geometry", entity: { id: "selection:line:b", geometry: { kind: "line", start: { x_nm: 4_000_000, y_nm: -7_000_000 }, end: { x_nm: 10_000_000, y_nm: -1_000_000 } } } },
  ]));

  const visible = overlay.locator(".sketch-entity[data-sketch-geometry]");
  const first = visible.nth(0);
  const second = visible.nth(1);
  const firstId = await first.getAttribute("data-sketch-geometry");
  const secondId = await second.getAttribute("data-sketch-geometry");
  if (!firstId) throw new Error("first entity has no id");
  if (!secondId) throw new Error("second entity has no id");
  const hit = overlay.locator(`[data-sketch-hit-geometry="${firstId}"]`);
  const secondHit = overlay.locator(`[data-sketch-hit-geometry="${secondId}"]`);

  await hit.hover({ force: true });
  await expect(first).toHaveClass(/preselected/);
  await expect(page.locator("#sketch-hover-card")).toBeVisible();
  await expect(page.locator("#sketch-hover-card")).toContainText("Click to select");
  await expect.poll(() => hit.evaluate((element) => getComputedStyle(element).strokeWidth)).toBe("18px");

  await hit.click({ force: true });
  const tray = page.getByLabel("Sketch selection actions");
  await expect(tray).toBeVisible();
  await expect(tray).toContainText("1 selected");
  await tray.getByRole("button", { name: "Add" }).click();
  await secondHit.dispatchEvent("pointerdown", { button: 0, pointerId: 31 });
  await expect(tray).toContainText("2 selected");
  await expect(overlay.locator(".sketch-entity.selected")).toHaveCount(2);

  await tray.getByRole("button", { name: "Remove" }).click();
  await hit.dispatchEvent("pointerdown", { button: 0, pointerId: 32 });
  await expect(tray).toContainText("1 selected");
  await expect(overlay.locator(".sketch-entity.selected")).toHaveCount(1);

  const selectOther = page.locator("#sketch-select-other");
  await expect(selectOther).toBeHidden();
  await expect(selectOther.locator("button")).toHaveCount(0);
});

test("marquee direction publishes containment/crossing semantics before commit", async ({ page }) => {
  const { canvas, overlay, box } = await openSketch(page);
  const point = (x: number, y: number) => ({ x: box.width * x, y: box.height * y });
  await canvas.click({ position: point(.43, .50) });
  await canvas.click({ position: point(.57, .50) });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await canvas.hover({ position: point(.30, .35) });
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .63, box.y + box.height * .65, { steps: 3 });
  await expect(overlay.locator(".sketch-box-selection.containment")).toBeVisible();
  await expect(overlay.locator(".sketch-box-selection-label")).toContainText("Window · fully inside");
  await page.mouse.up();

  await page.keyboard.press("Escape");
  await canvas.hover({ position: point(.58, .65) });
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .30, box.y + box.height * .35, { steps: 3 });
  await expect(overlay.locator(".sketch-box-selection.crossing")).toBeVisible();
  await expect(overlay.locator(".sketch-box-selection-label")).toContainText("Crossing · touched");
  await page.mouse.up();
});

test("Select context keeps selection state primary and support secondary", async ({ page }) => {
  const { overlay } = await openSketch(page);
  await page.evaluate(async () => window.__crawlerApp.applySketchCommands([
    { kind: "add_geometry", entity: { id: "selection:context-line", geometry: { kind: "line", start: { x_nm: -8_000_000, y_nm: 2_000_000 }, end: { x_nm: 8_000_000, y_nm: 7_000_000 } } } },
  ]));
  await overlay.locator('[data-sketch-hit-geometry="selection:context-line"]').click({ force: true });

  const inspector = page.getByLabel("Sketch tool properties");
  const selection = page.getByLabel("Sketch selection properties");
  await expect(inspector).toHaveAttribute("data-selection-primary", "true");
  await expect(inspector.locator(".active-tool-prompt")).toHaveCount(0);
  await expect(selection).toContainText("1 selected");
  await expect(selection).toContainText("1 curve");
  await expect(selection).toContainText("line");

  const behavior = selection.getByRole("group", { name: "Selection behavior" });
  await behavior.getByRole("button", { name: "Add" }).click();
  await expect(behavior.getByRole("button", { name: "Add" })).toHaveAttribute("aria-pressed", "true");

  const support = inspector.locator(".sketch-context-support");
  await expect(support).not.toHaveAttribute("open", "");
  await expect(support).toContainText("XY origin plane");

  await selection.getByRole("button", { name: "Clear" }).click();
  await expect(selection).toContainText("Ready to select");
  await expect(selection.getByRole("button", { name: "Replace" })).toHaveAttribute("aria-pressed", "true");
});

test("constraint glyphs follow selection and constrained arc sections resolve independently", async ({ page }) => {
  const { overlay } = await openSketch(page);
  await page.evaluate(async () => window.__crawlerApp.applySketchCommands([
    {
      kind: "add_geometry",
      entity: {
        id: "visual:arc",
        geometry: {
          kind: "arc",
          center: { x_nm: 0, y_nm: 0 },
          start: { x_nm: 20_000_000, y_nm: 0 },
          end: { x_nm: 0, y_nm: 20_000_000 },
          clockwise: false,
        },
      },
    },
    {
      kind: "add_geometry",
      entity: {
        id: "visual:line",
        geometry: {
          kind: "line",
          start: { x_nm: 0, y_nm: 20_000_000 },
          end: { x_nm: -15_000_000, y_nm: 20_000_000 },
        },
      },
    },
    { kind: "add_constraint", id: "visual:diameter", constraint: { kind: "diameter", geometry: "visual:arc", diameter_nm: 40_000_000 } },
    {
      kind: "add_constraint",
      id: "visual:join",
      constraint: {
        kind: "coincident",
        a: { geometry: "visual:arc", anchor: "end" },
        b: { geometry: "visual:line", anchor: "start" },
      },
    },
  ]));

  await expect(overlay).toHaveAttribute("data-annotation-density", "selection");
  await expect(overlay.locator(".sketch-constraint-annotation")).toHaveCount(1);
  await expect(overlay.locator('[data-sketch-constraint-id="visual:diameter"]')).toBeVisible();
  await expect(overlay.locator('[data-sketch-constraint-id="visual:join"]')).toHaveCount(0);

  await page.keyboard.press("Escape");
  const arc = overlay.locator('[data-sketch-geometry="visual:arc"]');
  const arcPoint = await arc.evaluate((element) => {
    const geometry = element as SVGGeometryElement;
    const point = geometry.getPointAtLength(geometry.getTotalLength() * .42).matrixTransform(geometry.getScreenCTM()!);
    return { x: point.x, y: point.y };
  });
  await page.mouse.move(arcPoint.x, arcPoint.y);
  await page.mouse.click(arcPoint.x, arcPoint.y);
  await expect(overlay.locator(".sketch-constraint-annotation")).toHaveCount(2);
  await expect(overlay.locator(".sketch-constraint-annotation.icon .sketch-constraint-icon")).toHaveCount(1);
  await expect(overlay.locator(".sketch-constraint-annotation.icon text")).toHaveCount(0);
  await expect(overlay.locator('[data-sketch-constraint-id="visual:diameter"]')).toHaveAttribute("data-constraint-state", "driving");
  await expect(overlay.locator('[data-sketch-constraint-id="visual:join"]')).toHaveAttribute("data-constraint-state", "driving");
  await expect(arc).toHaveClass(/constraint-target/);
  await expect(overlay.locator('[data-sketch-handle="visual:arc:start"]')).toHaveAttribute("data-constraint-state", "unconstrained");
  await expect(overlay.locator('[data-sketch-handle="visual:arc:end"]')).toHaveAttribute("data-constraint-state", "constrained");
  await expect(overlay.locator('[data-sketch-handle="visual:arc:center"]')).toHaveAttribute("data-constraint-state", "unconstrained");
  await expect(overlay.locator('[data-mobility-for="visual:arc:start"]')).toHaveAttribute("data-mobility-kind", "angular");
  await expect(overlay.locator('[data-mobility-for="visual:arc:center"]')).toHaveAttribute("data-mobility-kind", "xy");
  await expect(overlay.locator('[data-mobility-for="visual:arc:end"]')).toHaveCount(0);

  const coincidentGlyph = overlay.locator('.sketch-constraint-annotation.icon[data-sketch-constraint-id="visual:join"]');
  await coincidentGlyph.hover({ force: true });
  await expect(overlay.locator('[data-focus-constraint="visual:join"] line')).toHaveCount(2);
  await expect(overlay.locator('[data-sketch-geometry="visual:line"]')).toHaveClass(/constraint-operand/);
  await expect(overlay.locator('[data-sketch-handle="visual:arc:end"]')).toHaveClass(/constraint-operand/);
  await expect(overlay.locator('[data-sketch-handle="visual:arc:start"]')).not.toHaveClass(/constraint-operand/);
  await page.getByLabel("3D viewport").hover({ position: { x: 8, y: 8 }, force: true });
  await expect(overlay.locator("[data-focus-constraint]")).toHaveCount(0);

  await page.locator('[data-inspector-tab="constraints"]').click();
  await expect(page.locator("[data-active-selection-constraint]")).toHaveCount(2);
  await expect(page.locator(".constraints-content .sketch-constraint-icon")).toHaveCount(2);
  await page.locator('[data-active-selection-constraint="visual:diameter"]').hover();
  await expect(overlay.locator('[data-focus-constraint="visual:diameter"]')).toHaveCount(1);
  await expect(arc).toHaveClass(/constraint-operand/);
  await page.locator('[data-inspector-tab="tool"]').click();
  await page.locator('[data-selection-relation="visual:diameter"]').click();
  const toolbar = overlay.locator('[data-constraint-toolbar-for="visual:diameter"]');
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole("button", { name: "Reference constraint" }).click({ force: true });
  await expect(overlay.locator('[data-sketch-constraint-id="visual:diameter"]')).toHaveAttribute("data-constraint-state", "reference");
  await expect(arc).not.toHaveClass(/constraint-target/);
  await toolbar.getByRole("button", { name: "Enable constraint" }).click({ force: true });
  await expect(overlay.locator('[data-sketch-constraint-id="visual:diameter"]')).toHaveAttribute("data-constraint-state", "driving");
  await expect(arc).toHaveClass(/constraint-target/);
  await page.getByLabel("Sketch selection properties").getByRole("button", { name: "Clear" }).click();
  await expect(overlay.locator(".sketch-constraint-annotation")).toHaveCount(1);
  await expect(overlay.locator('[data-sketch-constraint-id="visual:diameter"]')).toBeVisible();
});

test("fully constrained geometry cannot be displaced by a body drag", async ({ page }) => {
  const { overlay } = await openSketch(page);
  await page.evaluate(async () => window.__crawlerApp.applySketchCommands([
    { kind: "add_geometry", entity: { id: "defined:line", geometry: { kind: "line", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 20_000_000, y_nm: 0 } } } },
    { kind: "add_constraint", id: "defined:origin", constraint: { kind: "point_on_origin", point: { geometry: "defined:line", anchor: "start" } } },
    { kind: "add_constraint", id: "defined:horizontal", constraint: { kind: "horizontal", line: "defined:line" } },
    { kind: "add_constraint", id: "defined:length", constraint: { kind: "distance", a: { geometry: "defined:line", anchor: "start" }, b: { geometry: "defined:line", anchor: "end" }, distance_nm: 20_000_000 } },
  ]));
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await expect.poll(() => page.evaluate(() => window.__crawlerApp.sketchSolve()?.state)).toBe("fully_constrained");
  await expect(overlay.locator('[data-sketch-constraint-id="defined:length"]')).toBeVisible();
  const line = overlay.locator('[data-sketch-geometry="defined:line"]');
  const before = await page.evaluate(() => window.__crawlerApp.sketchDraft()!.geometry["defined:line"].geometry);
  const center = await line.evaluate((element) => {
    const geometry = element as SVGGeometryElement;
    const point = geometry.getPointAtLength(geometry.getTotalLength() / 2).matrixTransform(geometry.getScreenCTM()!);
    return { x: point.x, y: point.y };
  });
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 80, center.y + 50, { steps: 4 });
  await expect(line).not.toHaveAttribute("transform", /translate/);
  await page.mouse.up();

  await expect.poll(() => page.evaluate(() => window.__crawlerApp.sketchDraft()!.geometry["defined:line"].geometry)).toEqual(before);
  await expect(overlay.locator('[data-sketch-constraint-id="defined:length"]')).toBeVisible();
});

test("body dragging an under-constrained curve preserves its defined position relations", async ({ page }) => {
  const { overlay } = await openSketch(page);
  await page.evaluate(async () => window.__crawlerApp.applySketchCommands([
    { kind: "add_geometry", entity: { id: "anchored:line", geometry: { kind: "line", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 20_000_000, y_nm: 0 } } } },
    { kind: "add_constraint", id: "anchored:origin", constraint: { kind: "point_on_origin", point: { geometry: "anchored:line", anchor: "start" } } },
    { kind: "add_constraint", id: "anchored:horizontal", constraint: { kind: "horizontal", line: "anchored:line" } },
  ]));
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  const line = overlay.locator('[data-sketch-geometry="anchored:line"]');
  const dragPoint = await line.evaluate((element) => {
    const geometry = element as SVGGeometryElement;
    const point = geometry.getPointAtLength(geometry.getTotalLength() * .75).matrixTransform(geometry.getScreenCTM()!);
    return { x: point.x, y: point.y };
  });
  await page.mouse.move(dragPoint.x, dragPoint.y);
  await page.mouse.down();
  await page.mouse.move(dragPoint.x + 80, dragPoint.y + 50, { steps: 4 });
  await page.mouse.up();

  await expect.poll(() => page.evaluate(() => {
    const geometry = window.__crawlerApp.sketchDraft()!.geometry["anchored:line"].geometry;
    return geometry.kind === "line" ? geometry.end.x_nm : 0;
  })).toBeGreaterThan(20_000_000);
  const after = await page.evaluate(() => window.__crawlerApp.sketchDraft()!.geometry["anchored:line"].geometry);
  expect(after.kind).toBe("line");
  if (after.kind === "line") {
    expect(after.start).toEqual({ x_nm: 0, y_nm: 0 });
    expect(after.end.y_nm).toBe(0);
  }
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.sketchSolve()?.conflicts.length)).toBe(0);
});

test("cursor inference previews use constraint glyphs instead of text placeholders", async ({ page }) => {
  const { canvas, overlay, box } = await openSketch(page);
  await page.locator('[data-sketch-tool="line"]').first().click();
  await expect(page.locator('[data-sketch-tool="line"]').first()).toHaveAttribute("aria-pressed", "true");
  const first = { x: box.width * .38, y: box.height * .52 };
  const second = { x: box.width * .62, y: box.height * .52 };
  await canvas.click({ position: first });
  await canvas.hover({ position: second });
  const horizontal = overlay.locator('.sketch-inference-badge[data-inference-kind="horizontal"]');
  await expect(horizontal).toBeVisible();
  await expect(horizontal.locator("svg")).toHaveCount(1);
  await expect(horizontal.locator("text")).toHaveCount(0);
});

test("an implied origin midpoint stays redundant instead of overconstraining centered construction", async ({ page }) => {
  await openSketch(page);
  await page.evaluate(async () => window.__crawlerApp.applySketchCommands([
    { kind: "add_geometry", entity: { id: "center-line", construction: true, geometry: { kind: "line", start: { x_nm: -10_000_000, y_nm: 0 }, end: { x_nm: 10_000_000, y_nm: 0 } } } },
    { kind: "add_geometry", entity: { id: "center-point", construction: true, geometry: { kind: "sketch_point", x_nm: 0, y_nm: 0 } } },
    { kind: "add_constraint", id: "center-point-midpoint", constraint: { kind: "midpoint", point: { geometry: "center-point", anchor: "position" }, line: "center-line" } },
    { kind: "add_constraint", id: "center-point-origin", constraint: { kind: "point_on_origin", point: { geometry: "center-point", anchor: "position" } } },
    { kind: "add_constraint", id: "center-horizontal", constraint: { kind: "horizontal", line: "center-line" } },
    { kind: "add_constraint", id: "center-length", constraint: { kind: "distance", a: { geometry: "center-line", anchor: "start" }, b: { geometry: "center-line", anchor: "end" }, distance_nm: 20_000_000 } },
    { kind: "add_constraint", id: "center-origin-midpoint", constraint: { kind: "midpoint", point: { geometry: "reference:origin", anchor: "center" }, line: "center-line" } },
  ]));
  const solve = await page.evaluate(() => window.__crawlerApp.sketchSolve());
  expect(solve?.state).toBe("fully_constrained");
  expect(solve?.conflicts).toEqual([]);
  expect(solve?.redundant_constraints).toContain("center-origin-midpoint");
});
