import type { Point2, StableId } from "./sketch-editor";
import type { PlanarFaceFrameAuthority } from "./protocol";

export type Vector3Tuple = readonly [number, number, number];
export type OriginPlane = "xy" | "xz" | "yz";

export type SketchPlaneSupport =
  | { kind: "origin_plane"; plane: OriginPlane }
  | { kind: "origin_plane_reference"; plane: StableId }
  | { kind: "topology"; reference: StableId }
  | { kind: "construction_plane_reference"; plane: StableId };

/**
 * Durable plane-local coordinate frame. Positions are exact document
 * nanometers and directions are normalized millionths so this contract can
 * cross the document/runtime/WASM boundary without floating-point unit drift.
 */
export type ResolvedSketchPlane = {
  support: SketchPlaneSupport;
  source: "origin_plane" | "planar_face" | "construction_plane";
  origin_nanometers: Vector3Tuple;
  x_axis_millionths: Vector3Tuple;
  y_axis_millionths: Vector3Tuple;
  normal_millionths: Vector3Tuple;
};

/**
 * Current, packet-derived evidence for one verified planar face.
 *
 * Stable kernel IDs are scoped to their owning body. Durable fallback
 * signatures are intentionally absent from this type: they are repair
 * evidence, not authority for the current working frame.
 */
export type CurrentPlanarFaceEvidence = {
  body: StableId;
  /** Decimal u64 transported losslessly through JSON. */
  stable_kernel_id: string;
  centroid_nanometers: Vector3Tuple;
  normal_millionths: Vector3Tuple;
  area_square_nanometers?: number;
};

export type CurrentPlanarFaceEvidenceLookup = ReadonlyMap<string, CurrentPlanarFaceEvidence>;
export type NativePlanarFaceAuthorityLookup = ReadonlyMap<string, PlanarFaceFrameAuthority>;

/** Body-qualified lookup key because kernel topology IDs are body-local. */
export function planarFaceEvidenceKey(body: StableId, stableKernelId: string): string {
  return `${body}\u0000${stableKernelId}`;
}

export type SketchPlaneDocument = {
  revision?: number;
  bodies?: Record<string, { id?: string; component?: string; generated_by?: string; producer_lineage?: readonly string[]; suppressed?: boolean }>;
  features?: Record<string, { id?: string; component?: string; suppressed?: boolean }>;
  origin_planes?: Record<string, {
    id?: string;
    component?: string;
    plane?: OriginPlane;
    normal_millionths?: number[];
    x_axis_millionths?: number[];
  }>;
  topology_references?: Record<string, {
    schema_version?: number;
    id?: string;
    component?: string;
    body?: string;
    producer?: string;
    kind?: string;
    /** Decimal u64 transported losslessly through JSON. */
    stable_kernel_id?: string;
    stable_token?: string;
    fallback_signature?: {
      kind?: string;
      centroid_nanometers?: number[];
      normal_millionths?: number[];
      area_square_nanometers?: number;
    };
  }>;
  construction_planes?: Record<string, {
    schema_version?: number;
    id?: string;
    component?: string;
    definition?: {
      kind?: string;
      base_plane?: StableId;
      offset?: StableId;
    };
    suppressed?: boolean;
  }>;
  parameters?: Record<string, {
    value?: { kind?: string; value?: number };
  }>;
};

export type PlaneResolution =
  | { status: "ready"; plane: ResolvedSketchPlane }
  | { status: "missing_reference"; support: SketchPlaneSupport; reference: StableId }
  | { status: "suppressed_reference"; support: Extract<SketchPlaneSupport, { kind: "construction_plane_reference" }>; reference: StableId }
  | { status: "invalid_reference"; support: Extract<SketchPlaneSupport, { kind: "construction_plane_reference" }>; reference: StableId; reason: string }
  | { status: "surface_evidence_required"; support: Extract<SketchPlaneSupport, { kind: "topology" }>; stable_kernel_id?: string };

const MILLION = 1_000_000;
const NANOMETERS_PER_MILLIMETER = 1_000_000;

