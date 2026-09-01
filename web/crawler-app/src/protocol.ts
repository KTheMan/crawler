export type TopologyKind = "body" | "face" | "edge" | "vertex";
export type ExportFormat = "step" | "stl" | "obj";

export type AdvancedFeatureOperationId =
  | "crawler.part.revolve"
  | "crawler.part.loft"
  | "crawler.part.sweep"
  | "crawler.part.extrude.cut"
  | "crawler.part.revolve.cut"
  | "crawler.part.draft"
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

import type { Sketch, SketchPreview, SolveResult } from "./sketch-editor";
import type { GeometryEvidence, StepImportMeasurements } from "./step-import-controller";
import type { ExtrudeDirection } from "./extrude-direction";

/**
 * Schema-catalog values are sent without unit conversion. Lengths are exact
 * nanometers and angles are exact microdegrees.
 */
export interface AdvancedFeatureCommand {
  type: "execute-advanced-feature" | "edit-advanced-feature" | "preview-advanced-feature" | "preview-advanced-feature-edit";
  operationId: AdvancedFeatureOperationId;
  displayName?: string;
  featureId?: string;
  outputBodyId?: string;
  previewRequestId?: number;
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
    profileSources?: readonly {
      sketch: Sketch;
      support: import("./sketch-editor").SketchSupport;
      featureId: string;
      profileGeometryIds?: readonly string[];
    }[];
    pathSource?: {
      sketch: Sketch;
      support: import("./sketch-editor").SketchSupport;
      featureId: string;
    };
    axisOriginNanometers?: readonly [number, number, number];
    axisDirectionNanometers?: readonly [number, number, number];
    neutralPlaneOriginNanometers?: readonly [number, number, number];
    draftFaceStableIds?: readonly string[];
  };
}

export interface AdvancedFeatureError {
  code?: string;
  category: "invalid_input" | "reference" | "stale_reference" | "invalid_geometry" | "numerical" | "empty_result" | "unsupported" | "not_found" | "target" | "ownership" | "boolean";
  message: string;
  field?: string;
  recovery: string;
  preserved_inputs?: readonly unknown[];
  problematic_reference?: unknown;
  referenced_entity_ids?: readonly string[];
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
  schema_version: 1;
  id: string;
  component: string;
  body: string;
  producer: string;
  kind: "vertex" | "edge" | "face" | "shell" | "solid";
  /** Decimal u64 transported losslessly through JSON. */
  stable_kernel_id: string;
  stable_token: string;
  fallback_signature: Record<string, unknown>;
}

/** A read-only request for a kernel-authored frame for one retained planar face. */
export interface PlanarFaceFrameRequest {
  type: "resolve-planar-face-frame";
  requestId: string;
  topologyReferenceId: string;
  bodyId: string;
  faceStableId: string;
  expectedAcceptedRevision: number;
  expectedProducerFeatureId: string;
  expectedComponentId: string;
}

export interface PlanarFaceFrameAuthority {
  acceptedRevision: number;
  bodyId: string;
  componentId: string;
  producerFeatureId: string;
  faceStableId: string;
  originVertexStableId: string;
  frameConvention: string;
  handedness: "right";
  scaleMillionths: 1_000_000;
  orthonormalToleranceMillionths: number;
  frame: {
    originNanometers: readonly [number, number, number];
    xAxisMillionths: readonly [number, number, number];
    yAxisMillionths: readonly [number, number, number];
    normalMillionths: readonly [number, number, number];
  };
}

