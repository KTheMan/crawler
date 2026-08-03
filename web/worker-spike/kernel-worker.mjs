import { KernelWorkerRuntime } from "./worker-runtime.mjs";
import { createWasmKernelAdapter } from "./wasm-kernel-adapter.mjs";

const runtime = new KernelWorkerRuntime(await createWasmKernelAdapter());
self.postMessage({ event: "worker_ready", protocol_version: 1 });

self.addEventListener("message", ({ data }) => {
  void runtime.handle(data, (event, transferables) => {
    self.postMessage(event, transferables);
  });
});
