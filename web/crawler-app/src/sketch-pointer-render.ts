export type AnimationFrameScheduler = (callback: FrameRequestCallback) => number;
export type AnimationFrameCanceller = (handle: number) => void;

export type LatestPointerFrameWork<Pointer> = {
  pointer?: Pointer;
  invalidations: number;
};

/** Preserve the latest pointer payload while accumulating independent work. */
export function mergeLatestPointerFrameWork<Pointer>(
  previous: LatestPointerFrameWork<Pointer>,
  next: LatestPointerFrameWork<Pointer>,
): LatestPointerFrameWork<Pointer> {
  return {
    pointer: next.pointer ?? previous.pointer,
    invalidations: previous.invalidations | next.invalidations,
  };
}

export type LatestFrameCoordinatorCounters = Readonly<{
  scheduled: number;
  coalesced: number;
  processed: number;
  flushed: number;
  cancelled: number;
}>;

/**
 * Owns at most one animation-frame callback while retaining the newest input.
 * `flush` is synchronous so pointerdown/click can never observe an older hover
 * or snap result than the event that triggered it.
 */
export class LatestFrameCoordinator<T> {
  private latest: T | undefined;
  private handle: number | undefined;
  private countersValue = { scheduled: 0, coalesced: 0, processed: 0, flushed: 0, cancelled: 0 };
  private readonly process: (value: T) => void;
  private readonly scheduleFrame: AnimationFrameScheduler;
  private readonly cancelFrame: AnimationFrameCanceller;
  private readonly merge: (previous: T, next: T) => T;

  constructor(
    process: (value: T) => void,
    scheduleFrame: AnimationFrameScheduler,
    cancelFrame: AnimationFrameCanceller,
    merge: (previous: T, next: T) => T = (_previous, next) => next,
  ) {
    this.process = process;
    this.scheduleFrame = scheduleFrame;
    this.cancelFrame = cancelFrame;
    this.merge = merge;
  }

  schedule(value: T): void {
    this.latest = this.latest === undefined ? value : this.merge(this.latest, value);
    if (this.handle !== undefined) {
      this.countersValue.coalesced += 1;
      return;
    }
    this.countersValue.scheduled += 1;
    this.handle = this.scheduleFrame(() => this.drain());
  }

  flush(): void {
    if (this.handle !== undefined) this.cancelFrame(this.handle);
    if (this.latest !== undefined) this.countersValue.flushed += 1;
    this.drain();
  }

  cancel(): void {
    if (this.handle !== undefined) this.cancelFrame(this.handle);
    if (this.handle !== undefined || this.latest !== undefined) this.countersValue.cancelled += 1;
    this.handle = undefined;
    this.latest = undefined;
  }

  counters(): LatestFrameCoordinatorCounters {
    return { ...this.countersValue };
  }

  private drain(): void {
    this.handle = undefined;
    const value = this.latest;
    this.latest = undefined;
    if (value === undefined) return;
    this.countersValue.processed += 1;
    this.process(value);
  }
}

export type RevisionToken = number;

/**
 * Produces an explicit monotonically increasing token from owned identities and
 * primitive semantic revisions. It intentionally never reads rendered markup.
 */
export class IdentityRevisionTracker {
  private previous?: readonly unknown[];
  private tokenValue = 0;

  resolve(parts: readonly unknown[]): { token: RevisionToken; changed: boolean } {
    const changed = !this.previous
      || this.previous.length !== parts.length
      || parts.some((part, index) => !Object.is(part, this.previous![index]));
    if (changed) {
      this.previous = [...parts];
      this.tokenValue += 1;
    }
    return { token: this.tokenValue, changed };
  }

  invalidate(): void {
    this.previous = undefined;
  }
}

export type SketchPointerRenderCounters = Readonly<{
  fullFrames: number;
  transientFrames: number;
  stablePassesSkipped: number;
  lastStableToken: RevisionToken;
}>;

/** Chooses the safe full-render fallback whenever any stable input changed. */
export class SketchPointerRenderCoordinator {
  private readonly revisions = new IdentityRevisionTracker();
  private countersValue = { fullFrames: 0, transientFrames: 0, stablePassesSkipped: 0, lastStableToken: 0 };

  render(parts: readonly unknown[], full: () => void, transient: () => void): "full" | "transient" {
    const revision = this.revisions.resolve(parts);
    this.countersValue.lastStableToken = revision.token;
    if (revision.changed) {
      this.countersValue.fullFrames += 1;
      full();
      return "full";
    }
    this.countersValue.transientFrames += 1;
    this.countersValue.stablePassesSkipped += 1;
    transient();
    return "transient";
  }

  acceptFullRender(parts: readonly unknown[]): RevisionToken {
    const revision = this.revisions.resolve(parts);
    this.countersValue.lastStableToken = revision.token;
    return revision.token;
  }

  invalidate(): void {
    this.revisions.invalidate();
  }

  counters(): SketchPointerRenderCounters {
    return { ...this.countersValue };
  }
}
