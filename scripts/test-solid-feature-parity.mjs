import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compareEvidence, hasManifestParityBinding, validateEvidenceAgainstFixture } from "./compare-solid-feature-parity.mjs";

const hash = "a".repeat(64);
const fixture = {
  tolerances: { relative: 1e-9, aabb_nm: 1, signed_volume_nm3: 10, surface_area_nm2: 1, centroid_nm: 1 },
};
function record(runtime, volume = 1000) {
  return {
    runtime,
    result: {
      kind: "success", body_count: 1, manifold: true, orientation: "outward",
      aabb_nm: [0, 0, 0, 10, 10, 10], signed_volume_nm3: volume,
      surface_area_nm2: 600, centroid_nm: [5, 5, 5], analytic_classification: ["plane"],
      stable_identity_sets: { retained: ["body:1"], replaced: [] }, canonical_document_hash: hash,
    },
    accepted_document_hash_before: hash, accepted_document_hash_after: hash,
    body_hashes_before: [], body_hashes_after: [hash],
    executed_lifecycle_steps: ["preview", "commit"],
  };
}

test("equivalent normalized results pass", () => {
  assert.deepEqual(compareEvidence(fixture, record("native"), record("release_wasm")), []);
});

test("semantically equal assertion objects ignore serialization key order", () => {
  const native = record("native"), wasm = record("release_wasm");
  native.oracle_assertions = { canonical_roundtrip: true, ordered_ids: ["outer", "hole"] };
  wasm.oracle_assertions = { ordered_ids: ["outer", "hole"], canonical_roundtrip: true };
  assert.deepEqual(compareEvidence(fixture, native, wasm), []);
});

test("parity binding follows the manifest test kind instead of a sprint-specific ID", () => {
  const candidate = {
    tests: [
      { id: "native-direction", kind: "native" },
      { id: "direction-native-wasm-parity", kind: "parity" },
    ],
  };
  assert.equal(hasManifestParityBinding(candidate, { evidence_test_ids: ["direction-native-wasm-parity"] }), true);
  assert.equal(hasManifestParityBinding(candidate, { evidence_test_ids: ["native-direction"] }), false);
  assert.equal(hasManifestParityBinding(candidate, { evidence_test_ids: ["native-wasm-parity"] }), false);
});

test("descriptor-declared deliberate geometry divergence yields its structured error", async () => {
  const descriptor = JSON.parse(await readFile("contracts/solid-feature-candidate/fixtures/parity-deliberate-divergence.json", "utf8"));
  const payload = descriptor.input.payload;
  const differences = compareEvidence(descriptor, record("native", payload.native), record("release_wasm", payload.release_wasm));
  const fieldPath = `result.${payload.field}`;
  assert.ok(differences.some((difference) => difference.field_path === fieldPath));
  assert.deepEqual({
    kind: "structured_error",
    error: { category: "qualification", code: "parity_difference", field_path: fieldPath, referenced_entity_ids: [] },
  }, descriptor.expected);
});

test("negative results must preserve accepted state", () => {
  const native = record("native");
  const wasm = record("release_wasm");
  for (const evidence of [native, wasm]) evidence.result = { kind: "structured_error", category: "profile", code: "open_loop", field_path: "region.outer", referenced_entity_ids: ["curve:1"] };
  wasm.accepted_document_hash_after = "b".repeat(64);
  const differences = compareEvidence(fixture, native, wasm);
  assert.ok(differences.some((difference) => difference.reason === "negative_result_mutated_document"));
});

test("shared native/WASM substitution still fails the fixture oracle", () => {
  const descriptor = {
    expected: { kind: "success", result: { body_count: 1, expected_bounds_nm: [0, 0, 0, 20, 20, 20], canonical_roundtrip: true } },
    tolerances: fixture.tolerances,
    identity_sets: { retained: ["body:1"], replaced: [] },
    lifecycle_steps: ["preview", "commit", "reload"],
  };
  const native = record("native"), wasm = record("release_wasm");
  assert.deepEqual(compareEvidence(descriptor, native, wasm), []);
  const differences = validateEvidenceAgainstFixture(descriptor, native);
  assert.ok(differences.some((difference) => difference.field_path.startsWith("result.expected_bounds_nm")));
  assert.ok(differences.some((difference) => difference.field_path === "result.canonical_roundtrip" && difference.reason === "missing_fixture_oracle_field"));
  assert.ok(differences.some((difference) => difference.reason === "declared_lifecycle_step_not_executed"));
});

test("matching runtimes cannot satisfy nonempty fixture-owned identity sets vacuously", () => {
  const descriptor = {
    expected: { kind: "success", result: { body_count: 1 } },
    tolerances: fixture.tolerances,
    identity_sets: { retained: ["body:retained"], replaced: ["body:replaced"] },
    lifecycle_steps: ["commit"],
  };
  const native = record("native"), wasm = record("release_wasm");
  for (const evidence of [native, wasm]) evidence.result.stable_identity_sets = { retained: [], replaced: [] };
  assert.deepEqual(compareEvidence(descriptor, native, wasm), []);
  const differences = validateEvidenceAgainstFixture(descriptor, native);
  assert.ok(differences.some((difference) => difference.field_path === "result.stable_identity_sets.retained"));
  assert.ok(differences.some((difference) => difference.field_path === "result.stable_identity_sets.replaced"));
});

