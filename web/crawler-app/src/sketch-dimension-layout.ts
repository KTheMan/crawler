/**
 * Screen-space layout for sketch dimensions.
 *
 * The layout is deliberately independent of sketch state and of the renderer:
 * both a transient Smart Dimension preview and a committed dimension can render
 * the same semantic primitives.
 */

export type ScreenPoint = Readonly<{ x: number; y: number }>;

export type LinearDimensionOrientation = "aligned" | "horizontal" | "vertical" | "auto";

export type DimensionLineRole =
  | "witness"
  | "measure"
  | "ray"
  | "leader";

export type DimensionLinePrimitive = Readonly<{
  type: "line";
  role: DimensionLineRole;
  start: ScreenPoint;
  end: ScreenPoint;
}>;

export type DimensionArrowPrimitive = Readonly<{
  type: "triangle";
  role: "arrow";
  tip: ScreenPoint;
  corners: readonly [ScreenPoint, ScreenPoint];
}>;

export type DimensionMarkerPrimitive = Readonly<{
  type: "marker";
  role: "endpoint" | "center" | "projection" | "vertex";
  center: ScreenPoint;
  radius: number;
}>;

export type DimensionArcPrimitive = Readonly<{
  type: "arc";
  role: "measure";
  center: ScreenPoint;
  radius: number;
  startAngleRadians: number;
  sweepRadians: number;
}>;

export type DimensionLabelPrimitive = Readonly<{
  type: "label";
  role: "dimension-label";
  anchor: ScreenPoint;
  rotationRadians: number;
  value: number;
  unit: "screen" | "radian";
}>;

export type DimensionPrimitive =
  | DimensionLinePrimitive
  | DimensionArrowPrimitive
  | DimensionMarkerPrimitive
  | DimensionArcPrimitive
  | DimensionLabelPrimitive;

export type LinearDimensionInput = Readonly<{
  kind: "linear";
  first: ScreenPoint;
  second: ScreenPoint;
  placement: ScreenPoint;
  orientation?: LinearDimensionOrientation;
}>;

export type AngularDimensionInput = Readonly<{
  kind: "angular";
  vertex: ScreenPoint;
  firstRayPoint: ScreenPoint;
  secondRayPoint: ScreenPoint;
  placement: ScreenPoint;
}>;

export type RadialDimensionInput = Readonly<{
  kind: "radius" | "diameter";
  center: ScreenPoint;
  radius: number;
  placement: ScreenPoint;
}>;

export type PointLineDimensionInput = Readonly<{
  kind: "point-line";
  point: ScreenPoint;
  lineStart: ScreenPoint;
  lineEnd: ScreenPoint;
  placement: ScreenPoint;
}>;

export type ParallelLineDimensionInput = Readonly<{
  kind: "parallel-lines";
  firstLineStart: ScreenPoint;
  firstLineEnd: ScreenPoint;
  secondLineStart: ScreenPoint;
  secondLineEnd: ScreenPoint;
  placement: ScreenPoint;
}>;

export type SketchDimensionLayoutInput =
  | LinearDimensionInput
  | AngularDimensionInput
  | RadialDimensionInput
  | PointLineDimensionInput
  | ParallelLineDimensionInput;

export type SketchDimensionLayout = Readonly<{
  kind: SketchDimensionLayoutInput["kind"];
  status: "valid" | "degenerate";
  issues: readonly string[];
  /** The resolved orientation is useful for cursor-sector feedback. */
  orientation?: Exclude<LinearDimensionOrientation, "auto">;
  primitives: readonly DimensionPrimitive[];
  labelAnchor: ScreenPoint;
  value: number;
}>;

const EPSILON = 1e-7;
const WITNESS_GAP = 3;
const WITNESS_OVERHANG = 5;
const ARROW_LENGTH = 7;
const ARROW_HALF_WIDTH = 3;
const MARKER_RADIUS = 2.5;
const MIN_ANGLE_RADIUS = 12;

