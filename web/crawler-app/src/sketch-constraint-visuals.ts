import type { Constraint, PointRef, Sketch } from "./sketch-editor.ts";
import { constraintGeometryIds } from "./sketch-render-indexes.ts";
import { evaluateGeometryCurve } from "./sketch-spline.ts";

export type SketchConstraintCoverage = Readonly<{
  geometry: ReadonlySet<string>;
  points: ReadonlySet<string>;
}>;

export type SketchConstraintOperand = Readonly<{
  geometry: string;
  anchor?: PointRef["anchor"];
  role: "point" | "curve" | "origin";
}>;

export type PositionedSketchConstraintOperand = SketchConstraintOperand & Readonly<{
  point: { x_nm: number; y_nm: number };
}>;

export type SketchMobilityKind = "xy" | "x" | "y" | "tangent" | "angular" | "radial" | "none";

export type SketchConstraintVisualState = "driving" | "reference" | "suppressed" | "redundant" | "conflicting" | "dangling" | "unsolvable";

export type SketchConstraintStateContext = Readonly<{
  redundant?: ReadonlySet<string>;
  conflicting?: ReadonlySet<string>;
  solveState?: "under_constrained" | "fully_constrained" | "over_constrained" | "conflicting";
}>;

export type ConstraintGlyphLayoutInput = Readonly<{
  id: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  fixed?: boolean;
}>;

export type ConstraintGlyphPlacement = Readonly<{
  id: string;
  x: number;
  y: number;
  displaced: boolean;
  stackDepth: number;
  clusterIndex: number;
  clusterSize: number;
}>;

const commonStroke = `fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"`;

/**
 * Compact, geometric constraint symbols. These intentionally contain no text:
 * the accessible name carries the relation name while the scene uses the same
 * visual language as the constraint tools.
 */
