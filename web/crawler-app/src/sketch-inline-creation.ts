import type { Point2 } from "./sketch-editor.ts";
import type { ArcVariant, CircleVariant, PolygonVariant, RectangleVariant, SlotVariant } from "./sketch-creation.ts";

export type InlineCreationTool = "line" | "rectangle" | "circle" | "arc" | "polygon" | "slot" | "ellipse" | "elliptical_arc";
export type InlineCreationFieldKey =
  | "length"
  | "angle"
  | "width"
  | "height"
  | "radius"
  | "diameter"
  | "sides"
  | "major_radius"
  | "minor_radius";
export type InlineCreationUnit = "nanometer" | "microdegree" | "count";
export type InlineCreationVariant = RectangleVariant | CircleVariant | ArcVariant | PolygonVariant | SlotVariant;

export type InlineCreationContext = {
  tool: InlineCreationTool;
  variant?: InlineCreationVariant;
  /** Clicked points followed by the current hover/input point. */
  points: readonly Point2[];
  /** Presence in this map means the user explicitly locked the field. */
  lockedFields?: Readonly<Partial<Record<InlineCreationFieldKey, number>>>;
  /** Current polygon count when it has not been explicitly locked. */
  sides?: number;
};

export type InlineCreationField = {
  key: InlineCreationFieldKey;
  label: string;
  unit: InlineCreationUnit;
  value: number;
  pointIndex: number;
  dimensional: boolean;
  semantic: InlineCreationDimensionSemantic | "polygon_sides";
};

export type InlineCreationDimensionSemantic =
  | "aligned_length"
  | "axis_angle"
  | "horizontal_length"
  | "vertical_length"
  | "radius"
  | "diameter"
  | "sweep_angle"
  | "polygon_radius"
  | "polygon_apothem"
  | "slot_length"
  | "slot_width"
  | "ellipse_major_radius"
  | "ellipse_minor_radius";

export type InlineCreationDimensionIntent = {
  field: Exclude<InlineCreationFieldKey, "sides">;
  value: number;
  unit: Exclude<InlineCreationUnit, "count">;
  semantic: InlineCreationDimensionSemantic;
  pointIndices: readonly number[];
  preferredConstraintKind?: "distance" | "distance_x" | "distance_y" | "radius" | "diameter" | "ellipse_radius" | "angle_to_axis";
};

export type InlineCreationPropertyIntent = {
  field: "sides";
  value: number;
  unit: "count";
  semantic: "polygon_sides";
};

export type InlineCreationResult = {
  points: Point2[];
  fields: InlineCreationField[];
  /** Only explicitly locked, valid dimensional fields are included. */
  dimensionIntents: InlineCreationDimensionIntent[];
  propertyIntents: InlineCreationPropertyIntent[];
  sides?: number;
  valid: boolean;
  errors: string[];
};

const NM_EPSILON = 1;
const FULL_TURN_MICRODEGREES = 360_000_000;
const RAD_TO_MICRODEGREES = 180_000_000 / Math.PI;
const MICRODEGREES_TO_RAD = Math.PI / 180_000_000;

/**
 * Resolves creation geometry from the values the user explicitly locked in the
 * canvas HUD. Unlocked coordinates remain freeform; the returned array is
 * always a clone and the caller's points are never mutated.
 */
