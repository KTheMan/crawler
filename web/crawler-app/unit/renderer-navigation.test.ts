import assert from "node:assert/strict";
import test from "node:test";

import { viewportGridMetrics, viewportModelRadius, viewportPointerAction, wheelZoomScale } from "../src/renderer-navigation.ts";

test("empty parts start with a practical millimeter-scale sketch workspace", () => {
  assert.equal(viewportModelRadius(0), 25);
  assert.equal(viewportModelRadius(Number.NaN), 25);
  assert.equal(viewportModelRadius(100), 50);
});

test("viewport mouse bindings reserve left click for selection and placement", () => {
  assert.equal(viewportPointerAction(0), "select");
  assert.equal(viewportPointerAction(1), "orbit");
  assert.equal(viewportPointerAction(1, true), "pan");
  assert.equal(viewportPointerAction(1, false, true), "pan");
  assert.equal(viewportPointerAction(2), undefined);
});

test("origin planes span eight centered grid cells", () => {
  const metrics = viewportGridMetrics(25);

  assert.equal(metrics.divisions, 20);
  assert.equal(metrics.size, 250);
  assert.equal(metrics.cellSize, 12.5);
  assert.equal(metrics.originPlaneSize, 100);
  assert.equal(metrics.originPlaneSize / metrics.cellSize, 8);
});

test("wheel zoom stays gradual for mouse, trackpad, and page deltas", () => {
  const trackpad = wheelZoomScale(12, 0, 800);
  const mouse = wheelZoomScale(120, 0, 800);
  const lines = wheelZoomScale(3, 1, 800);
  const page = wheelZoomScale(1, 2, 800);

  assert.ok(trackpad > 1 && trackpad < mouse);
  assert.ok(lines > trackpad && lines < mouse);
  assert.ok(mouse < 1.09);
  assert.ok(page < 1.11);
});

test("opposite wheel gestures are reversible and extreme deltas remain finite", () => {
  for (const delta of [1, 120, 10_000, Number.MAX_VALUE]) {
    const outward = wheelZoomScale(delta, 0, 800);
    const inward = wheelZoomScale(-delta, 0, 800);
    assert.ok(Number.isFinite(outward));
    assert.ok(Number.isFinite(inward));
    assert.ok(outward <= Math.exp(0.1));
    assert.ok(inward >= Math.exp(-0.1));
    assert.ok(Math.abs(outward * inward - 1) < 1e-12);
  }
});

test("invalid wheel input does not move the camera", () => {
  assert.equal(wheelZoomScale(Number.NaN, 0, 800), 1);
  assert.equal(wheelZoomScale(Number.POSITIVE_INFINITY, 0, 800), 1);
});
