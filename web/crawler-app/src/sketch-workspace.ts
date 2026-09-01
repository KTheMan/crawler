import type { Constraint, Geometry, GeometryEntity, Point2, PointRef, Sketch, StableId } from "./sketch-editor";
import { evaluateGeometryCurve, projectPointToGeometryCurve, sampleConic, sampleControlPointSpline, sampleEllipse, sampleEllipticalArc, sampleFitPointSpline } from "./sketch-spline.ts";

export type SketchInference =
  | { kind: "origin"; source: PointRef; target: PointRef }
  | { kind: "coincident"; source: PointRef; target: PointRef }
  | { kind: "center"; source: PointRef; target: PointRef }
  | { kind: "midpoint"; source: PointRef; target: PointRef; line: StableId }
  | { kind: "point_on_object"; source: PointRef; target: PointRef; geometry: StableId }
  | { kind: "horizontal"; source: PointRef; target: PointRef }
  | { kind: "vertical"; source: PointRef; target: PointRef }
  | { kind: "parallel"; source: PointRef; target: PointRef; geometry: StableId }
  | { kind: "perpendicular"; source: PointRef; target: PointRef; geometry: StableId }
  | { kind: "tangent"; source: PointRef; target: PointRef; geometry: StableId }
  | { kind: "collinear"; source: PointRef; target: PointRef; geometry: StableId }
  | { kind: "equal"; source: PointRef; target: PointRef; geometry: StableId };

export type SketchSnap = { point: Point2; inferences: SketchInference[]; label?: string };
export type SketchInferenceDatum = Point2 | { point: Point2; reference?: PointRef };

export type ConstraintAnnotation = {
  id: StableId;
  label: string;
  position: Point2;
  dimension?: number;
  dimensionKind?: "length" | "radius" | "angle";
};

export function pointForRef(sketch: Sketch, ref: PointRef): Point2 | undefined {
  if (ref.geometry === "reference:origin" && ref.anchor === "center") return { x_nm: 0, y_nm: 0 };
  const value = sketch.geometry[ref.geometry]?.geometry;
  if (!value) return undefined;
  const parameter = /^parameter:(\d+)$/.exec(ref.anchor);
  if (parameter) return evaluateGeometryCurve(value, Number(parameter[1]) / 1_000_000);
  const knot = /^knot:(\d+)$/.exec(ref.anchor);
  if (knot && (value.kind === "control_point_spline" || value.kind === "fit_point_spline")) {
    if (value.kind === "control_point_spline" && value.knots_millionths?.length) {
      const index = Math.min(Number(knot[1]), value.knots_millionths.length - 1);
      return evaluateGeometryCurve(value, value.knots_millionths[index] / 1_000_000);
    }
    const denominator = value.kind === "control_point_spline"
      ? Math.max(1, value.control_points.length - value.degree)
      : Math.max(1, value.fit_points.length - 1);
    return evaluateGeometryCurve(value, Math.min(Number(knot[1]), denominator) / denominator);
  }
  if (value.kind === "line" && (ref.anchor === "start" || ref.anchor === "end")) return value[ref.anchor];
  if ((value.kind === "circle" || value.kind === "arc") && ref.anchor === "center") return value.center;
  if (value.kind === "arc" && (ref.anchor === "start" || ref.anchor === "end")) return value[ref.anchor];
  if (value.kind === "rectangle" && (ref.anchor === "min" || ref.anchor === "max")) return value[ref.anchor];
  if (value.kind === "control_point_spline") {
    if (ref.anchor === "start") return value.control_points[0];
    if (ref.anchor === "end") return value.control_points.at(-1);
    const match = /^control:(\d+)$/.exec(ref.anchor);
    return match ? value.control_points[Number(match[1])] : undefined;
  }
  if (value.kind === "fit_point_spline") {
    if (ref.anchor === "start") return value.fit_points[0]; if (ref.anchor === "end") return value.fit_points.at(-1);
    const match = /^fit:(\d+)$/.exec(ref.anchor); return match ? value.fit_points[Number(match[1])] : undefined;
  }
  if (value.kind === "ellipse" && (ref.anchor === "center" || ref.anchor === "major" || ref.anchor === "minor")) return value[ref.anchor];
  if (value.kind === "elliptical_arc" && (ref.anchor === "center" || ref.anchor === "major" || ref.anchor === "minor" || ref.anchor === "start" || ref.anchor === "end")) return value[ref.anchor];
  if (value.kind === "conic" && (ref.anchor === "start" || ref.anchor === "control" || ref.anchor === "end")) return value[ref.anchor];
  if (value.kind === "sketch_point" && ref.anchor === "position") return { x_nm: value.x_nm, y_nm: value.y_nm };
  return undefined;
}

