export type ExtrudeResultMode = "new_body" | "cut";

export interface ExtrudeParticipantBody {
  role?: string;
  body?: string;
}

export interface DurableExtrudeResultDefinition {
  result?: { mode?: string; body?: string };
  participant_bodies?: readonly ExtrudeParticipantBody[];
}

export interface ExtrudeCutDiagnostic {
  code: string;
  category: "invalid_input" | "reference" | "stale_reference" | "invalid_geometry" | "empty_result" | "unsupported" | "not_found" | "target" | "ownership" | "boolean";
  field: string;
  message: string;
  recovery: string;
  referencedEntityIds: readonly string[];
}

export class ExtrudeTargetError extends Error {
  readonly code: "target_required" | "target_missing" | "target_ambiguous" | "target_owner_mismatch";

  constructor(
    code: "target_required" | "target_missing" | "target_ambiguous" | "target_owner_mismatch",
    message: string,
  ) {
    super(message);
    this.name = "ExtrudeTargetError";
    this.code = code;
  }
}

const EXTRUDE_CUT_ERROR_CODES = new Set([
  "missing_cut_target", "missing_cut_target_producer", "stale_cut_target", "suppressed_cut_target",
  "wrong_component_cut_target", "wrong_owner_cut_target", "explicit_target_required", "no_intersection",
  "remove_all_material", "nonmanifold_result", "cut_refused", "extrude_cut_refused",
]);

export function isExtrudeCutErrorCode(code: string): boolean {
  return EXTRUDE_CUT_ERROR_CODES.has(code);
}

export function parseExtrudeResultMode(value: unknown): ExtrudeResultMode | undefined {
  return value === "new_body" || value === "cut" ? value : undefined;
}

/**
 * Resolve the one explicit Cut target without silently choosing a body. The
 * optional support owner makes current planar-face support fail closed when a
 * different body is selected.
 */
export function requireSingleCutTarget(
  selectedTargetBodyId: string | undefined,
  acceptedBodyIds: readonly string[],
  supportOwnerBodyId?: string,
): string {
  if (!selectedTargetBodyId) {
    throw new ExtrudeTargetError("target_required", "Select one current target body for Cut.");
  }
  if (acceptedBodyIds.filter((bodyId) => bodyId === selectedTargetBodyId).length !== 1) {
    throw new ExtrudeTargetError("target_missing", "The selected Cut target is not a current accepted body.");
  }
  if (supportOwnerBodyId && supportOwnerBodyId !== selectedTargetBodyId) {
    throw new ExtrudeTargetError("target_owner_mismatch", "A face-supported Cut must target the body that owns the support face.");
  }
  return selectedTargetBodyId;
}

/** Read the retained body identity from an exact Extrude V2 result contract. */
export function retainedExtrudeBody(definition: DurableExtrudeResultDefinition): {
  mode: ExtrudeResultMode;
  bodyId: string;
} {
  const mode = parseExtrudeResultMode(definition.result?.mode);
  if (mode === "new_body" && definition.result?.body) return { mode, bodyId: definition.result.body };
  if (mode !== "cut") {
    throw new ExtrudeTargetError("target_missing", "The Extrude result contract is incomplete.");
  }
  const targets = (definition.participant_bodies ?? []).filter((participant) => participant.role === "target" && participant.body);
  if (targets.length !== 1) {
    throw new ExtrudeTargetError("target_ambiguous", "Cut must retain exactly one target body participant.");
  }
  return { mode, bodyId: targets[0]!.body! };
}

/** Normalize native/WASM Cut refusals into the recoverable worker protocol. */
export function normalizeExtrudeCutFailure(error: unknown, targetBodyId?: string): ExtrudeCutDiagnostic {
  const raw = error as { code?: unknown; category?: unknown; field?: unknown; field_path?: unknown; message?: unknown; recovery?: unknown; referenced_entity_ids?: unknown } | null;
  const nested = raw && typeof raw === "object" && "error" in raw
    ? (raw as { error?: typeof raw }).error ?? raw
    : raw;
  const message = typeof nested?.message === "string" ? nested.message : error instanceof Error ? error.message : String(error);
  const knownCategories = new Set<ExtrudeCutDiagnostic["category"]>([
    "invalid_input", "reference", "stale_reference", "invalid_geometry", "empty_result", "unsupported", "not_found", "target", "ownership", "boolean",
  ]);
  const explicitCategory = typeof nested?.category === "string" && knownCategories.has(nested.category as ExtrudeCutDiagnostic["category"])
    ? nested.category as ExtrudeCutDiagnostic["category"] : undefined;
  const patterns: readonly [string, ExtrudeCutDiagnostic["category"], string, string][] = [
    ["missing_cut_target_producer", "not_found", "missing_cut_target_producer", "Restore the target producer or select a current target body."],
    ["missing_cut_target", "not_found", "missing_cut_target", "Select one current target body."],
    ["suppressed_cut_target", "reference", "suppressed_cut_target", "Resume the target producer or select another current target."],
    ["stale_cut_target", "reference", "stale_cut_target", "Recompute the target, then preview Cut again."],
    ["wrong_component_cut_target", "ownership", "wrong_component_cut_target", "Select a target in the profile component."],
    ["wrong_owner_cut_target", "ownership", "wrong_owner_cut_target", "Select the body that owns the planar support face."],
    ["no_intersection", "boolean", "no_intersection", "Change the direction, distance, profile, or target so the Cut intersects material."],
    ["remove_all_material", "boolean", "remove_all_material", "Reduce the profile or distance so target material remains."],
    ["nonmanifold_result", "boolean", "nonmanifold_result", "Adjust the profile or distance to produce one manifold target body."],
    ["explicit_target_required", "target", "explicit_target_required", "Select exactly one current target body."],
  ];
  const matched = patterns.find(([token]) => message.includes(token));
  const code = typeof nested?.code === "string" ? nested.code : matched?.[2] ?? "extrude_cut_refused";
  const category = explicitCategory ?? matched?.[1] ?? "invalid_geometry";
  const field = typeof nested?.field_path === "string" ? nested.field_path : typeof nested?.field === "string" ? nested.field : "participant_bodies.target";
  const recovery = typeof nested?.recovery === "string" ? nested.recovery : matched?.[3] ?? "Correct the Cut inputs and preview again.";
  const explicitReferences = Array.isArray(nested?.referenced_entity_ids)
    ? nested.referenced_entity_ids.filter((value): value is string => typeof value === "string") : [];
  return { code, category, field, message, recovery, referencedEntityIds: explicitReferences.length ? explicitReferences : targetBodyId ? [targetBodyId] : [] };
}
