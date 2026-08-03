import { readFile } from "node:fs/promises";
import { parentPort } from "node:worker_threads";

import { KernelWorkerRuntime } from "./worker-runtime.mjs";
import { createWasmKernelAdapter } from "./wasm-kernel-adapter.mjs";

const wasm = await readFile(
  new URL("./generated/crawler_kernel_worker_bg.wasm", import.meta.url),
);
const runtime = new KernelWorkerRuntime(await createWasmKernelAdapter(wasm));

parentPort.on("message", (command) => {
  void runtime.handle(command, (event, transferables) => {
    parentPort.postMessage(event, transferables);
  });
});