export function geometryPointRefs(sketch: Sketch, geometryId: StableId): PointRef[] {
  const value = sketch.geometry[geometryId]?.geometry;
  if (!value) return [];
  if (value.kind === "line") return ["start", "end"].map((anchor) => ({ geometry: geometryId, anchor: anchor as "start" | "end" }));
  if (value.kind === "circle") return [{ geometry: geometryId, anchor: "center" }];
  if (value.kind === "arc") return ["center", "start", "end"].map((anchor) => ({ geometry: geometryId, anchor: anchor as "center" | "start" | "end" }));
  if (value.kind === "control_point_spline") {
    const knotCount = value.knots_millionths?.length ?? Math.max(1, value.control_points.length - value.degree) + 1;
    return [...value.control_points.map((_, index) => ({ geometry: geometryId, anchor: `control:${index}` as const })), ...Array.from({ length: knotCount }, (_, index) => ({ geometry: geometryId, anchor: `knot:${index}` as const }))];
  }
  if (value.kind === "fit_point_spline") return [...value.fit_points.map((_, index) => ({ geometry: geometryId, anchor: `fit:${index}` as const })), ...value.fit_points.map((_, index) => ({ geometry: geometryId, anchor: `knot:${index}` as const }))];
  if (value.kind === "ellipse") return ["center", "major", "minor"].map((anchor) => ({ geometry: geometryId, anchor: anchor as "center" | "major" | "minor" }));
  if (value.kind === "elliptical_arc") return ["center", "major", "minor", "start", "end"].map((anchor) => ({ geometry: geometryId, anchor: anchor as "center" | "major" | "minor" | "start" | "end" }));
  if (value.kind === "conic") return ["start", "control", "end"].map((anchor) => ({ geometry: geometryId, anchor: anchor as "start" | "control" | "end" }));
  if (value.kind === "sketch_point") return [{ geometry: geometryId, anchor: "position" }];
  return ["min", "max"].map((anchor) => ({ geometry: geometryId, anchor: anchor as "min" | "max" }));
}

