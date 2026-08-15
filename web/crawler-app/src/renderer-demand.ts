type RequestFrame = (callback: FrameRequestCallback) => number;
type CancelFrame = (handle: number) => void;

/**
 * Coalesces invalidations into a single browser frame and only keeps ticking
 * while an animation or interaction reports that it needs another frame.
 */
export class DemandRenderScheduler {
  private frameId: number | undefined;
  private disposed = false;
  private readonly draw: () => void;
  private readonly shouldContinue: () => boolean;
  private readonly requestFrame: RequestFrame;
  private readonly cancelFrame: CancelFrame;

  constructor(
    draw: () => void,
    shouldContinue: () => boolean,
    requestFrame: RequestFrame = (callback) => requestAnimationFrame(callback),
    cancelFrame: CancelFrame = (handle) => cancelAnimationFrame(handle),
  ) {
    this.draw = draw;
    this.shouldContinue = shouldContinue;
    this.requestFrame = requestFrame;
    this.cancelFrame = cancelFrame;
  }

  invalidate(): void {
    if (this.disposed || this.frameId !== undefined) return;
    this.frameId = this.requestFrame(this.onFrame);
  }

  dispose(): void {
    this.disposed = true;
    if (this.frameId !== undefined) this.cancelFrame(this.frameId);
    this.frameId = undefined;
  }

  private readonly onFrame: FrameRequestCallback = () => {
    if (this.disposed) return;
    this.frameId = undefined;
    this.draw();
    if (this.shouldContinue()) this.invalidate();
  };
}
