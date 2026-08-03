import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Worker } from "node:worker_threads";

import {
  commandEnvelope,
  commandTransferables,
  StaleResultGate,
} from "./protocol.mjs";
import { KernelWorkerRuntime } from "./worker-runtime.mjs";
import { createWasmKernelAdapter } from "./wasm-kernel-adapter.mjs";

const workerUrl = new URL("./node-worker-entry.mjs", import.meta.url);
const wasmUrl = new URL(
  "./generated/crawler_kernel_worker_bg.wasm",
  import.meta.url,
);
const stepCubeUrl = new URL(
  "../../fixtures/reference-models/step-roundtrip-cube/samples/cube-brep.step",
  import.meta.url,
);
const crawlerCsgStepCubeUrl = new URL(
  "../../fixtures/reference-models/step-roundtrip-cube/samples/cube-import.step",
  import.meta.url,
);

function collectWorkerEvents(command) {
  const worker = new Worker(workerUrl);
  return new Promise((resolve, reject) => {
    const events = [];
    worker.on("error", reject);
    worker.on("message", (event) => {
      events.push(event);
      if (["result", "cancelled", "error"].includes(event.event)) {
        void worker.terminate();
        resolve(events);
      }
    });
    worker.postMessage(command, commandTransferables(command));
  });
}

function stepCommand({
  requestId,
  sourceBytes,
  documentId = "step-document",
  documentRevision = 1,
  previewGeneration = 0,
  phaseDelayMs = 0,
}) {
  return commandEnvelope({
    requestId,
    documentId,
    documentRevision,
    previewGeneration,
    command: "import_step",
    import_id: "import-step-1",
    source_bytes: sourceBytes,
    settings: { tolerance_nanometers: 10_000 },
    phase_delay_ms: phaseDelayMs,
  });
}

async function createRuntime() {
  const bytes = await readFile(wasmUrl);
  return new KernelWorkerRuntime(await createWasmKernelAdapter(bytes));
}

function extrudeCommand({
  requestId,
  documentId = "part-document",
  documentRevision = 1,
  previewGeneration = 0,
  widthNm = 10_000_000,
  heightNm = 20_000_000,
  distanceNm = 30_000_000,
  booleanMode = "new_body",
  phaseDelayMs = 0,
}) {
  return commandEnvelope({
    requestId,
    documentId,
    documentRevision,
    previewGeneration,
    command: "extrude_rectangular_prism",
    operation_id: "operation-extrude-1",
    feature_id: "feature-body-1",
    width_nm: widthNm,
    height_nm: heightNm,
    distance_nm: distanceNm,
    tolerance_nm: 10_000,
    boolean_mode: booleanMode,
    phase_delay_ms: phaseDelayMs,
  });
}

function positionBounds(vertices, stride = 8) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let offset = 0; offset < vertices.length; offset += stride) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], vertices[offset + axis]);
      max[axis] = Math.max(max[axis], vertices[offset + axis]);
    }
  }
  return { min, max };
}

test("an unknown protocol version fails closed with a typed Rust error", async () => {
  const command = commandEnvelope({ requestId: "bad-version", command: "health" });
  command.protocol_version = 99;
  const events = await collectWorkerEvents(command);

  assert.equal(events.length, 1);
  assert.equal(events[0].event, "error");
  assert.equal(events[0].code, "incompatible_protocol");
  assert.equal(events[0].expected_protocol_version, 1);
});

test("invalid geometry input returns a structured Rust command error", async () => {
  const events = await collectWorkerEvents(
    commandEnvelope({
      requestId: "invalid-edge",
      command: "build_reference_cube",
      edge: -1,
    }),
  );

  assert.equal(events.at(-1).event, "error");
  assert.equal(events.at(-1).code, "invalid_command");
  assert.match(events.at(-1).message, /edge must be finite/);
});

