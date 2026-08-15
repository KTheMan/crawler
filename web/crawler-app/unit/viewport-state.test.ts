import assert from "node:assert/strict";
import test from "node:test";

import { ViewportStateController, type ViewportModelView } from "../src/viewport-state.ts";

function modelView(): ViewportModelView {
  return {
    cameraPose: { position: [4, 5, 6], orientation: [0, 0, 0, 1] },
    projection: { kind: "perspective", verticalFieldOfViewDegrees: 38, near: 0.001, far: 10_000 },
    pivot: { point: [1, 2, 3], anchor: { kind: "topology", key: "face:42" } },
    workingSketchFrame: null,
    navigationMode: "model",
  };
}

test("viewport snapshots are deeply immutable defensive copies", () => {
  const initial = modelView();
  const controller = new ViewportStateController(initial);
  const snapshot = controller.snapshot();

  (initial.cameraPose.position as number[])[0] = 99;
  (initial.pivot.point as number[])[0] = 99;

  assert.deepEqual(snapshot.cameraPose.position, [4, 5, 6]);
  assert.deepEqual(snapshot.pivot.point, [1, 2, 3]);
  assert.equal(snapshot.revision, 0);
  assert.equal(snapshot.savedModelView, null);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.cameraPose));
  assert.ok(Object.isFrozen(snapshot.cameraPose.position));
  assert.ok(Object.isFrozen(snapshot.projection));
  assert.ok(Object.isFrozen(snapshot.pivot.anchor));
});

test("focused and patch updates increment revision only for observable changes", () => {
  const controller = new ViewportStateController(modelView());
  const revisions: number[] = [];
  const unsubscribe = controller.subscribe((snapshot) => revisions.push(snapshot.revision), true);

  const camera = controller.setCameraPose({ position: [8, 5, 6], orientation: [0, 0, 0, 2] });
  assert.equal(camera.revision, 1);
  assert.deepEqual(camera.cameraPose.orientation, [0, 0, 0, 1]);
  assert.equal(controller.setCameraPose({ position: [8, 5, 6], orientation: [0, 0, 0, 1] }), camera);

  const sketch = controller.update({
    projection: { kind: "orthographic", viewHeight: 80, near: 0.01, far: 5_000 },
    workingSketchFrame: {
      origin: [1, 2, 3],
      xAxis: [2, 0, 0],
      yAxis: [0, 3, 0],
      normal: [0, 0, 4],
    },
    navigationMode: "sketch",
  });
  assert.equal(sketch.revision, 2);
  assert.deepEqual(sketch.workingSketchFrame?.xAxis, [1, 0, 0]);
  assert.deepEqual(revisions, [0, 1, 2]);

  unsubscribe();
  controller.setPivot({ point: [0, 0, 0] });
  assert.deepEqual(revisions, [0, 1, 2]);
});

test("replaceState changes all live fields atomically while preserving the saved slot", () => {
  const controller = new ViewportStateController(modelView());
  controller.saveModelView();
  const observed: number[] = [];
  controller.subscribe((snapshot) => {
    observed.push(snapshot.revision);
    assert.equal(snapshot.navigationMode, "temporary-orbit");
    assert.equal(snapshot.projection.kind, "orthographic");
    assert.deepEqual(snapshot.pivot.point, [9, 8, 7]);
    assert.ok(snapshot.savedModelView);
  });

  const replacement = controller.replaceState({
    cameraPose: { position: [10, 11, 12], orientation: [0, 0, 1, 0] },
    projection: { kind: "orthographic", viewHeight: 42, near: 0.1, far: 1_000 },
    pivot: { point: [9, 8, 7] },
    workingSketchFrame: null,
    navigationMode: "temporary-orbit",
  });

  assert.equal(replacement.revision, 2);
  assert.deepEqual(observed, [2]);
});

test("saved model views restore camera, scale, pivot, frame, and mode in one consumed revision", () => {
  const original = modelView();
  original.workingSketchFrame = {
    origin: [0, 0, 0],
    xAxis: [1, 0, 0],
    yAxis: [0, 1, 0],
    normal: [0, 0, 1],
  };
  const controller = new ViewportStateController(original);

  assert.equal(controller.saveModelView().revision, 1);
  assert.equal(controller.saveModelView().revision, 1, "saving the same view is a no-op");
  controller.replaceState({
    cameraPose: { position: [0, 0, 100], orientation: [0, 0, 0, 1] },
    projection: { kind: "orthographic", viewHeight: 25, near: 0.1, far: 2_000 },
    pivot: { point: [0, 0, 0], anchor: { kind: "sketch", key: "sketch:7" } },
    workingSketchFrame: null,
    navigationMode: "sketch",
  });

  const notifications: number[] = [];
  controller.subscribe((snapshot) => notifications.push(snapshot.revision));
  const restored = controller.restoreModelView();

  assert.equal(restored.revision, 3);
  assert.equal(restored.savedModelView, null);
  assert.deepEqual(restored.cameraPose, controller.snapshot().cameraPose);
  assert.deepEqual(restored.cameraPose.position, [4, 5, 6]);
  assert.equal(restored.projection.kind, "perspective");
  assert.deepEqual(restored.pivot, original.pivot);
  assert.deepEqual(restored.workingSketchFrame, original.workingSketchFrame);
  assert.equal(restored.navigationMode, "model");
  assert.deepEqual(notifications, [3]);
  assert.equal(controller.restoreModelView(), restored, "restoring without a saved view is a no-op");
});

test("reentrant subscriber changes are delivered to every subscriber in revision order", () => {
  const controller = new ViewportStateController(modelView());
  const first: number[] = [];
  const second: number[] = [];
  controller.subscribe((snapshot) => {
    first.push(snapshot.revision);
    if (snapshot.revision === 1) controller.setNavigationMode("temporary-orbit");
  });
  controller.subscribe((snapshot) => second.push(snapshot.revision));

  controller.setPivot({ point: [3, 2, 1] });

  assert.deepEqual(first, [1, 2]);
  assert.deepEqual(second, [1, 2]);
  assert.equal(controller.snapshot().navigationMode, "temporary-orbit");
});

test("invalid camera, projection, pivot, frame, and mode inputs are rejected", () => {
  assert.throws(() => new ViewportStateController({
    ...modelView(),
    cameraPose: { position: [0, 0, Number.NaN], orientation: [0, 0, 0, 1] },
  }), /finite/);
  assert.throws(() => new ViewportStateController({
    ...modelView(),
    cameraPose: { position: [0, 0, 0], orientation: [0, 0, 0, 0] },
  }), /non-zero/);
  assert.throws(() => new ViewportStateController({
    ...modelView(),
    projection: { kind: "orthographic", viewHeight: 0, near: 0.1, far: 100 },
  }), /positive/);
  assert.throws(() => new ViewportStateController({
    ...modelView(),
    projection: { kind: "perspective", verticalFieldOfViewDegrees: 38, near: 1, far: 1 },
  }), /greater than near/);
  assert.throws(() => new ViewportStateController({
    ...modelView(),
    pivot: { point: [0, 0, 0], anchor: { kind: "topology", key: "" } },
  }), /non-empty/);
  assert.throws(() => new ViewportStateController({
    ...modelView(),
    workingSketchFrame: {
      origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [1, 0, 0], normal: [0, 0, 1],
    },
  }), /orthogonal/);
  assert.throws(() => new ViewportStateController({
    ...modelView(),
    navigationMode: "fly" as "model",
  }), /navigation mode/);
});