test("frozen nested geometry oracles reject shared runtime substitutions", () => {
  const geometryOracle = {
    "top:positive:annulus": {
      aabb_nm: [2, 2, 10, 8, 8, 12],
      centroid_nm: [5, 5, 11],
      signed_volume_nm3: 50,
      surface_area_nm2: 100,
      orientation: "outward",
      analytic_classification: ["nurbs_surface", "plane"],
      body_count: 1,
      canonical_document_hash: hash,
    },
  };
  const descriptor = {
    expected: { kind: "success", result: { body_count: 1, geometry_oracles: geometryOracle } },
    tolerances: fixture.tolerances,
    identity_sets: { retained: ["body:1"], replaced: [] },
    lifecycle_steps: ["preview", "commit"],
  };
  const native = record("native"), wasm = record("release_wasm");
  native.oracle_assertions = { geometry_oracles: structuredClone(geometryOracle) };
  wasm.oracle_assertions = { geometry_oracles: structuredClone(geometryOracle) };
  assert.deepEqual(compareEvidence(descriptor, native, wasm), []);
  assert.deepEqual(validateEvidenceAgainstFixture(descriptor, native), []);
  native.oracle_assertions.geometry_oracles["top:positive:annulus"].canonical_document_hash = "b".repeat(64);
  assert.ok(validateEvidenceAgainstFixture(descriptor, native).some((difference) => difference.field_path === "result.geometry_oracles"));
});

test("matching error kind with a wrong structured path fails the fixture oracle", () => {
  const descriptor = {
    expected: { kind: "structured_error", error: { category: "profile", code: "open_loop", field_path: "region.outer", referenced_entity_ids: ["curve:1"] } },
    tolerances: fixture.tolerances,
    identity_sets: { retained: [], replaced: [] },
    lifecycle_steps: ["preview"],
  };
  const evidence = record("native");
  evidence.result = { kind: "structured_error", category: "profile", code: "open_loop", field_path: "sketch.geometry", referenced_entity_ids: ["curve:1"] };
  evidence.body_hashes_after = [];
  assert.ok(validateEvidenceAgainstFixture(descriptor, evidence).some((difference) => difference.field_path === "result.field_path"));
});

test("structured-error evidence must match descriptor-owned mismatch assertions", () => {
  const mismatch = {
    variant_count: 4,
    mismatch_variants: {
      body: { code: "missing_topology_face_body", refused: true },
      producer: { code: "wrong_producer_topology_face_support", refused: true },
      component: { code: "cross_component_topology_face_support", refused: true },
      body_local_id_collision: { commit_refused: true, atomic: true },
    },
  };
  const descriptor = {
    expected: {
      kind: "structured_error",
      error: { category: "wrong_owner", code: "wrong_producer_topology_face_support", field_path: "extrude.support", referenced_entity_ids: ["topology:face-support"] },
      oracle_assertions: mismatch,
    },
    tolerances: fixture.tolerances,
    identity_sets: { retained: [], replaced: [] },
    lifecycle_steps: ["preview"],
  };
  const evidence = record("native");
  evidence.result = { kind: "structured_error", category: "wrong_owner", code: "wrong_producer_topology_face_support", field_path: "extrude.support", referenced_entity_ids: ["topology:face-support"] };
  evidence.body_hashes_before = [];
  evidence.body_hashes_after = [];
  evidence.executed_lifecycle_steps = ["preview"];
  evidence.oracle_assertions = structuredClone(mismatch);
  assert.deepEqual(validateEvidenceAgainstFixture(descriptor, evidence), []);
  evidence.oracle_assertions.mismatch_variants.body_local_id_collision.atomic = false;
  assert.ok(validateEvidenceAgainstFixture(descriptor, evidence).some((difference) => difference.field_path === "oracle_assertions"));
});

test("structured-error evidence cannot omit an executed lifecycle step", () => {
  const descriptor = {
    expected: { kind: "structured_error", error: { category: "reference", code: "missing_reference", field_path: "construction_plane.offset_parameter", referenced_entity_ids: ["parameter:missing"] } },
    tolerances: fixture.tolerances,
    identity_sets: { retained: [], replaced: [] },
    lifecycle_steps: ["preview", "commit", "save", "reopen", "repair"],
  };
  const evidence = record("release_wasm");
  evidence.result = { kind: "structured_error", category: "reference", code: "missing_reference", field_path: "construction_plane.offset_parameter", referenced_entity_ids: ["parameter:missing"] };
  evidence.body_hashes_before = [];
  evidence.body_hashes_after = [];
  evidence.executed_lifecycle_steps = ["preview", "commit", "save", "repair"];
  const differences = validateEvidenceAgainstFixture(descriptor, evidence);
  assert.deepEqual(differences.filter((difference) => difference.reason === "declared_lifecycle_step_not_executed"), [{
    field_path: "executed_lifecycle_steps",
    expected: "reopen",
    actual: ["commit", "preview", "repair", "save"],
    reason: "declared_lifecycle_step_not_executed",
  }]);
});

