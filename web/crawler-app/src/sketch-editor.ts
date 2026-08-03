export type StableId = string;
export type Point2 = { x_nm: number; y_nm: number };
export type Anchor = "start" | "end" | "center" | "min" | "max";
export type PointRef = { geometry: StableId; anchor: Anchor };

export type Geometry =
  | { kind: "line"; start: Point2; end: Point2 }
  | { kind: "circle"; center: Point2; radius_nm: number }
  | { kind: "arc"; center: Point2; start: Point2; end: Point2; clockwise: boolean }
  | { kind: "rectangle"; min: Point2; max: Point2 };

export type GeometryEntity = {
  id: StableId;
  construction?: boolean;
  geometry: Geometry;
};

export type Constraint =
  | { kind: "coincident"; a: PointRef; b: PointRef }
  | { kind: "horizontal"; line: StableId }
  | { kind: "vertical"; line: StableId }
  | { kind: "parallel"; first: StableId; second: StableId }
  | { kind: "perpendicular"; first: StableId; second: StableId }
  | { kind: "tangent"; first: StableId; second: StableId }
  | { kind: "equal"; first: StableId; second: StableId }
  | { kind: "distance"; a: PointRef; b: PointRef; distance_nm: number }
  | { kind: "radius"; geometry: StableId; radius_nm: number }
  | { kind: "angle"; first: StableId; second: StableId; angle_microdegrees: number };

export type Sketch = {
  id: StableId;
  revision: number;
  geometry: Record<StableId, GeometryEntity>;
  constraints: Record<StableId, Constraint>;
};

export type SketchCommand =
  | { kind: "add_geometry"; entity: GeometryEntity }
  | { kind: "remove_geometry"; geometry: StableId }
  | { kind: "add_constraint"; id: StableId; constraint: Constraint }
  | { kind: "remove_constraint"; constraint: StableId }
  | { kind: "move_point"; point: PointRef; to: Point2 }
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
  active_constraints: StableId[];
  redundant_constraints: StableId[];
  conflicts: Array<{ constraints: StableId[]; reason: { kind: string; [key: string]: unknown } }>;
};

export type ProfileReport = {
  closed_profiles: StableId[][];
  diagnostics: Array<{ kind: string; [key: string]: unknown }>;
};

export type SketchPreview = {
  sketch: Sketch;
  solve: SolveResult;
  profile: ProfileReport;
  document_hash: string;
};

export interface SketchRuntimeBridge {
  applySketchCommand(request: { sketch: Sketch; command: SketchCommand }): Promise<SketchPreview>;
  dragSketch(request: {
    sketch: Sketch;
    drag: { point: PointRef; target: Point2 };
  }): Promise<{ drag: { accepted: boolean; sketch: Sketch; resolved: Point2; solve: SolveResult }; profile: ProfileReport }>;
  solveSketch(request: { transaction_id: string; sketch: Sketch; support: SketchSupport }): Promise<{ accepted: boolean; solve: SolveResult }>;
}

export const SKETCH_TOOL_SCHEMA = [
  { id: "line", label: "Line", points: 2 },
  { id: "circle", label: "Circle", points: 2 },
  { id: "arc", label: "Arc", points: 3 },
  { id: "rectangle", label: "Rectangle", points: 2 },
  { id: "trim", label: "Trim", points: 1 },
  { id: "construction", label: "Construction", points: 0 },
] as const;

export const CONSTRAINT_SCHEMA = [
  "coincident",
  "horizontal",
  "vertical",
  "parallel",
  "perpendicular",
  "tangent",
  "equal",
  "distance",
  "radius",
  "angle",
] as const;