const canonicalOriginPlanes: Record<OriginPlane, Omit<ResolvedSketchPlane, "support">> = {
  xy: {
    source: "origin_plane",
    origin_nanometers: [0, 0, 0],
    x_axis_millionths: [MILLION, 0, 0],
    y_axis_millionths: [0, MILLION, 0],
    normal_millionths: [0, 0, MILLION],
  },
  xz: {
    source: "origin_plane",
    origin_nanometers: [0, 0, 0],
    x_axis_millionths: [MILLION, 0, 0],
    y_axis_millionths: [0, 0, MILLION],
    normal_millionths: [0, -MILLION, 0],
  },
  yz: {
    source: "origin_plane",
    origin_nanometers: [0, 0, 0],
    x_axis_millionths: [0, MILLION, 0],
    y_axis_millionths: [0, 0, MILLION],
    normal_millionths: [MILLION, 0, 0],
  },
};

export function resolveSketchPlane(
  support: SketchPlaneSupport,
  document: SketchPlaneDocument,
  currentPlanarFaces: CurrentPlanarFaceEvidenceLookup | ReadonlySet<string> = new Map(),
  nativePlanarFaceAuthorities: NativePlanarFaceAuthorityLookup = new Map(),
): PlaneResolution {
  if (support.kind === "origin_plane") return { status: "ready", plane: { support, ...canonicalOriginPlanes[support.plane] } };
  if (support.kind === "origin_plane_reference") {
    const definition = document.origin_planes?.[support.plane];
    const legacyName = support.plane.startsWith("origin-plane:") ? support.plane.slice("origin-plane:".length) : undefined;
    const plane = definition?.plane ?? (isOriginPlane(legacyName) ? legacyName : undefined);
    if (!plane) return { status: "missing_reference", support, reference: support.plane };
    const normal = tuple(definition?.normal_millionths) ?? canonicalOriginPlanes[plane].normal_millionths;
    const xAxis = tuple(definition?.x_axis_millionths) ?? canonicalOriginPlanes[plane].x_axis_millionths;
    return { status: "ready", plane: makeFrame(support, "origin_plane", [0, 0, 0], xAxis, normal) };
  }
  if (support.kind === "construction_plane_reference") {
    const definition = document.construction_planes?.[support.plane];
    if (!definition) return { status: "missing_reference", support, reference: support.plane };
    if (definition.suppressed) return { status: "suppressed_reference", support, reference: support.plane };
    if (definition.schema_version !== 1) return { status: "invalid_reference", support, reference: support.plane, reason: "construction plane schema_version must be 1" };
    if (definition.definition?.kind !== "offset") return { status: "invalid_reference", support, reference: support.plane, reason: "construction plane definition kind must be offset" };
    if (!definition.definition.base_plane) return { status: "invalid_reference", support, reference: support.plane, reason: "construction plane base_plane is missing" };
    if (!definition.definition.offset) return { status: "invalid_reference", support, reference: support.plane, reason: "construction plane offset parameter is missing" };
    const baseDefinition = document.origin_planes?.[definition.definition.base_plane];
    if (!baseDefinition) return { status: "missing_reference", support, reference: definition.definition.base_plane };
    if (definition.component && baseDefinition.component && definition.component !== baseDefinition.component) {
      return { status: "invalid_reference", support, reference: support.plane, reason: "construction plane and base plane belong to different components" };
    }
    const offset = document.parameters?.[definition.definition.offset]?.value;
    if (!offset) return { status: "missing_reference", support, reference: definition.definition.offset };
    if (offset.kind !== "length_nanometers" || typeof offset.value !== "number" || !Number.isSafeInteger(offset.value)) {
      return { status: "invalid_reference", support, reference: support.plane, reason: "construction plane offset must be an exact length_nanometers integer" };
    }
    const base = resolveSketchPlane({ kind: "origin_plane_reference", plane: definition.definition.base_plane }, document, currentPlanarFaces, nativePlanarFaceAuthorities);
    if (base.status !== "ready") return { status: "missing_reference", support, reference: definition.definition.base_plane };
    const origin = base.plane.origin_nanometers.map((coordinate, index) => {
      const translated = BigInt(coordinate) + BigInt(base.plane.normal_millionths[index]) * BigInt(offset.value!) / BigInt(MILLION);
      const value = Number(translated);
      if (!Number.isSafeInteger(value)) throw new RangeError("construction plane origin exceeds the exact nanometer range");
      return value === 0 ? 0 : value;
    }) as unknown as Vector3Tuple;
    return { status: "ready", plane: makeFrame(support, "construction_plane", origin, base.plane.x_axis_millionths, base.plane.normal_millionths) };
  }

  const reference = document.topology_references?.[support.reference];
  const signature = reference?.fallback_signature;
  const fallbackOrigin = tuple(signature?.centroid_nanometers);
  const fallbackNormal = tuple(signature?.normal_millionths);
  const stableKernelId = reference?.stable_kernel_id;
  const body = reference?.body;
  if (!reference || reference.kind !== "face" || signature?.kind !== "face" || !fallbackOrigin || !fallbackNormal || !body) {
    return { status: "missing_reference", support, reference: support.reference };
  }
  // Renderer evidence may locate a face and populate a repair signature, but
  // only the native runtime may authorize the working frame.
  void currentPlanarFaces;
  const authority = stableKernelId === undefined
    ? undefined
    : nativePlanarFaceAuthorities.get(planarFaceEvidenceKey(body, stableKernelId));
  if (!authority || authority.bodyId !== body || authority.faceStableId !== stableKernelId) {
    return { status: "surface_evidence_required", support, stable_kernel_id: stableKernelId };
  }
  return { status: "ready", plane: {
    support, source: "planar_face",
    origin_nanometers: authority.frame.originNanometers,
    x_axis_millionths: authority.frame.xAxisMillionths,
    y_axis_millionths: authority.frame.yAxisMillionths,
    normal_millionths: authority.frame.normalMillionths,
  } };
}

