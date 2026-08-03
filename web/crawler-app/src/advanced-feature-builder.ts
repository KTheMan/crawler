import type {
  AdvancedFeatureCommand,
  AdvancedFeatureError,
  AdvancedFeatureOperationId,
  PrincipalAxis,
} from "./protocol";

const DEFAULT_TOLERANCE_NM = 10_000;
const MAX_U64 = 18_446_744_073_709_551_615n;
const U64_MARKER = "__crawler_exact_u64__";

export interface BodySnapshot {
  body_id: string;
  solid_json: number[];
  evidence: unknown;
}

export interface ActiveBodyState {
  kind: "base_part" | "feature_result" | "step_import" | "none";
  feature_id: string | null;
  body: BodySnapshot | null;
  render: { packet: { bounds: number[] } };
}

export interface AdvancedFeatureRuntimeView {
  documentJson(): string;
  activeBodyJson(tolerance: number): string;
  bodySnapshotJson(bodyId: string): string;
}

interface ResolvedBody {
  featureId: string;
  body: BodySnapshot;
}

interface StoredFeature {
  id: string;
  display_name: string;
  component: "component:root";
  operation: { schema_id: AdvancedFeatureOperationId; schema_version: 1 };
  dependencies: string[];
  inputs: Record<string, { kind: "body"; id: string }>;
  parameters: Record<string, string>;
  suppressed: boolean;
}

interface StoredFeatureRequest {
  schema_version: 1;
  document_id: string;
  feature_id: string;
  output_body_id: string;
  operation: Record<string, unknown>;
}

interface DocumentView {
  id: string;
  revision: number;
  features?: Record<string, StoredFeature>;
  transactions?: Array<{ changes?: Array<{ kind?: string; feature?: string; request_json?: string }> }>;
}

interface ExactU64 {
  readonly [U64_MARKER]: string;
}

export interface AdvancedFeatureEnvelope {
  transaction_id: string;
  feature: {
    id: string;
    display_name: string;
    component: "component:root";
    operation: { schema_id: AdvancedFeatureOperationId; schema_version: 1 };
    dependencies: string[];
    inputs: Record<string, { kind: "body"; id: string }>;
    parameters: Record<string, string>;
    suppressed: boolean;
  };
  parameter_definitions: Array<{
    id: string;
    display_name: string;
    value: { kind: "length_nanometers" | "angle_microdegrees" | "count" | "scalar_millionths" | "boolean" | "text"; value: number | boolean | string };
  }>;
  before?: null;
  request: {
    schema_version: 1;
    document_id: string;
    feature_id: string;
    output_body_id: string;
    operation: Record<string, unknown>;
  };
}

export class AdvancedFeatureBuildError extends Error {
  readonly detail: AdvancedFeatureError;

  constructor(detail: AdvancedFeatureError) {
    super(detail.message);
    this.name = "AdvancedFeatureBuildError";
    this.detail = detail;
  }
}

export function buildAdvancedFeatureEnvelope(
  runtime: AdvancedFeatureRuntimeView,
  command: AdvancedFeatureCommand,
): AdvancedFeatureEnvelope {
  const document = parseJson<DocumentView>(runtime.documentJson(), "document", "reload the accepted document and retry");
  const active = parseJson<ActiveBodyState>(runtime.activeBodyJson(0.01), "active_body", "restore the timeline to a valid body and retry");
  const featureId = requireIdentity(command.featureId, "featureId");
  const outputBodyId = requireIdentity(command.outputBodyId, "outputBodyId");
  const operation = buildOperation(runtime, active, command);
  const resolvedInputs = operation.resolvedInputs;
  const dependencies = unique(resolvedInputs.map((input) => input.featureId).filter(Boolean));
  if (command.operationId === "crawler.part.revolve" && active.feature_id) dependencies.push(active.feature_id);
  const inputs = Object.fromEntries(resolvedInputs.map((input, index) => [
    index === 0 ? "source" : `source_${index + 1}`,
    { kind: "body" as const, id: input.body.body_id },
  ]));
  const slug = command.operationId.replace("crawler.part.", "").replaceAll(".", "-");
  const parameterValues = normalizedParameterValues(command, operation.value);
  const bindings = parameterBindings(featureId, parameterValues, document.features?.[featureId]?.parameters);

  return {
    transaction_id: `transaction:${document.revision + 1}:${slug}`,
    feature: {
      id: featureId,
      display_name: command.displayName?.trim() || defaultDisplayName(command.operationId),
      component: "component:root",
      operation: { schema_id: command.operationId, schema_version: 1 },
      dependencies: unique(dependencies),
      inputs,
      parameters: bindings.parameters,
      suppressed: false,
    },
    parameter_definitions: bindings.definitions,
    before: null,
    request: {
      schema_version: 1,
      document_id: document.id,
      feature_id: featureId,
      output_body_id: outputBodyId,
      operation: operation.value,
    },
  };
}

