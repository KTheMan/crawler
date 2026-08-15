import assert from "node:assert/strict";
import test from "node:test";
import { SKETCH_CONSTRAINT_MANIFEST, SKETCH_TOOL_MANIFEST, constraintDisabledReason, parseSketchDimensionExpression, smartDimensionDisabledReason, smartDimensionKind, smartDimensionLinePlacementMode, summarizeSketchSelection, toolDisabledReason } from "../src/sketch-tool-manifest.ts";
import type { Sketch } from "../src/sketch-editor.ts";

const sketch: Sketch = {
  id: "sketch:test",
  revision: 0,
  geometry: {
    line: { id: "line", geometry: { kind: "line", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 10, y_nm: 0 } } },
    line2: { id: "line2", construction: true, geometry: { kind: "line", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 0, y_nm: 10 } } },
    circle: { id: "circle", geometry: { kind: "circle", center: { x_nm: 5, y_nm: 5 }, radius_nm: 3 } },
  },
  constraints: {},
};

test("the manifest defines lifecycle behavior for every shipped tool and constraint", () => {
  assert.equal(Object.keys(SKETCH_TOOL_MANIFEST).length, 27);
  assert.equal(Object.keys(SKETCH_CONSTRAINT_MANIFEST).length, 24);
  assert.equal(SKETCH_TOOL_MANIFEST.offset.completion, "confirm");
  assert.equal(SKETCH_CONSTRAINT_MANIFEST.distance.completion, "placement");
  assert.equal(SKETCH_TOOL_MANIFEST.line.repeatable, true);
  for (const tool of ["sketch_break", "sketch_scale", "sketch_move_copy", "sketch_blend"]) {
    assert.equal(SKETCH_TOOL_MANIFEST[tool as keyof typeof SKETCH_TOOL_MANIFEST].completion, "confirm");
  }
});

test("selection contracts dispatch Smart Dimension and explain incompatible tools", () => {
  const line = summarizeSketchSelection(sketch, ["line"], 0, false);
  const circle = summarizeSketchSelection(sketch, ["circle"], 0, false);
  const lines = summarizeSketchSelection(sketch, ["line", "line2"], 0, false);
  assert.equal(smartDimensionKind(line), "distance_x");
  assert.equal(smartDimensionKind(circle), "diameter");
  assert.equal(smartDimensionKind(lines), "angle");
  assert.match(constraintDisabledReason("radius", line) ?? "", /circle or arc/);
  assert.match(toolDisabledReason("sketch_fillet", line) ?? "", /2 lines/);
  assert.match(constraintDisabledReason("tangent", lines) ?? "", /line and curve|non-line/);

  const advanced = structuredClone(sketch);
  advanced.geometry.ellipse = { id: "ellipse", geometry: { kind: "ellipse", center: { x_nm: 0, y_nm: 0 }, major: { x_nm: 10, y_nm: 0 }, minor: { x_nm: 0, y_nm: 5 } } };
  advanced.constraints.offset = { kind: "offset_distance", source: "line", offset: "line2", distance_nm: 10, source_start_millionths: 0, source_end_millionths: 1_000_000 };
  assert.equal(smartDimensionKind(summarizeSketchSelection(advanced, ["ellipse"], [{ geometry: "ellipse", anchor: "minor" }], false)), "ellipse_radius");
  assert.equal(smartDimensionKind(summarizeSketchSelection(advanced, ["line", "line2"], [], false)), "offset_distance");
  assert.equal(smartDimensionKind(summarizeSketchSelection(advanced, ["line", "line2"], [{ geometry: "line", anchor: "parameter:250000" }, { geometry: "line2", anchor: "parameter:750000" }], false)), "offset_distance");
});

test("Smart Dimension dispatches axis-aligned and aligned point pairs", () => {
  assert.equal(smartDimensionKind(summarizeSketchSelection(sketch, ["line"], [
    { geometry: "line", anchor: "start" }, { geometry: "line", anchor: "end" },
  ], false)), "distance_x");
  assert.equal(smartDimensionKind(summarizeSketchSelection(sketch, ["line2"], [
    { geometry: "line2", anchor: "start" }, { geometry: "line2", anchor: "end" },
  ], false)), "distance_y");
  assert.equal(smartDimensionKind(summarizeSketchSelection(sketch, ["line", "circle"], [
    { geometry: "line", anchor: "start" }, { geometry: "circle", anchor: "center" },
  ], false)), "distance");
});

