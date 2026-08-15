import assert from "node:assert/strict";
import test from "node:test";
import type { Sketch } from "../src/sketch-editor.ts";
import { SketchSnapSpatialIndex } from "../src/sketch-snap-spatial-index.ts";
import { closedProfilePolylines, closestPointOnGeometry, constraintAnnotations, inferSketchPoint, pointForRef, sketchGeometrySelectionPath } from "../src/sketch-workspace.ts";

function sketch(): Sketch {
  return {
    id: "sketch:first-class",
    revision: 0,
    geometry: {
      "line:a": { id: "line:a", geometry: { kind: "line", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 10_000_000, y_nm: 0 } } },
      "line:b": { id: "line:b", geometry: { kind: "line", start: { x_nm: 10_000_000, y_nm: 0 }, end: { x_nm: 10_000_000, y_nm: 8_000_000 } } },
      "line:c": { id: "line:c", geometry: { kind: "line", start: { x_nm: 10_000_000, y_nm: 8_000_000 }, end: { x_nm: 0, y_nm: 8_000_000 } } },
      "line:d": { id: "line:d", geometry: { kind: "line", start: { x_nm: 0, y_nm: 8_000_000 }, end: { x_nm: 0, y_nm: 0 } } },
    },
    constraints: {},
  };
}

test("the sketch origin resolves as an implied point without geometry", () => {
  assert.deepEqual(pointForRef(sketch(), { geometry: "reference:origin", anchor: "center" }), { x_nm: 0, y_nm: 0 });
});

test("snap inference prioritizes durable anchors and adds axis intent", () => {
  const result = inferSketchPoint(sketch(), { x_nm: 10_050_000, y_nm: 30_000 }, [{ point: { x_nm: 1_000_000, y_nm: 0 }, reference: { geometry: "line:a", anchor: "start" } }], 100_000);
  assert.deepEqual(result.point, { x_nm: 10_000_000, y_nm: 0 });
  assert.ok(result.inferences.some((inference) => inference.kind === "coincident"));
  assert.ok(result.inferences.some((inference) => inference.kind === "horizontal"));
  const horizontal = result.inferences.find((inference) => inference.kind === "horizontal");
  assert.deepEqual(horizontal && "target" in horizontal ? horizontal.target : undefined, { geometry: "line:a", anchor: "start" });
  assert.ok(horizontal && "source" in horizontal);
});

test("snap inference exposes midpoint and point-on-object references", () => {
  const midpoint = inferSketchPoint(sketch(), { x_nm: 5_010_000, y_nm: 20_000 }, [], 100_000);
  assert.equal(midpoint.inferences[0]?.kind, "midpoint");
  const onObject = inferSketchPoint(sketch(), { x_nm: 4_000_000, y_nm: 50_000 }, [], 100_000);
  assert.equal(onObject.inferences[0]?.kind, "point_on_object");
});

test("automatic inference distinguishes center, parallel, perpendicular, collinear, equal, and tangent intent", () => {
  const center = inferSketchPoint({ ...sketch(), geometry: { circle: { id: "circle", geometry: { kind: "circle", center: { x_nm: 2_000_000, y_nm: 3_000_000 }, radius_nm: 1_000_000 } } } }, { x_nm: 2_010_000, y_nm: 3_010_000 }, [], 50_000);
  assert.equal(center.inferences[0]?.kind, "center");

  const base: Sketch = { ...sketch(), geometry: { line: { id: "line", geometry: { kind: "line", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 10_000_000, y_nm: 0 } } } } };
  const parallel = inferSketchPoint(base, { x_nm: 5_000_000, y_nm: 10_030_000 }, [{ x_nm: 0, y_nm: 10_000_000 }], 100_000);
  assert.ok(parallel.inferences.some((inference) => inference.kind === "parallel"));
  const perpendicular = inferSketchPoint(base, { x_nm: 20_020_000, y_nm: 5_000_000 }, [{ x_nm: 20_000_000, y_nm: 0 }], 100_000);
  assert.ok(perpendicular.inferences.some((inference) => inference.kind === "perpendicular"));
  // Stay outside the midpoint aperture so the stronger topological midpoint
  // inference does not intentionally win over the curve relation.
  const collinear = inferSketchPoint(base, { x_nm: 4_000_000, y_nm: 20_000 }, [{ x_nm: 2_000_000, y_nm: 0 }], 100_000);
  assert.ok(collinear.inferences.some((inference) => inference.kind === "collinear") || collinear.inferences.some((inference) => inference.kind === "point_on_object"));
  const equal = inferSketchPoint(base, { x_nm: 7_071_068, y_nm: 7_071_068 }, [{ x_nm: 0, y_nm: 0 }], 100_000);
  assert.ok(equal.inferences.some((inference) => inference.kind === "equal"));
  const circleSketch: Sketch = { ...base, geometry: { circle: { id: "circle", geometry: { kind: "circle", center: { x_nm: 0, y_nm: 0 }, radius_nm: 5_000_000 } } } };
  const tangent = inferSketchPoint(circleSketch, { x_nm: 5_000_000, y_nm: 4_000_000 }, [{ x_nm: 5_000_000, y_nm: 0 }], 100_000);
  assert.ok(tangent.inferences.some((inference) => inference.kind === "tangent"));
  for (const result of [center, parallel, perpendicular, collinear, equal, tangent]) {
    assert.ok(result.inferences.every((inference) => inference.source.geometry.length > 0 && inference.target.geometry.length > 0));
  }
});

