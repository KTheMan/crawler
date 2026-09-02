/// <reference lib="webworker" />

import type { AcceptedTransaction, AdvancedFeatureCommand, AdvancedFeatureError, FeatureServicesView, NamedParameterView, OffsetConstructionPlaneDefinition, OffsetConstructionPlaneFrame, OffsetConstructionPlaneRequest, ParameterDiagnostic, PlanarFaceFrameDiagnostic, PlanarFaceFrameRequest, RecomputeReport, RenderPacket, RepairInspectionView, TopologyReferenceView, WorkerResponse } from "./protocol";
import { AdvancedFeatureBuildError, buildAdvancedFeatureEditEnvelope, buildAdvancedFeatureEnvelope, serializeAdvancedFeatureEnvelope } from "./advanced-feature-builder";
import initRuntime, { WasmPartRuntime } from "./generated/runtime/crawler_part_runtime.js";
import type { Sketch, SketchCommand, SketchSupport } from "./sketch-editor";
import type { ExtrudeDirection } from "./extrude-direction";
import { normalizeExtrudeCutFailure } from "./extrude-result-mode";
import { StepImportController, type StepImportMeasurements, type StepImportPayload as ControllerStepImportPayload } from "./step-import-controller";
import { resolveSketchReferences, type ParameterReferenceDocument } from "./parameter-references";
import { constructionPlaneRecomputeReport, constructionPlaneRuntimeErrorMapping, constructionPlaneSupportRuntimeErrorMapping } from "./offset-construction-plane";
import { bodyAcceptsFeatureProducer, normalizePlanarFaceFrameResult } from "./planar-face-authority";

const scope = self as DedicatedWorkerGlobalScope;
let runtime: WasmPartRuntime | undefined;
let importedPacket: { bodyId: string; packet: RenderPacket } | undefined;
let stepImportController: StepImportController | undefined;
let retainedStepDisplayName = "Imported STEP";

interface RuntimePacketJson {
  body_id: string | null;
  packet: {
    version: number;
    positions: number[];
    normals: number[];
    triangleIndices: number[];
    faceRanges: number[];
    edgePositions: number[];
    edgeRanges: number[];
    vertexPositions: number[];
    vertexPickTokens: number[];
    pickTable: number[];
    bounds: number[];
  };
}

interface KernelPacketJson {
  version: number;
  positions: number[];
  normals: number[];
  triangle_indices: number[];
  face_ranges: { first_index: number; index_count: number; pick_token: number }[];
  edge_positions: number[];
  edge_ranges: { first_vertex: number; vertex_count: number; pick_token: number }[];
  vertex_positions: number[];
  vertex_pick_tokens: number[];
  pick_table: { token: number; kind: "Face" | "Edge" | "Vertex"; stable_id: number | string }[];
  bounds: { min: number[]; max: number[] };
}

interface StepImportPayload {
  kind: "step_import";
  import_id: string;
  provenance: { source_sha256: string; source_bytes: number; shell_count: number; face_count: number; triangle_count: number };
  body: { body_id: string; solid_json: number[]; evidence: unknown };
  render_packet: KernelPacketJson;
  transferred_bytes: number;
  kernel_time_ms: number;
}

function resetStepImportController(): void {
  stepImportController?.cancel();
  stepImportController = undefined;
}

function importController(): StepImportController {
  if (!runtime) throw new Error("part runtime is not initialized");
  if (stepImportController) return stepImportController;
  const document = JSON.parse(runtime.documentJson()) as { id: string; revision: number };
  stepImportController = new StepImportController({
    document_id: document.id,
    document_revision: () => runtime ? (JSON.parse(runtime.documentJson()) as { revision: number }).revision : document.revision,
    on_progress: (progress) => scope.postMessage({ type: "step-import-progress", requestId: progress.request_id, phase: progress.phase, percent: progress.percent } satisfies WorkerResponse),
  });
  return stepImportController;
}

interface AdvancedFeatureOutcome {
  accepted: boolean;
  before_hash?: string;
  document_hash: string;
  result?: {
    output: { body_id: string };
    [key: string]: unknown;
  };
  recomputed?: { feature: string; body: string }[];
  error?: AdvancedFeatureError;
}

interface AdvancedFeaturePreviewOutcome extends AdvancedFeatureOutcome {
  render: RuntimePacketJson;
}

interface PendingAdvancedFeature {
  command: AdvancedFeatureCommand;
  envelopeJson: string;
  editing: boolean;
  acceptedHash: string;
  featureId: string;
  bodyId: string;
}

let pendingAdvancedFeature: PendingAdvancedFeature | undefined;

const sketchPreparedOperationIds = new Set<AdvancedFeatureCommand["operationId"]>([
  "crawler.part.revolve",
  "crawler.part.loft",
  "crawler.part.sweep",
  "crawler.part.extrude.cut",
  "crawler.part.revolve.cut",
]);

function principalAxisVector(axis: "x" | "y" | "z" | undefined): [number, number, number] {
  return axis === "x" ? [1_000_000, 0, 0] : axis === "y" ? [0, 1_000_000, 0] : [0, 0, 1_000_000];
}

function prepareSketchFeatureEnvelope(runtimeView: WasmPartRuntime, command: AdvancedFeatureCommand, nonce: string): string | undefined {
  if (!sketchPreparedOperationIds.has(command.operationId) || command.type === "edit-advanced-feature") return undefined;
  const selection = command.selection ?? {};
  const parameters = command.parameters ?? {};
  const rawDirection = selection.axisDirectionNanometers ?? principalAxisVector(selection.axis);
  const axisDirection = rawDirection.map((value) => Math.round(value)) as [number, number, number];
  const operationId = command.operationId === "crawler.part.revolve" ? "profile_revolve" : command.operationId.replace("crawler.part.", "").replaceAll(".", "_");
  return runtimeView.prepareSketchFeatureEnvelopeJson(JSON.stringify({
    transaction_id: `transaction:${nonce}:${operationId}`,
    feature_id: command.featureId,
    body_id: command.outputBodyId,
    operation_id: operationId,
    profile_sources: (selection.profileSources ?? []).map(({ sketch, support, profileGeometryIds }) => ({ sketch, support, ...(profileGeometryIds ? { profile_geometry_ids: profileGeometryIds } : {}) })),
    tolerance_nanometers: Number(parameters.tolerance ?? 10_000),
    ...(selection.pathSource ? { path_source: { sketch: selection.pathSource.sketch, support: selection.pathSource.support } } : {}),
    ...(selection.targetBodyId ? { target_body_id: selection.targetBodyId } : {}),
    axis_origin_nanometers: selection.axisOriginNanometers ?? selection.originNanometers ?? [0, 0, 0],
    axis_direction_nanometers: axisDirection,
    reverse: parameters.reverse === true,
    ...(parameters.distance !== undefined ? { distance_nanometers: Number(parameters.distance) } : {}),
    ...((parameters.angle !== undefined || command.operationId.includes("revolve")) ? { sweep_microdegrees: Math.abs(Number(parameters.angle ?? 360_000_000)) } : {}),
    divisions: Number(parameters.divisions ?? 32),
  }));
}

interface ParameterOutcome {
  accepted: boolean;
  document_hash: string;
  diagnostic?: ParameterDiagnostic;
}

interface RuntimeDocumentJournal {
  revision: number;
  transactions: AcceptedTransaction[];
  bodies?: Record<string, { id?: string; component?: string; generated_by?: string; producer_lineage?: readonly string[]; suppressed?: boolean }>;
  features?: Record<string, { id?: string; component?: string; suppressed?: boolean }>;
  topology_references?: Record<string, TopologyReferenceView>;
}

type ConstructionPlaneRuntime = WasmPartRuntime & {
  previewOffsetConstructionPlaneJson(requestJson: string): string;
  commitOffsetConstructionPlaneJson(requestJson: string): string;
};

type TopologyRebindRuntime = WasmPartRuntime & {
  previewTopologyRebindJson(requestJson: string): string;
};

interface PendingTopologyRebind {
  requestId: string;
  selected: string;
  observedTopology: readonly TopologyReferenceView[];
  baseDocumentHash: string;
  baseRevision: number;
}

let pendingTopologyRebind: PendingTopologyRebind | undefined;

class PlanarFaceAuthorityError extends Error {
  constructor(readonly diagnostic: PlanarFaceFrameDiagnostic) { super(diagnostic.message); }
}

function planarFaceFrameRequest(
  support: SketchSupport,
  supportReference?: TopologyReferenceView,
): PlanarFaceFrameRequest | undefined {
  if (!runtime || support.kind !== "topology") return undefined;
  const document = JSON.parse(runtime.documentJson()) as RuntimeDocumentJournal;
  const retained = supportReference ?? document.topology_references?.[support.reference];
  const body = retained?.body ? document.bodies?.[retained.body] : undefined;
  const producer = retained?.producer ? document.features?.[retained.producer] : undefined;
  const component = body?.component;
  const stableId = retained?.stable_kernel_id;
  if (!retained || retained.kind !== "face" || !retained.body || !retained.producer || !stableId
    || !/^(0|[1-9][0-9]*)$/.test(stableId) || !body || body.suppressed
    || !bodyAcceptsFeatureProducer(body, retained.producer)
    || !producer || producer.suppressed || !component || producer.component !== component) {
    throw new PlanarFaceAuthorityError({
      code: "stale_planar_face_reference", category: "stale_reference", field: "planar_face.reference",
      message: "The planar face reference does not match a current body, producer, and component",
      reference: { bodyId: retained?.body ?? "", faceStableId: stableId ?? "" },
      referencedBodyIds: retained?.body ? [retained.body] : [],
    });
  }
  return {
    type: "resolve-planar-face-frame", requestId: `preflight:${support.reference}`,
    topologyReferenceId: support.reference, bodyId: retained.body, faceStableId: stableId,
    expectedAcceptedRevision: document.revision, expectedProducerFeatureId: retained.producer,
    expectedComponentId: component,
  };
}

