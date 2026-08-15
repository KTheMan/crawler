import type { ConstraintTool, Geometry, GeometryEntity, Point2, PointRef, Sketch, SketchTool } from "./sketch-editor";
import { evaluateGeometryCurve } from "./sketch-spline.ts";

export type SketchCommandFamily = "draw" | "modify" | "constraint" | "dimension" | "modifier" | "project";
export type SketchPointerBadge = "draw" | "trim" | "modify" | "constraint" | "dimension" | "project";

export type SketchSelectionSummary = {
  geometry: number;
  points: number;
  lines: number;
  round: number;
  circles: number;
  arcs: number;
  ellipses: number;
  parallelLines: boolean;
  measurable: number;
  curves: number;
  tangentCompatible: boolean;
  curveParameters: number;
  ellipseAxis?: "major" | "minor";
  pointAlignment?: "horizontal" | "vertical" | "aligned";
  retainedOffsetId?: string;
  curvatureCompatible?: number;
  origin: boolean;
  external: number;
  construction: number;
  splines: number;
  /** Geometry selected only because one of its point handles is selected. */
  pointSourceGeometry: number;
  /** Explicitly selected geometry, excluding the owners of selected point handles. */
  targetGeometry: number;
  targetLines: number;
  targetSplines: number;
};

export type SketchToolContract = {
  family: SketchCommandFamily;
  repeatable: boolean;
  points: number;
  pointer: SketchPointerBadge;
  completion: "automatic" | "confirm" | "placement" | "modifier";
  prompt: string;
  selection?: (selection: SketchSelectionSummary) => string | undefined;
  compatibility?: (selection: SketchSelectionSummary) => string | undefined;
};

const requireGeometry = (selection: SketchSelectionSummary) => selection.geometry ? undefined : "Select sketch geometry first";
const requireLines = (count: number, label: string) => (selection: SketchSelectionSummary) =>
  selection.lines === count && selection.geometry === count ? undefined : `Select ${count === 1 ? "one line" : `${count} lines`} for ${label}`;
const requireAtLeastOneLine = (label: string) => (selection: SketchSelectionSummary) =>
  selection.lines > 0 && selection.lines === selection.geometry ? undefined : `Select line geometry for ${label}`;