test("arc snapping clamps outside its real sweep and selection follows curved strokes", () => {
  const value = sketch();
  value.geometry = {
    arc: { id: "arc", geometry: { kind: "arc", center: { x_nm: 0, y_nm: 0 }, start: { x_nm: 10_000, y_nm: 0 }, end: { x_nm: 0, y_nm: 10_000 }, clockwise: false } },
  };
  const outside = closestPointOnGeometry({ x_nm: -7_000, y_nm: -7_000 }, value.geometry.arc.geometry);
  assert.deepEqual(outside, { x_nm: 10_000, y_nm: 0 });
  const path = sketchGeometrySelectionPath(value.geometry.arc.geometry);
  assert.equal(path.length, 49);
  assert.deepEqual(path[0], { x_nm: 10_000, y_nm: 0 });
  assert.deepEqual(path.at(-1), { x_nm: 0, y_nm: 10_000 });
});

test("native spline selection and control-point references use the evaluated curve", () => {
  const value = sketch();
  value.geometry = {
    spline: { id: "spline", geometry: { kind: "control_point_spline", degree: 3, control_points: [
      { x_nm: 0, y_nm: 0 }, { x_nm: 10_000, y_nm: 20_000 }, { x_nm: 20_000, y_nm: -10_000 }, { x_nm: 30_000, y_nm: 0 },
    ] } },
  };
  assert.deepEqual(pointForRef(value, { geometry: "spline", anchor: "control:2" }), { x_nm: 20_000, y_nm: -10_000 });
  const path = sketchGeometrySelectionPath(value.geometry.spline.geometry);
  assert.equal(path.length, 49);
  assert.deepEqual(path[0], { x_nm: 0, y_nm: 0 });
  assert.deepEqual(path.at(-1), { x_nm: 30_000, y_nm: 0 });
  assert.ok(closestPointOnGeometry({ x_nm: 15_000, y_nm: 4_000 }, value.geometry.spline.geometry));
  const snapped = inferSketchPoint(value, { x_nm: 20_010, y_nm: -9_990 }, [], 100);
  assert.equal(snapped.inferences[0]?.kind, "coincident");
});

test("remaining native geometry exposes stable handles and deterministic selection paths", () => {
  const value = sketch();
  value.geometry = {
    fit: { id: "fit", geometry: { kind: "fit_point_spline", fit_points: [{ x_nm: 0, y_nm: 0 }, { x_nm: 10, y_nm: 20 }, { x_nm: 20, y_nm: -10 }, { x_nm: 30, y_nm: 0 }] } },
    ellipse: { id: "ellipse", geometry: { kind: "ellipse", center: { x_nm: 0, y_nm: 0 }, major: { x_nm: 20, y_nm: 0 }, minor: { x_nm: 0, y_nm: 10 } } },
    "elliptical-arc": { id: "elliptical-arc", geometry: { kind: "elliptical_arc", center: { x_nm: 0, y_nm: 0 }, major: { x_nm: 20, y_nm: 0 }, minor: { x_nm: 0, y_nm: 10 }, start: { x_nm: 20, y_nm: 0 }, end: { x_nm: 0, y_nm: 10 }, clockwise: false } },
    conic: { id: "conic", geometry: { kind: "conic", start: { x_nm: 0, y_nm: 0 }, control: { x_nm: 15, y_nm: 20 }, end: { x_nm: 30, y_nm: 0 }, weight_millionths: 1_000_000 } },
    point: { id: "point", geometry: { kind: "sketch_point", x_nm: 7, y_nm: 9 } },
  };
  assert.deepEqual(pointForRef(value, { geometry: "fit", anchor: "fit:2" }), { x_nm: 20, y_nm: -10 });
  assert.ok(pointForRef(value, { geometry: "fit", anchor: "knot:2" }));
  assert.ok(pointForRef(value, { geometry: "conic", anchor: "parameter:500000" }));
  assert.deepEqual(pointForRef(value, { geometry: "ellipse", anchor: "major" }), { x_nm: 20, y_nm: 0 });
  assert.deepEqual(pointForRef(value, { geometry: "elliptical-arc", anchor: "end" }), { x_nm: 0, y_nm: 10 });
  assert.deepEqual(pointForRef(value, { geometry: "conic", anchor: "control" }), { x_nm: 15, y_nm: 20 });
  assert.deepEqual(pointForRef(value, { geometry: "point", anchor: "position" }), { x_nm: 7, y_nm: 9 });
  assert.deepEqual(["fit", "ellipse", "elliptical-arc", "conic", "point"].map((id) => sketchGeometrySelectionPath(value.geometry[id].geometry).length), [49, 65, 49, 49, 1]);
});

