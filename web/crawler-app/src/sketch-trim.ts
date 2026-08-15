import type { Geometry, GeometryEntity, Point2, Sketch, SketchCommand, StableId } from "./sketch-editor";
import { evaluateGeometryCurve, intersectGeometryCurves, projectPointToGeometryCurve } from "./sketch-spline.ts";

type LineCurve = { kind: "line"; start: Point2; end: Point2 };
type CircleBase = { center: Point2; radius: number };
type CircleCurve = CircleBase & { kind: "circle" };
type ArcCurve = CircleBase & { kind: "arc"; start: Point2; end: Point2; clockwise: boolean };
type Curve = LineCurve | CircleCurve | ArcCurve;

export type TrimPlan = {
  commands: SketchCommand[];
  replacements: StableId[];
  boundaryCount: number;
};

const EPSILON = 1e-7;
const TAU = Math.PI * 2;

const normalizeAngle = (value: number): number => {
  let result = value % TAU;
  if (result < 0) result += TAU;
  return result;
};

const samePoint = (a: Point2, b: Point2): boolean => a.x_nm === b.x_nm && a.y_nm === b.y_nm;
const roundedPoint = (x: number, y: number): Point2 => ({ x_nm: Math.round(x), y_nm: Math.round(y) });
const linePoint = (line: LineCurve, t: number): Point2 => roundedPoint(
  line.start.x_nm + (line.end.x_nm - line.start.x_nm) * t,
  line.start.y_nm + (line.end.y_nm - line.start.y_nm) * t,
);
const pointAngle = (center: Point2, point: Point2): number => normalizeAngle(Math.atan2(point.y_nm - center.y_nm, point.x_nm - center.x_nm));
const arcSweep = (arc: ArcCurve): number => {
  const start = pointAngle(arc.center, arc.start);
  const end = pointAngle(arc.center, arc.end);
  return arc.clockwise ? normalizeAngle(start - end) : normalizeAngle(end - start);
};
const arcParameter = (arc: ArcCurve, point: Point2): number => {
  const start = pointAngle(arc.center, arc.start);
  const angle = pointAngle(arc.center, point);
  const delta = arc.clockwise ? normalizeAngle(start - angle) : normalizeAngle(angle - start);
  const sweep = arcSweep(arc);
  return sweep <= EPSILON ? Number.NaN : delta / sweep;
};
const circlePointIsExact = (circle: CircleCurve | ArcCurve, point: Point2): boolean => {
  const dx = BigInt(point.x_nm - circle.center.x_nm);
  const dy = BigInt(point.y_nm - circle.center.y_nm);
  const radiusSquared = circle.kind === "arc"
    ? BigInt(circle.start.x_nm - circle.center.x_nm) ** 2n + BigInt(circle.start.y_nm - circle.center.y_nm) ** 2n
    : BigInt(Math.round(circle.radius)) ** 2n;
  return dx * dx + dy * dy === radiusSquared;
};

function geometryCurves(geometry: Geometry): Curve[] {
  if (geometry.kind === "line") return [geometry];
  if (geometry.kind === "circle") return [{ kind: "circle", center: geometry.center, radius: geometry.radius_nm }];
  if (geometry.kind === "arc") return [{
    kind: "arc",
    center: geometry.center,
    radius: Math.hypot(geometry.start.x_nm - geometry.center.x_nm, geometry.start.y_nm - geometry.center.y_nm),
    start: geometry.start,
    end: geometry.end,
    clockwise: geometry.clockwise,
  }];
  if (geometry.kind !== "rectangle") return [];
  const corners = [geometry.min, { x_nm: geometry.max.x_nm, y_nm: geometry.min.y_nm }, geometry.max, { x_nm: geometry.min.x_nm, y_nm: geometry.max.y_nm }];
  return corners.map((start, index) => ({ kind: "line", start, end: corners[(index + 1) % corners.length] }));
}

function lineLine(a: LineCurve, b: LineCurve): Point2[] {
  const adx = a.end.x_nm - a.start.x_nm; const ady = a.end.y_nm - a.start.y_nm;
  const bdx = b.end.x_nm - b.start.x_nm; const bdy = b.end.y_nm - b.start.y_nm;
  const denominator = adx * bdy - ady * bdx;
  if (Math.abs(denominator) < EPSILON) return [];
  const ox = b.start.x_nm - a.start.x_nm; const oy = b.start.y_nm - a.start.y_nm;
  const ta = (ox * bdy - oy * bdx) / denominator;
  const tb = (ox * ady - oy * adx) / denominator;
  if (ta < -EPSILON || ta > 1 + EPSILON || tb < -EPSILON || tb > 1 + EPSILON) return [];
  return [linePoint(a, Math.max(0, Math.min(1, ta)))];
}

