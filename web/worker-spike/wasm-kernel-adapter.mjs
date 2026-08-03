import init, {
  WasmKernelAdapter,
} from "./generated/crawler_kernel_worker.js";

const wasmUrl = new URL(
  "./generated/crawler_kernel_worker_bg.wasm",
  import.meta.url,
);

function toTransferableMesh(event) {
  if (event.event === "error" && Array.isArray(event.preserved_source)) {
    event.preserved_source = new Uint8Array(event.preserved_source);
    return event;
  }
  if (
    event.event !== "result" ||
    !["mesh", "extrude_mesh"].includes(event.result?.kind)
  ) {
    return event;
  }
  event.result.vertices = new Float32Array(event.result.vertices);
  event.result.indices = new Uint32Array(event.result.indices);
  return event;
}

/**
 * Loads the dev-generated Crawler binding and owns one stateful Rust adapter.
 * `wasmInput` is used by Node tests because Node cannot fetch a file URL.
 */
export async function createWasmKernelAdapter(wasmInput = wasmUrl) {
  await init({ module_or_path: wasmInput });
  const adapter = new WasmKernelAdapter();

  return {
    dispatch(command) {
      const serializable =
        command.command === "import_step" &&
        command.source_bytes instanceof Uint8Array
          ? { ...command, source_bytes: Array.from(command.source_bytes) }
          : command;
      const events = JSON.parse(adapter.dispatchJson(JSON.stringify(serializable)));
      return events.map(toTransferableMesh);
    },

    dispose() {
      adapter.free();
    },
  };
}