export const SKETCH_TOOL_MANIFEST: Record<SketchTool, SketchToolContract> = {
  line: { family: "draw", repeatable: true, points: 2, pointer: "draw", completion: "automatic", prompt: "Set the first point of a connected line chain" },
  circle: { family: "draw", repeatable: true, points: 2, pointer: "draw", completion: "automatic", prompt: "Set the circle center" },
  arc: { family: "draw", repeatable: true, points: 3, pointer: "draw", completion: "automatic", prompt: "Set the arc center" },
  rectangle: { family: "draw", repeatable: true, points: 2, pointer: "draw", completion: "automatic", prompt: "Set the first rectangle corner" },
  spline: { family: "draw", repeatable: true, points: 4, pointer: "draw", completion: "automatic", prompt: "Set spline control points" },
  fit_spline: { family: "draw", repeatable: true, points: 4, pointer: "draw", completion: "automatic", prompt: "Set four interpolation points" },
  polygon: { family: "draw", repeatable: true, points: 2, pointer: "draw", completion: "automatic", prompt: "Set polygon center and radius" },
  slot: { family: "draw", repeatable: true, points: 3, pointer: "draw", completion: "automatic", prompt: "Set slot endpoints and width" },
  ellipse: { family: "draw", repeatable: true, points: 3, pointer: "draw", completion: "automatic", prompt: "Set ellipse center and axes" },
  elliptical_arc: { family: "draw", repeatable: true, points: 5, pointer: "draw", completion: "automatic", prompt: "Set ellipse center, axes, start, and end" },
  conic: { family: "draw", repeatable: true, points: 3, pointer: "draw", completion: "automatic", prompt: "Set conic start, control, and end points" },
  point: { family: "draw", repeatable: true, points: 1, pointer: "draw", completion: "automatic", prompt: "Place a native sketch point" },
  text: { family: "draw", repeatable: true, points: 1, pointer: "draw", completion: "automatic", prompt: "Set the sketch text origin" },
  trim: { family: "modify", repeatable: true, points: 1, pointer: "trim", completion: "confirm", prompt: "Hover a removable segment, then click to trim", selection: requireGeometry },
  construction: { family: "modifier", repeatable: true, points: 0, pointer: "draw", completion: "modifier", prompt: "Toggle construction creation or convert the selection" },
  project: { family: "project", repeatable: true, points: 0, pointer: "project", completion: "confirm", prompt: "Select one projectable model edge" },
  offset: { family: "modify", repeatable: true, points: 0, pointer: "modify", completion: "confirm", prompt: "Select curves, preview, then confirm", selection: requireGeometry },
  extend: { family: "modify", repeatable: true, points: 0, pointer: "modify", completion: "confirm", prompt: "Select line geometry to extend", selection: requireAtLeastOneLine("extend") },
  sketch_fillet: { family: "modify", repeatable: true, points: 0, pointer: "modify", completion: "confirm", prompt: "Select two intersecting lines", selection: requireLines(2, "fillet") },
  sketch_chamfer: { family: "modify", repeatable: true, points: 0, pointer: "modify", completion: "confirm", prompt: "Select two intersecting lines", selection: requireLines(2, "chamfer") },
  sketch_mirror: { family: "modify", repeatable: true, points: 0, pointer: "modify", completion: "confirm", prompt: "Select geometry to mirror", selection: requireGeometry },
  sketch_linear_pattern: { family: "modify", repeatable: true, points: 0, pointer: "modify", completion: "confirm", prompt: "Select geometry for a linear pattern", selection: requireGeometry },
  sketch_circular_pattern: { family: "modify", repeatable: true, points: 0, pointer: "modify", completion: "confirm", prompt: "Select geometry for a circular pattern", selection: requireGeometry },
  sketch_break: { family: "modify", repeatable: true, points: 0, pointer: "modify", completion: "confirm", prompt: "Select one curve and place one or more break points", selection: (s) => s.geometry === 1 && s.curves === 1 ? undefined : "Select one breakable curve" },
  sketch_scale: { family: "modify", repeatable: true, points: 0, pointer: "modify", completion: "confirm", prompt: "Select geometry, center, and scale factor", selection: requireGeometry },
  sketch_move_copy: { family: "modify", repeatable: true, points: 0, pointer: "modify", completion: "confirm", prompt: "Select geometry and set the translation", selection: requireGeometry },
  sketch_blend: { family: "modify", repeatable: true, points: 0, pointer: "modify", completion: "confirm", prompt: "Select two open curves for tangent or G2 blend", selection: (s) => s.curves === 2 && s.geometry === 2 ? undefined : "Select two open curves" },
};

