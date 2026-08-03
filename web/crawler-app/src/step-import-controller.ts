export interface StepImportSettings {
  tolerance_nanometers: number;
}

export interface GeometryEvidence {
  vertex_count: number;
  edge_count: number;
  face_count: number;
  bounds_nm: { min: [number, number, number]; max: [number, number, number] };
  volume_model_units3: number;
  deterministic_digest: string;
}

export interface BodySnapshot {
  body_id: string;
  solid_json: number[];
  evidence: GeometryEvidence;
}

export interface StepImportProvenance {
  source_sha256: string;
  source_bytes: number;
  settings: StepImportSettings;
  shell_count: number;
  face_count: number;
  triangle_count: number;
}

export interface StepImportPayload {
  kind: "step_import";
  import_id: string;
  provenance: StepImportProvenance;
  body: BodySnapshot;
  render_packet: {
    positions: number[];
    normals: number[];
    triangle_indices: number[];
    edge_positions: number[];
    vertex_positions: number[];
    face_ranges: unknown[];
    edge_ranges: unknown[];
    vertex_pick_tokens: number[];
    pick_table: unknown[];
    bounds: { min: [number, number, number]; max: [number, number, number] };
  };
  transferred_bytes: number;
  kernel_time_ms: number;
}

export interface SnapshotMeasurements {
  serialized_bytes: number;
  topology_elements: number;
  bounds_span_nm: [number, number, number];
  finite_positive_volume: boolean;
  deterministic_digest: string;
}

export interface StepImportMeasurements {
  source_bytes: number;
  transferred_bytes: number;
  kernel_time_ms: number;
  triangle_count: number;
  snapshot: SnapshotMeasurements;
}

export interface StepImportProgress {
  request_id: string;
  phase: string;
  percent: number;
}

export type StepImportOutcome =
  | { status: "success"; request_id: string; result: StepImportPayload; measurements: StepImportMeasurements }
  | { status: "cancelled"; request_id: string; cancellation_mode: "worker_restart"; code: "cancelled"; field: "request_id"; recovery: string }
  | { status: "error"; request_id: string; error: StepImportWorkerError };

export interface StepImportWorkerError {
  code: string;
  message: string;
  field?: string;
  recovery?: string;
  preserved_source?: number[];
  source_sha256?: string;
}

interface WorkerEventEnvelope {
  request_id: string;
  event: "accepted" | "progress" | "result" | "cancelled" | "error";
  phase?: string;
  percent?: number;
  result?: StepImportPayload;
  cancellation_mode?: "cooperative" | "worker_restart";
  code?: string;
  field?: string;
  recovery?: string;
  message?: string;
  preserved_source?: number[];
  source_sha256?: string;
}

type NestedWorkerMessage =
  | { kind: "progress"; job_id: number; phase: string; percent: number }
  | { kind: "events"; job_id: number; events: WorkerEventEnvelope[] }
  | { kind: "fatal"; job_id: number; message: string };

