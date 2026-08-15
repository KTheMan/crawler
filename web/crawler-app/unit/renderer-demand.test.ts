import assert from "node:assert/strict";
import test from "node:test";

import { DemandRenderScheduler } from "../src/renderer-demand.ts";

type PendingFrame = { id: number; callback: FrameRequestCallback };

function controlledFrames() {
  let nextId = 1;
  const pending: PendingFrame[] = [];
  const cancelled: number[] = [];
  return {
    pending,
    cancelled,
    request(callback: FrameRequestCallback): number {
      const id = nextId++;
      pending.push({ id, callback });
      return id;
    },
    cancel(id: number): void {
      cancelled.push(id);
      const index = pending.findIndex((frame) => frame.id === id);
      if (index >= 0) pending.splice(index, 1);
    },
    flushOne(): void {
      const frame = pending.shift();
      assert.ok(frame, "expected a pending animation frame");
      frame.callback(0);
    },
  };
}

test("demand renderer coalesces repeated invalidations into one frame", () => {
  const frames = controlledFrames();
  let draws = 0;
  const scheduler = new DemandRenderScheduler(
    () => { draws += 1; },
    () => false,
    (callback) => frames.request(callback),
    (id) => frames.cancel(id),
  );

  scheduler.invalidate();
  scheduler.invalidate();
  scheduler.invalidate();

  assert.equal(frames.pending.length, 1);
  assert.equal(draws, 0);
  frames.flushOne();
  assert.equal(draws, 1);
  assert.equal(frames.pending.length, 0);
});

test("demand renderer continues only while active work requests frames", () => {
  const frames = controlledFrames();
  let active = true;
  let draws = 0;
  const scheduler = new DemandRenderScheduler(
    () => { draws += 1; },
    () => active,
    (callback) => frames.request(callback),
    (id) => frames.cancel(id),
  );

  scheduler.invalidate();
  frames.flushOne();
  assert.equal(draws, 1);
  assert.equal(frames.pending.length, 1);

  active = false;
  frames.flushOne();
  assert.equal(draws, 2);
  assert.equal(frames.pending.length, 0);
});

test("invalidations raised while drawing do not schedule duplicate frames", () => {
  const frames = controlledFrames();
  let scheduler!: DemandRenderScheduler;
  let draws = 0;
  scheduler = new DemandRenderScheduler(
    () => {
      draws += 1;
      scheduler.invalidate();
    },
    () => true,
    (callback) => frames.request(callback),
    (id) => frames.cancel(id),
  );

  scheduler.invalidate();
  frames.flushOne();
  assert.equal(draws, 1);
  assert.equal(frames.pending.length, 1);
});

test("disposing cancels pending work and permanently ignores invalidation", () => {
  const frames = controlledFrames();
  let draws = 0;
  const scheduler = new DemandRenderScheduler(
    () => { draws += 1; },
    () => true,
    (callback) => frames.request(callback),
    (id) => frames.cancel(id),
  );

  scheduler.invalidate();
  scheduler.dispose();
  scheduler.invalidate();

  assert.deepEqual(frames.cancelled, [1]);
  assert.equal(frames.pending.length, 0);
  assert.equal(draws, 0);
});
