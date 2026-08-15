import { rectangleCommands, type Geometry, type Point2, type Sketch, type SketchCommand, type StableId, type StableSketchIds } from "./sketch-editor.ts";
import { evaluateCurveFrame, projectPointToGeometryCurve } from "./sketch-spline.ts";

export type RectangleVariant = "two_point" | "three_point" | "center";
export type CircleVariant = "center_diameter" | "two_point" | "three_point" | "two_tangent" | "three_tangent";
export type ArcVariant = "center_point" | "three_point" | "tangent";
export type PolygonVariant = "inscribed" | "circumscribed" | "edge";
export type SlotVariant = "center_to_center" | "overall" | "center_point" | "three_point_arc";

export type SketchCreationVariant = RectangleVariant | CircleVariant | ArcVariant | PolygonVariant | SlotVariant;

export const SKETCH_CREATION_VARIANTS = {
  rectangle: [
    ["two_point", "2-Point Rectangle"], ["three_point", "3-Point Rectangle"], ["center", "Center Rectangle"],
  ],
  circle: [
    ["center_diameter", "Center Diameter Circle"], ["two_point", "2-Point Circle"], ["three_point", "3-Point Circle"],
    ["two_tangent", "2-Tangent Circle"], ["three_tangent", "3-Tangent Circle"],
  ],
  arc: [["center_point", "Center Point Arc"], ["three_point", "3-Point Arc"], ["tangent", "Tangent Arc"]],
  polygon: [["inscribed", "Inscribed Polygon"], ["circumscribed", "Circumscribed Polygon"], ["edge", "Edge Polygon"]],
  slot: [["center_to_center", "Center to Center Slot"], ["overall", "Overall Slot"], ["center_point", "Center Point Slot"], ["three_point_arc", "3-Point Arc Slot"]],
} as const;

export function creationVariantPointCount(tool: keyof typeof SKETCH_CREATION_VARIANTS, variant: string): number {
  if (tool === "rectangle") return variant === "three_point" ? 3 : 2;
  if (tool === "circle") return variant === "three_point" ? 3 : variant === "two_tangent" || variant === "three_tangent" ? 1 : 2;
  if (tool === "arc") return variant === "tangent" ? 2 : 3;
  if (tool === "polygon") return 2;
  return variant === "three_point_arc" ? 4 : 3;
}

export function rectangleVariantCommands(ids: StableSketchIds, variant: RectangleVariant, points: readonly Point2[]): SketchCommand[] {
  if (variant === "two_point") return rectangleCommands(ids, points[0], points[1]);
  let corners: Point2[];
  if (variant === "center") {
    const [center, corner] = points;
    if (same(center, corner)) throw new Error("Center rectangle must have positive width and height");
    const dx = corner.x_nm - center.x_nm; const dy = corner.y_nm - center.y_nm;
    corners = [p(center.x_nm - dx, center.y_nm - dy), p(center.x_nm + dx, center.y_nm - dy), p(center.x_nm + dx, center.y_nm + dy), p(center.x_nm - dx, center.y_nm + dy)];
  } else {
    const [first, second, widthPoint] = points;
    const axis = normalized(first, second); const normal = { x: -axis.y, y: axis.x };
    const width = dot(sub(widthPoint, first), normal);
    if (!axis.length || Math.abs(width) < 1) throw new Error("3-point rectangle must have positive length and width");
    corners = [first, second, translate(second, normal, width), translate(first, normal, width)];
  }
  return constrainedQuadrilateral(ids, corners, variant === "center");
}

export function circleVariantCommands(ids: StableSketchIds, variant: CircleVariant, points: readonly Point2[], tangentSources: readonly StableId[] = [], sketch?: Sketch): SketchCommand[] {
  let center: Point2; let radius: number;
  if (variant === "center_diameter") {
    center = points[0]; radius = distance(points[0], points[1]);
  } else if (variant === "two_point") {
    center = midpoint(points[0], points[1]); radius = distance(points[0], points[1]) / 2;
  } else if (variant === "three_point") {
    ({ center, radius } = circumcircle(points[0], points[1], points[2]));
  } else {
    const required = variant === "two_tangent" ? 2 : 3;
    if (tangentSources.length < required || !sketch) throw new Error(`Preselect ${required} curves for ${variant === "two_tangent" ? "2" : "3"}-tangent circle`);
    center = points[0];
    const distances = tangentSources.slice(0, required).map((id) => sketch.geometry[id]?.geometry).map((geometry) => geometry ? projectPointToGeometryCurve(geometry, center).distance_nm : 0);
    radius = distances.reduce((sum, value) => sum + value, 0) / required;
  }
  if (radius < 1) throw new Error("Circle must have positive radius");
  const circle = ids.next("geometry");
  const commands: SketchCommand[] = [{ kind: "add_geometry", entity: { id: circle, geometry: { kind: "circle", center, radius_nm: Math.round(radius) } } }];
  if (variant === "two_tangent" || variant === "three_tangent") {
    const required = variant === "two_tangent" ? 2 : 3;
    if (tangentSources.length < required) throw new Error(`Preselect ${required} curves for ${variant === "two_tangent" ? "2" : "3"}-tangent circle`);
    for (const source of tangentSources.slice(0, required)) commands.push({ kind: "add_constraint", id: ids.next("constraint"), constraint: { kind: "tangent", first: source, second: circle } });
  }
  return commands;
}

