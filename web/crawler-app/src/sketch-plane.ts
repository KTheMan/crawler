import type { Point2, StableId } from "./sketch-editor";

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

/** Body-qualified lookup key because kernel topology IDs are body-local. */
export function planarFaceEvidenceKey(body: StableId, stableKernelId: string): string {
  return `${body}\u0000${stableKernelId}`;
}

export type SketchPlaneDocument = {
  bodies?: Record<string, { id?: string; generated_by?: string }>;
  origin_planes?: Record<string, {
    id?: string;
    plane?: OriginPlane;
    normal_millionths?: number[];
    x_axis_millionths?: number[];
  }>;
  topology_references?: Record<string, {
    id?: string;
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
    id?: string;
    origin_nanometers?: number[];
    x_axis_millionths?: number[];
    normal_millionths?: number[];
  }>;
};

export type PlaneResolution =
  | { status: "ready"; plane: ResolvedSketchPlane }
  | { status: "missing_reference"; support: SketchPlaneSupport; reference: StableId }
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
    const origin = tuple(definition?.origin_nanometers);
    const xAxis = tuple(definition?.x_axis_millionths);
    const normal = tuple(definition?.normal_millionths);
    if (!definition || !origin || !xAxis || !normal) return { status: "missing_reference", support, reference: support.plane };
    return { status: "ready", plane: makeFrame(support, "construction_plane", origin, xAxis, normal) };
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
  // Sets are accepted temporarily so renderer/main migration can type-check,
  // but an ID alone cannot authorize a frame. Only current body-qualified
  // surface evidence can provide working-frame coordinates.
  const evidenceLookup = currentPlanarFaces as Partial<CurrentPlanarFaceEvidenceLookup>;
  const evidence = stableKernelId === undefined || typeof evidenceLookup.get !== "function"
    ? undefined
    : evidenceLookup.get(planarFaceEvidenceKey(body, stableKernelId));
  const origin = tuple(evidence?.centroid_nanometers);
  const observedNormal = tuple(evidence?.normal_millionths);
  const evidenceMatchesReference = evidence?.body === body && evidence.stable_kernel_id === stableKernelId;
  if (!evidenceMatchesReference || !origin || !observedNormal || length(observedNormal) === 0) {
    return { status: "surface_evidence_required", support, stable_kernel_id: stableKernelId };
  }
  // Tessellation winding is not semantic orientation. Preserve the durable
  // support's polarity while sourcing the actual plane from current topology.
  const normal = dot(observedNormal, fallbackNormal) < 0 ? scale(observedNormal, -1) : observedNormal;
  return { status: "ready", plane: makeFrame(support, "planar_face", origin, deterministicXAxis(normal), normal) };
}

export function originPlaneSupport(plane: OriginPlane): SketchPlaneSupport {
  return { kind: "origin_plane_reference", plane: `origin-plane:${plane}` };
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
