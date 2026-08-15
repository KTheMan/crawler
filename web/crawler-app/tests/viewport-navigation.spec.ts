import { expect, test, type Page } from "@playwright/test";

test.setTimeout(180_000);

async function ready(page: Page): Promise<void> {
  await page.goto("/?qualificationReferencePart=1");
  await page.waitForFunction(() => Boolean(window.__crawlerApp) && Object.values(window.__crawlerApp.readiness()).every((status) => status === "ready"));
}

async function enterPlane(page: Page, plane: "xy" | "xz" | "yz"): Promise<void> {
  await page.locator("#edit-sketch").click();
  await expect(page.getByLabel("Sketch plane selection")).toHaveAttribute("data-selecting", "true");
  await page.evaluate((value) => window.__crawlerApp.chooseOriginSketchSupport(value), plane);
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.viewportSnapshot()?.navigationMode)).toBe("sketch");
}

function distance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function independentlyProject(
  point: readonly [number, number, number],
  snapshot: NonNullable<ReturnType<Window["__crawlerApp"]["viewportSnapshot"]>>,
  width: number,
  height: number,
): { x: number; y: number } {
  const [qx, qy, qz, qw] = snapshot.cameraPose.orientation;
  const [px, py, pz] = snapshot.cameraPose.position;
  const x = point[0] - px; const y = point[1] - py; const z = point[2] - pz;
  // Rotate world delta by the conjugate camera quaternion.
  const ix = qw * x - qy * z + qz * y;
  const iy = qw * y - qz * x + qx * z;
  const iz = qw * z - qx * y + qy * x;
  const iw = qx * x + qy * y + qz * z;
  const localX = ix * qw + iw * qx + iy * qz - iz * qy;
  const localY = iy * qw + iw * qy + iz * qx - ix * qz;
  if (snapshot.projection.kind !== "orthographic") throw new Error("independent sketch projection expects orthographic state");
  const viewWidth = snapshot.projection.viewHeight * width / height;
  return { x: width * 0.5 + localX / viewWidth * width, y: height * 0.5 - localY / snapshot.projection.viewHeight * height };
}