export const SKETCH_CONSTRAINT_MANIFEST: Record<ConstraintTool, SketchToolContract> = {
  coincident: { family: "constraint", repeatable: true, points: 0, pointer: "constraint", completion: "automatic", prompt: "Select two points", selection: (s) => s.points >= 2 || (s.points >= 1 && s.origin) ? undefined : "Select two points, or one point and the origin", compatibility: (s) => s.points <= 2 && s.targetGeometry === 0 ? undefined : "Select only two points, or one point and the origin" },
  horizontal: { family: "constraint", repeatable: true, points: 0, pointer: "constraint", completion: "automatic", prompt: "Select one line or two points", selection: (s) => s.points === 2 || (s.points === 0 && s.lines === 1 && s.geometry === 1) ? undefined : "Select one line or two points" },
  vertical: { family: "constraint", repeatable: true, points: 0, pointer: "constraint", completion: "automatic", prompt: "Select one line or two points", selection: (s) => s.points === 2 || (s.points === 0 && s.lines === 1 && s.geometry === 1) ? undefined : "Select one line or two points" },
  parallel: { family: "constraint", repeatable: true, points: 0, pointer: "constraint", completion: "automatic", prompt: "Select two lines", selection: requireLines(2, "parallel") },
  perpendicular: { family: "constraint", repeatable: true, points: 0, pointer: "constraint", completion: "automatic", prompt: "Select two lines", selection: requireLines(2, "perpendicular") },
  tangent: { family: "constraint", repeatable: true, points: 0, pointer: "constraint", completion: "automatic", prompt: "Select two compatible curves", selection: (s) => s.curves === 2 && s.geometry === 2 && s.tangentCompatible ? undefined : "Select a line and curve, or two non-line curves" },
  equal: { family: "constraint", repeatable: true, points: 0, pointer: "constraint", completion: "automatic", prompt: "Select two compatible curves", selection: (s) => s.measurable === 2 && s.geometry === 2 ? undefined : "Select two compatible lines, arcs, or circles" },
  fixed: { family: "constraint", repeatable: true, points: 0, pointer: "constraint", completion: "automatic", prompt: "Select one point or object", selection: (s) => s.points === 1 || (s.points === 0 && s.geometry === 1) ? undefined : "Select one sketch point or object" },
  midpoint: { family: "constraint", repeatable: true, points: 0, pointer: "constraint", completion: "automatic", prompt: "Select a point or the origin and a line", selection: (s) => (s.points === 1 || s.origin) && s.targetLines === 1 && s.targetGeometry === 1 ? undefined : "Select one point or the origin and one target line", compatibility: (s) => s.points <= 1 && !(s.points && s.origin) && s.targetLines <= 1 && s.targetGeometry === s.targetLines ? undefined : "Select only one point or the origin and one target line" },
  concentric: { family: "constraint", repeatable: true, points: 0, pointer: "constraint", completion: "automatic", prompt: "Select two circles or arcs", selection: (s) => s.round === 2 && s.geometry === 2 ? undefined : "Select two circles or arcs" },
  point_on_object: { family: "constraint", repeatable: true, points: 0, pointer: "constraint", completion: "automatic", prompt: "Select a point or the origin and a curve", selection: (s) => (s.points === 1 || s.origin) && s.targetGeometry === 1 ? undefined : "Select one point or the origin and one target curve", compatibility: (s) => s.points <= 1 && !(s.points && s.origin) && s.targetGeometry <= 1 ? undefined : "Select only one point or the origin and one target curve" },
  collinear: { family: "constraint", repeatable: true, points: 0, pointer: "constraint", completion: "automatic", prompt: "Select a point and a line", selection: (s) => (s.points === 1 || s.origin) && s.targetLines === 1 ? undefined : "Select one point and one line" },
  symmetry: { family: "constraint", repeatable: true, points: 0, pointer: "constraint", completion: "automatic", prompt: "Select two points and an axis line", selection: (s) => s.points === 2 && s.targetLines === 1 ? undefined : "Select two points and one axis line" },
  curvature_continuous: { family: "constraint", repeatable: true, points: 0, pointer: "constraint", completion: "automatic", prompt: "Select two open curves", selection: (s) => s.curvatureCompatible === 2 && s.geometry === 2 ? undefined : "Select two lines, splines, or conics with compatible endpoints", compatibility: (s) => s.geometry <= 2 && (s.curvatureCompatible ?? 0) === s.geometry ? undefined : "Curvature continuity supports only lines, splines, and conics" },
  distance: { family: "dimension", repeatable: true, points: 0, pointer: "dimension", completion: "placement", prompt: "Select a line or two points", selection: (s) => s.points >= 2 || (s.origin && s.points === 1) || (s.points === 0 && s.lines === 1 && s.geometry === 1) ? undefined : "Select one line or two points", compatibility: (s) => s.points > 0 ? (s.points + Number(s.origin) <= 2 && s.targetGeometry === 0 ? undefined : "Select only two points") : (s.geometry <= 1 && s.lines === s.geometry ? undefined : "Select one line or two points") },
  distance_x: { family: "dimension", repeatable: true, points: 0, pointer: "dimension", completion: "placement", prompt: "Select two points for horizontal distance", selection: (s) => s.points === 2 ? undefined : "Select two points" },
  distance_y: { family: "dimension", repeatable: true, points: 0, pointer: "dimension", completion: "placement", prompt: "Select two points for vertical distance", selection: (s) => s.points === 2 ? undefined : "Select two points" },
  point_line_distance: { family: "dimension", repeatable: true, points: 0, pointer: "dimension", completion: "placement", prompt: "Select a point and line", selection: (s) => (s.points === 1 || s.origin) && s.targetLines === 1 ? undefined : "Select a point and line" },
  line_distance: { family: "dimension", repeatable: true, points: 0, pointer: "dimension", completion: "placement", prompt: "Select two parallel lines", selection: (s) => s.lines === 2 && s.parallelLines ? undefined : "Select two parallel lines" },
  offset_distance: { family: "dimension", repeatable: true, points: 0, pointer: "dimension", completion: "placement", prompt: "Select a retained offset pair", selection: (s) => s.retainedOffsetId ? undefined : "Select source and retained offset geometry" },
  radius: { family: "dimension", repeatable: true, points: 0, pointer: "dimension", completion: "placement", prompt: "Select one circle or arc", selection: (s) => s.round === 1 && s.geometry === 1 ? undefined : "Select one circle or arc" },
  diameter: { family: "dimension", repeatable: true, points: 0, pointer: "dimension", completion: "placement", prompt: "Select one circle or arc", selection: (s) => s.round === 1 && s.geometry === 1 ? undefined : "Select one circle or arc" },
  ellipse_radius: { family: "dimension", repeatable: true, points: 0, pointer: "dimension", completion: "placement", prompt: "Select an ellipse axis", selection: (s) => s.ellipses === 1 && s.geometry === 1 ? undefined : "Select one ellipse" },
  angle: { family: "dimension", repeatable: true, points: 0, pointer: "dimension", completion: "placement", prompt: "Select two nonparallel lines", selection: requireLines(2, "angle") },
};

