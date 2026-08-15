import assert from "node:assert/strict";
import test from "node:test";
import { IdentityRevisionTracker, LatestFrameCoordinator, mergeLatestPointerFrameWork, SketchPointerRenderCoordinator, type LatestPointerFrameWork } from "../src/sketch-pointer-render.ts";

test("latest frame coordinator coalesces to the final pointer and flushes synchronously", () => {
  const callbacks = new Map<number, FrameRequestCallback>();
  const cancelled: number[] = [];
  const processed: number[] = [];
  let next = 0;
  const coordinator = new LatestFrameCoordinator<number>(
    (value) => processed.push(value),
    (callback) => { const id = ++next; callbacks.set(id, callback); return id; },
    (id) => { cancelled.push(id); callbacks.delete(id); },
  );
  coordinator.schedule(1);
  coordinator.schedule(2);
  coordinator.schedule(3);
  assert.equal(callbacks.size, 1);
  coordinator.flush();
  assert.deepEqual(processed, [3]);
  assert.deepEqual(cancelled, [1]);
  assert.deepEqual(coordinator.counters(), { scheduled: 1, coalesced: 2, processed: 1, flushed: 1, cancelled: 0 });
});

test("latest frame coordinator cancellation discards pending work", () => {
  let callback: FrameRequestCallback | undefined;
  let cancelled = 0;
  const processed: string[] = [];
  const coordinator = new LatestFrameCoordinator<string>(
    (value) => processed.push(value),
    (next) => { callback = next; return 7; },
    () => { cancelled += 1; },
  );
  coordinator.schedule("stale");
  coordinator.cancel();
  callback?.(0);
  assert.deepEqual(processed, []);
  assert.equal(cancelled, 1);
});

test("frame scheduling during processing owns a new frame and merged invalidation survives latest-pointer replacement", () => {
  type Work = { pointer: number; stableInvalidated: boolean };
  const callbacks: FrameRequestCallback[] = [];
  const processed: Work[] = [];
  let coordinator: LatestFrameCoordinator<Work>;
  coordinator = new LatestFrameCoordinator<Work>(
    (value) => {
      processed.push(value);
      if (value.pointer === 2) coordinator.schedule({ pointer: 3, stableInvalidated: false });
    },
    (callback) => { callbacks.push(callback); return callbacks.length; },
    () => {},
    (previous, next) => ({ pointer: next.pointer, stableInvalidated: previous.stableInvalidated || next.stableInvalidated }),
  );
  coordinator.schedule({ pointer: 1, stableInvalidated: true });
  coordinator.schedule({ pointer: 2, stableInvalidated: false });
  callbacks.shift()!(0);
  assert.deepEqual(processed, [{ pointer: 2, stableInvalidated: true }]);
  assert.equal(callbacks.length, 1);
  callbacks.shift()!(16);
  assert.deepEqual(processed, [
    { pointer: 2, stableInvalidated: true },
    { pointer: 3, stableInvalidated: false },
  ]);
});

test("pointer work survives view and box invalidations in either scheduling order", () => {
  type Pointer = { x: number };
  const pointerA: LatestPointerFrameWork<Pointer> = { pointer: { x: 4 }, invalidations: 0 };
  const pointerB: LatestPointerFrameWork<Pointer> = { pointer: { x: 9 }, invalidations: 0 };
  const view: LatestPointerFrameWork<Pointer> = { invalidations: 1 };
  const box: LatestPointerFrameWork<Pointer> = { invalidations: 2 };
  assert.deepEqual(mergeLatestPointerFrameWork(mergeLatestPointerFrameWork(pointerA, view), box), {
    pointer: { x: 4 }, invalidations: 3,
  });
  assert.deepEqual(mergeLatestPointerFrameWork(mergeLatestPointerFrameWork(view, pointerA), pointerB), {
    pointer: { x: 9 }, invalidations: 1,
  });
});

test("identity revision tokens change only for owned identity or primitive revisions", () => {
  const tracker = new IdentityRevisionTracker();
  const draft = {};
  assert.deepEqual(tracker.resolve([draft, 1, "selected:a"]), { token: 1, changed: true });
  assert.deepEqual(tracker.resolve([draft, 1, "selected:a"]), { token: 1, changed: false });
  assert.deepEqual(tracker.resolve([draft, 2, "selected:a"]), { token: 2, changed: true });
  tracker.invalidate();
  assert.deepEqual(tracker.resolve([draft, 2, "selected:a"]), { token: 3, changed: true });
});

test("pointer render coordinator skips stable generation until a revision changes", () => {
  const coordinator = new SketchPointerRenderCoordinator();
  const draft = {};
  let stable = 0;
  let transient = 0;
  const render = (parts: readonly unknown[]) => coordinator.render(parts, () => { stable += 1; }, () => { transient += 1; });
  assert.equal(render([draft, "view:1"]), "full");
  assert.equal(render([draft, "view:1"]), "transient");
  assert.equal(render([draft, "view:1"]), "transient");
  assert.equal(render([draft, "view:2"]), "full");
  assert.equal(stable, 2);
  assert.equal(transient, 2);
  assert.deepEqual(coordinator.counters(), { fullFrames: 2, transientFrames: 2, stablePassesSkipped: 2, lastStableToken: 2 });
});