test("closed profile shading chains unordered solver component geometry", () => {
  const profiles = closedProfilePolylines(sketch(), [["line:c", "line:a", "line:d", "line:b"]]);
  assert.equal(profiles.length, 1);
  assert.deepEqual(profiles[0][0], profiles[0].at(-1));
  assert.equal(profiles[0].length, 5);
});

test("constraint annotations expose canvas dimensions and geometric glyphs", () => {
  const value = sketch();
  value.constraints = {
    "constraint:h": { kind: "horizontal", line: "line:a" },
    "constraint:d": { kind: "distance", a: { geometry: "line:a", anchor: "start" }, b: { geometry: "line:a", anchor: "end" }, distance_nm: 10_000_000 },
  };
  const annotations = constraintAnnotations(value);
  assert.equal(annotations.find((annotation) => annotation.id === "constraint:h")?.label, "H");
  assert.equal(annotations.find((annotation) => annotation.id === "constraint:d")?.label, "10 mm");
  assert.deepEqual(
    constraintAnnotations(value, new Set(["constraint:d"])).map((annotation) => annotation.id),
    ["constraint:d"],
  );
  value.suppressed_constraints = ["constraint:d"];
  const line = value.geometry["line:a"].geometry;
  if (line.kind === "line") line.end.x_nm = 12_000_000;
  assert.equal(constraintAnnotations(value).find((annotation) => annotation.id === "constraint:d")?.label, "12 mm");
});

function constrainedProfileGrid(cellCount: number): { sketch: Sketch; profiles: string[][] } {
  const value: Sketch = { id: "sketch:scale-grid", revision: 1, geometry: {}, constraints: {}, suppressed_constraints: [] };
  const profiles: string[][] = [];
  const columns = Math.ceil(Math.sqrt(cellCount));
  for (let cell = 0; cell < cellCount; cell += 1) {
    const x = (cell % columns) * 3_000_000;
    const y = Math.floor(cell / columns) * 3_000_000;
    const points = [
      { x_nm: x, y_nm: y },
      { x_nm: x + 2_000_000, y_nm: y },
      { x_nm: x + 2_000_000, y_nm: y + 2_000_000 },
      { x_nm: x, y_nm: y + 2_000_000 },
    ];
    const ids = points.map((_, edge) => `line:${cell}:${edge}`);
    ids.forEach((id, edge) => {
      value.geometry[id] = { id, geometry: { kind: "line", start: points[edge], end: points[(edge + 1) % points.length] } };
      value.constraints[`axis:${cell}:${edge}`] = { kind: edge % 2 ? "vertical" : "horizontal", line: id };
      const dimensionId = `distance:${cell}:${edge}`;
      value.constraints[dimensionId] = {
        kind: "distance",
        a: { geometry: id, anchor: "start" },
        b: { geometry: id, anchor: "end" },
        distance_nm: 2_000_000,
      };
      value.suppressed_constraints!.push(dimensionId);
    });
    // Deliberately unordered: profile assembly must not rely on solver order.
    profiles.push([ids[2], ids[0], ids[3], ids[1]]);
  }
  return { sketch: value, profiles };
}