/** Re-execute an existing durable feature with the same identity, inputs, and
 * output body while replacing only its editable exact parameter values. */
export function buildAdvancedFeatureEditEnvelope(
  runtime: AdvancedFeatureRuntimeView,
  command: AdvancedFeatureCommand,
): AdvancedFeatureEnvelope {
  const document = parseJson<DocumentView>(runtime.documentJson(), "document", "reload the accepted document and retry");
  const featureId = requireIdentity(command.featureId, "featureId");
  const feature = document.features?.[featureId];
  if (!feature) fail("not_found", "featureId", `feature ${featureId} was not found`, "select an accepted advanced feature and retry");
  if (feature.operation.schema_id !== command.operationId) fail("invalid_input", "operationId", "edited operation type differs from the accepted feature", "edit the selected feature with its original operation type");
  const accepted = [...(document.transactions ?? [])].reverse().flatMap((transaction) => [...(transaction.changes ?? [])].reverse()).find((change) => change.kind === "accept_feature_result" && change.feature === featureId && change.request_json);
  if (!accepted?.request_json) fail("not_found", "featureId", "accepted feature request is missing", "recompute or recreate the feature before editing it");
  const request = parseJson<StoredFeatureRequest>(accepted.request_json, "feature.request", "recompute or recreate the feature before editing it");
  const operation = applyAdvancedParameterEdits(command, request.operation);
  const parameterValues = normalizedParameterValues(command, operation);
  const bindings = parameterBindings(featureId, parameterValues, feature.parameters);
  return {
    transaction_id: `transaction:${document.revision + 1}:edit-${command.operationId.replace("crawler.part.", "").replaceAll(".", "-")}`,
    feature: {
      ...feature,
      display_name: command.displayName?.trim() || feature.display_name,
      parameters: bindings.parameters,
    },
    parameter_definitions: bindings.definitions,
    request: { ...request, operation },
  };
}

/** Serialize stable topology IDs as exact JSON u64 numbers, not lossy JS numbers. */
export function serializeAdvancedFeatureEnvelope(envelope: AdvancedFeatureEnvelope): string {
  return JSON.stringify(envelope).replace(
    new RegExp(`\\{\\"${U64_MARKER}\\":\\"([0-9]+)\\"\\}`, "g"),
    "$1",
  );
}

function parameterBindings(
  featureId: string,
  values: Readonly<Record<string, number | boolean | string>>,
  existing: Readonly<Record<string, string>> = {},
): { parameters: Record<string, string>; definitions: AdvancedFeatureEnvelope["parameter_definitions"] } {
  const parameters: Record<string, string> = {};
  const definitions = Object.entries(values).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => {
    const id = existing[key] ?? `parameter:${featureId.replace(/^feature:/, "")}:${key}`;
    parameters[key] = id;
    const kind = typeof value === "boolean" ? "boolean"
      : typeof value === "string" ? "text"
      : key === "angle" ? "angle_microdegrees"
      : key === "count" || key === "divisions" ? "count"
      : "length_nanometers";
    return {
      id,
      display_name: key.split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join(" "),
      value: { kind, value },
    } as AdvancedFeatureEnvelope["parameter_definitions"][number];
  });
  return { parameters, definitions };
}