function lineCircle(line: LineCurve, circle: CircleBase): Point2[] {
  const dx = line.end.x_nm - line.start.x_nm; const dy = line.end.y_nm - line.start.y_nm;
  const fx = line.start.x_nm - circle.center.x_nm; const fy = line.start.y_nm - circle.center.y_nm;
  const a = dx * dx + dy * dy;
  if (a <= EPSILON) return [];
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - circle.radius * circle.radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < -EPSILON) return [];
  const root = Math.sqrt(Math.max(0, discriminant));
  return [(-b - root) / (2 * a), (-b + root) / (2 * a)]
    .filter((t, index, values) => t >= -EPSILON && t <= 1 + EPSILON && (index === 0 || Math.abs(t - values[0]) > EPSILON))
    .map((t) => linePoint(line, Math.max(0, Math.min(1, t))));
}

function circleCircle(a: CircleBase, b: CircleBase): Point2[] {
  const dx = b.center.x_nm - a.center.x_nm; const dy = b.center.y_nm - a.center.y_nm;
  const distance = Math.hypot(dx, dy);
  if (distance <= EPSILON || distance > a.radius + b.radius + EPSILON || distance < Math.abs(a.radius - b.radius) - EPSILON) return [];
  const along = (a.radius * a.radius - b.radius * b.radius + distance * distance) / (2 * distance);
  const heightSquared = a.radius * a.radius - along * along;
  if (heightSquared < -EPSILON) return [];
  const height = Math.sqrt(Math.max(0, heightSquared));
  const x = a.center.x_nm + along * dx / distance; const y = a.center.y_nm + along * dy / distance;
  const rx = -dy * height / distance; const ry = dx * height / distance;
  const first = roundedPoint(x + rx, y + ry);
  const second = roundedPoint(x - rx, y - ry);
  return samePoint(first, second) ? [first] : [first, second];
}

function pointOnCurve(curve: Curve, point: Point2): boolean {
  if (curve.kind === "line") {
    const dx = curve.end.x_nm - curve.start.x_nm; const dy = curve.end.y_nm - curve.start.y_nm;
    const px = point.x_nm - curve.start.x_nm; const py = point.y_nm - curve.start.y_nm;
    const cross = dx * py - dy * px;
    const dot = px * dx + py * dy;
    return Math.abs(cross) <= Math.max(1, Math.hypot(dx, dy)) && dot >= -EPSILON && dot <= dx * dx + dy * dy + EPSILON;
  }
  const radialError = Math.abs(Math.hypot(point.x_nm - curve.center.x_nm, point.y_nm - curve.center.y_nm) - curve.radius);
  if (radialError > 1.5) return false;
  if (curve.kind === "circle") return true;
  const t = arcParameter(curve, point);
  return t >= -EPSILON && t <= 1 + EPSILON;
}

function intersections(a: Curve, b: Curve): Point2[] {
  let candidates: Point2[];
  // lineLine already validates both bounded parameters before rounding its
  // shared point. Re-testing that rounded lattice point with a cross product
  // can spuriously reject a valid intersection on long oblique lines.
  if (a.kind === "line" && b.kind === "line") return lineLine(a, b);
  else if (a.kind === "line") candidates = lineCircle(a, b as CircleCurve | ArcCurve);
  else if (b.kind === "line") candidates = lineCircle(b, a as CircleCurve | ArcCurve);
  else candidates = circleCircle(a, b);
  return candidates.filter((point) => pointOnCurve(a, point) && pointOnCurve(b, point));
}

function uniqueInterior(values: Array<{ t: number; point: Point2 }>): Array<{ t: number; point: Point2 }> {
  return values
    .filter(({ t }) => Number.isFinite(t) && t > EPSILON && t < 1 - EPSILON)
    .sort((a, b) => a.t - b.t)
    .filter((value, index, all) => index === 0 || Math.abs(value.t - all[index - 1].t) > EPSILON);
}

function sourceCurve(entity: GeometryEntity, selectedSegment?: number): { curve: Curve; rectangleRemainder: LineCurve[] } | undefined {
  if (entity.geometry.kind !== "rectangle") return { curve: geometryCurves(entity.geometry)[0], rectangleRemainder: [] };
  if (!Number.isInteger(selectedSegment) || selectedSegment! < 0 || selectedSegment! > 3) return undefined;
  const edges = geometryCurves(entity.geometry) as LineCurve[];
  return { curve: edges[selectedSegment!], rectangleRemainder: edges.filter((_, index) => index !== selectedSegment) };
}