test("fixture oracle rejects duplicate and undeclared lifecycle claims", () => {
  const descriptor = {
    expected: { kind: "structured_error", error: { category: "reference", code: "missing_reference", field_path: "extrude.support", referenced_entity_ids: ["topology:missing"] } },
    tolerances: fixture.tolerances,
    identity_sets: { retained: [], replaced: [] },
    lifecycle_steps: ["preview", "commit"],
  };
  const evidence = record("native");
  evidence.result = { kind: "structured_error", category: "reference", code: "missing_reference", field_path: "extrude.support", referenced_entity_ids: ["topology:missing"] };
  evidence.body_hashes_before = [];
  evidence.body_hashes_after = [];
  evidence.executed_lifecycle_steps = ["preview", "preview", "commit", "repair"];
  const reasons = validateEvidenceAgainstFixture(descriptor, evidence).map((difference) => difference.reason);
  assert.ok(reasons.includes("duplicate_lifecycle_step"));
  assert.ok(reasons.includes("undeclared_lifecycle_step_executed"));
});

test("fixture oracle rejects duplicate declared lifecycle steps", () => {
  const descriptor = {
    expected: { kind: "structured_error", error: { category: "reference", code: "missing_reference", field_path: "extrude.support", referenced_entity_ids: [] } },
    tolerances: fixture.tolerances,
    identity_sets: { retained: [], replaced: [] },
    lifecycle_steps: ["preview", "commit", "preview"],
  };
  const evidence = record("native");
  evidence.result = { kind: "structured_error", category: "reference", code: "missing_reference", field_path: "extrude.support", referenced_entity_ids: [] };
  evidence.body_hashes_before = [];
  evidence.body_hashes_after = [];
  evidence.executed_lifecycle_steps = ["preview", "commit"];
  assert.ok(validateEvidenceAgainstFixture(descriptor, evidence).some(
    (difference) => difference.field_path === "lifecycle_steps" && difference.reason === "duplicate_declared_lifecycle_step",
  ));
});

test("signed offset evidence fails closed when zero-boundary assertions are omitted", () => {
  const descriptor = {
    expected: { kind: "success", result: {
      body_count: 1,
      zero_offset_frame_origin_nm: [0, 0, 0],
      zero_offset_bounds_nm: [-5_000_000, -3_000_000, 0, 5_000_000, 3_000_000, 4_000_000],
      zero_offset_stable_plane_id: "construction-plane:extrude-offset-plane-signed-edit",
      zero_offset_stable_sketch_id: "sketch:extrude-offset-plane-signed-edit",
      zero_offset_stable_feature_id: "feature:extrude-offset-plane-signed-edit",
      zero_offset_stable_body_id: "body:extrude-offset-plane-signed-edit",
    } },
    tolerances: fixture.tolerances,
    identity_sets: { retained: ["body:1"], replaced: [] },
    lifecycle_steps: ["preview", "commit"],
  };
  const evidence = record("release_wasm");
  evidence.oracle_assertions = {};
  const differences = validateEvidenceAgainstFixture(descriptor, evidence);
  for (const field of Object.keys(descriptor.expected.result).filter((field) => field.startsWith("zero_offset_"))) {
    assert.ok(differences.some((difference) => difference.field_path === `result.${field}` && difference.reason === "missing_fixture_oracle_field"), field);
  }
});

test("signed zero-offset native/WASM oracle parity is exact", () => {
  const native = record("native"), wasm = record("release_wasm");
  const zeroAssertions = {
    zero_offset_frame_origin_nm: [0, 0, 0],
    zero_offset_bounds_nm: [-5_000_000, -3_000_000, 0, 5_000_000, 3_000_000, 4_000_000],
    zero_offset_stable_plane_id: "construction-plane:extrude-offset-plane-signed-edit",
    zero_offset_stable_sketch_id: "sketch:extrude-offset-plane-signed-edit",
    zero_offset_stable_feature_id: "feature:extrude-offset-plane-signed-edit",
    zero_offset_stable_body_id: "body:extrude-offset-plane-signed-edit",
  };
  native.oracle_assertions = structuredClone(zeroAssertions);
  wasm.oracle_assertions = structuredClone(zeroAssertions);
  assert.deepEqual(compareEvidence(fixture, native, wasm), []);
  wasm.oracle_assertions.zero_offset_bounds_nm[5] = 4_000_001;
  assert.ok(compareEvidence(fixture, native, wasm).some((difference) => difference.field_path === "oracle_assertions"));
});