export type SketchTool = (typeof SKETCH_TOOL_SCHEMA)[number]["id"];
export type ConstraintTool = (typeof CONSTRAINT_SCHEMA)[number];
export type SketchSupport =
  | { kind: "origin_plane"; plane: "xy" | "xz" | "yz" }
  | { kind: "origin_plane_reference"; plane: StableId }
  | { kind: "topology"; reference: StableId };

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
    } else if (element.kind === "line_segment" || element.kind === "construction_line") {
      value = { kind: "line", start: pairField(element, "start_nanometers"), end: pairField(element, "end_nanometers") };
    } else if (element.kind === "circle") {
      value = { kind: "circle", center: pairField(element, "center_nanometers"), radius_nm: numberField(element, "radius_nanometers") };
    } else if (element.kind === "arc") {
      value = { kind: "arc", center: pairField(element, "center_nanometers"), start: pairField(element, "start_nanometers"), end: pairField(element, "end_nanometers"), clockwise: element.clockwise === true };
    } else if (element.kind === "rectangle") {
      value = { kind: "rectangle", min: pairField(element, "min_nanometers"), max: pairField(element, "max_nanometers") };
    }
    if (value) geometry[element.id] = { id: element.id, construction, geometry: value };
  }

  const pointRef = (key: unknown): PointRef | undefined => {
    if (typeof key !== "string") return undefined;
    const [geometryId, anchor] = key.split("#");
    if (geometryId in geometry && ["start", "end", "center", "min", "max"].includes(anchor)) return { geometry: geometryId, anchor: anchor as Anchor };
    return pointReferences.get(key);
  };
  const parameterNumber = (key: unknown): number | undefined => typeof key === "string" ? document.parameters?.[key]?.value?.value : undefined;
  const constraints: Record<StableId, Constraint> = {};
  for (const storedConstraint of stored.constraints ?? []) {
    const { kind, id } = storedConstraint;
    let constraint: Constraint | undefined;
    if (kind === "horizontal" || kind === "vertical") constraint = { kind, line: stringField(storedConstraint, "line") };
    else if (["parallel", "perpendicular", "tangent", "equal"].includes(kind)) constraint = { kind, first: stringField(storedConstraint, "first"), second: stringField(storedConstraint, "second") } as Constraint;
    else if (kind === "coincident") {
      const a = pointRef(storedConstraint.first_point); const b = pointRef(storedConstraint.second_point);
      if (a && b) constraint = { kind, a, b };
    } else if (kind === "distance" || kind === "distance_x" || kind === "distance_y" || kind === "distance_literal") {
      const a = pointRef(storedConstraint.first ?? storedConstraint.start_point);
      const b = pointRef(storedConstraint.second ?? storedConstraint.end_point);
      const distance = kind === "distance_literal" ? numberField(storedConstraint, "distance_nanometers") : parameterNumber(storedConstraint.parameter);
      if (a && b && distance !== undefined) constraint = { kind: "distance", a, b, distance_nm: distance };
    } else if (kind === "radius" || kind === "radius_literal") {
      const radius = kind === "radius_literal" ? numberField(storedConstraint, "radius_nanometers") : parameterNumber(storedConstraint.parameter);
      if (radius !== undefined) constraint = { kind: "radius", geometry: stringField(storedConstraint, "geometry"), radius_nm: radius };
    } else if (kind === "angle" || kind === "angle_literal") {
      const angle = kind === "angle_literal" ? numberField(storedConstraint, "angle_microdegrees") : parameterNumber(storedConstraint.parameter);
      if (angle !== undefined) constraint = { kind: "angle", first: stringField(storedConstraint, "first"), second: stringField(storedConstraint, "second"), angle_microdegrees: angle };
    }
    // Point-on-origin has no solver DTO equivalent. Leaving it out of the draft
    // deliberately preserves the authoritative stored constraint on commit.
    if (constraint) constraints[id] = constraint;
  }
  return {
    sketch: { id: sketchId, revision: document.revision ?? 0, geometry, constraints },
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
  stable_kernel_id: number;
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

  next(kind: "geometry" | "constraint" | "transaction"): StableId {
    this.nextValue += 1;
    return `${this.sketchId}:${kind}:${this.nextValue.toString(36).padStart(4, "0")}`;
  }
}

