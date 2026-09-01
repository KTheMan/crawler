import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { compareEvidence } from "./compare-solid-feature-parity.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const manifestPath = path.join(repositoryRoot, "contracts/solid-feature-candidate/sprint-1.json");
const outputRoot = process.env.SOLID_FEATURE_NON_PARITY_EVIDENCE_ROOT;
const activeManifestPath = process.env.SOLID_FEATURE_CANDIDATE_MANIFEST
  ? path.resolve(repositoryRoot, process.env.SOLID_FEATURE_CANDIDATE_MANIFEST)
  : manifestPath;
const activeCandidate = JSON.parse(await readFile(activeManifestPath, "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function context(fixtureId) {
  const manifestBytes = await readFile(manifestPath);
  const candidate = JSON.parse(manifestBytes);
  const fixtureRef = candidate.fixtures.find((fixture) => fixture.id === fixtureId);
  assert.ok(fixtureRef, `manifest fixture ${fixtureId}`);
  const descriptorPath = path.join(repositoryRoot, fixtureRef.path);
  const descriptorBytes = await readFile(descriptorPath);
  return {
    candidate,
    descriptor: JSON.parse(descriptorBytes),
    manifestSha256: sha256(manifestBytes),
    descriptorSha256: sha256(descriptorBytes),
  };
}

async function persistEvidence(value) {
  if (!outputRoot) return;
  // The self-test corpus is owned by Sprint 1. A later candidate with a
  // browser-only non-parity fixture must not receive these records merely
  // because qualification enabled a fixture output directory.
  if (value.candidate_id !== activeCandidate.candidate_id || value.candidate_revision !== activeCandidate.revision) return;
  await mkdir(outputRoot, { recursive: true });
  const destination = path.join(outputRoot, `${value.fixture_id}.json`);
  const temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, destination);
}

function evidenceRecord(contextValue, fixtureId, sourceId, result, assertions) {
  return {
    schema_version: 1,
    candidate_id: contextValue.candidate.candidate_id,
    candidate_revision: contextValue.candidate.revision,
    manifest_sha256: contextValue.manifestSha256,
    fixture_id: fixtureId,
    descriptor_sha256: contextValue.descriptorSha256,
    status: "passed",
    source_kind: "self_test",
    source_id: sourceId,
    input: contextValue.descriptor.input,
    result,
    assertions,
  };
}

function requiredSubjects(candidate) {
  return [
    ...candidate.stories.filter((story) => story.evidence_policy === "required").map((story) => `story:${story.id}`),
    ...candidate.fixtures.map((fixture) => `fixture:${fixture.id}`),
    ...candidate.tests.filter((candidateTest) => candidateTest.id !== "candidate-manifest-validation").map((candidateTest) => `test:${candidateTest.id}`),
    ...candidate.artifacts.filter((artifact) => artifact.required).map((artifact) => `artifact:${artifact.id}`),
  ];
}

function missingEvidenceResult(required, actual) {
  const missing = required.filter((subject) => !actual.has(subject));
  if (missing.length === 0) return { kind: "success" };
  return {
    kind: "structured_error",
    error: {
      category: "qualification",
      code: "missing_evidence",
      field_path: "evidence",
      referenced_entity_ids: missing.map((subject) => subject.replace(/^fixture:/, "")),
    },
  };
}

function parityRecord(runtime, signedVolumeNm3) {
  const hash = "a".repeat(64);
  return {
    runtime,
    result: {
      kind: "success",
      body_count: 1,
      manifold: true,
      orientation: "outward",
      aabb_nm: [0, 0, 0, 10, 10, 10],
      signed_volume_nm3: signedVolumeNm3,
      surface_area_nm2: 600,
      centroid_nm: [5, 5, 5],
      analytic_classification: ["plane"],
      stable_identity_sets: { retained: [], replaced: [] },
      canonical_document_hash: hash,
    },
    accepted_document_hash_before: hash,
    accepted_document_hash_after: hash,
    body_hashes_before: [],
    body_hashes_after: [hash],
  };
}

