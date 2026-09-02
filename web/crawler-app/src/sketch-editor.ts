import type { SketchPlaneSupport } from "./sketch-plane";
import { evaluateGeometryCurve, geometryCurveSearchParameters, projectPointToEllipse, projectPointToGeometryCurve, sampleConic, sampleControlPointSpline, sampleEllipse, sampleEllipticalArc, sampleFitPointSpline } from "./sketch-spline.ts";

export type StableId = string;
export type Point2 = { x_nm: number; y_nm: number };
export type Anchor = "start" | "end" | "center" | "min" | "max" | "major" | "minor" | "control" | "position" | `control:${number}` | `fit:${number}` | `knot:${number}` | `parameter:${number}`;
export type PointRef = { geometry: StableId; anchor: Anchor };
export const IMPLIED_ORIGIN_POINT: PointRef = { geometry: "reference:origin", anchor: "center" };

export type Geometry =
  | { kind: "line"; start: Point2; end: Point2 }
  | { kind: "circle"; center: Point2; radius_nm: number }
  | { kind: "arc"; center: Point2; start: Point2; end: Point2; clockwise: boolean }
  | { kind: "rectangle"; min: Point2; max: Point2 }
  | { kind: "control_point_spline"; degree: number; control_points: Point2[]; knots_millionths?: number[] }
  | { kind: "fit_point_spline"; fit_points: Point2[] }
  | { kind: "ellipse"; center: Point2; major: Point2; minor: Point2 }
  | { kind: "elliptical_arc"; center: Point2; major: Point2; minor: Point2; start: Point2; end: Point2; clockwise: boolean }
  | { kind: "conic"; start: Point2; control: Point2; end: Point2; weight_millionths: number }
  | { kind: "sketch_point"; x_nm: number; y_nm: number };

export type GeometryEntity = {
  id: StableId;
  construction?: boolean;
  geometry: Geometry;
};

export type SketchRecipe =
  | { kind: "polygon"; mode?: "inscribed" | "circumscribed" | "edge"; center: Point2; radius_nm: number; sides: number; orientation_microdegrees: number; geometry: StableId[] }
  | { kind: "slot"; mode?: "center_to_center" | "overall" | "center_point" | "three_point_arc"; first: Point2; second: Point2; center?: Point2; through?: Point2; radius_nm: number; geometry: StableId[] }
  | { kind: "text"; text: string; origin: Point2; height_nm: number; rotation_microdegrees: number; tracking_millionths: number; horizontal_alignment: "left" | "center" | "right"; path?: StableId; path_start_millionths: number; reversed: boolean; geometry: StableId[] };

export type OffsetResultSpan = {
  result: StableId;
  source_start_millionths: number;
  source_end_millionths: number;
  /** Only populated when the kernel has a conservative analytic error bound. */
  certified_error_nm?: number;
};

export type SketchOperation =
  | { kind: "offset"; sources: StableId[]; result_chains: StableId[][]; distance_nm: number; two_sided: boolean; linked: boolean; model_tolerance_nm?: number; result_spans?: OffsetResultSpan[][] }
  | { kind: "mirror"; sources: StableId[]; axis?: StableId; results: StableId[]; linked: boolean }
  | { kind: "linear_pattern"; sources: StableId[]; instances: StableId[][]; count: number; spacing: Point2; extent: boolean; suppressed_instances: number[] }
  | { kind: "circular_pattern"; sources: StableId[]; instances: StableId[][]; center: Point2; count: number; angle_microdegrees: number; suppressed_instances: number[] }
  | { kind: "fillet"; first: StableId; second: StableId; result: StableId; radius_nm: number }
  | { kind: "chamfer"; first: StableId; second: StableId; result: StableId; first_distance_nm: number; second_distance_nm: number; angle_microdegrees: number; mode: "equal_distance" | "two_distance" | "distance_angle" }
  | { kind: "break"; source: StableId; results: StableId[]; parameters_millionths: number[] }
  | { kind: "scale"; sources: StableId[]; results: StableId[]; originals: Geometry[]; center: Point2; factor_millionths: number; copy: boolean }
  | { kind: "move_copy"; sources: StableId[]; results: StableId[]; originals: Geometry[]; delta: Point2; copy: boolean }
  | { kind: "blend"; first: StableId; second: StableId; result: StableId; continuity: "tangent" | "g2"; magnitude_nm: number }
  | { kind: "project_include"; source_kind: "point" | "edge" | "face" | "body" | "work_geometry" | "sketch" | "plane_intersection"; source_ids: StableId[]; results: StableId[]; linked: boolean; locked: boolean; intersect_plane: boolean; missing: boolean };

export type Constraint =
  | { kind: "coincident"; a: PointRef; b: PointRef }
  | { kind: "point_on_origin"; point: PointRef }
  | { kind: "fixed"; point: PointRef; x_nm: number; y_nm: number }
  | { kind: "fixed_geometry"; geometry: StableId }
  | { kind: "midpoint"; point: PointRef; line: StableId }
  | { kind: "concentric"; first: StableId; second: StableId }
  | { kind: "point_on_object"; point: PointRef; geometry: StableId }
  | { kind: "horizontal"; line: StableId }
  | { kind: "vertical"; line: StableId }
  | { kind: "horizontal_points"; a: PointRef; b: PointRef }
  | { kind: "vertical_points"; a: PointRef; b: PointRef }
  | { kind: "collinear"; point: PointRef; line: StableId }
  | { kind: "symmetry"; first: PointRef; second: PointRef; axis: StableId }
  | { kind: "curvature_continuous"; first: StableId; second: StableId }
  | { kind: "parallel"; first: StableId; second: StableId }
  | { kind: "perpendicular"; first: StableId; second: StableId }
  | { kind: "tangent"; first: StableId; second: StableId; first_parameter_millionths?: number; second_parameter_millionths?: number }
  | { kind: "equal"; first: StableId; second: StableId }
  | { kind: "distance"; a: PointRef; b: PointRef; distance_nm: number }
  | { kind: "distance_x"; a: PointRef; b: PointRef; distance_nm: number }
  | { kind: "distance_y"; a: PointRef; b: PointRef; distance_nm: number }
  | { kind: "point_line_distance"; point: PointRef; line: StableId; distance_nm: number }
  | { kind: "line_distance"; first: StableId; second: StableId; distance_nm: number }
  | { kind: "offset_distance"; source: StableId; offset: StableId; distance_nm: number; source_start_millionths: number; source_end_millionths: number }
  | { kind: "radius"; geometry: StableId; radius_nm: number }
  | { kind: "diameter"; geometry: StableId; diameter_nm: number }
  | { kind: "ellipse_radius"; geometry: StableId; axis: "major" | "minor"; radius_nm: number }
  | { kind: "angle"; first: StableId; second: StableId; angle_microdegrees: number }
  | { kind: "angle_to_axis"; line: StableId; axis: "x" | "y"; angle_microdegrees: number };

export type Sketch = {
  id: StableId;
  revision: number;
  geometry: Record<StableId, GeometryEntity>;
  constraints: Record<StableId, Constraint>;
  dimension_parameters?: Record<StableId, StableId>;
  dimension_positions?: Record<StableId, Point2>;
  recipes?: Record<StableId, SketchRecipe>;
  operations?: Record<StableId, SketchOperation>;
  external_references?: Record<StableId, { body: StableId; stable_kernel_id: string }>;
  suppressed_constraints?: StableId[];
};

/**
 * A recursively immutable view of a sketch. Render and inspection paths should
 * prefer this over `SketchEditSession.draft`, whose compatibility contract is
 * to return a fresh mutable snapshot.
 */
export type SketchDraftView = {
  readonly [Key in keyof Sketch]: Sketch[Key] extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : DeepReadonly<Sketch[Key]>;
};

type TangencyGeometryLookup = Readonly<Record<StableId, { readonly geometry: Geometry }>>;

/**
 * A non-degenerate centered curve cannot be tangent to a line that already
 * contains its center. Rejecting that pair before it reaches the solver keeps
 * an otherwise valid sketch from entering a guaranteed conflict state.
 */
export function tangentConflictsWithCenterOnLine(
  sketch: Pick<Sketch, "geometry" | "constraints" | "suppressed_constraints">,
  first: StableId,
  second: StableId,
  additionalConstraints: readonly Constraint[] = [],
  additionalGeometry: TangencyGeometryLookup = {},
): boolean {
  const geometry = (id: StableId) => additionalGeometry[id]?.geometry ?? sketch.geometry[id]?.geometry;
  const firstGeometry = geometry(first);
  const secondGeometry = geometry(second);
  const line = firstGeometry?.kind === "line" ? first : secondGeometry?.kind === "line" ? second : undefined;
  const centered = firstGeometry && ["circle", "arc", "ellipse", "elliptical_arc"].includes(firstGeometry.kind) ? first
    : secondGeometry && ["circle", "arc", "ellipse", "elliptical_arc"].includes(secondGeometry.kind) ? second
      : undefined;
  if (!line || !centered) return false;

  const isCenter = (point: PointRef) => point.geometry === centered && point.anchor === "center";
  const isLinePoint = (point: PointRef) => point.geometry === line;
  const suppressed = new Set(sketch.suppressed_constraints ?? []);
  const activeConstraints = Object.entries(sketch.constraints).flatMap(([id, constraint]) => suppressed.has(id) ? [] : [constraint]);
  return [...activeConstraints, ...additionalConstraints].some((constraint) => {
    if (constraint.kind === "midpoint" || constraint.kind === "collinear") return constraint.line === line && isCenter(constraint.point);
    if (constraint.kind === "point_on_object") return constraint.geometry === line && isCenter(constraint.point);
    if (constraint.kind === "coincident") return (isCenter(constraint.a) && isLinePoint(constraint.b)) || (isCenter(constraint.b) && isLinePoint(constraint.a));
    return false;
  });
}

/** Remove only tangencies that are guaranteed to conflict with center-on-line
 * constraints in the same command batch. Other tangencies remain untouched. */
export function filterCenterOnLineTangencies(
  sketch: Pick<Sketch, "geometry" | "constraints" | "suppressed_constraints">,
  commands: readonly SketchCommand[],
  additionalGeometry: TangencyGeometryLookup = {},
): SketchCommand[] {
  const additionalConstraints = commands.flatMap((command) => command.kind === "add_constraint" ? [command.constraint] : []);
  return commands.filter((command) => command.kind !== "add_constraint"
    || command.constraint.kind !== "tangent"
    || !tangentConflictsWithCenterOnLine(
      sketch,
      command.constraint.first,
      command.constraint.second,
      additionalConstraints,
      additionalGeometry,
    ));
}

type DeepReadonly<Value> = Value extends (...args: never[]) => unknown
  ? Value
  : Value extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : Value extends object
      ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
      : Value;

function deepFreeze<Value>(value: Value, seen = new WeakSet<object>()): DeepReadonly<Value> {
  if (value === null || typeof value !== "object" || seen.has(value)) return value as DeepReadonly<Value>;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value) as DeepReadonly<Value>;
}