function normalizedParameterValues(
  command: AdvancedFeatureCommand,
  operation: Readonly<Record<string, unknown>>,
): Record<string, number | boolean | string> {
  const supplied = command.parameters ?? {};
  const integer = (key: string, fallback: unknown) => integerParameter(supplied, key, Number(fallback), undefined);
  const tolerance = integer("tolerance", operation.tolerance_nm ?? DEFAULT_TOLERANCE_NM);
  switch (operation.kind) {
    case "revolve": return {
      inner_radius: integer("inner_radius", operation.inner_radius_nm),
      outer_radius: integer("outer_radius", operation.outer_radius_nm),
      axial_start: integer("axial_start", operation.axial_start_nm),
      axial_end: integer("axial_end", operation.axial_end_nm),
      angle: integer("angle", operation.sweep_microdegrees),
      reverse: booleanParameter(supplied, "reverse", false),
      divisions: integer("divisions", operation.divisions),
      tolerance,
    };
    case "boolean": return { tolerance };
    case "fillet": return { radius: integer("radius", operation.radius_nm), divisions: integer("divisions", operation.divisions), tolerance };
    case "chamfer": return { distance: integer("distance", operation.radius_nm), divisions: integer("divisions", operation.divisions), tolerance };
    case "mirror": return { tolerance };
    case "transform": {
      const translation = Array.isArray(operation.translation_nm) ? operation.translation_nm : [0, 0, 0];
      return {
        x: integer("x", translation[0]),
        y: integer("y", translation[1]),
        z: integer("z", translation[2]),
        tolerance,
      };
    }
    case "linear_pattern": return {
      count: integer("count", Array.isArray(operation.instance_body_ids) ? operation.instance_body_ids.length : 2),
      spacing: integer("spacing", vectorMagnitude(operation.step_nm)),
      symmetric: booleanParameter(supplied, "symmetric", false),
      tolerance,
    };
    case "circular_pattern": {
      const count = integer("count", Array.isArray(operation.instance_body_ids) ? operation.instance_body_ids.length : 4);
      return { count, angle: integer("angle", Number(operation.step_microdegrees) * count), tolerance };
    }
    case "shell": return { thickness: integer("thickness", operation.wall_thickness_nm), tolerance };
    default: return Object.fromEntries(Object.entries(supplied));
  }
}

function applyAdvancedParameterEdits(
  command: AdvancedFeatureCommand,
  stored: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const operation = structuredClone(stored) as Record<string, unknown>;
  const values = normalizedParameterValues(command, operation);
  operation.tolerance_nm = values.tolerance;
  switch (operation.kind) {
    case "revolve":
      operation.inner_radius_nm = values.inner_radius;
      operation.outer_radius_nm = values.outer_radius;
      operation.axial_start_nm = values.axial_start;
      operation.axial_end_nm = values.axial_end;
      operation.sweep_microdegrees = Math.abs(values.angle as number);
      operation.divisions = values.divisions;
      break;
    case "fillet": operation.radius_nm = values.radius; operation.divisions = values.divisions; break;
    case "chamfer": operation.radius_nm = values.distance; operation.divisions = values.divisions; break;
    case "transform": operation.translation_nm = [values.x, values.y, values.z]; break;
    case "linear_pattern": {
      const oldStep = operation.step_nm as number[];
      const axis = oldStep.findIndex((value) => value !== 0);
      const sign = axis >= 0 && oldStep[axis] < 0 ? -1 : 1;
      operation.step_nm = [0, 0, 0];
      (operation.step_nm as number[])[Math.max(0, axis)] = (values.spacing as number) * sign;
      operation.instance_body_ids = resizedInstanceIds(operation.instance_body_ids, values.count as number);
      break;
    }
    case "circular_pattern":
      operation.instance_body_ids = resizedInstanceIds(operation.instance_body_ids, values.count as number);
      operation.step_microdegrees = Math.round((values.angle as number) / (values.count as number));
      break;
    case "shell": operation.wall_thickness_nm = values.thickness; break;
  }
  return operation;
}

function resizedInstanceIds(value: unknown, count: number): string[] {
  const existing = Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  const prefix = existing[0]?.replace(/:instance:\d+$/, "") ?? "body:pattern";
  return Array.from({ length: count }, (_, index) => existing[index] ?? `${prefix}:instance:${index}`);
}

function vectorMagnitude(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return Math.max(...value.map((entry) => Math.abs(Number(entry))));
}

