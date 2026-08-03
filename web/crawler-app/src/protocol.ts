export type TopologyKind = "body" | "face" | "edge" | "vertex";
export type ExportFormat = "step" | "stl" | "obj";

export type AdvancedFeatureOperationId =
  | "crawler.part.revolve"
  | "crawler.part.boolean.union"
  | "crawler.part.boolean.cut"
  | "crawler.part.boolean.intersect"
  | "crawler.part.fillet"
  | "crawler.part.chamfer"
  | "crawler.part.mirror"
  | "crawler.part.transform"
  | "crawler.part.pattern.linear"
  | "crawler.part.pattern.circular"
  | "crawler.part.shell";

export type PrincipalAxis = "x" | "y" | "z";

import type { SketchPreview, SolveResult } from "./sketch-editor";
import type { GeometryEvidence, StepImportMeasurements } from "./step-import-controller";

/**
 * Schema-catalog values are sent without unit conversion. Lengths are exact
 * nanometers and angles are exact microdegrees.
 */
export interface AdvancedFeatureCommand {
  type: "execute-advanced-feature" | "edit-advanced-feature";
  operationId: AdvancedFeatureOperationId;
  displayName?: string;
  featureId?: string;
  outputBodyId?: string;
  parameters?: Readonly<Record<string, number | boolean | string>>;
  selection?: {
    sourceBodyId?: string;
    targetBodyId?: string;
    toolBodyIds?: readonly string[];
    edgeStableIds?: readonly string[];
    removedFaceStableIds?: readonly string[];
    orderedFeatureIds?: readonly string[];
    axis?: PrincipalAxis;
    originNanometers?: readonly [number, number, number];
    directionSign?: 1 | -1;
  };
}

export interface AdvancedFeatureError {
  category: "invalid_input" | "numerical" | "empty_result" | "unsupported" | "not_found";
  message: string;
  field?: string;
  recovery: string;
  preserved_inputs?: readonly unknown[];
  problematic_reference?: unknown;
}

export interface RenderPacket {
  version: number;
  positions: Float32Array;
  normals: Float32Array;
  triangleIndices: Uint32Array;
  faceRanges: Uint32Array;
  edgePositions: Float32Array;
  edgeRanges: Uint32Array;
  vertexPositions: Float32Array;
  vertexPickTokens: Uint32Array;
  pickTable: Uint32Array;
  bounds: Float64Array;
}

export type ParameterKind = "length" | "angle" | "count" | "scalar" | "tolerance" | "boolean" | "text";

export interface ExactParameterValue {
  kind: "length_nanometers" | "angle_microdegrees" | "count" | "scalar_millionths" | "tolerance_nanometers" | "boolean" | "text";
  value: number | boolean | string;
}

export interface NamedParameterView {
  id: string;
  name: string;
  kind: ParameterKind;
  source: string;
  display_expression: string;
  evaluated_value: ExactParameterValue;
}

export interface TopologyReferenceView {
  id: string;
  body: string;
  producer: string;
  kind: "vertex" | "edge" | "face" | "shell" | "solid";
  stable_kernel_id: number;
  stable_token: string;
  fallback_signature: Record<string, unknown>;
}

export interface FeatureServicesView {
  timeline: readonly { feature: string; operation_type: string; display_name: string; state: string; diagnostic_code?: string; after_rollback: boolean; group?: string }[];
  relationships: { selected: string; direct_inputs: readonly string[]; direct_consumers: readonly string[] };
  diagnostics: { total_elapsed_microseconds: number; features: readonly { feature: string; elapsed_microseconds: number; evaluation_sequence: number; cost_share_ppm: number; cost_cue: "within_frame" | "interactive" | "expensive" }[] };
}

export type RepairInspectionView =
  | { status: "ready"; document_hash: string; revision: number }
  | { status: "evaluation_blocked"; preview: { base_document_hash: string; base_revision: number; explicit_rebind_required: true; unresolved: { feature: string; input_name: string; reference: string; cause: string }; candidates: readonly { rank: number; candidate: TopologyReferenceView; score: { position_delta: number; normal_delta: number; measure_delta: number } }[]; selection: Record<string, unknown>; downstream_stop: { stopped_at: string; blocked_features: readonly string[] } } };

