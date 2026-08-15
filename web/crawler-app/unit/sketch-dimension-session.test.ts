import assert from "node:assert/strict";
import test from "node:test";
import {
  canPreviewSketchDimensionSolver,
  createSketchDimensionSession,
  isSketchDimensionSessionReady,
  reduceSketchDimensionSession,
  type SketchDimensionSession,
} from "../src/sketch-dimension-session.ts";

function lengthSession(): SketchDimensionSession {
  return createSketchDimensionSession({
    source: "smart_dimension",
    operands: [{ kind: "geometry", id: "line:1" }],
    candidateTypes: ["distance", "distance_x", "distance_y"],
    activeType: "distance",
    fields: [{
      id: "length",
      label: "Length",
      unit: "length",
      displayUnit: "mm",
      required: true,
      rawExpression: "",
      evaluatedValue: null,
    }],
  });
}

test("session models source, operands, candidates, inline fields, and independent latches", () => {
  const session = lengthSession();
  assert.equal(session.source, "smart_dimension");
  assert.deepEqual(session.operands, [{ kind: "geometry", id: "line:1" }]);
  assert.deepEqual(session.candidateTypes, ["distance", "distance_x", "distance_y"]);
  assert.equal(session.activeType, "distance");
  assert.equal(session.fields[0].active, true);
  assert.equal(session.fields[0].locked, false);
  assert.equal(session.intent, "driving");
  assert.equal(session.valueAccepted, false);
  assert.equal(session.placementAccepted, false);
  assert.equal(isSketchDimensionSessionReady(session), false);
});

test("keyboard-first input accepts value before independent canvas placement", () => {
  let session = lengthSession();
  session = reduceSketchDimensionSession(session, { type: "input", rawExpression: "width / 2", evaluatedValue: 20 });
  session = reduceSketchDimensionSession(session, { type: "accept_value" });
  assert.equal(session.valueAccepted, true);
  assert.equal(session.fields[0].locked, true);
  assert.equal(session.placementAccepted, false);
  assert.equal(canPreviewSketchDimensionSolver(session), false);

  session = reduceSketchDimensionSession(session, {
    type: "accept_placement",
    placement: { x: 240, y: 180, orientation: "aligned" },
  });
  assert.equal(session.valueAccepted, true);
  assert.equal(session.placementAccepted, true);
  assert.equal(canPreviewSketchDimensionSolver(session), true);
  assert.equal(isSketchDimensionSessionReady(session), false);

  session = reduceSketchDimensionSession(session, { type: "set_solver_preview", preview: { status: "valid" } });
  assert.equal(isSketchDimensionSessionReady(session), true);
});

test("mouse-first placement remains accepted while a value is entered later", () => {
  let session = lengthSession();
  session = reduceSketchDimensionSession(session, { type: "update_placement", placement: { x: 90, y: 110, orientation: "horizontal" } });
  session = reduceSketchDimensionSession(session, { type: "accept_placement" });
  assert.equal(session.placementAccepted, true);
  assert.equal(session.valueAccepted, false);

  session = reduceSketchDimensionSession(session, { type: "input", rawExpression: "42 mm", evaluatedValue: 42 });
  session = reduceSketchDimensionSession(session, { type: "accept_value" });
  assert.equal(session.placementAccepted, true);
  assert.equal(session.valueAccepted, true);
  assert.deepEqual(session.placement, { x: 90, y: 110, orientation: "horizontal" });
});

test("Tab and Shift+Tab lock valid fields and cycle multiple inline inputs", () => {
  let session = createSketchDimensionSession({
    source: "creation",
    operands: [{ kind: "geometry", id: "rectangle:preview" }],
    candidateTypes: ["distance_x"],
    fields: [
      { id: "width", label: "Width", unit: "length", required: true, rawExpression: "", evaluatedValue: null },
      { id: "height", label: "Height", unit: "length", required: true, rawExpression: "", evaluatedValue: null },
    ],
  });

  session = reduceSketchDimensionSession(session, { type: "input", rawExpression: "30", evaluatedValue: 30 });
  session = reduceSketchDimensionSession(session, { type: "lock_cycle", direction: "forward" });
  assert.equal(session.fields[0].locked, true);
  assert.equal(session.fields[1].active, true);

  session = reduceSketchDimensionSession(session, { type: "input", rawExpression: "height", evaluatedValue: 18 });
  session = reduceSketchDimensionSession(session, { type: "lock_cycle", direction: "backward" });
  assert.equal(session.fields[1].locked, true);
  assert.equal(session.fields[0].active, true);
  assert.equal(session.valueAccepted, false, "field locks do not conflate the value-accept latch");

  session = reduceSketchDimensionSession(session, { type: "accept_value" });
  assert.equal(session.valueAccepted, true);
});