export type SketchCommand =
  | { kind: "add_geometry"; entity: GeometryEntity }
  | { kind: "remove_geometry"; geometry: StableId }
  | { kind: "add_constraint"; id: StableId; constraint: Constraint }
  | { kind: "set_constraint"; id: StableId; constraint: Constraint }
  | { kind: "remove_constraint"; constraint: StableId }
  | { kind: "set_constraint_suppressed"; constraint: StableId; suppressed: boolean }
  | { kind: "set_dimension_position"; constraint: StableId; position: Point2 }
  | { kind: "add_recipe"; id: StableId; recipe: SketchRecipe }
  | { kind: "set_recipe"; id: StableId; recipe: SketchRecipe }
  | { kind: "remove_recipe"; id: StableId }
  | { kind: "add_operation"; id: StableId; operation: SketchOperation }
  | { kind: "set_operation"; id: StableId; operation: SketchOperation }
  | { kind: "remove_operation"; id: StableId }
  | { kind: "move_point"; point: PointRef; to: Point2 }
  | { kind: "set_radius"; geometry: StableId; radius_nm: number }
  | { kind: "set_conic_weight"; geometry: StableId; weight_millionths: number }
  | { kind: "set_construction"; geometry: StableId; construction: boolean }
  | {
      kind: "trim";
      operation:
        | { kind: "split_line"; source: StableId; first: StableId; second: StableId; at: Point2 }
        | {
            kind: "open_circle";
            source: StableId;
            replacement: StableId;
            start: Point2;
            end: Point2;
            clockwise: boolean;
          };
    };

export type SolveState =
  | "under_constrained"
  | "fully_constrained"
  | "over_constrained"
  | "conflicting";

export type SolveResult = {
  state: SolveState;
  degrees_of_freedom: number;
  underconstrained_variables?: number;
  solve_components?: Array<{
    id: number;
    geometry: StableId[];
    constraints: StableId[];
    variable_count: number;
    equation_count: number;
    structural_rank: number;
    structural_degrees_of_freedom: number;
    structurally_redundant_equations: number;
  }>;
  active_constraints: StableId[];
  redundant_constraints: StableId[];
  conflicts: Array<{ constraints: StableId[]; reason: { kind: string; [key: string]: unknown } }>;
};

/**
 * Compatibility normalization for runtimes produced before semantic
 * redundancy detection was added to the native solver. A point constrained
 * to a line midpoint and held at the origin—directly, fixed at zero, or via
 * coincident points—already implies that the line's midpoint is the origin;
 * counting the direct relation again can create a false overconstraint.
 */
export function normalizeImpliedOriginMidpointSolve(sketch: Sketch, solve: SolveResult): SolveResult {
  const suppressed = new Set(sketch.suppressed_constraints ?? []);
  const entries = Object.entries(sketch.constraints).filter(([id]) => !suppressed.has(id));
  const pointKey = (point: PointRef): string => `${point.geometry}\0${point.anchor}`;
  const coincidentNeighbors = new Map<string, Set<string>>();
  const pointsOnOrigin = new Set(entries.flatMap(([, constraint]) => {
    if (constraint.kind === "point_on_origin") return [pointKey(constraint.point)];
    if (constraint.kind === "fixed" && constraint.x_nm === 0 && constraint.y_nm === 0) return [pointKey(constraint.point)];
    return [];
  }));
  for (const [, constraint] of entries) {
    if (constraint.kind !== "coincident") continue;
    const a = pointKey(constraint.a);
    const b = pointKey(constraint.b);
    const aNeighbors = coincidentNeighbors.get(a) ?? new Set<string>();
    const bNeighbors = coincidentNeighbors.get(b) ?? new Set<string>();
    aNeighbors.add(b);
    bNeighbors.add(a);
    coincidentNeighbors.set(a, aNeighbors);
    coincidentNeighbors.set(b, bNeighbors);
  }
  const frontier = [...pointsOnOrigin];
  while (frontier.length) {
    const point = frontier.pop()!;
    for (const neighbor of coincidentNeighbors.get(point) ?? []) {
      if (pointsOnOrigin.has(neighbor)) continue;
      pointsOnOrigin.add(neighbor);
      frontier.push(neighbor);
    }
  }
  const redundant = entries.flatMap(([id, constraint]) => {
    if (constraint.kind !== "midpoint" || constraint.point.geometry !== IMPLIED_ORIGIN_POINT.geometry || constraint.point.anchor !== IMPLIED_ORIGIN_POINT.anchor) return [];
    const implied = entries.some(([, candidate]) => candidate.kind === "midpoint"
      && candidate.line === constraint.line
      && candidate.point.geometry !== IMPLIED_ORIGIN_POINT.geometry
      && pointsOnOrigin.has(pointKey(candidate.point)));
    return implied ? [id] : [];
  });
  if (!redundant.length) return solve;

  const redundantSet = new Set(redundant);
  const solveComponents = solve.solve_components?.map((component) => {
    const removed = component.constraints.filter((id) => redundantSet.has(id)).length;
    if (!removed) return component;
    const equationCount = Math.max(0, component.equation_count - removed * 2);
    return {
      ...component,
      constraints: component.constraints.filter((id) => !redundantSet.has(id)),
      equation_count: equationCount,
      structurally_redundant_equations: Math.max(0, equationCount - component.structural_rank),
    };
  });
  const stillOverconstrained = solveComponents?.some((component) => component.equation_count > component.structural_rank)
    ?? solve.state === "over_constrained";
  const conflicts = stillOverconstrained
    ? solve.conflicts
    : solve.conflicts.filter((conflict) => conflict.reason.kind !== "excess_independent_constraints");
  const hasGeometricConflict = conflicts.some((conflict) => conflict.reason.kind !== "excess_independent_constraints");
  return {
    ...solve,
    state: hasGeometricConflict ? "conflicting" : stillOverconstrained ? "over_constrained" : solve.degrees_of_freedom === 0 ? "fully_constrained" : "under_constrained",
    solve_components: solveComponents,
    active_constraints: solve.active_constraints.filter((id) => !redundantSet.has(id)),
    redundant_constraints: [...new Set([...solve.redundant_constraints, ...redundant])].sort(),
    conflicts,
  };
}

export type SketchDecomposition = { components: NonNullable<SolveResult["solve_components"]> };

export type SketchSolverContract = {
  schema_version: number;
  frontend: string;
  backend: string;
  backend_version: string;
  numeric_units: string;
  coordinate_space: string;
  support_reference_kinds: string[];
  resolved_plane_frame_fields: string[];
  geometry_kinds: string[];
  constraint_kinds: string[];
  operations: string[];
  diagnostics: string[];
};

export type ProfileReport = {
  closed_profiles: StableId[][];
  diagnostics: Array<{ kind: string; [key: string]: unknown }>;
};

/** Phase-local counters for verifying that obsolete profile diagnostics are skipped. */
export type ProfileDiagnosticsInstrumentation = Readonly<{
  scheduled: number;
  skipped: number;
  executed: number;
  published: number;
}>;

/** Phase-local counters for proving the profile diagnostic broad phase avoids
 * exact segment work without changing the diagnostic result. */
export type ProfileDiagnosticsBroadPhaseInstrumentation = {
  entityCount: number;
  sampledSegmentCount: number;
  candidateEntityPairs: number;
  rejectedEntityPairs: number;
  rejectedSegmentPairs: number;
  exactSegmentComparisons: number;
};

export type SketchPreview = {
  sketch: Sketch;
  solve: SolveResult;
  profile: ProfileReport;
  document_hash: string;
  runtime_performance?: {
    requestParseMs: number;
    applyBatchMs: number;
    solveMs: number;
    profileMs: number;
    documentHashMs: number;
  };
};

/**
 * An immutable, session-owned worker result that may be accepted without a
 * second kernel request. The opaque identity prevents callers from accepting
 * a fabricated result or one prepared against an older draft.
 */
export type PreparedSketchPreview = Readonly<{
  request_id: string;
  base_sketch_id: StableId;
  base_revision: number;
  preview: SketchPreview;
}>;

export type SketchTopologyReference = {
  schema_version: 1;
  id: StableId;
  component: StableId;
  body: StableId;
  producer: StableId;
  kind: "face";
  /** Decimal u64. Never parse this identity through JavaScript Number. */
  stable_kernel_id: string;
  stable_token: string;
  fallback_signature: {
    kind: "face";
    centroid_nanometers: [number, number, number];
    normal_millionths: [number, number, number];
    area_square_nanometers: number;
  };
};

export interface SketchRuntimeBridge {
  readonly transportIsolation?: "structured-clone";
  applySketchCommand(request: { sketch: Sketch; command: SketchCommand }): Promise<SketchPreview>;
  applySketchCommands(request: { sketch: Sketch; commands: SketchCommand[] }): Promise<SketchPreview>;
  dragSketch(request: {
    sketch: Sketch;
    drag: { point: PointRef; target: Point2 };
  }): Promise<{ drag: { accepted: boolean; sketch: Sketch; resolved: Point2; solve: SolveResult }; profile: ProfileReport }>;
  solveSketch(request: { transaction_id: string; sketch: Sketch; support: SketchSupport; support_reference?: SketchTopologyReference }): Promise<{ accepted: boolean; solve: SolveResult }>;
}

export const SKETCH_TOOL_SCHEMA = [
  { id: "line", label: "Line", points: 2 },
  { id: "circle", label: "Circle", points: 2 },
  { id: "arc", label: "Arc", points: 3 },
  { id: "rectangle", label: "Rectangle", points: 2 },
  { id: "trim", label: "Trim", points: 1 },
  { id: "construction", label: "Construction", points: 0 },
  { id: "project", label: "Project edge", points: 0 },
  { id: "spline", label: "Spline", points: 4 },
  { id: "fit_spline", label: "Fit point spline", points: 4 },
  { id: "polygon", label: "Polygon", points: 2 },
  { id: "slot", label: "Slot", points: 3 },
  { id: "ellipse", label: "Ellipse", points: 3 },
  { id: "elliptical_arc", label: "Elliptical arc", points: 5 },
  { id: "conic", label: "Conic", points: 3 },
  { id: "point", label: "Point", points: 1 },
  { id: "text", label: "Text", points: 1 },
  { id: "offset", label: "Offset", points: 0 },
  { id: "extend", label: "Extend", points: 0 },
  { id: "sketch_fillet", label: "Sketch fillet", points: 0 },
  { id: "sketch_chamfer", label: "Sketch chamfer", points: 0 },
  { id: "sketch_mirror", label: "Sketch mirror", points: 0 },
  { id: "sketch_linear_pattern", label: "Linear pattern", points: 0 },
  { id: "sketch_circular_pattern", label: "Circular pattern", points: 0 },
  { id: "sketch_break", label: "Break", points: 0 },
  { id: "sketch_scale", label: "Scale", points: 0 },
  { id: "sketch_move_copy", label: "Move / Copy", points: 0 },
  { id: "sketch_blend", label: "Blend curve", points: 0 },
] as const;

