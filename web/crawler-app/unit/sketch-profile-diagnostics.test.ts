import assert from "node:assert/strict";
import test from "node:test";
import {
  profileDiagnosticSegments,
  selfIntersectionDiagnostics,
  type Geometry,
  type Point2,
  type ProfileDiagnosticsBroadPhaseInstrumentation,
  type ProfileReport,
  type Sketch,
} from "../src/sketch-editor.ts";

type Segment = Extract<Geometry, { kind: "line" }>;

const emptySketch = (): Sketch => ({ id: "sketch:profile-diagnostic", revision: 0, geometry: {}, constraints: {} });

function samePoint(a: Point2, b: Point2): boolean {
  return a.x_nm === b.x_nm && a.y_nm === b.y_nm;
}

function collinearOverlap(a: Segment, b: Segment): boolean {
  const cross = (p: Point2, q: Point2, r: Point2) => (q.x_nm - p.x_nm) * (r.y_nm - p.y_nm) - (q.y_nm - p.y_nm) * (r.x_nm - p.x_nm);
  if (cross(a.start, a.end, b.start) !== 0 || cross(a.start, a.end, b.end) !== 0) return false;
  const useX = Math.abs(a.end.x_nm - a.start.x_nm) >= Math.abs(a.end.y_nm - a.start.y_nm);
  const interval = (line: Segment) => [Math.min(useX ? line.start.x_nm : line.start.y_nm, useX ? line.end.x_nm : line.end.y_nm), Math.max(useX ? line.start.x_nm : line.start.y_nm, useX ? line.end.x_nm : line.end.y_nm)] as const;
  const [a0, a1] = interval(a); const [b0, b1] = interval(b);
  return Math.min(a1, b1) > Math.max(a0, b0);
}

function interiorTouch(a: Segment, b: Segment): boolean {
  const onSegment = (point: Point2, line: Segment) => {
    const cross = (line.end.x_nm - line.start.x_nm) * (point.y_nm - line.start.y_nm) - (line.end.y_nm - line.start.y_nm) * (point.x_nm - line.start.x_nm);
    if (cross !== 0) return false;
    return point.x_nm >= Math.min(line.start.x_nm, line.end.x_nm) && point.x_nm <= Math.max(line.start.x_nm, line.end.x_nm)
      && point.y_nm >= Math.min(line.start.y_nm, line.end.y_nm) && point.y_nm <= Math.max(line.start.y_nm, line.end.y_nm);
  };
  return [a.start, a.end].some((point) => onSegment(point, b) && !samePoint(point, b.start) && !samePoint(point, b.end))
    || [b.start, b.end].some((point) => onSegment(point, a) && !samePoint(point, a.start) && !samePoint(point, a.end));
}

function properlyIntersects(a: Segment, b: Segment): boolean {
  if ([a.start, a.end].some((point) => samePoint(point, b.start) || samePoint(point, b.end))) return false;
  const cross = (p: Point2, q: Point2, r: Point2) =>
    (q.x_nm - p.x_nm) * (r.y_nm - p.y_nm) - (q.y_nm - p.y_nm) * (r.x_nm - p.x_nm);
  const aa = cross(a.start, a.end, b.start);
  const ab = cross(a.start, a.end, b.end);
  const ba = cross(b.start, b.end, a.start);
  const bb = cross(b.start, b.end, a.end);
  return aa * ab < 0 && ba * bb < 0;
}

/** Test-only copy of the original all-pairs implementation. This remains out
 * of the production hot path and acts as the semantic rollback oracle. */
function referenceSelfIntersectionDiagnostics(sketch: Sketch, exactComparisons?: { count: number }): ProfileReport["diagnostics"] {
  const entities = Object.values(sketch.geometry).filter((entity) => !entity.construction);
  const diagnostics: ProfileReport["diagnostics"] = [];
  for (let first = 0; first < entities.length; first += 1) {
    for (let second = first + 1; second < entities.length; second += 1) {
      const a = profileDiagnosticSegments(entities[first].geometry);
      const b = profileDiagnosticSegments(entities[second].geometry);
      let kind: string | undefined;
      for (const firstSegment of a) for (const secondSegment of b) {
        if (exactComparisons) exactComparisons.count += 1;
        if (collinearOverlap(firstSegment, secondSegment)) kind = "overlapping_contours";
        else if (kind !== "overlapping_contours" && properlyIntersects(firstSegment, secondSegment)) kind = "self_intersection";
        else if (!kind && interiorTouch(firstSegment, secondSegment)) kind = "touching_contours";
      }
      if (kind) diagnostics.push({ kind, geometry: [entities[first].id, entities[second].id] });
    }
  }
  return diagnostics;
}

