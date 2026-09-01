import type { AcceptedTransaction, OffsetConstructionPlaneRequest, RecomputeReport } from "./protocol";
import type { OriginPlane } from "./sketch-plane";

const NANOMETERS_PER_MILLIMETER = 1_000_000n;

export interface OffsetConstructionPlaneDraft {
  planeId: string;
  componentId: string;
  basePlane: OriginPlane;
  offsetParameterId: string;
  offsetMillimeters: string;
  suppressed: boolean;
  transactionId: string;
  baseRevision: number;
}

/** Parse signed decimal millimeters without routing durable values through a float. */
export function exactSignedMillimetersToNanometers(source: string): number | undefined {
  const match = source.trim().match(/^([+-]?)(\d+)(?:\.(\d{0,6}))?$/);
  if (!match) return undefined;
  const fraction = (match[3] ?? "").padEnd(6, "0");
  const magnitude = BigInt(match[2]) * NANOMETERS_PER_MILLIMETER + BigInt(fraction || "0");
  const signed = match[1] === "-" ? -magnitude : magnitude;
  const value = Number(signed);
  return Number.isSafeInteger(value) ? (Object.is(value, -0) ? 0 : value) : undefined;
}

export function offsetNanometersToMillimeters(value: number): string {
  if (!Number.isSafeInteger(value)) throw new TypeError("construction plane offset must be an exact nanometer integer");
  const sign = value < 0 ? "-" : "";
  const magnitude = Math.abs(value);
  const whole = Math.floor(magnitude / 1_000_000);
  const fraction = String(magnitude % 1_000_000).padStart(6, "0").replace(/0+$/, "");
  return `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function buildOffsetConstructionPlaneRequest(draft: OffsetConstructionPlaneDraft): OffsetConstructionPlaneRequest | undefined {
  const offsetNanometers = exactSignedMillimetersToNanometers(draft.offsetMillimeters);
  if (offsetNanometers === undefined
    || !draft.planeId
    || !draft.componentId
    || !draft.offsetParameterId
    || !draft.transactionId
    || !Number.isSafeInteger(draft.baseRevision)
    || draft.baseRevision < 0) return undefined;
  return {
    plane_id: draft.planeId,
    component_id: draft.componentId,
    base_plane_id: `origin-plane:${draft.basePlane}`,
    offset_parameter_id: draft.offsetParameterId,
    offset_nanometers: offsetNanometers,
    suppressed: draft.suppressed,
    transaction_id: draft.transactionId,
    base_revision: draft.baseRevision,
  };
}

export function constructionPlaneOffsetInputError(source: string): string | undefined {
  if (!source.trim().match(/^([+-]?)(\d+)(?:\.(\d{0,6}))?$/)) {
    return "Enter a signed decimal offset with at most six decimal places.";
  }
  if (exactSignedMillimetersToNanometers(source) === undefined) {
    return "construction_plane.offset_parameter: Offset exceeds the exact safe nanometer range (±9007199254.740991 mm).";
  }
  return undefined;
}

export type ConstructionPlaneRuntimeErrorMapping = {
  code: "missing_construction_plane_base_plane" | "missing_construction_plane_offset_parameter" | "wrong_type_construction_plane_offset_parameter" | "unsafe_construction_plane_offset_parameter" | "invalid_construction_plane_dependency" | "offset_construction_plane_preview_refused" | "offset_construction_plane_commit_refused";
  field: "construction_plane.base_plane" | "construction_plane.offset_parameter" | "offset";
  recovery: string;
  category: "reference" | "invalid_input";
  referencedEntityIds?: string[];
};

const CONSTRUCTION_PLANE_RUNTIME_ERROR_CODES = new Set<ConstructionPlaneRuntimeErrorMapping["code"]>([
  "missing_construction_plane_base_plane",
  "missing_construction_plane_offset_parameter",
  "wrong_type_construction_plane_offset_parameter",
  "unsafe_construction_plane_offset_parameter",
  "invalid_construction_plane_dependency",
  "offset_construction_plane_preview_refused",
  "offset_construction_plane_commit_refused",
]);

export function isConstructionPlaneRuntimeErrorCode(
  code: string,
): code is ConstructionPlaneRuntimeErrorMapping["code"] {
  return CONSTRUCTION_PLANE_RUNTIME_ERROR_CODES.has(code as ConstructionPlaneRuntimeErrorMapping["code"]);
}

export type ConstructionPlaneSupportRuntimeErrorMapping = {
  code: "missing_construction_plane_support" | "suppressed_construction_plane_support" | "invalid_construction_plane_dependency";
  field: "extrude.support";
  recovery: string;
  referencedEntityIds: string[];
};

const CONSTRUCTION_PLANE_SUPPORT_RUNTIME_ERROR_CODES = new Set<ConstructionPlaneSupportRuntimeErrorMapping["code"]>([
  "missing_construction_plane_support",
  "suppressed_construction_plane_support",
  "invalid_construction_plane_dependency",
]);

export function isConstructionPlaneSupportRuntimeErrorCode(code: string): code is ConstructionPlaneSupportRuntimeErrorMapping["code"] {
  return CONSTRUCTION_PLANE_SUPPORT_RUNTIME_ERROR_CODES.has(code as ConstructionPlaneSupportRuntimeErrorMapping["code"]);
}

/** Parse the runtime's stable support-repair contract without guessing from generic prose. */
export function constructionPlaneSupportRuntimeErrorMapping(error: unknown): ConstructionPlaneSupportRuntimeErrorMapping | undefined {
  const message = error instanceof Error ? error.message : String(error);
  const code = [...CONSTRUCTION_PLANE_SUPPORT_RUNTIME_ERROR_CODES].find((candidate) => message.includes(candidate));
  if (!code || !message.includes("extrude.support")) return undefined;
  const referenced = code === "invalid_construction_plane_dependency"
    ? message.match(/references (?:missing entity|base plane) ([^\s,]+)/)?.[1]
    : message.match(/referenced entity ([^\s,]+)/)?.[1];
  if (!referenced) throw new TypeError(`${code} omitted its referenced entity identity`);
  const recovery = code === "missing_construction_plane_support"
    ? "select or restore the referenced construction plane"
    : code === "suppressed_construction_plane_support"
      ? "unsuppress the referenced construction plane"
      : "restore or rebind the construction plane dependency";
  return { code, field: "extrude.support", recovery, referencedEntityIds: [referenced] };
}

/** Derive the UI report from feature results actually accepted by the runtime. */
export function constructionPlaneRecomputeReport(
  planeId: string,
  transaction: AcceptedTransaction,
): RecomputeReport {
  const evaluationOrder: string[] = [];
  for (const change of transaction.changes) {
    if (change.kind !== "accept_feature_result") continue;
    if (typeof change.feature !== "string" || change.feature.length === 0) {
      throw new TypeError("accepted construction-plane feature result is missing its feature identity");
    }
    if (evaluationOrder.includes(change.feature)) {
      throw new TypeError(`accepted construction-plane feature result repeats ${change.feature}`);
    }
    evaluationOrder.push(change.feature);
  }
  return { dirtyRoots: [planeId], evaluationOrder };
}

/** Preserve runtime repair tokens as structured worker errors for UI/tests. */
export function constructionPlaneRuntimeErrorMapping(
  error: unknown,
  stage: "preview" | "commit",
): ConstructionPlaneRuntimeErrorMapping {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("missing_construction_plane_base_plane")) {
    return {
      code: "missing_construction_plane_base_plane",
      field: "construction_plane.base_plane",
      recovery: "select an existing unsuppressed origin plane",
      category: "reference",
      referencedEntityIds: referencedEntities(message),
    };
  }
  if (message.includes("missing_construction_plane_offset_parameter")) {
    return {
      code: "missing_construction_plane_offset_parameter",
      field: "construction_plane.offset_parameter",
      recovery: "restore or replace the missing length parameter",
      category: "reference",
      referencedEntityIds: referencedEntities(message),
    };
  }
  if (message.includes("wrong_type_construction_plane_offset_parameter")) {
    return {
      code: "wrong_type_construction_plane_offset_parameter",
      field: "construction_plane.offset_parameter",
      recovery: "replace the referenced value with an exact length parameter",
      category: "reference",
      referencedEntityIds: referencedEntities(message),
    };
  }
  if (message.includes("unsafe_construction_plane_offset_parameter")) {
    return {
      code: "unsafe_construction_plane_offset_parameter",
      field: "construction_plane.offset_parameter",
      recovery: "enter an offset within the exact safe nanometer range",
      category: "reference",
      referencedEntityIds: referencedEntities(message),
    };
  }
  if (message.includes("invalid_construction_plane_dependency")) {
    const field = message.includes("construction_plane.offset_parameter")
      ? "construction_plane.offset_parameter" as const
      : "construction_plane.base_plane" as const;
    const referenced = message.match(/references (?:base plane|parameter) ([^\s,]+)/)?.[1];
    if (!referenced) throw new TypeError("invalid_construction_plane_dependency omitted its referenced entity identity");
    return {
      code: "invalid_construction_plane_dependency",
      field,
      recovery: field === "construction_plane.base_plane" ? "select a base plane in the same component" : "select an offset parameter in the same component",
      category: "reference",
      referencedEntityIds: [referenced],
    };
  }
  return stage === "preview"
    ? { code: "offset_construction_plane_preview_refused", field: "offset", recovery: "select an origin plane and enter an exact signed offset", category: "invalid_input" }
    : { code: "offset_construction_plane_commit_refused", field: "offset", recovery: "correct the construction plane inputs and retry", category: "invalid_input" };
}

function referencedEntities(message: string): string[] | undefined {
  const referenced = message.match(/referenced (?:entity|parameter) ([^\s,]+)/)?.[1];
  return referenced ? [referenced] : undefined;
}