const CONSTRAINT_ICON_BODIES: Readonly<Record<Constraint["kind"], string>> = {
  coincident: `<circle cx="9" cy="12" r="4" ${commonStroke}/><circle cx="15" cy="12" r="4" ${commonStroke}/><path d="M12 8v8" ${commonStroke}/>` ,
  point_on_origin: `<path d="M12 3v18M3 12h18" ${commonStroke}/><circle cx="12" cy="12" r="3" ${commonStroke}/>` ,
  fixed: `<rect x="6" y="10" width="12" height="10" rx="2" ${commonStroke}/><path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10M12 14v2.5" ${commonStroke}/>` ,
  fixed_geometry: `<rect x="6" y="10" width="12" height="10" rx="2" ${commonStroke}/><path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10M12 14v2.5" ${commonStroke}/>` ,
  midpoint: `<path d="M4 18 12 5l8 13Z" ${commonStroke}/><circle cx="12" cy="12.5" r="1.8" fill="currentColor"/>` ,
  concentric: `<circle cx="12" cy="12" r="7" ${commonStroke}/><circle cx="12" cy="12" r="3" ${commonStroke}/>` ,
  point_on_object: `<path d="M3 15c5-7 11-7 18 0" ${commonStroke}/><circle cx="12" cy="10.5" r="2.4" fill="currentColor"/>` ,
  horizontal: `<path d="M4 12h16M6.5 8.5 3 12l3.5 3.5M17.5 8.5 21 12l-3.5 3.5" ${commonStroke}/>` ,
  vertical: `<path d="M12 4v16M8.5 6.5 12 3l3.5 3.5M8.5 17.5 12 21l3.5-3.5" ${commonStroke}/>` ,
  horizontal_points: `<path d="M5 12h14M7.5 9 4.5 12l3 3M16.5 9l3 3-3 3" ${commonStroke}/><circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/>` ,
  vertical_points: `<path d="M12 5v14M9 7.5l3-3 3 3M9 16.5l3 3 3-3" ${commonStroke}/><circle cx="12" cy="5" r="1.5" fill="currentColor"/><circle cx="12" cy="19" r="1.5" fill="currentColor"/>` ,
  collinear: `<path d="M4 17 20 7" ${commonStroke}/><circle cx="8" cy="14.5" r="2" fill="currentColor"/><circle cx="16" cy="9.5" r="2" fill="currentColor"/>` ,
  symmetry: `<path d="M12 3v18" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2 2"/><path d="m8 8-4 4 4 4m8-8 4 4-4 4" ${commonStroke}/><circle cx="7" cy="12" r="1.7" fill="currentColor"/><circle cx="17" cy="12" r="1.7" fill="currentColor"/>` ,
  curvature_continuous: `<path d="M3 17c5 0 5-10 10-10 3 0 4 2 8 2M10 12l4-4" ${commonStroke}/><circle cx="12.5" cy="9.5" r="1.5" fill="currentColor"/>` ,
  parallel: `<path d="M5 17 11 7M13 17l6-10" ${commonStroke}/>` ,
  perpendicular: `<path d="M5 5v14h14M9 15v-6h6" ${commonStroke}/>` ,
  tangent: `<circle cx="10" cy="10" r="5" ${commonStroke}/><path d="m4 20 16-8" ${commonStroke}/><circle cx="14.2" cy="13" r="1.4" fill="currentColor"/>` ,
  equal: `<path d="M5 9h14M5 15h14" ${commonStroke}/>` ,
  distance: `<path d="M5 7v10m14-10v10M7 12h10m-8-3-3 3 3 3m6-6 3 3-3 3" ${commonStroke}/>` ,
  distance_x: `<path d="M4 7v10m16-10v10M6 12h12m-9-3-3 3 3 3m6-6 3 3-3 3" ${commonStroke}/>` ,
  distance_y: `<path d="M7 4h10M7 20h10M12 6v12m-3-9 3-3 3 3m-6 6 3 3 3-3" ${commonStroke}/>` ,
  point_line_distance: `<path d="M4 18 20 8M8 7l6 9M11 13l3 3 1-4" ${commonStroke}/><circle cx="8" cy="7" r="1.8" fill="currentColor"/>` ,
  line_distance: `<path d="M3 7h18M3 17h18M12 9v6m-3-3 3-3 3 3m-6 0 3 3 3-3" ${commonStroke}/>` ,
  offset_distance: `<path d="M3 8c5-4 13-4 18 0M3 17c5-4 13-4 18 0M12 10v5m-2-3 2-2 2 2m-4 1 2 2 2-2" ${commonStroke}/>` ,
  radius: `<circle cx="11" cy="13" r="7" ${commonStroke}/><path d="m11 13 5-5m-1-1 2 0v2" ${commonStroke}/>` ,
  diameter: `<circle cx="12" cy="12" r="7" ${commonStroke}/><path d="M5.5 15.5 18.5 8.5m-11 4-2 3 3 .5m8-5 2-3-3-.5" ${commonStroke}/>` ,
  ellipse_radius: `<ellipse cx="12" cy="12" rx="8" ry="5" ${commonStroke}/><path d="M12 12h8m-2-2 2 2-2 2" ${commonStroke}/>` ,
  angle: `<path d="M4 18h16M4 18 17 6M10 18a6 6 0 0 0-1.6-4" ${commonStroke}/>` ,
  angle_to_axis: `<path d="M4 18h16M4 18 17 6M10 18a6 6 0 0 0-1.6-4" ${commonStroke}/>` ,
};

export function constraintKindLabel(kind: Constraint["kind"]): string {
  return kind.replaceAll("_", " ").replace(/^./, (value) => value.toUpperCase());
}

export function sketchConstraintIconBody(kind: Constraint["kind"]): string {
  return CONSTRAINT_ICON_BODIES[kind];
}

export function sketchConstraintIcon(kind: Constraint["kind"], className = "sketch-constraint-icon"): string {
  return `<svg class="${className}" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">${sketchConstraintIconBody(kind)}</svg>`;
}

export function constraintPointKey(point: Pick<PointRef, "geometry" | "anchor">): string {
  return `${point.geometry}\u0000${point.anchor}`;
}