function add(sketch: Sketch, id: string, geometry: Geometry, construction = false): void {
  sketch.geometry[id] = { id, geometry, construction };
}

function representativeCorpus(): Sketch[] {
  const primitives = emptySketch();
  add(primitives, "line:cross-a", { kind: "line", start: { x_nm: -10, y_nm: -10 }, end: { x_nm: 10, y_nm: 10 } });
  add(primitives, "line:cross-b", { kind: "line", start: { x_nm: -10, y_nm: 10 }, end: { x_nm: 10, y_nm: -10 } });
  add(primitives, "line:overlap", { kind: "line", start: { x_nm: -4, y_nm: -4 }, end: { x_nm: 14, y_nm: 14 } });
  add(primitives, "line:touch", { kind: "line", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 0, y_nm: 20 } });
  add(primitives, "circle", { kind: "circle", center: { x_nm: 35, y_nm: 0 }, radius_nm: 10 });
  add(primitives, "circle:tangent", { kind: "line", start: { x_nm: 25, y_nm: -20 }, end: { x_nm: 25, y_nm: 20 } });
  add(primitives, "arc", { kind: "arc", center: { x_nm: 70, y_nm: 0 }, start: { x_nm: 80, y_nm: 0 }, end: { x_nm: 70, y_nm: 10 }, clockwise: false });
  add(primitives, "arc:cross", { kind: "line", start: { x_nm: 72, y_nm: -5 }, end: { x_nm: 72, y_nm: 15 } });
  add(primitives, "rectangle", { kind: "rectangle", min: { x_nm: 95, y_nm: -10 }, max: { x_nm: 115, y_nm: 10 } });
  add(primitives, "rectangle:cross", { kind: "line", start: { x_nm: 90, y_nm: 0 }, end: { x_nm: 120, y_nm: 0 } });
  add(primitives, "ignored-construction", { kind: "line", start: { x_nm: -100, y_nm: 0 }, end: { x_nm: 150, y_nm: 0 } }, true);
  add(primitives, "point", { kind: "sketch_point", x_nm: 0, y_nm: 0 });

  const nativeCurves = emptySketch();
  add(nativeCurves, "control", { kind: "control_point_spline", degree: 3, control_points: [{ x_nm: 0, y_nm: 0 }, { x_nm: 20, y_nm: 35 }, { x_nm: 40, y_nm: -35 }, { x_nm: 60, y_nm: 0 }] });
  add(nativeCurves, "fit", { kind: "fit_point_spline", fit_points: [{ x_nm: 0, y_nm: 20 }, { x_nm: 20, y_nm: -15 }, { x_nm: 40, y_nm: 30 }, { x_nm: 60, y_nm: -20 }] });
  add(nativeCurves, "ellipse", { kind: "ellipse", center: { x_nm: 100, y_nm: 0 }, major: { x_nm: 125, y_nm: 5 }, minor: { x_nm: 95, y_nm: 14 } });
  add(nativeCurves, "elliptical-arc", { kind: "elliptical_arc", center: { x_nm: 140, y_nm: 0 }, major: { x_nm: 164, y_nm: 4 }, minor: { x_nm: 136, y_nm: 13 }, start: { x_nm: 164, y_nm: 4 }, end: { x_nm: 136, y_nm: 13 }, clockwise: false });
  add(nativeCurves, "conic", { kind: "conic", start: { x_nm: 180, y_nm: -15 }, control: { x_nm: 200, y_nm: 30 }, end: { x_nm: 220, y_nm: -15 }, weight_millionths: 750_000 });
  add(nativeCurves, "curve-crossings", { kind: "line", start: { x_nm: -10, y_nm: 0 }, end: { x_nm: 230, y_nm: 0 } });

  const sparseDense = emptySketch();
  for (let index = 0; index < 36; index += 1) {
    const x = index * 1_000;
    add(sparseDense, `sparse:${index}`, index % 3 === 0
      ? { kind: "circle", center: { x_nm: x, y_nm: x % 7 }, radius_nm: 20 }
      : { kind: "line", start: { x_nm: x, y_nm: 0 }, end: { x_nm: x + 20, y_nm: 10 } });
  }
  return [primitives, nativeCurves, sparseDense];
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function randomPoint(random: () => number, span = 500): Point2 {
  return { x_nm: Math.round((random() - 0.5) * span), y_nm: Math.round((random() - 0.5) * span) };
}

