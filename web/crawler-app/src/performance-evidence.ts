export interface PerformanceEvidenceSnapshot {
  schemaVersion: 1;
  capturedAt: string;
  userAgent: string;
  devicePixelRatio: number;
  reducedMotion: boolean;
  timingsMs: Record<string, number>;
  summariesMs: Record<string, { count: number; p50: number; p95: number; max: number }>;
  budgets: { passed: boolean; violations: string[]; thresholdsMs: Record<string, number> };
  resources: { workerTransferBytes: number; wasmBytes: number; memorySupported: boolean; heapUsedBytes?: number };
}

export class PerformanceEvidence {
  private readonly started = performance.now();
  private readonly timings = new Map<string, number>();
  private readonly samples = new Map<string, number[]>();
  private recomputeStarted = 0;
  private transferBytes = 0;
  private longestMainThreadTask = 0;
  private referenceWorkflowStarted?: number;

  constructor() {
    if (typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes.includes("longtask")) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (this.referenceWorkflowStarted !== undefined && entry.startTime >= this.referenceWorkflowStarted) {
            this.longestMainThreadTask = Math.max(this.longestMainThreadTask, entry.duration);
          }
        }
      }).observe({ entryTypes: ["longtask"] });
    }
  }

  mark(name: string): void { if (!this.timings.has(name)) this.timings.set(name, Number((performance.now() - this.started).toFixed(2))); }
  record(name: string, value: number): void {
    const measured = Number(Math.max(0, value).toFixed(2));
    this.timings.set(name, measured);
    const samples = this.samples.get(name) ?? [];
    samples.push(measured);
    this.samples.set(name, samples);
  }
  beginRecompute(): void { this.recomputeStarted = performance.now(); }
  finishRecompute(): void { if (this.recomputeStarted) this.record("recompute", performance.now() - this.recomputeStarted); }
  setTransferBytes(value: number): void { this.transferBytes = value; }
  beginReferenceWorkflow(): void {
    if (this.referenceWorkflowStarted !== undefined) return;
    this.referenceWorkflowStarted = performance.now();
    this.longestMainThreadTask = 0;
  }

  async sampleFrames(count = 8): Promise<void> {
    const samples: number[] = [];
    const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
    let previous = await nextFrame();
    for (let index = 0; index < count; index += 1) {
      const now = await nextFrame(); samples.push(now - previous); previous = now;
    }
    samples.sort((a, b) => a - b);
    for (const sample of samples) this.record("frameInterval", sample);
    this.timings.set("frameMedian", Number(samples[Math.floor(samples.length / 2)].toFixed(2)));
  }

  snapshot(): PerformanceEvidenceSnapshot {
    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const wasmBytes = resources.filter((entry) => entry.name.endsWith(".wasm")).reduce((sum, entry) => sum + (entry.transferSize || entry.decodedBodySize), 0);
    const memory = performance as Performance & { memory?: { usedJSHeapSize: number } };
    this.timings.set("longTaskMax", Number(this.longestMainThreadTask.toFixed(2)));
    const summariesMs = Object.fromEntries([...this.samples].map(([name, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const percentile = (percent: number) => sorted[Math.max(0, Math.ceil(sorted.length * percent) - 1)] ?? 0;
      return [name, { count: sorted.length, p50: percentile(0.5), p95: percentile(0.95), max: sorted.at(-1) ?? 0 }];
    }));
    // The automated headless harness allows 18 ms to absorb display/vsync
    // cadence variance. The representative-device 60 fps gate remains a
    // separate recorded qualification run.
    const thresholdsMs = { input: 50, preview: 100, recomputeP50: 500, recomputeP95: 2_000, load: 5_000, frameP50: 18, longTaskMax: 100 };
    const violations: string[] = [];
    const timing = Object.fromEntries(this.timings);
    const requireAtMost = (label: string, value: number | undefined, limit: number) => {
      if (value !== undefined && value > limit) violations.push(`${label} ${value.toFixed(2)} ms exceeds ${limit.toFixed(2)} ms`);
    };
    requireAtMost("input", timing.input, thresholdsMs.input);
    requireAtMost("preview", timing.preview, thresholdsMs.preview);
    requireAtMost("load", timing.load, thresholdsMs.load);
    requireAtMost("recompute p50", summariesMs.recompute?.p50, thresholdsMs.recomputeP50);
    requireAtMost("recompute p95", summariesMs.recompute?.p95, thresholdsMs.recomputeP95);
    requireAtMost("frame p50", summariesMs.frameInterval?.p50, thresholdsMs.frameP50);
    requireAtMost("main-thread long task", timing.longTaskMax, thresholdsMs.longTaskMax);
    return {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      devicePixelRatio,
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      timingsMs: timing,
      summariesMs,
      budgets: { passed: violations.length === 0, violations, thresholdsMs },
      resources: { workerTransferBytes: this.transferBytes, wasmBytes, memorySupported: Boolean(memory.memory), ...(memory.memory ? { heapUsedBytes: memory.memory.usedJSHeapSize } : {}) },
    };
  }
}