export function isDimensionalConstraint(constraint: Constraint): boolean {
  return ["distance", "distance_x", "distance_y", "point_line_distance", "line_distance", "offset_distance", "radius", "diameter", "ellipse_radius", "angle", "angle_to_axis"].includes(constraint.kind);
}

function samePoint(a: PointRef, b: PointRef): boolean {
  return a.geometry === b.geometry && a.anchor === b.anchor;
}

/** Point operands owned by a constraint; target-curve operands are excluded. */
export function constraintPointRefs(constraint: Constraint): readonly PointRef[] {
  switch (constraint.kind) {
    case "coincident": case "horizontal_points": case "vertical_points": case "distance": case "distance_x": case "distance_y":
      return [constraint.a, constraint.b];
    case "point_on_origin": case "fixed": case "midpoint": case "point_on_object": case "collinear": case "point_line_distance":
      return [constraint.point];
    case "symmetry": return [constraint.first, constraint.second];
    default: return [];
  }
}

/** Semantic operands in the order a relation should explain them to a user. */
export function constraintVisualOperands(constraint: Constraint): readonly SketchConstraintOperand[] {
  const point = (value: PointRef): SketchConstraintOperand => ({ geometry: value.geometry, anchor: value.anchor, role: value.geometry === "reference:origin" ? "origin" : "point" });
  const curve = (geometry: string): SketchConstraintOperand => ({ geometry, role: "curve" });
  switch (constraint.kind) {
    case "coincident": case "horizontal_points": case "vertical_points": case "distance": case "distance_x": case "distance_y":
      return [point(constraint.a), point(constraint.b)];
    case "point_on_origin": return [point(constraint.point), { geometry: "reference:origin", anchor: "center", role: "origin" }];
    case "fixed": return [point(constraint.point)];
    case "fixed_geometry": return [curve(constraint.geometry)];
    case "midpoint": return [point(constraint.point), curve(constraint.line)];
    case "point_on_object": return [point(constraint.point), curve(constraint.geometry)];
    case "horizontal": case "vertical": case "angle_to_axis": return [curve(constraint.line)];
    case "collinear": case "point_line_distance": return [point(constraint.point), curve(constraint.line)];
    case "symmetry": return [point(constraint.first), point(constraint.second), curve(constraint.axis)];
    case "concentric": case "curvature_continuous": case "parallel": case "perpendicular": case "tangent": case "equal": case "line_distance": case "angle":
      return [curve(constraint.first), curve(constraint.second)];
    case "offset_distance": return [curve(constraint.source), curve(constraint.offset)];
    case "radius": case "diameter": case "ellipse_radius": return [curve(constraint.geometry)];
  }
}

function pointForOperand(sketch: Sketch, operand: SketchConstraintOperand): { x_nm: number; y_nm: number } | undefined {
  if (operand.role === "origin") return { x_nm: 0, y_nm: 0 };
  const geometry = sketch.geometry[operand.geometry]?.geometry;
  if (!geometry) return undefined;
  if (operand.anchor) {
    if (geometry.kind === "line" && (operand.anchor === "start" || operand.anchor === "end")) return geometry[operand.anchor];
    if ((geometry.kind === "circle" || geometry.kind === "arc") && operand.anchor === "center") return geometry.center;
    if (geometry.kind === "arc" && (operand.anchor === "start" || operand.anchor === "end")) return geometry[operand.anchor];
    if (geometry.kind === "control_point_spline") {
      const match = /^control:(\d+)$/.exec(operand.anchor);
      if (match) return geometry.control_points[Number(match[1])];
    }
    if (geometry.kind === "fit_point_spline") {
      const match = /^fit:(\d+)$/.exec(operand.anchor);
      if (match) return geometry.fit_points[Number(match[1])];
    }
    if ((geometry.kind === "ellipse" || geometry.kind === "elliptical_arc") && ["center", "major", "minor", "start", "end"].includes(operand.anchor)) {
      const value = geometry as Extract<typeof geometry, { kind: "elliptical_arc" }>;
      const candidate = value[operand.anchor as "center" | "major" | "minor" | "start" | "end"];
      if (candidate) return candidate;
    }
    if (geometry.kind === "conic" && (operand.anchor === "start" || operand.anchor === "control" || operand.anchor === "end")) return geometry[operand.anchor];
    if (geometry.kind === "sketch_point" && operand.anchor === "position") return { x_nm: geometry.x_nm, y_nm: geometry.y_nm };
    if (geometry.kind === "rectangle" && (operand.anchor === "min" || operand.anchor === "max")) return geometry[operand.anchor];
    const parameter = /^parameter:(\d+)$/.exec(operand.anchor);
    if (parameter) return evaluateGeometryCurve(geometry, Number(parameter[1]) / 1_000_000);
  }
  if (geometry.kind === "sketch_point") return { x_nm: geometry.x_nm, y_nm: geometry.y_nm };
  if (geometry.kind === "rectangle") return { x_nm: Math.round((geometry.min.x_nm + geometry.max.x_nm) / 2), y_nm: Math.round((geometry.min.y_nm + geometry.max.y_nm) / 2) };
  return evaluateGeometryCurve(geometry, .5);
}