test("shared sketch viewport state owns plane frame, point orbit, pan, zoom, and full exit restoration", async ({ page }) => {
  await ready(page);
  const model = await page.evaluate(() => window.__crawlerApp.viewportSnapshot());
  expect(model).toBeDefined();
  await enterPlane(page, "xz");

  const entered = await page.evaluate(() => window.__crawlerApp.viewportSnapshot()!);
  expect(entered.projection.kind).toBe("orthographic");
  expect(entered.workingSketchFrame).toEqual({ origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 0, 1], normal: [0, -1, 0] });
  expect(entered.pivot.point).toEqual(entered.workingSketchFrame!.origin);

  const canvas = page.getByLabel("3D viewport");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("viewport bounds unavailable");
  const cursor = { x: box.x + box.width * 0.67, y: box.y + box.height * 0.43 };
  const probe = await page.evaluate(({ x, y }) => window.__crawlerApp.viewportProbeAt(x, y), cursor);
  expect(probe.world).toBeDefined();

  await page.mouse.move(cursor.x, cursor.y);
  await page.mouse.down({ button: "middle" });
  const pivoted = await page.evaluate(() => window.__crawlerApp.viewportSnapshot()!);
  expect(pivoted.navigationMode).toBe("temporary-orbit");
  // Browser pointer coordinates are CSS-pixel quantized; at this zoom that is
  // a few nanometers in plane-local space.
  expect(distance(pivoted.pivot.point, probe.world!)).toBeLessThan(1e-5);
  const orbitRadius = distance(pivoted.cameraPose.position, pivoted.pivot.point);
  await page.mouse.move(cursor.x + 70, cursor.y + 32, { steps: 5 });
  await page.mouse.up({ button: "middle" });
  const orbited = await page.evaluate(() => window.__crawlerApp.viewportSnapshot()!);
  expect(orbited.navigationMode).toBe("sketch");
  expect(distance(orbited.cameraPose.position, orbited.pivot.point)).toBeCloseTo(orbitRadius, 6);
  expect(orbited.workingSketchFrame).toEqual(entered.workingSketchFrame);

  await page.locator(".sketch-context-palette > summary").click();
  await page.locator("#sketch-look-at").click();
  const lookedAt = await page.evaluate(() => window.__crawlerApp.viewportSnapshot()!);
  expect(lookedAt.pivot.point).toEqual(entered.workingSketchFrame!.origin);
  const lookDirection = lookedAt.cameraPose.position.map((value, index) => value - lookedAt.pivot.point[index]);
  const lookLength = Math.hypot(...lookDirection);
  lookDirection.forEach((value, index) => expect(value / lookLength).toBeCloseTo(entered.workingSketchFrame!.normal[index], 6));

  await page.mouse.move(cursor.x, cursor.y);
  await page.keyboard.down("Control");
  await page.mouse.down({ button: "middle" });
  const beforePan = await page.evaluate(() => window.__crawlerApp.viewportSnapshot()!);
  await page.mouse.move(cursor.x + 48, cursor.y - 25, { steps: 4 });
  await page.mouse.up({ button: "middle" });
  await page.keyboard.up("Control");
  const panned = await page.evaluate(() => window.__crawlerApp.viewportSnapshot()!);
  const cameraDelta = panned.cameraPose.position.map((value, index) => value - beforePan.cameraPose.position[index]);
  const pivotDelta = panned.pivot.point.map((value, index) => value - beforePan.pivot.point[index]);
  pivotDelta.forEach((value, index) => expect(value).toBeCloseTo(cameraDelta[index], 6));

  const zoomCursor = { x: box.x + box.width * 0.72, y: box.y + box.height * 0.36 };
  const beforeZoomProbe = await page.evaluate(({ x, y }) => window.__crawlerApp.viewportProbeAt(x, y), zoomCursor);
  await page.mouse.move(zoomCursor.x, zoomCursor.y);
  await page.mouse.wheel(0, -240);
  const afterZoom = await page.evaluate(() => window.__crawlerApp.viewportSnapshot()!);
  const afterZoomProbe = await page.evaluate(({ x, y }) => window.__crawlerApp.viewportProbeAt(x, y), zoomCursor);
  expect(afterZoom.projection.kind).toBe("orthographic");
  if (afterZoom.projection.kind === "orthographic" && panned.projection.kind === "orthographic") expect(afterZoom.projection.viewHeight).toBeLessThan(panned.projection.viewHeight);
  // The public probe round-trips through integer nanometer plane coordinates;
  // the remaining drift is far below one CSS pixel at the active view scale.
  expect(distance(beforeZoomProbe.world!, afterZoomProbe.world!)).toBeLessThan(0.02);

  await page.getByRole("button", { name: "Discard sketch draft" }).click();
  const restored = await page.evaluate(() => window.__crawlerApp.viewportSnapshot()!);
  expect(restored.cameraPose).toEqual(model!.cameraPose);
  expect(restored.projection).toEqual(model!.projection);
  expect(restored.pivot).toEqual(model!.pivot);
  expect(restored.navigationMode).toBe("model");
  expect(restored.workingSketchFrame).toBeNull();
});