export function inferSketchPoint(
  sketch: Sketch,
  raw: Point2,
  fixed: readonly SketchInferenceDatum[],
  toleranceNm: number,
  creationKind?: "line" | "circle" | "arc" | string,
  proximityGeometry?: readonly GeometryEntity[],
  relationGeometry?: readonly GeometryEntity[],
  tangentGeometry?: readonly GeometryEntity[],
): SketchSnap {
  const cursorReference: PointRef = { geometry: "preview:cursor", anchor: "position" };
  const candidates: Array<{ point: Point2; inference: SketchInference; label: string; priority: number }> = [
    { point: { x_nm: 0, y_nm: 0 }, inference: { kind: "origin", source: cursorReference, target: { geometry: "reference:origin", anchor: "center" } }, label: "Origin", priority: 0 },
  ];
  for (const entity of proximityGeometry ?? Object.values(sketch.geometry)) {
    for (const ref of geometryPointRefs(sketch, entity.id)) {
      const point = pointForRef(sketch, ref);
      if (point) candidates.push({ point, inference: ref.anchor === "center" ? { kind: "center", source: cursorReference, target: ref } : { kind: "coincident", source: cursorReference, target: ref }, label: ref.anchor === "center" ? "Center" : "Coincident", priority: 1 });
    }
    if (entity.geometry.kind === "line") {
      candidates.push({
        point: midpoint(entity.geometry.start, entity.geometry.end),
        inference: { kind: "midpoint", source: cursorReference, target: { geometry: entity.id, anchor: "parameter:500000" }, line: entity.id },
        label: "Midpoint",
        priority: 2,
      });
    }
    const projected = entity.geometry.kind === "sketch_point" ? undefined : closestPointOnGeometry(raw, entity.geometry);
    if (projected) {
      const parameter = projectPointToGeometryCurve(entity.geometry, raw).parameter;
      candidates.push({ point: projected, inference: { kind: "point_on_object", source: cursorReference, target: { geometry: entity.id, anchor: `parameter:${Math.round(parameter * 1_000_000)}` }, geometry: entity.id }, label: "On object", priority: 3 });
    }
  }
  const nearby = candidates
    .map((candidate) => ({ ...candidate, distance: pointDistance(raw, candidate.point) }))
    .filter((candidate) => candidate.distance <= toleranceNm)
    // Prefer semantically stronger snaps whenever they are inside the screen-space
    // aperture. A curve projection is often mathematically closer than a nearby
    // endpoint or midpoint, but choosing it would discard the user's stronger
    // topological intent.
    .sort((a, b) => a.priority - b.priority || a.distance - b.distance)[0];
  let point = nearby?.point ?? raw;
  const inferences = nearby ? [nearby.inference] : [];
  let label = nearby?.label;
  const fixedDatum = fixed.at(-1);
  const datum = fixedDatum && "point" in fixedDatum ? fixedDatum.point : fixedDatum;
  const datumReference = fixedDatum && "point" in fixedDatum ? fixedDatum.reference : undefined;
  if (datum) {
    const horizontal = Math.abs(point.y_nm - datum.y_nm) <= toleranceNm;
    const vertical = Math.abs(point.x_nm - datum.x_nm) <= toleranceNm;
    if (horizontal && (!vertical || Math.abs(point.y_nm - datum.y_nm) <= Math.abs(point.x_nm - datum.x_nm))) {
      point = { ...point, y_nm: datum.y_nm };
      inferences.push({ kind: "horizontal", source: inferencePointReference(nearby?.inference, "preview:cursor"), target: datumReference ?? { geometry: "preview:datum", anchor: "position" } });
      label = label ? `${label} · Horizontal` : "Horizontal";
    } else if (vertical) {
      point = { ...point, x_nm: datum.x_nm };
      inferences.push({ kind: "vertical", source: inferencePointReference(nearby?.inference, "preview:cursor"), target: datumReference ?? { geometry: "preview:datum", anchor: "position" } });
      label = label ? `${label} · Vertical` : "Vertical";
    }
    if (!nearby) {
      const dx = raw.x_nm - datum.x_nm; const dy = raw.y_nm - datum.y_nm; const length = Math.hypot(dx, dy);
      const direction = length ? { x: dx / length, y: dy / length } : undefined;
      const angularTolerance = Math.min(0.12, toleranceNm / Math.max(length, toleranceNm));
      let relation: { point: Point2; inference: SketchInference; label: string; error: number; priority: number } | undefined;
      if (direction) for (const entity of relationGeometry ?? Object.values(sketch.geometry)) {
        if (entity.geometry.kind !== "line") continue;
        const ex = entity.geometry.end.x_nm - entity.geometry.start.x_nm; const ey = entity.geometry.end.y_nm - entity.geometry.start.y_nm; const el = Math.hypot(ex, ey); if (!el) continue;
        const unit = { x: ex / el, y: ey / el };
        const parallelError = Math.abs(direction.x * unit.y - direction.y * unit.x);
        const perpendicularError = Math.abs(direction.x * unit.x + direction.y * unit.y);
        const datumProjection = closestPointOnGeometry(datum, entity.geometry);
        const onLine = datumProjection && pointDistance(datum, datumProjection) <= toleranceNm;
        const targetLengthError = Math.abs(length - el);
        const options = [
          { error: parallelError, inference: { kind: onLine ? "collinear" : "parallel", source: cursorReference, target: { geometry: entity.id, anchor: "parameter:500000" }, geometry: entity.id } as SketchInference, label: onLine ? "Collinear" : "Parallel", vector: unit, priority: onLine ? 4 : 5 },
          { error: perpendicularError, inference: { kind: "perpendicular", source: cursorReference, target: { geometry: entity.id, anchor: "parameter:500000" }, geometry: entity.id } as SketchInference, label: "Perpendicular", vector: { x: -unit.y, y: unit.x }, priority: 6 },
        ];
        for (const option of options) if (option.error <= angularTolerance && (!relation || option.priority < relation.priority || (option.priority === relation.priority && option.error < relation.error))) {
          const sign = direction.x * option.vector.x + direction.y * option.vector.y < 0 ? -1 : 1;
          relation = { point: { x_nm: Math.round(datum.x_nm + option.vector.x * length * sign), y_nm: Math.round(datum.y_nm + option.vector.y * length * sign) }, inference: option.inference, label: option.label, error: option.error, priority: option.priority };
        }
        if (targetLengthError <= toleranceNm && (!relation || relation.priority > 7)) {
          relation = { point: { x_nm: Math.round(datum.x_nm + direction.x * el), y_nm: Math.round(datum.y_nm + direction.y * el) }, inference: { kind: "equal", source: cursorReference, target: { geometry: entity.id, anchor: "parameter:500000" }, geometry: entity.id }, label: "Equal", error: targetLengthError / Math.max(1, el), priority: 7 };
        }
      }
      if (relation) {
        point = relation.point;
        inferences.push(relation.inference);
        label = label ? `${label} · ${relation.label}` : relation.label;
      }
      for (const entity of tangentGeometry ?? proximityGeometry ?? Object.values(sketch.geometry)) {
        if (!direction || (creationKind === "line" && entity.geometry.kind === "line") || entity.geometry.kind === "rectangle" || entity.geometry.kind === "sketch_point") continue;
        const contact = projectPointToGeometryCurve(entity.geometry, datum);
        const tangentError = creationKind === "circle"
          ? Math.abs(direction.x * contact.tangent.x + direction.y * contact.tangent.y)
          : Math.abs(direction.x * contact.tangent.y - direction.y * contact.tangent.x);
        if (contact.distance_nm <= toleranceNm && tangentError <= angularTolerance) {
          inferences.push({ kind: "tangent", source: cursorReference, target: { geometry: entity.id, anchor: `parameter:${Math.round(contact.parameter * 1_000_000)}` }, geometry: entity.id }); label = label ? `${label} · Tangent` : "Tangent"; break;
        }
      }
    }
  }
  return { point, inferences, label };
}

function inferencePointReference(inference: SketchInference | undefined, fallback: StableId): PointRef {
  if (inference) return inference.target;
  return { geometry: fallback, anchor: "position" };
}

export function constraintAnnotations(sketch: Sketch, constraintIds?: ReadonlySet<StableId>): ConstraintAnnotation[] {
  const suppressed = sketch.suppressed_constraints?.length ? new Set(sketch.suppressed_constraints) : undefined;
  return Object.entries(sketch.constraints).flatMap(([id, constraint]) => {
    if (constraintIds && !constraintIds.has(id)) return [];
    const annotation = annotationForConstraint(sketch, id, constraint, suppressed?.has(id) ?? false);
    return annotation ? [annotation] : [];
  });
}

