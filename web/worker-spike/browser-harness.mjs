import { commandEnvelope } from "./protocol.mjs";

const requestedSamples = Number(new URL(location.href).searchParams.get("samples") ?? 25);
const samples = Number.isInteger(requestedSamples) && requestedSamples >= 10
  ? requestedSamples
  : 25;
const workerUrl = new URL("./kernel-worker.mjs", import.meta.url);
const evidenceElement = document.querySelector("#evidence");
document.documentElement.dataset.phase = "starting";
evidenceElement.textContent = "Starting browser worker measurement...";

function percentile(values, fraction) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)];
}

async function createReadyWorker() {
  const worker = new Worker(workerUrl, { type: "module" });
  await new Promise((resolve, reject) => {
    const onMessage = ({ data }) => {
      if (data.event === "worker_ready") {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        resolve();
      }
    };
    const onError = (error) => {
      worker.removeEventListener("message", onMessage);
      reject(error);
    };
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError, { once: true });
  });
  return worker;
}

async function sample(worker, index) {
  const command = commandEnvelope({
    requestId: `browser-measurement-${index}`,
    documentId: "browser-part-document",
    documentRevision: 1,
    previewGeneration: Number.isInteger(index) ? index : 0,
    command: "extrude_rectangular_prism",
    operation_id: "operation-extrude-browser",
    feature_id: "feature-body-browser",
    width_nm: 10_000_000,
    height_nm: 20_000_000,
    distance_nm: 30_000_000,
    tolerance_nm: 10_000,
    boolean_mode: "new_body",
  });
  const serializationStarted = performance.now();
  JSON.stringify(command);
  const serializationTimeMs = performance.now() - serializationStarted;
  const endToEndStarted = performance.now();
  const terminal = await new Promise((resolve, reject) => {
    const onError = (error) => {
      worker.removeEventListener("message", onMessage);
      reject(error);
    };
    const onMessage = ({ data }) => {
      if (data.request_id === command.request_id && data.event === "result") {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        resolve(data);
      } else if (
        data.request_id === command.request_id &&
        (data.event === "error" || data.event === "cancelled")
      ) {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        reject(new Error(`worker measurement failed: ${JSON.stringify(data)}`));
      }
    };
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError, { once: true });
    worker.postMessage(command);
  });
  if (
    terminal.result.kind !== "extrude_mesh" ||
    !(terminal.result.vertices instanceof Float32Array) ||
    !(terminal.result.indices instanceof Uint32Array)
  ) {
    throw new Error("worker returned an unqualified extrusion mesh payload");
  }
  return {
    serialization_time_ms: serializationTimeMs,
    kernel_time_ms: terminal.result.kernel_time_ms,
    end_to_end_time_ms: performance.now() - endToEndStarted,
    transferred_bytes: terminal.result.transferred_bytes,
    bounds_nm: terminal.result.bounds_nm,
    qualification: terminal.result.qualification,
  };
}

async function measureWarm() {
  const worker = await createReadyWorker();
  await sample(worker, "warmup");
  const values = [];
  for (let index = 0; index < samples; index += 1) {
    evidenceElement.textContent = `Measuring warm sample ${index + 1}/${samples}...`;
    values.push(await sample(worker, `warm-${index}`));
  }
  worker.terminate();
  return values;
}

async function measureCold() {
  const values = [];
  for (let index = 0; index < samples; index += 1) {
    evidenceElement.textContent = `Measuring cold sample ${index + 1}/${samples}...`;
    const worker = await createReadyWorker();
    values.push(await sample(worker, `cold-${index}`));
    worker.terminate();
  }
  return values;
}

function summarize(values) {
  const metrics = ["serialization_time_ms", "kernel_time_ms", "end_to_end_time_ms"];
  return {
    sample_count: values.length,
    transferred_bytes: values[0].transferred_bytes,
    bounds_nm: values[0].bounds_nm,
    qualification: values[0].qualification,
    ...Object.fromEntries(
      metrics.flatMap((metric) => [
        [`${metric}_p50`, percentile(values.map((value) => value[metric]), 0.5)],
        [`${metric}_p95`, percentile(values.map((value) => value[metric]), 0.95)],
      ]),
    ),
  };
}

document.documentElement.dataset.phase = "warm";
const warm = summarize(await measureWarm());
document.documentElement.dataset.phase = "cold";
const cold = summarize(await measureCold());
const evidence = {
  browser: navigator.userAgent,
  device: `${navigator.platform}; hardwareConcurrency=${navigator.hardwareConcurrency}`,
  build_revision: "working-tree",
  generated_at: new Date().toISOString(),
  cold,
  warm,
};

evidenceElement.textContent = JSON.stringify(evidence, null, 2);
document.documentElement.dataset.complete = "true";