export function solveInlineCreation(context: InlineCreationContext): InlineCreationResult {
  const original = context.points.map(copyPoint);
  const errors = validateInput(context);
  if (errors.length) return failedResult(context, original, errors);

  const points = original.map(copyPoint);
  const locked = context.lockedFields ?? {};
  let sides = context.sides ?? 6;
  if (context.tool === "polygon" && hasLock(locked, "sides")) sides = locked.sides!;

  try {
    switch (context.tool) {
      case "line": solveLine(points, locked); break;
      case "rectangle": solveRectangle(points, rectangleVariant(context.variant), locked); break;
      case "circle": solveCircle(points, circleVariant(context.variant), locked); break;
      case "arc": solveArc(points, arcVariant(context.variant), locked); break;
      case "polygon": solvePolygon(points, polygonVariant(context.variant), locked, sides); break;
      case "slot": solveSlot(points, slotVariant(context.variant), locked); break;
      case "ellipse":
      case "elliptical_arc": solveEllipse(points, locked); break;
    }
  } catch (error) {
    return failedResult(context, original, [error instanceof Error ? error.message : String(error)]);
  }

  const fields = deriveInlineCreationFields({ ...context, points, sides });
  const fieldByKey = new Map(fields.map((field) => [field.key, field]));
  const dimensionIntents: InlineCreationDimensionIntent[] = [];
  const propertyIntents: InlineCreationPropertyIntent[] = [];
  for (const key of Object.keys(locked) as InlineCreationFieldKey[]) {
    const field = fieldByKey.get(key);
    if (!field) continue;
    if (key === "sides") {
      propertyIntents.push({ field: "sides", value: sides, unit: "count", semantic: "polygon_sides" });
      continue;
    }
    dimensionIntents.push(intentForField(context.tool, rectangleVariant(context.variant), circleVariant(context.variant), polygonVariant(context.variant), slotVariant(context.variant), field));
  }
  return { points, fields, dimensionIntents, propertyIntents, sides: context.tool === "polygon" ? sides : undefined, valid: true, errors: [] };
}

/** Derives current HUD values without changing geometry. */
export function deriveInlineCreationFields(context: InlineCreationContext): InlineCreationField[] {
  const points = context.points;
  if (points.some((point) => !finitePoint(point))) return [];
  const fields: InlineCreationField[] = [];
  const add = (key: InlineCreationFieldKey, label: string, unit: InlineCreationUnit, value: number, pointIndex: number, dimensional: boolean, semantic: InlineCreationField["semantic"]) => {
    if (Number.isFinite(value)) fields.push({ key, label, unit, value: unit === "nanometer" || unit === "count" ? Math.round(value) : Math.round(value), pointIndex, dimensional, semantic });
  };

  if (context.tool === "line" && points.length >= 2) {
    add("length", "Length", "nanometer", distance(points[0], points[1]), 1, true, "aligned_length");
    add("angle", "Angle", "microdegree", signedAngleMicrodegrees(points[0], points[1]), 1, true, "axis_angle");
  } else if (context.tool === "rectangle") {
    const variant = rectangleVariant(context.variant);
    if (points.length >= 2) {
      if (variant === "three_point") add("width", "Width", "nanometer", distance(points[0], points[1]), 1, true, "aligned_length");
      else {
        const factor = variant === "center" ? 2 : 1;
        add("width", "Width", "nanometer", Math.abs(points[1].x_nm - points[0].x_nm) * factor, 1, true, "horizontal_length");
        add("height", "Height", "nanometer", Math.abs(points[1].y_nm - points[0].y_nm) * factor, 1, true, "vertical_length");
      }
    }
    if (variant === "three_point" && points.length >= 3) add("height", "Height", "nanometer", Math.abs(perpendicularOffset(points[0], points[1], points[2])), 2, true, "vertical_length");
  } else if (context.tool === "circle") {
    const variant = circleVariant(context.variant);
    if ((variant === "center_diameter" || variant === "two_point") && points.length >= 2) {
      add("diameter", "Diameter", "nanometer", distance(points[0], points[1]) * (variant === "center_diameter" ? 2 : 1), 1, true, "diameter");
    } else if (variant === "three_point" && points.length >= 3) {
      const circle = tryCircumcircle(points[0], points[1], points[2]);
      if (circle) add("radius", "Radius", "nanometer", circle.radius, 2, true, "radius");
    }
  } else if (context.tool === "arc") {
    const variant = arcVariant(context.variant);
    if (variant === "center_point" && points.length >= 2) add("radius", "Radius", "nanometer", distance(points[0], points[1]), 1, true, "radius");
    if (variant === "center_point" && points.length >= 3) add("angle", "Sweep", "microdegree", ccwSweepMicrodegrees(points[0], points[1], points[2]), 2, true, "sweep_angle");
    if (variant === "three_point" && points.length >= 3) {
      const circle = tryCircumcircle(points[0], points[1], points[2]);
      if (circle) {
        add("radius", "Radius", "nanometer", circle.radius, 2, true, "radius");
        add("angle", "Sweep", "microdegree", arcSweepMicrodegrees(circle.center, points[0], points[1], points[2]), 2, true, "sweep_angle");
      }
    }
  } else if (context.tool === "polygon") {
    const sides = context.sides ?? 6;
    add("sides", "Sides", "count", sides, 1, false, "polygon_sides");
    if (points.length >= 2 && Number.isInteger(sides) && sides >= 3) {
      const variant = polygonVariant(context.variant);
      const picked = distance(points[0], points[1]);
      const radius = variant === "edge" ? picked / (2 * Math.sin(Math.PI / sides)) : picked;
      add("radius", "Radius", "nanometer", radius, 1, true, variant === "circumscribed" ? "polygon_apothem" : "polygon_radius");
    }
  } else if (context.tool === "slot") {
    const variant = slotVariant(context.variant);
    if (variant === "three_point_arc" && points.length >= 3) {
      const circle = tryCircumcircle(points[0], points[1], points[2]);
      if (circle) add("length", "Length", "nanometer", circle.radius * arcSweepRadians(circle.center, points[0], points[1], points[2]), 2, true, "slot_length");
      if (points.length >= 4) add("width", "Width", "nanometer", distance(points[1], points[3]) * 2, 3, true, "slot_width");
    } else if (points.length >= 2) {
      const factor = variant === "center_point" ? 2 : 1;
      add("length", "Length", "nanometer", distance(points[0], points[1]) * factor, 1, true, "slot_length");
      if (points.length >= 3) add("width", "Width", "nanometer", Math.abs(perpendicularOffset(points[0], points[1], points[2])) * 2, 2, true, "slot_width");
    }
  } else if ((context.tool === "ellipse" || context.tool === "elliptical_arc") && points.length >= 2) {
    add("major_radius", "Major radius", "nanometer", distance(points[0], points[1]), 1, true, "ellipse_major_radius");
    if (points.length >= 3) add("minor_radius", "Minor radius", "nanometer", Math.abs(perpendicularOffset(points[0], points[1], points[2])), 2, true, "ellipse_minor_radius");
  }
  return fields;
}

