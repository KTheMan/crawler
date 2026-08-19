import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceOnboarding,
  goBackOnboarding,
  recordOnboardingAction,
  type OnboardingState,
} from "../src/onboarding.ts";

const fresh = (): OnboardingState => ({ version: 4, step: 0, complete: false, achieved: [] });

test("onboarding cannot advance before the current executable action completes", () => {
  const value = fresh();
  assert.equal(advanceOnboarding(value), value);
  assert.equal(recordOnboardingAction(value, "choose-support"), value, "future actions do not bypass sketch entry");
  assert.equal(recordOnboardingAction(value, "draw-rectangle"), value, "future drawing does not bypass sketch entry");
});

test("the sketch-to-extrude actions gate each step in order", () => {
  let value = recordOnboardingAction(fresh(), "start-sketch");
  assert.deepEqual(value.achieved, ["start-sketch"]);
  value = advanceOnboarding(value);
  assert.equal(value.step, 1);
  assert.equal(advanceOnboarding(value), value);

  value = recordOnboardingAction(value, "choose-support");
  value = advanceOnboarding(value);
  assert.equal(value.step, 2);
  assert.equal(value.complete, false);

  value = recordOnboardingAction(value, "draw-rectangle");
  value = advanceOnboarding(value);
  assert.equal(value.step, 3);
  value = recordOnboardingAction(value, "finish-sketch");
  value = advanceOnboarding(value);
  assert.equal(value.step, 4);
  value = recordOnboardingAction(value, "start-extrude");
  value = advanceOnboarding(value);
  assert.equal(value.step, 5);
  value = recordOnboardingAction(value, "commit-extrude");
  value = advanceOnboarding(value);
  assert.equal(value.step, 5);
  assert.equal(value.complete, true);
  assert.deepEqual(value.achieved, ["start-sketch", "choose-support", "draw-rectangle", "finish-sketch", "start-extrude", "commit-extrude"]);
});

test("Back revisits a prior instruction without erasing completed work", () => {
  let value = recordOnboardingAction(fresh(), "start-sketch");
  value = advanceOnboarding(value);
  value = recordOnboardingAction(value, "choose-support");
  assert.equal(goBackOnboarding(value).step, 0);
  const initial = fresh();
  assert.equal(goBackOnboarding(initial), initial);
});

test("completed and already-achieved actions are idempotent", () => {
  const achieved = recordOnboardingAction(fresh(), "start-sketch");
  assert.equal(recordOnboardingAction(achieved, "start-sketch"), achieved);
  const completed: OnboardingState = { version: 4, step: 5, complete: true, achieved: ["start-sketch", "choose-support", "draw-rectangle", "finish-sketch", "start-extrude", "commit-extrude"] };
  assert.equal(recordOnboardingAction(completed, "commit-extrude"), completed);
  assert.equal(advanceOnboarding(completed), completed);
});