export function closedProfilePolylines(sketch: Sketch, profiles: readonly StableId[][]): Point2[][] {
  return profiles.flatMap((profile) => {
    if (profile.length === 1) {
      const geometry = sketch.geometry[profile[0]]?.geometry;
      if (geometry?.kind === "circle") return [sampleRound(geometry.center, geometry.radius_nm, 0, Math.PI * 2, 64)];
      if (geometry?.kind === "ellipse") return [sampleEllipse(geometry.center, geometry.major, geometry.minor)];
      if (geometry?.kind === "elliptical_arc") return [sampleEllipticalArc(geometry.center, geometry.major, geometry.minor, geometry.start, geometry.end, geometry.clockwise)];
    }
    const segments = profile.flatMap((id) => geometrySegments(sketch.geometry[id]?.geometry));
    if (!segments.length) return [];
    const used = new Uint8Array(segments.length);
    const endpointSegments = new Map<string, number[]>();
    const endpointCursors = new Map<string, number>();
    const addEndpoint = (point: Point2, segment: number) => {
      const key = pointKey(point);
      if (key === undefined) return;
      const entries = endpointSegments.get(key);
      if (entries) entries.push(segment);
      else endpointSegments.set(key, [segment]);
    };
    segments.forEach(([start, end], index) => {
      addEndpoint(start, index);
      if (!samePoint(start, end)) addEndpoint(end, index);
    });
    const nextSegment = (point: Point2): number | undefined => {
      const key = pointKey(point);
      if (key === undefined) return undefined;
      const entries = endpointSegments.get(key);
      if (!entries) return undefined;
      let cursor = endpointCursors.get(key) ?? 0;
      while (cursor < entries.length && used[entries[cursor]]) cursor += 1;
      endpointCursors.set(key, cursor);
      return entries[cursor];
    };
    const chain = [...segments[0]];
    used[0] = 1;
    for (let consumed = 1; consumed < segments.length; consumed += 1) {
      const tail = chain.at(-1)!;
      const index = nextSegment(tail);
      if (index === undefined) break;
      used[index] = 1;
      const [a, b] = segments[index];
      chain.push(...(samePoint(a, tail) ? [b] : [a]));
    }
    return chain.length > 2 && samePoint(chain[0], chain.at(-1)!) ? [chain] : [];
  });
}

/** A profile identity is topological: editing coordinates does not change it. */
export function sketchProfileId(sketchId: StableId, geometryIds: readonly StableId[]): string {
  return `${encodeURIComponent(sketchId)}/profile:${[...new Set(geometryIds)].sort().map(encodeURIComponent).join("|")}`;
}

/**
 * Mirrors the kernel's current profile grouping closely enough to resolve a
 * retained profile against an accepted sketch without relying on coordinates
 * captured when the profile was selected.
 */
export function closedProfileGeometryIds(sketch: Sketch): StableId[][] {
  const entities = Object.values(sketch.geometry).filter((entity) => !entity.construction);
  const profiles = entities
    .filter((entity) => ["rectangle", "circle", "ellipse"].includes(entity.geometry.kind))
    .map((entity) => [entity.id]);
  const edges = entities.filter((entity) => !["rectangle", "circle", "ellipse", "sketch_point"].includes(entity.geometry.kind));
  const endpointKey = (point: Point2) => `${point.x_nm}:${point.y_nm}`;
  const endpoints = new Map<string, StableId[]>();
  const edgeEndpoints = new Map<StableId, [string, string]>();
  for (const entity of edges) {
    const exactEndpoints = profileGeometryEndpoints(entity.geometry);
    if (!exactEndpoints) continue;
    const start = endpointKey(exactEndpoints[0]);
    const end = endpointKey(exactEndpoints[1]);
    edgeEndpoints.set(entity.id, [start, end]);
    for (const key of [start, end]) endpoints.set(key, [...(endpoints.get(key) ?? []), entity.id]);
  }
  const unseen = new Set(edgeEndpoints.keys());
  while (unseen.size) {
    const seed = unseen.values().next().value as StableId;
    const component: StableId[] = [];
    const queue = [seed];
    while (queue.length) {
      const id = queue.pop()!;
      if (!unseen.delete(id)) continue;
      component.push(id);
      for (const endpoint of edgeEndpoints.get(id) ?? []) {
        for (const neighbor of endpoints.get(endpoint) ?? []) if (unseen.has(neighbor)) queue.push(neighbor);
      }
    }
    if (component.length && component.every((id) => (edgeEndpoints.get(id) ?? []).every((endpoint) => endpoints.get(endpoint)?.length === 2))) {
      profiles.push(component);
    }
  }
  return profiles.map((profile) => [...profile].sort()).sort((a, b) => sketchProfileId(sketch.id, a).localeCompare(sketchProfileId(sketch.id, b)));
}