function solveLine(points: Point2[], locked: InlineCreationContext["lockedFields"]): void {
  if (points.length < 2 || (!hasLock(locked, "length") && !hasLock(locked, "angle"))) return;
  const currentLength = distance(points[0], points[1]);
  const length = hasLock(locked, "length") ? positiveNm(locked!.length!, "Line length") : currentLength;
  const angle = hasLock(locked, "angle") ? locked!.angle! * MICRODEGREES_TO_RAD : currentLength >= NM_EPSILON ? angleRadians(points[0], points[1]) : 0;
  points[1] = radial(points[0], length, angle);
}

function solveRectangle(points: Point2[], variant: RectangleVariant, locked: InlineCreationContext["lockedFields"]): void {
  if (points.length < 2) return;
  if (variant !== "three_point") {
    const factor = variant === "center" ? 2 : 1;
    const dx = points[1].x_nm - points[0].x_nm; const dy = points[1].y_nm - points[0].y_nm;
    if (hasLock(locked, "width")) points[1].x_nm = points[0].x_nm + signOrPositive(dx) * positiveNm(locked!.width!, "Rectangle width") / factor;
    if (hasLock(locked, "height")) points[1].y_nm = points[0].y_nm + signOrPositive(dy) * positiveNm(locked!.height!, "Rectangle height") / factor;
    points[1] = rounded(points[1]);
    return;
  }
  if (hasLock(locked, "width")) points[1] = radial(points[0], positiveNm(locked!.width!, "Rectangle width"), safeAngle(points[0], points[1]));
  if (points.length >= 3 && hasLock(locked, "height")) points[2] = pointAtPerpendicularOffset(points[0], points[1], points[2], positiveNm(locked!.height!, "Rectangle height"));
}