function stalePreviewAssertionsMatch(descriptor, assertions) {
  const payload = descriptor.input.payload;
  return JSON.stringify(assertions.completion_order) === JSON.stringify(payload.completion_order)
    && JSON.stringify(assertions.requested_distances_nm) === JSON.stringify([payload.first_distance_nm, payload.second_distance_nm])
    && JSON.stringify(assertions.delivered_distances_nm) === JSON.stringify([payload.second_distance_nm, payload.first_distance_nm])
    && assertions.accepted_distance_nm === descriptor.expected.result.accepted_distance_nm
    && assertions.accepted_document_unchanged_during_preview === true
    && JSON.stringify(assertions.lifecycle_steps_completed) === JSON.stringify(descriptor.lifecycle_steps)
    && descriptor.lifecycle_steps.every((step) => assertions[`${step}_completed`] === true);
}

function createEditAssertionsMatch(descriptor, assertions) {
  const payload = descriptor.input.payload;
  return JSON.stringify(assertions.flows_exercised) === JSON.stringify(payload.flows)
    && assertions.distance_nm === payload.distance_nm
    && assertions.canonical_definitions_equal === descriptor.expected.result.canonical_definitions_equal
    && assertions.camera_invariant_handle === descriptor.expected.result.camera_invariant_handle
    && assertions.selected_region_replacement_persisted === descriptor.expected.result.selected_region_replacement_persisted
    && assertions.selected_region_replacement_source_sketch_retained === true
    && assertions.selected_region_replacement_cancel_restored === descriptor.expected.result.cancel_restored_accepted_state
    && assertions.selected_region_replacement_feature_id_retained === descriptor.expected.result.feature_and_body_ids_retained
    && assertions.selected_region_replacement_body_id_retained === descriptor.expected.result.feature_and_body_ids_retained
    && assertions.selected_region_replacement_recompute_correct === descriptor.expected.result.recompute_and_reload_persisted
    && assertions.selected_region_replacement_reload_persisted === descriptor.expected.result.recompute_and_reload_persisted
    && descriptor.expected.result.cross_sketch_replacement_rejected === true
    && descriptor.expected.result.cross_sketch_accepted_state_unchanged === true
    && descriptor.expected.result.cross_sketch_references_unchanged === true
    && descriptor.expected.result.cross_sketch_feature_and_body_ids_retained === true
    && descriptor.expected.result.cross_sketch_geometry_unchanged === true
    && descriptor.expected.result.cross_sketch_feature_count_unchanged === true
    && descriptor.expected.result.cross_sketch_no_invalid_preview_or_commit === true
    && descriptor.expected.result.cross_sketch_explicit_error === true
    && descriptor.expected.result.cross_sketch_zero_preview_or_commit_dispatch === true
    && descriptor.expected.result.cross_sketch_edit_blocked === true
    && descriptor.expected.result.cross_sketch_error_reason_present === true
    && assertions.cross_sketch_replacement_rejected === true
    && assertions.cross_sketch_accepted_document_hash_unchanged === true
    && assertions.cross_sketch_feature_id_retained === true
    && assertions.cross_sketch_body_id_retained === true
    && assertions.cross_sketch_source_sketch_reference_unchanged === true
    && assertions.cross_sketch_support_reference_unchanged === true
    && assertions.cross_sketch_region_reference_unchanged === true
    && assertions.cross_sketch_geometry_bounds_unchanged === true
    && assertions.cross_sketch_feature_count_unchanged === true
    && assertions.cross_sketch_no_invalid_preview === true
    && assertions.cross_sketch_no_invalid_commit === true
    && assertions.cross_sketch_explicit_edit_error === true
    && assertions.cross_sketch_edit_blocked === true
    && assertions.cross_sketch_error_reason === "The selected replacement profile must belong to this Extrude's source sketch and resolved support."
    && assertions.cross_sketch_preview_dispatch_count === 0
    && assertions.cross_sketch_commit_dispatch_count === 0
    && assertions.cross_sketch_recompute_unchanged === true
    && assertions.cross_sketch_reload_unchanged === true
    && assertions.tool_first_without_profile_selection === true
    && assertions.selection_first_profile_selected === true
    && assertions.timeline_edit_retained_feature === true
    && JSON.stringify(assertions.lifecycle_steps_completed) === JSON.stringify(descriptor.lifecycle_steps)
    && descriptor.lifecycle_steps.every((step) => assertions[`${step}_completed`] === true);
}

