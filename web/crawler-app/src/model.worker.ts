/// <reference lib="webworker" />

import type { AcceptedTransaction, AdvancedFeatureCommand, AdvancedFeatureError, FeatureServicesView, NamedParameterView, ParameterDiagnostic, RecomputeReport, RenderPacket, RepairInspectionView, TopologyReferenceView, WorkerResponse } from "./protocol";
import { AdvancedFeatureBuildError, buildAdvancedFeatureEditEnvelope, buildAdvancedFeatureEnvelope, serializeAdvancedFeatureEnvelope } from "./advanced-feature-builder";
import initRuntime, { WasmPartRuntime } from "./generated/runtime/crawler_part_runtime.js";
import type { Sketch, SketchCommand } from "./sketch-editor";
import { StepImportController, type StepImportMeasurements, type StepImportPayload as ControllerStepImportPayload } from "./step-import-controller";

const scope = self as DedicatedWorkerGlobalScope;
let runtime: WasmPartRuntime | undefined;
let importedPacket: { bodyId: string; packet: RenderPacket } | undefined;
let stepImportController: StepImportController | undefined;
let retainedStepDisplayName = "Imported STEP";

interface RuntimePacketJson {
  body_id: string;
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

interface ParameterOutcome {
  accepted: boolean;
  document_hash: string;
  diagnostic?: ParameterDiagnostic;
}

interface RuntimeDocumentJournal {
  revision: number;
  transactions: AcceptedTransaction[];
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
  return { bodyId: source.body_id, packet: {
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

function postExtrudePreview(requestId: number, distanceNanometers: number): void {
  if (!runtime) throw new Error("part runtime is not initialized");
  const acceptedHash = runtime.semanticHash();
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
      semanticHash: acceptedHash,
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
  const source = runtimePacket(preview.render);
  const packet = source.packet;
  const transfer = Object.values(packet).filter((value): value is ArrayBufferView => ArrayBuffer.isView(value)).map((value) => value.buffer);
  const transferredBytes = transfer.reduce((total, buffer) => total + buffer.byteLength, 0);
  scope.postMessage({
    type: "extrude-preview",
    requestId,
    distanceNanometers: preview.distance_nanometers,
    semanticHash: acceptedHash,
    bodyId: source.bodyId,
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
      runtime = new WasmPartRuntime("document:part-alpha-001", "Bracket", 40_000_000n, 28_000_000n, 12_000_000n);
      scope.postMessage({ type: "wasm-ready", detail: "crawler-part-runtime ready" } satisfies WorkerResponse);
      postDocument(); postPacket();
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
      runtime = new WasmPartRuntime(event.data.documentId, "Untitled Part", 40_000_000n, 28_000_000n, 12_000_000n);
      importedPacket = undefined;
      postDocument({ historyAction: "new" }); postPacket();
    }
    if (event.data?.type === "commit-pad") {
      if (!runtime) throw new Error("part runtime is not initialized");
      const outcome = JSON.parse(runtime.commitLength("parameter:distance", BigInt(event.data.valueNanometers))) as { base_revision: number; result_revision: number; dirty_roots: string[]; evaluation_order: string[] };
      postDocument({
        transaction: { id: `transaction:${outcome.result_revision}`, base_revision: outcome.base_revision, result_revision: outcome.result_revision, changes: [{ kind: "set_parameter_value", parameter: "parameter:distance", value: { kind: "length_nanometers", value: event.data.valueNanometers } }] },
        recompute: { dirtyRoots: outcome.dirty_roots, evaluationOrder: outcome.evaluation_order },
      });
      postPacket();
    }
    if (event.data?.type === "preview-extrude") {
      postExtrudePreview(event.data.requestId, event.data.valueNanometers);
    }
    if (event.data?.type === "restore-accepted-packet") {
      postPacket();
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
      const document = JSON.parse(runtime.documentJson()) as RuntimeDocumentJournal;
      const outcome = JSON.parse(runtime.setFieldExpressionJson(JSON.stringify({
        transaction_id: `transaction:${document.revision + 1}:parameter-expression`,
        feature: event.data.feature,
        field: event.data.field,
        source: event.data.source,
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
      const outcome = JSON.parse(runtime.solveSketchJson(JSON.stringify({ transaction_id: event.data.transactionId, sketch: event.data.sketch, support: event.data.support })));
      if (!outcome.accepted) {
        if (runtime.semanticHash() !== beforeHash || outcome.document_hash !== beforeHash) throw new Error("refused sketch solve mutated the accepted document");
      } else {
        const transaction = acceptedTransactionAfter(document.revision);
        if (!transaction) throw new Error("accepted sketch solve has no durable transaction");
        postDocument({ transaction, recompute: { dirtyRoots: ["feature:rectangle-sketch"], evaluationOrder: ["feature:rectangle-sketch", "feature:extrude"] } });
        postPacket();
      }
      scope.postMessage({ type: "sketch-commit", requestId: event.data.requestId, accepted: outcome.accepted, solve: outcome.solve, semanticHash: runtime.semanticHash() } satisfies WorkerResponse);
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
      scope.postMessage({ type: "recompute-from-here", accepted: result.accepted, plan: result.plan, diagnostics: result.diagnostics, error: result.error, semanticHash: result.document_hash } satisfies WorkerResponse);
      const durable = JSON.parse(runtime.documentJson()) as { topology_references?: Record<string, TopologyReferenceView> };
      const observedTopology = Object.values(durable.topology_references ?? {});
      scope.postMessage({ type: "feature-services", selected: event.data.feature, services: JSON.parse(runtime.featureServicesJson(event.data.feature)), repair: JSON.parse(runtime.repairInspectionJson(JSON.stringify(observedTopology))), observedTopology } satisfies WorkerResponse);
    }
    if (event.data?.type === "explicit-rebind") {
      if (!runtime) throw new Error("part runtime is not initialized");
      const before = JSON.parse(runtime.documentJson()) as RuntimeDocumentJournal;
      const result = JSON.parse(runtime.explicitRebindJson(JSON.stringify({ transaction_id: event.data.transactionId, selected: event.data.selected, observed: event.data.observedTopology }))) as { accepted: boolean; selected: string; transaction: AcceptedTransaction; document_hash: string };
      if (!result.accepted || !result.transaction || result.transaction.base_revision !== before.revision) throw new Error("explicit topology rebind returned inconsistent acceptance evidence");
      postDocument({ transaction: result.transaction });
      scope.postMessage({ type: "repair-committed", selected: result.selected, transaction: result.transaction, semanticHash: result.document_hash } satisfies WorkerResponse);
      postPacket();
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
    scope.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) } satisfies WorkerResponse);
  }
});