function solveCircle(points: Point2[], variant: CircleVariant, locked: InlineCreationContext["lockedFields"]): void {
  if ((variant === "center_diameter" || variant === "two_point") && points.length >= 2 && hasLock(locked, "diameter")) {
    const diameter = positiveNm(locked!.diameter!, "Circle diameter");
    points[1] = radial(points[0], variant === "center_diameter" ? diameter / 2 : diameter, safeAngle(points[0], points[1]));
  } else if (variant === "three_point" && points.length >= 3 && hasLock(locked, "radius")) {
    const radius = positiveNm(locked!.radius!, "Circle radius");
    points[2] = thirdPointForRadius(points[0], points[1], points[2], radius);
  }
}

function solveArc(points: Point2[], variant: ArcVariant, locked: InlineCreationContext["lockedFields"]): void {
  if (variant === "center_point" && points.length >= 2) {
    const oldStartAngle = safeAngle(points[0], points[1]);
    const radius = hasLock(locked, "radius") ? positiveNm(locked!.radius!, "Arc radius") : distance(points[0], points[1]);
    if (hasLock(locked, "radius")) points[1] = radial(points[0], radius, oldStartAngle);
    if (points.length >= 3) {
      const sweep = hasLock(locked, "angle") ? validSweep(locked!.angle!, "Arc sweep") * MICRODEGREES_TO_RAD : ccwSweepRadians(points[0], points[1], points[2]);
      if (hasLock(locked, "radius") || hasLock(locked, "angle")) points[2] = radial(points[0], radius, oldStartAngle + sweep);
    }
  } else if (variant === "three_point" && points.length >= 3 && (hasLock(locked, "radius") || hasLock(locked, "angle"))) {
    let circle = circumcircle(points[0], points[1], points[2]);
    if (hasLock(locked, "radius")) {
      points[2] = thirdPointForRadius(points[0], points[1], points[2], positiveNm(locked!.radius!, "Arc radius"));
      circle = circumcircle(points[0], points[1], points[2]);
    }
    if (hasLock(locked, "angle")) {
      const clockwise = !angleWithinCcwSweep(circle.center, points[0], points[1], points[2]);
      const sweep = validSweep(locked!.angle!, "Arc sweep") * MICRODEGREES_TO_RAD;
      points[2] = radial(circle.center, circle.radius, angleRadians(circle.center, points[0]) + (clockwise ? -sweep : sweep));
    }
  }
}

function solvePolygon(points: Point2[], variant: PolygonVariant, locked: InlineCreationContext["lockedFields"], sides: number): void {
  if (!Number.isInteger(sides) || sides < 3 || sides > 128) throw new Error("Polygon sides must be an integer from 3 to 128");
  if (points.length < 2 || !hasLock(locked, "radius")) return;
  const radius = positiveNm(locked!.radius!, "Polygon radius");
  const pickedDistance = variant === "edge" ? 2 * radius * Math.sin(Math.PI / sides) : radius;
  points[1] = radial(points[0], pickedDistance, safeAngle(points[0], points[1]));
}

