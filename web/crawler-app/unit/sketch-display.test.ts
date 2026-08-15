import assert from "node:assert/strict";
import test from "node:test";

import { committedSketchWorldPolylines } from "../src/sketch-display.ts";
import { originPlaneSupport, resolveSketchPlane, type OriginPlane } from "../src/sketch-plane.ts";
import type { Sketch } from "../src/sketch-editor.ts";

const sketch: Sketch = {
  id: "sketch:display",
  revision: 1,
  geometry: {
    line: { id: "line", geometry: { kind: "line", start: { x_nm: 1_000_000, y_nm: 2_000_000 }, end: { x_nm: 4_000_000, y_nm: 6_000_000 } } },
    circle: { id: "circle", geometry: { kind: "circle", center: { x_nm: 8_000_000, y_nm: 3_000_000 }, radius_nm: 2_000_000 } },
    arc: { id: "arc", construction: true, geometry: { kind: "arc", center: { x_nm: -3_000_000, y_nm: 0 }, start: { x_nm: -1_000_000, y_nm: 0 }, end: { x_nm: -3_000_000, y_nm: 2_000_000 }, clockwise: false } },
    spline: { id: "spline", geometry: { kind: "control_point_spline", degree: 3, control_points: [{ x_nm: 0, y_nm: 0 }, { x_nm: 1_000_000, y_nm: 2_000_000 }, { x_nm: 2_000_000, y_nm: -1_000_000 }, { x_nm: 3_000_000, y_nm: 0 }] } },
    fit: { id: "fit", geometry: { kind: "fit_point_spline", fit_points: [{ x_nm: 0, y_nm: 0 }, { x_nm: 1_000_000, y_nm: 2_000_000 }, { x_nm: 2_000_000, y_nm: -1_000_000 }, { x_nm: 3_000_000, y_nm: 0 }] } },
    ellipse: { id: "ellipse", geometry: { kind: "ellipse", center: { x_nm: 0, y_nm: 0 }, major: { x_nm: 3_000_000, y_nm: 0 }, minor: { x_nm: 0, y_nm: 1_000_000 } } },
    ellipticalArc: { id: "elliptical-arc", geometry: { kind: "elliptical_arc", center: { x_nm: 0, y_nm: 0 }, major: { x_nm: 3_000_000, y_nm: 0 }, minor: { x_nm: 0, y_nm: 1_000_000 }, start: { x_nm: 3_000_000, y_nm: 0 }, end: { x_nm: 0, y_nm: 1_000_000 }, clockwise: false } },
    conic: { id: "conic", geometry: { kind: "conic", start: { x_nm: 0, y_nm: 0 }, control: { x_nm: 1_000_000, y_nm: 2_000_000 }, end: { x_nm: 3_000_000, y_nm: 0 }, weight_millionths: 1_000_000 } },
    point: { id: "point", geometry: { kind: "sketch_point", x_nm: 500_000, y_nm: 500_000 } },
  },
  constraints: {},
};

test("committed line, circle, and arc geometry stays on every resolved 3D sketch plane", () => {
  for (const name of ["xy", "xz", "yz"] satisfies OriginPlane[]) {
    const resolved = resolveSketchPlane({ kind: "origin_plane", plane: name }, {});
    assert.equal(resolved.status, "ready");
    if (resolved.status !== "ready") continue;
    const polylines = committedSketchWorldPolylines(sketch, resolved.plane);
    assert.deepEqual(polylines.map((polyline) => polyline.entityId), ["line", "circle", "arc", "spline", "fit", "ellipse", "elliptical-arc", "conic", "point", "point"]);
    assert.deepEqual(polylines.map((polyline) => polyline.points.length), [2, 65, 49, 49, 49, 65, 49, 49, 2, 2]);
    assert.equal(polylines[2].construction, true);
    const origin = resolved.plane.origin_nanometers.map((value) => value / 1_000_000);
    for (const point of polylines.flatMap((polyline) => polyline.points)) {
      const offset = point.map((value, index) => value - origin[index]);
      const planeDistance = offset.reduce((sum, value, index) => sum + value * resolved.plane.normal_millionths[index] / 1_000_000, 0);
      assert.ok(Math.abs(planeDistance) < 1e-9, `${name} point drifted off its support plane`);
    }
  }
});

test("construction-plane origins and axes are honored rather than flattened to XY", () => {
  const resolved = resolveSketchPlane({ kind: "construction_plane_reference", plane: "plane:offset" }, {
    construction_planes: {
      "plane:offset": {
        origin_nanometers: [10_000_000, 20_000_000, 30_000_000],
        x_axis_millionths: [0, 1_000_000, 0],
        normal_millionths: [0, 0, 1_000_000],
      },
    },
  });
  assert.equal(resolved.status, "ready");
  if (resolved.status !== "ready") return;
  assert.deepEqual(committedSketchWorldPolylines(sketch, resolved.plane)[0].points, [[8, 21, 30], [4, 24, 30]]);
});