export const CONSTRAINT_SCHEMA = [
  "coincident",
  "horizontal",
  "vertical",
  "parallel",
  "perpendicular",
  "tangent",
  "equal",
  "fixed",
  "midpoint",
  "concentric",
  "point_on_object",
  "collinear",
  "symmetry",
  "curvature_continuous",
  "distance",
  "distance_x",
  "distance_y",
  "point_line_distance",
  "line_distance",
  "offset_distance",
  "radius",
  "diameter",
  "ellipse_radius",
  "angle",
] as const;

export type SketchTool = (typeof SKETCH_TOOL_SCHEMA)[number]["id"];
export type ConstraintTool = (typeof CONSTRAINT_SCHEMA)[number];
export type SketchSupport = SketchPlaneSupport;

type DurableSketchElement = {
  kind: string;
  id: string;
  [key: string]: unknown;
};

type DurableSketchConstraint = {
  kind: string;
  id: string;
  [key: string]: unknown;
};

type DurableSketchDocument = {
  revision?: number;
  sketches?: Record<string, {
    id?: string;
    support?: SketchSupport;
    elements?: DurableSketchElement[];
    constraints?: DurableSketchConstraint[];
    dimension_positions?: Record<string, [number, number]>;
    recipes?: Record<string, {
      kind: "polygon" | "slot" | "text";
      mode?: "inscribed" | "circumscribed" | "edge" | "center_to_center" | "overall" | "center_point" | "three_point_arc";
      center_nanometers?: [number, number];
      radius_nanometers: number;
      sides?: number;
      orientation_microdegrees?: number;
      first_nanometers?: [number, number];
      second_nanometers?: [number, number];
      origin_nanometers?: [number, number];
      center_arc_nanometers?: [number, number];
      through_nanometers?: [number, number];
      text?: string;
      height_nanometers?: number;
      rotation_microdegrees?: number;
      tracking_millionths?: number;
      horizontal_alignment?: "left" | "center" | "right";
      path?: string;
      path_start_millionths?: number;
      reversed?: boolean;
      geometry: string[];
    }>;
    operations?: Record<string, SketchOperation>;
  }>;
  parameters?: Record<string, { value?: { value?: number } }>;
};

/** Rebuild an editor draft from the accepted semantic sketch representation. */
export function hydrateSketchFromDocument(documentValue: unknown, preferredSketchId?: string): { sketch: Sketch; support: SketchSupport } | undefined {
  const document = documentValue as DurableSketchDocument;
  const entries = Object.entries(document.sketches ?? {});
  const entry = entries.find(([id, value]) => id === preferredSketchId || value.id === preferredSketchId) ?? entries[0];
  if (!entry) return undefined;
  const [storedId, stored] = entry;
  const sketchId = stored.id ?? storedId;
  const elements = stored.elements ?? [];
  const points = new Map<string, Point2>();
  for (const element of elements) {
    if (element.kind === "point") points.set(element.id, { x_nm: numberField(element, "x_nanometers"), y_nm: numberField(element, "y_nanometers") });
  }

  const geometry: Record<StableId, GeometryEntity> = {};
  const externalReferences: NonNullable<Sketch["external_references"]> = {};
  const pointReferences = new Map<string, PointRef>();
  for (const element of elements) {
    const construction = element.kind === "construction_line" || element.construction === true;
    let value: Geometry | undefined;
    if (element.kind === "line") {
      const start = points.get(stringField(element, "start_element"));
      const end = points.get(stringField(element, "end_element"));
      if (start && end) {
        value = { kind: "line", start, end };
        pointReferences.set(stringField(element, "start_element"), { geometry: element.id, anchor: "start" });
        pointReferences.set(stringField(element, "end_element"), { geometry: element.id, anchor: "end" });
      }
    } else if (element.kind === "line_segment" || element.kind === "construction_line" || element.kind === "external_line") {
      value = { kind: "line", start: pairField(element, "start_nanometers"), end: pairField(element, "end_nanometers") };
      if (element.kind === "external_line" && typeof element.body === "string" && typeof element.stable_kernel_id === "string") {
        externalReferences[element.id] = { body: element.body, stable_kernel_id: element.stable_kernel_id };
      }
    } else if (element.kind === "circle") {
      value = { kind: "circle", center: pairField(element, "center_nanometers"), radius_nm: numberField(element, "radius_nanometers") };
    } else if (element.kind === "arc") {
      value = { kind: "arc", center: pairField(element, "center_nanometers"), start: pairField(element, "start_nanometers"), end: pairField(element, "end_nanometers"), clockwise: element.clockwise === true };
    } else if (element.kind === "rectangle") {
      value = { kind: "rectangle", min: pairField(element, "min_nanometers"), max: pairField(element, "max_nanometers") };
    } else if (element.kind === "control_point_spline") {
      const storedPoints = element.control_points_nanometers;
      if (typeof element.degree === "number" && Array.isArray(storedPoints) && storedPoints.length >= element.degree + 1) {
        value = { kind: "control_point_spline", degree: element.degree, control_points: storedPoints.map((point) =>
          Array.isArray(point) ? { x_nm: Number(point[0]), y_nm: Number(point[1]) } : { x_nm: 0, y_nm: 0 }),
          knots_millionths: Array.isArray(element.knots_millionths) ? element.knots_millionths.map(Number) : undefined };
      }
    } else if (element.kind === "fit_point_spline") {
      const storedPoints = element.fit_points_nanometers;
      if (Array.isArray(storedPoints) && storedPoints.length === 4) value = { kind: "fit_point_spline", fit_points: storedPoints.map((point) => Array.isArray(point) ? { x_nm: Number(point[0]), y_nm: Number(point[1]) } : { x_nm: 0, y_nm: 0 }) };
    } else if (element.kind === "ellipse") {
      value = { kind: "ellipse", center: pairField(element, "center_nanometers"), major: pairField(element, "major_nanometers"), minor: pairField(element, "minor_nanometers") };
    } else if (element.kind === "elliptical_arc") {
      value = { kind: "elliptical_arc", center: pairField(element, "center_nanometers"), major: pairField(element, "major_nanometers"), minor: pairField(element, "minor_nanometers"), start: pairField(element, "start_nanometers"), end: pairField(element, "end_nanometers"), clockwise: Boolean(element.clockwise) };
    } else if (element.kind === "conic") {
      value = { kind: "conic", start: pairField(element, "start_nanometers"), control: pairField(element, "control_nanometers"), end: pairField(element, "end_nanometers"), weight_millionths: numberField(element, "weight_millionths") };
    } else if (element.kind === "sketch_point") {
      value = { kind: "sketch_point", ...pairField(element, "position_nanometers") };
    }
    if (value) geometry[element.id] = { id: element.id, construction, geometry: value };
  }

  const pointRef = (key: unknown): PointRef | undefined => {
    if (typeof key !== "string") return undefined;
    const [geometryId, anchor] = key.split("#");
    if (geometryId === IMPLIED_ORIGIN_POINT.geometry && anchor === IMPLIED_ORIGIN_POINT.anchor) return { ...IMPLIED_ORIGIN_POINT };
    if (geometryId in geometry && (["start", "end", "center", "min", "max", "major", "minor", "control", "position"].includes(anchor) || /^(control|fit|knot|parameter):\d+$/.test(anchor))) return { geometry: geometryId, anchor: anchor as Anchor };
    return pointReferences.get(key);
  };
  const parameterNumber = (key: unknown): number | undefined => typeof key === "string" ? document.parameters?.[key]?.value?.value : undefined;
  const constraints: Record<StableId, Constraint> = {};
  const dimensionParameters: Record<StableId, StableId> = {};
  const suppressedConstraints: StableId[] = [];
  for (const storedConstraint of stored.constraints ?? []) {
    const suppressed = storedConstraint.kind === "suppressed";
    const normalized = suppressed && storedConstraint.constraint && typeof storedConstraint.constraint === "object"
      ? storedConstraint.constraint as DurableSketchConstraint
      : storedConstraint;
    const kind = normalized.kind; const id = storedConstraint.id;
    let constraint: Constraint | undefined;
    if (kind === "horizontal" || kind === "vertical") constraint = { kind, line: stringField(normalized, "line") };
    else if (["parallel", "perpendicular", "tangent", "equal"].includes(kind)) constraint = kind === "tangent" ? {
      kind,
      first: stringField(normalized, "first"),
      second: stringField(normalized, "second"),
      ...(typeof normalized.first_parameter_millionths === "number" ? { first_parameter_millionths: normalized.first_parameter_millionths } : {}),
      ...(typeof normalized.second_parameter_millionths === "number" ? { second_parameter_millionths: normalized.second_parameter_millionths } : {}),
    } : { kind, first: stringField(normalized, "first"), second: stringField(normalized, "second") } as Constraint;
    else if (kind === "coincident") {
      const a = pointRef(normalized.first_point); const b = pointRef(normalized.second_point);
      if (a && b) constraint = { kind, a, b };
    } else if (kind === "point_on_origin") {
      const point = pointRef(normalized.point);
      if (point) constraint = { kind, point };
    } else if (kind === "fixed") {
      const point = pointRef(normalized.point);
      const value = point ? pointValue(geometry[point.geometry]?.geometry, point.anchor) : undefined;
      if (point && value) constraint = { kind, point, x_nm: value.x_nm, y_nm: value.y_nm };
    } else if (kind === "fixed_geometry") {
      constraint = { kind, geometry: stringField(normalized, "geometry") };
    } else if (kind === "horizontal_points" || kind === "vertical_points") {
      const a = pointRef(normalized.first_point); const b = pointRef(normalized.second_point);
      if (a && b) constraint = { kind, a, b };
    } else if (kind === "midpoint") {
      const point = pointRef(normalized.point);
      if (point) constraint = { kind, point, line: stringField(normalized, "line") };
    } else if (kind === "concentric") {
      constraint = { kind, first: stringField(normalized, "first"), second: stringField(normalized, "second") };
    } else if (kind === "point_on_object") {
      const point = pointRef(normalized.point);
      if (point) constraint = { kind, point, geometry: stringField(normalized, "geometry") };
    } else if (kind === "collinear") {
      const point = pointRef(normalized.point); if (point) constraint = { kind, point, line: stringField(normalized, "line") };
    } else if (kind === "symmetry") {
      const first = pointRef(normalized.first_point); const second = pointRef(normalized.second_point); if (first && second) constraint = { kind, first, second, axis: stringField(normalized, "axis") };
    } else if (kind === "curvature_continuous") {
      constraint = { kind, first: stringField(normalized, "first"), second: stringField(normalized, "second") };
    } else if (["distance", "distance_x", "distance_y", "distance_literal", "distance_x_literal", "distance_y_literal"].includes(kind)) {
      const a = pointRef(normalized.first ?? normalized.start_point);
      const b = pointRef(normalized.second ?? normalized.end_point);
      const distance = kind.endsWith("_literal") ? numberField(normalized, "distance_nanometers") : parameterNumber(normalized.parameter);
      const hydratedKind = kind.replace("_literal", "") as "distance" | "distance_x" | "distance_y";
      if (a && b && distance !== undefined) constraint = { kind: hydratedKind, a, b, distance_nm: distance };
    } else if (["point_line_distance", "point_line_distance_literal"].includes(kind)) {
      const point = pointRef(normalized.point); const distance = kind.endsWith("_literal") ? numberField(normalized, "distance_nanometers") : parameterNumber(normalized.parameter);
      if (point && distance !== undefined) constraint = { kind: "point_line_distance", point, line: stringField(normalized, "line"), distance_nm: distance };
    } else if (["line_distance", "line_distance_literal"].includes(kind)) {
      const distance = kind.endsWith("_literal") ? numberField(normalized, "distance_nanometers") : parameterNumber(normalized.parameter);
      if (distance !== undefined) constraint = { kind: "line_distance", first: stringField(normalized, "first"), second: stringField(normalized, "second"), distance_nm: distance };
    } else if (["offset_distance", "offset_distance_literal"].includes(kind)) {
      const distance = kind.endsWith("_literal") ? numberField(normalized, "distance_nanometers") : parameterNumber(normalized.parameter);
      if (distance !== undefined) constraint = {
        kind: "offset_distance",
        source: stringField(normalized, "source"),
        offset: stringField(normalized, "offset"),
        distance_nm: distance,
        source_start_millionths: numberField(normalized, "source_start_millionths"),
        source_end_millionths: numberField(normalized, "source_end_millionths"),
      };
    } else if (kind === "radius" || kind === "radius_literal") {
      const radius = kind === "radius_literal" ? numberField(normalized, "radius_nanometers") : parameterNumber(normalized.parameter);
      if (radius !== undefined) constraint = { kind: "radius", geometry: stringField(normalized, "geometry"), radius_nm: radius };
    } else if (kind === "diameter" || kind === "diameter_literal") {
      const diameter = kind === "diameter_literal" ? numberField(normalized, "diameter_nanometers") : parameterNumber(normalized.parameter);
      if (diameter !== undefined) constraint = { kind: "diameter", geometry: stringField(normalized, "geometry"), diameter_nm: diameter };
    } else if (kind === "ellipse_radius" || kind === "ellipse_radius_literal") {
      const radius = kind === "ellipse_radius_literal" ? numberField(normalized, "radius_nanometers") : parameterNumber(normalized.parameter);
      if (radius !== undefined) constraint = { kind: "ellipse_radius", geometry: stringField(normalized, "geometry"), axis: stringField(normalized, "axis") === "minor" ? "minor" : "major", radius_nm: radius };
    } else if (kind === "angle" || kind === "angle_literal") {
      const angle = kind === "angle_literal" ? numberField(normalized, "angle_microdegrees") : parameterNumber(normalized.parameter);
      if (angle !== undefined) constraint = { kind: "angle", first: stringField(normalized, "first"), second: stringField(normalized, "second"), angle_microdegrees: angle };
    } else if (kind === "angle_to_axis" || kind === "angle_to_axis_literal") {
      const angle = kind === "angle_to_axis_literal" ? numberField(normalized, "angle_microdegrees") : parameterNumber(normalized.parameter);
      if (angle !== undefined) constraint = {
        kind: "angle_to_axis",
        line: stringField(normalized, "line"),
        axis: stringField(normalized, "axis") === "y" ? "y" : "x",
        angle_microdegrees: angle,
      };
    }
    if (constraint) constraints[id] = constraint;
    if (constraint && typeof normalized.parameter === "string") dimensionParameters[id] = normalized.parameter;
    if (constraint && suppressed) suppressedConstraints.push(id);
  }
  const dimensionPositions = Object.fromEntries(Object.entries(stored.dimension_positions ?? {}).flatMap(([id, value]) =>
    Array.isArray(value) && value.length >= 2 && id in constraints
      ? [[id, { x_nm: Number(value[0]), y_nm: Number(value[1]) }]]
      : []));
  const recipes: NonNullable<Sketch["recipes"]> = {};
  for (const [id, recipe] of Object.entries(stored.recipes ?? {})) {
    const members = recipe.geometry.filter((geometryId) => geometryId in geometry);
    if (recipe.kind === "polygon" && recipe.center_nanometers && recipe.sides && members.length === recipe.sides) {
      recipes[id] = { kind: "polygon", ...(recipe.mode ? { mode: recipe.mode as "inscribed" | "circumscribed" | "edge" } : {}), center: { x_nm: Number(recipe.center_nanometers[0]), y_nm: Number(recipe.center_nanometers[1]) }, radius_nm: Number(recipe.radius_nanometers), sides: Number(recipe.sides), orientation_microdegrees: Number(recipe.orientation_microdegrees ?? 0), geometry: members };
    } else if (recipe.kind === "slot" && recipe.first_nanometers && recipe.second_nanometers && members.length === 4) {
      recipes[id] = { kind: "slot", ...(recipe.mode ? { mode: recipe.mode as "center_to_center" | "overall" | "center_point" | "three_point_arc" } : {}), first: { x_nm: Number(recipe.first_nanometers[0]), y_nm: Number(recipe.first_nanometers[1]) }, second: { x_nm: Number(recipe.second_nanometers[0]), y_nm: Number(recipe.second_nanometers[1]) }, ...(recipe.center_arc_nanometers ? { center: { x_nm: Number(recipe.center_arc_nanometers[0]), y_nm: Number(recipe.center_arc_nanometers[1]) } } : {}), ...(recipe.through_nanometers ? { through: { x_nm: Number(recipe.through_nanometers[0]), y_nm: Number(recipe.through_nanometers[1]) } } : {}), radius_nm: Number(recipe.radius_nanometers), geometry: members };
    } else if (recipe.kind === "text" && typeof recipe.text === "string" && recipe.origin_nanometers && members.length > 0) {
      recipes[id] = { kind: "text", text: recipe.text, origin: { x_nm: Number(recipe.origin_nanometers[0]), y_nm: Number(recipe.origin_nanometers[1]) }, height_nm: Number(recipe.height_nanometers ?? 5_000_000), rotation_microdegrees: Number(recipe.rotation_microdegrees ?? 0), tracking_millionths: Number(recipe.tracking_millionths ?? 1_000_000), horizontal_alignment: recipe.horizontal_alignment ?? "left", ...(typeof recipe.path === "string" ? { path: recipe.path } : {}), path_start_millionths: Number(recipe.path_start_millionths ?? 0), reversed: Boolean(recipe.reversed), geometry: members };
    }
  }
  const operations = structuredClone(stored.operations ?? {});
  return {
    sketch: {
      id: sketchId,
      revision: document.revision ?? 0,
      geometry,
      constraints,
      ...(Object.keys(dimensionParameters).length ? { dimension_parameters: dimensionParameters } : {}),
      ...(Object.keys(dimensionPositions).length ? { dimension_positions: dimensionPositions } : {}),
      ...(Object.keys(recipes).length ? { recipes } : {}),
      ...(Object.keys(operations).length ? { operations } : {}),
      ...(Object.keys(externalReferences).length ? { external_references: externalReferences } : {}),
      ...(suppressedConstraints.length ? { suppressed_constraints: suppressedConstraints } : {}),
    },
    support: stored.support ?? { kind: "origin_plane_reference", plane: "origin-plane:xy" },
  };
}

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  return typeof field === "string" ? field : "";
}