test("invalid required expressions cannot be accepted or committed", () => {
  let session = lengthSession();
  session = reduceSketchDimensionSession(session, { type: "input", rawExpression: "unknown +", evaluatedValue: null });
  session = reduceSketchDimensionSession(session, { type: "accept_value" });
  session = reduceSketchDimensionSession(session, { type: "accept_placement", placement: { x: 1, y: 2 } });
  session = reduceSketchDimensionSession(session, { type: "set_solver_preview", preview: { status: "valid" } });
  assert.equal(session.valueAccepted, false);
  assert.equal(canPreviewSketchDimensionSolver(session), false);
  assert.equal(isSketchDimensionSessionReady(session), false);
});

test("editing accepted input invalidates value and solver but preserves accepted placement", () => {
  let session = lengthSession();
  session = reduceSketchDimensionSession(session, { type: "input", rawExpression: "10", evaluatedValue: 10 });
  session = reduceSketchDimensionSession(session, { type: "accept_value" });
  session = reduceSketchDimensionSession(session, { type: "accept_placement", placement: { x: 3, y: 4 } });
  session = reduceSketchDimensionSession(session, { type: "set_solver_preview", preview: { status: "valid" } });
  assert.equal(isSketchDimensionSessionReady(session), true);

  session = reduceSketchDimensionSession(session, { type: "input", rawExpression: "11", evaluatedValue: 11 });
  assert.equal(session.valueAccepted, false);
  assert.equal(session.placementAccepted, true);
  assert.deepEqual(session.solverPreview, { status: "idle" });
  assert.equal(isSketchDimensionSessionReady(session), false);
});

test("moving an accepted placement invalidates its latch and stale solver result", () => {
  let session = lengthSession();
  session = reduceSketchDimensionSession(session, { type: "input", rawExpression: "10", evaluatedValue: 10 });
  session = reduceSketchDimensionSession(session, { type: "accept_value" });
  session = reduceSketchDimensionSession(session, { type: "accept_placement", placement: { x: 3, y: 4 } });
  session = reduceSketchDimensionSession(session, { type: "set_solver_preview", preview: { status: "valid" } });
  assert.equal(isSketchDimensionSessionReady(session), true);

  session = reduceSketchDimensionSession(session, { type: "update_placement", placement: { x: 12, y: 14 } });
  assert.deepEqual(session.placement, { x: 12, y: 14 });
  assert.equal(session.placementAccepted, false);
  assert.deepEqual(session.solverPreview, { status: "idle" });
  assert.equal(isSketchDimensionSessionReady(session), false);
});

test("non-finite placement cannot preserve acceptance or reach preview readiness", () => {
  let session = lengthSession();
  session = reduceSketchDimensionSession(session, { type: "input", rawExpression: "10", evaluatedValue: 10 });
  session = reduceSketchDimensionSession(session, { type: "accept_value" });
  session = reduceSketchDimensionSession(session, { type: "accept_placement", placement: { x: 3, y: 4 } });
  session = reduceSketchDimensionSession(session, { type: "set_solver_preview", preview: { status: "valid" } });

  session = reduceSketchDimensionSession(session, { type: "update_placement", placement: { x: Number.NaN, y: Number.POSITIVE_INFINITY } });
  assert.equal(session.placement, null);
  assert.equal(session.placementAccepted, false);
  assert.deepEqual(session.solverPreview, { status: "idle" });
  assert.equal(canPreviewSketchDimensionSolver(session), false);
  assert.equal(isSketchDimensionSessionReady(session), false);
});