export function arcVariantCommands(ids: StableSketchIds, variant: ArcVariant, points: readonly Point2[], sketch?: Sketch, tangentSource?: StableId): SketchCommand[] {
  let center: Point2; let start: Point2; let end: Point2; let clockwise = false;
  if (variant === "center_point") {
    [center, start] = points; end = radialProjection(center, start, points[2]);
  } else if (variant === "three_point") {
    start = points[0]; const through = points[1]; end = points[2];
    ({ center } = circumcircle(start, through, end));
    clockwise = !angleWithinSweep(angle(center, start), angle(center, through), angle(center, end), false);
  } else {
    start = points[0]; end = points[1];
    const source = tangentSource && sketch?.geometry[tangentSource]?.geometry;
    if (!source) throw new Error("Preselect one source curve for a tangent arc");
    const projection = projectPointToGeometryCurve(source, start);
    start = projection.point;
    const frame = evaluateCurveFrame(source, projection.parameter);
    const delta = sub(end, start); const candidates = [{ x: -frame.tangent.y, y: frame.tangent.x }, { x: frame.tangent.y, y: -frame.tangent.x }];
    const solved = candidates.map((normal) => ({ normal, radius: dot(delta, delta) / (2 * dot(delta, normal)) })).filter((value) => Number.isFinite(value.radius) && Math.abs(value.radius) >= 1).sort((a, b) => Math.abs(a.radius) - Math.abs(b.radius))[0];
    if (!solved) throw new Error("Tangent arc endpoint is degenerate");
    center = translate(start, solved.normal, solved.radius);
    end = radialProjection(center, start, end);
    clockwise = cross(sub(start, center), sub(end, center)) < 0;
  }
  if (same(start, end) || distance(center, start) < 1) throw new Error("Arc must have positive radius and sweep");
  const arc = ids.next("geometry");
  const commands: SketchCommand[] = [{ kind: "add_geometry", entity: { id: arc, geometry: { kind: "arc", center, start, end, clockwise } } }];
  if (variant === "tangent" && tangentSource) commands.push({ kind: "add_constraint", id: ids.next("constraint"), constraint: { kind: "tangent", first: tangentSource, second: arc, second_parameter_millionths: 0 } });
  return commands;
}

export function polygonVariantCommands(ids: StableSketchIds, variant: PolygonVariant, first: Point2, second: Point2, sides = 6): SketchCommand[] {
  if (!Number.isInteger(sides) || sides < 3 || sides > 128) throw new Error("Polygon sides must be from 3 to 128");
  let center = first; let radius: number; let orientation: number;
  if (variant === "edge") {
    const axis = normalized(first, second); if (!axis.length) throw new Error("Polygon edge must have positive length");
    const apothem = axis.length / (2 * Math.tan(Math.PI / sides));
    center = translate(midpoint(first, second), { x: -axis.y, y: axis.x }, apothem);
    radius = axis.length / (2 * Math.sin(Math.PI / sides)); orientation = angle(center, first);
  } else {
    const picked = distance(first, second); if (picked < 1) throw new Error("Polygon radius must be positive");
    radius = variant === "circumscribed" ? picked / Math.cos(Math.PI / sides) : picked;
    orientation = angle(first, second) - (variant === "circumscribed" ? Math.PI / sides : 0);
  }
  const vertices = Array.from({ length: sides }, (_, index) => radial(center, radius, orientation + index * Math.PI * 2 / sides));
  const recipeId = ids.next("recipe"); const commands = constrainedPolygon(ids, vertices, recipeId);
  commands.push({ kind: "add_recipe", id: recipeId, recipe: { kind: "polygon", mode: variant, center, radius_nm: Math.round(variant === "circumscribed" ? radius * Math.cos(Math.PI / sides) : radius), sides, orientation_microdegrees: Math.round(orientation * 180 / Math.PI * 1_000_000), geometry: geometryIds(commands) } });
  return commands;
}

