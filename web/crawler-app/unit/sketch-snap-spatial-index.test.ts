import assert from "node:assert/strict";
import test from "node:test";
import type { Geometry, GeometryEntity, Point2, Sketch } from "../src/sketch-editor.ts";
import { evaluateGeometryCurve } from "../src/sketch-spline.ts";
import { SketchSnapSpatialIndex, SketchSnapSpatialIndexCache, sketchGeometrySnapBounds } from "../src/sketch-snap-spatial-index.ts";

const geometries: Record<string, Geometry> = {
  line: { kind: "line", start: { x_nm: -50, y_nm: 10 }, end: { x_nm: 100, y_nm: 40 } },
  circle: { kind: "circle", center: { x_nm: 500, y_nm: 200 }, radius_nm: 80 },
  arc: { kind: "arc", center: { x_nm: 900, y_nm: 300 }, start: { x_nm: 1_000, y_nm: 300 }, end: { x_nm: 900, y_nm: 400 }, clockwise: false },
  rectangle: { kind: "rectangle", min: { x_nm: 1_500, y_nm: 500 }, max: { x_nm: 1_300, y_nm: 700 } },
  control: { kind: "control_point_spline", degree: 3, control_points: [{ x_nm: 2_000, y_nm: 0 }, { x_nm: 2_100, y_nm: 500 }, { x_nm: 2_300, y_nm: -400 }, { x_nm: 2_500, y_nm: 100 }] },
  fit: { kind: "fit_point_spline", fit_points: [{ x_nm: 3_000, y_nm: 0 }, { x_nm: 3_100, y_nm: 800 }, { x_nm: 3_300, y_nm: -700 }, { x_nm: 3_500, y_nm: 100 }] },
  ellipse: { kind: "ellipse", center: { x_nm: 4_000, y_nm: 300 }, major: { x_nm: 4_150, y_nm: 400 }, minor: { x_nm: 3_940, y_nm: 390 } },
  ellipticalArc: { kind: "elliptical_arc", center: { x_nm: 5_000, y_nm: 300 }, major: { x_nm: 5_150, y_nm: 400 }, minor: { x_nm: 4_940, y_nm: 390 }, start: { x_nm: 5_150, y_nm: 400 }, end: { x_nm: 4_940, y_nm: 390 }, clockwise: true },
  conic: { kind: "conic", start: { x_nm: 6_000, y_nm: 0 }, control: { x_nm: 6_200, y_nm: 600 }, end: { x_nm: 6_500, y_nm: 0 }, weight_millionths: 2_000_000 },
  point: { kind: "sketch_point", x_nm: 7_000, y_nm: 123 },
};

function makeSketch(geometryValues: Record<string, Geometry> = geometries): Sketch {
  return {
    id: "sketch:index",
    revision: 4,
    geometry: Object.fromEntries(Object.entries(geometryValues).map(([id, geometry]) => [id, { id, geometry }])),
    constraints: {},
  };
}

function contains(bounds: NonNullable<ReturnType<typeof sketchGeometrySnapBounds>>, point: Point2): boolean {
  return point.x_nm >= bounds.min.x_nm && point.x_nm <= bounds.max.x_nm
    && point.y_nm >= bounds.min.y_nm && point.y_nm <= bounds.max.y_nm;
}

test("conservative bounds contain every native geometry curve and its snap handles", () => {
  for (const [id, geometry] of Object.entries(geometries)) {
    const bounds = sketchGeometrySnapBounds(geometry, 3);
    assert.ok(bounds, `${id} should have finite bounds`);
    for (let index = 0; index <= 2_000; index += 1) {
      assert.ok(contains(bounds, evaluateGeometryCurve(geometry, index / 2_000)), `${id} curve sample ${index} escaped its bounds`);
    }
    for (const handle of geometryHandles(geometry)) {
      assert.ok(contains(bounds, handle), `${id} snap handle escaped its bounds`);
    }
    assert.ok(bounds.min.x_nm <= bounds.max.x_nm && bounds.min.y_nm <= bounds.max.y_nm);
  }
});

function geometryHandles(geometry: Geometry): Point2[] {
  if (geometry.kind === "line") return [geometry.start, geometry.end];
  if (geometry.kind === "circle") return [geometry.center];
  if (geometry.kind === "arc") return [geometry.center, geometry.start, geometry.end];
  if (geometry.kind === "rectangle") return [geometry.min, geometry.max];
  if (geometry.kind === "control_point_spline") return geometry.control_points;
  if (geometry.kind === "fit_point_spline") return geometry.fit_points;
  if (geometry.kind === "ellipse") return [geometry.center, geometry.major, geometry.minor];
  if (geometry.kind === "elliptical_arc") return [geometry.center, geometry.major, geometry.minor, geometry.start, geometry.end];
  if (geometry.kind === "conic") return [geometry.start, geometry.control, geometry.end];
  return [{ x_nm: geometry.x_nm, y_nm: geometry.y_nm }];
}

test("bounds include safety padding and normalize reversed rectangles and negative circle radii", () => {
  assert.deepEqual(
    sketchGeometrySnapBounds({ kind: "line", start: { x_nm: 10, y_nm: 20 }, end: { x_nm: 30, y_nm: 40 } }, 5),
    { min: { x_nm: 5, y_nm: 15 }, max: { x_nm: 35, y_nm: 45 } },
  );
  assert.deepEqual(
    sketchGeometrySnapBounds({ kind: "rectangle", min: { x_nm: 20, y_nm: 50 }, max: { x_nm: -20, y_nm: -10 } }, 0),
    { min: { x_nm: -20, y_nm: -10 }, max: { x_nm: 20, y_nm: 50 } },
  );
  assert.deepEqual(
    sketchGeometrySnapBounds({ kind: "circle", center: { x_nm: 0, y_nm: 0 }, radius_nm: -10 }, 0),
    { min: { x_nm: -10, y_nm: -10 }, max: { x_nm: 10, y_nm: 10 } },
  );
});

