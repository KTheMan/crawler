import {
  PROTOCOL_VERSION,
  StaleResultGate,
  commandEnvelope,
  commandTransferables,
} from "./protocol.mjs";

const terminalEvents = new Set(["result", "cancelled", "error"]);

export class KernelWorkerClient {
  #workerUrl;
  #workerFactory;
  #worker;
  #gate = new StaleResultGate();
  #pending = new Map();
  #acknowledged = new Map();
  #listeners = new Set();
  #nextRequest = 0;

  constructor(workerUrl, workerFactory = (url) => new Worker(url, { type: "module" })) {
    this.#workerUrl = workerUrl;
    this.#workerFactory = workerFactory;
    this.#worker = this.#createWorker();
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  request(command) {
    this.#gate.noteRequest(command);
    return new Promise((resolve, reject) => {
      const retainedCommand =
        command.command === "import_step" && command.source_bytes instanceof Uint8Array
          ? { ...command, source_bytes: command.source_bytes.slice() }
          : command;
      this.#pending.set(command.request_id, {
        command: retainedCommand,
        resolve,
        reject,
      });
      this.#worker.postMessage(command, commandTransferables(command));
    });
  }

  async cancel(requestId, restartAfterMs = 250) {
    const pending = this.#pending.get(requestId);
    if (!pending) {
      return false;
    }
    const cancel = commandEnvelope({
      requestId: `cancel-${++this.#nextRequest}`,
      documentId: pending.command.document_id,
      documentRevision: pending.command.document_revision,
      previewGeneration: pending.command.preview_generation,
      command: "cancel",
      target_request_id: requestId,
    });
    this.#worker.postMessage(cancel);
    await new Promise((resolve) => setTimeout(resolve, restartAfterMs));
    if (this.#pending.has(requestId)) {
      this.#restartBlockedWorker(pending.command);
    }
    return true;
  }

  terminate() {
    this.#worker.terminate();
  }

  #createWorker() {
    const worker = this.#workerFactory(this.#workerUrl);
    worker.addEventListener("message", ({ data }) => this.#receive(data));
    worker.addEventListener("error", (error) => {
      this.#pending.forEach(({ reject }) => reject(error));
      this.#pending.clear();
    });
    return worker;
  }

  #receive(event) {
    if (!this.#gate.accepts(event)) {
      this.#listeners.forEach((listener) => listener(event, { discarded: true }));
      return;
    }
    this.#listeners.forEach((listener) => listener(event, { discarded: false }));
    if (!terminalEvents.has(event.event)) {
      return;
    }
    const pending = this.#pending.get(event.request_id);
    if (!pending) {
      return;
    }
    if (event.event === "result") {
      if (
        ["reference_cube", "mesh", "extrude_mesh", "step_import"].includes(
          event.result.kind,
        )
      ) {
        this.#acknowledged.set(event.document_id, {
          ...pending.command,
          edge: pending.command.edge,
        });
      }
      pending.resolve(event);
    } else {
      pending.reject(event);
    }
    this.#pending.delete(event.request_id);
  }

  #restartBlockedWorker(command) {
    this.#worker.terminate();
    this.#worker = this.#createWorker();
    const pending = this.#pending.get(command.request_id);
    const cancelled = {
      protocol_version: PROTOCOL_VERSION,
      request_id: command.request_id,
      document_id: command.document_id,
      document_revision: command.document_revision,
      preview_generation: command.preview_generation,
      event: "cancelled",
      cancellation_mode: "worker_restart",
      code: "cancelled",
      field: "request_id",
      recovery: "retry the newest preview after worker state restoration",
    };
    this.#listeners.forEach((listener) => listener(cancelled, { discarded: false }));
    pending?.reject(cancelled);
    this.#pending.delete(command.request_id);
    this.#acknowledged.forEach((state) => {
      const shared = {
        requestId: `restore-${++this.#nextRequest}`,
        documentId: state.document_id,
        documentRevision: state.document_revision,
        previewGeneration: state.preview_generation,
      };
      const restore = state.command === "extrude_rectangular_prism"
        ? commandEnvelope({
            ...shared,
            command: state.command,
            operation_id: state.operation_id,
            feature_id: state.feature_id,
            width_nm: state.width_nm,
            height_nm: state.height_nm,
            distance_nm: state.distance_nm,
            tolerance_nm: state.tolerance_nm,
            boolean_mode: state.boolean_mode,
            phase_delay_ms: 0,
          })
        : state.command === "import_step"
          ? commandEnvelope({
              ...shared,
              command: state.command,
              import_id: state.import_id,
              source_bytes: state.source_bytes.slice(),
              settings: state.settings,
              phase_delay_ms: 0,
            })
          : commandEnvelope({
            ...shared,
            command: "build_reference_cube",
            edge: state.edge,
          });
      this.#worker.postMessage(restore, commandTransferables(restore));
    });
  }
}
