import assert from "node:assert/strict";
import test from "node:test";

import type { Geometry } from "../src/sketch-editor.ts";
import { evaluateCurveFrame, geometryCurveBounds, intersectGeometryCurves, projectPointToGeometryCurve } from "../src/sketch-spline.ts";

test("native curve service evaluates frames, projections, bounds, and intersections", () => {
  const ellipse: Geometry = { kind: "ellipse", center: { x_nm: 0, y_nm: 0 }, major: { x_nm: 20, y_nm: 0 }, minor: { x_nm: 0, y_nm: 10 } };
  const frame = evaluateCurveFrame(ellipse, 0);
  assert.ok(Math.abs(frame.tangent.y) > 0.9);
  assert.ok(Number.isFinite(frame.curvature_per_nm));
  assert.deepEqual(geometryCurveBounds(ellipse), { min: { x_nm: -20, y_nm: -10 }, max: { x_nm: 20, y_nm: 10 } });
  const projection = projectPointToGeometryCurve(ellipse, { x_nm: 23, y_nm: 1 });
  assert.ok(projection.distance_nm < 4);

  const conic: Geometry = { kind: "conic", start: { x_nm: -10, y_nm: 0 }, control: { x_nm: 0, y_nm: 20 }, end: { x_nm: 10, y_nm: 0 }, weight_millionths: 1_000_000 };
  const line: Geometry = { kind: "line", start: { x_nm: -20, y_nm: 10 }, end: { x_nm: 20, y_nm: 10 } };
  const hits = intersectGeometryCurves(conic, line, 128);
  assert.ok(hits.length >= 1);
  assert.deepEqual(hits, [...hits].sort((a, b) => a.first_parameter - b.first_parameter));
  const tangentCircle: Geometry = { kind: "circle", center: { x_nm: 0, y_nm: 0 }, radius_nm: 10 };
  const tangentLine: Geometry = { kind: "line", start: { x_nm: -20, y_nm: 10 }, end: { x_nm: 20, y_nm: 10 } };
  assert.ok(intersectGeometryCurves(tangentCircle, tangentLine).some((hit) => Math.hypot(hit.point.x_nm, hit.point.y_nm - 10) <= 3));
});

test("adaptive curve services retain collinear loops and narrow knot spans", () => {
  const loop: Geometry = { kind: "control_point_spline", degree: 3, control_points: [
    { x_nm: 0, y_nm: 0 }, { x_nm: 200, y_nm: 0 }, { x_nm: -200, y_nm: 0 }, { x_nm: 10, y_nm: 0 },
  ], knots_millionths: [0, 0, 0, 0, 1_000_000, 1_000_000, 1_000_000, 1_000_000] };
  const bounds = geometryCurveBounds(loop);
  assert.ok(bounds.min.x_nm < -20 && bounds.max.x_nm > 20, "a collinear reversal must not collapse to its endpoint chord");
  const projection = projectPointToGeometryCurve(loop, { x_nm: 60, y_nm: 2 });
  assert.ok(projection.distance_nm <= 4 && projection.error_bound_nm <= 6);
  const multimodal: Geometry = { kind: "control_point_spline", degree: 4, control_points: [0, 976_185, 657_855, 190_446, 1_000_000].map((x_nm) => ({ x_nm, y_nm: 0 })), knots_millionths: [0, 0, 0, 0, 0, 1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000] };
  const multimodalProjection = projectPointToGeometryCurve(multimodal, { x_nm: 135_400, y_nm: 0 });
  assert.ok(multimodalProjection.distance_nm <= 2 && multimodalProjection.error_bound_nm <= 6, JSON.stringify(multimodalProjection));

  const narrow: Geometry = { kind: "control_point_spline", degree: 3, control_points: [
    { x_nm: -100, y_nm: -20 }, { x_nm: -20, y_nm: -20 }, { x_nm: -2, y_nm: 80 }, { x_nm: 0, y_nm: -80 }, { x_nm: 2, y_nm: 80 }, { x_nm: 20, y_nm: -20 }, { x_nm: 100, y_nm: -20 },
  ], knots_millionths: [0, 0, 0, 0, 490_000, 500_000, 510_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000] };
  const axis: Geometry = { kind: "line", start: { x_nm: -10, y_nm: 0 }, end: { x_nm: 10, y_nm: 0 } };
  assert.ok(intersectGeometryCurves(narrow, axis).length >= 1);
});

test("interactive primitive and elliptic projection stays inside a frame budget", () => {
  const line: Geometry = { kind: "line", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 10_000_000, y_nm: 10_000_000 } };
  const circle: Geometry = { kind: "circle", center: { x_nm: 0, y_nm: 0 }, radius_nm: 10_000_000 };
  const arc: Geometry = { kind: "arc", center: { x_nm: 0, y_nm: 0 }, start: { x_nm: 10_000_000, y_nm: 0 }, end: { x_nm: 0, y_nm: 10_000_000 }, clockwise: false };
  const ellipse: Geometry = { kind: "ellipse", center: { x_nm: 0, y_nm: 0 }, major: { x_nm: 10_000_000, y_nm: 0 }, minor: { x_nm: 0, y_nm: 5_000_000 } };
  const ellipticalArc: Geometry = { ...ellipse, kind: "elliptical_arc", start: { x_nm: 10_000_000, y_nm: 0 }, end: { x_nm: 0, y_nm: 5_000_000 }, clockwise: false };
  const target = { x_nm: 5_000_000, y_nm: 5_000_000 };
  const ellipticTarget = { x_nm: Math.round(10_000_000 / Math.sqrt(2)), y_nm: Math.round(5_000_000 / Math.sqrt(2)) };

  const started = performance.now();
  for (let index = 0; index < 50; index += 1) {
    assert.equal(projectPointToGeometryCurve(line, target).parameter, 0.5);
    assert.ok(Math.abs(projectPointToGeometryCurve(circle, target).parameter - 0.125) < 1e-9);
    assert.ok(Math.abs(projectPointToGeometryCurve(arc, target).parameter - 0.5) < 1e-9);
    assert.ok(Math.abs(projectPointToGeometryCurve(ellipse, ellipticTarget).parameter - 0.125) < 1e-7);
    assert.ok(Math.abs(projectPointToGeometryCurve(ellipticalArc, ellipticTarget).parameter - 0.5) < 1e-7);
  }
  assert.equal(projectPointToGeometryCurve(ellipticalArc, { x_nm: -10_000_000, y_nm: 0 }).parameter, 1, "elliptical arc projection must clamp outside its sweep");
  assert.ok(performance.now() - started < 120, "interactive curve projection must stay inside a frame budget");
});