function buildOperation(
  runtime: AdvancedFeatureRuntimeView,
  active: ActiveBodyState,
  command: AdvancedFeatureCommand,
): { value: Record<string, unknown>; resolvedInputs: ResolvedBody[] } {
  const parameters = command.parameters ?? {};
  const selection = command.selection ?? {};
  const toleranceNm = integerParameter(parameters, "tolerance", DEFAULT_TOLERANCE_NM, 1);
  const axis = selection.axis ?? "z";
  const origin = exactVector(selection.originNanometers ?? inferredOrigin(active, axis), "selection.originNanometers");

  if (command.operationId === "crawler.part.revolve") {
    const bounds = boundsNanometers(active);
    const axisIndex = axis === "x" ? 0 : axis === "y" ? 1 : 2;
    const radial = [0, 1, 2].filter((index) => index !== axisIndex);
    const inferredOuter = Math.max(1_000, Math.floor(Math.min(
      bounds[radial[0] + 3] - bounds[radial[0]],
      bounds[radial[1] + 3] - bounds[radial[1]],
    ) / 2));
    const outer = integerParameter(parameters, "outer_radius", inferredOuter, 1);
    const inner = integerParameter(parameters, "inner_radius", Math.floor(outer / 2), 0);
    const start = integerParameter(parameters, "axial_start", bounds[axisIndex], undefined);
    const end = integerParameter(parameters, "axial_end", bounds[axisIndex + 3], undefined);
    const rawAngle = integerParameter(parameters, "angle", 360_000_000, undefined);
    const reverse = booleanParameter(parameters, "reverse", false);
    const sweep = Math.abs(rawAngle);
    if (sweep === 0 || sweep > 360_000_000) fail("invalid_input", "parameters.angle", "revolve angle must be non-zero and no greater than 360 degrees", "enter an angle from -360 through 360 degrees");
    // Principal-axis kernel requests encode direction through the signed UI
    // angle/reverse pair; their geometric sweep magnitude is always positive.
    void reverse;
    return { value: {
      kind: "revolve",
      axis_origin_nm: origin,
      axis,
      inner_radius_nm: inner,
      outer_radius_nm: outer,
      axial_start_nm: start,
      axial_end_nm: end,
      sweep_microdegrees: sweep,
      divisions: integerParameter(parameters, "divisions", 32, 1),
      tolerance_nm: toleranceNm,
    }, resolvedInputs: [] };
  }

  if (command.operationId.startsWith("crawler.part.boolean.")) {
    const target = resolveBody(runtime, active, selection.targetBodyId, "selection.targetBodyId");
    const toolIds = selection.toolBodyIds ?? [];
    if (toolIds.length === 0) fail("invalid_input", "selection.toolBodyIds", "boolean operations require at least one tool body", "select one or more durable tool bodies and retry");
    const tools = toolIds.map((bodyId, index) => resolveBody(runtime, active, bodyId, `selection.toolBodyIds[${index}]`));
    const kind = command.operationId.slice("crawler.part.boolean.".length);
    return { value: { kind: "boolean", operation: kind, target: target.body, tools: tools.map((tool) => tool.body), tolerance_nm: toleranceNm }, resolvedInputs: [target, ...tools] };
  }

  const sourceId = selection.sourceBodyId ?? selection.targetBodyId;
  const source = resolveBody(runtime, active, sourceId, "selection.sourceBodyId");
  if (command.operationId === "crawler.part.fillet" || command.operationId === "crawler.part.chamfer") {
    const edgeIds = exactStableIds(selection.edgeStableIds, "selection.edgeStableIds", true);
    const parameter = command.operationId.endsWith("fillet") ? "radius" : "distance";
    return { value: {
      kind: command.operationId.endsWith("fillet") ? "fillet" : "chamfer",
      target: source.body,
      edge_stable_ids: edgeIds,
      radius_nm: integerParameter(parameters, parameter, 1_000_000, 1),
      divisions: integerParameter(parameters, "divisions", 5, 1),
      tolerance_nm: toleranceNm,
    }, resolvedInputs: [source] };
  }

  const transformSource = selection.orderedFeatureIds?.length
    ? { semantics: "feature_sequence", ordered_feature_ids: [...selection.orderedFeatureIds], resolved_body: source.body }
    : { semantics: "body", body: source.body };
  if (command.operationId === "crawler.part.mirror") {
    return { value: { kind: "mirror", source: transformSource, plane_origin_nm: origin, plane_normal: axis, tolerance_nm: toleranceNm }, resolvedInputs: [source] };
  }
  if (command.operationId === "crawler.part.transform") {
    if (selection.orderedFeatureIds?.length) {
      fail("unsupported", "selection.orderedFeatureIds", "Transform requires one explicit durable body source", "select a body rather than a feature sequence and retry");
    }
    const translation = [
      integerParameter(parameters, "x", 0, undefined),
      integerParameter(parameters, "y", 0, undefined),
      integerParameter(parameters, "z", 10_000_000, undefined),
    ] as [number, number, number];
    if (translation.every((value) => value === 0)) {
      fail("invalid_input", "parameters", "Transform displacement must move the body", "enter a non-zero X, Y, or Z translation and retry");
    }
    return { value: { kind: "transform", source: transformSource, translation_nm: translation, tolerance_nm: toleranceNm }, resolvedInputs: [source] };
  }
  if (command.operationId === "crawler.part.pattern.linear") {
    if (booleanParameter(parameters, "symmetric", false)) fail("unsupported", "parameters.symmetric", "symmetric linear pattern placement is not qualified", "turn off Symmetric and retry");
    const count = integerParameter(parameters, "count", 2, 2);
    if (count > 1024) fail("invalid_input", "parameters.count", "pattern count exceeds the qualified limit of 1024", "reduce Count to 1024 or fewer instances");
    const spacing = integerParameter(parameters, "spacing", 10_000_000, 1) * (selection.directionSign ?? 1);
    const step = axisVector(axis, spacing);
    return { value: { kind: "linear_pattern", source: transformSource, instance_body_ids: instanceIds(command.outputBodyId!, count), step_nm: step, tolerance_nm: toleranceNm }, resolvedInputs: [source] };
  }
  if (command.operationId === "crawler.part.pattern.circular") {
    const count = integerParameter(parameters, "count", 4, 2);
    if (count > 1024) fail("invalid_input", "parameters.count", "pattern count exceeds the qualified limit of 1024", "reduce Count to 1024 or fewer instances");
    const total = integerParameter(parameters, "angle", 360_000_000, undefined);
    const step = Math.round(total / count) * (selection.directionSign ?? 1);
    if (step === 0 || Math.abs(step) > 360_000_000) fail("invalid_input", "parameters.angle", "circular pattern angle produces an invalid instance step", "enter a non-zero total angle no greater than 360 degrees");
    return { value: { kind: "circular_pattern", source: transformSource, instance_body_ids: instanceIds(command.outputBodyId!, count), axis_origin_nm: origin, axis, step_microdegrees: step, tolerance_nm: toleranceNm }, resolvedInputs: [source] };
  }
  if (command.operationId === "crawler.part.shell") {
    const removedFaceIds = exactStableIds(selection.removedFaceStableIds, "selection.removedFaceStableIds", true);
    if (removedFaceIds.length !== 1) {
      fail("invalid_input", "selection.removedFaceStableIds", "the qualified prismatic Shell requires exactly one face", "select one rectangular-prism face and retry");
    }
    return { value: {
      kind: "shell",
      target: source.body,
      removed_face_stable_ids: removedFaceIds,
      wall_thickness_nm: integerParameter(parameters, "thickness", 1_000_000, 1),
      tolerance_nm: toleranceNm,
    }, resolvedInputs: [source] };
  }
  fail("unsupported", "operationId", `unsupported advanced feature ${command.operationId}`, "choose a qualified alpha part-design operation");
}