function solveSlot(points: Point2[], variant: SlotVariant, locked: InlineCreationContext["lockedFields"]): void {
  if (variant === "three_point_arc") {
    if (points.length >= 3 && hasLock(locked, "length")) {
      const circle = circumcircle(points[0], points[1], points[2]);
      const length = positiveNm(locked!.length!, "Arc slot length");
      const sweep = length / circle.radius;
      if (!(sweep > 0 && sweep < Math.PI * 2)) throw new Error("Arc slot length must be less than one full centerline circumference");
      const clockwise = !angleWithinCcwSweep(circle.center, points[0], points[1], points[2]);
      points[2] = radial(circle.center, circle.radius, angleRadians(circle.center, points[0]) + (clockwise ? -sweep : sweep));
    }
    if (points.length >= 4 && hasLock(locked, "width")) {
      const halfWidth = positiveNm(locked!.width!, "Arc slot width") / 2;
      const direction = safeUnit(points[1], points[3], safeUnit(points[0], points[1]));
      points[3] = offset(points[1], direction, halfWidth);
    }
    return;
  }
  if (points.length < 2) return;
  if (hasLock(locked, "length")) {
    const length = positiveNm(locked!.length!, "Slot length");
    points[1] = radial(points[0], variant === "center_point" ? length / 2 : length, safeAngle(points[0], points[1]));
  }
  if (points.length >= 3 && hasLock(locked, "width")) points[2] = pointAtPerpendicularOffset(points[0], points[1], points[2], positiveNm(locked!.width!, "Slot width") / 2);
  if (variant === "overall" && points.length >= 3) {
    const length = distance(points[0], points[1]);
    const width = Math.abs(perpendicularOffset(points[0], points[1], points[2])) * 2;
    if (length <= width) throw new Error("Overall slot length must exceed its width");
  }
}

function solveEllipse(points: Point2[], locked: InlineCreationContext["lockedFields"]): void {
  if (points.length < 2) return;
  if (hasLock(locked, "major_radius")) points[1] = radial(points[0], positiveNm(locked!.major_radius!, "Ellipse major radius"), safeAngle(points[0], points[1]));
  if (points.length >= 3 && hasLock(locked, "minor_radius")) points[2] = pointAtPerpendicularOffset(points[0], points[1], points[2], positiveNm(locked!.minor_radius!, "Ellipse minor radius"));
  if (points.length >= 3) {
    const major = distance(points[0], points[1]);
    const minor = Math.abs(perpendicularOffset(points[0], points[1], points[2]));
    if ((hasLock(locked, "major_radius") || hasLock(locked, "minor_radius")) && minor > major) throw new Error("Ellipse minor radius cannot exceed its major radius");
  }
}

function intentForField(tool: InlineCreationTool, rectangle: RectangleVariant, circle: CircleVariant, polygon: PolygonVariant, slot: SlotVariant, field: InlineCreationField): InlineCreationDimensionIntent {
  const key = field.key as Exclude<InlineCreationFieldKey, "sides">;
  let pointIndices: readonly number[] = [0, field.pointIndex];
  let preferredConstraintKind: InlineCreationDimensionIntent["preferredConstraintKind"];
  if (field.semantic === "horizontal_length") preferredConstraintKind = "distance_x";
  else if (field.semantic === "vertical_length") preferredConstraintKind = "distance_y";
  else if (field.semantic === "aligned_length" || field.semantic === "slot_length") preferredConstraintKind = "distance";
  else if (field.semantic === "radius") preferredConstraintKind = "radius";
  else if (field.semantic === "diameter") preferredConstraintKind = "diameter";
  else if (field.semantic === "axis_angle") preferredConstraintKind = "angle_to_axis";
  else if (field.semantic === "ellipse_major_radius" || field.semantic === "ellipse_minor_radius") preferredConstraintKind = "ellipse_radius";
  if (tool === "rectangle" && rectangle === "three_point" && key === "height") pointIndices = [0, 1, 2];
  if (tool === "circle" && circle === "three_point") pointIndices = [0, 1, 2];
  if (tool === "polygon") pointIndices = [0, 1];
  if (tool === "slot" && slot === "three_point_arc") pointIndices = key === "width" ? [1, 3] : [0, 1, 2];
  return { field: key, value: field.value, unit: field.unit as Exclude<InlineCreationUnit, "count">, semantic: field.semantic as InlineCreationDimensionSemantic, pointIndices, preferredConstraintKind };
}

function validateInput(context: InlineCreationContext): string[] {
  const errors: string[] = [];
  context.points.forEach((point, index) => { if (!finitePoint(point)) errors.push(`Point ${index + 1} must have finite nanometer coordinates`); });
  for (const [key, value] of Object.entries(context.lockedFields ?? {})) if (!Number.isFinite(value)) errors.push(`${key} must be finite`);
  return errors;
}

