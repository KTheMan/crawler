import type { WorkerResponse } from "./protocol";
import type { SketchRuntimeBridge } from "./sketch-editor";

type Pending = { resolve: (value: never) => void; reject: (error: Error) => void };

export class WorkerSketchBridge implements SketchRuntimeBridge {
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly worker: Worker) {
    worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
      if (!event.data.type.startsWith("sketch-")) return;
      const response = event.data as Extract<WorkerResponse, { requestId: string }>;
      const pending = this.pending.get(response.requestId);
      if (!pending) return;
      this.pending.delete(response.requestId);
      if (response.type === "sketch-command-preview") pending.resolve(response.preview as never);
      if (response.type === "sketch-drag-preview") pending.resolve(response.preview as never);
      if (response.type === "sketch-commit") pending.resolve({ accepted: response.accepted, solve: response.solve } as never);
    });
  }

  applySketchCommand(request: Parameters<SketchRuntimeBridge["applySketchCommand"]>[0]): ReturnType<SketchRuntimeBridge["applySketchCommand"]> {
    return this.dispatch("apply-sketch-command", request) as ReturnType<SketchRuntimeBridge["applySketchCommand"]>;
  }

  dragSketch(request: Parameters<SketchRuntimeBridge["dragSketch"]>[0]): ReturnType<SketchRuntimeBridge["dragSketch"]> {
    return this.dispatch("drag-sketch", request) as ReturnType<SketchRuntimeBridge["dragSketch"]>;
  }

  solveSketch(request: Parameters<SketchRuntimeBridge["solveSketch"]>[0]): ReturnType<SketchRuntimeBridge["solveSketch"]> {
    const { transaction_id: transactionId, sketch, support } = request;
    return this.dispatch("solve-sketch", { transactionId, sketch, support }) as ReturnType<SketchRuntimeBridge["solveSketch"]>;
  }

  private dispatch(type: string, payload: object): Promise<unknown> {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve: resolve as Pending["resolve"], reject });
      this.worker.postMessage({ type, requestId, ...payload });
    });
  }
}