/**
 * Produces an intersection-bounded trim edit. The interval under the cursor is
 * removed; every other interval is retained. Curve intersections that cannot
 * be represented exactly by the integer-radius arc contract are deliberately
 * ignored rather than moving the trim boundary behind the user's back.
 */
export function planIntersectionTrim(
  sketch: Sketch,
  sourceId: StableId,
  selectedSegment: number | undefined,
  click: Point2,
  nextId: () => StableId,
): TrimPlan | undefined {
  const entity = sketch.geometry[sourceId];
  if (!entity) return undefined;
  if (["control_point_spline", "fit_point_spline", "ellipse", "elliptical_arc", "conic"].includes(entity.geometry.kind)) {
    return planNativeCurveTrim(sketch, entity, click, nextId);
  }
  const source = sourceCurve(entity, selectedSegment);
  if (!source) return undefined;
  const otherCurves = Object.values(sketch.geometry)
    .filter((candidate) => candidate.id !== sourceId)
    .flatMap((candidate) => geometryCurves(candidate.geometry));
  const points = otherCurves.flatMap((candidate) => intersections(source.curve, candidate));
  const commands: SketchCommand[] = [{ kind: "remove_geometry", geometry: sourceId }];
  const replacements: StableId[] = [];
  const add = (geometry: Geometry) => {
    const id = nextId();
    replacements.push(id);
    commands.push({ kind: "add_geometry", entity: { id, construction: entity.construction, geometry } });
  };
  for (const line of source.rectangleRemainder) add(line);

  if (source.curve.kind === "line") {
    const curve = source.curve;
    const dx = curve.end.x_nm - curve.start.x_nm; const dy = curve.end.y_nm - curve.start.y_nm;
    const lengthSquared = dx * dx + dy * dy;
    const boundaries = uniqueInterior(points.map((point) => ({
      point,
      t: lengthSquared <= EPSILON ? Number.NaN : ((point.x_nm - curve.start.x_nm) * dx + (point.y_nm - curve.start.y_nm) * dy) / lengthSquared,
    })));
    // A line without an interior intersection has no trim boundary. Treat it
    // as an unavailable operation rather than accidentally deleting the whole
    // source entity.
    if (boundaries.length === 0 && source.rectangleRemainder.length === 0) {
      const attached = new Set(Object.values(sketch.constraints).flatMap((constraint) => {
        if (constraint.kind !== "coincident") return [];
        return [constraint.a, constraint.b]
          .filter((ref) => ref.geometry === sourceId && (ref.anchor === "start" || ref.anchor === "end"))
          .map((ref) => ref.anchor);
      }));
      // A generated rectangle/closed-chain edge has explicit attachments at
      // both ends and can be removed as one segment. An isolated line has no
      // trim boundary and must remain a non-destructive no-op.
      if (!attached.has("start") || !attached.has("end")) return undefined;
    }
    const cuts = [{ t: 0, point: curve.start }, ...boundaries, { t: 1, point: curve.end }];
    const clickT = Math.max(0, Math.min(1, ((click.x_nm - curve.start.x_nm) * dx + (click.y_nm - curve.start.y_nm) * dy) / lengthSquared));
    let removed = cuts.length - 2;
    for (let index = 0; index < cuts.length - 1; index += 1) {
      if (clickT >= cuts[index].t - EPSILON && clickT <= cuts[index + 1].t + EPSILON) { removed = index; break; }
    }
    cuts.slice(0, -1).forEach((start, index) => {
      const end = cuts[index + 1];
      if (index !== removed && !samePoint(start.point, end.point)) add({ kind: "line", start: start.point, end: end.point });
    });
    return { commands, replacements, boundaryCount: boundaries.length };
  }

  const circle = source.curve;
  const exactPoints = points.filter((point) => circlePointIsExact(circle, point));
  if (circle.kind === "circle") {
    const boundaries = exactPoints
      .map((point) => ({ t: pointAngle(circle.center, point) / TAU, point }))
      .sort((a, b) => a.t - b.t)
      .filter((value, index, all) => index === 0 || Math.abs(value.t - all[index - 1].t) > EPSILON);
    if (points.length > 0 && boundaries.length < 2) return undefined;
    if (boundaries.length < 2) return { commands, replacements, boundaryCount: boundaries.length };
    const clickT = pointAngle(circle.center, click) / TAU;
    let removed = boundaries.length - 1;
    for (let index = 0; index < boundaries.length; index += 1) {
      const endT = index + 1 < boundaries.length ? boundaries[index + 1].t : boundaries[0].t + 1;
      const adjustedClick = clickT < boundaries[index].t ? clickT + 1 : clickT;
      if (adjustedClick <= endT + EPSILON) { removed = index; break; }
    }
    boundaries.forEach((start, index) => {
      const end = boundaries[(index + 1) % boundaries.length];
      if (index !== removed && !samePoint(start.point, end.point)) add({ kind: "arc", center: circle.center, start: start.point, end: end.point, clockwise: false });
    });
    return { commands, replacements, boundaryCount: boundaries.length };
  }

  const boundaries = uniqueInterior(exactPoints.map((point) => ({ t: arcParameter(circle, point), point })));
  if (points.length > 0 && boundaries.length === 0) return undefined;
  const cuts = [{ t: 0, point: circle.start }, ...boundaries, { t: 1, point: circle.end }];
  const clickT = Math.max(0, Math.min(1, arcParameter(circle, click)));
  let removed = cuts.length - 2;
  for (let index = 0; index < cuts.length - 1; index += 1) {
    if (clickT >= cuts[index].t - EPSILON && clickT <= cuts[index + 1].t + EPSILON) { removed = index; break; }
  }
  cuts.slice(0, -1).forEach((start, index) => {
    const end = cuts[index + 1];
    if (index !== removed && !samePoint(start.point, end.point)) add({ kind: "arc", center: circle.center, start: start.point, end: end.point, clockwise: circle.clockwise });
  });
  return { commands, replacements, boundaryCount: boundaries.length };
}