export function slotVariantCommands(ids: StableSketchIds, variant: SlotVariant, points: readonly Point2[]): SketchCommand[] {
  if (variant === "three_point_arc") return arcSlotCommands(ids, points);
  let first = points[0]; let second = points[1];
  const axis = normalized(first, second); if (!axis.length) throw new Error("Slot length must be positive");
  const normal = { x: -axis.y, y: axis.x };
  let radius = Math.abs(dot(sub(points[2], variant === "center_point" ? points[0] : first), normal));
  if (radius < 1) throw new Error("Slot width must be positive");
  if (variant === "center_point") { first = p(2 * points[0].x_nm - second.x_nm, 2 * points[0].y_nm - second.y_nm); }
  if (variant === "overall") {
    const total = distance(first, second); if (total <= radius * 2) throw new Error("Overall slot length must exceed its width");
    first = translate(first, axis, radius); second = translate(second, axis, -radius);
  }
  return straightSlotCommands(ids, variant, first, second, radius);
}

function straightSlotCommands(ids: StableSketchIds, mode: SlotVariant, first: Point2, second: Point2, radius: number): SketchCommand[] {
  const axis = normalized(first, second); const normal = { x: -axis.y, y: axis.x };
  const aTop = translate(first, normal, radius); const bTop = translate(second, normal, radius); const aBottom = translate(first, normal, -radius); const bBottom = translate(second, normal, -radius);
  const geometry = [ids.next("geometry"), ids.next("geometry"), ids.next("geometry"), ids.next("geometry")];
  const commands: SketchCommand[] = [
    addLine(geometry[0], aTop, bTop), addArc(geometry[1], second, bTop, bBottom, true),
    // Keep opposite line directions equivalent. EZPZ line relations are
    // orientation-aware during projection, while CAD parallelism is not.
    addLine(geometry[2], aBottom, bBottom), addArc(geometry[3], first, aBottom, aTop, true),
  ];
  addClosedLoopConstraints(commands, ids, [
    [geometry[0], "end", geometry[1], "start"],
    [geometry[1], "end", geometry[2], "end"],
    [geometry[2], "start", geometry[3], "start"],
    [geometry[3], "end", geometry[0], "start"],
  ]);
  commands.push({ kind: "add_constraint", id: ids.next("constraint"), constraint: { kind: "parallel", first: geometry[0], second: geometry[2] } });
  commands.push({ kind: "add_constraint", id: ids.next("constraint"), constraint: { kind: "equal", first: geometry[1], second: geometry[3] } });
  for (const [line, arc, lineParameter, arcParameter] of [
    [geometry[0], geometry[1], 1_000_000, 0],
    [geometry[2], geometry[1], 1_000_000, 1_000_000],
    [geometry[2], geometry[3], 0, 0],
    [geometry[0], geometry[3], 0, 1_000_000],
  ] as const) commands.push({ kind: "add_constraint", id: ids.next("constraint"), constraint: { kind: "tangent", first: line, second: arc, first_parameter_millionths: lineParameter, second_parameter_millionths: arcParameter } });
  commands.push({ kind: "add_recipe", id: ids.next("recipe"), recipe: { kind: "slot", mode, first, second, radius_nm: Math.round(radius), geometry } });
  return commands;
}

function arcSlotCommands(ids: StableSketchIds, points: readonly Point2[]): SketchCommand[] {
  const [start, through, end, widthPoint] = points; const { center, radius } = circumcircle(start, through, end);
  const width = distance(through, widthPoint); if (width < 1 || width >= radius) throw new Error("Arc slot width must be positive and smaller than its centerline radius");
  const clockwise = !angleWithinSweep(angle(center, start), angle(center, through), angle(center, end), false);
  const outerRadius = radius + width; const innerRadius = radius - width;
  const outerStart = radial(center, outerRadius, angle(center, start)); const outerEnd = radial(center, outerRadius, angle(center, end));
  const innerStart = radial(center, innerRadius, angle(center, start)); const innerEnd = radial(center, innerRadius, angle(center, end));
  const geometry = [ids.next("geometry"), ids.next("geometry"), ids.next("geometry"), ids.next("geometry")];
  const commands: SketchCommand[] = [addArc(geometry[0], center, outerStart, outerEnd, clockwise), addArc(geometry[1], end, outerEnd, innerEnd, clockwise), addArc(geometry[2], center, innerEnd, innerStart, !clockwise), addArc(geometry[3], start, innerStart, outerStart, clockwise)];
  addClosedChainConstraints(commands, ids, geometry);
  commands.push({ kind: "add_recipe", id: ids.next("recipe"), recipe: { kind: "slot", mode: "three_point_arc", first: start, second: end, center, through, radius_nm: Math.round(width), geometry } });
  return commands;
}