function failedResult(context: InlineCreationContext, points: Point2[], errors: string[]): InlineCreationResult {
  return { points, fields: deriveInlineCreationFields({ ...context, points }), dimensionIntents: [], propertyIntents: [], sides: context.tool === "polygon" ? context.sides ?? 6 : undefined, valid: false, errors };
}

function rectangleVariant(value: InlineCreationVariant | undefined): RectangleVariant { return value === "three_point" || value === "center" ? value : "two_point"; }
function circleVariant(value: InlineCreationVariant | undefined): CircleVariant { return value === "two_point" || value === "three_point" || value === "two_tangent" || value === "three_tangent" ? value : "center_diameter"; }
function arcVariant(value: InlineCreationVariant | undefined): ArcVariant { return value === "three_point" || value === "tangent" ? value : "center_point"; }
function polygonVariant(value: InlineCreationVariant | undefined): PolygonVariant { return value === "circumscribed" || value === "edge" ? value : "inscribed"; }
function slotVariant(value: InlineCreationVariant | undefined): SlotVariant { return value === "overall" || value === "center_point" || value === "three_point_arc" ? value : "center_to_center"; }
function hasLock(locked: InlineCreationContext["lockedFields"], key: InlineCreationFieldKey): boolean { return Object.prototype.hasOwnProperty.call(locked ?? {}, key); }
function positiveNm(value: number, label: string): number { if (!(value >= NM_EPSILON)) throw new Error(`${label} must be at least one nanometer`); return value; }
function validSweep(value: number, label: string): number { if (!(value > 0 && value < FULL_TURN_MICRODEGREES)) throw new Error(`${label} must be greater than 0 and less than 360 degrees`); return value; }
function copyPoint(point: Point2): Point2 { return { x_nm: point.x_nm, y_nm: point.y_nm }; }
function rounded(point: Point2): Point2 { return { x_nm: Math.round(point.x_nm), y_nm: Math.round(point.y_nm) }; }
function finitePoint(point: Point2): boolean { return Number.isFinite(point.x_nm) && Number.isFinite(point.y_nm); }
function signOrPositive(value: number): number { return value < 0 ? -1 : 1; }
function distance(a: Point2, b: Point2): number { return Math.hypot(b.x_nm - a.x_nm, b.y_nm - a.y_nm); }
function angleRadians(center: Point2, point: Point2): number { return Math.atan2(point.y_nm - center.y_nm, point.x_nm - center.x_nm); }
function safeAngle(center: Point2, point: Point2): number { return distance(center, point) >= NM_EPSILON ? angleRadians(center, point) : 0; }
function signedAngleMicrodegrees(center: Point2, point: Point2): number { return angleRadians(center, point) * RAD_TO_MICRODEGREES; }
function radial(center: Point2, radius: number, radians: number): Point2 { return rounded({ x_nm: center.x_nm + radius * Math.cos(radians), y_nm: center.y_nm + radius * Math.sin(radians) }); }
function offset(point: Point2, direction: { x: number; y: number }, amount: number): Point2 { return rounded({ x_nm: point.x_nm + direction.x * amount, y_nm: point.y_nm + direction.y * amount }); }
function safeUnit(a: Point2, b: Point2, fallback: { x: number; y: number } = { x: 1, y: 0 }): { x: number; y: number } { const length = distance(a, b); return length >= NM_EPSILON ? { x: (b.x_nm - a.x_nm) / length, y: (b.y_nm - a.y_nm) / length } : fallback; }
function perpendicularOffset(first: Point2, second: Point2, point: Point2): number { const axis = safeUnit(first, second); return (point.x_nm - first.x_nm) * -axis.y + (point.y_nm - first.y_nm) * axis.x; }
function pointAtPerpendicularOffset(first: Point2, second: Point2, hint: Point2, magnitude: number): Point2 { const axis = safeUnit(first, second); const normal = { x: -axis.y, y: axis.x }; return offset(first, normal, signOrPositive(perpendicularOffset(first, second, hint)) * magnitude); }
function normalizeTurn(radians: number): number { const turn = Math.PI * 2; return ((radians % turn) + turn) % turn; }
function ccwSweepRadians(center: Point2, start: Point2, end: Point2): number { return normalizeTurn(angleRadians(center, end) - angleRadians(center, start)); }
function ccwSweepMicrodegrees(center: Point2, start: Point2, end: Point2): number { return ccwSweepRadians(center, start, end) * RAD_TO_MICRODEGREES; }
function angleWithinCcwSweep(center: Point2, start: Point2, through: Point2, end: Point2): boolean { return ccwSweepRadians(center, start, through) <= ccwSweepRadians(center, start, end); }
function arcSweepRadians(center: Point2, start: Point2, through: Point2, end: Point2): number { return angleWithinCcwSweep(center, start, through, end) ? ccwSweepRadians(center, start, end) : normalizeTurn(angleRadians(center, start) - angleRadians(center, end)); }
function arcSweepMicrodegrees(center: Point2, start: Point2, through: Point2, end: Point2): number { return arcSweepRadians(center, start, through, end) * RAD_TO_MICRODEGREES; }