export function originPlaneSupport(plane: OriginPlane): SketchPlaneSupport {
  return { kind: "origin_plane_reference", plane: `origin-plane:${plane}` };
}

/** Compare canonical working frames rather than their serialized support form. */
export function resolvedSketchPlanesEqual(left: ResolvedSketchPlane, right: ResolvedSketchPlane): boolean {
  return left.source === right.source
    && tuplesEqual(left.origin_nanometers, right.origin_nanometers)
    && tuplesEqual(left.x_axis_millionths, right.x_axis_millionths)
    && tuplesEqual(left.y_axis_millionths, right.y_axis_millionths)
    && tuplesEqual(left.normal_millionths, right.normal_millionths);
}

export function planeLocalToWorldMillimeters(point: Point2, plane: ResolvedSketchPlane): Vector3Tuple {
  const xMillimeters = point.x_nm / NANOMETERS_PER_MILLIMETER;
  const yMillimeters = point.y_nm / NANOMETERS_PER_MILLIMETER;
  const origin = plane.origin_nanometers.map((value) => value / NANOMETERS_PER_MILLIMETER) as unknown as Vector3Tuple;
  const xAxis = plane.x_axis_millionths.map((value) => value / MILLION) as unknown as Vector3Tuple;
  const yAxis = plane.y_axis_millionths.map((value) => value / MILLION) as unknown as Vector3Tuple;
  return [
    origin[0] + xAxis[0] * xMillimeters + yAxis[0] * yMillimeters,
    origin[1] + xAxis[1] * xMillimeters + yAxis[1] * yMillimeters,
    origin[2] + xAxis[2] * xMillimeters + yAxis[2] * yMillimeters,
  ];
}

export function worldMillimetersToPlaneLocal(point: Vector3Tuple, plane: ResolvedSketchPlane): Point2 {
  const origin = plane.origin_nanometers.map((value) => value / NANOMETERS_PER_MILLIMETER) as unknown as Vector3Tuple;
  const delta: Vector3Tuple = [point[0] - origin[0], point[1] - origin[1], point[2] - origin[2]];
  return {
    x_nm: Math.round(dot(delta, plane.x_axis_millionths) * NANOMETERS_PER_MILLIMETER / MILLION),
    y_nm: Math.round(dot(delta, plane.y_axis_millionths) * NANOMETERS_PER_MILLIMETER / MILLION),
  };
}

