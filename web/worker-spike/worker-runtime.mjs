import { PROTOCOL_VERSION } from "./protocol.mjs";

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function event(command, kind, payload = {}) {
  return {
    protocol_version: command.protocol_version,
    request_id: command.request_id,
    document_id: command.document_id,
    document_revision: command.document_revision,
    preview_generation: command.preview_generation,
    event: kind,
    ...payload,
  };
}

function transferables(workerEvent) {
  if (
    workerEvent.event === "error" &&
    workerEvent.preserved_source instanceof Uint8Array
  ) {
    return [workerEvent.preserved_source.buffer];
  }
  if (
    workerEvent.event !== "result" ||
    !["mesh", "extrude_mesh"].includes(workerEvent.result?.kind)
  ) {
    return [];
  }
  return [workerEvent.result.vertices.buffer, workerEvent.result.indices.buffer];
}

/**
 * Worker-only host for the stateful Rust/WASM command adapter.
 *
 * The optional phase delay yields the worker event loop before the synchronous
 * kernel call. That makes cooperative cancellation deterministic at an adapter
 * phase boundary without claiming that JavaScript can interrupt Monstertruck.
 */
export class KernelWorkerRuntime {
  #adapter;
  #acknowledged = new Map();

  constructor(adapter) {
    this.#adapter = adapter;
  }

  acknowledgedState(documentId) {
    return this.#acknowledged.get(documentId);
  }

  async handle(command, emit) {
    try {
      if (
        command.protocol_version === PROTOCOL_VERSION &&
        ["tessellate_reference_cube", "extrude_rectangular_prism", "import_step"].includes(
          command.command,
        ) &&
        (command.phase_delay_ms ?? 0) > 0
      ) {
        emit(event(command, "accepted"), []);
        await sleep(command.phase_delay_ms);
        const phase = command.command === "import_step" ? "parse" : "build";
        const percent = command.command === "import_step" ? 25 : 40;
        emit(event(command, "progress", { phase, percent }), []);
        await sleep(command.phase_delay_ms);

        // A cancel message can run while either delay yields. Rust owns the
        // cancellation set, so dispatching the target consumes and reports it.
        this.#emitEvents(command, emit, { suppressPreface: true });
      } else {
        this.#emitEvents(command, emit);
      }
    } catch (error) {
      emit(
        event(command, "error", {
          code: "internal",
          message: String(error?.message ?? error),
          field: null,
          recovery: "restart the kernel worker and retry the preview",
        }),
        [],
      );
    }
  }

  #emitEvents(command, emit, { suppressPreface = false } = {}) {
    for (const workerEvent of this.#adapter.dispatch(command)) {
      if (
        suppressPreface &&
        (workerEvent.event === "accepted" ||
          (workerEvent.event === "progress" &&
            ["build", "parse"].includes(workerEvent.phase)))
      ) {
        continue;
      }
      if (
        workerEvent.event === "result" &&
        ["reference_cube", "mesh", "extrude_mesh", "step_import"].includes(
          workerEvent.result?.kind,
        )
      ) {
        this.#acknowledged.set(workerEvent.document_id, {
          document_revision: workerEvent.document_revision,
          preview_generation: workerEvent.preview_generation,
          edge: command.edge,
          ...command,
        });
      }
      emit(workerEvent, transferables(workerEvent));
    }
  }
}