export function positionedConstraintVisualOperands(sketch: Sketch, constraint: Constraint): readonly PositionedSketchConstraintOperand[] {
  return constraintVisualOperands(constraint).flatMap((operand) => {
    const point = pointForOperand(sketch, operand);
    return point ? [{ ...operand, point }] : [];
  });
}

/** One authoritative visual state used by canvas glyphs and both inspectors. */
export function sketchConstraintVisualState(sketch: Sketch, id: string, context: SketchConstraintStateContext = {}): SketchConstraintVisualState {
  const constraint = sketch.constraints[id];
  if (!constraint) return "dangling";
  if ((sketch.suppressed_constraints ?? []).includes(id)) return isDimensionalConstraint(constraint) ? "reference" : "suppressed";
  if (positionedConstraintVisualOperands(sketch, constraint).length !== constraintVisualOperands(constraint).length) return "dangling";
  if (context.conflicting?.has(id)) return "conflicting";
  if (context.redundant?.has(id)) return "redundant";
  if (context.solveState === "conflicting" || context.solveState === "over_constrained") return "unsolvable";
  return "driving";
}

/**
 * A local drag-direction hint for a visible point handle. This describes the
 * freedom of the selected section relative to its direct relations; component
 * solver DOF remains authoritative for whether the hint is shown at all.
 */
export function sketchPointMobility(sketch: Sketch, ref: PointRef): SketchMobilityKind {
  const suppressed = new Set(sketch.suppressed_constraints ?? []);
  let xFree = true; let yFree = true; let curved: SketchMobilityKind | undefined;
  for (const [id, constraint] of Object.entries(sketch.constraints)) {
    if (suppressed.has(id)) continue;
    if (constraint.kind === "fixed_geometry" && constraint.geometry === ref.geometry) return "none";
    const operands = constraintPointRefs(constraint);
    if (!operands.some((operand) => samePoint(operand, ref))) continue;
    switch (constraint.kind) {
      case "fixed": case "point_on_origin": case "coincident": case "midpoint": case "symmetry":
        return "none";
      case "horizontal_points": case "distance_y": yFree = false; break;
      case "vertical_points": case "distance_x": xFree = false; break;
      case "point_on_object": case "collinear": case "point_line_distance": case "distance": curved = "tangent"; break;
      default: break;
    }
  }
  if (!xFree && !yFree) return "none";
  if (curved) return curved;
  const geometry = sketch.geometry[ref.geometry]?.geometry;
  if (geometry?.kind === "line" && (ref.anchor === "start" || ref.anchor === "end")) {
    const geometryConstraints = Object.entries(sketch.constraints).filter(([id, constraint]) => !suppressed.has(id) && constraintGeometryIds(constraint).includes(ref.geometry)).map(([, constraint]) => constraint);
    if (geometryConstraints.some((constraint) => constraint.kind === "horizontal")) return "x";
    if (geometryConstraints.some((constraint) => constraint.kind === "vertical")) return "y";
    if (geometryConstraints.some((constraint) => constraint.kind === "angle_to_axis")) return "tangent";
  }
  if (geometry?.kind === "arc" && (ref.anchor === "start" || ref.anchor === "end")) {
    const radiusLocked = Object.entries(sketch.constraints).some(([id, constraint]) => !suppressed.has(id) && (constraint.kind === "radius" || constraint.kind === "diameter") && constraint.geometry === ref.geometry);
    if (radiusLocked) return "angular";
  }
  if (!xFree) return "y";
  if (!yFree) return "x";
  return "xy";
}

function boxesOverlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  const gap = 3;
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
}

/** Deterministic, screen-space glyph layout with fixed dimension obstacles. */
export function layoutConstraintGlyphs(
  inputs: readonly ConstraintGlyphLayoutInput[],
  viewport: Readonly<{ width: number; height: number }>,
): readonly ConstraintGlyphPlacement[] {
  const occupied: Array<{ x: number; y: number; width: number; height: number }> = [];
  const placements = new Map<string, ConstraintGlyphPlacement>();
  const clusters = new Map<string, string[]>();
  for (const input of inputs) {
    if (input.fixed) continue;
    const key = `${Math.round(input.x / 12)}:${Math.round(input.y / 12)}`;
    const cluster = clusters.get(key) ?? [];
    cluster.push(input.id); clusters.set(key, cluster);
  }
  const clusterById = new Map([...clusters.values()].flatMap((cluster) => cluster.sort().map((id, index) => [id, { index, size: cluster.length }] as const)));
  const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));
  const candidates = [
    [0, 0], [32, 0], [-32, 0], [0, 32], [0, -32], [32, 32], [-32, 32], [32, -32], [-32, -32],
    [64, 0], [-64, 0], [0, 64], [0, -64], [64, 32], [-64, 32], [64, -32], [-64, -32],
  ] as const;
  const ordered = [...inputs].sort((a, b) => Number(Boolean(b.fixed)) - Number(Boolean(a.fixed)) || a.id.localeCompare(b.id));
  for (const input of ordered) {
    const width = input.width ?? 28; const height = input.height ?? 28;
    if (input.fixed) {
      const box = { x: clamp(input.x, 2, Math.max(2, viewport.width - width - 2)), y: clamp(input.y, 2, Math.max(2, viewport.height - height - 2)), width, height };
      occupied.push(box);
      continue;
    }
    let chosen: { x: number; y: number; width: number; height: number } | undefined;
    let stackDepth = 0;
    for (const [dx, dy] of candidates) {
      const box = { x: clamp(input.x + dx, 2, Math.max(2, viewport.width - width - 2)), y: clamp(input.y + dy, 2, Math.max(2, viewport.height - height - 2)), width, height };
      if (!occupied.some((candidate) => boxesOverlap(box, candidate))) { chosen = box; break; }
      stackDepth += 1;
    }
    if (!chosen) {
      const offset = (stackDepth % 4) * 4;
      chosen = { x: clamp(input.x + offset, 2, Math.max(2, viewport.width - width - 2)), y: clamp(input.y - offset, 2, Math.max(2, viewport.height - height - 2)), width, height };
    }
    occupied.push(chosen);
    const cluster = clusterById.get(input.id) ?? { index: 0, size: 1 };
    placements.set(input.id, { id: input.id, x: chosen.x, y: chosen.y, displaced: Math.abs(chosen.x - input.x) > .5 || Math.abs(chosen.y - input.y) > .5, stackDepth, clusterIndex: cluster.index, clusterSize: cluster.size });
  }
  return inputs.flatMap((input) => placements.get(input.id) ?? []);
}

/**
 * Constraint targets currently relevant to a viewport selection. Selecting an
 * endpoint is deliberately narrower than selecting its parent curve.
 */