export function intersectRayWithSketchPlane(
  rayOriginMillimeters: Vector3Tuple,
  rayDirection: Vector3Tuple,
  plane: ResolvedSketchPlane,
): Point2 | undefined {
  const origin = plane.origin_nanometers.map((value) => value / NANOMETERS_PER_MILLIMETER) as unknown as Vector3Tuple;
  const normal = plane.normal_millionths;
  const denominator = dot(rayDirection, normal);
  if (Math.abs(denominator) < 1e-9) return undefined;
  const offset: Vector3Tuple = [origin[0] - rayOriginMillimeters[0], origin[1] - rayOriginMillimeters[1], origin[2] - rayOriginMillimeters[2]];
  const distance = dot(offset, normal) / denominator;
  if (distance < 0) return undefined;
  return worldMillimetersToPlaneLocal([
    rayOriginMillimeters[0] + rayDirection[0] * distance,
    rayOriginMillimeters[1] + rayDirection[1] * distance,
    rayOriginMillimeters[2] + rayDirection[2] * distance,
  ], plane);
}

function makeFrame(
  support: SketchPlaneSupport,
  source: ResolvedSketchPlane["source"],
  origin: Vector3Tuple,
  xAxisInput: Vector3Tuple,
  normalInput: Vector3Tuple,
): ResolvedSketchPlane {
  const normal = normalizeMillionths(normalInput);
  const xProjected = subtract(xAxisInput, scale(normal, dot(xAxisInput, normal) / (MILLION * MILLION)));
  const xAxis = normalizeMillionths(length(xProjected) > 1 ? xProjected : deterministicXAxis(normal));
  const yAxis = normalizeMillionths(cross(normal, xAxis));
  return {
    support,
    source,
    origin_nanometers: origin.map((component) => canonicalInteger(component)) as unknown as Vector3Tuple,
    x_axis_millionths: xAxis,
    y_axis_millionths: yAxis,
    normal_millionths: normal,
  };
}

function tuplesEqual(left: Vector3Tuple, right: Vector3Tuple): boolean {
  return left[0] === right[0] && left[1] === right[1] && left[2] === right[2];
}

function deterministicXAxis(normalInput: Vector3Tuple): Vector3Tuple {
  const normal = normalizeMillionths(normalInput);
  const candidates: Vector3Tuple[] = [[MILLION, 0, 0], [0, MILLION, 0], [0, 0, MILLION]];
  const seed = candidates.sort((a, b) => Math.abs(dot(a, normal)) - Math.abs(dot(b, normal)))[0];
  return normalizeMillionths(subtract(seed, scale(normal, dot(seed, normal) / (MILLION * MILLION))));
}

function isOriginPlane(value: string | undefined): value is OriginPlane {
  return value === "xy" || value === "xz" || value === "yz";
}

function tuple(value: readonly number[] | undefined): Vector3Tuple | undefined {
  return value?.length === 3 && value.every(Number.isFinite) ? [value[0], value[1], value[2]] : undefined;
}

function dot(a: Vector3Tuple, b: Vector3Tuple): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function length(value: Vector3Tuple): number { return Math.hypot(value[0], value[1], value[2]); }
function scale(value: Vector3Tuple, factor: number): Vector3Tuple { return [value[0] * factor, value[1] * factor, value[2] * factor]; }
function subtract(a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normalizeMillionths(value: Vector3Tuple): Vector3Tuple {
  const magnitude = length(value);
  if (magnitude === 0) throw new Error("Sketch plane direction must be non-zero");
  return value.map((component) => canonicalInteger(component * MILLION / magnitude)) as unknown as Vector3Tuple;
}

function canonicalInteger(value: number): number {
  const rounded = Math.round(value);
  return rounded === 0 ? 0 : rounded;
}