function numberField(value: Record<string, unknown>, key: string): number {
  const field = value[key];
  return typeof field === "number" ? field : 0;
}

function pairField(value: Record<string, unknown>, key: string): Point2 {
  const field = value[key];
  return Array.isArray(field) ? { x_nm: Number(field[0]), y_nm: Number(field[1]) } : { x_nm: 0, y_nm: 0 };
}

export type TopologyFace = {
  id: StableId;
  kind: "face";
  /** Decimal u64. Never parse this identity through JavaScript Number. */
  stable_kernel_id: string;
  stable_token: string;
  fallback_signature: {
    kind: "face";
    centroid_nanometers: [number, number, number];
    normal_millionths: [number, number, number];
    area_square_nanometers: number;
  };
};

export type AttachmentState =
  | { status: "ready"; support: SketchSupport }
  | {
      status: "missing_face";
      support: { kind: "topology"; reference: StableId };
      candidates: TopologyFace[];
      explicit_rebind_required: true;
    };

export type DimensionBinding = {
  constraintId: StableId;
  parameterId: StableId;
  expression: string;
  lastValidExpression: string;
  error?: string;
};

export class StableSketchIds {
  private nextValue: number;
  private readonly sketchId: string;

  constructor(sketchId: string, seed = 0, occupiedIds: readonly string[] = []) {
    this.sketchId = sketchId;
    const prefix = `${sketchId}:`;
    const occupiedMaximum = occupiedIds.reduce((maximum, id) => {
      if (!id.startsWith(prefix)) return maximum;
      const parsed = Number.parseInt(id.split(":").at(-1) ?? "", 36);
      return Number.isFinite(parsed) ? Math.max(maximum, parsed) : maximum;
    }, 0);
    this.nextValue = Math.max(seed, occupiedMaximum);
  }

  next(kind: "geometry" | "constraint" | "transaction" | "recipe" | "operation"): StableId {
    this.nextValue += 1;
    return `${this.sketchId}:${kind}:${this.nextValue.toString(36).padStart(4, "0")}`;
  }
}

export function rectangleCommands(ids: StableSketchIds, first: Point2, opposite: Point2): SketchCommand[] {
  const min = { x_nm: Math.min(first.x_nm, opposite.x_nm), y_nm: Math.min(first.y_nm, opposite.y_nm) };
  const max = { x_nm: Math.max(first.x_nm, opposite.x_nm), y_nm: Math.max(first.y_nm, opposite.y_nm) };
  if (min.x_nm === max.x_nm || min.y_nm === max.y_nm) throw new Error("Rectangle must have positive width and height");
  const corners = [
    min,
    { x_nm: max.x_nm, y_nm: min.y_nm },
    max,
    { x_nm: min.x_nm, y_nm: max.y_nm },
  ];
  const lines = corners.map((start, index) => ({
    id: ids.next("geometry"),
    start,
    end: corners[(index + 1) % corners.length],
  }));
  const commands: SketchCommand[] = lines.map((line) => ({
    kind: "add_geometry",
    entity: { id: line.id, geometry: { kind: "line", start: line.start, end: line.end } },
  }));
  for (let index = 0; index < lines.length; index += 1) {
    commands.push({
      kind: "add_constraint",
      id: ids.next("constraint"),
      constraint: { kind: index % 2 === 0 ? "horizontal" : "vertical", line: lines[index].id },
    });
    commands.push({
      kind: "add_constraint",
      id: ids.next("constraint"),
      constraint: {
        kind: "coincident",
        a: { geometry: lines[index].id, anchor: "end" },
        b: { geometry: lines[(index + 1) % lines.length].id, anchor: "start" },
      },
    });
  }
  return commands;
}