function resolveBody(runtime: AdvancedFeatureRuntimeView, active: ActiveBodyState, bodyId: string | undefined, field: string): ResolvedBody {
  if (!bodyId) {
    if (active.body && active.feature_id) return { body: active.body, featureId: active.feature_id };
    fail("not_found", field, "the active timeline position has no durable kernel body", "create or import a body-producing feature, or restore the timeline to one");
  }
  const lookup = parseJson<{ found: boolean; feature_id?: string; body?: BodySnapshot; error?: AdvancedFeatureError }>(runtime.bodySnapshotJson(bodyId), field, "select a durable, unsuppressed body and retry");
  if (!lookup.found || !lookup.body || !lookup.feature_id) {
    throw new AdvancedFeatureBuildError(lookup.error ?? { category: "not_found", field, message: `body ${bodyId} was not found`, recovery: "select a durable, unsuppressed body and retry" });
  }
  return { body: lookup.body, featureId: lookup.feature_id };
}

function inferredOrigin(active: ActiveBodyState, axis: PrincipalAxis): [number, number, number] {
  const bounds = boundsNanometers(active);
  const origin: [number, number, number] = [
    Math.round((bounds[0] + bounds[3]) / 2),
    Math.round((bounds[1] + bounds[4]) / 2),
    Math.round((bounds[2] + bounds[5]) / 2),
  ];
  origin[axis === "x" ? 0 : axis === "y" ? 1 : 2] = 0;
  return origin;
}