export function selectedConstraintIds(
  sketch: Pick<Sketch, "constraints">,
  selectedGeometry: readonly string[],
  selectedPoints: readonly PointRef[],
  selectedConstraint?: string,
): ReadonlySet<string> {
  const selectedPointParents = new Set(selectedPoints.map((point) => point.geometry));
  const wholeGeometry = new Set(selectedGeometry.filter((id) => !selectedPointParents.has(id)));
  const ids = new Set(selectedConstraint ? [selectedConstraint] : []);
  for (const [id, constraint] of Object.entries(sketch.constraints)) {
    if (constraintPointRefs(constraint).some((operand) => selectedPoints.some((point) => samePoint(operand, point)))) ids.add(id);
    if (constraintGeometryIds(constraint).some((geometry) => wholeGeometry.has(geometry))) ids.add(id);
    if (constraint.kind === "fixed_geometry" && selectedPoints.some((point) => point.geometry === constraint.geometry)) ids.add(id);
  }
  return ids;
}

/**
 * Relations that belong on the sketch canvas. Explicit dimensions remain
 * visible as persistent sketch documentation, while geometric relation glyphs
 * continue to follow the focused selection to keep dense sketches readable.
 */
export function visibleConstraintIds(
  sketch: Pick<Sketch, "constraints">,
  selectedGeometry: readonly string[],
  selectedPoints: readonly PointRef[],
  selectedConstraint?: string,
): ReadonlySet<string> {
  const ids = new Set(selectedConstraintIds(sketch, selectedGeometry, selectedPoints, selectedConstraint));
  for (const [id, constraint] of Object.entries(sketch.constraints)) {
    if (isDimensionalConstraint(constraint)) ids.add(id);
  }
  return ids;
}

function geometryAnchors(sketch: Sketch, geometryId: string): readonly string[] {
  const geometry = sketch.geometry[geometryId]?.geometry;
  if (!geometry) return [];
  if (geometry.kind === "line") return ["start", "end"];
  if (geometry.kind === "circle") return ["center"];
  if (geometry.kind === "arc") return ["center", "start", "end"];
  if (geometry.kind === "control_point_spline") return geometry.control_points.map((_, index) => `control:${index}`);
  if (geometry.kind === "fit_point_spline") return geometry.fit_points.map((_, index) => `fit:${index}`);
  if (geometry.kind === "ellipse") return ["center", "major", "minor"];
  if (geometry.kind === "elliptical_arc") return ["center", "major", "minor", "start", "end"];
  if (geometry.kind === "conic") return ["start", "control", "end"];
  if (geometry.kind === "sketch_point") return ["position"];
  return ["min", "max"];
}

/**
 * Resolve which independently visible curve bodies and point handles are
 * direct targets of active constraints. This is intentionally not component
 * DOF state: a diameter constrains an arc body, not its start/end handles.
 */
export function sketchConstraintCoverage(sketch: Sketch): SketchConstraintCoverage {
  const geometry = new Set<string>();
  const points = new Set<string>();
  const suppressed = new Set(sketch.suppressed_constraints ?? []);
  const markPoint = (point: PointRef) => points.add(constraintPointKey(point));
  const markGeometry = (...ids: string[]) => ids.forEach((id) => geometry.add(id));
  for (const [id, constraint] of Object.entries(sketch.constraints)) {
    if (suppressed.has(id)) continue;
    constraintPointRefs(constraint).forEach(markPoint);
    switch (constraint.kind) {
      case "fixed_geometry":
        markGeometry(constraint.geometry);
        geometryAnchors(sketch, constraint.geometry).forEach((anchor) => points.add(`${constraint.geometry}\u0000${anchor}`));
        break;
      case "horizontal": case "vertical": case "angle_to_axis": markGeometry(constraint.line); break;
      case "concentric": case "curvature_continuous": case "parallel": case "perpendicular": case "tangent": case "equal": case "line_distance": case "angle":
        markGeometry(constraint.first, constraint.second); break;
      case "offset_distance": markGeometry(constraint.source, constraint.offset); break;
      case "radius": case "diameter": case "ellipse_radius": markGeometry(constraint.geometry); break;
      case "point_line_distance": markGeometry(constraint.line); break;
      default: break;
    }
  }
  return { geometry, points };
}