function circumcircle(a: Point2, b: Point2, c: Point2): { center: Point2; radius: number } {
  const d = 2 * (a.x_nm * (b.y_nm - c.y_nm) + b.x_nm * (c.y_nm - a.y_nm) + c.x_nm * (a.y_nm - b.y_nm));
  if (!Number.isFinite(d) || Math.abs(d) < NM_EPSILON) throw new Error("Creation points must not be collinear");
  const aa = a.x_nm ** 2 + a.y_nm ** 2; const bb = b.x_nm ** 2 + b.y_nm ** 2; const cc = c.x_nm ** 2 + c.y_nm ** 2;
  const center = rounded({ x_nm: (aa * (b.y_nm - c.y_nm) + bb * (c.y_nm - a.y_nm) + cc * (a.y_nm - b.y_nm)) / d, y_nm: (aa * (c.x_nm - b.x_nm) + bb * (a.x_nm - c.x_nm) + cc * (b.x_nm - a.x_nm)) / d });
  const radius = distance(center, a);
  if (!(radius >= NM_EPSILON) || !Number.isFinite(radius)) throw new Error("Creation radius must be finite and positive");
  return { center, radius };
}
function tryCircumcircle(a: Point2, b: Point2, c: Point2): { center: Point2; radius: number } | undefined { try { return circumcircle(a, b, c); } catch { return undefined; } }

function thirdPointForRadius(a: Point2, b: Point2, hint: Point2, radius: number): Point2 {
  const chord = distance(a, b);
  if (chord < NM_EPSILON) throw new Error("The first two points must be distinct");
  if (radius < chord / 2) throw new Error("Radius is too small for the fixed point chord");
  const mid = { x_nm: (a.x_nm + b.x_nm) / 2, y_nm: (a.y_nm + b.y_nm) / 2 };
  const axis = safeUnit(a, b); const normal = { x: -axis.y, y: axis.x };
  const centerOffset = Math.sqrt(Math.max(0, radius ** 2 - (chord / 2) ** 2));
  const side = signOrPositive((hint.x_nm - mid.x_nm) * normal.x + (hint.y_nm - mid.y_nm) * normal.y);
  // A point on the opposite side of the chord from the chosen center avoids
  // collapsing back onto either fixed chord endpoint.
  const center = offset(mid, normal, -side * centerOffset);
  const hintDirection = safeUnit(center, hint, { x: normal.x * side, y: normal.y * side });
  const candidate = offset(center, hintDirection, radius);
  if (distance(candidate, a) < NM_EPSILON || distance(candidate, b) < NM_EPSILON) return offset(center, { x: normal.x * side, y: normal.y * side }, radius);
  return candidate;
}