function randomGeometry(random: () => number, index: number): Geometry {
  const point = () => randomPoint(random);
  const center = point();
  switch (index % 10) {
    case 0: return { kind: "line", start: point(), end: point() };
    case 1: return { kind: "circle", center, radius_nm: 5 + Math.round(random() * 80) };
    case 2: {
      const radius = 5 + Math.round(random() * 80);
      return { kind: "arc", center, start: { x_nm: center.x_nm + radius, y_nm: center.y_nm }, end: { x_nm: center.x_nm, y_nm: center.y_nm + radius }, clockwise: random() < 0.5 };
    }
    case 3: {
      const other = point();
      return { kind: "rectangle", min: { x_nm: Math.min(center.x_nm, other.x_nm), y_nm: Math.min(center.y_nm, other.y_nm) }, max: { x_nm: Math.max(center.x_nm, other.x_nm), y_nm: Math.max(center.y_nm, other.y_nm) } };
    }
    case 4: return { kind: "control_point_spline", degree: 3, control_points: [point(), point(), point(), point()] };
    case 5: return { kind: "fit_point_spline", fit_points: [point(), point(), point(), point()] };
    case 6: {
      const major = { x_nm: center.x_nm + 10 + Math.round(random() * 70), y_nm: center.y_nm + Math.round(random() * 20) };
      const minor = { x_nm: center.x_nm - Math.round(random() * 20), y_nm: center.y_nm + 10 + Math.round(random() * 70) };
      return { kind: "ellipse", center, major, minor };
    }
    case 7: {
      const major = { x_nm: center.x_nm + 10 + Math.round(random() * 70), y_nm: center.y_nm };
      const minor = { x_nm: center.x_nm, y_nm: center.y_nm + 10 + Math.round(random() * 70) };
      return { kind: "elliptical_arc", center, major, minor, start: major, end: minor, clockwise: random() < 0.5 };
    }
    case 8: return { kind: "conic", start: point(), control: point(), end: point(), weight_millionths: 100_000 + Math.round(random() * 1_800_000) };
    default: return { kind: "sketch_point", x_nm: center.x_nm, y_nm: center.y_nm };
  }
}

function blankInstrumentation(): ProfileDiagnosticsBroadPhaseInstrumentation {
  return { entityCount: -1, sampledSegmentCount: -1, candidateEntityPairs: -1, rejectedEntityPairs: -1, rejectedSegmentPairs: -1, exactSegmentComparisons: -1 };
}

test("optimized profile diagnostics match the original ordered results across representative geometry", () => {
  const corpus = representativeCorpus();
  for (const sketch of corpus) {
    const expected = referenceSelfIntersectionDiagnostics(sketch);
    assert.deepEqual(selfIntersectionDiagnostics(sketch), expected);
    assert.deepEqual(selfIntersectionDiagnostics(sketch), expected, "repeated runs retain deterministic ordering");
  }
  const primitiveKinds = new Set(selfIntersectionDiagnostics(corpus[0]).map((diagnostic) => diagnostic.kind));
  assert.deepEqual(primitiveKinds, new Set(["self_intersection", "overlapping_contours", "touching_contours"]));
  assert.ok(selfIntersectionDiagnostics(corpus[1]).some((diagnostic) => diagnostic.kind === "self_intersection"), "native-curve crossings remain actionable");
  assert.deepEqual(selfIntersectionDiagnostics(corpus[2]), [], "dense but disjoint geometry remains diagnostic-free");
});

test("optimized profile diagnostics match the original ordered results across seeded random sketches", () => {
  for (let seed = 1; seed <= 24; seed += 1) {
    const random = seededRandom(seed);
    const sketch = emptySketch();
    for (let index = 0; index < 12; index += 1) add(sketch, `seed:${seed}:geometry:${index}`, randomGeometry(random, index), random() < 0.08);
    assert.deepEqual(selfIntersectionDiagnostics(sketch), referenceSelfIntersectionDiagnostics(sketch), `seed ${seed}`);
  }
});

test("profile diagnostic instrumentation proves sparse sketches avoid exact segment comparisons", () => {
  const sketch = emptySketch();
  for (let index = 0; index < 20; index += 1) {
    add(sketch, `circle:${index}`, { kind: "circle", center: { x_nm: index * 10_000, y_nm: 0 }, radius_nm: 100 });
  }
  const reference = { count: 0 };
  const expected = referenceSelfIntersectionDiagnostics(sketch, reference);
  const instrumentation = blankInstrumentation();
  assert.deepEqual(selfIntersectionDiagnostics(sketch, instrumentation), expected);
  assert.deepEqual(instrumentation, {
    entityCount: 20,
    sampledSegmentCount: 1_280,
    candidateEntityPairs: 0,
    rejectedEntityPairs: 190,
    rejectedSegmentPairs: 0,
    exactSegmentComparisons: 0,
  });
  assert.ok(reference.count > 750_000, `reference made ${reference.count} exact segment comparisons`);
  assert.ok(instrumentation.exactSegmentComparisons < reference.count);
});