function profileGeometryEndpoints(geometry: Geometry): readonly [Point2, Point2] | undefined {
  if (geometry.kind === "line" || geometry.kind === "arc" || geometry.kind === "elliptical_arc" || geometry.kind === "conic") return [geometry.start, geometry.end];
  if (geometry.kind === "control_point_spline") {
    const start = geometry.control_points[0]; const end = geometry.control_points.at(-1);
    return start && end ? [start, end] : undefined;
  }
  if (geometry.kind === "fit_point_spline") {
    const start = geometry.fit_points[0]; const end = geometry.fit_points.at(-1);
    return start && end ? [start, end] : undefined;
  }
  return undefined;
}

function annotationForConstraint(sketch: Sketch, id: StableId, constraint: Constraint, reference: boolean): ConstraintAnnotation | undefined {
  const measured = reference ? measuredConstraintValue(sketch, constraint) : undefined;
  if (constraint.kind === "point_on_origin") return atPoint(sketch, id, "O", constraint.point);
  if (constraint.kind === "fixed") return atPoint(sketch, id, "🔒", constraint.point);
  if (constraint.kind === "fixed_geometry") return atGeometry(sketch, id, "🔒", constraint.geometry);
  if (constraint.kind === "midpoint") return atPoint(sketch, id, "M", constraint.point);
  if (constraint.kind === "point_on_object") return atPoint(sketch, id, "◉", constraint.point);
  if (constraint.kind === "coincident") return atPoint(sketch, id, "●", constraint.a);
  if (constraint.kind === "horizontal" || constraint.kind === "vertical") return atGeometry(sketch, id, constraint.kind === "horizontal" ? "H" : "V", constraint.line);
  if (constraint.kind === "horizontal_points" || constraint.kind === "vertical_points") return atPoint(sketch, id, constraint.kind === "horizontal_points" ? "H" : "V", constraint.a);
  if (constraint.kind === "collinear") return atPoint(sketch, id, "—", constraint.point);
  if (constraint.kind === "symmetry") return atPoint(sketch, id, "↔", constraint.first);
  if (constraint.kind === "curvature_continuous") return atGeometryPair(sketch, id, "G2", constraint.first, constraint.second);
  if (constraint.kind === "concentric") return atGeometryPair(sketch, id, "◎", constraint.first, constraint.second);
  if (["parallel", "perpendicular", "tangent", "equal"].includes(constraint.kind)) {
    const pair = constraint as Extract<Constraint, { first: StableId; second: StableId }>;
    const labels: Record<string, string> = { parallel: "∥", perpendicular: "⊥", tangent: "T", equal: "=" };
    return atGeometryPair(sketch, id, labels[constraint.kind], pair.first, pair.second);
  }
  if (constraint.kind === "distance") {
    const a = pointForRef(sketch, constraint.a); const b = pointForRef(sketch, constraint.b);
    const value = measured ?? constraint.distance_nm;
    return a && b ? { id, label: `${formatMm(value)} mm`, position: midpoint(a, b), dimension: value, dimensionKind: "length" } : undefined;
  }
  if (constraint.kind === "distance_x" || constraint.kind === "distance_y") {
    const a = pointForRef(sketch, constraint.a); const b = pointForRef(sketch, constraint.b);
    const prefix = constraint.kind === "distance_x" ? "ΔX" : "ΔY";
    const value = measured ?? constraint.distance_nm;
    return a && b ? { id, label: `${prefix} ${formatMm(value)} mm`, position: midpoint(a, b), dimension: value, dimensionKind: "length" } : undefined;
  }
  if (constraint.kind === "point_line_distance") {
    const value = measured ?? constraint.distance_nm;
    const annotation = atPoint(sketch, id, `↥ ${formatMm(value)} mm`, constraint.point);
    return annotation ? { ...annotation, dimension: value, dimensionKind: "length" } : undefined;
  }
  if (constraint.kind === "line_distance") {
    const position = geometryPairCenter(sketch, constraint.first, constraint.second);
    const value = measured ?? constraint.distance_nm; return position ? { id, label: `↕ ${formatMm(value)} mm`, position, dimension: value, dimensionKind: "length" } : undefined;
  }
  if (constraint.kind === "offset_distance") {
    const position = geometryPairCenter(sketch, constraint.source, constraint.offset);
    const value = measured ?? constraint.distance_nm; return position ? { id, label: `Offset ${formatMm(value)} mm`, position, dimension: value, dimensionKind: "length" } : undefined;
  }
  if (constraint.kind === "radius") {
    const center = geometryCenter(sketch.geometry[constraint.geometry]?.geometry);
    const value = measured ?? constraint.radius_nm; return center ? { id, label: `R ${formatMm(value)}`, position: { x_nm: center.x_nm + value, y_nm: center.y_nm }, dimension: value, dimensionKind: "radius" } : undefined;
  }
  if (constraint.kind === "diameter") {
    const center = geometryCenter(sketch.geometry[constraint.geometry]?.geometry);
    const value = measured ?? constraint.diameter_nm; return center ? { id, label: `Ø ${formatMm(value)}`, position: { x_nm: center.x_nm + value / 2, y_nm: center.y_nm }, dimension: value, dimensionKind: "radius" } : undefined;
  }
  if (constraint.kind === "ellipse_radius") {
    const center = geometryCenter(sketch.geometry[constraint.geometry]?.geometry);
    const value = measured ?? constraint.radius_nm; return center ? { id, label: `${constraint.axis === "major" ? "A" : "B"} ${formatMm(value)}`, position: center, dimension: value, dimensionKind: "radius" } : undefined;
  }
  if (constraint.kind === "angle") {
    const position = geometryPairCenter(sketch, constraint.first, constraint.second);
    const value = measured ?? constraint.angle_microdegrees; return position ? { id, label: `${(value / 1_000_000).toFixed(1)}°`, position, dimension: value, dimensionKind: "angle" } : undefined;
  }
  if (constraint.kind === "angle_to_axis") {
    const position = geometryCenter(sketch.geometry[constraint.line]?.geometry);
    const value = measured ?? constraint.angle_microdegrees; return position ? { id, label: `${(value / 1_000_000).toFixed(1)}°`, position, dimension: value, dimensionKind: "angle" } : undefined;
  }
  return undefined;
}