test("thousands of independent constrained profiles stay bounded as one workspace", { timeout: 10_000 }, (context) => {
  const cellCount = 3_000;
  const { sketch: value, profiles } = constrainedProfileGrid(cellCount);

  const annotationStartedAt = performance.now();
  const annotations = constraintAnnotations(value);
  const annotationMs = performance.now() - annotationStartedAt;
  const profileStartedAt = performance.now();
  const polylines = closedProfilePolylines(value, profiles);
  const profileMs = performance.now() - profileStartedAt;

  assert.equal(Object.keys(value.geometry).length, 12_000);
  assert.equal(Object.keys(value.constraints).length, 24_000);
  assert.equal(annotations.length, 24_000);
  assert.equal(annotations.filter((annotation) => annotation.dimension !== undefined).length, 12_000);
  assert.equal(polylines.length, cellCount);
  assert.ok(polylines.every((profile) => profile.length === 5 && profile[0].x_nm === profile.at(-1)?.x_nm && profile[0].y_nm === profile.at(-1)?.y_nm));
  assert.ok(annotationMs < 1_500, `24,000 constrained annotations took ${annotationMs.toFixed(1)} ms`);
  assert.ok(profileMs < 1_000, `3,000 independent profiles took ${profileMs.toFixed(1)} ms`);
  context.diagnostic(`scale grid: 12,000 geometry / 24,000 constraints; annotations ${annotationMs.toFixed(1)} ms; profiles ${profileMs.toFixed(1)} ms`);
});

test("a huge unordered profile chains without quadratic rescans", { timeout: 5_000 }, (context) => {
  const edgeCount = 20_000;
  const value: Sketch = { id: "sketch:huge-profile", revision: 1, geometry: {}, constraints: {} };
  const ids = Array.from({ length: edgeCount }, (_, edge) => `edge:${edge}`);
  ids.forEach((id, edge) => {
    const start = { x_nm: edge, y_nm: edge % 2 };
    const end = edge === edgeCount - 1 ? { x_nm: 0, y_nm: 0 } : { x_nm: edge + 1, y_nm: (edge + 1) % 2 };
    value.geometry[id] = { id, geometry: { kind: "line", start, end } };
  });
  const adversarialOrder = [...ids.filter((_, edge) => edge % 2 === 0).reverse(), ...ids.filter((_, edge) => edge % 2 === 1)];

  const startedAt = performance.now();
  const profiles = closedProfilePolylines(value, [adversarialOrder]);
  const elapsedMs = performance.now() - startedAt;

  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].length, edgeCount + 1);
  assert.deepEqual(profiles[0][0], profiles[0].at(-1));
  assert.ok(elapsedMs < 750, `20,000-edge profile chaining took ${elapsedMs.toFixed(1)} ms`);
  context.diagnostic(`huge unordered profile: ${edgeCount.toLocaleString()} edges in ${elapsedMs.toFixed(1)} ms`);
});

test("indexed snap inference remains local in a huge constrained workspace", { timeout: 10_000 }, (context) => {
  const { sketch: value } = constrainedProfileGrid(3_000);
  const indexStartedAt = performance.now();
  const index = new SketchSnapSpatialIndex(value);
  const indexMs = performance.now() - indexStartedAt;
  let largestCandidateSet = 0;
  const queryStartedAt = performance.now();
  for (let query = 0; query < 1_000; query += 1) {
    const cell = (query * 2_999) % 3_000;
    const columns = Math.ceil(Math.sqrt(3_000));
    const raw = {
      x_nm: (cell % columns) * 3_000_000 + 750_000,
      y_nm: Math.floor(cell / columns) * 3_000_000 + 30_000,
    };
    const nearby = index.queryNearby(raw, 100_000);
    largestCandidateSet = Math.max(largestCandidateSet, nearby.length);
    const snap = inferSketchPoint(value, raw, [], 100_000, "line", nearby, [], nearby);
    assert.equal(snap.inferences[0]?.kind, "point_on_object");
  }
  const queryMs = performance.now() - queryStartedAt;

  assert.equal(index.size, 12_000);
  assert.ok(largestCandidateSet <= 4, `spatial queries returned as many as ${largestCandidateSet} candidates`);
  assert.ok(indexMs < 1_500, `12,000-entity snap index took ${indexMs.toFixed(1)} ms to build`);
  assert.ok(queryMs < 1_500, `1,000 indexed inference queries took ${queryMs.toFixed(1)} ms`);
  context.diagnostic(`indexed snap: build ${indexMs.toFixed(1)} ms; 1,000 queries ${queryMs.toFixed(1)} ms; max candidates ${largestCandidateSet}`);
});