export interface PlanarFaceFrameDiagnostic {
  code: string;
  category: "not_found" | "stale_reference" | "unsupported" | "invalid_input" | "invalid_geometry";
  field: string;
  message: string;
  reference: { bodyId: string; faceStableId: string };
  referencedBodyIds: readonly string[];
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
  | { type: "extrude-preview"; requestId: number; distanceNanometers: number; direction: ExtrudeDirection; resultMode?: "new_body" | "cut"; targetBodyId?: string; semanticHash: string; baseRevision: number; bodyId: string; packet: RenderPacket; removalPacket?: RenderPacket; transferredBytes: number }
  | { type: "offset-construction-plane-preview"; requestId: number; semanticHash: string; plane: OffsetConstructionPlaneDefinition; frame: OffsetConstructionPlaneFrame | null }
  | { type: "offset-construction-plane-completed"; requestId: number; semanticHash: string; plane: OffsetConstructionPlaneDefinition; frame: OffsetConstructionPlaneFrame | null; transaction: AcceptedTransaction }
  | { type: "planar-face-frame"; requestId: string; topologyReferenceId: string; semanticHash: string; authority: PlanarFaceFrameAuthority }
  | { type: "planar-face-frame-error"; requestId: string; topologyReferenceId: string; semanticHash: string; diagnostic: PlanarFaceFrameDiagnostic }
  | { type: "document"; documentJson: string; semanticHash: string; dimensionsJson: string; parameters: readonly NamedParameterView[]; transaction?: AcceptedTransaction; recompute?: RecomputeReport; historyAction?: "undo" | "redo" | "hydrate" | "new" | "open" }
  | { type: "export"; format: ExportFormat; content: string; semanticHash: string }
  | { type: "export-error"; format: ExportFormat; message: string }
  | { type: "portable-package"; bytes: Uint8Array; semanticHash: string }
  | { type: "imported-step-source"; sourceSha256: string; bytes: Uint8Array }
  | { type: "step-import-progress"; requestId: string; phase: string; percent: number }
  | { type: "step-import-cancelled"; requestId: string; cancellationMode: "worker_restart"; sourceRetained: boolean }
  | { type: "step-imported"; bodyId: string; provenance: { source_sha256: string; source_bytes: number; shell_count: number; face_count: number; triangle_count: number }; kernelTimeMs: number; measurements: StepImportMeasurements; evidence: GeometryEvidence }
  | { type: "advanced-feature-completed"; operationId: AdvancedFeatureOperationId; featureId: string; bodyId: string; semanticHash: string }
  | { type: "advanced-feature-preview"; requestId: number; operationId: AdvancedFeatureOperationId; featureId: string; bodyId: string; semanticHash: string; packet: RenderPacket; transferredBytes: number }
  | { type: "advanced-feature-preview-cancelled"; semanticHash: string }
  | { type: "timeline-rollback"; rollback: { kind: "before_first" | "after" | "end"; feature?: string } }
  | { type: "feature-services"; selected: string; services: FeatureServicesView; repair: RepairInspectionView; observedTopology: readonly TopologyReferenceView[] }
  | { type: "recompute-from-here"; accepted: boolean; plan: { requested_from: string; required_inputs: readonly string[]; evaluation_order: readonly string[] }; recomputed?: readonly { feature: string; body: string }[]; transaction?: AcceptedTransaction; diagnostics?: FeatureServicesView["diagnostics"]; error?: AdvancedFeatureError; semanticHash: string }
  | { type: "repair-committed"; selected: string; transaction: AcceptedTransaction; semanticHash: string }
  | { type: "topology-rebind-preview"; requestId: string; selected: string; baseDocumentHash: string; baseRevision: number; candidateFrame: OffsetConstructionPlaneFrame; semanticHash: string; bodyId: string; packet: RenderPacket; transferredBytes: number }
  | { type: "topology-rebind-preview-cancelled"; requestId: string; semanticHash: string }
  | { type: "parameter-error"; diagnostic: ParameterDiagnostic; semanticHash: string }
  | { type: "parameter-action-completed"; label: string; semanticHash: string }
  | { type: "sketch-command-preview"; requestId: string; preview: SketchPreview; performance?: { runtimeMs: number; responseParseMs: number; wasmBoundaryAndSerializeMs?: number; enginePhases?: NonNullable<SketchPreview["runtime_performance"]> } }
  | { type: "sketch-error"; requestId: string; message: string }
  | { type: "sketch-drag-preview"; requestId: string; preview: { drag: { accepted: boolean; sketch: import("./sketch-editor").Sketch; resolved: import("./sketch-editor").Point2; solve: SolveResult }; profile: import("./sketch-editor").ProfileReport } }
  | { type: "sketch-commit"; requestId: string; accepted: boolean; solve: SolveResult; semanticHash: string }
  | { type: "sketch-contract"; requestId: string; contract: import("./sketch-editor").SketchSolverContract }
  | { type: "sketch-decomposition"; requestId: string; decomposition: import("./sketch-editor").SketchDecomposition }
  | { type: "sketch-dxf-export"; requestId: string; dxf: string }
  | { type: "sketch-dxf-import"; requestId: string; sketch: import("./sketch-editor").Sketch; decomposition: import("./sketch-editor").SketchDecomposition }
  | { type: "operation-error"; code: string; message: string; recovery?: string; category?: AdvancedFeatureError["category"]; field?: string; referencedEntityIds?: readonly string[]; operationId?: AdvancedFeatureOperationId; featureId?: string; requestId?: number | string; semanticHash?: string }
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

export interface OffsetConstructionPlaneRequest {
  plane_id: string;
  component_id: string;
  base_plane_id: `origin-plane:${"xy" | "xz" | "yz"}`;
  offset_parameter_id: string;
  offset_nanometers: number;
  suppressed: boolean;
  transaction_id: string;
  base_revision: number;
}

export interface OffsetConstructionPlaneDefinition {
  schema_version: 1;
  id: string;
  component: string;
  definition: { kind: "offset"; base_plane: string; offset: string };
  suppressed: boolean;
}

export interface OffsetConstructionPlaneFrame {
  origin_nanometers: readonly [number, number, number];
  x_axis_millionths: readonly [number, number, number];
  y_axis_millionths: readonly [number, number, number];
  normal_millionths: readonly [number, number, number];
}

export interface Selection {
  kind: TopologyKind;
  stableId: string;
  token: number;
  bodyId: string;
}