test("incomplete-candidate fixture omits exactly the descriptor-declared evidence subject", async () => {
  const fixtureId = "qualification-incomplete-candidate";
  const value = await context(fixtureId);
  const omittedFixture = value.descriptor.input.payload.omit_fixture;
  const structural = spawnSync("pwsh", ["-NoProfile", "-File", path.join(repositoryRoot, "scripts/test-solid-feature-candidate.ps1"), "-Manifest", manifestPath], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(structural.status, 0, structural.stderr || structural.stdout);
  const required = requiredSubjects(value.candidate);
  const otherwisePassedEvidence = new Map(required.map((subject) => [subject, { status: "passed" }]));
  assert.equal(otherwisePassedEvidence.delete(`fixture:${omittedFixture}`), true);
  assert.ok([...otherwisePassedEvidence.values()].every((record) => record.status === "passed"));
  const actual = new Set(otherwisePassedEvidence.keys());
  assert.equal(actual.size, required.length - 1);
  const result = missingEvidenceResult(required, actual);
  assert.deepEqual(result, value.descriptor.expected);
  await persistEvidence(evidenceRecord(value, fixtureId, "non-parity-self-tests", result, {
    candidate_schema_valid: true,
    all_present_evidence_passed: true,
    otherwise_complete_subject_count: required.length,
    actual_subject_count: actual.size,
    only_missing_subject: `fixture:${omittedFixture}`,
  }));
});

test("deliberate-divergence fixture uses declared values and structured error", async () => {
  const fixtureId = "parity-deliberate-divergence";
  const value = await context(fixtureId);
  const payload = value.descriptor.input.payload;
  const differences = compareEvidence(
    value.descriptor,
    parityRecord("native", payload.native),
    parityRecord("release_wasm", payload.release_wasm),
  );
  assert.ok(differences.some((difference) => difference.field_path === `result.${payload.field}`));
  const result = {
    kind: "structured_error",
    error: {
      category: "qualification",
      code: "parity_difference",
      field_path: `result.${payload.field}`,
      referenced_entity_ids: [],
    },
  };
  assert.deepEqual(result, value.descriptor.expected);
  await persistEvidence(evidenceRecord(value, fixtureId, "non-parity-self-tests", result, {
    native_value: payload.native,
    release_wasm_value: payload.release_wasm,
    difference_count: differences.length,
  }));
});

test("incomplete-candidate self-test refuses an extra missing subject", async () => {
  const value = await context("qualification-incomplete-candidate");
  const required = requiredSubjects(value.candidate);
  const actual = new Set(required);
  actual.delete("fixture:extrude-origin-blind-rectangle");
  actual.delete("fixture:extrude-origin-blind-circle");
  assert.notDeepEqual(missingEvidenceResult(required, actual), value.descriptor.expected);
});

test("deliberate-divergence self-test refuses equal runtime values", async () => {
  const value = await context("parity-deliberate-divergence");
  const declared = value.descriptor.input.payload.native;
  assert.deepEqual(
    compareEvidence(value.descriptor, parityRecord("native", declared), parityRecord("release_wasm", declared)),
    [],
  );
});

test("stale-preview fixture binding rejects wrong delivery order or a missing lifecycle step", async () => {
  const { descriptor } = await context("extrude-stale-preview");
  const exact = {
    completion_order: ["second", "first"],
    requested_distances_nm: [4_000_000, 9_000_000],
    delivered_distances_nm: [9_000_000, 4_000_000],
    accepted_distance_nm: 9_000_000,
    accepted_document_unchanged_during_preview: true,
    lifecycle_steps_completed: ["preview", "cancel", "commit", "edit", "recompute"],
    preview_completed: true,
    cancel_completed: true,
    commit_completed: true,
    edit_completed: true,
    recompute_completed: true,
  };
  assert.equal(stalePreviewAssertionsMatch(descriptor, exact), true);
  assert.equal(stalePreviewAssertionsMatch(descriptor, { ...exact, delivered_distances_nm: [4_000_000, 9_000_000] }), false);
  assert.equal(stalePreviewAssertionsMatch(descriptor, { ...exact, recompute_completed: false }), false);
});

test("create/edit fixture binding rejects omitted or false cross-sketch evidence", async () => {
  const { descriptor } = await context("extrude-create-edit-equivalence");
  const exact = {
    flows_exercised: ["tool_first", "selection_first", "timeline_edit", "timeline_edit_selected_region_replacement", "timeline_edit_cross_sketch_replacement_rejected"],
    distance_nm: 4_000_000,
    canonical_definitions_equal: true,
    camera_invariant_handle: true,
    tool_first_without_profile_selection: true,
    selection_first_profile_selected: true,
    timeline_edit_retained_feature: true,
    selected_region_replacement_persisted: true,
    selected_region_replacement_source_sketch_retained: true,
    selected_region_replacement_cancel_restored: true,
    selected_region_replacement_feature_id_retained: true,
    selected_region_replacement_body_id_retained: true,
    selected_region_replacement_recompute_correct: true,
    selected_region_replacement_reload_persisted: true,
    cross_sketch_replacement_rejected: true,
    cross_sketch_accepted_document_hash_unchanged: true,
    cross_sketch_feature_id_retained: true,
    cross_sketch_body_id_retained: true,
    cross_sketch_source_sketch_reference_unchanged: true,
    cross_sketch_support_reference_unchanged: true,
    cross_sketch_region_reference_unchanged: true,
    cross_sketch_geometry_bounds_unchanged: true,
    cross_sketch_feature_count_unchanged: true,
    cross_sketch_no_invalid_preview: true,
    cross_sketch_no_invalid_commit: true,
    cross_sketch_explicit_edit_error: true,
    cross_sketch_edit_blocked: true,
    cross_sketch_error_reason: "The selected replacement profile must belong to this Extrude's source sketch and resolved support.",
    cross_sketch_preview_dispatch_count: 0,
    cross_sketch_commit_dispatch_count: 0,
    cross_sketch_recompute_unchanged: true,
    cross_sketch_reload_unchanged: true,
    lifecycle_steps_completed: ["preview", "cancel", "commit", "edit", "recompute", "reload"],
    preview_completed: true,
    cancel_completed: true,
    commit_completed: true,
    edit_completed: true,
    recompute_completed: true,
    reload_completed: true,
  };
  assert.equal(createEditAssertionsMatch(descriptor, exact), true);
  assert.equal(createEditAssertionsMatch(descriptor, { ...exact, flows_exercised: ["selection_first", "timeline_edit"] }), false);
  assert.equal(createEditAssertionsMatch(descriptor, { ...exact, camera_invariant_handle: false }), false);
  assert.equal(createEditAssertionsMatch(descriptor, { ...exact, cross_sketch_replacement_rejected: false }), false);
  assert.equal(createEditAssertionsMatch(descriptor, { ...exact, cross_sketch_commit_dispatch_count: 1 }), false);
  assert.equal(createEditAssertionsMatch(descriptor, { ...exact, cross_sketch_edit_blocked: false }), false);
  assert.equal(createEditAssertionsMatch(descriptor, { ...exact, cross_sketch_error_reason: "" }), false);
  const missingCrossSketchAssertion = { ...exact };
  delete missingCrossSketchAssertion.cross_sketch_support_reference_unchanged;
  assert.equal(createEditAssertionsMatch(descriptor, missingCrossSketchAssertion), false);
});