test("SVG sketch projection follows camera orbit and view-cube navigation", async ({ page }) => {
  await ready(page);
  await enterPlane(page, "xy");
  const canvas = page.getByLabel("3D viewport");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("viewport bounds unavailable");
  await canvas.click({ position: { x: box.width * 0.43, y: box.height * 0.57 } });
  await canvas.click({ position: { x: box.width * 0.61, y: box.height * 0.48 } });
  const line = page.locator("#sketch-overlay line[data-sketch-geometry]").last();
  await expect(line).toBeVisible({ timeout: 60_000 });

  const assertEndpointAlignment = async () => {
    const currentBox = await canvas.boundingBox();
    if (!currentBox) throw new Error("viewport bounds unavailable");
    const endpoint = await line.evaluate((element) => ({ x: Number(element.getAttribute("x1")), y: Number(element.getAttribute("y1")) }));
    const draftPoint = await page.evaluate(() => {
      const geometry = Object.values(window.__crawlerApp.sketchDraft()!.geometry).find((entity) => entity.geometry.kind === "line")!;
      return geometry.geometry.kind === "line" ? geometry.geometry.start : undefined;
    });
    const local = await page.evaluate(({ x, y, left, top }) => window.__crawlerApp.viewportProbeAt(left + x, top + y).local, { ...endpoint, left: currentBox.x, top: currentBox.y });
    expect(local).toBeDefined();
    expect(Math.abs(local!.x_nm - draftPoint!.x_nm)).toBeLessThanOrEqual(3);
    expect(Math.abs(local!.y_nm - draftPoint!.y_nm)).toBeLessThanOrEqual(3);
    const snapshot = await page.evaluate(() => window.__crawlerApp.viewportSnapshot()!);
    const frame = snapshot.workingSketchFrame!;
    const world = frame.origin.map((value, index) => value
      + frame.xAxis[index] * draftPoint!.x_nm / 1_000_000
      + frame.yAxis[index] * draftPoint!.y_nm / 1_000_000) as [number, number, number];
    const independent = independentlyProject(world, snapshot, currentBox.width, currentBox.height);
    expect(endpoint.x).toBeCloseTo(independent.x, 3);
    expect(endpoint.y).toBeCloseTo(independent.y, 3);
  };

  await assertEndpointAlignment();
  await page.mouse.move(box.x + box.width * 0.53, box.y + box.height * 0.51);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(box.x + box.width * 0.59, box.y + box.height * 0.56, { steps: 5 });
  await page.mouse.up({ button: "middle" });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await assertEndpointAlignment();

  const cube = page.locator("#view-cube > div");
  const cubeBox = await cube.boundingBox();
  if (!cubeBox) throw new Error("view cube bounds unavailable");
  const revision = await page.evaluate(() => window.__crawlerApp.viewportSnapshot()!.revision);
  const beforeCube = await page.evaluate(() => window.__crawlerApp.viewportSnapshot()!);
  await page.mouse.move(cubeBox.x + cubeBox.width / 2, cubeBox.y + cubeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(cubeBox.x + cubeBox.width / 2 + 28, cubeBox.y + cubeBox.height / 2 - 20, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.viewportSnapshot()!.revision)).toBeGreaterThan(revision);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const afterCube = await page.evaluate(() => window.__crawlerApp.viewportSnapshot()!);
  expect(afterCube.cameraPose).not.toEqual(beforeCube.cameraPose);
  expect(afterCube.pivot).toEqual(beforeCube.pivot);
  expect(afterCube.projection).toEqual(beforeCube.projection);
  expect(afterCube.workingSketchFrame).toEqual(beforeCube.workingSketchFrame);
  expect(afterCube.navigationMode).toEqual(beforeCube.navigationMode);
  expect(distance(afterCube.cameraPose.position, afterCube.pivot.point)).toBeCloseTo(distance(beforeCube.cameraPose.position, beforeCube.pivot.point), 6);
  await assertEndpointAlignment();

  const beforeResize = await page.evaluate(() => window.__crawlerApp.viewportSnapshot()!);
  await page.setViewportSize({ width: 1260, height: 780 });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const afterResize = await page.evaluate(() => window.__crawlerApp.viewportSnapshot()!);
  expect(afterResize.cameraPose).toEqual(beforeResize.cameraPose);
  expect(afterResize.pivot).toEqual(beforeResize.pivot);
  expect(afterResize.projection).toEqual(beforeResize.projection);
  expect(afterResize.workingSketchFrame).toEqual(beforeResize.workingSketchFrame);
  expect(afterResize.navigationMode).toEqual(beforeResize.navigationMode);
  expect(afterResize.savedModelView).toEqual(beforeResize.savedModelView);
  const resizedBox = await canvas.boundingBox();
  const viewBox = (await page.locator("#sketch-overlay").getAttribute("viewBox"))!.split(" ").map(Number);
  expect(viewBox[2]).toBeCloseTo(resizedBox!.width, 1);
  expect(viewBox[3]).toBeCloseTo(resizedBox!.height, 1);
  await assertEndpointAlignment();
});