function requirePlanarFaceAuthority(support: SketchSupport, supportReference?: TopologyReferenceView): void {
  if (!runtime) throw new Error("part runtime is not initialized");
  const request = planarFaceFrameRequest(support, supportReference);
  if (!request) return;
  const beforeHash = runtime.semanticHash();
  let raw: unknown;
  try { raw = JSON.parse(runtime.planarFaceFrameJson(request.bodyId, request.faceStableId)); }
  catch (error) {
    if (runtime.semanticHash() !== beforeHash) throw new Error("Planar face frame query mutated the accepted document");
    throw error;
  }
  if (runtime.semanticHash() !== beforeHash) throw new Error("Planar face frame query mutated the accepted document");
  const normalized = normalizePlanarFaceFrameResult(raw, request);
  if (!normalized.ok) throw new PlanarFaceAuthorityError(normalized.diagnostic);
}

function postDocument(options: { transaction?: AcceptedTransaction; recompute?: RecomputeReport; historyAction?: "undo" | "redo" | "hydrate" | "new" | "open" } = {}): void {
  if (!runtime) throw new Error("part runtime is not initialized");
  const parameters = (JSON.parse(runtime.parametersJson()) as { parameters: NamedParameterView[] }).parameters;
  scope.postMessage({ type: "document", documentJson: runtime.documentJson(), semanticHash: runtime.semanticHash(), dimensionsJson: runtime.dimensionsJson(), parameters, ...options } satisfies WorkerResponse);
}

function acceptedTransactionAfter(baseRevision: number): AcceptedTransaction | undefined {
  if (!runtime) throw new Error("part runtime is not initialized");
  const document = JSON.parse(runtime.documentJson()) as RuntimeDocumentJournal;
  return document.revision > baseRevision ? document.transactions.at(-1) : undefined;
}

function postParameterRefusal(outcome: ParameterOutcome, beforeHash: string): void {
  if (!runtime) throw new Error("part runtime is not initialized");
  if (runtime.semanticHash() !== beforeHash || outcome.document_hash !== beforeHash) throw new Error("refused parameter edit mutated the accepted document");
  scope.postMessage({
    type: "parameter-error",
    diagnostic: outcome.diagnostic ?? { code: "evaluation", field: "parameter", message: "parameter edit was refused" },
    semanticHash: beforeHash,
  } satisfies WorkerResponse);
}

function acceptedPacket(): { bodyId: string; packet: RenderPacket } {
  if (!runtime) throw new Error("part runtime is not initialized");
  const source = JSON.parse(runtime.renderPacketJson(0.01)) as RuntimePacketJson;
  return runtimePacket(source);
}

function runtimePacket(source: RuntimePacketJson): { bodyId: string; packet: RenderPacket } {
  const packet = source.packet;
  return { bodyId: source.body_id ?? "", packet: {
    version: packet.version,
    positions: new Float32Array(packet.positions),
    normals: new Float32Array(packet.normals),
    triangleIndices: new Uint32Array(packet.triangleIndices),
    faceRanges: new Uint32Array(packet.faceRanges),
    edgePositions: new Float32Array(packet.edgePositions),
    edgeRanges: new Uint32Array(packet.edgeRanges),
    vertexPositions: new Float32Array(packet.vertexPositions),
    vertexPickTokens: new Uint32Array(packet.vertexPickTokens),
    pickTable: new Uint32Array(packet.pickTable),
    bounds: new Float64Array(packet.bounds),
  } };
}

function kernelPacket(source: KernelPacketJson): RenderPacket {
  const kindCode = { Face: 1, Edge: 2, Vertex: 3 } as const;
  const pickTable = source.pick_table.flatMap((record) => {
    const stableId = BigInt(record.stable_id);
    return [record.token, kindCode[record.kind], Number(stableId & 0xffff_ffffn), Number(stableId >> 32n)];
  });
  return {
    version: source.version,
    positions: new Float32Array(source.positions),
    normals: new Float32Array(source.normals),
    triangleIndices: new Uint32Array(source.triangle_indices),
    faceRanges: new Uint32Array(source.face_ranges.flatMap((range) => [range.first_index, range.index_count, range.pick_token])),
    edgePositions: new Float32Array(source.edge_positions),
    edgeRanges: new Uint32Array(source.edge_ranges.flatMap((range) => [range.first_vertex, range.vertex_count, range.pick_token])),
    vertexPositions: new Float32Array(source.vertex_positions),
    vertexPickTokens: new Uint32Array(source.vertex_pick_tokens),
    pickTable: new Uint32Array(pickTable),
    bounds: new Float64Array([...source.bounds.min, ...source.bounds.max]),
  };
}

function restoreImportedPacket(): void {
  importedPacket = undefined;
  if (!runtime) return;
  const document = JSON.parse(runtime.documentJson()) as { features?: Record<string, { suppressed?: boolean }>; transactions?: { changes?: { kind?: string; feature?: string; result_json?: string }[] }[] };
  const results = (document.transactions ?? []).flatMap((transaction) => transaction.changes ?? []).filter((change) => change.kind === "accept_feature_result" && change.result_json && change.feature && document.features?.[change.feature] && !document.features[change.feature].suppressed);
  const stored = results.at(-1);
  if (!stored?.result_json) return;
  try {
    const result = JSON.parse(stored.result_json) as StepImportPayload;
    if (result.kind === "step_import") importedPacket = { bodyId: result.body.body_id, packet: kernelPacket(result.render_packet) };
  } catch { /* A non-import feature result is not an imported view. */ }
}

function referencedStepSourceHashes(): string[] {
  if (!runtime) return [];
  const document = JSON.parse(runtime.documentJson()) as { transactions?: { changes?: { result_json?: unknown }[] }[] };
  const hashes = new Set<string>();
  for (const change of (document.transactions ?? []).flatMap((transaction) => transaction.changes ?? [])) {
    if (typeof change.result_json !== "string") continue;
    try {
      const result = JSON.parse(change.result_json) as { kind?: string; provenance?: { source_sha256?: string } };
      const sourceSha256 = result.kind === "step_import" ? result.provenance?.source_sha256 : undefined;
      if (sourceSha256 && /^[0-9a-f]{64}$/.test(sourceSha256)) hashes.add(sourceSha256);
    } catch { /* Ignore non-STEP accepted feature results. */ }
  }
  return [...hashes].sort();
}

function postImportedStepSources(): void {
  if (!runtime) return;
  for (const sourceSha256 of referencedStepSourceHashes()) {
    const bytes = runtime.importedStepSource(sourceSha256);
    scope.postMessage({ type: "imported-step-source", sourceSha256, bytes } satisfies WorkerResponse, [bytes.buffer]);
  }
}

function postPacket(): void {
  const source = importedPacket ?? acceptedPacket();
  const packet = source.packet;
  const transfer = Object.values(packet).filter((value): value is ArrayBufferView => ArrayBuffer.isView(value)).map((value) => value.buffer);
  const transferredBytes = transfer.reduce((total, buffer) => total + buffer.byteLength, 0);
  scope.postMessage({ type: "packet", bodyId: source.bodyId, packet, transferredBytes, semanticHash: runtime!.semanticHash() } satisfies WorkerResponse, transfer);
}

interface SketchExtrudeSource {
  sketch: Sketch;
  support: SketchSupport;
  profileGeometryIds?: readonly string[];
  featureId: string;
  bodyId: string;
  newBodyId: string;
  resultMode: "new_body" | "cut";
  targetBodyId?: string;
  transactionId?: string;
}