function measuredConstraintValue(sketch: Sketch, constraint: Constraint): number | undefined {
  if (constraint.kind === "distance" || constraint.kind === "distance_x" || constraint.kind === "distance_y") {
    const a = pointForRef(sketch, constraint.a); const b = pointForRef(sketch, constraint.b); if (!a || !b) return undefined;
    return constraint.kind === "distance_x" ? Math.abs(b.x_nm - a.x_nm) : constraint.kind === "distance_y" ? Math.abs(b.y_nm - a.y_nm) : pointDistance(a, b);
  }
  if (constraint.kind === "point_line_distance") {
    const point = pointForRef(sketch, constraint.point); const line = sketch.geometry[constraint.line]?.geometry;
    if (!point || line?.kind !== "line") return undefined;
    const dx = line.end.x_nm - line.start.x_nm; const dy = line.end.y_nm - line.start.y_nm;
    return Math.abs(dx * (line.start.y_nm - point.y_nm) - (line.start.x_nm - point.x_nm) * dy) / Math.max(1, Math.hypot(dx, dy));
  }
  if (constraint.kind === "line_distance") {
    const first = sketch.geometry[constraint.first]?.geometry; const second = sketch.geometry[constraint.second]?.geometry;
    if (first?.kind !== "line" || second?.kind !== "line") return undefined;
    const dx = first.end.x_nm - first.start.x_nm; const dy = first.end.y_nm - first.start.y_nm;
    return Math.abs(dx * (first.start.y_nm - second.start.y_nm) - (first.start.x_nm - second.start.x_nm) * dy) / Math.max(1, Math.hypot(dx, dy));
  }
  if (constraint.kind === "offset_distance") {
    const source = sketch.geometry[constraint.source]?.geometry; const offset = sketch.geometry[constraint.offset]?.geometry;
    if (!source || !offset) return undefined;
    const sample = evaluateGeometryCurve(source, constraint.source_start_millionths / 1_000_000);
    return projectPointToGeometryCurve(offset, sample).distance_nm;
  }
  if (constraint.kind === "radius" || constraint.kind === "diameter") {
    const value = sketch.geometry[constraint.geometry]?.geometry;
    const radius = value?.kind === "circle" ? value.radius_nm : value?.kind === "arc" ? pointDistance(value.center, value.start) : undefined;
    return radius === undefined ? undefined : constraint.kind === "diameter" ? radius * 2 : radius;
  }
  if (constraint.kind === "ellipse_radius") {
    const value = sketch.geometry[constraint.geometry]?.geometry;
    return value && (value.kind === "ellipse" || value.kind === "elliptical_arc") ? pointDistance(value.center, value[constraint.axis]) : undefined;
  }
  if (constraint.kind === "angle") {
    const first = sketch.geometry[constraint.first]?.geometry; const second = sketch.geometry[constraint.second]?.geometry;
    if (first?.kind !== "line" || second?.kind !== "line") return undefined;
    const a = Math.atan2(first.end.y_nm - first.start.y_nm, first.end.x_nm - first.start.x_nm);
    const b = Math.atan2(second.end.y_nm - second.start.y_nm, second.end.x_nm - second.start.x_nm);
    let degrees = Math.abs((b - a) * 180 / Math.PI) % 180; if (degrees > 90) degrees = 180 - degrees;
    return Math.round(degrees * 1_000_000);
  }
  if (constraint.kind === "angle_to_axis") {
    const line = sketch.geometry[constraint.line]?.geometry;
    if (line?.kind !== "line") return undefined;
    const lineDegrees = Math.atan2(line.end.y_nm - line.start.y_nm, line.end.x_nm - line.start.x_nm) * 180 / Math.PI;
    const axisDegrees = constraint.axis === "x" ? 0 : 90;
    let degrees = (lineDegrees - axisDegrees) % 360;
    if (degrees <= -180) degrees += 360;
    if (degrees > 180) degrees -= 360;
    return Math.round(degrees * 1_000_000);
  }
  return undefined;
}

function atPoint(sketch: Sketch, id: StableId, label: string, ref: PointRef): ConstraintAnnotation | undefined {
  const position = pointForRef(sketch, ref);
  return position ? { id, label, position } : undefined;
}

