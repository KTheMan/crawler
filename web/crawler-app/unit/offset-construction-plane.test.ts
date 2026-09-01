import assert from "node:assert/strict";
import test from "node:test";

import { buildOffsetConstructionPlaneRequest, constructionPlaneOffsetInputError, constructionPlaneRecomputeReport, constructionPlaneRuntimeErrorMapping, constructionPlaneSupportRuntimeErrorMapping, exactSignedMillimetersToNanometers, isConstructionPlaneRuntimeErrorCode, isConstructionPlaneSupportRuntimeErrorCode, offsetNanometersToMillimeters } from "../src/offset-construction-plane.ts";

test("signed millimeters parse to exact durable nanometers", () => {
  assert.equal(exactSignedMillimetersToNanometers("12.500001"), 12_500_001);
  assert.equal(exactSignedMillimetersToNanometers("-4.25"), -4_250_000);
  assert.equal(exactSignedMillimetersToNanometers("+0.000001"), 1);
  assert.equal(exactSignedMillimetersToNanometers("-0"), 0);
  for (const invalid of ["", "1.0000001", "1e3", "NaN", "Infinity", ".5"]) assert.equal(exactSignedMillimetersToNanometers(invalid), undefined);
});

test("Extrude construction-plane support failures retain stable fields and referenced IDs", () => {
  assert.deepEqual(constructionPlaneSupportRuntimeErrorMapping("missing_construction_plane_support at extrude.support: Extrude referenced entity construction-plane:lost is missing"), {
    code: "missing_construction_plane_support", field: "extrude.support",
    recovery: "select or restore the referenced construction plane", referencedEntityIds: ["construction-plane:lost"],
  });
  assert.deepEqual(constructionPlaneSupportRuntimeErrorMapping("suppressed_construction_plane_support at extrude.support: Extrude referenced entity construction-plane:deck is suppressed"), {
    code: "suppressed_construction_plane_support", field: "extrude.support",
    recovery: "unsuppress the referenced construction plane", referencedEntityIds: ["construction-plane:deck"],
  });
  assert.deepEqual(constructionPlaneSupportRuntimeErrorMapping("invalid_construction_plane_dependency at extrude.support: Extrude construction plane construction-plane:deck references missing entity origin-plane:lost"), {
    code: "invalid_construction_plane_dependency", field: "extrude.support",
    recovery: "restore or rebind the construction plane dependency", referencedEntityIds: ["origin-plane:lost"],
  });
  for (const code of ["missing_construction_plane_support", "suppressed_construction_plane_support", "invalid_construction_plane_dependency"]) {
    assert.equal(isConstructionPlaneSupportRuntimeErrorCode(code), true);
  }
  assert.equal(constructionPlaneSupportRuntimeErrorMapping("generic refusal"), undefined);
  assert.throws(() => constructionPlaneSupportRuntimeErrorMapping("missing_construction_plane_support at extrude.support without identity"), /omitted its referenced entity/);
});

test("nanometer formatting is canonical and lossless", () => {
  for (const value of [0, 1, -1, 4_000_000, -12_500_001, Number.MAX_SAFE_INTEGER]) {
    assert.equal(exactSignedMillimetersToNanometers(offsetNanometersToMillimeters(value)), value);
  }
  assert.throws(() => offsetNanometersToMillimeters(0.5), /exact nanometer integer/);
});

test("offset input distinguishes syntax from unsafe exact range", () => {
  assert.equal(constructionPlaneOffsetInputError("12.500001"), undefined);
  assert.equal(constructionPlaneOffsetInputError("1e3"), "Enter a signed decimal offset with at most six decimal places.");
  assert.match(constructionPlaneOffsetInputError("9007199254.740992") ?? "", /construction_plane\.offset_parameter.*exact safe nanometer range/);
  assert.equal(exactSignedMillimetersToNanometers("9007199254.740991"), Number.MAX_SAFE_INTEGER);
});

test("request normalization fixes the support boundary to one named origin plane", () => {
  assert.deepEqual(buildOffsetConstructionPlaneRequest({
    planeId: "construction-plane:deck",
    componentId: "component:root",
    basePlane: "xz",
    offsetParameterId: "parameter:deck-offset",
    offsetMillimeters: "-12.5",
    suppressed: false,
    transactionId: "transaction:7:plane",
    baseRevision: 6,
  }), {
    plane_id: "construction-plane:deck",
    component_id: "component:root",
    base_plane_id: "origin-plane:xz",
    offset_parameter_id: "parameter:deck-offset",
    offset_nanometers: -12_500_000,
    suppressed: false,
    transaction_id: "transaction:7:plane",
    base_revision: 6,
  });
});