test("nearby queries never lose exact candidates for any native geometry kind", () => {
  const sketch = makeSketch();
  const index = new SketchSnapSpatialIndex(sketch, { boundsPaddingNm: 1, leafSize: 2 });
  for (const [id, geometry] of Object.entries(geometries)) {
    for (let sample = 0; sample <= 64; sample += 1) {
      const point = evaluateGeometryCurve(geometry, sample / 64);
      assert.ok(index.queryNearbyIds(point, 0).includes(id), `${id} was absent at parameter ${sample}/64`);
    }
  }
  assert.equal(index.size, Object.keys(geometries).length);
});

test("query aperture includes nearby geometry while pruning distant entities", () => {
  const sketch = makeSketch({
    near: { kind: "line", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 100, y_nm: 0 } },
    far: { kind: "circle", center: { x_nm: 10_000, y_nm: 10_000 }, radius_nm: 100 },
  });
  const index = new SketchSnapSpatialIndex(sketch, { boundsPaddingNm: 0, leafSize: 1 });
  assert.deepEqual(index.queryNearbyIds({ x_nm: 50, y_nm: 9 }, 10), ["near"]);
  assert.deepEqual(index.queryNearbyIds({ x_nm: 50, y_nm: 11 }, 10), []);
  assert.deepEqual(index.queryNearbyIds({ x_nm: 10_100, y_nm: 10_000 }, 0), ["far"]);
});

test("directional broad phase preserves parallel, perpendicular, and equal candidates while pruning unrelated lines", () => {
  const value: Sketch = {
    id: "directions", revision: 1, constraints: {}, geometry: {
      parallel: { id: "parallel", geometry: { kind: "line", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 10, y_nm: 0 } } },
      perpendicular: { id: "perpendicular", geometry: { kind: "line", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 0, y_nm: 20 } } },
      equal: { id: "equal", geometry: { kind: "line", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 6, y_nm: 8 } } },
      unrelated: { id: "unrelated", geometry: { kind: "line", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 15, y_nm: 15 } } },
    },
  };
  const ids = new SketchSnapSpatialIndex(value).queryDirectionalLines({ x: 1, y: 0 }, 10, 0.01, 0.1).map(({ id }) => id);
  assert.deepEqual(ids, ["parallel", "perpendicular", "equal"]);
});

test("singular or non-finite geometry remains an always-query candidate", () => {
  const sketch = makeSketch({
    singular: { kind: "conic", start: { x_nm: 0, y_nm: 0 }, control: { x_nm: 100, y_nm: 100 }, end: { x_nm: 200, y_nm: 0 }, weight_millionths: -1_000_000 },
    invalid: { kind: "sketch_point", x_nm: Number.NaN, y_nm: 0 },
  });
  assert.equal(sketchGeometrySnapBounds(sketch.geometry.singular.geometry), undefined);
  const index = new SketchSnapSpatialIndex(sketch);
  assert.deepEqual(index.queryNearbyIds({ x_nm: 1_000_000, y_nm: -1_000_000 }, 0), ["singular", "invalid"]);
});

test("cache reuse is keyed by sketch id, revision, and geometry record identity", () => {
  const cache = new SketchSnapSpatialIndexCache({ leafSize: 2 });
  const firstSketch = makeSketch();
  const first = cache.forSketch(firstSketch);
  assert.equal(cache.forSketch({ ...firstSketch, constraints: { changed: { kind: "horizontal", line: "line" } } }), first, "unrelated wrapper changes reuse the index");

  const revised = cache.forSketch({ ...firstSketch, revision: firstSketch.revision + 1 });
  assert.notEqual(revised, first, "revision changes rebuild");

  const replacedGeometry = cache.forSketch({ ...firstSketch, revision: firstSketch.revision + 1, geometry: { ...firstSketch.geometry } });
  assert.notEqual(replacedGeometry, revised, "geometry record identity changes rebuild even at the same revision");
  assert.equal(replacedGeometry.matches({ ...firstSketch, revision: firstSketch.revision + 1, geometry: replacedGeometry.geometryIdentity }), true);

  cache.clear();
  assert.notEqual(cache.forSketch(firstSketch), first, "clear forces a rebuild");
});

test("query results retain sketch enumeration order independent of BVH layout", () => {
  const geometry: Record<string, GeometryEntity> = {};
  for (const id of ["z", "a", "q", "b", "m", "c", "x", "d", "n", "e"]) {
    geometry[id] = { id, geometry: { kind: "sketch_point", x_nm: 0, y_nm: 0 } };
  }
  const sketch: Sketch = { id: "ordered", revision: 0, geometry, constraints: {} };
  assert.deepEqual(new SketchSnapSpatialIndex(sketch, { leafSize: 1 }).queryNearbyIds({ x_nm: 0, y_nm: 0 }, 0), Object.keys(geometry));
});

test("invalid index and query tolerances are rejected", () => {
  const sketch = makeSketch();
  assert.throws(() => new SketchSnapSpatialIndex(sketch, { boundsPaddingNm: -1 }), /boundsPaddingNm/);
  assert.throws(() => new SketchSnapSpatialIndex(sketch, { leafSize: 0 }), /leafSize/);
  const index = new SketchSnapSpatialIndex(sketch);
  assert.throws(() => index.queryNearby({ x_nm: 0, y_nm: 0 }, Number.NaN), /toleranceNm/);
  assert.deepEqual(index.queryNearby({ x_nm: Number.NaN, y_nm: 0 }, 10), []);
});