function atGeometry(sketch: Sketch, id: StableId, label: string, geometry: StableId): ConstraintAnnotation | undefined {
  const position = geometryCenter(sketch.geometry[geometry]?.geometry);
  return position ? { id, label, position } : undefined;
}

function atGeometryPair(sketch: Sketch, id: StableId, label: string, first: StableId, second: StableId): ConstraintAnnotation | undefined {
  const position = geometryPairCenter(sketch, first, second);
  return position ? { id, label, position } : undefined;
}

function geometryPairCenter(sketch: Sketch, first: StableId, second: StableId): Point2 | undefined {
  const a = geometryCenter(sketch.geometry[first]?.geometry); const b = geometryCenter(sketch.geometry[second]?.geometry);
  return a && b ? midpoint(a, b) : a ?? b;
}

function geometryCenter(geometry?: Geometry): Point2 | undefined {
  if (!geometry) return undefined;
  if (geometry.kind === "line") return midpoint(geometry.start, geometry.end);
  if (geometry.kind === "circle" || geometry.kind === "arc") return geometry.center;
  if (geometry.kind === "control_point_spline") return geometry.control_points.length
    ? {
      x_nm: Math.round(geometry.control_points.reduce((sum, point) => sum + point.x_nm, 0) / geometry.control_points.length),
      y_nm: Math.round(geometry.control_points.reduce((sum, point) => sum + point.y_nm, 0) / geometry.control_points.length),
    }
    : undefined;
  if (geometry.kind === "fit_point_spline") return average(geometry.fit_points);
  if (geometry.kind === "ellipse") return geometry.center;
  if (geometry.kind === "elliptical_arc") return geometry.center;
  if (geometry.kind === "conic") return average([geometry.start, geometry.control, geometry.end]);
  if (geometry.kind === "sketch_point") return { x_nm: geometry.x_nm, y_nm: geometry.y_nm };
  return midpoint(geometry.min, geometry.max);
}

/** A screen-selection path that follows the rendered curve rather than only its handles. */
export function sketchGeometrySelectionPath(geometry?: Geometry): Point2[] {
  if (!geometry) return [];
  if (geometry.kind === "line") return [geometry.start, geometry.end];
  if (geometry.kind === "circle") return sampleRound(geometry.center, geometry.radius_nm, 0, Math.PI * 2, 64);
  if (geometry.kind === "arc") {
    const start = Math.atan2(geometry.start.y_nm - geometry.center.y_nm, geometry.start.x_nm - geometry.center.x_nm);
    let sweep = Math.atan2(geometry.end.y_nm - geometry.center.y_nm, geometry.end.x_nm - geometry.center.x_nm) - start;
    if (geometry.clockwise) while (sweep >= 0) sweep -= Math.PI * 2;
    else while (sweep <= 0) sweep += Math.PI * 2;
    return sampleRound(geometry.center, pointDistance(geometry.center, geometry.start), start, sweep, 48);
  }
  if (geometry.kind === "control_point_spline") return sampleControlPointSpline(geometry.control_points, 48, geometry.degree, geometry.knots_millionths);
  if (geometry.kind === "fit_point_spline") return sampleFitPointSpline(geometry.fit_points);
  if (geometry.kind === "ellipse") return sampleEllipse(geometry.center, geometry.major, geometry.minor);
  if (geometry.kind === "elliptical_arc") return sampleEllipticalArc(geometry.center, geometry.major, geometry.minor, geometry.start, geometry.end, geometry.clockwise);
  if (geometry.kind === "conic") return sampleConic(geometry.start, geometry.control, geometry.end, geometry.weight_millionths);
  if (geometry.kind === "sketch_point") return [{ x_nm: geometry.x_nm, y_nm: geometry.y_nm }];
  return [geometry.min, { x_nm: geometry.max.x_nm, y_nm: geometry.min.y_nm }, geometry.max, { x_nm: geometry.min.x_nm, y_nm: geometry.max.y_nm }, geometry.min];
}

