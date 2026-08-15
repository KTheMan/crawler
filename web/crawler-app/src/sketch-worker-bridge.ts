import type { WorkerResponse } from "./protocol";
import type { Sketch, SketchDecomposition, SketchRuntimeBridge, SketchSolverContract } from "./sketch-editor";

type Pending = { resolve: (value: never) => void; reject: (error: Error) => void; type: string; startedAt: number };

export type SketchBridgePerformanceRecord = {
  requestId: string;
  type: string;
  startedAt: number;
  durationMs: number;
  workerRuntimeMs?: number;
  responseParseMs?: number;
  wasmBoundaryAndSerializeMs?: number;
  enginePhases?: NonNullable<import("./sketch-editor").SketchPreview["runtime_performance"]>;
  outcome: "resolved" | "rejected" | "pending";
};

export class WorkerSketchBridge implements SketchRuntimeBridge {
  readonly transportIsolation = "structured-clone" as const;
  private readonly pending = new Map<string, Pending>();
  private readonly completed: SketchBridgePerformanceRecord[] = [];

  constructor(private readonly worker: Worker) {
    worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
      if (!event.data.type.startsWith("sketch-")) return;
      const response = event.data as Extract<WorkerResponse, { requestId: string }>;
      const pending = this.pending.get(response.requestId);
      if (!pending) return;
      this.pending.delete(response.requestId);
      const workerPerformance = response.type === "sketch-command-preview" ? response.performance : undefined;
      this.completed.push({
        requestId: response.requestId,
        type: pending.type,
        startedAt: pending.startedAt,
        durationMs: performance.now() - pending.startedAt,
        workerRuntimeMs: workerPerformance?.runtimeMs,
        responseParseMs: workerPerformance?.responseParseMs,
        wasmBoundaryAndSerializeMs: workerPerformance?.wasmBoundaryAndSerializeMs,
        enginePhases: workerPerformance?.enginePhases,
        outcome: response.type === "sketch-error" ? "rejected" : "resolved",
      });
      if (this.completed.length > 40) this.completed.splice(0, this.completed.length - 40);
      if (response.type === "sketch-command-preview") pending.resolve(response.preview as never);
      if (response.type === "sketch-error") pending.reject(new Error(response.message));
      if (response.type === "sketch-drag-preview") pending.resolve(response.preview as never);
      if (response.type === "sketch-commit") pending.resolve({ accepted: response.accepted, solve: response.solve } as never);
      if (response.type === "sketch-contract") pending.resolve(response.contract as never);
      if (response.type === "sketch-decomposition") pending.resolve(response.decomposition as never);
      if (response.type === "sketch-dxf-export") pending.resolve(response.dxf as never);
      if (response.type === "sketch-dxf-import") pending.resolve({ sketch: response.sketch, decomposition: response.decomposition } as never);
    });
  }

  applySketchCommand(request: Parameters<SketchRuntimeBridge["applySketchCommand"]>[0]): ReturnType<SketchRuntimeBridge["applySketchCommand"]> {
    return this.dispatch("apply-sketch-command", request) as ReturnType<SketchRuntimeBridge["applySketchCommand"]>;
  }

  applySketchCommands(request: Parameters<SketchRuntimeBridge["applySketchCommands"]>[0]): ReturnType<SketchRuntimeBridge["applySketchCommands"]> {
    return this.dispatch("apply-sketch-commands", { requestJson: JSON.stringify(request) }) as ReturnType<SketchRuntimeBridge["applySketchCommands"]>;
  }

  dragSketch(request: Parameters<SketchRuntimeBridge["dragSketch"]>[0]): ReturnType<SketchRuntimeBridge["dragSketch"]> {
    return this.dispatch("drag-sketch", request) as ReturnType<SketchRuntimeBridge["dragSketch"]>;
  }

  solveSketch(request: Parameters<SketchRuntimeBridge["solveSketch"]>[0]): ReturnType<SketchRuntimeBridge["solveSketch"]> {
    const { transaction_id: transactionId, sketch, support, support_reference: supportReference } = request;
    return this.dispatch("solve-sketch", { transactionId, sketch, support, ...(supportReference ? { supportReference } : {}) }) as ReturnType<SketchRuntimeBridge["solveSketch"]>;
  }

  solverContract(): Promise<SketchSolverContract> {
    return this.dispatch("sketch-contract", {}) as Promise<SketchSolverContract>;
  }

  decompose(sketch: Sketch): Promise<SketchDecomposition> {
    return this.dispatch("decompose-sketch", { sketch }) as Promise<SketchDecomposition>;
  }

  exportDxf(sketch: Sketch): Promise<string> {
    return this.dispatch("export-sketch-dxf", { sketch }) as Promise<string>;
  }

  importDxf(sketchId: string, dxf: string): Promise<{ sketch: Sketch; decomposition: SketchDecomposition }> {
    return this.dispatch("import-sketch-dxf", { sketchId, dxf }) as Promise<{ sketch: Sketch; decomposition: SketchDecomposition }>;
  }

  performanceSnapshot(): readonly SketchBridgePerformanceRecord[] {
    const now = performance.now();
    return [
      ...this.completed.map((record) => ({ ...record })),
      ...[...this.pending].map(([requestId, pending]) => ({
        requestId,
        type: pending.type,
        startedAt: pending.startedAt,
        durationMs: now - pending.startedAt,
        outcome: "pending" as const,
      })),
    ];
  }

  private dispatch(type: string, payload: object): Promise<unknown> {
    const requestId = crypto.randomUUID();
    const startedAt = performance.now();
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve: resolve as Pending["resolve"], reject, type, startedAt });
      this.worker.postMessage({ type, requestId, ...payload });
    });
  }
}