test("an early solver result is ignored and accepting either latch requires a fresh preview", () => {
  let session = lengthSession();
  const initial = session;
  session = reduceSketchDimensionSession(session, { type: "set_solver_preview", preview: { status: "valid" } });
  assert.equal(session, initial);

  session = reduceSketchDimensionSession(session, { type: "input", rawExpression: "10", evaluatedValue: 10 });
  session = reduceSketchDimensionSession(session, { type: "accept_value" });
  session = reduceSketchDimensionSession(session, { type: "set_solver_preview", preview: { status: "valid" } });
  assert.deepEqual(session.solverPreview, { status: "idle" });
  session = reduceSketchDimensionSession(session, { type: "accept_placement", placement: { x: 3, y: 4 } });
  assert.deepEqual(session.solverPreview, { status: "idle" });
  assert.equal(isSketchDimensionSessionReady(session), false);

  session = reduceSketchDimensionSession(session, { type: "set_solver_preview", preview: { status: "valid" } });
  assert.equal(isSketchDimensionSessionReady(session), true);
  session = reduceSketchDimensionSession(session, { type: "accept_placement" });
  assert.deepEqual(session.solverPreview, { status: "idle" });
  assert.equal(isSketchDimensionSessionReady(session), false);
});

test("blank optional fields may be skipped but nonblank invalid optional fields block acceptance", () => {
  const makeSession = () => createSketchDimensionSession({
    source: "creation" as const,
    operands: [{ kind: "geometry" as const, id: "line:preview" }],
    candidateTypes: ["distance" as const],
    fields: [
      { id: "length", label: "Length", unit: "length" as const, required: true, rawExpression: "20", evaluatedValue: 20 },
      { id: "angle", label: "Angle", unit: "angle" as const, required: false, rawExpression: "", evaluatedValue: null },
    ],
  });

  let session = reduceSketchDimensionSession(makeSession(), { type: "accept_value" });
  assert.equal(session.valueAccepted, true, "a blank optional field is skippable");

  session = makeSession();
  session = reduceSketchDimensionSession(session, { type: "input", fieldId: "angle", rawExpression: "bad +", evaluatedValue: null });
  session = reduceSketchDimensionSession(session, { type: "accept_value" });
  session = reduceSketchDimensionSession(session, { type: "accept_placement", placement: { x: 1, y: 2 } });
  assert.equal(session.valueAccepted, false);
  assert.equal(canPreviewSketchDimensionSolver(session), false);
  assert.equal(isSketchDimensionSessionReady(session), false);
});

test("type and intent changes reset solver validation and unavailable types are ignored", () => {
  let session = lengthSession();
  session = reduceSketchDimensionSession(session, { type: "set_solver_preview", preview: { status: "over_constrained", conflicts: ["c:1"] } });
  session = reduceSketchDimensionSession(session, { type: "set_intent", intent: "driven" });
  assert.equal(session.intent, "driven");
  assert.deepEqual(session.solverPreview, { status: "idle" });

  session = reduceSketchDimensionSession(session, { type: "input", rawExpression: "12", evaluatedValue: 12 });
  session = reduceSketchDimensionSession(session, { type: "accept_value" });
  session = reduceSketchDimensionSession(session, { type: "set_type", dimensionType: "distance_x" });
  assert.equal(session.activeType, "distance_x");
  assert.equal(session.valueAccepted, false);

  const unchanged = reduceSketchDimensionSession(session, { type: "set_type", dimensionType: "angle" });
  assert.equal(unchanged, session);
});

test("cancel permanently closes the pure session and clears all commit gates", () => {
  let session = lengthSession();
  session = reduceSketchDimensionSession(session, { type: "input", rawExpression: "8", evaluatedValue: 8 });
  session = reduceSketchDimensionSession(session, { type: "accept_value" });
  session = reduceSketchDimensionSession(session, { type: "accept_placement", placement: { x: 7, y: 9 } });
  session = reduceSketchDimensionSession(session, { type: "set_solver_preview", preview: { status: "valid" } });
  session = reduceSketchDimensionSession(session, { type: "cancel" });
  assert.equal(session.status, "cancelled");
  assert.equal(session.valueAccepted, false);
  assert.equal(session.placementAccepted, false);
  assert.equal(isSketchDimensionSessionReady(session), false);
  assert.equal(reduceSketchDimensionSession(session, { type: "accept_value" }), session);
});

test("factory rejects ambiguous session definitions", () => {
  assert.throws(() => createSketchDimensionSession({
    source: "edit",
    operands: [{ kind: "dimension", constraintId: "d:1" }],
    candidateTypes: [],
    fields: [],
  }), /at least one candidate/);
  assert.throws(() => createSketchDimensionSession({
    source: "edit",
    operands: [],
    candidateTypes: ["radius"],
    activeType: "diameter",
    fields: [],
  }), /not a candidate/);
});