function planNativeCurveTrim(
  sketch: Sketch,
  entity: GeometryEntity,
  click: Point2,
  nextId: () => StableId,
): TrimPlan | undefined {
  const source = entity.geometry;
  if (!["control_point_spline", "fit_point_spline", "ellipse", "elliptical_arc", "conic"].includes(source.kind)) return undefined;
  const hits = Object.values(sketch.geometry)
    .filter((candidate) => candidate.id !== entity.id && candidate.geometry.kind !== "sketch_point")
    .flatMap((candidate) => intersectGeometryCurves(source, candidate.geometry))
    .map((hit) => ({ t: hit.first_parameter, point: hit.point }))
    .filter(({ t }) => t > 1e-5 && t < 1 - 1e-5)
    .sort((a, b) => a.t - b.t)
    .filter((hit, index, all) => index === 0 || Math.abs(hit.t - all[index - 1].t) > 1e-4);
  const clickT = projectPointToGeometryCurve(source, click).parameter;
  const commands: SketchCommand[] = [{ kind: "remove_geometry", geometry: entity.id }];
  const replacements: StableId[] = [];
  const add = (geometry: Geometry) => {
    const id = nextId(); replacements.push(id);
    commands.push({ kind: "add_geometry", entity: { id, construction: entity.construction, geometry } });
  };

  if (source.kind === "ellipse") {
    if (hits.length < 2) return undefined;
    let removed = hits.length - 1;
    for (let index = 0; index < hits.length; index += 1) {
      const end = index + 1 < hits.length ? hits[index + 1].t : hits[0].t + 1;
      const adjusted = clickT < hits[index].t ? clickT + 1 : clickT;
      if (adjusted <= end + EPSILON) { removed = index; break; }
    }
    hits.forEach((start, index) => {
      if (index === removed) return;
      const end = hits[(index + 1) % hits.length];
      add({ kind: "elliptical_arc", center: source.center, major: source.major, minor: source.minor, start: start.point, end: end.point, clockwise: false });
    });
    return { commands, replacements, boundaryCount: hits.length };
  }

  const cuts = [{ t: 0, point: evaluateGeometryCurve(source, 0) }, ...hits, { t: 1, point: evaluateGeometryCurve(source, 1) }];
  let removed = cuts.length - 2;
  for (let index = 0; index < cuts.length - 1; index += 1) {
    if (clickT >= cuts[index].t - EPSILON && clickT <= cuts[index + 1].t + EPSILON) { removed = index; break; }
  }
  cuts.slice(0, -1).forEach((start, index) => {
    if (index === removed) return;
    const end = cuts[index + 1];
    if (samePoint(start.point, end.point)) return;
    if (source.kind === "elliptical_arc") {
      add({ ...source, start: start.point, end: end.point });
    } else {
      const span = end.t - start.t;
      add({ kind: "fit_point_spline", fit_points: [0, 1 / 3, 2 / 3, 1].map((u) => evaluateGeometryCurve(source, start.t + span * u)) });
    }
  });
  return { commands, replacements, boundaryCount: hits.length };
}