function boundsNanometers(active: ActiveBodyState): [number, number, number, number, number, number] {
  const bounds = active.render?.packet?.bounds;
  if (!Array.isArray(bounds) || bounds.length !== 6 || bounds.some((value) => !Number.isFinite(value))) return [0, 0, 0, 10_000_000, 10_000_000, 10_000_000];
  return bounds.map((value) => Math.round(value * 1_000_000)) as [number, number, number, number, number, number];
}

function exactStableIds(values: readonly string[] | undefined, field: string, requireOne: boolean): ExactU64[] {
  if (requireOne && (!values || values.length === 0)) fail("invalid_input", field, "at least one stable topology reference is required", "select one or more edges and retry");
  return (values ?? []).map((value, index) => {
    if (!/^[0-9]+$/.test(value)) fail("invalid_input", `${field}[${index}]`, "stable topology IDs must be unsigned decimal integers", "select topology from the accepted render packet and retry");
    const parsed = BigInt(value);
    if (parsed === 0n || parsed > MAX_U64) fail("invalid_input", `${field}[${index}]`, "stable topology ID is outside the valid u64 range", "select topology from the accepted render packet and retry");
    return { [U64_MARKER]: value } as ExactU64;
  });
}

function integerParameter(values: Readonly<Record<string, number | boolean | string>>, key: string, fallback: number, minimum?: number): number {
  const value = values[key] ?? fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || (minimum !== undefined && value < minimum)) fail("invalid_input", `parameters.${key}`, `${key} must be an exact${minimum !== undefined ? ` integer of at least ${minimum}` : " integer"}`, `correct ${key} and retry`);
  return value;
}

function booleanParameter(values: Readonly<Record<string, number | boolean | string>>, key: string, fallback: boolean): boolean {
  const value = values[key] ?? fallback;
  if (typeof value !== "boolean") fail("invalid_input", `parameters.${key}`, `${key} must be a boolean`, `correct ${key} and retry`);
  return value;
}

function exactVector(values: readonly number[], field: string): [number, number, number] {
  if (values.length !== 3 || values.some((value) => !Number.isSafeInteger(value))) fail("invalid_input", field, "coordinate must contain three exact nanometer integers", "select a qualified principal reference and retry");
  return [...values] as [number, number, number];
}

function axisVector(axis: PrincipalAxis, value: number): [number, number, number] {
  return axis === "x" ? [value, 0, 0] : axis === "y" ? [0, value, 0] : [0, 0, value];
}

function instanceIds(outputBodyId: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${outputBodyId}:instance:${index}`);
}

function requireIdentity(value: string | undefined, field: string): string {
  if (!value?.trim()) fail("invalid_input", field, `${field} must be a non-empty caller-owned identity`, `supply a stable ${field} and retry`);
  return value;
}

function parseJson<T>(value: string, field: string, recovery: string): T {
  try { return JSON.parse(value) as T; }
  catch { fail("invalid_input", field, `${field} is not valid JSON`, recovery); }
}

function unique(values: readonly string[]): string[] { return [...new Set(values)]; }

function defaultDisplayName(operationId: AdvancedFeatureOperationId): string {
  return operationId.replace("crawler.part.", "").split(".").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}

function fail(category: AdvancedFeatureError["category"], field: string, message: string, recovery: string): never {
  throw new AdvancedFeatureBuildError({ category, field, message, recovery, preserved_inputs: [], problematic_reference: null });
}
