import assert from "node:assert/strict";
import test from "node:test";
import { normalizeExtrudeDistance, visibleExtrudeDistance } from "../src/extrude-direction.ts";

test("forward and reverse retain the exact visible distance", () => {
  for (const direction of ["positive", "negative"] as const) {
    assert.deepEqual(normalizeExtrudeDistance(4_000_001, direction), {
      visibleNanometers: 4_000_001,
      durableNanometers: 4_000_001,
      normalized: false,
    });
  }
});

test("symmetric mode exposes total length and stores an exact half length", () => {
  assert.deepEqual(normalizeExtrudeDistance(10_000_000, "symmetric"), {
    visibleNanometers: 10_000_000,
    durableNanometers: 5_000_000,
    normalized: false,
  });
  assert.equal(visibleExtrudeDistance(5_000_000, "symmetric"), 10_000_000);
});

test("odd symmetric totals visibly normalize upward to the next even nanometer", () => {
  assert.deepEqual(normalizeExtrudeDistance(4_000_001, "symmetric"), {
    visibleNanometers: 4_000_002,
    durableNanometers: 2_000_001,
    normalized: true,
  });
});