function constrainedQuadrilateral(ids: StableSketchIds, corners: readonly Point2[], centered: boolean): SketchCommand[] {
  if (corners.some((value, index) => same(value, corners[(index + 1) % 4]))) throw new Error("Rectangle must have positive width and height");
  const geometry = corners.map(() => ids.next("geometry"));
  const positiveTurn = cross(sub(corners[1], corners[0]), sub(corners[2], corners[1])) >= 0;
  const commands = positiveTurn ? [
    addLine(geometry[0], corners[0], corners[1]), addLine(geometry[1], corners[1], corners[2]),
    addLine(geometry[2], corners[3], corners[2]), addLine(geometry[3], corners[0], corners[3]),
  ] : [
    addLine(geometry[0], corners[0], corners[1]), addLine(geometry[1], corners[2], corners[1]),
    addLine(geometry[2], corners[3], corners[2]), addLine(geometry[3], corners[3], corners[0]),
  ];
  addClosedLoopConstraints(commands, ids, positiveTurn ? [
    [geometry[0], "end", geometry[1], "start"], [geometry[1], "end", geometry[2], "end"],
    [geometry[2], "start", geometry[3], "end"], [geometry[3], "start", geometry[0], "start"],
  ] : [
    [geometry[0], "end", geometry[1], "end"], [geometry[1], "start", geometry[2], "end"],
    [geometry[2], "start", geometry[3], "start"], [geometry[3], "end", geometry[0], "start"],
  ]);
  commands.push({ kind: "add_constraint", id: ids.next("constraint"), constraint: { kind: "parallel", first: geometry[0], second: geometry[2] } }, { kind: "add_constraint", id: ids.next("constraint"), constraint: { kind: "parallel", first: geometry[1], second: geometry[3] } }, { kind: "add_constraint", id: ids.next("constraint"), constraint: { kind: "perpendicular", first: geometry[0], second: geometry[1] } });
  if (centered) {
    const diagonal=ids.next("geometry");const centerPoint=ids.next("geometry");
    commands.push({kind:"add_geometry",entity:{id:diagonal,construction:true,geometry:{kind:"line",start:corners[0],end:corners[2]}}},{kind:"add_geometry",entity:{id:centerPoint,construction:true,geometry:{kind:"sketch_point",x_nm:Math.round((corners[0].x_nm+corners[2].x_nm)/2),y_nm:Math.round((corners[0].y_nm+corners[2].y_nm)/2)}}});
    commands.push({kind:"add_constraint",id:ids.next("constraint"),constraint:{kind:"coincident",a:{geometry:diagonal,anchor:"start"},b:{geometry:geometry[0],anchor:"start"}}},{kind:"add_constraint",id:ids.next("constraint"),constraint:{kind:"coincident",a:{geometry:diagonal,anchor:"end"},b:{geometry:geometry[2],anchor:"end"}}},{kind:"add_constraint",id:ids.next("constraint"),constraint:{kind:"midpoint",point:{geometry:centerPoint,anchor:"position"},line:diagonal}});
  }
  return commands;
}

function constrainedPolygon(ids: StableSketchIds, points: readonly Point2[], recipeId: string): SketchCommand[] {
  const geometry = points.map(() => ids.next("geometry")); const commands = geometry.map((id, index) => addLine(id, points[index], points[(index + 1) % points.length]));
  addClosedChainConstraints(commands, ids, geometry);
  for (let index = 1; index < geometry.length; index += 1) commands.push({ kind: "add_constraint", id: `recipe:${recipeId}:equal:${index}`, constraint: { kind: "equal", first: geometry[0], second: geometry[index] } });
  return commands;
}

function addClosedChainConstraints(commands: SketchCommand[], ids: StableSketchIds, geometry: readonly StableId[]): void {
  geometry.forEach((id, index) => commands.push({ kind: "add_constraint", id: ids.next("constraint"), constraint: { kind: "coincident", a: { geometry: id, anchor: "end" }, b: { geometry: geometry[(index + 1) % geometry.length], anchor: "start" } } }));
}