test("accepted render-packet replacement preserves an active sketch view and its saved model view", async ({ page }) => {
  await ready(page);
  const model = await page.evaluate(() => window.__crawlerApp.viewportSnapshot()!);
  await enterPlane(page, "xz");
  const canvas = page.getByLabel("3D viewport");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("viewport bounds unavailable");
  await page.mouse.move(box.x + box.width * 0.58, box.y + box.height * 0.47);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(box.x + box.width * 0.64, box.y + box.height * 0.41, { steps: 5 });
  await page.mouse.up({ button: "middle" });
  await page.mouse.wheel(0, -180);
  const before = await page.evaluate(() => window.__crawlerApp.viewportSnapshot()!);
  const draftBefore = await page.evaluate(() => window.__crawlerApp.sketchDraft());

  await page.evaluate(() => window.__crawlerApp.commitDocumentChanges([{
    kind: "set_parameter_value",
    parameter: "parameter:width",
    value: { kind: "length_nanometers", value: 52_250_000 },
  }]));
  await expect.poll(() => page.evaluate(() => window.__crawlerApp.geometryBounds()[3])).toBe(52.25);
  const after = await page.evaluate(() => window.__crawlerApp.viewportSnapshot()!);
  expect(after.cameraPose).toEqual(before.cameraPose);
  expect(after.projection).toEqual(before.projection);
  expect(after.pivot).toEqual(before.pivot);
  expect(after.navigationMode).toEqual(before.navigationMode);
  expect(after.workingSketchFrame).toEqual(before.workingSketchFrame);
  expect(after.savedModelView).toEqual(before.savedModelView);
  expect(await page.evaluate(() => window.__crawlerApp.sketchDraft())).toEqual(draftBefore);

  await page.getByRole("button", { name: "Discard sketch draft" }).click();
  const restored = await page.evaluate(() => window.__crawlerApp.viewportSnapshot()!);
  expect(restored.cameraPose).toEqual(model.cameraPose);
  expect(restored.projection).toEqual(model.projection);
  expect(restored.pivot).toEqual(model.pivot);
  expect(restored.navigationMode).toBe("model");
  expect(restored.workingSketchFrame).toBeNull();
});

test("projection toggling preserves pivot-relative apparent scale", async ({ page }) => {
  await ready(page);
  const perspective = await page.evaluate(() => window.__crawlerApp.viewportSnapshot()!);
  expect(perspective.projection.kind).toBe("perspective");
  const perspectiveHeight = perspective.projection.kind === "perspective"
    ? 2 * distance(perspective.cameraPose.position, perspective.pivot.point) * Math.tan(perspective.projection.verticalFieldOfViewDegrees * Math.PI / 360)
    : 0;
  await page.locator("#projection-mode").click();
  const orthographic = await page.evaluate(() => window.__crawlerApp.viewportSnapshot()!);
  expect(orthographic.projection.kind).toBe("orthographic");
  if (orthographic.projection.kind === "orthographic") expect(orthographic.projection.viewHeight).toBeCloseTo(perspectiveHeight, 8);
  await page.locator("#projection-mode").click();
  const roundTrip = await page.evaluate(() => window.__crawlerApp.viewportSnapshot()!);
  expect(roundTrip.projection.kind).toBe("perspective");
  const roundTripHeight = roundTrip.projection.kind === "perspective"
    ? 2 * distance(roundTrip.cameraPose.position, roundTrip.pivot.point) * Math.tan(roundTrip.projection.verticalFieldOfViewDegrees * Math.PI / 360)
    : 0;
  expect(roundTripHeight).toBeCloseTo(perspectiveHeight, 8);
  expect(roundTrip.pivot).toEqual(perspective.pivot);
});
