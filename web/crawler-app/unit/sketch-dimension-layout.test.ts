import assert from "node:assert/strict";
import test from "node:test";

import {
  layoutSketchDimension,
  resolveLinearDimensionOrientation,
  type DimensionPrimitive,
} from "../src/sketch-dimension-layout.ts";

function primitivesOf<T extends DimensionPrimitive["type"]>(layout: ReturnType<typeof layoutSketchDimension>, type: T) {
  return layout.primitives.filter((primitive): primitive is Extract<DimensionPrimitive, { type: T }> => primitive.type === type);
}

test("aligned linear dimensions produce witnesses, a measure, arrows, markers, and a label", () => {
  const layout = layoutSketchDimension({
    kind: "linear",
    first: { x: 10, y: 20 },
    second: { x: 40, y: 60 },
    placement: { x: 4, y: 70 },
    orientation: "aligned",
  });
  assert.equal(layout.status, "valid");
  assert.equal(layout.orientation, "aligned");
  assert.equal(layout.value, 50);
  assert.equal(primitivesOf(layout, "line").filter((item) => item.role === "witness").length, 2);
  assert.equal(primitivesOf(layout, "line").filter((item) => item.role === "measure").length, 1);
  assert.equal(primitivesOf(layout, "triangle").length, 2);
  assert.equal(primitivesOf(layout, "marker").length, 2);
  assert.deepEqual(primitivesOf(layout, "label")[0].anchor, layout.labelAnchor);
});

test("horizontal and vertical dimensions project points onto placement-controlled measure lines", () => {
  const horizontal = layoutSketchDimension({
    kind: "linear",
    first: { x: 10, y: 10 },
    second: { x: 50, y: 40 },
    placement: { x: 30, y: -20 },
    orientation: "horizontal",
  });
  assert.equal(horizontal.value, 40);
  assert.deepEqual(primitivesOf(horizontal, "line").find((item) => item.role === "measure"), {
    type: "line", role: "measure", start: { x: 10, y: -20 }, end: { x: 50, y: -20 },
  });

  const vertical = layoutSketchDimension({
    kind: "linear",
    first: { x: 10, y: 10 },
    second: { x: 50, y: 40 },
    placement: { x: 80, y: 25 },
    orientation: "vertical",
  });
  assert.equal(vertical.value, 30);
  assert.deepEqual(primitivesOf(vertical, "line").find((item) => item.role === "measure"), {
    type: "line", role: "measure", start: { x: 80, y: 10 }, end: { x: 80, y: 40 },
  });
});

test("horizontal crossing placement gives each witness its own direction through the measure line", () => {
  const layout = layoutSketchDimension({
    kind: "linear",
    first: { x: 10, y: 0 },
    second: { x: 50, y: 100 },
    placement: { x: 30, y: 40 },
    orientation: "horizontal",
  });
  const witnesses = primitivesOf(layout, "line").filter((item) => item.role === "witness");
  assert.deepEqual(witnesses, [
    { type: "line", role: "witness", start: { x: 10, y: 3 }, end: { x: 10, y: 45 } },
    { type: "line", role: "witness", start: { x: 50, y: 97 }, end: { x: 50, y: 35 } },
  ]);
});

test("vertical crossing placement gives each witness its own direction through the measure line", () => {
  const layout = layoutSketchDimension({
    kind: "linear",
    first: { x: 0, y: 10 },
    second: { x: 100, y: 50 },
    placement: { x: 40, y: 30 },
    orientation: "vertical",
  });
  const witnesses = primitivesOf(layout, "line").filter((item) => item.role === "witness");
  assert.deepEqual(witnesses, [
    { type: "line", role: "witness", start: { x: 3, y: 10 }, end: { x: 45, y: 10 } },
    { type: "line", role: "witness", start: { x: 97, y: 50 }, end: { x: 35, y: 50 } },
  ]);
});

test("a witness aligned exactly with the measure line starts at its endpoint and still overhangs", () => {
  const horizontal = layoutSketchDimension({
    kind: "linear",
    first: { x: 10, y: 0 },
    second: { x: 50, y: 100 },
    placement: { x: 30, y: 0 },
    orientation: "horizontal",
  });
  assert.deepEqual(primitivesOf(horizontal, "line").filter((item) => item.role === "witness")[0], {
    type: "line", role: "witness", start: { x: 10, y: 0 }, end: { x: 10, y: -5 },
  });

  const vertical = layoutSketchDimension({
    kind: "linear",
    first: { x: 0, y: 10 },
    second: { x: 100, y: 50 },
    placement: { x: 0, y: 30 },
    orientation: "vertical",
  });
  assert.deepEqual(primitivesOf(vertical, "line").filter((item) => item.role === "witness")[0], {
    type: "line", role: "witness", start: { x: 0, y: 10 }, end: { x: -5, y: 10 },
  });
});

test("automatic point-to-point orientation follows placement cursor sectors", () => {
  const first = { x: 0, y: 0 };
  const second = { x: 20, y: 20 };
  assert.equal(resolveLinearDimensionOrientation(first, second, { x: 10, y: -40 }), "horizontal");
  assert.equal(resolveLinearDimensionOrientation(first, second, { x: 60, y: 10 }), "vertical");
  assert.equal(resolveLinearDimensionOrientation(first, second, { x: 35, y: 35 }), "aligned");
});