test("Monstertruck mesh buffers cross an actual worker boundary as typed arrays", async () => {
  const command = commandEnvelope({
    requestId: "mesh",
    command: "tessellate_reference_cube",
    edge: 1,
    tolerance: 0.01,
  });
  const events = await collectWorkerEvents(command);
  const terminal = events.at(-1);
  assert.equal(
    terminal.event,
    "result",
    `expected a mesh result; received ${JSON.stringify(terminal)}`,
  );
  const result = terminal.result;

  assert.equal(result.kind, "mesh");
  assert.equal(result.vertices.constructor, Float32Array);
  assert.equal(result.indices.constructor, Uint32Array);
  assert.ok(result.vertices.length > 0);
  assert.ok(result.indices.length > 0);
  assert.equal(
    result.transferred_bytes,
    result.vertices.byteLength + result.indices.byteLength,
  );
});

test("cancellation is observed between yielded phases without acknowledging state", async () => {
  const runtime = await createRuntime();
  const command = commandEnvelope({
    requestId: "slow",
    documentId: "cancelled-document",
    command: "tessellate_reference_cube",
    edge: 1,
    tolerance: 0.01,
    phase_delay_ms: 20,
  });
  const cancel = commandEnvelope({
    requestId: "cancel-slow",
    documentId: "cancelled-document",
    command: "cancel",
    target_request_id: "slow",
  });
  const events = [];
  const execution = runtime.handle(command, (event) => events.push(event));
  await new Promise((resolve) => setTimeout(resolve, 25));
  await runtime.handle(cancel, () => {});
  await execution;

  assert.equal(events.at(-1).event, "cancelled");
  assert.equal(events.at(-1).cancellation_mode, "cooperative");
  assert.equal(runtime.acknowledgedState("cancelled-document"), undefined);
});

test("edited exact extrusion dimensions change real WASM mesh bounds", async () => {
  const first = await collectWorkerEvents(
    extrudeCommand({ requestId: "extrude-first" }),
  );
  const edited = await collectWorkerEvents(
    extrudeCommand({
      requestId: "extrude-edited",
      previewGeneration: 1,
      widthNm: 15_000_000,
    }),
  );
  const firstResult = first.at(-1).result;
  const editedResult = edited.at(-1).result;

  assert.equal(firstResult.kind, "extrude_mesh");
  assert.equal(firstResult.vertices.constructor, Float32Array);
  assert.equal(firstResult.indices.constructor, Uint32Array);
  assert.deepEqual(firstResult.bounds_nm.max, [10_000_000, 20_000_000, 30_000_000]);
  assert.deepEqual(editedResult.bounds_nm.max, [15_000_000, 20_000_000, 30_000_000]);
  assert.deepEqual(positionBounds(firstResult.vertices).max, [10, 20, 30]);
  assert.deepEqual(positionBounds(editedResult.vertices).max, [15, 20, 30]);
  assert.equal(firstResult.qualification.vertex_stride_f32, 8);
  assert.equal(
    firstResult.transferred_bytes,
    firstResult.vertices.byteLength + firstResult.indices.byteLength,
  );
});

test("invalid and boolean-like WASM failures preserve acknowledged operation state", async () => {
  const runtime = await createRuntime();
  const validEvents = [];
  await runtime.handle(
    extrudeCommand({ requestId: "valid-extrude" }),
    (event) => validEvents.push(event),
  );
  const acknowledged = structuredClone(runtime.acknowledgedState("part-document"));
  assert.equal(validEvents.at(-1).result.kind, "extrude_mesh");

  const invalidEvents = [];
  await runtime.handle(
    extrudeCommand({ requestId: "invalid-extrude", widthNm: 0 }),
    (event) => invalidEvents.push(event),
  );
  assert.equal(invalidEvents.at(-1).code, "invalid_input");
  assert.equal(invalidEvents.at(-1).field, "width_nm");
  assert.ok(invalidEvents.at(-1).recovery);

  const unsupportedEvents = [];
  await runtime.handle(
    extrudeCommand({ requestId: "join-extrude", booleanMode: "join" }),
    (event) => unsupportedEvents.push(event),
  );
  assert.equal(unsupportedEvents.at(-1).code, "unsupported_operation");
  assert.equal(unsupportedEvents.at(-1).field, "boolean_mode");

  const numericalEvents = [];
  await runtime.handle(
    extrudeCommand({
      requestId: "oversized-extrude",
      widthNm: 9_007_199_254_740_992,
    }),
    (event) => numericalEvents.push(event),
  );
  assert.equal(numericalEvents.at(-1).code, "numerical_failure");
  assert.equal(numericalEvents.at(-1).field, "width_nm");
  assert.ok(numericalEvents.at(-1).recovery);
  assert.deepEqual(runtime.acknowledgedState("part-document"), acknowledged);
});