export interface ParameterDiagnostic {
  code: "empty_expression" | "unexpected_token" | "missing_closing_parenthesis" | "unknown_name" | "ambiguous_name" | "invalid_quantity" | "kind_mismatch" | "incompatible_operands" | "expected_scalar" | "division_by_zero" | "inexact_or_overflow" | "cycle" | "evaluation";
  field: string;
  span?: { start: number; end: number };
  message: string;
  candidates?: readonly string[];
  cycle?: readonly string[];
}

export type WorkerResponse =
  | { type: "wasm-ready"; detail: string }
  | { type: "packet"; bodyId: string; packet: RenderPacket; transferredBytes: number; semanticHash: string }
  | { type: "extrude-preview"; requestId: number; distanceNanometers: number; semanticHash: string; bodyId: string; packet: RenderPacket; transferredBytes: number }
  | { type: "document"; documentJson: string; semanticHash: string; dimensionsJson: string; parameters: readonly NamedParameterView[]; transaction?: AcceptedTransaction; recompute?: RecomputeReport; historyAction?: "undo" | "redo" | "hydrate" | "new" | "open" }
  | { type: "export"; format: ExportFormat; content: string; semanticHash: string }
  | { type: "portable-package"; bytes: Uint8Array; semanticHash: string }
  | { type: "imported-step-source"; sourceSha256: string; bytes: Uint8Array }
  | { type: "step-import-progress"; requestId: string; phase: string; percent: number }
  | { type: "step-import-cancelled"; requestId: string; cancellationMode: "worker_restart"; sourceRetained: boolean }
  | { type: "step-imported"; bodyId: string; provenance: { source_sha256: string; source_bytes: number; shell_count: number; face_count: number; triangle_count: number }; kernelTimeMs: number; measurements: StepImportMeasurements; evidence: GeometryEvidence }
  | { type: "advanced-feature-completed"; operationId: AdvancedFeatureOperationId; featureId: string; bodyId: string; semanticHash: string }
  | { type: "timeline-rollback"; rollback: { kind: "before_first" | "after" | "end"; feature?: string } }
  | { type: "feature-services"; selected: string; services: FeatureServicesView; repair: RepairInspectionView; observedTopology: readonly TopologyReferenceView[] }
  | { type: "recompute-from-here"; accepted: boolean; plan: { requested_from: string; required_inputs: readonly string[]; evaluation_order: readonly string[] }; diagnostics?: FeatureServicesView["diagnostics"]; error?: AdvancedFeatureError; semanticHash: string }
  | { type: "repair-committed"; selected: string; transaction: AcceptedTransaction; semanticHash: string }
  | { type: "parameter-error"; diagnostic: ParameterDiagnostic; semanticHash: string }
  | { type: "parameter-action-completed"; label: string; semanticHash: string }
  | { type: "sketch-command-preview"; requestId: string; preview: SketchPreview }
  | { type: "sketch-drag-preview"; requestId: string; preview: { drag: { accepted: boolean; sketch: import("./sketch-editor").Sketch; resolved: import("./sketch-editor").Point2; solve: SolveResult }; profile: import("./sketch-editor").ProfileReport } }
  | { type: "sketch-commit"; requestId: string; accepted: boolean; solve: SolveResult; semanticHash: string }
  | { type: "operation-error"; code: string; message: string; recovery?: string; category?: AdvancedFeatureError["category"]; field?: string; operationId?: AdvancedFeatureOperationId; featureId?: string; semanticHash?: string }
  | { type: "error"; message: string };

export interface RecomputeReport {
  dirtyRoots: readonly string[];
  evaluationOrder: readonly string[];
}

export interface AcceptedTransaction {
  id: string;
  base_revision: number;
  result_revision: number;
  changes: readonly Record<string, unknown>[];
}

export interface Selection {
  kind: TopologyKind;
  stableId: string;
  token: number;
  bodyId: string;
}