type Vector = { x: number; y: number };

function isFinitePoint(point: ScreenPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function add(point: ScreenPoint, vector: Vector, scale = 1): ScreenPoint {
  return { x: point.x + vector.x * scale, y: point.y + vector.y * scale };
}

function subtract(first: ScreenPoint, second: ScreenPoint): Vector {
  return { x: first.x - second.x, y: first.y - second.y };
}

function dot(first: Vector, second: Vector): number {
  return first.x * second.x + first.y * second.y;
}

function magnitude(vector: Vector): number {
  return Math.hypot(vector.x, vector.y);
}

function normalize(vector: Vector): Vector | undefined {
  const length = magnitude(vector);
  if (!Number.isFinite(length) || length < EPSILON) return undefined;
  return { x: vector.x / length, y: vector.y / length };
}

function perpendicular(vector: Vector): Vector {
  return { x: -vector.y, y: vector.x };
}

function midpoint(first: ScreenPoint, second: ScreenPoint): ScreenPoint {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

function projectPointOnLine(point: ScreenPoint, lineStart: ScreenPoint, lineDirection: Vector): ScreenPoint {
  const distanceAlongLine = dot(subtract(point, lineStart), lineDirection);
  return add(lineStart, lineDirection, distanceAlongLine);
}

function line(role: DimensionLineRole, start: ScreenPoint, end: ScreenPoint): DimensionLinePrimitive {
  return { type: "line", role, start, end };
}

function marker(role: DimensionMarkerPrimitive["role"], center: ScreenPoint): DimensionMarkerPrimitive {
  return { type: "marker", role, center, radius: MARKER_RADIUS };
}

function arrow(tip: ScreenPoint, directionIntoMeasure: Vector): DimensionArrowPrimitive {
  const normal = perpendicular(directionIntoMeasure);
  const base = add(tip, directionIntoMeasure, ARROW_LENGTH);
  return {
    type: "triangle",
    role: "arrow",
    tip,
    corners: [add(base, normal, ARROW_HALF_WIDTH), add(base, normal, -ARROW_HALF_WIDTH)],
  };
}

function label(anchor: ScreenPoint, rotationRadians: number, value: number, unit: "screen" | "radian"): DimensionLabelPrimitive {
  return { type: "label", role: "dimension-label", anchor, rotationRadians, value, unit };
}

function invalid(kind: SketchDimensionLayoutInput["kind"], placement: ScreenPoint, issue: string): SketchDimensionLayout {
  const labelAnchor = isFinitePoint(placement) ? placement : { x: 0, y: 0 };
  return { kind, status: "degenerate", issues: [issue], primitives: [], labelAnchor, value: 0 };
}

/**
 * Resolve Fusion-style point-to-point cursor sectors. Above/below selects a
 * horizontal measurement, left/right selects vertical, and diagonal sectors
 * retain the true aligned distance.
 */
export function resolveLinearDimensionOrientation(
  first: ScreenPoint,
  second: ScreenPoint,
  placement: ScreenPoint,
  requested: LinearDimensionOrientation = "auto",
): Exclude<LinearDimensionOrientation, "auto"> {
  if (requested !== "auto") return requested;
  const cursor = subtract(placement, midpoint(first, second));
  if (Math.abs(cursor.y) >= Math.abs(cursor.x) * 1.5) return "horizontal";
  if (Math.abs(cursor.x) >= Math.abs(cursor.y) * 1.5) return "vertical";
  return "aligned";
}

function witnessLine(source: ScreenPoint, dimensionPoint: ScreenPoint, fallbackDirection: Vector): DimensionLinePrimitive {
  const offset = subtract(dimensionPoint, source);
  const towardDimension = normalize(offset);
  // When an endpoint already lies on the dimension line there is no space in
  // which to put the usual witness gap. Start at that endpoint and retain an
  // overhang on the same side as the other witness instead.
  if (!towardDimension) {
    return line("witness", source, add(dimensionPoint, fallbackDirection, WITNESS_OVERHANG));
  }
  return line(
    "witness",
    add(source, towardDimension, WITNESS_GAP),
    add(dimensionPoint, towardDimension, WITNESS_OVERHANG),
  );
}

function layoutLinear(input: LinearDimensionInput): SketchDimensionLayout {
  if (![input.first, input.second, input.placement].every(isFinitePoint)) {
    return invalid(input.kind, input.placement, "Linear dimension coordinates must be finite.");
  }
  const entityVector = subtract(input.second, input.first);
  if (!normalize(entityVector)) return invalid(input.kind, input.placement, "Coincident points do not define a linear dimension.");

  const orientation = resolveLinearDimensionOrientation(input.first, input.second, input.placement, input.orientation);
  let firstDimensionPoint: ScreenPoint;
  let secondDimensionPoint: ScreenPoint;
  let measureDirection: Vector;
  let defaultWitnessDirection: Vector;

  if (orientation === "horizontal") {
    firstDimensionPoint = { x: input.first.x, y: input.placement.y };
    secondDimensionPoint = { x: input.second.x, y: input.placement.y };
    measureDirection = { x: Math.sign(input.second.x - input.first.x) || 1, y: 0 };
    defaultWitnessDirection = { x: 0, y: Math.sign(input.placement.y - (input.first.y + input.second.y) / 2) || -1 };
  } else if (orientation === "vertical") {
    firstDimensionPoint = { x: input.placement.x, y: input.first.y };
    secondDimensionPoint = { x: input.placement.x, y: input.second.y };
    measureDirection = { x: 0, y: Math.sign(input.second.y - input.first.y) || 1 };
    defaultWitnessDirection = { x: Math.sign(input.placement.x - (input.first.x + input.second.x) / 2) || 1, y: 0 };
  } else {
    const direction = normalize(entityVector)!;
    const normal = perpendicular(direction);
    const signedOffset = dot(subtract(input.placement, input.first), normal);
    const offset = Math.abs(signedOffset) < EPSILON ? WITNESS_GAP + WITNESS_OVERHANG : signedOffset;
    firstDimensionPoint = add(input.first, normal, offset);
    secondDimensionPoint = add(input.second, normal, offset);
    measureDirection = direction;
    defaultWitnessDirection = { x: normal.x * Math.sign(offset), y: normal.y * Math.sign(offset) };
  }

  const measuredVector = subtract(secondDimensionPoint, firstDimensionPoint);
  const value = magnitude(measuredVector);
  if (value < EPSILON) return invalid(input.kind, input.placement, `${orientation} projection has zero length.`);
  const direction = normalize(measuredVector) ?? measureDirection;
  const anchor = midpoint(firstDimensionPoint, secondDimensionPoint);
  const rotation = orientation === "vertical" ? Math.PI / 2 : Math.atan2(direction.y, direction.x);
  // A placement line may cross between the selected points. Each extension
  // must therefore travel from its own point toward the measure line rather
  // than sharing a direction inferred from the pair's midpoint.
  const firstWitnessDirection = normalize(subtract(firstDimensionPoint, input.first));
  const secondWitnessDirection = normalize(subtract(secondDimensionPoint, input.second));
  const primitives: DimensionPrimitive[] = [
    witnessLine(input.first, firstDimensionPoint, firstWitnessDirection ?? secondWitnessDirection ?? defaultWitnessDirection),
    witnessLine(input.second, secondDimensionPoint, secondWitnessDirection ?? firstWitnessDirection ?? defaultWitnessDirection),
    line("measure", firstDimensionPoint, secondDimensionPoint),
    arrow(firstDimensionPoint, direction),
    arrow(secondDimensionPoint, { x: -direction.x, y: -direction.y }),
    marker("endpoint", input.first),
    marker("endpoint", input.second),
    label(anchor, rotation, value, "screen"),
  ];
  return { kind: input.kind, status: "valid", issues: [], orientation, primitives, labelAnchor: anchor, value };
}

function normalizePositiveAngle(angle: number): number {
  const fullTurn = Math.PI * 2;
  return ((angle % fullTurn) + fullTurn) % fullTurn;
}

function layoutAngular(input: AngularDimensionInput): SketchDimensionLayout {
  if (![input.vertex, input.firstRayPoint, input.secondRayPoint, input.placement].every(isFinitePoint)) {
    return invalid(input.kind, input.placement, "Angular dimension coordinates must be finite.");
  }
  const firstDirection = normalize(subtract(input.firstRayPoint, input.vertex));
  const secondDirection = normalize(subtract(input.secondRayPoint, input.vertex));
  const placementDirection = normalize(subtract(input.placement, input.vertex));
  if (!firstDirection || !secondDirection) return invalid(input.kind, input.placement, "Angular rays must have nonzero length.");
  if (!placementDirection) return invalid(input.kind, input.placement, "Place an angular dimension away from its vertex.");

  const firstAngle = Math.atan2(firstDirection.y, firstDirection.x);
  const secondAngle = Math.atan2(secondDirection.y, secondDirection.x);
  const placementAngle = Math.atan2(placementDirection.y, placementDirection.x);
  const counterClockwiseSweep = normalizePositiveAngle(secondAngle - firstAngle);
  if (counterClockwiseSweep < EPSILON || Math.abs(counterClockwiseSweep - Math.PI * 2) < EPSILON) {
    return invalid(input.kind, input.placement, "Collinear rays in the same direction do not define an angle.");
  }
  const placementFromFirst = normalizePositiveAngle(placementAngle - firstAngle);
  // Select the angular sector that contains the cursor, including the reflex sector.
  const sweep = placementFromFirst <= counterClockwiseSweep ? counterClockwiseSweep : counterClockwiseSweep - Math.PI * 2;
  const radius = Math.max(MIN_ANGLE_RADIUS, magnitude(subtract(input.placement, input.vertex)));
  const firstArcPoint = add(input.vertex, firstDirection, radius);
  const secondArcPoint = add(input.vertex, secondDirection, radius);
  const firstTangent = sweep > 0 ? perpendicular(firstDirection) : { x: firstDirection.y, y: -firstDirection.x };
  const secondTangent = sweep > 0 ? { x: secondDirection.y, y: -secondDirection.x } : perpendicular(secondDirection);
  const middleAngle = firstAngle + sweep / 2;
  const anchor = add(input.vertex, { x: Math.cos(middleAngle), y: Math.sin(middleAngle) }, radius);
  const value = Math.abs(sweep);
  const primitives: DimensionPrimitive[] = [
    line("ray", input.vertex, add(input.vertex, firstDirection, radius + WITNESS_OVERHANG)),
    line("ray", input.vertex, add(input.vertex, secondDirection, radius + WITNESS_OVERHANG)),
    { type: "arc", role: "measure", center: input.vertex, radius, startAngleRadians: firstAngle, sweepRadians: sweep },
    arrow(firstArcPoint, firstTangent),
    arrow(secondArcPoint, secondTangent),
    marker("vertex", input.vertex),
    label(anchor, middleAngle + Math.PI / 2, value, "radian"),
  ];
  return { kind: input.kind, status: "valid", issues: [], primitives, labelAnchor: anchor, value };
}

function layoutRadial(input: RadialDimensionInput): SketchDimensionLayout {
  if (![input.center, input.placement].every(isFinitePoint) || !Number.isFinite(input.radius)) {
    return invalid(input.kind, input.placement, "Radial dimension coordinates and radius must be finite.");
  }
  if (input.radius <= EPSILON) return invalid(input.kind, input.placement, "A radial dimension requires a positive radius.");
  const direction = normalize(subtract(input.placement, input.center)) ?? { x: 1, y: 0 };
  const near = add(input.center, direction, input.radius);
  const anchor = magnitude(subtract(input.placement, input.center)) > input.radius + WITNESS_OVERHANG
    ? input.placement
    : add(input.center, direction, input.radius + 18);
  const primitives: DimensionPrimitive[] = [marker("center", input.center)];
  let value: number;
  if (input.kind === "radius") {
    primitives.push(
      line("leader", input.center, anchor),
      arrow(near, { x: -direction.x, y: -direction.y }),
    );
    value = input.radius;
  } else {
    const far = add(input.center, direction, -input.radius);
    primitives.push(
      line("measure", far, near),
      line("leader", near, anchor),
      arrow(far, direction),
      arrow(near, { x: -direction.x, y: -direction.y }),
    );
    value = input.radius * 2;
  }
  primitives.push(label(anchor, Math.atan2(direction.y, direction.x), value, "screen"));
  return { kind: input.kind, status: "valid", issues: [], primitives, labelAnchor: anchor, value };
}

function layoutPointLine(input: PointLineDimensionInput): SketchDimensionLayout {
  if (![input.point, input.lineStart, input.lineEnd, input.placement].every(isFinitePoint)) {
    return invalid(input.kind, input.placement, "Point-line dimension coordinates must be finite.");
  }
  const lineDirection = normalize(subtract(input.lineEnd, input.lineStart));
  if (!lineDirection) return invalid(input.kind, input.placement, "A point-line dimension requires a nondegenerate line.");
  const projection = projectPointOnLine(input.point, input.lineStart, lineDirection);
  if (magnitude(subtract(input.point, projection)) < EPSILON) {
    return invalid(input.kind, input.placement, "A point on the selected line has zero spacing.");
  }
  const linear = layoutLinear({ kind: "linear", first: input.point, second: projection, placement: input.placement, orientation: "aligned" });
  return {
    ...linear,
    kind: input.kind,
    primitives: linear.primitives.map((primitive) => (
      primitive.type === "marker" && primitive.role === "endpoint" && primitive.center === projection
        ? { ...primitive, role: "projection" as const }
        : primitive
    )),
  };
}

function layoutParallelLines(input: ParallelLineDimensionInput): SketchDimensionLayout {
  const points = [input.firstLineStart, input.firstLineEnd, input.secondLineStart, input.secondLineEnd, input.placement];
  if (!points.every(isFinitePoint)) return invalid(input.kind, input.placement, "Parallel-line dimension coordinates must be finite.");
  const firstDirection = normalize(subtract(input.firstLineEnd, input.firstLineStart));
  const secondDirection = normalize(subtract(input.secondLineEnd, input.secondLineStart));
  if (!firstDirection || !secondDirection) return invalid(input.kind, input.placement, "Parallel-line dimensions require nondegenerate lines.");
  const parallelError = Math.abs(firstDirection.x * secondDirection.y - firstDirection.y * secondDirection.x);
  if (parallelError > 1e-4) return invalid(input.kind, input.placement, "Selected lines are not parallel.");

  const firstPoint = midpoint(input.firstLineStart, input.firstLineEnd);
  const secondPoint = projectPointOnLine(firstPoint, input.secondLineStart, secondDirection);
  if (magnitude(subtract(firstPoint, secondPoint)) < EPSILON) return invalid(input.kind, input.placement, "Coincident lines have zero spacing.");
  const linear = layoutLinear({ kind: "linear", first: firstPoint, second: secondPoint, placement: input.placement, orientation: "aligned" });
  return { ...linear, kind: input.kind };
}

/** Create renderer-neutral screen-space primitives for any supported sketch dimension. */
export function layoutSketchDimension(input: SketchDimensionLayoutInput): SketchDimensionLayout {
  switch (input.kind) {
    case "linear": return layoutLinear(input);
    case "angular": return layoutAngular(input);
    case "radius":
    case "diameter": return layoutRadial(input);
    case "point-line": return layoutPointLine(input);
    case "parallel-lines": return layoutParallelLines(input);
  }
}