export function summarizeSketchSelection(sketch: Sketch | undefined, geometryIds: readonly string[], pointSelection: number | readonly PointRef[], origin: boolean): SketchSelectionSummary {
  const entities = geometryIds.flatMap((id) => sketch?.geometry[id] ?? []);
  const points = typeof pointSelection === "number" ? pointSelection : pointSelection.length;
  const pointGeometryIds = new Set(typeof pointSelection === "number" ? [] : pointSelection.map((point) => point.geometry));
  const targets = entities.filter((entity) => !pointGeometryIds.has(entity.id));
  const pointRefs = typeof pointSelection === "number" ? [] : pointSelection;
  const selectedGeometryIds = new Set(entities.map((entity) => entity.id));
  const retainedOffsetId = Object.entries(sketch?.constraints ?? {}).find(([, constraint]) =>
    constraint.kind === "offset_distance"
      && selectedGeometryIds.has(constraint.source)
      && selectedGeometryIds.has(constraint.offset))?.[0];
  const ellipseAxis = [...pointRefs].reverse().find((point) => point.anchor === "major" || point.anchor === "minor")?.anchor as "major" | "minor" | undefined;
  const selectedPoints = pointRefs.flatMap((reference) => sketch ? selectionPoint(sketch, reference) ?? [] : []);
  if (origin) selectedPoints.unshift({ x_nm: 0, y_nm: 0 });
  const lineEntities = entities.filter((entity) => entity.geometry.kind === "line");
  const dimensionPoints = selectedPoints.length === 2
    ? selectedPoints
    : points === 0 && !origin && entities.length === 1 && lineEntities.length === 1
      ? [
        (lineEntities[0].geometry as Extract<Geometry, { kind: "line" }>).start,
        (lineEntities[0].geometry as Extract<Geometry, { kind: "line" }>).end,
      ]
      : [];
  const pointAlignment = dimensionPoints.length === 2
    ? dimensionPoints[0].y_nm === dimensionPoints[1].y_nm ? "horizontal"
      : dimensionPoints[0].x_nm === dimensionPoints[1].x_nm ? "vertical"
        : "aligned"
    : undefined;
  const parallelLines = lineEntities.length === 2 && (() => {
    const [a, b] = lineEntities.map((entity) => entity.geometry as Extract<typeof entity.geometry, { kind: "line" }>);
    const adx = a.end.x_nm - a.start.x_nm; const ady = a.end.y_nm - a.start.y_nm; const bdx = b.end.x_nm - b.start.x_nm; const bdy = b.end.y_nm - b.start.y_nm;
    return Math.abs(adx * bdy - ady * bdx) <= Math.max(1, Math.hypot(adx, ady) * Math.hypot(bdx, bdy) * 1e-6);
  })();
  return {
    geometry: entities.length,
    points,
    lines: entities.filter((entity) => entity.geometry.kind === "line").length,
    round: entities.filter((entity) => entity.geometry.kind === "circle" || entity.geometry.kind === "arc").length,
    circles: entities.filter((entity) => entity.geometry.kind === "circle").length,
    arcs: entities.filter((entity) => entity.geometry.kind === "arc").length,
    ellipses: entities.filter((entity) => entity.geometry.kind === "ellipse" || entity.geometry.kind === "elliptical_arc").length,
    parallelLines,
    measurable: entities.filter((entity) => entity.geometry.kind === "line" || entity.geometry.kind === "circle" || entity.geometry.kind === "arc").length,
    curves: entities.filter((entity) => !["rectangle", "sketch_point"].includes(entity.geometry.kind)).length,
    tangentCompatible: entities.length !== 2 || !entities.every((entity) => entity.geometry.kind === "line"),
    curveParameters: pointRefs.filter((point) => point.anchor.startsWith("parameter:")).length,
    ellipseAxis,
    pointAlignment,
    retainedOffsetId,
    curvatureCompatible: entities.filter((entity) => ["line", "control_point_spline", "fit_point_spline", "conic"].includes(entity.geometry.kind)).length,
    origin,
    external: entities.filter((entity) => entity.id.startsWith("external:")).length,
    construction: entities.filter((entity) => entity.construction).length,
    splines: entities.filter((entity) => ["control_point_spline", "fit_point_spline", "ellipse", "elliptical_arc", "conic", "sketch_point"].includes(entity.geometry.kind)).length,
    pointSourceGeometry: entities.filter((entity) => pointGeometryIds.has(entity.id)).length,
    targetGeometry: targets.length,
    targetLines: targets.filter((entity) => entity.geometry.kind === "line").length,
    targetSplines: targets.filter((entity) => ["control_point_spline", "fit_point_spline", "ellipse", "elliptical_arc", "conic", "sketch_point"].includes(entity.geometry.kind)).length,
  };
}