function addClosedLoopConstraints(
  commands: SketchCommand[],
  ids: StableSketchIds,
  joins: readonly (readonly [StableId, "start" | "end", StableId, "start" | "end"])[],
): void {
  for (const [first, firstAnchor, second, secondAnchor] of joins) commands.push({
    kind: "add_constraint",
    id: ids.next("constraint"),
    constraint: { kind: "coincident", a: { geometry: first, anchor: firstAnchor }, b: { geometry: second, anchor: secondAnchor } },
  });
}

function addLine(id: StableId, start: Point2, end: Point2): SketchCommand { return { kind: "add_geometry", entity: { id, geometry: { kind: "line", start, end } } }; }
function addArc(id: StableId, center: Point2, start: Point2, end: Point2, clockwise: boolean): SketchCommand { return { kind: "add_geometry", entity: { id, geometry: { kind: "arc", center, start, end, clockwise } } }; }
function geometryIds(commands: readonly SketchCommand[]): StableId[] { return commands.flatMap((command) => command.kind === "add_geometry" ? [command.entity.id] : []); }
function p(x_nm: number, y_nm: number): Point2 { return { x_nm: Math.round(x_nm), y_nm: Math.round(y_nm) }; }
function sub(a: Point2, b: Point2): { x: number; y: number } { return { x: a.x_nm - b.x_nm, y: a.y_nm - b.y_nm }; }
function dot(a: { x: number; y: number }, b: { x: number; y: number }): number { return a.x * b.x + a.y * b.y; }
function cross(a: { x: number; y: number }, b: { x: number; y: number }): number { return a.x * b.y - a.y * b.x; }
function distance(a: Point2, b: Point2): number { return Math.hypot(a.x_nm - b.x_nm, a.y_nm - b.y_nm); }
function midpoint(a: Point2, b: Point2): Point2 { return p((a.x_nm + b.x_nm) / 2, (a.y_nm + b.y_nm) / 2); }
function same(a: Point2, b: Point2): boolean { return a.x_nm === b.x_nm && a.y_nm === b.y_nm; }
function normalized(a: Point2, b: Point2): { x: number; y: number; length: number } { const length = distance(a, b); return length ? { x: (b.x_nm - a.x_nm) / length, y: (b.y_nm - a.y_nm) / length, length } : { x: 0, y: 0, length: 0 }; }
function translate(point: Point2, direction: { x: number; y: number }, amount: number): Point2 { return p(point.x_nm + direction.x * amount, point.y_nm + direction.y * amount); }
function radial(center: Point2, radius: number, radians: number): Point2 { return p(center.x_nm + radius * Math.cos(radians), center.y_nm + radius * Math.sin(radians)); }
function angle(center: Point2, point: Point2): number { return Math.atan2(point.y_nm - center.y_nm, point.x_nm - center.x_nm); }
function radialProjection(center: Point2, radiusPoint: Point2, target: Point2): Point2 { const radius = distance(center, radiusPoint); const targetRadius = distance(center, target); if (radius < 1 || targetRadius < 1) throw new Error("Arc must have positive radius"); return p(center.x_nm + (target.x_nm - center.x_nm) * radius / targetRadius, center.y_nm + (target.y_nm - center.y_nm) * radius / targetRadius); }
function circumcircle(a: Point2, b: Point2, c: Point2): { center: Point2; radius: number } {
  const d = 2 * (a.x_nm * (b.y_nm - c.y_nm) + b.x_nm * (c.y_nm - a.y_nm) + c.x_nm * (a.y_nm - b.y_nm));
  if (Math.abs(d) < 1) throw new Error("Points must not be collinear");
  const aa = a.x_nm ** 2 + a.y_nm ** 2; const bb = b.x_nm ** 2 + b.y_nm ** 2; const cc = c.x_nm ** 2 + c.y_nm ** 2;
  const center = p((aa * (b.y_nm - c.y_nm) + bb * (c.y_nm - a.y_nm) + cc * (a.y_nm - b.y_nm)) / d, (aa * (c.x_nm - b.x_nm) + bb * (a.x_nm - c.x_nm) + cc * (b.x_nm - a.x_nm)) / d);
  return { center, radius: distance(center, a) };
}
function angleWithinSweep(start: number, through: number, end: number, clockwise: boolean): boolean { const tau = Math.PI * 2; const norm = (v: number) => (v % tau + tau) % tau; return clockwise ? norm(start - through) <= norm(start - end) : norm(through - start) <= norm(end - start); }