export interface StepImportWorker {
  onmessage: ((event: MessageEvent<NestedWorkerMessage>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}

export interface StepImportControllerOptions {
  document_id: string;
  document_revision: () => number;
  preview_generation?: () => number;
  worker_factory?: () => StepImportWorker;
  on_progress?: (progress: StepImportProgress) => void;
}

interface RetainedImport {
  import_id: string;
  source: Uint8Array;
  settings: StepImportSettings;
  phase_delay_ms: number;
}

interface ActiveImport {
  job_id: number;
  request_id: string;
  worker: StepImportWorker;
  settle: (outcome: StepImportOutcome) => void;
}

/** Measures the exact persisted body evidence returned by the kernel worker. */
export function measureBodySnapshot(body: BodySnapshot): SnapshotMeasurements {
  const evidence = body.evidence;
  return {
    serialized_bytes: body.solid_json.length,
    topology_elements: evidence.vertex_count + evidence.edge_count + evidence.face_count,
    bounds_span_nm: evidence.bounds_nm.max.map((maximum, axis) => maximum - evidence.bounds_nm.min[axis]) as [number, number, number],
    finite_positive_volume: Number.isFinite(evidence.volume_model_units3) && evidence.volume_model_units3 > 0,
    deterministic_digest: evidence.deterministic_digest,
  };
}

/** Combines source provenance, transfer cost, and durable B-rep measurements. */
export function measureStepImport(result: StepImportPayload): StepImportMeasurements {
  return {
    source_bytes: result.provenance.source_bytes,
    transferred_bytes: result.transferred_bytes,
    kernel_time_ms: result.kernel_time_ms,
    triangle_count: result.provenance.triangle_count,
    snapshot: measureBodySnapshot(result.body),
  };
}

/** Owns one disposable nested worker per STEP attempt so cancellation is real. */
export class StepImportController {
  readonly #options: StepImportControllerOptions;
  #active: ActiveImport | null = null;
  #retained: RetainedImport | null = null;
  #nextJob = 1;

  constructor(options: StepImportControllerOptions) {
    this.#options = options;
  }

  get canReimport(): boolean { return this.#retained !== null; }
  get isImporting(): boolean { return this.#active !== null; }

  importStep(import_id: string, source: Uint8Array, settings: StepImportSettings, phase_delay_ms = 0): Promise<StepImportOutcome> {
    if (this.#active) throw new Error("a STEP import is already running");
    if (!import_id.trim()) throw new Error("import_id must be non-empty");
    if (!Number.isSafeInteger(settings.tolerance_nanometers) || settings.tolerance_nanometers <= 0) {
      throw new Error("tolerance_nanometers must be a positive safe integer");
    }
    this.#retained = { import_id, source: source.slice(), settings: { ...settings }, phase_delay_ms: Math.max(0, phase_delay_ms) };
    return this.#start(this.#retained);
  }

  reimport(settings: StepImportSettings | undefined = undefined, import_id: string | undefined = undefined): Promise<StepImportOutcome> {
    if (!this.#retained) throw new Error("no STEP source is retained for re-import");
    const retained = { ...this.#retained, import_id: import_id ?? this.#retained.import_id, source: this.#retained.source.slice(), settings: settings ? { ...settings } : { ...this.#retained.settings } };
    this.#retained = retained;
    return this.#start(retained);
  }

  cancel(): boolean {
    const active = this.#active;
    if (!active) return false;
    this.#active = null;
    active.worker.terminate();
    active.settle({
      status: "cancelled",
      request_id: active.request_id,
      cancellation_mode: "worker_restart",
      code: "cancelled",
      field: "request_id",
      recovery: "retry the retained STEP source when ready",
    });
    return true;
  }

  #start(retained: RetainedImport): Promise<StepImportOutcome> {
    if (this.#active) throw new Error("a STEP import is already running");
    const job_id = this.#nextJob++;
    const request_id = `step-import:${job_id}:${retained.import_id}`;
    const worker = (this.#options.worker_factory ?? defaultWorkerFactory)();
    const transferable = retained.source.slice();
    const outcome = new Promise<StepImportOutcome>((settle) => {
      this.#active = { job_id, request_id, worker, settle };
      worker.onmessage = (message) => this.#handleMessage(job_id, request_id, message.data);
      worker.onerror = (event) => this.#finish(job_id, {
        status: "error",
        request_id,
        error: { code: "internal", message: event.message, recovery: "retry with a fresh import worker" },
      });
      worker.postMessage({
        kind: "start",
        job_id,
        envelope: {
          protocol_version: 1,
          request_id,
          document_id: this.#options.document_id,
          document_revision: this.#options.document_revision(),
          preview_generation: this.#options.preview_generation?.() ?? 0,
          command: "import_step",
          import_id: retained.import_id,
          source_bytes: transferable,
          settings: retained.settings,
          phase_delay_ms: retained.phase_delay_ms,
        },
      }, [transferable.buffer]);
    });
    return outcome;
  }

  #handleMessage(job_id: number, request_id: string, message: NestedWorkerMessage): void {
    if (!this.#active || this.#active.job_id !== job_id || message.job_id !== job_id) return;
    if (message.kind === "progress") {
      this.#options.on_progress?.({ request_id, phase: message.phase, percent: message.percent });
      return;
    }
    if (message.kind === "fatal") {
      this.#finish(job_id, { status: "error", request_id, error: { code: "internal", message: message.message, recovery: "retry with a fresh import worker" } });
      return;
    }
    for (const event of message.events) {
      if (event.request_id !== request_id) continue;
      if (event.event === "progress" && event.phase !== undefined && event.percent !== undefined) {
        this.#options.on_progress?.({ request_id, phase: event.phase, percent: event.percent });
      } else if (event.event === "result" && event.result?.kind === "step_import") {
        this.#finish(job_id, { status: "success", request_id, measurements: measureStepImport(event.result), result: event.result });
        return;
      } else if (event.event === "error") {
        this.#finish(job_id, { status: "error", request_id, error: {
          code: event.code ?? "internal", message: event.message ?? "STEP import failed", field: event.field,
          recovery: event.recovery, preserved_source: event.preserved_source, source_sha256: event.source_sha256,
        } });
        return;
      } else if (event.event === "cancelled") {
        this.#finish(job_id, { status: "cancelled", request_id, cancellation_mode: "worker_restart", code: "cancelled", field: "request_id", recovery: event.recovery ?? "retry the retained STEP source" });
        return;
      }
    }
  }

  #finish(job_id: number, outcome: StepImportOutcome): void {
    const active = this.#active;
    if (!active || active.job_id !== job_id) return;
    this.#active = null;
    active.worker.terminate();
    active.settle(outcome);
  }
}

function defaultWorkerFactory(): StepImportWorker {
  return new Worker(new URL("./step-import.worker.ts", import.meta.url), { type: "module", name: "crawler-step-import" });
}