export function rectangleCommands(ids: StableSketchIds, first: Point2, opposite: Point2): SketchCommand[] {
  const min = { x_nm: Math.min(first.x_nm, opposite.x_nm), y_nm: Math.min(first.y_nm, opposite.y_nm) };
  const max = { x_nm: Math.max(first.x_nm, opposite.x_nm), y_nm: Math.max(first.y_nm, opposite.y_nm) };
  if (min.x_nm === max.x_nm || min.y_nm === max.y_nm) throw new Error("Rectangle must have positive width and height");
  const points = [
    { x_nm: min.x_nm, y_nm: min.y_nm },
    { x_nm: max.x_nm, y_nm: min.y_nm },
    { x_nm: max.x_nm, y_nm: max.y_nm },
    { x_nm: min.x_nm, y_nm: max.y_nm },
  ];
  const lineIds = Array.from({ length: 4 }, () => ids.next("geometry"));
  const result: SketchCommand[] = lineIds.map((id, index) => ({
    kind: "add_geometry",
    entity: { id, geometry: { kind: "line", start: points[index], end: points[(index + 1) % 4] } },
  }));
  for (let index = 0; index < 4; index += 1) {
    result.push({
      kind: "add_constraint",
      id: ids.next("constraint"),
      constraint: {
        kind: "coincident",
        a: { geometry: lineIds[index], anchor: "end" },
        b: { geometry: lineIds[(index + 1) % 4], anchor: "start" },
      },
    });
    result.push({
      kind: "add_constraint",
      id: ids.next("constraint"),
      constraint: index % 2 === 0 ? { kind: "horizontal", line: lineIds[index] } : { kind: "vertical", line: lineIds[index] },
    });
  }
  result.push({
    kind: "add_constraint",
    id: ids.next("constraint"),
    constraint: {
      kind: "distance",
      a: { geometry: lineIds[0], anchor: "start" },
      b: { geometry: lineIds[0], anchor: "end" },
      distance_nm: max.x_nm - min.x_nm,
    },
  });
  result.push({
    kind: "add_constraint",
    id: ids.next("constraint"),
    constraint: {
      kind: "distance",
      a: { geometry: lineIds[1], anchor: "start" },
      b: { geometry: lineIds[1], anchor: "end" },
      distance_nm: max.y_nm - min.y_nm,
    },
  });
  return result;
}