export function toolDisabledReason(tool: SketchTool, selection: SketchSelectionSummary): string | undefined {
  return SKETCH_TOOL_MANIFEST[tool].selection?.(selection);
}

export function constraintDisabledReason(tool: ConstraintTool, selection: SketchSelectionSummary): string | undefined {
  const compatibility = SKETCH_CONSTRAINT_MANIFEST[tool].compatibility;
  return compatibility ? compatibility(selection) : defaultConstraintCompatibility(tool, selection);
}

function defaultConstraintCompatibility(tool: ConstraintTool, selection: SketchSelectionSummary): string | undefined {
  if (selection.geometry === 0 && selection.points === 0 && !selection.origin) return undefined;
  if (tool === "horizontal" || tool === "vertical") return selection.points === 2 || (selection.points === 0 && selection.geometry <= 1 && selection.lines === selection.geometry) ? undefined : "Select only one line or two points";
  if (tool === "parallel" || tool === "perpendicular" || tool === "angle") return selection.points === 0 && selection.geometry <= 2 && selection.lines === selection.geometry ? undefined : "Select only two lines";
  if (tool === "tangent") return selection.points === 0 && selection.geometry <= 2 && selection.curves === selection.geometry && selection.tangentCompatible ? undefined : "Select a line and curve, or two non-line curves";
  if (tool === "equal") return selection.points === 0 && selection.geometry <= 2 && selection.measurable === selection.geometry ? undefined : "Select only two compatible lines, arcs, or circles";
  if (tool === "fixed") return !selection.origin && ((selection.points <= 1 && selection.targetGeometry === 0) || (selection.points === 0 && selection.geometry <= 1)) ? undefined : "Select one movable sketch point or object";
  if (tool === "concentric") return selection.points === 0 && selection.geometry <= 2 && selection.round === selection.geometry ? undefined : "Select only two circles or arcs";
  if (tool === "radius") return selection.points === 0 && selection.geometry <= 1 && selection.round === selection.geometry ? undefined : "Select one circle or arc";
  return SKETCH_CONSTRAINT_MANIFEST[tool].selection?.(selection);
}

