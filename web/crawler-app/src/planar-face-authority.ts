import type { PlanarFaceFrameAuthority, PlanarFaceFrameDiagnostic, PlanarFaceFrameRequest } from "./protocol";

type RuntimeFailure = {
  found?: false;
  body_id?: unknown;
  face_stable_id?: unknown;
  error?: {
    code?: unknown;
    category?: unknown;
    field?: unknown;
    message?: unknown;
    reference?: { body_id?: unknown; face_stable_id?: unknown };
    referenced_body_ids?: unknown;
  };
};

export type NormalizedPlanarFaceFrameResult =
  | { ok: true; authority: PlanarFaceFrameAuthority }
  | { ok: false; diagnostic: PlanarFaceFrameDiagnostic };

export function planarFaceAuthorityKey(bodyId: string, faceStableId: string): string {
  return `${bodyId}\u0000${faceStableId}`;
}

/** Same-body modifiers retain prior producers explicitly; unrelated IDs remain invalid. */
export function bodyAcceptsFeatureProducer(
  body: { generated_by?: string; producer_lineage?: readonly string[] } | undefined,
  producerFeatureId: string,
): boolean {
  return Boolean(body && (body.generated_by === producerFeatureId || body.producer_lineage?.includes(producerFeatureId)));
}

export function normalizePlanarFaceFrameResult(raw: unknown, request: PlanarFaceFrameRequest): NormalizedPlanarFaceFrameResult {
  const value = raw as Record<string, unknown> | null;
  if (!value || typeof value !== "object") return invalidResult(request, "invalid_planar_face_frame_response", "Planar face frame response is not an object");
  if (value.found === false) return { ok: false, diagnostic: normalizeRuntimeDiagnostic(value as RuntimeFailure, request) };
  if (value.found !== true) return invalidResult(request, "invalid_planar_face_frame_response", "Planar face frame response has no found discriminator");

  const frame = value.frame as Record<string, unknown> | null;
  const acceptedRevision = exactInteger(value.accepted_revision);
  const originNanometers = exactTuple(frame?.origin_nanometers);
  const xAxisMillionths = exactTuple(frame?.x_axis_millionths);
  const yAxisMillionths = exactTuple(frame?.y_axis_millionths);
  const normalMillionths = exactTuple(frame?.normal_millionths);
  const bodyId = stringValue(value.body_id);
  const componentId = stringValue(value.component_id);
  const producerFeatureId = stringValue(value.producer_feature_id);
  const faceStableId = stringValue(value.face_stable_id);
  const originVertexStableId = stringValue(value.origin_vertex_stable_id);
  const frameConvention = stringValue(value.frame_convention);
  const tolerance = exactInteger(value.orthonormal_tolerance_millionths);
  if (acceptedRevision === undefined || !originNanometers || !xAxisMillionths || !yAxisMillionths || !normalMillionths
    || !bodyId || !componentId || !producerFeatureId || !faceStableId || !originVertexStableId || !frameConvention
    || tolerance === undefined || value.face_kind !== "face" || value.analytic_surface !== "plane"
    || value.handedness !== "right" || value.scale_millionths !== 1_000_000) {
    return invalidResult(request, "invalid_planar_face_frame_response", "Planar face frame response is incomplete or violates the frame contract");
  }
  if (acceptedRevision !== request.expectedAcceptedRevision || bodyId !== request.bodyId
    || componentId !== request.expectedComponentId || producerFeatureId !== request.expectedProducerFeatureId
    || faceStableId !== request.faceStableId) {
    return invalidResult(request, "stale_planar_face_authority", "Planar face authority no longer matches the accepted revision, body, producer, component, or face", "stale_reference");
  }
  return { ok: true, authority: {
    acceptedRevision, bodyId, componentId, producerFeatureId, faceStableId,
    originVertexStableId, frameConvention, handedness: "right", scaleMillionths: 1_000_000,
    orthonormalToleranceMillionths: tolerance,
    frame: { originNanometers, xAxisMillionths, yAxisMillionths, normalMillionths },
  } };
}

function normalizeRuntimeDiagnostic(raw: RuntimeFailure, request: PlanarFaceFrameRequest): PlanarFaceFrameDiagnostic {
  const error = raw.error;
  const allowedCategories = new Set(["not_found", "stale_reference", "unsupported", "invalid_input", "invalid_geometry"]);
  const category = typeof error?.category === "string" && allowedCategories.has(error.category)
    ? error.category as PlanarFaceFrameDiagnostic["category"] : "invalid_geometry";
  return {
    code: stringValue(error?.code) ?? "planar_face_frame_unavailable",
    category,
    field: stringValue(error?.field) ?? "planar_face.frame",
    message: stringValue(error?.message) ?? "The native planar face frame is unavailable",
    reference: {
      bodyId: stringValue(error?.reference?.body_id) ?? request.bodyId,
      faceStableId: stringValue(error?.reference?.face_stable_id) ?? request.faceStableId,
    },
    referencedBodyIds: Array.isArray(error?.referenced_body_ids)
      ? error.referenced_body_ids.filter((item): item is string => typeof item === "string") : [request.bodyId],
  };
}

function invalidResult(
  request: PlanarFaceFrameRequest,
  code: string,
  message: string,
  category: PlanarFaceFrameDiagnostic["category"] = "invalid_geometry",
): NormalizedPlanarFaceFrameResult {
  return { ok: false, diagnostic: {
    code, category, field: "planar_face.frame", message,
    reference: { bodyId: request.bodyId, faceStableId: request.faceStableId },
    referencedBodyIds: [request.bodyId],
  } };
}

function exactInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function exactTuple(value: unknown): readonly [number, number, number] | undefined {
  return Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === "number" && Number.isSafeInteger(item))
    ? [value[0], value[1], value[2]] : undefined;
}