function radialArcEnd(center: Point2, start: Point2, target: Point2): Point2 | undefined {
  const radius = Math.hypot(start.x_nm - center.x_nm, start.y_nm - center.y_nm);
  const targetDx = target.x_nm - center.x_nm;
  const targetDy = target.y_nm - center.y_nm;
  const targetRadius = Math.hypot(targetDx, targetDy);
  if (radius === 0 || targetRadius === 0) return undefined;
  const end = {
    x_nm: center.x_nm + Math.round(targetDx * radius / targetRadius),
    y_nm: center.y_nm + Math.round(targetDy * radius / targetRadius),
  };
  return end.x_nm === start.x_nm && end.y_nm === start.y_nm ? undefined : end;
}

/**
 * Produces disposable cursor-following geometry without allocating a stable ID
 * or touching the authoritative sketch. Explicit clicks remain the only thing
 * that can enqueue a solver command.
 */
export function sketchToolFacsimile(tool: SketchTool, fixed: readonly Point2[], cursor: Point2): Geometry | undefined {
  if (tool === "line" && fixed.length >= 1) return { kind: "line", start: fixed[0], end: cursor };
  if (tool === "circle" && fixed.length >= 1) {
    const radius_nm = Math.round(Math.hypot(cursor.x_nm - fixed[0].x_nm, cursor.y_nm - fixed[0].y_nm));
    return radius_nm > 0 ? { kind: "circle", center: fixed[0], radius_nm } : undefined;
  }
  if (tool === "rectangle" && fixed.length >= 1) {
    const min = { x_nm: Math.min(fixed[0].x_nm, cursor.x_nm), y_nm: Math.min(fixed[0].y_nm, cursor.y_nm) };
    const max = { x_nm: Math.max(fixed[0].x_nm, cursor.x_nm), y_nm: Math.max(fixed[0].y_nm, cursor.y_nm) };
    return min.x_nm !== max.x_nm && min.y_nm !== max.y_nm ? { kind: "rectangle", min, max } : undefined;
  }
  if (tool === "arc" && fixed.length >= 1) {
    const center = fixed[0];
    if (fixed.length === 1) {
      const radius_nm = Math.round(Math.hypot(cursor.x_nm - center.x_nm, cursor.y_nm - center.y_nm));
      return radius_nm > 0 ? { kind: "circle", center, radius_nm } : undefined;
    }
    const start = fixed[1];
    const end = radialArcEnd(center, start, cursor);
    if (!end) return undefined;
    return {
      kind: "arc",
      center,
      start,
      end,
      clockwise: false,
    };
  }
  if (["spline", "fit_spline", "polygon", "slot", "ellipse", "elliptical_arc", "conic"].includes(tool) && fixed.length >= 1) {
    if (tool === "spline") {
      return { kind: "control_point_spline", degree: 3, control_points: [...fixed, cursor].slice(0, 4) };
    }
    if (tool === "fit_spline") return { kind: "fit_point_spline", fit_points: [...fixed, cursor].slice(0, 4) };
    if (tool === "ellipse" && fixed.length >= 2) return { kind: "ellipse", center: fixed[0], major: fixed[1], minor: cursor };
    if (tool === "elliptical_arc" && fixed.length >= 2) {
      const minor = fixed[2] ?? cursor;
      if (fixed.length < 3) return { kind: "ellipse", center: fixed[0], major: fixed[1], minor };
      const start = projectPointToEllipse(fixed[0], fixed[1], minor, fixed[3] ?? cursor);
      const end = projectPointToEllipse(fixed[0], fixed[1], minor, fixed.length >= 4 ? cursor : start);
      return { kind: "elliptical_arc", center: fixed[0], major: fixed[1], minor, start, end, clockwise: false };
    }
    if (tool === "conic" && fixed.length >= 2) return { kind: "conic", start: fixed[0], control: fixed[1], end: cursor, weight_millionths: 1_000_000 };
    return { kind: "line", start: fixed.at(-1)!, end: cursor };
  }
  return undefined;
}

export function toolCommands(
  tool: Exclude<SketchTool, "trim" | "construction" | "project" | "rectangle" | "spline" | "fit_spline" | "polygon" | "slot" | "ellipse" | "elliptical_arc" | "conic" | "point" | "offset" | "extend" | "sketch_fillet" | "sketch_chamfer" | "sketch_mirror" | "sketch_linear_pattern" | "sketch_circular_pattern" | "sketch_break" | "sketch_scale" | "sketch_move_copy" | "sketch_blend">,
  ids: StableSketchIds,
  points: Point2[],
): SketchCommand[] {
  if (tool === "line" && points.length === 2) {
    if (samePoint(points[0], points[1])) throw new Error("Line must have positive length");
    const id = ids.next("geometry");
    return [{ kind: "add_geometry", entity: { id, geometry: { kind: "line", start: points[0], end: points[1] } } }];
  }
  if (tool === "circle" && points.length === 2) {
    const radius_nm = Math.round(Math.hypot(points[1].x_nm - points[0].x_nm, points[1].y_nm - points[0].y_nm));
    if (radius_nm <= 0) throw new Error("Circle must have positive radius");
    const id = ids.next("geometry");
    return [{ kind: "add_geometry", entity: { id, geometry: { kind: "circle", center: points[0], radius_nm } } }];
  }
  if (tool === "arc" && points.length === 3) {
    const center = points[0];
    const end = radialArcEnd(center, points[1], points[2]);
    if (!end) throw new Error("Arc radius must be positive");
    const id = ids.next("geometry");
    return [{ kind: "add_geometry", entity: { id, geometry: { kind: "arc", center, start: points[1], end, clockwise: false } } }];
  }
  throw new Error(`Tool ${tool} received the wrong number of points`);
}

export function constraintCommand(
  kind: ConstraintTool,
  id: StableId,
  sketch: Sketch,
  selection: { geometry: StableId[]; points: PointRef[]; origin?: boolean },
  dimension: number,
): SketchCommand | undefined {
  const chosen = selection.geometry.flatMap((geometryId) => {
    const entity = sketch.geometry[geometryId];
    return entity ? [entity] : [];
  });
  const lines = chosen.filter((entity) => entity.geometry.kind === "line");
  const measurable = chosen.filter((entity) => !["rectangle", "sketch_point"].includes(entity.geometry.kind));
  const round = chosen.filter((entity) => entity.geometry.kind === "circle" || entity.geometry.kind === "arc");

  if (kind === "horizontal" || kind === "vertical") {
    const points = selection.points.slice(-2);
    if (points.length === 2) return { kind: "add_constraint", id, constraint: { kind: kind === "horizontal" ? "horizontal_points" : "vertical_points", a: points[0], b: points[1] } };
    const line = lines.at(-1);
    return line ? { kind: "add_constraint", id, constraint: { kind, line: line.id } } : undefined;
  }
  if (kind === "radius") {
    const geometry = round.at(-1);
    return geometry ? { kind: "add_constraint", id, constraint: { kind, geometry: geometry.id, radius_nm: Math.max(1, Math.round(dimension * 1_000_000)) } } : undefined;
  }
  if (kind === "diameter") {
    const geometry = round.at(-1);
    return geometry ? { kind: "add_constraint", id, constraint: { kind, geometry: geometry.id, diameter_nm: Math.max(2, Math.round(dimension * 1_000_000)) } } : undefined;
  }
  if (kind === "ellipse_radius") {
    const geometry = [...chosen].reverse().find((entity) => entity.geometry.kind === "ellipse" || entity.geometry.kind === "elliptical_arc");
    const selectedAxis = [...selection.points].reverse().find((point) => point.geometry === geometry?.id && (point.anchor === "major" || point.anchor === "minor"))?.anchor;
    return geometry ? { kind: "add_constraint", id, constraint: { kind, geometry: geometry.id, axis: selectedAxis === "minor" ? "minor" : "major", radius_nm: Math.max(1, Math.round(dimension * 1_000_000)) } } : undefined;
  }
  if (kind === "distance") {
    const selectedLine = lines.at(-1);
    const a = selection.origin && selection.points.length === 1
      ? IMPLIED_ORIGIN_POINT
      : selection.points.at(-2) ?? (selection.points.length === 0 && selectedLine ? { geometry: selectedLine.id, anchor: "start" as const } : undefined);
    const b = selection.points.at(-1) ?? (selection.points.length === 0 && selectedLine ? { geometry: selectedLine.id, anchor: "end" as const } : undefined);
    return a && b ? { kind: "add_constraint", id, constraint: { kind, a, b, distance_nm: Math.round(dimension * 1_000_000) } } : undefined;
  }
  if (kind === "distance_x" || kind === "distance_y") {
    const selectedLine = lines.at(-1);
    const endpoints = selection.origin && selection.points.length === 1
      ? [IMPLIED_ORIGIN_POINT, selection.points[0]]
      : selection.points.length >= 2
      ? selection.points.slice(-2)
      : selection.points.length === 0 && selectedLine
        ? [{ geometry: selectedLine.id, anchor: "start" as const }, { geometry: selectedLine.id, anchor: "end" as const }]
        : [];
    return endpoints.length === 2 ? { kind: "add_constraint", id, constraint: { kind, a: endpoints[0], b: endpoints[1], distance_nm: Math.round(dimension * 1_000_000) } } : undefined;
  }
  if (kind === "point_line_distance") {
    const point = selection.origin ? IMPLIED_ORIGIN_POINT : selection.points.at(-1); const line = [...lines].reverse().find((entity) => entity.id !== point?.geometry);
    return point && line ? { kind: "add_constraint", id, constraint: { kind, point, line: line.id, distance_nm: Math.round(dimension * 1_000_000) } } : undefined;
  }
  if (kind === "line_distance") {
    const pair = lines.slice(-2);
    return pair.length === 2 ? { kind: "add_constraint", id, constraint: { kind, first: pair[0].id, second: pair[1].id, distance_nm: Math.round(dimension * 1_000_000) } } : undefined;
  }
  if (kind === "offset_distance") {
    const pair = measurable.slice(-2);
    if (pair.length !== 2) return undefined;
    return { kind: "add_constraint", id, constraint: { kind, source: pair[0].id, offset: pair[1].id, distance_nm: Math.max(0, Math.round(dimension * 1_000_000)), source_start_millionths: 0, source_end_millionths: 1_000_000 } };
  }
  if (kind === "coincident") {
    const point = selection.points.at(-1);
    if (selection.origin && point) return { kind: "add_constraint", id, constraint: { kind: "point_on_origin", point } };
    const endpoints = selection.points.slice(-2);
    return endpoints.length === 2 ? { kind: "add_constraint", id, constraint: { kind, a: endpoints[0], b: endpoints[1] } } : undefined;
  }
  if (kind === "fixed") {
    const point = selection.points.at(-1);
    const value = point ? pointValue(sketch.geometry[point.geometry]?.geometry, point.anchor) : undefined;
    if (point && value) return { kind: "add_constraint", id, constraint: { kind, point, x_nm: value.x_nm, y_nm: value.y_nm } };
    const geometry = chosen.at(-1);
    return geometry ? { kind: "add_constraint", id, constraint: { kind: "fixed_geometry", geometry: geometry.id } } : undefined;
  }
  if (kind === "midpoint") {
    const point = selection.points.at(-1);
    const line = [...lines].reverse().find((entity) => entity.id !== point?.geometry);
    if (selection.origin && line) return { kind: "add_constraint", id, constraint: { kind, point: IMPLIED_ORIGIN_POINT, line: line.id } };
    return point && line ? { kind: "add_constraint", id, constraint: { kind, point, line: line.id } } : undefined;
  }
  if (kind === "concentric") {
    const pair = round.slice(-2);
    return pair.length === 2 ? { kind: "add_constraint", id, constraint: { kind, first: pair[0].id, second: pair[1].id } } : undefined;
  }
  if (kind === "point_on_object") {
    const point = selection.origin ? IMPLIED_ORIGIN_POINT : selection.points.at(-1);
    const geometry = [...chosen].reverse().find((entity) => entity.id !== point?.geometry && entity.geometry.kind !== "rectangle");
    return point && geometry ? { kind: "add_constraint", id, constraint: { kind, point, geometry: geometry.id } } : undefined;
  }
  if (kind === "collinear") {
    const point = selection.origin ? IMPLIED_ORIGIN_POINT : selection.points.at(-1);
    const line = [...lines].reverse().find((entity) => entity.id !== point?.geometry);
    return point && line ? { kind: "add_constraint", id, constraint: { kind, point, line: line.id } } : undefined;
  }
  if (kind === "symmetry") {
    const points = selection.points.slice(-2); const axis = lines.at(-1);
    return points.length === 2 && axis ? { kind: "add_constraint", id, constraint: { kind, first: points[0], second: points[1], axis: axis.id } } : undefined;
  }
  if (kind === "curvature_continuous") {
    const pair = measurable.slice(-2);
    return pair.length === 2 ? { kind: "add_constraint", id, constraint: { kind, first: pair[0].id, second: pair[1].id } } : undefined;
  }
  if (kind === "angle") {
    const pair = lines.slice(-2);
    return pair.length === 2 ? { kind: "add_constraint", id, constraint: { kind, first: pair[0].id, second: pair[1].id, angle_microdegrees: Math.round(dimension * 1_000_000) } } : undefined;
  }
  if (kind === "tangent" && lines.length === 2) return undefined;
  const compatible = kind === "parallel" || kind === "perpendicular" ? lines : measurable;
  const pair = compatible.slice(-2);
  if (kind === "tangent" && pair.length === 2) {
    if (tangentConflictsWithCenterOnLine(sketch, pair[0].id, pair[1].id)) return undefined;
    const selected = selection.points.flatMap((point) => {
      const match = /^parameter:(\d+)$/.exec(point.anchor); return match ? [[point.geometry, Number(match[1])] as const] : [];
    });
    const retained = pair.map((entity) => selected.find(([geometry]) => geometry === entity.id)?.[1]);
    const parameters = retained.every((value) => value !== undefined)
      ? retained as [number, number]
      : tangentContactParameters(pair[0].geometry, pair[1].geometry).map((value) => Math.round(value * 1_000_000)) as [number, number];
    return { kind: "add_constraint", id, constraint: { kind, first: pair[0].id, second: pair[1].id, first_parameter_millionths: parameters[0], second_parameter_millionths: parameters[1] } };
  }
  return pair.length === 2
    ? { kind: "add_constraint", id, constraint: { kind, first: pair[0].id, second: pair[1].id } } as SketchCommand
    : undefined;
}