export function smartDimensionKind(selection: SketchSelectionSummary): ConstraintTool | undefined {
  if (selection.retainedOffsetId) return "offset_distance";
  if (selection.ellipses === 1 && selection.ellipseAxis) return "ellipse_radius";
  if ((selection.origin && selection.points >= 1) || selection.points >= 2 || selection.curveParameters >= 2) {
    if (selection.pointAlignment === "horizontal") return "distance_x";
    if (selection.pointAlignment === "vertical") return "distance_y";
    return "distance";
  }
  if ((selection.points === 1 || selection.origin) && selection.targetLines === 1) return "point_line_distance";
  if (selection.points > 0) return undefined;
  if (selection.geometry === 1 && selection.lines === 1) {
    if (selection.pointAlignment === "horizontal") return "distance_x";
    if (selection.pointAlignment === "vertical") return "distance_y";
    return "distance";
  }
  if (selection.geometry === 1 && selection.circles === 1) return "diameter";
  if (selection.geometry === 1 && selection.arcs === 1) return "radius";
  if (selection.geometry === 1 && selection.ellipses === 1) return "ellipse_radius";
  if (selection.geometry === 2 && selection.lines === 2) return selection.parallelLines ? "line_distance" : "angle";
  return undefined;
}

/**
 * Chooses the linear dimension represented by a cursor location around a line.
 * The three snap sectors mirror CAD smart-dimension placement: above/below the
 * segment measures X, left/right measures Y, and the segment normal measures
 * its aligned length.
 */
export function smartDimensionLinePlacementMode(
  line: Extract<Geometry, { kind: "line" }>,
  cursor: Point2,
): "distance" | "distance_x" | "distance_y" {
  const dx = line.end.x_nm - line.start.x_nm;
  const dy = line.end.y_nm - line.start.y_nm;
  const length = Math.hypot(dx, dy);
  if (length === 0) return "distance";
  const axisTolerance = Math.max(1, length * 1e-6);
  if (Math.abs(dy) <= axisTolerance) return "distance_x";
  if (Math.abs(dx) <= axisTolerance) return "distance_y";

  const fromMidpointX = cursor.x_nm - (line.start.x_nm + line.end.x_nm) / 2;
  const fromMidpointY = cursor.y_nm - (line.start.y_nm + line.end.y_nm) / 2;
  const cursorDistance = Math.hypot(fromMidpointX, fromMidpointY);
  if (cursorDistance <= axisTolerance) return "distance";

  const horizontalScore = Math.abs(fromMidpointY) / cursorDistance;
  const verticalScore = Math.abs(fromMidpointX) / cursorDistance;
  const alignedScore = Math.abs(fromMidpointX * -dy + fromMidpointY * dx) / (cursorDistance * length);
  if (alignedScore >= horizontalScore && alignedScore >= verticalScore) return "distance";
  return horizontalScore >= verticalScore ? "distance_x" : "distance_y";
}