test("runtime repair tokens map to exact structured construction-plane errors", () => {
  assert.deepEqual(
    constructionPlaneRuntimeErrorMapping(new Error("invalid document: missing_construction_plane_base_plane at construction_plane.base_plane: referenced entity origin-plane:lost is missing"), "preview"),
    {
      code: "missing_construction_plane_base_plane",
      field: "construction_plane.base_plane",
      recovery: "select an existing unsuppressed origin plane",
      category: "reference",
      referencedEntityIds: ["origin-plane:lost"],
    },
  );
  assert.deepEqual(
    constructionPlaneRuntimeErrorMapping("missing_construction_plane_offset_parameter at construction_plane.offset_parameter: referenced entity parameter:lost is missing", "commit"),
    {
      code: "missing_construction_plane_offset_parameter",
      field: "construction_plane.offset_parameter",
      recovery: "restore or replace the missing length parameter",
      category: "reference",
      referencedEntityIds: ["parameter:lost"],
    },
  );
  assert.deepEqual(constructionPlaneRuntimeErrorMapping("other refusal", "commit"), {
    code: "offset_construction_plane_commit_refused",
    field: "offset",
    recovery: "correct the construction plane inputs and retry",
    category: "invalid_input",
  });
  assert.deepEqual(constructionPlaneRuntimeErrorMapping("wrong_type_construction_plane_offset_parameter at construction_plane.offset_parameter: referenced parameter parameter:lost has incompatible boolean value true", "preview"), {
    code: "wrong_type_construction_plane_offset_parameter",
    field: "construction_plane.offset_parameter",
    recovery: "replace the referenced value with an exact length parameter",
    category: "reference",
    referencedEntityIds: ["parameter:lost"],
  });
  assert.deepEqual(constructionPlaneRuntimeErrorMapping("unsafe_construction_plane_offset_parameter at construction_plane.offset_parameter: referenced parameter parameter:lost has unsafe nanometer value 9007199254740992", "commit"), {
    code: "unsafe_construction_plane_offset_parameter",
    field: "construction_plane.offset_parameter",
    recovery: "enter an offset within the exact safe nanometer range",
    category: "reference",
    referencedEntityIds: ["parameter:lost"],
  });
  assert.deepEqual(constructionPlaneRuntimeErrorMapping("invalid_construction_plane_dependency at construction_plane.base_plane: construction plane construction-plane:deck references base plane origin-plane:other from another component", "preview"), {
    code: "invalid_construction_plane_dependency",
    field: "construction_plane.base_plane",
    recovery: "select a base plane in the same component",
    category: "reference",
    referencedEntityIds: ["origin-plane:other"],
  });
});

test("all structured construction-plane runtime errors route to the plane editor", () => {
  for (const code of [
    "missing_construction_plane_base_plane",
    "missing_construction_plane_offset_parameter",
    "wrong_type_construction_plane_offset_parameter",
    "unsafe_construction_plane_offset_parameter",
    "offset_construction_plane_preview_refused",
    "offset_construction_plane_commit_refused",
  ]) assert.equal(isConstructionPlaneRuntimeErrorCode(code), true, code);
  for (const code of ["extrude_preview_refused", "offset_other_feature_refused", "", "missing_parameter"]) {
    assert.equal(isConstructionPlaneRuntimeErrorCode(code), false, code);
  }
});

test("construction-plane recompute reporting names only actually accepted feature results", () => {
  const transaction = {
    id: "transaction:plane-edit",
    base_revision: 4,
    result_revision: 5,
    changes: [
      { kind: "set_parameter_value", parameter: "parameter:offset" },
      { kind: "accept_feature_result", feature: "feature:z-plane-extrude" },
      { kind: "accept_feature_result", feature: "feature:y-direct-child" },
      { kind: "accept_feature_result", feature: "feature:a-downstream-child" },
    ],
  } as const;
  assert.deepEqual(constructionPlaneRecomputeReport("construction-plane:offset", transaction), {
    dirtyRoots: ["construction-plane:offset"],
    evaluationOrder: ["feature:z-plane-extrude", "feature:y-direct-child", "feature:a-downstream-child"],
  });
  assert.equal(constructionPlaneRecomputeReport("construction-plane:offset", transaction).evaluationOrder.includes("feature:0-unrelated"), false);
  assert.deepEqual(constructionPlaneRecomputeReport("construction-plane:new", { ...transaction, changes: [] }), {
    dirtyRoots: ["construction-plane:new"],
    evaluationOrder: [],
  });
  assert.throws(() => constructionPlaneRecomputeReport("construction-plane:offset", {
    ...transaction,
    changes: [{ kind: "accept_feature_result" }],
  }), /missing its feature identity/);
  assert.throws(() => constructionPlaneRecomputeReport("construction-plane:offset", {
    ...transaction,
    changes: [
      { kind: "accept_feature_result", feature: "feature:z-plane-extrude" },
      { kind: "accept_feature_result", feature: "feature:z-plane-extrude" },
    ],
  }), /repeats feature:z-plane-extrude/);
});
