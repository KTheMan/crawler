import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceOnboarding,
  recordOnboardingAction,
  type OnboardingState,
} from "../src/onboarding.ts";

const fresh = (): OnboardingState => ({ version: 2, step: 0, complete: false, achieved: [] });

test("onboarding cannot advance before the current executable action completes", () => {
  const value = fresh();
  assert.equal(advanceOnboarding(value), value);
  assert.equal(recordOnboardingAction(value, "timeline"), value, "future actions do not bypass modeling");
  assert.equal(recordOnboardingAction(value, "save"), value, "future saves do not bypass modeling");
});

test("model, timeline, and save actions gate each step in order", () => {
  let value = recordOnboardingAction(fresh(), "model");
  assert.deepEqual(value.achieved, ["model"]);
  value = advanceOnboarding(value);
  assert.equal(value.step, 1);
  assert.equal(advanceOnboarding(value), value);

  value = recordOnboardingAction(value, "timeline");
  value = advanceOnboarding(value);
  assert.equal(value.step, 2);
  assert.equal(value.complete, false);

  value = recordOnboardingAction(value, "save");
  value = advanceOnboarding(value);
  assert.equal(value.step, 2);
  assert.equal(value.complete, true);
  assert.deepEqual(value.achieved, ["model", "timeline", "save"]);
});

test("completed and already-achieved actions are idempotent", () => {
  const achieved = recordOnboardingAction(fresh(), "model");
  assert.equal(recordOnboardingAction(achieved, "model"), achieved);
  const completed: OnboardingState = { version: 2, step: 2, complete: true, achieved: ["model", "timeline", "save"] };
  assert.equal(recordOnboardingAction(completed, "save"), completed);
  assert.equal(advanceOnboarding(completed), completed);
});
