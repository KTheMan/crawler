import { Worker } from "node:worker_threads";

import { commandEnvelope } from "./protocol.mjs";

const workerUrl = new URL("./node-worker-entry.mjs", import.meta.url);
const samples = 25;

function percentile(values, fraction) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)];
}

async function sample(worker, index) {
  const command = commandEnvelope({
    requestId: `measurement-${index}`,
    command: "tessellate_reference_cube",
    edge: 1,
    tolerance: 0.01,
  });
  const serializationStarted = performance.now();
  JSON.stringify(command);
  const serializationTimeMs = performance.now() - serializationStarted;
  const endToEndStarted = performance.now();
  const terminal = await new Promise((resolve, reject) => {
    const onError = (error) => {
      worker.off("message", listener);
      reject(error);
    };
    const listener = (event) => {
      if (event.request_id === command.request_id && event.event === "result") {
        worker.off("message", listener);
        worker.off("error", onError);
        resolve(event);
      }
    };
    worker.on("message", listener);
    worker.once("error", onError);
    worker.postMessage(command);
  });
  return {
    serialization_time_ms: serializationTimeMs,
    kernel_time_ms: terminal.result.kernel_time_ms,
    end_to_end_time_ms: performance.now() - endToEndStarted,
    transferred_bytes: terminal.result.transferred_bytes,
  };
}

async function measureWarm() {
  const worker = new Worker(workerUrl);
  await sample(worker, "warmup");
  const values = [];
  for (let index = 0; index < samples; index += 1) {
    values.push(await sample(worker, `warm-${index}`));
  }
  await worker.terminate();
  return values;
}

async function measureCold() {
  const values = [];
  for (let index = 0; index < samples; index += 1) {
    const worker = new Worker(workerUrl);
    values.push(await sample(worker, `cold-${index}`));
    await worker.terminate();
  }
  return values;
}

function summarize(values) {
  const metrics = ["serialization_time_ms", "kernel_time_ms", "end_to_end_time_ms"];
  return {
    sample_count: values.length,
    transferred_bytes: values[0].transferred_bytes,
    ...Object.fromEntries(
      metrics.flatMap((metric) => [
        [`${metric}_p50`, percentile(values.map((value) => value[metric]), 0.5)],
        [`${metric}_p95`, percentile(values.map((value) => value[metric]), 0.95)],
      ]),
    ),
  };
}

const evidence = {
  runtime: `Node.js ${process.version} worker_threads`,
  device: `${process.platform} ${process.arch}`,
  build_revision: process.env.CRAWLER_BUILD_REVISION ?? "working-tree",
  generated_at: new Date().toISOString(),
  cold: summarize(await measureCold()),
  warm: summarize(await measureWarm()),
};

process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