test("Smart Dimension snaps a diagonal line to horizontal, vertical, and aligned placement sectors", () => {
  const diagonal = { kind: "line" as const, start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 10_000_000, y_nm: 10_000_000 } };
  assert.equal(smartDimensionLinePlacementMode(diagonal, { x_nm: 5_000_000, y_nm: 30_000_000 }), "distance_x");
  assert.equal(smartDimensionLinePlacementMode(diagonal, { x_nm: 30_000_000, y_nm: 5_000_000 }), "distance_y");
  assert.equal(smartDimensionLinePlacementMode(diagonal, { x_nm: -10_000_000, y_nm: 20_000_000 }), "distance");
  assert.equal(smartDimensionLinePlacementMode(sketch.geometry.line.geometry as Extract<typeof diagonal, { kind: "line" }>, { x_nm: 5, y_nm: 20 }), "distance_x");
});

test("partial point operands keep Smart Dimension, coincident, and midpoint available", () => {
  const onePoint = summarizeSketchSelection(sketch, ["line"], [{ geometry: "line", anchor: "start" }], false);
  assert.equal(smartDimensionKind(onePoint), undefined);
  assert.equal(smartDimensionDisabledReason(onePoint), undefined);
  assert.equal(constraintDisabledReason("coincident", onePoint), undefined);
  assert.equal(constraintDisabledReason("midpoint", onePoint), undefined);

  const pointAndTarget = summarizeSketchSelection(sketch, ["line", "line2"], [{ geometry: "line", anchor: "start" }], false);
  assert.equal(SKETCH_CONSTRAINT_MANIFEST.midpoint.selection?.(pointAndTarget), undefined);
  assert.equal(constraintDisabledReason("midpoint", pointAndTarget), undefined);
  assert.match(constraintDisabledReason("radius", onePoint) ?? "", /circle or arc/);

  const originAndLine = summarizeSketchSelection(sketch, ["line"], [], true);
  assert.equal(SKETCH_CONSTRAINT_MANIFEST.midpoint.selection?.(originAndLine), undefined);
  assert.equal(constraintDisabledReason("midpoint", originAndLine), undefined);
  assert.equal(SKETCH_CONSTRAINT_MANIFEST.point_on_object.selection?.(originAndLine), undefined);
  assert.equal(constraintDisabledReason("point_on_object", originAndLine), undefined);
  assert.match(constraintDisabledReason("fixed", originAndLine) ?? "", /movable sketch point/);
  const originAndPoint = summarizeSketchSelection(sketch, ["line"], [{ geometry: "line", anchor: "start" }], true);
  assert.equal(smartDimensionKind(originAndPoint), "distance_x");
});

test("native spline control points and curve operations remain invokable", () => {
  const value = structuredClone(sketch);
  value.geometry.spline = { id: "spline", geometry: { kind: "control_point_spline", degree: 3, control_points: [
    { x_nm: 0, y_nm: 0 }, { x_nm: 4, y_nm: 8 }, { x_nm: 8, y_nm: -4 }, { x_nm: 12, y_nm: 0 },
  ] } };
  const spline = summarizeSketchSelection(value, ["spline"], [], false);
  assert.equal(toolDisabledReason("trim", spline), undefined);
  assert.equal(toolDisabledReason("offset", spline), undefined);
  const control = summarizeSketchSelection(value, ["spline"], [{ geometry: "spline", anchor: "control:1" }], false);
  assert.equal(constraintDisabledReason("fixed", control), undefined);
  assert.equal(smartDimensionDisabledReason(control), undefined);
});

test("dimension expressions support arithmetic and common CAD units", () => {
  assert.equal(parseSketchDimensionExpression("1 in + 5 mm", "length"), 30.4);
  assert.equal(parseSketchDimensionExpression("(2.5 cm - 5 mm) / 2", "length"), 10);
  assert.equal(parseSketchDimensionExpression("3.141592653589793 rad", "angle"), 180);
  assert.equal(parseSketchDimensionExpression("1 mm + 2 deg", "length"), undefined);
  assert.equal(parseSketchDimensionExpression("1 / 0", "length"), undefined);
});