/** Build the directional dimension used by inline line creation. It is kept
 * separate from the selection-driven constraint toolbar because its axis is
 * inferred by the creation HUD rather than chosen as sketch geometry. */
export function angleToAxisConstraintCommand(
  id: StableId,
  line: StableId,
  axis: "x" | "y",
  angleDegrees: number,
): SketchCommand {
  return {
    kind: "add_constraint",
    id,
    constraint: {
      kind: "angle_to_axis",
      line,
      axis,
      angle_microdegrees: Math.round(angleDegrees * 1_000_000),
    },
  };
}

function tangentContactParameters(first: Geometry, second: Geometry): [number, number] {
  let best: [number, number, number] = [0, 0, Number.POSITIVE_INFINITY];
  for (const parameter of geometryCurveSearchParameters(first)) {
    const point = evaluateGeometryCurve(first, parameter); const projection = projectPointToGeometryCurve(second, point);
    if (projection.distance_nm < best[2]) best = [parameter, projection.parameter, projection.distance_nm];
  }
  for (const parameter of geometryCurveSearchParameters(second)) {
    const reversePoint = evaluateGeometryCurve(second, parameter); const reverse = projectPointToGeometryCurve(first, reversePoint);
    if (reverse.distance_nm < best[2]) best = [reverse.parameter, parameter, reverse.distance_nm];
  }
  return [best[0], best[1]];
}

function pointValue(geometry: Geometry | undefined, anchor: Anchor): Point2 | undefined {
  if (!geometry) return undefined;
  if (geometry.kind === "line" && (anchor === "start" || anchor === "end")) return geometry[anchor];
  if ((geometry.kind === "circle" || geometry.kind === "arc") && anchor === "center") return geometry.center;
  if (geometry.kind === "arc" && (anchor === "start" || anchor === "end")) return geometry[anchor];
  if (geometry.kind === "rectangle" && (anchor === "min" || anchor === "max")) return geometry[anchor];
  if (geometry.kind === "control_point_spline") {
    if (anchor === "start") return geometry.control_points[0];
    if (anchor === "end") return geometry.control_points.at(-1);
    const match = /^control:(\d+)$/.exec(anchor);
    return match ? geometry.control_points[Number(match[1])] : undefined;
  }
  if (geometry.kind === "fit_point_spline") {
    if (anchor === "start") return geometry.fit_points[0]; if (anchor === "end") return geometry.fit_points.at(-1);
    const match = /^fit:(\d+)$/.exec(anchor); return match ? geometry.fit_points[Number(match[1])] : undefined;
  }
  if (geometry.kind === "ellipse" && (anchor === "center" || anchor === "major" || anchor === "minor")) return geometry[anchor];
  if (geometry.kind === "elliptical_arc" && (anchor === "center" || anchor === "major" || anchor === "minor" || anchor === "start" || anchor === "end")) return geometry[anchor];
  if (geometry.kind === "conic" && (anchor === "start" || anchor === "control" || anchor === "end")) return geometry[anchor];
  if (geometry.kind === "sketch_point" && anchor === "position") return { x_nm: geometry.x_nm, y_nm: geometry.y_nm };
  return undefined;
}

export function resolveAttachment(
  support: SketchSupport,
  availableFaces: readonly TopologyFace[],
  expected?: TopologyFace,
): AttachmentState {
  if (support.kind !== "topology") return { status: "ready", support };
  if (availableFaces.some((face) => face.id === support.reference)) return { status: "ready", support };
  const candidates = expected
    ? [...availableFaces].sort((a, b) => faceDistance(expected, a) - faceDistance(expected, b) || a.id.localeCompare(b.id))
    : [...availableFaces].sort((a, b) => a.id.localeCompare(b.id));
  return { status: "missing_face", support, candidates, explicit_rebind_required: true };
}

export function explicitFaceRebind(state: AttachmentState, selected: StableId): SketchSupport {
  if (state.status !== "missing_face" || !state.candidates.some((candidate) => candidate.id === selected)) {
    throw new Error("Replacement face must be explicitly selected from the repair candidates");
  }
  return { kind: "topology", reference: selected };
}

function faceDistance(expected: TopologyFace, candidate: TopologyFace): number {
  const a = expected.fallback_signature;
  const b = candidate.fallback_signature;
  return a.centroid_nanometers.reduce((sum, value, i) => sum + Math.abs(value - b.centroid_nanometers[i]), 0)
    + a.normal_millionths.reduce((sum, value, i) => sum + Math.abs(value - b.normal_millionths[i]), 0)
    + Math.abs(a.area_square_nanometers - b.area_square_nanometers);
}

export function updateDimensionBinding(binding: DimensionBinding, expression: string, valid: boolean, error?: string): DimensionBinding {
  return valid
    ? { ...binding, expression, lastValidExpression: expression, error: undefined }
    : { ...binding, expression, lastValidExpression: binding.lastValidExpression, error: error ?? "Invalid dimension" };
}

type DiagnosticSegment = Extract<Geometry, { kind: "line" }>;
type DiagnosticBounds = { minX: number; minY: number; maxX: number; maxY: number };
type DiagnosticEntity = GeometryEntity & { segments: DiagnosticSegment[]; bounds?: DiagnosticBounds; segmentBounds: DiagnosticBounds[] };

export function selfIntersectionDiagnostics(
  sketch: Sketch,
  instrumentation?: ProfileDiagnosticsBroadPhaseInstrumentation,
): ProfileReport["diagnostics"] {
  const entities: DiagnosticEntity[] = Object.values(sketch.geometry)
    .filter((entity) => !entity.construction)
    .map((entity) => {
      const segments = profileDiagnosticSegments(entity.geometry);
      const segmentBounds = segments.map(segmentBoundsOf);
      return { ...entity, segments, bounds: unionBounds(segmentBounds), segmentBounds };
    });
  if (instrumentation) Object.assign(instrumentation, {
    entityCount: entities.length,
    sampledSegmentCount: entities.reduce((count, entity) => count + entity.segments.length, 0),
    candidateEntityPairs: 0,
    rejectedEntityPairs: 0,
    rejectedSegmentPairs: 0,
    exactSegmentComparisons: 0,
  });
  const diagnostics: ProfileReport["diagnostics"] = [];
  for (let first = 0; first < entities.length; first += 1) {
    for (let second = first + 1; second < entities.length; second += 1) {
      const a = entities[first];
      const b = entities[second];
      if (!a.bounds || !b.bounds || !boundsOverlap(a.bounds, b.bounds)) {
        if (instrumentation) instrumentation.rejectedEntityPairs += 1;
        continue;
      }
      if (instrumentation) instrumentation.candidateEntityPairs += 1;
      let kind: string | undefined;
      segmentPairs: for (let firstSegmentIndex = 0; firstSegmentIndex < a.segments.length; firstSegmentIndex += 1) {
        for (let secondSegmentIndex = 0; secondSegmentIndex < b.segments.length; secondSegmentIndex += 1) {
          if (!boundsOverlap(a.segmentBounds[firstSegmentIndex], b.segmentBounds[secondSegmentIndex])) {
            if (instrumentation) instrumentation.rejectedSegmentPairs += 1;
            continue;
          }
          if (instrumentation) instrumentation.exactSegmentComparisons += 1;
          const firstSegment = a.segments[firstSegmentIndex];
          const secondSegment = b.segments[secondSegmentIndex];
          if (collinearOverlap(firstSegment, secondSegment)) {
            kind = "overlapping_contours";
            break segmentPairs;
          } else if (properlyIntersects(firstSegment, secondSegment)) kind = "self_intersection";
          else if (!kind && interiorTouch(firstSegment, secondSegment)) kind = "touching_contours";
        }
      }
      if (kind) diagnostics.push({ kind, geometry: [a.id, b.id] });
    }
  }
  return diagnostics;
}

