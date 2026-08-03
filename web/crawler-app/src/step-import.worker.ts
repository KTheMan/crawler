/// <reference lib="webworker" />

import initKernel, { WasmKernelAdapter } from "./generated/kernel/crawler_kernel_worker.js";

interface StartMessage {
  kind: "start";
  job_id: number;
  envelope: Record<string, unknown> & { source_bytes: Uint8Array };
}

const scope = self as DedicatedWorkerGlobalScope;

scope.onmessage = async (event: MessageEvent<StartMessage>) => {
  if (event.data.kind !== "start") return;
  const { job_id, envelope } = event.data;
  try {
    scope.postMessage({ kind: "progress", job_id, phase: "worker_start", percent: 0 });
    await initKernel();
    scope.postMessage({ kind: "progress", job_id, phase: "kernel_ready", percent: 5 });
    const delay = Number(envelope.phase_delay_ms ?? 0);
    if (Number.isFinite(delay) && delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    const adapter = new WasmKernelAdapter();
    const command = { ...envelope, source_bytes: Array.from(envelope.source_bytes) };
    const events = JSON.parse(adapter.dispatchJson(JSON.stringify(command))) as unknown[];
    adapter.free();
    scope.postMessage({ kind: "events", job_id, events });
  } catch (error) {
    scope.postMessage({ kind: "fatal", job_id, message: error instanceof Error ? error.message : String(error) });
  }
};
