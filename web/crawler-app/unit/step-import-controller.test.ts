import assert from "node:assert/strict";
import test from "node:test";

import {
  StepImportController,
  measureBodySnapshot,
  type StepImportPayload,
  type StepImportWorker,
} from "../src/step-import-controller.ts";

class FakeWorker implements StepImportWorker {
  onmessage: StepImportWorker["onmessage"] = null;
  onerror: StepImportWorker["onerror"] = null;
  sent: { message: any; transfer?: Transferable[] }[] = [];
  terminated = false;

  postMessage(message: unknown, transfer?: Transferable[]): void { this.sent.push({ message, transfer }); }
  terminate(): void { this.terminated = true; }
  emit(data: unknown): void { this.onmessage?.({ data } as MessageEvent<any>); }
}

function payload(): StepImportPayload {
  return {
    kind: "step_import",
    import_id: "import:cube",
    provenance: {
      source_sha256: "abc123",
      source_bytes: 128,
      settings: { tolerance_nanometers: 10_000 },
      shell_count: 1,
      face_count: 6,
      triangle_count: 12,
    },
    body: {
      body_id: "import:cube:body",
      solid_json: [1, 2, 3, 4],
      evidence: {
        vertex_count: 8,
        edge_count: 12,
        face_count: 6,
        bounds_nm: { min: [0, 0, 0], max: [10_000_000, 20_000_000, 30_000_000] },
        volume_model_units3: 6_000,
        deterministic_digest: "sha256:body",
      },
    },
    render_packet: {
      positions: [], normals: [], triangle_indices: Array(36).fill(0), edge_positions: [], vertex_positions: [],
      face_ranges: [], edge_ranges: [], vertex_pick_tokens: [], pick_table: [],
      bounds: { min: [0, 0, 0], max: [10, 20, 30] },
    },
    transferred_bytes: 456,
    kernel_time_ms: 7.5,
  };
}

function harness() {
  const workers: FakeWorker[] = [];
  const progress: string[] = [];
  const controller = new StepImportController({
    document_id: "document:test",
    document_revision: () => 4,
    preview_generation: () => 2,
    worker_factory: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
    on_progress: (event) => progress.push(`${event.phase}:${event.percent}`),
  });
  return { controller, workers, progress };
}

test("successful import forwards progress and measures provenance plus durable body evidence", async () => {
  const { controller, workers, progress } = harness();
  const result = controller.importStep("import:cube", new Uint8Array([10, 20, 30]), { tolerance_nanometers: 10_000 });
  const worker = workers[0];
  const requestId = worker.sent[0].message.envelope.request_id;
  assert.deepEqual(Array.from(worker.sent[0].message.envelope.source_bytes), [10, 20, 30]);
  assert.equal(worker.sent[0].transfer?.length, 1);

  worker.emit({ kind: "progress", job_id: 1, phase: "worker_start", percent: 0 });
  worker.emit({ kind: "events", job_id: 1, events: [
    { request_id: requestId, event: "progress", phase: "parse", percent: 25 },
    { request_id: requestId, event: "progress", phase: "materialize", percent: 50 },
    { request_id: requestId, event: "result", result: payload() },
  ] });

  const outcome = await result;
  assert.equal(outcome.status, "success");
  if (outcome.status !== "success") return;
  assert.deepEqual(progress, ["worker_start:0", "parse:25", "materialize:50"]);
  assert.equal(outcome.measurements.source_bytes, 128);
  assert.equal(outcome.measurements.transferred_bytes, 456);
  assert.equal(outcome.measurements.snapshot.topology_elements, 26);
  assert.deepEqual(outcome.measurements.snapshot.bounds_span_nm, [10_000_000, 20_000_000, 30_000_000]);
  assert.equal(outcome.measurements.snapshot.finite_positive_volume, true);
  assert.equal(worker.terminated, true);
});

test("cancel terminates blocked worker, ignores stale completion, and re-imports retained bytes", async () => {
  const { controller, workers } = harness();
  const first = controller.importStep("import:retry", new Uint8Array([1, 3, 5, 7]), { tolerance_nanometers: 20_000 });
  const staleWorker = workers[0];
  assert.equal(controller.cancel(), true);
  const cancelled = await first;
  assert.deepEqual(cancelled, {
    status: "cancelled",
    request_id: "step-import:1:import:retry",
    cancellation_mode: "worker_restart",
    code: "cancelled",
    field: "request_id",
    recovery: "retry the retained STEP source when ready",
  });
  assert.equal(staleWorker.terminated, true);
  staleWorker.emit({ kind: "events", job_id: 1, events: [{ request_id: cancelled.request_id, event: "result", result: payload() }] });

  const retry = controller.reimport({ tolerance_nanometers: 30_000 });
  const retryWorker = workers[1];
  assert.deepEqual(Array.from(retryWorker.sent[0].message.envelope.source_bytes), [1, 3, 5, 7]);
  assert.equal(retryWorker.sent[0].message.envelope.settings.tolerance_nanometers, 30_000);
  const requestId = retryWorker.sent[0].message.envelope.request_id;
  retryWorker.emit({ kind: "events", job_id: 2, events: [{ request_id: requestId, event: "result", result: payload() }] });
  assert.equal((await retry).status, "success");
});

test("typed import failure retains source provenance without producing body evidence", async () => {
  const { controller, workers } = harness();
  const pending = controller.importStep("import:bad", new Uint8Array([9, 8]), { tolerance_nanometers: 10_000 });
  const worker = workers[0];
  const requestId = worker.sent[0].message.envelope.request_id;
  worker.emit({ kind: "events", job_id: 1, events: [{
    request_id: requestId,
    event: "error",
    code: "invalid_entity",
    message: "invalid STEP entity",
    field: "source_bytes",
    recovery: "retain the source and review the diagnostic",
    preserved_source: [9, 8],
    source_sha256: "source-hash",
  }] });
  const outcome = await pending;
  assert.equal(outcome.status, "error");
  if (outcome.status === "error") {
    assert.deepEqual(outcome.error.preserved_source, [9, 8]);
    assert.equal(outcome.error.source_sha256, "source-hash");
  }
});

test("body measurement rejects non-finite or empty volume evidence", () => {
  const body = payload().body;
  body.evidence.volume_model_units3 = Number.NaN;
  assert.equal(measureBodySnapshot(body).finite_positive_volume, false);
});