function segmentBoundsOf(segment: DiagnosticSegment): DiagnosticBounds {
  if (![segment.start.x_nm, segment.start.y_nm, segment.end.x_nm, segment.end.y_nm].every(Number.isFinite)) {
    // A broad phase must never turn malformed/nonfinite input into a false
    // negative. Admit it to the unchanged exact predicates instead.
    return { minX: Number.NEGATIVE_INFINITY, minY: Number.NEGATIVE_INFINITY, maxX: Number.POSITIVE_INFINITY, maxY: Number.POSITIVE_INFINITY };
  }
  return {
    minX: Math.min(segment.start.x_nm, segment.end.x_nm),
    minY: Math.min(segment.start.y_nm, segment.end.y_nm),
    maxX: Math.max(segment.start.x_nm, segment.end.x_nm),
    maxY: Math.max(segment.start.y_nm, segment.end.y_nm),
  };
}

function unionBounds(bounds: readonly DiagnosticBounds[]): DiagnosticBounds | undefined {
  if (bounds.length === 0) return undefined;
  return bounds.slice(1).reduce((combined, next) => ({
    minX: Math.min(combined.minX, next.minX),
    minY: Math.min(combined.minY, next.minY),
    maxX: Math.max(combined.maxX, next.maxX),
    maxY: Math.max(combined.maxY, next.maxY),
  }), bounds[0]);
}

function boundsOverlap(a: DiagnosticBounds, b: DiagnosticBounds): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

/** @internal Exported so the unit-test rollback oracle can use the exact same
 * deterministic curve sampling while retaining the old all-pairs algorithm. */
export function profileDiagnosticSegments(geometry: Geometry): DiagnosticSegment[] {
  const points: Point2[] = geometry.kind === "line" ? [geometry.start, geometry.end]
    : geometry.kind === "circle" ? sampleDiagnosticRound(geometry.center, geometry.radius_nm, 0, Math.PI * 2, 64)
      : geometry.kind === "arc" ? sampleDiagnosticArc(geometry)
        : geometry.kind === "control_point_spline" ? sampleControlPointSpline(geometry.control_points, 48, geometry.degree, geometry.knots_millionths)
          : geometry.kind === "fit_point_spline" ? sampleFitPointSpline(geometry.fit_points)
            : geometry.kind === "ellipse" ? sampleEllipse(geometry.center, geometry.major, geometry.minor)
              : geometry.kind === "elliptical_arc" ? sampleEllipticalArc(geometry.center, geometry.major, geometry.minor, geometry.start, geometry.end, geometry.clockwise)
              : geometry.kind === "conic" ? sampleConic(geometry.start, geometry.control, geometry.end, geometry.weight_millionths)
                : geometry.kind === "sketch_point" ? [{ x_nm: geometry.x_nm, y_nm: geometry.y_nm }]
                  : [geometry.min, { x_nm: geometry.max.x_nm, y_nm: geometry.min.y_nm }, geometry.max, { x_nm: geometry.min.x_nm, y_nm: geometry.max.y_nm }, geometry.min];
  return points.slice(0, -1).map((start, index) => ({ kind: "line", start, end: points[index + 1] }));
}

function sampleDiagnosticArc(arc: Extract<Geometry, { kind: "arc" }>): Point2[] {
  const radius = Math.hypot(arc.start.x_nm - arc.center.x_nm, arc.start.y_nm - arc.center.y_nm);
  const start = Math.atan2(arc.start.y_nm - arc.center.y_nm, arc.start.x_nm - arc.center.x_nm);
  let sweep = Math.atan2(arc.end.y_nm - arc.center.y_nm, arc.end.x_nm - arc.center.x_nm) - start;
  if (arc.clockwise) while (sweep >= 0) sweep -= Math.PI * 2;
  else while (sweep <= 0) sweep += Math.PI * 2;
  return sampleDiagnosticRound(arc.center, radius, start, sweep, 48);
}

function sampleDiagnosticRound(center: Point2, radius: number, start: number, sweep: number, count: number): Point2[] {
  return Array.from({ length: count + 1 }, (_, index) => {
    const angle = start + sweep * index / count;
    return { x_nm: center.x_nm + Math.round(Math.cos(angle) * radius), y_nm: center.y_nm + Math.round(Math.sin(angle) * radius) };
  });
}

function collinearOverlap(a: Extract<Geometry, { kind: "line" }>, b: Extract<Geometry, { kind: "line" }>): boolean {
  const cross = (p: Point2, q: Point2, r: Point2) => (q.x_nm - p.x_nm) * (r.y_nm - p.y_nm) - (q.y_nm - p.y_nm) * (r.x_nm - p.x_nm);
  if (cross(a.start, a.end, b.start) !== 0 || cross(a.start, a.end, b.end) !== 0) return false;
  const useX = Math.abs(a.end.x_nm - a.start.x_nm) >= Math.abs(a.end.y_nm - a.start.y_nm);
  const interval = (line: typeof a) => [Math.min(useX ? line.start.x_nm : line.start.y_nm, useX ? line.end.x_nm : line.end.y_nm), Math.max(useX ? line.start.x_nm : line.start.y_nm, useX ? line.end.x_nm : line.end.y_nm)] as const;
  const [a0, a1] = interval(a); const [b0, b1] = interval(b);
  return Math.min(a1, b1) > Math.max(a0, b0);
}

function interiorTouch(a: Extract<Geometry, { kind: "line" }>, b: Extract<Geometry, { kind: "line" }>): boolean {
  const onSegment = (point: Point2, line: typeof a) => {
    const cross = (line.end.x_nm - line.start.x_nm) * (point.y_nm - line.start.y_nm) - (line.end.y_nm - line.start.y_nm) * (point.x_nm - line.start.x_nm);
    if (cross !== 0) return false;
    return point.x_nm >= Math.min(line.start.x_nm, line.end.x_nm) && point.x_nm <= Math.max(line.start.x_nm, line.end.x_nm)
      && point.y_nm >= Math.min(line.start.y_nm, line.end.y_nm) && point.y_nm <= Math.max(line.start.y_nm, line.end.y_nm);
  };
  return [a.start, a.end].some((point) => onSegment(point, b) && !samePoint(point, b.start) && !samePoint(point, b.end))
    || [b.start, b.end].some((point) => onSegment(point, a) && !samePoint(point, a.start) && !samePoint(point, a.end));
}

function properlyIntersects(a: Extract<Geometry, { kind: "line" }>, b: Extract<Geometry, { kind: "line" }>): boolean {
  if ([a.start, a.end].some((point) => samePoint(point, b.start) || samePoint(point, b.end))) return false;
  const cross = (p: Point2, q: Point2, r: Point2) =>
    (q.x_nm - p.x_nm) * (r.y_nm - p.y_nm) - (q.y_nm - p.y_nm) * (r.x_nm - p.x_nm);
  const aa = cross(a.start, a.end, b.start);
  const ab = cross(a.start, a.end, b.end);
  const ba = cross(b.start, b.end, a.start);
  const bb = cross(b.start, b.end, a.end);
  return aa * ab < 0 && ba * bb < 0;
}

function samePoint(a: Point2, b: Point2): boolean {
  return a.x_nm === b.x_nm && a.y_nm === b.y_nm;
}

export class SketchEditSession {
  readonly ids: StableSketchIds;
  private accepted: Sketch;
  private acceptedSolve?: SolveResult;
  private acceptedProfile?: ProfileReport;
  private draftValue: Sketch;
  private draftViewValue?: SketchDraftView;
  private diagnosticsGeneration = 0;
  private diagnosticsPromise: Promise<void> = Promise.resolve();
  private diagnosticsChanged: () => void = () => {};
  private diagnosticsTaskScheduled = false;
  private pendingDiagnostics?: {
    generation: number;
    snapshot: Sketch;
    baseProfile: ProfileReport;
    resolve: () => void;
  };
  private readonly diagnosticsCounters = { scheduled: 0, skipped: 0, executed: 0, published: 0 };
  private undoStack: Array<{ sketch: Sketch; solve?: SolveResult; profile?: ProfileReport }> = [];
  private redoStack: Array<{ sketch: Sketch; solve?: SolveResult; profile?: ProfileReport }> = [];
  private draftGeneration = 0;
  private readonly preparedPreviews = new WeakMap<PreparedSketchPreview, { generation: number; preview: SketchPreview }>();
  activeTool: SketchTool = "line";
  support: SketchSupport;
  supportReference?: SketchTopologyReference;
  solve?: SolveResult;
  profile?: ProfileReport;
  private readonly runtime: SketchRuntimeBridge;
  private readonly diagnosticsScheduler: (task: () => void) => void;

  constructor(initial: Sketch, support: SketchSupport, runtime: SketchRuntimeBridge, supportReference?: SketchTopologyReference, diagnosticsScheduler: (task: () => void) => void = (task) => setTimeout(task, 0)) {
    this.accepted = structuredClone(initial);
    this.draftValue = structuredClone(initial);
    this.support = support;
    this.supportReference = supportReference;
    this.runtime = runtime;
    this.diagnosticsScheduler = diagnosticsScheduler;
    this.ids = new StableSketchIds(initial.id, initial.revision, [...Object.keys(initial.geometry), ...Object.keys(initial.constraints), ...Object.keys(initial.recipes ?? {}), ...Object.keys(initial.operations ?? {})]);
  }

  get draft(): Sketch {
    return structuredClone(this.draftValue);
  }

  /**
   * Stable, deeply frozen snapshot for render/read paths. The snapshot is
   * cloned only once for the current draft and invalidated by every successful
   * draft mutation, so repeated reads cannot mutate session state or trigger
   * repeated full-sketch clones.
   */
  get draftView(): SketchDraftView {
    if (!this.draftViewValue) this.draftViewValue = deepFreeze(structuredClone(this.draftValue));
    return this.draftViewValue;
  }

  private replaceDraft(sketch: Sketch, isolatedRuntimeResult = false): void {
    this.draftValue = isolatedRuntimeResult ? sketch : structuredClone(sketch);
    this.draftViewValue = undefined;
    this.draftGeneration += 1;
  }

  private publishSolve(sketch: Sketch, solve: SolveResult, isolatedRuntimeResult = false): void {
    const normalized = normalizeImpliedOriginMidpointSolve(sketch, solve);
    this.solve = isolatedRuntimeResult ? normalized : structuredClone(normalized);
  }

  private invalidateDraftView(): void {
    this.draftViewValue = undefined;
  }

  setDiagnosticsChangedListener(listener: () => void): void {
    this.diagnosticsChanged = listener;
  }

  diagnosticsReady(): Promise<void> {
    return this.diagnosticsPromise;
  }

  diagnosticsInstrumentation(): ProfileDiagnosticsInstrumentation {
    return { ...this.diagnosticsCounters };
  }