function postExtrudePreview(requestId: number, distanceNanometers: number, direction: ExtrudeDirection, source?: SketchExtrudeSource): void {
  if (!runtime) throw new Error("part runtime is not initialized");
  const acceptedHash = runtime.semanticHash();
  const baseRevision = (JSON.parse(runtime.documentJson()) as RuntimeDocumentJournal).revision;
  if (source) {
    requirePlanarFaceAuthority(source.support);
    const commonRequest = {
      sketch: source.sketch,
      support: source.support,
      distance_nanometers: distanceNanometers,
      direction,
      tolerance: 0.01,
      ...(source.profileGeometryIds ? { profile_geometry_ids: source.profileGeometryIds } : {}),
    };
    const preview = JSON.parse(runtime.previewSketchExtrudeJson(JSON.stringify({
      ...commonRequest,
      feature_id: source.featureId,
      body_id: source.bodyId,
      result_mode: source.resultMode,
      ...(source.targetBodyId ? { target_body_id: source.targetBodyId } : {}),
    }))) as {
      accepted?: boolean;
      accepted_document_hash: string;
      document_hash?: string;
      distance_nanometers: number;
      render?: RuntimePacketJson;
      error?: unknown;
    };
    if (preview.accepted === false) {
      if (runtime.semanticHash() !== acceptedHash || preview.document_hash !== acceptedHash) {
        throw new Error("refused Sketch Extrude preview mutated the accepted document");
      }
      throw preview;
    }
    if (runtime.semanticHash() !== acceptedHash || preview.accepted_document_hash !== acceptedHash) {
      throw new Error("Sketch Extrude preview mutated the accepted document");
    }
    if (!preview.render) throw new Error("accepted Sketch Extrude preview omitted its render packet");
    const rendered = runtimePacket(preview.render);
    const packet = rendered.packet;
    let removalPacket: RenderPacket | undefined;
    if (source.resultMode === "cut") {
      const removal = JSON.parse(runtime.previewSketchExtrudeJson(JSON.stringify({
        ...commonRequest,
        feature_id: `feature:cut-removal-preview:${requestId}`,
        body_id: `body:cut-removal-preview:${requestId}`,
        result_mode: "new_body",
      }))) as { accepted?: boolean; accepted_document_hash: string; render?: RuntimePacketJson };
      if (removal.accepted === false || !removal.render || removal.accepted_document_hash !== acceptedHash || runtime.semanticHash() !== acceptedHash) {
        throw new Error("Cut removal-volume preview was refused or mutated the accepted document");
      }
      removalPacket = runtimePacket(removal.render).packet;
    }
    const transfer = [packet, ...(removalPacket ? [removalPacket] : [])]
      .flatMap((candidate) => Object.values(candidate).filter((value): value is ArrayBufferView => ArrayBuffer.isView(value)).map((value) => value.buffer));
    scope.postMessage({
      type: "extrude-preview",
      requestId,
      distanceNanometers: preview.distance_nanometers,
      direction,
      semanticHash: acceptedHash,
      baseRevision,
      bodyId: rendered.bodyId,
      resultMode: source.resultMode,
      ...(source.targetBodyId ? { targetBodyId: source.targetBodyId } : {}),
      packet,
      ...(removalPacket ? { removalPacket } : {}),
      transferredBytes: transfer.reduce((total, buffer) => total + buffer.byteLength, 0),
    } satisfies WorkerResponse, transfer);
    return;
  }
  if (direction !== "positive") throw new Error("Reverse and symmetric modes require a sketch-profile Extrude");
  const acceptedDimensions = JSON.parse(runtime.dimensionsJson()) as { distance_nanometers: number };
  if (distanceNanometers === acceptedDimensions.distance_nanometers) {
    const source = acceptedPacket();
    const packet = source.packet;
    const transfer = Object.values(packet).filter((value): value is ArrayBufferView => ArrayBuffer.isView(value)).map((value) => value.buffer);
    const transferredBytes = transfer.reduce((total, buffer) => total + buffer.byteLength, 0);
    scope.postMessage({
      type: "extrude-preview",
      requestId,
      distanceNanometers,
      direction,
      semanticHash: acceptedHash,
      baseRevision,
      bodyId: source.bodyId,
      packet,
      transferredBytes,
    } satisfies WorkerResponse, transfer);
    return;
  }
  const preview = JSON.parse(runtime.previewExtrudeJson(BigInt(distanceNanometers), 0.01)) as {
    accepted_document_hash: string;
    distance_nanometers: number;
    render: RuntimePacketJson;
  };
  if (runtime.semanticHash() !== acceptedHash || preview.accepted_document_hash !== acceptedHash) {
    throw new Error("Extrude preview mutated the accepted document");
  }
  const rendered = runtimePacket(preview.render);
  const packet = rendered.packet;
  const transfer = Object.values(packet).filter((value): value is ArrayBufferView => ArrayBuffer.isView(value)).map((value) => value.buffer);
  const transferredBytes = transfer.reduce((total, buffer) => total + buffer.byteLength, 0);
  scope.postMessage({
    type: "extrude-preview",
    requestId,
    distanceNanometers: preview.distance_nanometers,
    direction,
    semanticHash: acceptedHash,
    baseRevision,
    bodyId: rendered.bodyId,
    packet,
    transferredBytes,
  } satisfies WorkerResponse, transfer);
}

function commitStepImport(result: ControllerStepImportPayload, measurements: StepImportMeasurements, displayName: string): void {
  if (!runtime) throw new Error("part runtime is not initialized");
  const storedResult = result as unknown as StepImportPayload;
  const document = JSON.parse(runtime.documentJson()) as { revision: number };
  const featureId = `feature:${result.import_id}`;
  const transactionId = `transaction:${document.revision + 1}:import-step`;
  const requestRecord = { kind: "import_step", import_id: result.import_id, provenance: result.provenance, settings: result.provenance.settings };
  const changes: AcceptedTransaction["changes"] = [
    { kind: "create_feature", feature: { id: featureId, display_name: displayName || "Imported STEP", component: "component:root", operation: { schema_id: "crawler.operation.import_step", schema_version: 1 }, dependencies: [], inputs: {}, parameters: {}, suppressed: false }, before: null },
    { kind: "accept_feature_result", feature: featureId, body: result.body.body_id, request_json: JSON.stringify(requestRecord), result_json: JSON.stringify(result) },
  ];
  const outcome = JSON.parse(runtime.commitChangesJson(JSON.stringify({ transaction_id: transactionId, changes }))) as { revision: number };
  importedPacket = { bodyId: result.body.body_id, packet: kernelPacket(storedResult.render_packet) };
  postDocument({ transaction: { id: transactionId, base_revision: document.revision, result_revision: outcome.revision, changes } });
  postPacket();
  scope.postMessage({
    type: "step-imported",
    bodyId: result.body.body_id,
    provenance: result.provenance,
    kernelTimeMs: result.kernel_time_ms,
    measurements,
    evidence: result.body.evidence,
  } satisfies WorkerResponse);
}