export function toolCommands(
  tool: Exclude<SketchTool, "trim" | "construction" | "rectangle">,
  ids: StableSketchIds,
  points: Point2[],
): SketchCommand[] {
  const id = ids.next("geometry");
  if (tool === "line" && points.length === 2) {
    return [{ kind: "add_geometry", entity: { id, geometry: { kind: "line", start: points[0], end: points[1] } } }];
  }
  if (tool === "circle" && points.length === 2) {
    const radius_nm = Math.round(Math.hypot(points[1].x_nm - points[0].x_nm, points[1].y_nm - points[0].y_nm));
    return [{ kind: "add_geometry", entity: { id, geometry: { kind: "circle", center: points[0], radius_nm } } }];
  }
  if (tool === "arc" && points.length === 3) {
    return [{ kind: "add_geometry", entity: { id, geometry: { kind: "arc", center: points[0], start: points[1], end: points[2], clockwise: false } } }];
  }
  throw new Error(`Tool ${tool} received the wrong number of points`);
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

export function selfIntersectionDiagnostics(sketch: Sketch): ProfileReport["diagnostics"] {
  const lines = Object.values(sketch.geometry).filter(
    (entity): entity is GeometryEntity & { geometry: Extract<Geometry, { kind: "line" }> } =>
      !entity.construction && entity.geometry.kind === "line",
  );
  const diagnostics: ProfileReport["diagnostics"] = [];
  for (let first = 0; first < lines.length; first += 1) {
    for (let second = first + 1; second < lines.length; second += 1) {
      if (properlyIntersects(lines[first].geometry, lines[second].geometry)) {
        diagnostics.push({ kind: "self_intersection", geometry: [lines[first].id, lines[second].id] });
      }
    }
  }
  return diagnostics;
}

function properlyIntersects(a: Extract<Geometry, { kind: "line" }>, b: Extract<Geometry, { kind: "line" }>): boolean {
  if ([a.start, a.end].some((point) => samePoint(point, b.start) || samePoint(point, b.end))) return false;
  const cross = (p: Point2, q: Point2, r: Point2) =>
    (q.x_nm - p.x_nm) * (r.y_nm - p.y_nm) - (q.y_nm - p.y_nm) * (r.x_nm - p.x_nm);
  const aa = cross(a.start, a.end, b.start);
  const ab = cross(a.start, a.end, b.end);
  const ba = cross(b.start, b.end, a.start);
  const bb = cross(b.start, b.end, a.end);
  return Math.sign(aa) !== Math.sign(ab) && Math.sign(ba) !== Math.sign(bb);
}

function samePoint(a: Point2, b: Point2): boolean {
  return a.x_nm === b.x_nm && a.y_nm === b.y_nm;
}

export class SketchEditSession {
  readonly ids: StableSketchIds;
  private accepted: Sketch;
  private draftValue: Sketch;
  private undoStack: Sketch[] = [];
  private redoStack: Sketch[] = [];
  activeTool: SketchTool = "line";
  support: SketchSupport;
  solve?: SolveResult;
  profile?: ProfileReport;
  private readonly runtime: SketchRuntimeBridge;

  constructor(initial: Sketch, support: SketchSupport, runtime: SketchRuntimeBridge) {
    this.accepted = structuredClone(initial);
    this.draftValue = structuredClone(initial);
    this.support = support;
    this.runtime = runtime;
    this.ids = new StableSketchIds(initial.id, initial.revision, [...Object.keys(initial.geometry), ...Object.keys(initial.constraints)]);
  }

  get draft(): Sketch {
    return structuredClone(this.draftValue);
  }

  async apply(command: SketchCommand): Promise<Sketch> {
    const before = structuredClone(this.draftValue);
    const preview = await this.runtime.applySketchCommand({ sketch: this.draftValue, command });
    this.undoStack.push(before);
    this.redoStack = [];
    this.draftValue = preview.sketch;
    this.solve = preview.solve;
    this.profile = {
      ...preview.profile,
      diagnostics: [...preview.profile.diagnostics, ...selfIntersectionDiagnostics(preview.sketch)],
    };
    return this.draft;
  }

  async applyAll(commands: readonly SketchCommand[]): Promise<Sketch> {
    for (const command of commands) await this.apply(command);
    return this.draft;
  }

  async drag(point: PointRef, target: Point2): Promise<boolean> {
    const before = structuredClone(this.draftValue);
    const preview = await this.runtime.dragSketch({ sketch: this.draftValue, drag: { point, target } });
    this.solve = preview.drag.solve;
    this.profile = preview.profile;
    if (!preview.drag.accepted) return false;
    this.undoStack.push(before);
    this.redoStack = [];
    this.draftValue = preview.drag.sketch;
    return true;
  }

  undo(): boolean {
    const previous = this.undoStack.pop();
    if (!previous) return false;
    this.redoStack.push(structuredClone(this.draftValue));
    this.draftValue = previous;
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(structuredClone(this.draftValue));
    this.draftValue = next;
    return true;
  }

  cancel(): Sketch {
    this.draftValue = structuredClone(this.accepted);
    this.undoStack = [];
    this.redoStack = [];
    return this.draft;
  }

  async commit(): Promise<boolean> {
    const result = await this.runtime.solveSketch({ transaction_id: this.ids.next("transaction"), sketch: this.draftValue, support: this.support });
    this.solve = result.solve;
    if (!result.accepted) return false;
    this.accepted = structuredClone(this.draftValue);
    this.undoStack = [];
    this.redoStack = [];
    return true;
  }

  async handleKey(key: string): Promise<"committed" | "cancelled" | "ignored" | "rejected"> {
    if (key === "Escape") {
      this.cancel();
      return "cancelled";
    }
    if (key === "Enter") return (await this.commit()) ? "committed" : "rejected";
    return "ignored";
  }
}