  /**
   * Populate the derived solve and profile state for an existing draft without
   * creating an edit or an undo entry. Hydrated sketches contain durable
   * geometry and constraints, while profile regions are derived by the
   * canonical runtime and therefore must be rebuilt when an edit session opens.
   */
  async initialize(): Promise<void> {
    const generation = this.draftGeneration;
    const isolated = this.runtime.transportIsolation === "structured-clone";
    const preview = await this.runtime.applySketchCommands({
      sketch: isolated ? this.draftValue : structuredClone(this.draftValue),
      commands: [],
    });
    if (generation !== this.draftGeneration) return;
    this.publishSolve(this.draftValue, preview.solve, isolated);
    this.scheduleProfileDiagnostics(preview.profile, isolated);
    this.acceptedSolve = this.solve ? structuredClone(this.solve) : undefined;
    this.acceptedProfile = this.profile ? structuredClone(this.profile) : undefined;
  }

  private invalidateDiagnostics(): void {
    this.diagnosticsGeneration += 1;
    if (this.pendingDiagnostics) {
      this.diagnosticsCounters.skipped += 1;
      this.pendingDiagnostics.resolve();
      this.pendingDiagnostics = undefined;
    }
    this.diagnosticsPromise = Promise.resolve();
  }

  private scheduleProfileDiagnostics(baseProfile: ProfileReport, isolatedRuntimeResult = false): void {
    const generation = ++this.diagnosticsGeneration;
    const snapshot = this.draftValue;
    this.profile = isolatedRuntimeResult ? baseProfile : structuredClone(baseProfile);
    this.diagnosticsCounters.scheduled += 1;
    if (this.pendingDiagnostics) {
      this.diagnosticsCounters.skipped += 1;
      this.pendingDiagnostics.resolve();
    }
    this.diagnosticsPromise = new Promise<void>((resolve) => {
      this.pendingDiagnostics = { generation, snapshot, baseProfile: isolatedRuntimeResult ? baseProfile : structuredClone(baseProfile), resolve };
    });
    if (this.diagnosticsTaskScheduled) return;
    this.diagnosticsTaskScheduled = true;
    this.diagnosticsScheduler(() => this.runScheduledProfileDiagnostics());
  }

  private runScheduledProfileDiagnostics(): void {
    this.diagnosticsTaskScheduled = false;
    const pending = this.pendingDiagnostics;
    this.pendingDiagnostics = undefined;
    if (!pending) return;
    if (pending.generation !== this.diagnosticsGeneration) {
      this.diagnosticsCounters.skipped += 1;
      pending.resolve();
      return;
    }
    this.diagnosticsCounters.executed += 1;
    const localDiagnostics = selfIntersectionDiagnostics(pending.snapshot);
    if (pending.generation === this.diagnosticsGeneration) {
      const diagnostics = [...pending.baseProfile.diagnostics, ...localDiagnostics].filter((diagnostic, index, all) =>
        all.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(diagnostic)) === index);
      this.profile = structuredClone({ ...pending.baseProfile, diagnostics });
      this.diagnosticsCounters.published += 1;
      this.diagnosticsChanged();
    }
    pending.resolve();
  }

  setExternalReference(geometry: StableId, reference: { body: StableId; stable_kernel_id: string }): void {
    if (!this.draftValue.geometry[geometry]) throw new Error(`External geometry ${geometry} is missing`);
    this.draftValue = { ...this.draftValue, external_references: { ...this.draftValue.external_references, [geometry]: structuredClone(reference) } };
    this.draftGeneration += 1;
    this.invalidateDraftView();
  }

  removeExternalReference(geometry: StableId): void {
    if (!this.draftValue.external_references?.[geometry]) return;
    const references = { ...this.draftValue.external_references };
    delete references[geometry];
    this.draftValue = { ...this.draftValue, external_references: references };
    this.draftGeneration += 1;
    this.invalidateDraftView();
  }

  private historyEntry(): { sketch: Sketch; solve?: SolveResult; profile?: ProfileReport } {
    return {
      sketch: structuredClone(this.draftValue),
      solve: this.solve ? structuredClone(this.solve) : undefined,
      profile: this.profile ? structuredClone(this.profile) : undefined,
    };
  }

  private restoreHistory(entry: { sketch: Sketch; solve?: SolveResult; profile?: ProfileReport }): void {
    this.invalidateDiagnostics();
    this.replaceDraft(entry.sketch);
    this.solve = entry.solve ? structuredClone(entry.solve) : undefined;
    this.profile = entry.profile ? structuredClone(entry.profile) : undefined;
    if (entry.profile) this.scheduleProfileDiagnostics(entry.profile);
  }

  async apply(command: SketchCommand): Promise<Sketch> {
    const before = this.historyEntry();
    const isolated = this.runtime.transportIsolation === "structured-clone";
    const preview = await this.runtime.applySketchCommand({ sketch: isolated ? this.draftValue : structuredClone(this.draftValue), command: isolated ? command : structuredClone(command) });
    this.undoStack.push(before);
    this.redoStack = [];
    this.replaceDraft(preview.sketch, isolated);
    this.publishSolve(this.draftValue, preview.solve, isolated);
    this.scheduleProfileDiagnostics(preview.profile, isolated);
    return this.draft;
  }

  async applyAll(commands: readonly SketchCommand[]): Promise<Sketch> {
    if (!commands.length) return this.draft;
    const before = this.historyEntry();
    const isolated = this.runtime.transportIsolation === "structured-clone";
    const preview = await this.runtime.applySketchCommands({ sketch: isolated ? this.draftValue : structuredClone(this.draftValue), commands: isolated ? [...commands] : structuredClone([...commands]) });
    this.undoStack.push(before);
    this.redoStack = [];
    this.replaceDraft(preview.sketch, isolated);
    this.publishSolve(this.draftValue, preview.solve, isolated);
    this.scheduleProfileDiagnostics(preview.profile, isolated);
    return this.draft;
  }

  /**
   * Evaluate a batch on the canonical worker path without changing the draft,
   * history, solve state, or diagnostics. Aborting invalidates the result but
   * deliberately does not terminate the shared model worker.
   */
  async previewAll(commands: readonly SketchCommand[], options: { signal?: AbortSignal } = {}): Promise<PreparedSketchPreview> {
    if (!commands.length) throw new Error("A sketch preview requires at least one command");
    const signal = options.signal;
    if (signal?.aborted) throw new DOMException("Sketch preview cancelled", "AbortError");
    const generation = this.draftGeneration;
    const base = structuredClone(this.draftValue);
    const runtimePreview = this.runtime.applySketchCommands({ sketch: base, commands: structuredClone([...commands]) });
    let abortListener: (() => void) | undefined;
    let preview: SketchPreview;
    try {
      preview = signal
        ? await Promise.race([
            runtimePreview,
            new Promise<never>((_resolve, reject) => {
              abortListener = () => reject(new DOMException("Sketch preview cancelled", "AbortError"));
              signal.addEventListener("abort", abortListener, { once: true });
            }),
          ])
        : await runtimePreview;
    } finally {
      if (signal && abortListener) signal.removeEventListener("abort", abortListener);
    }
    if (signal?.aborted) throw new DOMException("Sketch preview cancelled", "AbortError");
    preview = { ...preview, solve: normalizeImpliedOriginMidpointSolve(preview.sketch, preview.solve) };
    const frozenPreview = deepFreeze(structuredClone(preview)) as SketchPreview;
    const prepared = Object.freeze({
      request_id: crypto.randomUUID(),
      base_sketch_id: base.id,
      base_revision: base.revision,
      preview: frozenPreview,
    }) satisfies PreparedSketchPreview;
    this.preparedPreviews.set(prepared, { generation, preview: frozenPreview });
    return prepared;
  }

  /**
   * Atomically promote a worker preview into the editable draft. Returns false
   * without side effects when the token is foreign, cancelled, already used,
   * or was computed from an older draft identity/revision.
   */
  acceptPreview(prepared: PreparedSketchPreview): boolean {
    const owned = this.preparedPreviews.get(prepared);
    if (!owned
      || owned.generation !== this.draftGeneration
      || prepared.base_sketch_id !== this.draftValue.id
      || prepared.base_revision !== this.draftValue.revision) return false;
    this.preparedPreviews.delete(prepared);
    const before = this.historyEntry();
    this.undoStack.push(before);
    this.redoStack = [];
    this.replaceDraft(owned.preview.sketch as Sketch);
    this.publishSolve(this.draftValue, owned.preview.solve);
    this.scheduleProfileDiagnostics(owned.preview.profile as ProfileReport);
    return true;
  }

  async refreshExternalGeometry(commands: readonly SketchCommand[]): Promise<Sketch> {
    if (!commands.length) return this.draft;
    const preview = await this.runtime.applySketchCommands({ sketch: structuredClone(this.draftValue), commands: structuredClone([...commands]) });
    this.replaceDraft(preview.sketch);
    this.publishSolve(this.draftValue, preview.solve);
    this.scheduleProfileDiagnostics(preview.profile);
    return this.draft;
  }

  async drag(point: PointRef, target: Point2): Promise<boolean> {
    const before = this.historyEntry();
    const preview = await this.runtime.dragSketch({ sketch: structuredClone(this.draftValue), drag: structuredClone({ point, target }) });
    this.publishSolve(preview.drag.sketch, preview.drag.solve);
    this.profile = structuredClone(preview.profile);
    if (!preview.drag.accepted) {
      this.invalidateDiagnostics();
      return false;
    }
    this.undoStack.push(before);
    this.redoStack = [];
    this.replaceDraft(preview.drag.sketch);
    this.scheduleProfileDiagnostics(preview.profile);
    return true;
  }

  undo(): boolean {
    const previous = this.undoStack.pop();
    if (!previous) return false;
    this.redoStack.push(this.historyEntry());
    this.restoreHistory(previous);
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.historyEntry());
    this.restoreHistory(next);
    return true;
  }

  cancel(): Sketch {
    this.invalidateDiagnostics();
    this.replaceDraft(this.accepted);
    this.solve = this.acceptedSolve ? structuredClone(this.acceptedSolve) : undefined;
    this.profile = this.acceptedProfile ? structuredClone(this.acceptedProfile) : undefined;
    this.undoStack = [];
    this.redoStack = [];
    return this.draft;
  }

  async commit(): Promise<boolean> {
    await this.diagnosticsReady();
    const result = await this.runtime.solveSketch({ transaction_id: this.ids.next("transaction"), sketch: structuredClone(this.draftValue), support: structuredClone(this.support), ...(this.supportReference ? { support_reference: structuredClone(this.supportReference) } : {}) });
    this.publishSolve(this.draftValue, result.solve);
    if (!result.accepted) return false;
    this.accepted = structuredClone(this.draftValue);
    this.acceptedSolve = this.solve ? structuredClone(this.solve) : undefined;
    this.acceptedProfile = this.profile ? structuredClone(this.profile) : undefined;
    this.undoStack = [];
    this.redoStack = [];
    return true;
  }

}