test("extrusion preview cancellation leaves operation state unacknowledged", async () => {
  const runtime = await createRuntime();
  const command = extrudeCommand({
    requestId: "slow-extrude",
    documentId: "cancelled-part",
    phaseDelayMs: 20,
  });
  const cancel = commandEnvelope({
    requestId: "cancel-slow-extrude",
    documentId: "cancelled-part",
    documentRevision: 1,
    command: "cancel",
    target_request_id: "slow-extrude",
  });
  const events = [];
  const execution = runtime.handle(command, (event) => events.push(event));
  await new Promise((resolve) => setTimeout(resolve, 25));
  await runtime.handle(cancel, () => {});
  await execution;

  assert.equal(events.at(-1).event, "cancelled");
  assert.equal(runtime.acknowledgedState("cancelled-part"), undefined);
});

test("an actual delayed older extrusion preview is rejected after a newer preview", async () => {
  const worker = new Worker(workerUrl);
  const gate = new StaleResultGate();
  const older = extrudeCommand({
    requestId: "older",
    documentRevision: 7,
    previewGeneration: 2,
    widthNm: 10_000_000,
    phaseDelayMs: 25,
  });
  const newer = extrudeCommand({
    requestId: "newer",
    documentRevision: 7,
    previewGeneration: 3,
    widthNm: 15_000_000,
  });
  gate.noteRequest(older);
  gate.noteRequest(newer);

  const accepted = [];
  await new Promise((resolve, reject) => {
    const completed = new Set();
    worker.on("error", reject);
    worker.on("message", (event) => {
      if (!["result", "cancelled", "error"].includes(event.event)) {
        return;
      }
      accepted.push({
        requestId: event.request_id,
        accepted: gate.accepts(event),
        terminal: event.event,
      });
      completed.add(event.request_id);
      if (completed.size === 2) {
        resolve();
      }
    });
    worker.postMessage(older);
    worker.postMessage(newer);
  });
  await worker.terminate();

  assert.deepEqual(accepted, [
    { requestId: "newer", accepted: true, terminal: "result" },
    { requestId: "older", accepted: false, terminal: "result" },
  ]);
});

test("checked-in STEP cube bytes transfer through real WASM with provenance", async () => {
  const sourceBytes = new Uint8Array(await readFile(stepCubeUrl));
  const expectedLength = sourceBytes.byteLength;
  const command = stepCommand({ requestId: "step-cube", sourceBytes });
  const eventsPromise = collectWorkerEvents(command);
  assert.equal(sourceBytes.byteLength, 0, "source ArrayBuffer ownership must transfer");
  const events = await eventsPromise;
  const terminal = events.at(-1);

  assert.deepEqual(
    events.map((event) => [event.event, event.phase ?? null]),
    [
      ["accepted", null],
      ["progress", "parse"],
      ["progress", "materialize"],
      ["result", null],
    ],
  );
  assert.equal(terminal.event, "result", JSON.stringify(terminal));
  assert.equal(terminal.result.kind, "step_import");
  assert.equal(terminal.result.import_id, "import-step-1");
  assert.equal(terminal.result.provenance.source_bytes, expectedLength);
  assert.equal(terminal.result.provenance.settings.tolerance_nanometers, 10_000);
  assert.equal(terminal.result.provenance.shell_count, 1);
  assert.equal(terminal.result.provenance.face_count, 6);
  assert.ok(terminal.result.provenance.triangle_count >= 12);
  assert.match(terminal.result.provenance.source_sha256, /^[0-9a-f]{64}$/);
});

