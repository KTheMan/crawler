import assert from "node:assert/strict";
import test from "node:test";

import { attributeSolidFeatureLongTasks } from "../tests/solid-feature-performance-audit.ts";

test("long tasks are attributed by entry startTime within action intervals", () => {
  const attributed = attributeSolidFeatureLongTasks(
    [
      { startTime: 105, duration: 52 },
      { startTime: 220, duration: 60 },
      { startTime: 399, duration: 75 },
    ],
    [
      { id: 1, phase: "preview", startTime: 100, endTime: 180 },
      { id: 2, phase: "cancel", startTime: 200, endTime: 240 },
    ],
  );

  assert.deepEqual(attributed, [
    { startTime: 105, duration: 52, phase: "preview", action_interval_id: 1 },
    { startTime: 220, duration: 60, phase: "cancel", action_interval_id: 2 },
    { startTime: 399, duration: 75, phase: "unattributed" },
  ]);
});

test("attribution is independent of observer callback order", () => {
  const attributed = attributeSolidFeatureLongTasks(
    [
      // Delivered together after cancellation, but the entry timestamps prove
      // that these tasks began in different actions.
      { startTime: 12, duration: 51 },
      { startTime: 42, duration: 53 },
    ],
    [
      { id: 7, phase: "preview", startTime: 10, endTime: 20 },
      { id: 8, phase: "cancel", startTime: 40, endTime: 50 },
    ],
  );

  assert.equal(attributed[0]?.phase, "preview");
  assert.equal(attributed[1]?.phase, "cancel");
});

test("planar-face, topology-repair, and Cut failure-recovery workload identity remains attached to measured long tasks", () => {
  const attributed = attributeSolidFeatureLongTasks(
    [{ startTime: 25, duration: 54 }, { startTime: 75, duration: 58 }, { startTime: 125, duration: 56 }],
    [
      { id: 9, phase: "preview", workload_id: "extrude-planar-face-rectangle", startTime: 20, endTime: 30 },
      { id: 10, phase: "recompute", workload_id: "planar-face-support-repair", startTime: 70, endTime: 80 },
      { id: 11, phase: "recompute", workload_id: "cut-single-target-failure-recovery", startTime: 120, endTime: 130 },
    ],
  );
  assert.equal(attributed[0]?.workload_id, "extrude-planar-face-rectangle");
  assert.equal(attributed[1]?.workload_id, "planar-face-support-repair");
  assert.equal(attributed[2]?.workload_id, "cut-single-target-failure-recovery");
});