test("angular layout selects the cursor-containing sector and emits rays, arc, arrows, and vertex", () => {
  const minor = layoutSketchDimension({
    kind: "angular",
    vertex: { x: 0, y: 0 },
    firstRayPoint: { x: 100, y: 0 },
    secondRayPoint: { x: 0, y: 100 },
    placement: { x: 30, y: 30 },
  });
  assert.equal(minor.status, "valid");
  assert.ok(Math.abs(minor.value - Math.PI / 2) < 1e-10);
  assert.equal(primitivesOf(minor, "arc")[0].sweepRadians, Math.PI / 2);
  assert.equal(primitivesOf(minor, "line").filter((item) => item.role === "ray").length, 2);
  assert.equal(primitivesOf(minor, "triangle").length, 2);
  assert.equal(primitivesOf(minor, "marker")[0].role, "vertex");

  const reflex = layoutSketchDimension({
    kind: "angular",
    vertex: { x: 0, y: 0 },
    firstRayPoint: { x: 100, y: 0 },
    secondRayPoint: { x: 0, y: 100 },
    placement: { x: -30, y: -30 },
  });
  assert.ok(Math.abs(reflex.value - Math.PI * 1.5) < 1e-10);
  assert.equal(primitivesOf(reflex, "arc")[0].sweepRadians, -Math.PI * 1.5);
});

test("radius and diameter layouts use cursor-directed leaders and correct values", () => {
  const radius = layoutSketchDimension({ kind: "radius", center: { x: 20, y: 20 }, radius: 10, placement: { x: 50, y: 20 } });
  assert.equal(radius.status, "valid");
  assert.equal(radius.value, 10);
  assert.equal(primitivesOf(radius, "line").filter((item) => item.role === "leader").length, 1);
  assert.equal(primitivesOf(radius, "triangle").length, 1);
  assert.equal(primitivesOf(radius, "marker")[0].role, "center");

  const diameter = layoutSketchDimension({ kind: "diameter", center: { x: 20, y: 20 }, radius: 10, placement: { x: 20, y: 60 } });
  assert.equal(diameter.value, 20);
  assert.equal(primitivesOf(diameter, "line").filter((item) => item.role === "measure").length, 1);
  assert.equal(primitivesOf(diameter, "line").filter((item) => item.role === "leader").length, 1);
  assert.equal(primitivesOf(diameter, "triangle").length, 2);
});

test("point-line dimensions measure perpendicular distance and identify the projection", () => {
  const layout = layoutSketchDimension({
    kind: "point-line",
    point: { x: 20, y: 10 },
    lineStart: { x: 0, y: 40 },
    lineEnd: { x: 100, y: 40 },
    placement: { x: 60, y: 25 },
  });
  assert.equal(layout.status, "valid");
  assert.equal(layout.value, 30);
  assert.ok(primitivesOf(layout, "marker").some((item) => item.role === "projection" && item.center.x === 20 && item.center.y === 40));
});

test("parallel-line dimensions measure normal spacing independent of segment direction", () => {
  const layout = layoutSketchDimension({
    kind: "parallel-lines",
    firstLineStart: { x: 0, y: 0 },
    firstLineEnd: { x: 100, y: 100 },
    secondLineStart: { x: 0, y: 20 },
    secondLineEnd: { x: 100, y: 120 },
    placement: { x: 70, y: 40 },
  });
  assert.equal(layout.status, "valid");
  assert.ok(Math.abs(layout.value - Math.sqrt(200)) < 1e-10);
  assert.equal(primitivesOf(layout, "line").filter((item) => item.role === "witness").length, 2);
});

test("degenerate and non-finite inputs fail safely without producing invalid primitives", () => {
  const coincident = layoutSketchDimension({
    kind: "linear",
    first: { x: 5, y: 5 },
    second: { x: 5, y: 5 },
    placement: { x: 10, y: 10 },
  });
  assert.equal(coincident.status, "degenerate");
  assert.equal(coincident.primitives.length, 0);
  assert.ok(coincident.issues[0].includes("Coincident"));

  const nonParallel = layoutSketchDimension({
    kind: "parallel-lines",
    firstLineStart: { x: 0, y: 0 },
    firstLineEnd: { x: 10, y: 0 },
    secondLineStart: { x: 0, y: 10 },
    secondLineEnd: { x: 10, y: 20 },
    placement: { x: 20, y: 20 },
  });
  assert.equal(nonParallel.status, "degenerate");
  assert.equal(nonParallel.primitives.length, 0);

  const invalid = layoutSketchDimension({
    kind: "radius",
    center: { x: Number.NaN, y: 0 },
    radius: 10,
    placement: { x: Number.POSITIVE_INFINITY, y: 4 },
  });
  assert.equal(invalid.status, "degenerate");
  assert.deepEqual(invalid.labelAnchor, { x: 0, y: 0 });
  assert.equal(invalid.primitives.length, 0);
});