function geometrySegments(geometry?: Geometry): Point2[][] {
  if (!geometry) return [];
  if (geometry.kind === "line") return [[geometry.start, geometry.end]];
  if (geometry.kind === "arc") {
    const start = Math.atan2(geometry.start.y_nm - geometry.center.y_nm, geometry.start.x_nm - geometry.center.x_nm);
    let sweep = Math.atan2(geometry.end.y_nm - geometry.center.y_nm, geometry.end.x_nm - geometry.center.x_nm) - start;
    if (geometry.clockwise) while (sweep >= 0) sweep -= Math.PI * 2;
    else while (sweep <= 0) sweep += Math.PI * 2;
    const points = sampleRound(geometry.center, pointDistance(geometry.center, geometry.start), start, sweep, 32);
    return points.slice(0, -1).map((point, index) => [point, points[index + 1]]);
  }
  if (geometry.kind === "rectangle") {
    const corners = [geometry.min, { x_nm: geometry.max.x_nm, y_nm: geometry.min.y_nm }, geometry.max, { x_nm: geometry.min.x_nm, y_nm: geometry.max.y_nm }, geometry.min];
    return corners.slice(0, -1).map((point, index) => [point, corners[index + 1]]);
  }
  if (geometry.kind === "control_point_spline") {
    const points = sampleControlPointSpline(geometry.control_points, 48, geometry.degree, geometry.knots_millionths);
    return points.slice(0, -1).map((point, index) => [point, points[index + 1]]);
  }
  if (geometry.kind === "fit_point_spline") {
    const points = sampleFitPointSpline(geometry.fit_points, 48); return points.slice(0, -1).map((point, index) => [point, points[index + 1]]);
  }
  if (geometry.kind === "conic") {
    const points = sampleConic(geometry.start, geometry.control, geometry.end, geometry.weight_millionths, 48); return points.slice(0, -1).map((point, index) => [point, points[index + 1]]);
  }
  if (geometry.kind === "ellipse") {
    const points = sampleEllipse(geometry.center, geometry.major, geometry.minor, 64); return points.slice(0, -1).map((point, index) => [point, points[index + 1]]);
  }
  if (geometry.kind === "elliptical_arc") {
    const points = sampleEllipticalArc(geometry.center, geometry.major, geometry.minor, geometry.start, geometry.end, geometry.clockwise, 48); return points.slice(0, -1).map((point, index) => [point, points[index + 1]]);
  }
  return [];
}

export function closestPointOnGeometry(point: Point2, geometry: Geometry): Point2 | undefined {
  if (geometry.kind === "line") {
    const dx = geometry.end.x_nm - geometry.start.x_nm; const dy = geometry.end.y_nm - geometry.start.y_nm;
    const lengthSquared = dx * dx + dy * dy;
    if (!lengthSquared) return geometry.start;
    const t = Math.max(0, Math.min(1, ((point.x_nm - geometry.start.x_nm) * dx + (point.y_nm - geometry.start.y_nm) * dy) / lengthSquared));
    return { x_nm: Math.round(geometry.start.x_nm + t * dx), y_nm: Math.round(geometry.start.y_nm + t * dy) };
  }
  if (geometry.kind === "circle" || geometry.kind === "arc") {
    const radius = geometry.kind === "circle" ? geometry.radius_nm : pointDistance(geometry.center, geometry.start);
    const distance = pointDistance(geometry.center, point) || 1;
    const projected = { x_nm: Math.round(geometry.center.x_nm + (point.x_nm - geometry.center.x_nm) * radius / distance), y_nm: Math.round(geometry.center.y_nm + (point.y_nm - geometry.center.y_nm) * radius / distance) };
    if (geometry.kind === "circle" || pointOnArcSweep(projected, geometry)) return projected;
    return pointDistance(point, geometry.start) <= pointDistance(point, geometry.end) ? geometry.start : geometry.end;
  }
  if (["control_point_spline", "fit_point_spline", "ellipse", "elliptical_arc", "conic"].includes(geometry.kind)) return projectPointToGeometryCurve(geometry, point).point;
  if (geometry.kind === "sketch_point") return { x_nm: geometry.x_nm, y_nm: geometry.y_nm };
  return undefined;
}

function pointOnArcSweep(point: Point2, arc: Extract<Geometry, { kind: "arc" }>): boolean {
  const angle = (value: Point2) => Math.atan2(value.y_nm - arc.center.y_nm, value.x_nm - arc.center.x_nm);
  const start = angle(arc.start); const candidate = angle(point); const end = angle(arc.end);
  const turn = (value: number) => ((value % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return arc.clockwise
    ? turn(start - candidate) <= turn(start - end) + 1e-9
    : turn(candidate - start) <= turn(end - start) + 1e-9;
}

function sampleRound(center: Point2, radius: number, start: number, sweep: number, count: number): Point2[] {
  return Array.from({ length: count + 1 }, (_, index) => {
    const angle = start + sweep * index / count;
    return { x_nm: center.x_nm + Math.round(Math.cos(angle) * radius), y_nm: center.y_nm + Math.round(Math.sin(angle) * radius) };
  });
}

function midpoint(a: Point2, b: Point2): Point2 {
  return { x_nm: Math.round((a.x_nm + b.x_nm) / 2), y_nm: Math.round((a.y_nm + b.y_nm) / 2) };
}

function average(points: readonly Point2[]): Point2 | undefined {
  return points.length ? { x_nm: Math.round(points.reduce((sum, point) => sum + point.x_nm, 0) / points.length), y_nm: Math.round(points.reduce((sum, point) => sum + point.y_nm, 0) / points.length) } : undefined;
}

function pointDistance(a: Point2, b: Point2): number { return Math.hypot(a.x_nm - b.x_nm, a.y_nm - b.y_nm); }
function samePoint(a: Point2, b: Point2): boolean { return a.x_nm === b.x_nm && a.y_nm === b.y_nm; }
function pointKey(point: Point2): string | undefined {
  return Number.isNaN(point.x_nm) || Number.isNaN(point.y_nm) ? undefined : `${point.x_nm},${point.y_nm}`;
}
function formatMm(value: number): string { return (value / 1_000_000).toFixed(2).replace(/\.00$/, ""); }