function selectionPoint(sketch: Sketch, reference: PointRef): Point2 | undefined {
  if (reference.geometry === "reference:origin") return { x_nm: 0, y_nm: 0 };
  const value = sketch.geometry[reference.geometry]?.geometry;
  if (!value) return undefined;
  const parameter = /^parameter:(\d+)$/.exec(reference.anchor);
  if (parameter) return evaluateGeometryCurve(value, Number(parameter[1]) / 1_000_000);
  if (value.kind === "line" && (reference.anchor === "start" || reference.anchor === "end")) return value[reference.anchor];
  if ((value.kind === "circle" || value.kind === "arc") && reference.anchor === "center") return value.center;
  if (value.kind === "arc" && (reference.anchor === "start" || reference.anchor === "end")) return value[reference.anchor];
  if (value.kind === "rectangle" && (reference.anchor === "min" || reference.anchor === "max")) return value[reference.anchor];
  if (value.kind === "control_point_spline") {
    const index = /^control:(\d+)$/.exec(reference.anchor);
    if (index) return value.control_points[Number(index[1])];
    if (reference.anchor === "start") return value.control_points[0];
    if (reference.anchor === "end") return value.control_points.at(-1);
  }
  if (value.kind === "fit_point_spline") {
    const index = /^fit:(\d+)$/.exec(reference.anchor);
    if (index) return value.fit_points[Number(index[1])];
    if (reference.anchor === "start") return value.fit_points[0];
    if (reference.anchor === "end") return value.fit_points.at(-1);
  }
  if ((value.kind === "ellipse" || value.kind === "elliptical_arc") && ["center", "major", "minor", "start", "end"].includes(reference.anchor)) return (value as unknown as Record<string, Point2>)[reference.anchor];
  if (value.kind === "conic" && ["start", "control", "end"].includes(reference.anchor)) return value[reference.anchor as "start" | "control" | "end"];
  if (value.kind === "sketch_point" && reference.anchor === "position") return { x_nm: value.x_nm, y_nm: value.y_nm };
  return undefined;
}

/** A partial but still valid Smart Dimension operand set must keep the tool invokable. */
export function smartDimensionDisabledReason(selection: SketchSelectionSummary): string | undefined {
  if (smartDimensionKind(selection)) return undefined;
  if (selection.points === 1 && selection.targetGeometry === 0) return undefined;
  if (selection.origin && selection.points === 0 && selection.targetGeometry === 0) return undefined;
  if (selection.geometry === 0 && selection.points === 0) return undefined;
  return "Select one line, one circle or arc, two points, or two lines";
}

export function sketchEntityMatchesFilter(entity: GeometryEntity, filters: ReadonlySet<string>): boolean {
  if (entity.id.startsWith("external:") && !filters.has("external")) return false;
  if (entity.construction && !filters.has("construction")) return false;
  return filters.has("curves");
}

/** Parses arithmetic dimension expressions with mm, cm, m, in, ft, deg, or rad literals. */
export function parseSketchDimensionExpression(source: string, kind: "length" | "angle"): number | undefined {
  const tokens = source.trim().match(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:\s*(?:mm|cm|m|in|ft|deg|°|rad))?|[()+\-*/]/gi);
  if (!tokens || tokens.join("").replaceAll(/\s/g, "") !== source.replaceAll(/\s/g, "")) return undefined;
  let index = 0;
  const literal = (token: string): number | undefined => {
    const match = /^(\d+(?:\.\d*)?|\.\d+)(e[+-]?\d+)?\s*(mm|cm|m|in|ft|deg|°|rad)?$/i.exec(token);
    if (!match) return undefined;
    let value = Number(`${match[1]}${match[2] ?? ""}`);
    const unit = match[3]?.toLowerCase();
    if (kind === "length") {
      if (unit === "cm") value *= 10;
      else if (unit === "m") value *= 1000;
      else if (unit === "in") value *= 25.4;
      else if (unit === "ft") value *= 304.8;
      else if (unit && unit !== "mm") return undefined;
    } else {
      if (unit === "rad") value = value * 180 / Math.PI;
      else if (unit && unit !== "deg" && unit !== "°") return undefined;
    }
    return value;
  };
  const primary = (): number | undefined => {
    const token = tokens[index++];
    if (!token) return undefined;
    if (token === "+") return primary();
    if (token === "-") { const value = primary(); return value === undefined ? undefined : -value; }
    if (token === "(") { const value = expression(); if (tokens[index++] !== ")") return undefined; return value; }
    return literal(token);
  };
  const product = (): number | undefined => {
    let value = primary();
    while (value !== undefined && (tokens[index] === "*" || tokens[index] === "/")) {
      const operator = tokens[index++]; const right = primary();
      if (right === undefined || (operator === "/" && right === 0)) return undefined;
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  };
  const expression = (): number | undefined => {
    let value = product();
    while (value !== undefined && (tokens[index] === "+" || tokens[index] === "-")) {
      const operator = tokens[index++]; const right = product();
      if (right === undefined) return undefined;
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  };
  const value = expression();
  return value !== undefined && Number.isFinite(value) && index === tokens.length ? value : undefined;
}