scope.addEventListener("message", async (event) => {
  try {
    if (event.data?.type === "initialize") {
      if (event.data.fail) throw new Error("diagnostic worker startup failure");
      await initRuntime();
      const persistedDocumentId = typeof event.data.initialDocumentId === "string"
        && event.data.initialDocumentId.startsWith("document:")
        && event.data.initialDocumentId.length <= 512
        ? event.data.initialDocumentId
        : undefined;
      runtime = event.data.qualificationReferencePart
        ? WasmPartRuntime.newValidationRectangularPart("document:part-alpha-001", "Bracket", 40_000_000n, 28_000_000n, 12_000_000n)
        : new WasmPartRuntime(persistedDocumentId ?? `document:${crypto.randomUUID()}`, "Untitled Part");
      scope.postMessage({ type: "wasm-ready", detail: "crawler-part-runtime ready" } satisfies WorkerResponse);
      postDocument(); postPacket();
    }
    if (event.data?.type === "resolve-planar-face-frame") {
      if (!runtime) throw new Error("part runtime is not initialized");
      const request = event.data as PlanarFaceFrameRequest;
      const beforeHash = runtime.semanticHash();
      let result;
      try {
        result = normalizePlanarFaceFrameResult(
          JSON.parse(runtime.planarFaceFrameJson(request.bodyId, request.faceStableId)),
          request,
        );
      } catch (error) {
        if (runtime.semanticHash() !== beforeHash) throw new Error("Planar face frame query failure mutated the accepted document");
        result = { ok: false as const, diagnostic: {
          code: "planar_face_frame_query_failed", category: "invalid_geometry" as const,
          field: "planar_face.frame", message: error instanceof Error ? error.message : String(error),
          reference: { bodyId: request.bodyId, faceStableId: request.faceStableId }, referencedBodyIds: [request.bodyId],
        } };
      }
      if (runtime.semanticHash() !== beforeHash) throw new Error("Planar face frame query mutated the accepted document");
      scope.postMessage(result.ok
        ? { type: "planar-face-frame", requestId: request.requestId, topologyReferenceId: request.topologyReferenceId, semanticHash: beforeHash, authority: result.authority }
        : { type: "planar-face-frame-error", requestId: request.requestId, topologyReferenceId: request.topologyReferenceId, semanticHash: beforeHash, diagnostic: result.diagnostic } satisfies WorkerResponse);
      return;
    }
    if (event.data?.type === "hydrate-document") {
      resetStepImportController();
      runtime?.free(); runtime = WasmPartRuntime.fromDocumentJson(event.data.documentJson);
      restoreImportedPacket();
      postDocument({ historyAction: "hydrate" }); postPacket();
    }
    if (event.data?.type === "open-document") {
      resetStepImportController();
      runtime?.free(); runtime = WasmPartRuntime.fromDocumentJson(event.data.documentJson);
      restoreImportedPacket();
      postDocument({ historyAction: "open" }); postPacket();
    }
    if (event.data?.type === "open-package") {
      resetStepImportController();
      runtime?.free(); runtime = WasmPartRuntime.fromPortablePackage(new Uint8Array(event.data.bytes));
      restoreImportedPacket();
      postImportedStepSources();
      postDocument({ historyAction: "open" }); postPacket();
    }
    if (event.data?.type === "new-document") {
      resetStepImportController();
      runtime?.free();
      runtime = new WasmPartRuntime(event.data.documentId, "Untitled Part");
      importedPacket = undefined;
      postDocument({ historyAction: "new" }); postPacket();
    }
    if (event.data?.type === "commit-pad") {
      if (!runtime) throw new Error("part runtime is not initialized");
      if (event.data.source) {
        const source = event.data.source as SketchExtrudeSource;
        const before = JSON.parse(runtime.documentJson()) as RuntimeDocumentJournal;
        const beforeHash = runtime.semanticHash();
        if (source.resultMode === "cut"
          && (event.data.baseDocumentHash !== beforeHash || event.data.baseRevision !== before.revision)) {
          scope.postMessage({
            type: "operation-error",
            code: "extrude_stale_preview_basis",
            category: "stale_reference",
            field: "extrude.preview_basis",
            referencedEntityIds: source.targetBodyId ? [source.targetBodyId] : [],
            message: `Cut preview basis ${String(event.data.baseRevision)}:${String(event.data.baseDocumentHash)} does not match accepted revision ${before.revision}:${beforeHash}`,
            recovery: "Preview the Cut again against the current accepted document",
            semanticHash: beforeHash,
          } satisfies WorkerResponse);
          return;
        }
        let outcome: AdvancedFeatureOutcome;
        try {
          requirePlanarFaceAuthority(source.support);
          outcome = JSON.parse(runtime.commitSketchExtrudeJson(JSON.stringify({
            sketch: source.sketch,
            support: source.support,
            distance_nanometers: event.data.valueNanometers,
            direction: (event.data.direction ?? "positive") as ExtrudeDirection,
            feature_id: source.featureId,
            body_id: source.bodyId,
            result_mode: source.resultMode,
            ...(source.targetBodyId ? { target_body_id: source.targetBodyId } : {}),
            tolerance: 0.01,
            ...(source.profileGeometryIds ? { profile_geometry_ids: source.profileGeometryIds } : {}),
            transaction_id: source.transactionId,
          }))) as AdvancedFeatureOutcome;
        } catch (error) {
          if (runtime.semanticHash() !== beforeHash) throw new Error("Extrude support preflight failure mutated the accepted document");
          if (error instanceof PlanarFaceAuthorityError) {
            scope.postMessage({
              type: "operation-error", code: error.diagnostic.code, category: error.diagnostic.category, field: error.diagnostic.field,
              referencedEntityIds: error.diagnostic.referencedBodyIds, message: error.message,
              recovery: "Select a current planar face or explicitly repair the retained reference", semanticHash: beforeHash,
            } satisfies WorkerResponse);
            return;
          }
          const support = constructionPlaneSupportRuntimeErrorMapping(error);
          if (!support && source.resultMode === "cut") {
            const diagnostic = normalizeExtrudeCutFailure(error, source.targetBodyId);
            scope.postMessage({
              type: "operation-error", code: diagnostic.code, category: diagnostic.category, field: diagnostic.field,
              referencedEntityIds: diagnostic.referencedEntityIds, message: diagnostic.message,
              recovery: diagnostic.recovery, semanticHash: beforeHash,
            } satisfies WorkerResponse);
            return;
          }
          if (!support) throw error;
          scope.postMessage({
            type: "operation-error", code: support.code, category: "reference", field: support.field,
            referencedEntityIds: support.referencedEntityIds,
            message: error instanceof Error ? error.message : String(error), recovery: support.recovery,
            semanticHash: beforeHash,
          } satisfies WorkerResponse);
          return;
        }
        if (!outcome.accepted) {
          if (source.resultMode === "cut") {
            if (runtime.semanticHash() !== beforeHash || outcome.document_hash !== beforeHash) {
              throw new Error("refused Cut commit mutated the accepted document");
            }
            const diagnostic = normalizeExtrudeCutFailure(outcome, source.targetBodyId);
            scope.postMessage({
              type: "operation-error", code: diagnostic.code, category: diagnostic.category, field: diagnostic.field,
              referencedEntityIds: diagnostic.referencedEntityIds, message: diagnostic.message,
              recovery: diagnostic.recovery, semanticHash: beforeHash,
            } satisfies WorkerResponse);
            return;
          }
          const message = outcome.error?.message ?? "Extrude was refused";
          const support = constructionPlaneSupportRuntimeErrorMapping(message);
          scope.postMessage(support
            ? { type: "operation-error", code: support.code, category: "reference", field: support.field, referencedEntityIds: support.referencedEntityIds, message, recovery: support.recovery, semanticHash: outcome.document_hash }
            : { type: "operation-error", code: "extrude_refused", message, recovery: outcome.error?.recovery, semanticHash: outcome.document_hash } satisfies WorkerResponse);
          return;
        }
        const transaction = acceptedTransactionAfter(before.revision);
        if (!transaction) throw new Error("accepted Extrude has no durable transaction");
        postDocument({ transaction, recompute: { dirtyRoots: [source.featureId], evaluationOrder: [source.featureId] } });
        postPacket();
        return;
      }
      const outcome = JSON.parse(runtime.commitLength("parameter:distance", BigInt(event.data.valueNanometers))) as { base_revision: number; result_revision: number; dirty_roots: string[]; evaluation_order: string[] };
      postDocument({
        transaction: { id: `transaction:${outcome.result_revision}`, base_revision: outcome.base_revision, result_revision: outcome.result_revision, changes: [{ kind: "set_parameter_value", parameter: "parameter:distance", value: { kind: "length_nanometers", value: event.data.valueNanometers } }] },
        recompute: { dirtyRoots: outcome.dirty_roots, evaluationOrder: outcome.evaluation_order },
      });
      postPacket();
    }
    if (event.data?.type === "preview-extrude") {
      try {
        postExtrudePreview(event.data.requestId, event.data.valueNanometers, (event.data.direction ?? "positive") as ExtrudeDirection, event.data.source);
      } catch (error) {
        const source = event.data.source as SketchExtrudeSource | undefined;
        const face = error instanceof PlanarFaceAuthorityError ? error.diagnostic : undefined;
        const support = constructionPlaneSupportRuntimeErrorMapping(error);
        const cut = !face && !support && source?.resultMode === "cut" ? normalizeExtrudeCutFailure(error, source.targetBodyId) : undefined;
        scope.postMessage({
          type: "operation-error",
          code: face?.code ?? support?.code ?? cut?.code ?? "extrude_preview_refused",
          ...(face ? { category: face.category, field: face.field, referencedEntityIds: face.referencedBodyIds }
            : support ? { category: "reference" as const, field: support.field, referencedEntityIds: support.referencedEntityIds }
              : cut ? { category: cut.category, field: cut.field, referencedEntityIds: cut.referencedEntityIds } : {}),
          message: cut?.message ?? (error instanceof Error ? error.message : String(error)),
          recovery: face ? "Select a current planar face or explicitly repair the retained reference" : support?.recovery ?? cut?.recovery ?? "Select one closed profile and retry",
          semanticHash: runtime?.semanticHash(),
        } satisfies WorkerResponse);
      }
    }
    if (event.data?.type === "restore-accepted-packet") {
      postPacket();
    }
    if (event.data?.type === "preview-offset-construction-plane") {
      if (!runtime) throw new Error("part runtime is not initialized");
      const beforeHash = runtime.semanticHash();
      try {
        const outcome = JSON.parse((runtime as ConstructionPlaneRuntime).previewOffsetConstructionPlaneJson(JSON.stringify(event.data.request))) as {
          accepted_document_hash: string;
          plane: OffsetConstructionPlaneDefinition;
          frame: OffsetConstructionPlaneFrame | null;
        };
        if (outcome.plane.suppressed !== event.data.request.suppressed
          || (outcome.plane.suppressed ? outcome.frame !== null : outcome.frame === null)) {
          throw new Error("construction plane preview returned an inconsistent suppression frame");
        }
        if (runtime.semanticHash() !== beforeHash || outcome.accepted_document_hash !== beforeHash) throw new Error("construction plane preview mutated the accepted document");
        scope.postMessage({ type: "offset-construction-plane-preview", requestId: event.data.requestId, semanticHash: beforeHash, plane: outcome.plane, frame: outcome.frame } satisfies WorkerResponse);
      } catch (error) {
        if (runtime.semanticHash() !== beforeHash) throw new Error("construction plane preview failure mutated the accepted document");
        const mapping = constructionPlaneRuntimeErrorMapping(error, "preview");
        scope.postMessage({ type: "operation-error", code: mapping.code, category: mapping.category, field: mapping.field, referencedEntityIds: mapping.referencedEntityIds, requestId: event.data.requestId, semanticHash: beforeHash, message: error instanceof Error ? error.message : String(error), recovery: mapping.recovery } satisfies WorkerResponse);
      }
    }
    if (event.data?.type === "commit-offset-construction-plane") {
      if (!runtime) throw new Error("part runtime is not initialized");
      const beforeHash = runtime.semanticHash();
      const request = event.data.request as OffsetConstructionPlaneRequest;
      try {
        const outcome = JSON.parse((runtime as ConstructionPlaneRuntime).commitOffsetConstructionPlaneJson(JSON.stringify(request))) as {
          accepted: boolean;
          document_hash: string;
          document_json: string;
          plane: OffsetConstructionPlaneDefinition;
          frame: OffsetConstructionPlaneFrame | null;
          transaction: AcceptedTransaction;
        };
        if (!outcome.accepted
          || outcome.transaction.base_revision !== request.base_revision
          || outcome.document_hash !== runtime.semanticHash()
          || outcome.document_json !== runtime.documentJson()
          || outcome.plane.suppressed !== request.suppressed
          || (outcome.plane.suppressed ? outcome.frame !== null : outcome.frame === null)) {
          throw new Error("construction plane commit returned inconsistent acceptance evidence");
        }
        postDocument({ transaction: outcome.transaction, recompute: constructionPlaneRecomputeReport(request.plane_id, outcome.transaction) });
        // Suppression intentionally makes descendants unevaluable. No valid
        // replacement packet exists, so retain the UI's last accepted body
        // until unsuppression or another valid recompute produces one.
        if (!outcome.plane.suppressed) postPacket();
        scope.postMessage({ type: "offset-construction-plane-completed", requestId: event.data.requestId, semanticHash: outcome.document_hash, plane: outcome.plane, frame: outcome.frame, transaction: outcome.transaction } satisfies WorkerResponse);
      } catch (error) {
        if (runtime.semanticHash() !== beforeHash) throw error;
        const mapping = constructionPlaneRuntimeErrorMapping(error, "commit");
        scope.postMessage({ type: "operation-error", code: mapping.code, category: mapping.category, field: mapping.field, referencedEntityIds: mapping.referencedEntityIds, requestId: event.data.requestId, semanticHash: beforeHash, message: error instanceof Error ? error.message : String(error), recovery: mapping.recovery } satisfies WorkerResponse);
      }
    }
    if (event.data?.type === "retain-step-source") {
      if (!runtime) throw new Error("part runtime is not initialized");
      const retainedSha256 = runtime.retainImportedStepSource(new Uint8Array(event.data.bytes));
      if (retainedSha256 !== event.data.sourceSha256) throw new Error(`retained STEP source digest mismatch: expected ${event.data.sourceSha256}, received ${retainedSha256}`);
    }
    if (event.data?.type === "commit-dimensions") {
      if (!runtime) throw new Error("part runtime is not initialized");
      const document = JSON.parse(runtime.documentJson()) as { revision: number };
      const transactionId = `transaction:${document.revision + 1}:rectangle`;
      const changes: AcceptedTransaction["changes"] = [
        { kind: "set_parameter_value", parameter: "parameter:width", value: { kind: "length_nanometers", value: event.data.widthNanometers } },
        { kind: "set_parameter_value", parameter: "parameter:height", value: { kind: "length_nanometers", value: event.data.heightNanometers } },
      ];
      const outcome = JSON.parse(runtime.commitChangesJson(JSON.stringify({ transaction_id: transactionId, changes }))) as { revision: number };
      postDocument({
        transaction: { id: transactionId, base_revision: document.revision, result_revision: outcome.revision, changes },
        recompute: { dirtyRoots: ["feature:rectangle-sketch"], evaluationOrder: ["feature:rectangle-sketch", "feature:extrude"] },
      });
      postPacket();
    }
    if (event.data?.type === "set-parameter-expression") {
      if (!runtime) throw new Error("part runtime is not initialized");
      const beforeHash = runtime.semanticHash();
      const document = JSON.parse(runtime.documentJson()) as ParameterReferenceDocument;
      const outcome = JSON.parse(runtime.setFieldExpressionJson(JSON.stringify({
        transaction_id: `transaction:${document.revision + 1}:parameter-expression`,
        feature: event.data.feature,
        field: event.data.field,
        source: resolveSketchReferences(event.data.source, document),
      }))) as ParameterOutcome;
      if (!outcome.accepted) { postParameterRefusal(outcome, beforeHash); return; }
      const transaction = acceptedTransactionAfter(document.revision);
      if (!transaction) throw new Error("accepted parameter expression has no durable transaction");
      const evaluationOrder = event.data.field === "distance" ? ["feature:extrude"] : ["feature:rectangle-sketch", "feature:extrude"];
      postDocument({ transaction, recompute: { dirtyRoots: [event.data.feature], evaluationOrder } });
      postPacket();
      scope.postMessage({ type: "parameter-action-completed", label: "Parameter expression", semanticHash: runtime.semanticHash() } satisfies WorkerResponse);
    }
    if (event.data?.type === "rename-parameter") {
      if (!runtime) throw new Error("part runtime is not initialized");
      const beforeHash = runtime.semanticHash();
      const document = JSON.parse(runtime.documentJson()) as RuntimeDocumentJournal;
      const outcome = JSON.parse(runtime.renameParameterJson(JSON.stringify({
        transaction_id: `transaction:${document.revision + 1}:rename-parameter`,
        parameter: event.data.parameter,
        display_name: event.data.displayName,
      }))) as ParameterOutcome;
      if (!outcome.accepted) { postParameterRefusal(outcome, beforeHash); return; }
      const transaction = acceptedTransactionAfter(document.revision);
      if (!transaction) throw new Error("accepted parameter rename has no durable transaction");
      postDocument({ transaction });
      scope.postMessage({ type: "parameter-action-completed", label: "Parameter rename", semanticHash: runtime.semanticHash() } satisfies WorkerResponse);
    }
    if (event.data?.type === "promote-parameter") {
      if (!runtime) throw new Error("part runtime is not initialized");
      const beforeHash = runtime.semanticHash();
      const document = JSON.parse(runtime.documentJson()) as RuntimeDocumentJournal;
      try {
        const outcome = JSON.parse(runtime.promoteOrReuseParameterJson(JSON.stringify({
          transaction_id: `transaction:${document.revision + 1}:promote-parameter`,
          feature: event.data.feature,
          field: event.data.field,
          parameter: event.data.parameter,
          display_name: event.data.displayName,
        }))) as ParameterOutcome;
        if (!outcome.accepted) { postParameterRefusal(outcome, beforeHash); return; }
        postDocument({ transaction: acceptedTransactionAfter(document.revision) });
        scope.postMessage({ type: "parameter-action-completed", label: "Parameter binding", semanticHash: runtime.semanticHash() } satisfies WorkerResponse);
      } catch (error) {
        if (runtime.semanticHash() !== beforeHash) throw new Error("refused parameter promotion mutated the accepted document");
        scope.postMessage({ type: "parameter-error", diagnostic: { code: "evaluation", field: event.data.field, message: error instanceof Error ? error.message : String(error) }, semanticHash: beforeHash } satisfies WorkerResponse);
      }
    }
    if (event.data?.type === "apply-sketch-command") {
      if (!runtime) throw new Error("part runtime is not initialized");
      const beforeHash = runtime.semanticHash();
      const preview = JSON.parse(runtime.applySketchCommandJson(JSON.stringify({
        sketch: event.data.sketch as Sketch,
        command: event.data.command as SketchCommand,
      })));
      if (runtime.semanticHash() !== beforeHash || preview.document_hash !== beforeHash) throw new Error("sketch preview mutated the accepted document");
      scope.postMessage({ type: "sketch-command-preview", requestId: event.data.requestId, preview } satisfies WorkerResponse);
    }
    if (event.data?.type === "sketch-contract") {
      if (!runtime) throw new Error("part runtime is not initialized");
      const contract = JSON.parse(runtime.sketchSolverContractJson());
      scope.postMessage({ type: "sketch-contract", requestId: event.data.requestId, contract } satisfies WorkerResponse);
    }
    if (event.data?.type === "decompose-sketch") {
      if (!runtime) throw new Error("part runtime is not initialized");
      const decomposition = JSON.parse(runtime.decomposeSketchJson(JSON.stringify({ sketch: event.data.sketch })));
      scope.postMessage({ type: "sketch-decomposition", requestId: event.data.requestId, decomposition } satisfies WorkerResponse);
    }
    if (event.data?.type === "export-sketch-dxf") {
      if (!runtime) throw new Error("part runtime is not initialized");
      const { dxf } = JSON.parse(runtime.exportSketchDxfJson(JSON.stringify({ sketch: event.data.sketch })));
      scope.postMessage({ type: "sketch-dxf-export", requestId: event.data.requestId, dxf } satisfies WorkerResponse);
    }
    if (event.data?.type === "import-sketch-dxf") {
      if (!runtime) throw new Error("part runtime is not initialized");
      const imported = JSON.parse(runtime.importSketchDxfJson(JSON.stringify({ sketch_id: event.data.sketchId, dxf: event.data.dxf })));
      scope.postMessage({ type: "sketch-dxf-import", requestId: event.data.requestId, sketch: imported.sketch, decomposition: imported.decomposition } satisfies WorkerResponse);
    }
    if (event.data?.type === "apply-sketch-commands") {
      if (!runtime) throw new Error("part runtime is not initialized");
      const beforeHash = runtime.semanticHash();
      const requestJson = typeof event.data.requestJson === "string"
        ? event.data.requestJson
        : JSON.stringify({
          sketch: event.data.sketch as Sketch,
          commands: event.data.commands as SketchCommand[],
        });
      const runtimeStartedAt = performance.now();
      const previewJson = runtime.applySketchCommandsJson(requestJson);
      const runtimeMs = performance.now() - runtimeStartedAt;
      const responseParseStartedAt = performance.now();
      const preview = JSON.parse(previewJson);
      const responseParseMs = performance.now() - responseParseStartedAt;
      const enginePhases = preview.runtime_performance;
      const measuredEngineMs = enginePhases
        ? Object.values(enginePhases as Record<string, unknown>).reduce<number>((total, value) => total + (typeof value === "number" ? value : 0), 0)
        : 0;
      const wasmBoundaryAndSerializeMs = Math.max(0, runtimeMs - measuredEngineMs);
      if (runtime.semanticHash() !== beforeHash || preview.document_hash !== beforeHash) throw new Error("sketch batch preview mutated the accepted document");
      scope.postMessage({ type: "sketch-command-preview", requestId: event.data.requestId, preview, performance: { runtimeMs, responseParseMs, wasmBoundaryAndSerializeMs, ...(enginePhases ? { enginePhases } : {}) } } satisfies WorkerResponse);
    }
    if (event.data?.type === "drag-sketch") {
      if (!runtime) throw new Error("part runtime is not initialized");
      const beforeHash = runtime.semanticHash();
      const preview = JSON.parse(runtime.dragSketchJson(JSON.stringify({ sketch: event.data.sketch, drag: event.data.drag })));
      if (runtime.semanticHash() !== beforeHash || preview.document_hash !== beforeHash) throw new Error("sketch drag mutated the accepted document");
      scope.postMessage({ type: "sketch-drag-preview", requestId: event.data.requestId, preview } satisfies WorkerResponse);
    }
    if (event.data?.type === "solve-sketch") {
      if (!runtime) throw new Error("part runtime is not initialized");
      const beforeHash = runtime.semanticHash();
      const document = JSON.parse(runtime.documentJson()) as RuntimeDocumentJournal;
      try {
        requirePlanarFaceAuthority(event.data.support as SketchSupport, event.data.supportReference as TopologyReferenceView | undefined);
      } catch (error) {
        if (!(error instanceof PlanarFaceAuthorityError)) throw error;
        scope.postMessage({
          type: "operation-error", code: error.diagnostic.code, category: error.diagnostic.category, field: error.diagnostic.field,
          referencedEntityIds: error.diagnostic.referencedBodyIds, requestId: event.data.requestId,
          message: error.message, recovery: "Select a current planar face or explicitly repair the retained reference", semanticHash: beforeHash,
        } satisfies WorkerResponse);
        return;
      }
      const outcome = JSON.parse(runtime.solveSketchJson(JSON.stringify({ transaction_id: event.data.transactionId, sketch: event.data.sketch, support: event.data.support, ...(event.data.supportReference ? { support_reference: event.data.supportReference } : {}) })));
      if (!outcome.accepted) {
        if (runtime.semanticHash() !== beforeHash || outcome.document_hash !== beforeHash) throw new Error("refused sketch solve mutated the accepted document");
      } else {
        const afterSolve = JSON.parse(runtime.documentJson()) as RuntimeDocumentJournal & {
          feature_definitions_v2?: Record<string, { operation?: { kind?: string; profile?: { kind?: string; sketch?: string } } }>;
        };
        const downstreamExtrudes = Object.entries(afterSolve.feature_definitions_v2 ?? {})
          .filter(([, definition]) => definition.operation?.kind === "extrude"
            && definition.operation.profile?.kind === "sketch_region"
            && definition.operation.profile.sketch === (event.data.sketch as Sketch).id)
          .map(([featureId]) => featureId)
          .sort();
        const solveTransaction = acceptedTransactionAfter(document.revision);
        if (!solveTransaction) throw new Error("accepted sketch solve has no durable transaction");
        const baseSketch = event.data.sketch.id === "sketch:rectangle";
        postDocument({ transaction: solveTransaction, recompute: baseSketch
          ? { dirtyRoots: ["feature:rectangle-sketch"], evaluationOrder: ["feature:rectangle-sketch", "feature:extrude"] }
          : { dirtyRoots: downstreamExtrudes, evaluationOrder: [] } });
        for (const featureId of downstreamExtrudes) {
          const beforeRecompute = (JSON.parse(runtime.documentJson()) as RuntimeDocumentJournal).revision;
          const recomputed = JSON.parse(runtime.recomputeFromHereJson(featureId)) as {
            accepted?: boolean;
            plan?: { requested_from?: string; evaluation_order?: string[] };
          };
          if (recomputed.accepted !== true) throw new Error(`downstream Sketch Extrude recompute refused for ${featureId}`);
          const recomputeTransaction = acceptedTransactionAfter(beforeRecompute);
          if (!recomputeTransaction) throw new Error(`accepted downstream Sketch Extrude recompute has no transaction for ${featureId}`);
          postDocument({ transaction: recomputeTransaction, recompute: {
            dirtyRoots: [recomputed.plan?.requested_from ?? featureId],
            evaluationOrder: recomputed.plan?.evaluation_order ?? [featureId],
          } });
        }
        postPacket();
      }
      scope.postMessage({ type: "sketch-commit", requestId: event.data.requestId, accepted: outcome.accepted, solve: outcome.solve, semanticHash: runtime.semanticHash() } satisfies WorkerResponse);
    }
    if (event.data?.type === "preview-advanced-feature" || event.data?.type === "preview-advanced-feature-edit") {
      if (!runtime) throw new Error("part runtime is not initialized");
      const beforeHash = runtime.semanticHash();
      const incoming = event.data as AdvancedFeatureCommand;
      const editing = incoming.type === "preview-advanced-feature-edit";
      const operationSlug = incoming.operationId.replace("crawler.part.", "").replaceAll(".", "-");
      const nonce = crypto.randomUUID();
      const command: AdvancedFeatureCommand = {
        ...incoming,
        type: editing ? "edit-advanced-feature" : "execute-advanced-feature",
        featureId: editing ? incoming.featureId : incoming.featureId || `feature:${operationSlug}:${nonce}`,
        outputBodyId: editing ? incoming.outputBodyId : incoming.outputBodyId || `body:${operationSlug}:${nonce}`,
      };
      try {
        const preparedEnvelopeJson = editing ? undefined : prepareSketchFeatureEnvelope(runtime, command, nonce);
        const envelope = preparedEnvelopeJson
          ? JSON.parse(preparedEnvelopeJson) as ReturnType<typeof buildAdvancedFeatureEnvelope>
          : editing ? buildAdvancedFeatureEditEnvelope(runtime, command) : buildAdvancedFeatureEnvelope(runtime, command);
        const envelopeJson = preparedEnvelopeJson ?? serializeAdvancedFeatureEnvelope(envelope);
        const outcome = JSON.parse(runtime.previewFeatureJson(envelopeJson)) as AdvancedFeaturePreviewOutcome;
        if (runtime.semanticHash() !== beforeHash || outcome.document_hash !== beforeHash) throw new Error("advanced feature preview mutated the accepted document");
        if (!outcome.accepted || !outcome.result) {
          pendingAdvancedFeature = undefined;
          const detail = outcome.error ?? { category: "invalid_input", message: "feature preview was refused", recovery: "correct the feature inputs and retry" };
          scope.postMessage({
            type: "operation-error",
            code: `advanced_feature_${detail.category}`,
            category: detail.category,
            field: detail.field,
            message: detail.message,
            recovery: detail.recovery,
            operationId: command.operationId,
            featureId: command.featureId,
            requestId: command.previewRequestId,
            semanticHash: beforeHash,
          } satisfies WorkerResponse);
          return;
        }
        const rendered = runtimePacket(outcome.render);
        pendingAdvancedFeature = {
          command,
          envelopeJson,
          editing,
          acceptedHash: beforeHash,
          featureId: envelope.feature.id,
          bodyId: outcome.result.output.body_id,
        };
        const packet = rendered.packet;
        const transfer = Object.values(packet).filter((value): value is ArrayBufferView => ArrayBuffer.isView(value)).map((value) => value.buffer);
        scope.postMessage({
          type: "advanced-feature-preview",
          requestId: command.previewRequestId ?? 0,
          operationId: command.operationId,
          featureId: envelope.feature.id,
          bodyId: rendered.bodyId || outcome.result.output.body_id,
          semanticHash: beforeHash,
          packet,
          transferredBytes: transfer.reduce((total, buffer) => total + buffer.byteLength, 0),
        } satisfies WorkerResponse, transfer);
      } catch (error) {
        pendingAdvancedFeature = undefined;
        if (error instanceof AdvancedFeatureBuildError) {
          if (runtime.semanticHash() !== beforeHash) throw new Error("advanced feature validation mutated the accepted document");
          scope.postMessage({
            type: "operation-error",
            code: `advanced_feature_${error.detail.category}`,
            category: error.detail.category,
            field: error.detail.field,
            message: error.detail.message,
            recovery: error.detail.recovery,
            operationId: command.operationId,
            featureId: command.featureId,
            requestId: command.previewRequestId,
            semanticHash: beforeHash,
          } satisfies WorkerResponse);
          return;
        }
        if (runtime.semanticHash() !== beforeHash) throw new Error("advanced feature preparation failure mutated the accepted document");
        scope.postMessage({
          type: "operation-error",
          code: "advanced_feature_invalid_input",
          category: "invalid_input",
          message: error instanceof Error ? error.message : String(error),
          recovery: "correct the feature inputs and preview again",
          operationId: command.operationId,
          featureId: command.featureId,
          requestId: command.previewRequestId,
          semanticHash: beforeHash,
        } satisfies WorkerResponse);
        return;
      }
    }
    if (event.data?.type === "apply-advanced-feature") {
      if (!runtime) throw new Error("part runtime is not initialized");
      const pending = pendingAdvancedFeature;
      if (!pending) throw new Error("no accepted advanced feature preview is available to apply");
      if (runtime.semanticHash() !== pending.acceptedHash) throw new Error("the document changed after preview; preview the feature again");
      const envelope = JSON.parse(pending.envelopeJson) as { transaction_id: string; feature: { id: string } };
      const outcome = JSON.parse(pending.editing
        ? runtime.executeFeatureJson(pending.envelopeJson)
        : runtime.executeNewFeatureJson(pending.envelopeJson)) as AdvancedFeatureOutcome;
      if (!outcome.accepted || !outcome.result || outcome.before_hash !== pending.acceptedHash || outcome.document_hash !== runtime.semanticHash()) {
        throw new Error(outcome.error?.message ?? "advanced feature apply returned inconsistent acceptance evidence");
      }
      const document = JSON.parse(runtime.documentJson()) as { transactions: { id: string; base_revision: number; result_revision: number; changes: AcceptedTransaction["changes"] }[] };
      const accepted = document.transactions.at(-1);
      if (!accepted || accepted.id !== envelope.transaction_id) throw new Error("accepted advanced feature transaction is missing from the document");
      pendingAdvancedFeature = undefined;
      restoreImportedPacket();
      postDocument({
        transaction: accepted,
        ...(pending.editing && outcome.recomputed?.length
          ? { recompute: { dirtyRoots: [envelope.feature.id], evaluationOrder: [envelope.feature.id, ...outcome.recomputed.map((item) => item.feature)] } }
          : {}),
      });
      postPacket();
      scope.postMessage({ type: "advanced-feature-completed", operationId: pending.command.operationId, featureId: pending.featureId, bodyId: outcome.result.output.body_id, semanticHash: outcome.document_hash } satisfies WorkerResponse);
    }
    if (event.data?.type === "cancel-advanced-feature") {
      if (!runtime) throw new Error("part runtime is not initialized");
      pendingAdvancedFeature = undefined;
      postPacket();
      scope.postMessage({ type: "advanced-feature-preview-cancelled", semanticHash: runtime.semanticHash() } satisfies WorkerResponse);
    }
    if (event.data?.type === "execute-advanced-feature" || event.data?.type === "edit-advanced-feature") {
      if (!runtime) throw new Error("part runtime is not initialized");
      const beforeHash = runtime.semanticHash();
      const incoming = event.data as AdvancedFeatureCommand;
      const operationSlug = incoming.operationId.replace("crawler.part.", "").replaceAll(".", "-");
      const nonce = crypto.randomUUID();
      const command: AdvancedFeatureCommand = {
        ...incoming,
        featureId: incoming.type === "edit-advanced-feature" ? incoming.featureId : incoming.featureId || `feature:${operationSlug}:${nonce}`,
        outputBodyId: incoming.type === "edit-advanced-feature" ? incoming.outputBodyId : incoming.outputBodyId || `body:${operationSlug}:${nonce}`,
      };
      try {
        const editing = command.type === "edit-advanced-feature";
        const envelope = editing ? buildAdvancedFeatureEditEnvelope(runtime, command) : buildAdvancedFeatureEnvelope(runtime, command);
        const outcome = JSON.parse(editing
          ? runtime.executeFeatureJson(serializeAdvancedFeatureEnvelope(envelope))
          : runtime.executeNewFeatureJson(serializeAdvancedFeatureEnvelope(envelope))) as AdvancedFeatureOutcome;
        if (!outcome.accepted) {
          if (runtime.semanticHash() !== beforeHash || outcome.document_hash !== beforeHash) throw new Error("refused advanced feature mutated the accepted document");
          const detail = outcome.error ?? { category: "invalid_input", message: "feature execution was refused", recovery: "correct the feature inputs and retry" };
          scope.postMessage({
            type: "operation-error",
            code: `advanced_feature_${detail.category}`,
            category: detail.category,
            field: detail.field,
            message: detail.message,
            recovery: detail.recovery,
            operationId: command.operationId,
            featureId: command.featureId,
            semanticHash: beforeHash,
          } satisfies WorkerResponse);
          return;
        }
        if (!outcome.result || outcome.before_hash !== beforeHash || outcome.document_hash !== runtime.semanticHash()) throw new Error("advanced feature returned inconsistent acceptance evidence");
        const document = JSON.parse(runtime.documentJson()) as { revision: number; transactions: { id: string; base_revision: number; result_revision: number; changes: AcceptedTransaction["changes"] }[] };
        const accepted = document.transactions.at(-1);
        if (!accepted || accepted.id !== envelope.transaction_id) throw new Error("accepted advanced feature transaction is missing from the document");
        restoreImportedPacket();
        postDocument({
          transaction: accepted,
          ...(editing && outcome.recomputed?.length
            ? { recompute: { dirtyRoots: [envelope.feature.id], evaluationOrder: [envelope.feature.id, ...outcome.recomputed.map((item) => item.feature)] } }
            : {}),
        });
        postPacket();
        scope.postMessage({ type: "advanced-feature-completed", operationId: command.operationId, featureId: envelope.feature.id, bodyId: outcome.result.output.body_id, semanticHash: outcome.document_hash } satisfies WorkerResponse);
      } catch (error) {
        if (error instanceof AdvancedFeatureBuildError) {
          if (runtime.semanticHash() !== beforeHash) throw new Error("advanced feature validation mutated the accepted document");
          scope.postMessage({
            type: "operation-error",
            code: `advanced_feature_${error.detail.category}`,
            category: error.detail.category,
            field: error.detail.field,
            message: error.detail.message,
            recovery: error.detail.recovery,
            operationId: command.operationId,
            featureId: command.featureId,
            semanticHash: beforeHash,
          } satisfies WorkerResponse);
          return;
        }
        throw error;
      }
    }
    if (event.data?.type === "undo") {
      if (!runtime) throw new Error("part runtime is not initialized");
      runtime.undo(); restoreImportedPacket(); postDocument({ historyAction: "undo" }); postPacket();
    }
    if (event.data?.type === "redo") {
      if (!runtime) throw new Error("part runtime is not initialized");
      runtime.redo(); restoreImportedPacket(); postDocument({ historyAction: "redo" }); postPacket();
    }
    if (event.data?.type === "import-step") {
      if (!runtime) throw new Error("part runtime is not initialized");
      const source = new Uint8Array(event.data.bytes);
      const importId = `import:${crypto.randomUUID()}`;
      retainedStepDisplayName = event.data.displayName || "Imported STEP";
      const outcome = await importController().importStep(importId, source, { tolerance_nanometers: 10_000 }, Number(event.data.phaseDelayMs ?? 0));
      if (outcome.status === "success") {
        runtime.retainImportedStepSource(source);
        commitStepImport(outcome.result, outcome.measurements, retainedStepDisplayName);
      }
      else if (outcome.status === "cancelled") scope.postMessage({ type: "step-import-cancelled", requestId: outcome.request_id, cancellationMode: outcome.cancellation_mode, sourceRetained: importController().canReimport } satisfies WorkerResponse);
      else scope.postMessage({ type: "operation-error", code: outcome.error.code, message: outcome.error.message, recovery: outcome.error.recovery } satisfies WorkerResponse);
    }
    if (event.data?.type === "cancel-step-import") {
      stepImportController?.cancel();
    }
    if (event.data?.type === "reimport-step") {
      if (!stepImportController?.canReimport) throw new Error("no retained STEP source is available for re-import");
      const outcome = await stepImportController.reimport(undefined, `import:${crypto.randomUUID()}`);
      if (outcome.status === "success") commitStepImport(outcome.result, outcome.measurements, retainedStepDisplayName);
      else if (outcome.status === "cancelled") scope.postMessage({ type: "step-import-cancelled", requestId: outcome.request_id, cancellationMode: outcome.cancellation_mode, sourceRetained: stepImportController.canReimport } satisfies WorkerResponse);
      else scope.postMessage({ type: "operation-error", code: outcome.error.code, message: outcome.error.message, recovery: outcome.error.recovery } satisfies WorkerResponse);
    }
    if (event.data?.type === "commit-document-changes") {
      if (!runtime) throw new Error("part runtime is not initialized");
      const document = JSON.parse(runtime.documentJson()) as { revision: number };
      const transactionId = event.data.transactionId || `transaction:${document.revision + 1}:edit`;
      try {
        const outcome = JSON.parse(runtime.commitChangesJson(JSON.stringify({ transaction_id: transactionId, changes: event.data.changes }))) as { revision: number };
        restoreImportedPacket();
        postDocument({ transaction: { id: transactionId, base_revision: document.revision, result_revision: outcome.revision, changes: event.data.changes } });
        postPacket();
      } catch (error) {
        scope.postMessage({ type: "operation-error", code: event.data.operation ?? "invalid_document_change", message: error instanceof Error ? error.message : String(error), recovery: "respect the named feature dependency and retry" } satisfies WorkerResponse);
      }
    }
    if (event.data?.type === "feature-services") {
      if (!runtime) throw new Error("part runtime is not initialized");
      const durable = JSON.parse(runtime.documentJson()) as { topology_references?: Record<string, TopologyReferenceView> };
      const observedTopology = (event.data.observedTopology ?? Object.values(durable.topology_references ?? {})) as TopologyReferenceView[];
      const services = JSON.parse(runtime.featureServicesJson(event.data.feature)) as FeatureServicesView;
      const repair = JSON.parse(runtime.repairInspectionJson(JSON.stringify(observedTopology))) as RepairInspectionView;
      scope.postMessage({ type: "feature-services", selected: event.data.feature, services, repair, observedTopology } satisfies WorkerResponse);
    }
    if (event.data?.type === "recompute-from-here") {
      if (!runtime) throw new Error("part runtime is not initialized");
      const before = JSON.parse(runtime.documentJson()) as RuntimeDocumentJournal;
      const result = JSON.parse(runtime.recomputeFromHereJson(event.data.feature)) as { accepted: boolean; plan: { requested_from: string; required_inputs: string[]; evaluation_order: string[] }; recomputed?: { feature: string; body: string }[]; transaction?: AcceptedTransaction; diagnostics?: FeatureServicesView["diagnostics"]; error?: AdvancedFeatureError; document_hash: string };
      if (result.accepted && result.transaction) {
        if (result.transaction.base_revision !== before.revision) throw new Error("recompute returned inconsistent transaction evidence");
        postDocument({ transaction: result.transaction, recompute: { dirtyRoots: [result.plan.requested_from], evaluationOrder: result.plan.evaluation_order } });
        postPacket();
      }
      scope.postMessage({
        type: "recompute-from-here",
        accepted: result.accepted,
        plan: result.plan,
        recomputed: result.recomputed,
        transaction: result.transaction,
        diagnostics: result.diagnostics,
        error: result.error,
        semanticHash: result.document_hash,
      } satisfies WorkerResponse);
      const durable = JSON.parse(runtime.documentJson()) as { topology_references?: Record<string, TopologyReferenceView> };
      const observedTopology = Object.values(durable.topology_references ?? {});
      scope.postMessage({ type: "feature-services", selected: event.data.feature, services: JSON.parse(runtime.featureServicesJson(event.data.feature)), repair: JSON.parse(runtime.repairInspectionJson(JSON.stringify(observedTopology))), observedTopology } satisfies WorkerResponse);
    }
    if (event.data?.type === "preview-topology-rebind") {
      if (!runtime) throw new Error("part runtime is not initialized");
      const beforeHash = runtime.semanticHash();
      const before = JSON.parse(runtime.documentJson()) as RuntimeDocumentJournal;
      try {
        const outcome = JSON.parse((runtime as TopologyRebindRuntime).previewTopologyRebindJson(JSON.stringify({
          selected: event.data.selected,
          observed: event.data.observedTopology,
          tolerance: 0.01,
        }))) as {
          accepted: boolean;
          base_document_hash: string;
          base_revision: number;
          selected: string;
          candidate_frame: OffsetConstructionPlaneFrame;
          body_id: string;
          render: RuntimePacketJson;
        };
        if (!outcome.accepted || outcome.base_document_hash !== beforeHash || outcome.base_revision !== before.revision
          || outcome.selected !== event.data.selected || runtime.semanticHash() !== beforeHash) {
          throw new Error("topology repair preview returned inconsistent non-mutating basis evidence");
        }
        const rendered = runtimePacket(outcome.render);
        if (rendered.bodyId !== outcome.body_id) throw new Error("topology repair preview returned inconsistent body evidence");
        pendingTopologyRebind = {
          requestId: event.data.requestId,
          selected: outcome.selected,
          observedTopology: event.data.observedTopology,
          baseDocumentHash: outcome.base_document_hash,
          baseRevision: outcome.base_revision,
        };
        const packet = rendered.packet;
        const transfer = Object.values(packet).filter((value): value is ArrayBufferView => ArrayBuffer.isView(value)).map((value) => value.buffer);
        scope.postMessage({
          type: "topology-rebind-preview",
          requestId: event.data.requestId,
          selected: outcome.selected,
          baseDocumentHash: outcome.base_document_hash,
          baseRevision: outcome.base_revision,
          candidateFrame: outcome.candidate_frame,
          semanticHash: beforeHash,
          bodyId: rendered.bodyId,
          packet,
          transferredBytes: transfer.reduce((total, buffer) => total + buffer.byteLength, 0),
        } satisfies WorkerResponse, transfer);
      } catch (error) {
        pendingTopologyRebind = undefined;
        if (runtime.semanticHash() !== beforeHash) throw new Error("refused topology repair preview mutated the accepted document");
        scope.postMessage({
          type: "operation-error",
          code: "topology_rebind_preview_refused",
          message: error instanceof Error ? error.message : String(error),
          recovery: "inspect a current candidate and request a new repair preview",
          requestId: event.data.requestId,
          semanticHash: beforeHash,
        } satisfies WorkerResponse);
      }
    }
    if (event.data?.type === "cancel-topology-rebind-preview") {
      if (!runtime) throw new Error("part runtime is not initialized");
      const beforeHash = runtime.semanticHash();
      if (pendingTopologyRebind?.requestId === event.data.requestId) pendingTopologyRebind = undefined;
      postPacket();
      scope.postMessage({ type: "topology-rebind-preview-cancelled", requestId: event.data.requestId, semanticHash: beforeHash } satisfies WorkerResponse);
    }
    if (event.data?.type === "explicit-rebind") {
      if (!runtime) throw new Error("part runtime is not initialized");
      const before = JSON.parse(runtime.documentJson()) as RuntimeDocumentJournal;
      const beforeHash = runtime.semanticHash();
      try {
        const pending = pendingTopologyRebind;
        if (!pending || pending.requestId !== event.data.requestId || pending.selected !== event.data.selected
          || pending.baseDocumentHash !== event.data.baseDocumentHash || pending.baseRevision !== event.data.baseRevision
          || pending.baseDocumentHash !== beforeHash || pending.baseRevision !== before.revision) {
          throw new Error("explicit topology rebind does not match the current preview basis");
        }
        const result = JSON.parse(runtime.explicitRebindJson(JSON.stringify({
          transaction_id: event.data.transactionId,
          selected: event.data.selected,
          observed: pending.observedTopology,
          base_document_hash: event.data.baseDocumentHash,
          base_revision: event.data.baseRevision,
        }))) as { accepted: boolean; selected: string; transaction: AcceptedTransaction; document_hash: string };
        if (!result.accepted || !result.transaction || result.transaction.base_revision !== before.revision || result.selected !== pending.selected) {
          throw new Error("explicit topology rebind returned inconsistent acceptance evidence");
        }
        pendingTopologyRebind = undefined;
        postDocument({ transaction: result.transaction });
        scope.postMessage({ type: "repair-committed", selected: result.selected, transaction: result.transaction, semanticHash: result.document_hash } satisfies WorkerResponse);
        postPacket();
      } catch (error) {
        pendingTopologyRebind = undefined;
        if (runtime.semanticHash() !== beforeHash) throw new Error("refused explicit topology rebind mutated the accepted document");
        scope.postMessage({
          type: "operation-error",
          code: "topology_rebind_commit_refused",
          message: error instanceof Error ? error.message : String(error),
          recovery: "request a new repair preview from the current accepted document",
          requestId: event.data.requestId,
          semanticHash: beforeHash,
        } satisfies WorkerResponse);
      }
    }
    if (event.data?.type === "timeline-rollback") {
      if (!runtime) throw new Error("part runtime is not initialized");
      const rollback = JSON.parse(runtime.setTimelineRollback(JSON.stringify(event.data.rollback))) as { kind: "before_first" | "after" | "end"; feature?: string };
      if (rollback.kind === "end") restoreImportedPacket(); else importedPacket = undefined;
      scope.postMessage({ type: "timeline-rollback", rollback } satisfies WorkerResponse);
      postPacket();
    }
    if (event.data?.type === "force-fault") throw new Error(event.data.message ?? "forced runtime fault");
    if (event.data?.type === "export") {
      if (!runtime) throw new Error("part runtime is not initialized");
      const before = runtime.semanticHash();
      const content = event.data.format === "step" ? runtime.exportStep() : event.data.format === "stl" ? runtime.exportStl() : runtime.exportObj();
      const after = runtime.semanticHash();
      if (after !== before) throw new Error("export mutated the accepted part");
      scope.postMessage({ type: "export", format: event.data.format, content, semanticHash: after } satisfies WorkerResponse);
    }
    if (event.data?.type === "export-package") {
      if (!runtime) throw new Error("part runtime is not initialized");
      const before = runtime.semanticHash(); const bytes = runtime.exportPortablePackage(); const after = runtime.semanticHash();
      if (after !== before) throw new Error("portable package export mutated the accepted part");
      scope.postMessage({ type: "portable-package", bytes, semanticHash: after } satisfies WorkerResponse, [bytes.buffer]);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (event.data?.type === "export") {
      scope.postMessage({ type: "export-error", format: event.data.format, message } satisfies WorkerResponse);
      return;
    }
    const recoverableSketchRequests = new Set([
      "apply-sketch-command",
      "apply-sketch-commands",
      "drag-sketch",
      "solve-sketch",
      "sketch-contract",
      "decompose-sketch",
      "export-sketch-dxf",
      "import-sketch-dxf",
    ]);
    if (recoverableSketchRequests.has(event.data?.type) && typeof event.data?.requestId === "string") {
      scope.postMessage({ type: "sketch-error", requestId: event.data.requestId, message } satisfies WorkerResponse);
    } else {
      scope.postMessage({ type: "error", message } satisfies WorkerResponse);
    }
  }
});
