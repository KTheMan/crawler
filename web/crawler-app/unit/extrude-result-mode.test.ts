import assert from "node:assert/strict";
import test from "node:test";
import {
  ExtrudeTargetError,
  isExtrudeCutErrorCode,
  parseExtrudeResultMode,
  normalizeExtrudeCutFailure,
  requireSingleCutTarget,
  retainedExtrudeBody,
} from "../src/extrude-result-mode.ts";

test("result mode parser accepts only the two qualified modes", () => {
  assert.equal(parseExtrudeResultMode("new_body"), "new_body");
  assert.equal(parseExtrudeResultMode("cut"), "cut");
  assert.equal(parseExtrudeResultMode("join"), undefined);
});

test("native and WASM Cut refusals normalize to recoverable field-addressed diagnostics", () => {
  for (const [token, category] of [
    ["missing_cut_target", "not_found"],
    ["suppressed_cut_target", "reference"],
    ["stale_cut_target", "reference"],
    ["wrong_component_cut_target", "ownership"],
    ["wrong_owner_cut_target", "ownership"],
    ["no_intersection", "boolean"],
    ["remove_all_material", "boolean"],
    ["nonmanifold_result", "boolean"],
  ] as const) {
    const diagnostic = normalizeExtrudeCutFailure(new Error(`invalid document: ${token}: refused`), "body:target");
    assert.equal(diagnostic.code, token);
    assert.equal(diagnostic.category, category);
    assert.equal(diagnostic.field, "participant_bodies.target");
    assert.deepEqual(diagnostic.referencedEntityIds, ["body:target"]);
    assert.equal(isExtrudeCutErrorCode(diagnostic.code), true);
  }
  assert.equal(isExtrudeCutErrorCode("unrelated_failure"), false);
});

test("structured runtime Cut diagnostics retain explicit fields and references", () => {
  assert.deepEqual(normalizeExtrudeCutFailure({ error: {
    code: "cut_kernel_refused", category: "boolean", field: "target", field_path: "operation.result",
    message: "kernel refused", recovery: "adjust input", referenced_entity_ids: ["body:target"],
  } }), {
    code: "cut_kernel_refused", category: "boolean", field: "operation.result",
    message: "kernel refused", recovery: "adjust input", referencedEntityIds: ["body:target"],
  });
});

test("Cut requires one explicitly selected current target", () => {
  assert.equal(requireSingleCutTarget("body:target", ["body:target", "body:other"]), "body:target");
  assert.throws(() => requireSingleCutTarget(undefined, ["body:target"]), (error) => error instanceof ExtrudeTargetError && error.code === "target_required");
  assert.throws(() => requireSingleCutTarget("body:stale", ["body:target"]), (error) => error instanceof ExtrudeTargetError && error.code === "target_missing");
});

test("face-supported Cut retains the support owner as its target", () => {
  assert.equal(requireSingleCutTarget("body:owner", ["body:owner"], "body:owner"), "body:owner");
  assert.throws(
    () => requireSingleCutTarget("body:other", ["body:owner", "body:other"], "body:owner"),
    (error) => error instanceof ExtrudeTargetError && error.code === "target_owner_mismatch",
  );
});

test("stored NewBody and Cut definitions resolve stable retained body identity", () => {
  assert.deepEqual(retainedExtrudeBody({ result: { mode: "new_body", body: "body:new" } }), { mode: "new_body", bodyId: "body:new" });
  assert.deepEqual(retainedExtrudeBody({ result: { mode: "cut" }, participant_bodies: [{ role: "target", body: "body:target" }] }), { mode: "cut", bodyId: "body:target" });
  assert.throws(
    () => retainedExtrudeBody({ result: { mode: "cut" }, participant_bodies: [{ role: "target", body: "body:a" }, { role: "target", body: "body:b" }] }),
    (error) => error instanceof ExtrudeTargetError && error.code === "target_ambiguous",
  );
});