test("invalid STEP returns diagnosed source bytes and never acknowledges", async () => {
  const runtime = await createRuntime();
  const sourceBytes = new TextEncoder().encode(
    "ISO-10303-21;\nDATA;\n#broken\nENDSEC;\nEND-ISO-10303-21;\n",
  );
  const expected = sourceBytes.slice();
  const events = [];
  await runtime.handle(
    stepCommand({ requestId: "step-invalid", sourceBytes }),
    (event) => events.push(event),
  );
  const terminal = events.at(-1);

  assert.equal(terminal.event, "error");
  assert.equal(terminal.code, "invalid_entity");
  assert.equal(terminal.preserved_source.constructor, Uint8Array);
  assert.deepEqual(terminal.preserved_source, expected);
  assert.match(terminal.source_sha256, /^[0-9a-f]{64}$/);
  assert.equal(runtime.acknowledgedState("step-document"), undefined);
});

test("Crawler CSG STEP compatibility fixture fails closed as unsupported", async () => {
  const sourceBytes = new Uint8Array(await readFile(crawlerCsgStepCubeUrl));
  const expected = sourceBytes.slice();
  const events = await collectWorkerEvents(
    stepCommand({ requestId: "step-csg", sourceBytes }),
  );
  const terminal = events.at(-1);

  assert.equal(terminal.event, "error");
  assert.equal(terminal.code, "unsupported_import");
  assert.equal(terminal.preserved_source.constructor, Uint8Array);
  assert.deepEqual(terminal.preserved_source, expected);
  assert.match(terminal.source_sha256, /^[0-9a-f]{64}$/);
});

test("STEP cancellation at a yielded phase leaves import unacknowledged", async () => {
  const runtime = await createRuntime();
  const sourceBytes = new Uint8Array(await readFile(stepCubeUrl));
  const command = stepCommand({
    requestId: "step-slow",
    documentId: "step-cancelled",
    sourceBytes,
    phaseDelayMs: 20,
  });
  const cancel = commandEnvelope({
    requestId: "cancel-step-slow",
    documentId: "step-cancelled",
    documentRevision: 1,
    command: "cancel",
    target_request_id: "step-slow",
  });
  const events = [];
  const execution = runtime.handle(command, (event) => events.push(event));
  await new Promise((resolve) => setTimeout(resolve, 25));
  await runtime.handle(cancel, () => {});
  await execution;

  assert.equal(events.at(-1).event, "cancelled");
  assert.equal(runtime.acknowledgedState("step-cancelled"), undefined);
});

test("newer STEP generation gates a delayed stale result", async () => {
  const worker = new Worker(workerUrl);
  const gate = new StaleResultGate();
  const fixture = new Uint8Array(await readFile(stepCubeUrl));
  const older = stepCommand({
    requestId: "step-older",
    sourceBytes: fixture.slice(),
    documentRevision: 9,
    previewGeneration: 4,
    phaseDelayMs: 25,
  });
  const newer = stepCommand({
    requestId: "step-newer",
    sourceBytes: fixture.slice(),
    documentRevision: 9,
    previewGeneration: 5,
  });
  gate.noteRequest(older);
  gate.noteRequest(newer);

  const accepted = [];
  await new Promise((resolve, reject) => {
    const completed = new Set();
    worker.on("error", reject);
    worker.on("message", (event) => {
      if (!["result", "cancelled", "error"].includes(event.event)) return;
      accepted.push({
        requestId: event.request_id,
        accepted: gate.accepts(event),
        terminal: event.event,
      });
      completed.add(event.request_id);
      if (completed.size === 2) resolve();
    });
    worker.postMessage(older, commandTransferables(older));
    worker.postMessage(newer, commandTransferables(newer));
  });
  await worker.terminate();

  assert.deepEqual(accepted, [
    { requestId: "step-newer", accepted: true, terminal: "result" },
    { requestId: "step-older", accepted: false, terminal: "result" },
  ]);
});
