import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { cutProfileGeometry, observeDistanceOracle, observeRegionOracle, rationalSurfaceIsCylindrical, s5CutRequest, structuredErrorFromRuntime } from "./export-solid-feature-wasm-evidence.mjs";

const root = path.resolve(import.meta.dirname, "..");
const exporter = path.join(root, "scripts/export-solid-feature-wasm-evidence.mjs");
const wasm = path.join(root, "web/crawler-app/src/generated/runtime/crawler_part_runtime_bg.wasm");
const modulePath = path.join(root, "web/crawler-app/src/generated/runtime/crawler_part_runtime.js");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("Sprint 5 release-WASM export executes and validates all nineteen parity fixtures", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "crawler-wasm-sprint5-all-"));
  try {
    const candidate = JSON.parse(await readFile(path.join(root, "contracts/solid-feature-candidate/sprint-5.json"), "utf8"));
    const parityFixtureCount = candidate.fixtures.filter((fixture) => fixture.parity_required).length;
    assert.equal(parityFixtureCount, 19, "Sprint 5 revision 3 must retain its exact nineteen-fixture parity matrix");
    candidate.runtime_lock.wasm_sha256 = sha256(await readFile(wasm));
    candidate.artifacts.find((artifact) => artifact.id === candidate.runtime_lock.wasm_artifact_id).expected_sha256 = candidate.runtime_lock.wasm_sha256;
    const manifest = path.join(temporary, "sprint-5.json"), output = path.join(temporary, "release-wasm");
    await writeFile(manifest, `${JSON.stringify(candidate, null, 2)}\n`);
    const exported = spawnSync(process.execPath, [exporter, "--manifest", manifest, "--output", output, "--module", modulePath, "--wasm", wasm], { cwd: root, encoding: "utf8", timeout: 180_000 });
    assert.equal(exported.status, 0, `${exported.stdout}\n${exported.stderr}`);
    assert.equal((await readdir(output)).filter((name) => name.endsWith(".json")).length, parityFixtureCount);
    const validated = spawnSync(process.execPath, [path.join(root, "scripts/validate-solid-feature-evidence.mjs"), "--manifest", manifest, "--evidence", output, "--runtime", "release_wasm"], { cwd: root, encoding: "utf8", timeout: 60_000 });
    assert.equal(validated.status, 0, `${validated.stdout}\n${validated.stderr}`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("release-WASM topology classifier proves a rational cylinder and rejects a deformed NURBS", () => {
  const surface = {
    control_points: [
      [{ w: 1, x: 6.5, y: 3, z: 0 }, { w: 1, x: 6.5, y: 3, z: 2 }],
      [{ w: .75, x: 4.875, y: 2.625, z: 0 }, { w: .75, x: 4.875, y: 2.625, z: 1.5 }],
      [{ w: .5, x: 2.875, y: 2.25, z: 0 }, { w: .5, x: 2.875, y: 2.25, z: 1 }],
      [{ w: .5, x: 2.125, y: 2.25, z: 0 }, { w: .5, x: 2.125, y: 2.25, z: 1 }],
      [{ w: .75, x: 2.625, y: 2.625, z: 0 }, { w: .75, x: 2.625, y: 2.625, z: 1.5 }],
      [{ w: 1, x: 3.5, y: 3, z: 0 }, { w: 1, x: 3.5, y: 3, z: 2 }],
    ],
    knot_vecs: [[0, 0, 0, .25, .5, .75, 1, 1, 1], [0, 0, 1, 1]],
  };
  assert.equal(rationalSurfaceIsCylindrical(surface), true);
  const deformed = structuredClone(surface);
  deformed.control_points[2][0].x = 2.5;
  deformed.control_points[2][1].x = 2.5;
  assert.equal(rationalSurfaceIsCylindrical(deformed), false);
});

test("Sprint 5 Cut adapter preserves symmetric normalization at the scalar kernel bridge", () => {
  const request = s5CutRequest("probe", { id: "sketch:probe" }, { kind: "origin_plane_reference", plane: "origin-plane:xy" }, {
    distance_nm: 1_000_000, direction: "symmetric", visible_total_distance_nm: 2_000_000,
  }, false);
  assert.equal(request.target_body_id, "body:part");
  assert.equal(Object.hasOwn(request, "target_body_ids"), false);
  assert.throws(() => s5CutRequest("bad", {}, {}, { distance_nm: 2, direction: "symmetric", visible_total_distance_nm: 2 }, false), /visible-total/);
});

test("Sprint 5 Cut adapter builds exact descriptor-owned rectangle, annulus, and line-arc geometry", () => {
  const rectangle = cutProfileGeometry({ kind: "rectangle", min_nm: [2, 1], max_nm: [8, 5] });
  assert.deepEqual(rectangle["geometry:cut-rectangle"].geometry, { kind: "rectangle", min: { x_nm: 2, y_nm: 1 }, max: { x_nm: 8, y_nm: 5 } });
  const annulus = cutProfileGeometry({ kind: "annulus", center_nm: [5, 3], outer_radius_nm: 2, inner_radius_nm: 1 });
  assert.equal(Object.keys(annulus).length, 2);
  const capsule = cutProfileGeometry({ kind: "line_arc_loop", segments: [
    { kind: "line", start_nm: [3, 2], end_nm: [7, 2] },
    { kind: "arc", center_nm: [7, 3], radius_nm: 1, start_radians: -Math.PI / 2, sweep_radians: Math.PI },
  ] });
  assert.equal(capsule["geometry:cut-capsule:0"].geometry.kind, "line");
  assert.deepEqual(capsule["geometry:cut-capsule:1"].geometry, {
    kind: "arc", center: { x_nm: 7, y_nm: 3 }, start: { x_nm: 7, y_nm: 2 }, end: { x_nm: 7, y_nm: 4 }, clockwise: false,
  });
});

test("semantic oracle helpers use durable document and request observations", () => {
  const document = {
    region_definitions_v2: {
      "region:any-runtime-id": { id: "region:any-runtime-id", outer_geometry_ids: ["rectangle:observed"], hole_geometry_ids: [["circle:a"], ["circle:b"]] },
    },
    feature_definitions_v2: {
      "feature:extrude-reload-edit": { operation: { extent: { distance: "parameter:observed-distance" } } },
    },
    parameters: { "parameter:observed-distance": { value: { kind: "length_nanometers", value: 7_000_000 } } },
  };
  assert.deepEqual(observeRegionOracle(document, "region-two-hole-plate"), { region_count: 1, hole_count: 2 });
  assert.deepEqual(observeRegionOracle(document, "region-creation-order-permutation"), { canonical_region_id: "region:any-runtime-id" });
  assert.deepEqual(observeDistanceOracle(document, "extrude-reload-edit"), { final_distance_nm: 7_000_000 });
});

test("negative oracle identity comes from the observed failing request", () => {
  const sketch = { geometry: { "curve:observed": { geometry: { kind: "control_point_spline" } } } };
  assert.deepEqual(
    structuredErrorFromRuntime("Extrude profile is open or branched", sketch, [], { input: { kind: "extrude_v2" } }),
    { kind: "structured_error", category: "capability", code: "unsupported_curve_kind", field_path: "sketch.geometry[curve:observed].geometry.kind", referenced_entity_ids: ["curve:observed"] },
  );
  assert.deepEqual(
    structuredErrorFromRuntime("Extrude selected profile is stale", { geometry: {} }, ["region:observed"], { input: { kind: "region_edit" } }),
    { kind: "structured_error", category: "repair", code: "region_topology_changed", field_path: "feature.operation.profile.region", referenced_entity_ids: ["region:observed"] },
  );
  assert.throws(() => structuredErrorFromRuntime("unrelated failure", { geometry: {} }, []), /unclassified runtime error/);

  const missingBase = { input: { kind: "construction_plane_missing_reference_v3", payload: { base_plane: "origin.missing" } } };
  assert.deepEqual(
    structuredErrorFromRuntime("invalid part document: missing_construction_plane_base_plane at construction_plane.base_plane: referenced entity origin.missing is missing", { geometry: {} }, [], missingBase),
    { kind: "structured_error", category: "reference", code: "missing_construction_plane_base_plane", field_path: "construction_plane.base_plane", referenced_entity_ids: ["origin.missing"] },
  );
  const missingOffset = { input: { kind: "construction_plane_missing_parameter_v3", payload: { offset_parameter: "parameter:missing-offset" } } };
  assert.deepEqual(
    structuredErrorFromRuntime("invalid part document: missing_construction_plane_offset_parameter at construction_plane.offset_parameter: referenced entity parameter:missing-offset is missing", { geometry: {} }, [], missingOffset),
    { kind: "structured_error", category: "reference", code: "missing_construction_plane_offset_parameter", field_path: "construction_plane.offset_parameter", referenced_entity_ids: ["parameter:missing-offset"] },
  );
  const wrongType = { input: { kind: "construction_plane_wrong_type_parameter_v3", payload: { offset_parameter: "parameter:boolean-offset" } } };
  assert.deepEqual(
    structuredErrorFromRuntime("wrong_type_construction_plane_offset_parameter at construction_plane.offset_parameter: referenced entity parameter:boolean-offset is boolean", { geometry: {} }, [], wrongType),
    { kind: "structured_error", category: "reference", code: "wrong_type_construction_plane_offset_parameter", field_path: "construction_plane.offset_parameter", referenced_entity_ids: ["parameter:boolean-offset"] },
  );
  const unsafe = { input: { kind: "construction_plane_unsafe_parameter_v3", payload: { offset_parameter: "parameter:unsafe-offset" } } };
  assert.deepEqual(
    structuredErrorFromRuntime("unsafe_construction_plane_offset_parameter at construction_plane.offset_parameter: referenced entity parameter:unsafe-offset has value 9007199254740992", { geometry: {} }, [], unsafe),
    { kind: "structured_error", category: "reference", code: "unsafe_construction_plane_offset_parameter", field_path: "construction_plane.offset_parameter", referenced_entity_ids: ["parameter:unsafe-offset"] },
  );
  for (const [kind, code, referenceField, reference] of [
    ["extrude_missing_construction_plane_support_v3", "missing_construction_plane_support", "plane", "construction-plane:missing-support"],
    ["extrude_suppressed_construction_plane_support_v3", "suppressed_construction_plane_support", "plane", "construction-plane:suppressed-support"],
    ["extrude_invalid_construction_plane_dependency_v3", "invalid_construction_plane_dependency", "invalid_dependency", "origin-plane:missing-dependency"],
  ]) {
    const supportDescriptor = { input: { kind, payload: { [referenceField]: reference } } };
    assert.deepEqual(
      structuredErrorFromRuntime(`${code} at extrude.support: referenced entity ${reference}`, { geometry: {} }, [], supportDescriptor),
      { kind: "structured_error", category: "reference", code, field_path: "extrude.support", referenced_entity_ids: [reference] },
    );
  }
});

test("standalone release-WASM export records only executed runtime-owned assertions and steps", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "crawler-wasm-oracle-"));
  try {
    const candidate = JSON.parse(await readFile(path.join(root, "contracts/solid-feature-candidate/sprint-1.json"), "utf8"));
    candidate.runtime_lock.wasm_sha256 = sha256(await readFile(wasm));
    const manifest = path.join(temporary, "candidate.json");
    const output = path.join(temporary, "release-wasm");
    await writeFile(manifest, `${JSON.stringify(candidate, null, 2)}\n`);
    const run = spawnSync(process.execPath, [exporter, "--manifest", manifest, "--output", output, "--module", modulePath, "--wasm", wasm], {
      cwd: root,
      encoding: "utf8",
      timeout: 120_000,
    });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    const names = (await readdir(output)).sort();
    assert.equal(names.length, 15);
    assert.equal(names.includes("extrude-stale-preview.json"), false);
    assert.equal(names.includes("extrude-create-edit-equivalence.json"), false);

    const records = new Map();
    for (const name of names) {
      const record = JSON.parse(await readFile(path.join(output, name), "utf8"));
      records.set(record.fixture_id, record);
      assert.equal(record.status, "passed");
      if (record.result.kind === "success") {
        const fixtureRef = candidate.fixtures.find((fixture) => fixture.id === record.fixture_id);
        const descriptor = JSON.parse(await readFile(path.join(root, fixtureRef.path), "utf8"));
        assert.deepEqual(record.result.stable_identity_sets, descriptor.identity_sets);
      }
      assert.equal(Object.hasOwn(record, "oracle_assertions"), true);
      assert.equal(Object.hasOwn(record.oracle_assertions, "stale_result_ignored"), false);
      assert.equal(Object.hasOwn(record.oracle_assertions, "camera_invariant_handle"), false);
      assert.equal(new Set(record.executed_lifecycle_steps).size, record.executed_lifecycle_steps.length);
    }

    assert.deepEqual(records.get("feature-definition-v2-roundtrip").oracle_assertions, {
      profile_region_reference: "region:geometry:outer|holes:geometry:hole-1",
      ordered_outer_geometry_ids: ["geometry:outer"],
      ordered_hole_geometry_ids: ["geometry:hole-1"],
      canonical_roundtrip: true,
    });
    assert.deepEqual(records.get("extrude-origin-annulus").oracle_assertions, { hole_count: 1 });
    assert.deepEqual(records.get("region-two-hole-plate").oracle_assertions, { region_count: 1, hole_count: 2 });
    assert.deepEqual(records.get("region-creation-order-permutation").oracle_assertions, { canonical_region_id: "region:rectangle:outer|holes:circle:a;circle:b" });
    assert.deepEqual(records.get("extrude-origin-planes").oracle_assertions, { supports_qualified: ["origin.xy", "origin.xz", "origin.yz"], body_count_each: 1 });
    const reloadEdit = records.get("extrude-reload-edit");
    assert.deepEqual(reloadEdit.oracle_assertions, {
      final_distance_nm: 7_000_000,
      upstream_edit_recomputed: true,
      upstream_profile_kind: "circle",
    });
    assert.deepEqual(reloadEdit.result.aabb_nm, [-5_000_000, -5_000_000, 0, 5_000_000, 5_000_000, 7_000_000]);
    assert.ok(reloadEdit.result.stable_identity_sets.retained.length > 0);
    assert.ok(reloadEdit.result.stable_identity_sets.replaced.length > 0);
    assert.deepEqual(reloadEdit.executed_lifecycle_steps, ["commit", "edit", "recompute", "reload", "save"]);
    assert.deepEqual(records.get("legacy-solid-operation-matrix").oracle_assertions, {
      required_dispositions: ["preserve_v1", "preserve_v2"],
      automatic_v1_to_v2_migration: false,
      future_schema_disposition: "reject",
      downgrade_disposition: "reject",
      polygon_sweep_relabelled: false,
    });

    for (const id of ["feature-definition-v2-missing-reference", "profile-unsupported-spline", "region-invalid-open-loop", "region-invalid-overlap", "region-split-merge-repair"]) {
      const record = records.get(id);
      assert.equal(record.accepted_document_hash_before, record.accepted_document_hash_after, id);
      assert.deepEqual(record.body_hashes_before, record.body_hashes_after, id);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("Sprint 2 release-WASM export is selected by manifest and observes durable direction", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "crawler-wasm-direction-oracle-"));
  try {
    const candidate = JSON.parse(await readFile(path.join(root, "contracts/solid-feature-candidate/sprint-2.json"), "utf8"));
    candidate.runtime_lock.wasm_sha256 = sha256(await readFile(wasm));
    const manifest = path.join(temporary, "candidate.json");
    const output = path.join(temporary, "release-wasm");
    await writeFile(manifest, `${JSON.stringify(candidate, null, 2)}\n`);
    const run = spawnSync(process.execPath, [exporter, "--manifest", manifest, "--output", output, "--module", modulePath, "--wasm", wasm], {
      cwd: root,
      encoding: "utf8",
      timeout: 120_000,
    });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    assert.deepEqual((await readdir(output)).sort(), [
      "extrude-origin-blind-negative.json",
      "extrude-origin-blind-symmetric.json",
    ]);

    const negative = JSON.parse(await readFile(path.join(output, "extrude-origin-blind-negative.json"), "utf8"));
    assert.equal(negative.status, "passed");
    assert.deepEqual(negative.result.aabb_nm, [-5_000_000, -3_000_000, -4_000_000, 5_000_000, 3_000_000, 0]);
    assert.deepEqual(negative.result.centroid_nm, [0, 0, -2_000_000]);
    assert.deepEqual(negative.oracle_assertions, {
      descriptor_direction: "negative",
      durable_direction: "negative",
      direction_roundtrip: true,
      durable_distance_nm: 4_000_000,
      distance_semantics: "one_sided_length",
      measured_bounds_nm: [-5_000_000, -3_000_000, -4_000_000, 5_000_000, 3_000_000, 0],
      measured_centroid_nm: [0, 0, -2_000_000],
      stable_feature_id: "feature:extrude-origin-blind-negative",
      stable_body_id: "body:extrude-origin-blind-negative",
    });

    const symmetric = JSON.parse(await readFile(path.join(output, "extrude-origin-blind-symmetric.json"), "utf8"));
    assert.equal(symmetric.status, "passed");
    assert.deepEqual(symmetric.result.aabb_nm, [-5_000_000, -3_000_000, -4_000_000, 5_000_000, 3_000_000, 4_000_000]);
    assert.deepEqual(symmetric.result.centroid_nm, [0, 0, 0]);
    assert.deepEqual(symmetric.oracle_assertions, {
      descriptor_direction: "symmetric",
      durable_direction: "symmetric",
      direction_roundtrip: true,
      durable_distance_nm: 4_000_000,
      distance_semantics: "half_length",
      measured_bounds_nm: [-5_000_000, -3_000_000, -4_000_000, 5_000_000, 3_000_000, 4_000_000],
      measured_centroid_nm: [0, 0, 0],
      stable_feature_id: "feature:extrude-origin-blind-symmetric",
      stable_body_id: "body:extrude-origin-blind-symmetric",
    });
    for (const record of [negative, symmetric]) {
      assert.deepEqual(record.executed_lifecycle_steps, ["commit", "edit", "preview", "recompute", "reload", "save"]);
      assert.notEqual(record.accepted_document_hash_before, record.accepted_document_hash_after);
      assert.equal(record.body_hashes_after.length, 1);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("Sprint 3 release-WASM export executes every owned fixture with exact descriptor oracles", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "crawler-wasm-offset-plane-oracle-"));
  try {
    const candidate = JSON.parse(await readFile(path.join(root, "contracts/solid-feature-candidate/sprint-3.json"), "utf8"));
    candidate.runtime_lock.wasm_sha256 = sha256(await readFile(wasm));
    candidate.artifacts.find((artifact) => artifact.id === candidate.runtime_lock.wasm_artifact_id).expected_sha256 = candidate.runtime_lock.wasm_sha256;
    const manifest = path.join(temporary, "candidate.json");
    const output = path.join(temporary, "release-wasm");
    await writeFile(manifest, `${JSON.stringify(candidate, null, 2)}\n`);
    const run = spawnSync(process.execPath, [exporter, "--manifest", manifest, "--output", output, "--module", modulePath, "--wasm", wasm], {
      cwd: root,
      encoding: "utf8",
      timeout: 120_000,
    });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    assert.deepEqual((await readdir(output)).sort(), candidate.fixtures.map(({ id }) => `${id}.json`).sort());

    for (const fixtureRef of candidate.fixtures) {
      const descriptor = JSON.parse(await readFile(path.join(root, fixtureRef.path), "utf8"));
      const record = JSON.parse(await readFile(path.join(output, `${fixtureRef.id}.json`), "utf8"));
      assert.equal(record.fixture_id, fixtureRef.id);
      assert.equal(record.status, "passed");
      assert.deepEqual(record.executed_lifecycle_steps, [...descriptor.lifecycle_steps].sort());
      if (descriptor.expected.result) {
        assert.deepEqual(record.oracle_assertions, descriptor.expected.result, `${fixtureRef.id} oracle assertions`);
        assert.deepEqual(record.result.stable_identity_sets, descriptor.identity_sets, `${fixtureRef.id} identity sets`);
      } else {
        assert.deepEqual(record.oracle_assertions, {});
        assert.deepEqual(record.result, { kind: descriptor.expected.kind, ...descriptor.expected.error }, `${fixtureRef.id} structured error`);
        assert.equal(record.accepted_document_hash_before, record.accepted_document_hash_after, fixtureRef.id);
        assert.deepEqual(record.body_hashes_before, record.body_hashes_after, fixtureRef.id);
      }
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("Sprint 4 release-WASM export executes all parity fixtures exactly and repeatably", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "crawler-wasm-planar-face-oracle-"));
  try {
    const candidate = JSON.parse(await readFile(path.join(root, "contracts/solid-feature-candidate/sprint-4.json"), "utf8"));
    candidate.runtime_lock.wasm_sha256 = sha256(await readFile(wasm));
    candidate.artifacts.find((artifact) => artifact.id === candidate.runtime_lock.wasm_artifact_id).expected_sha256 = candidate.runtime_lock.wasm_sha256;
    const manifest = path.join(temporary, "candidate.json");
    await writeFile(manifest, `${JSON.stringify(candidate, null, 2)}\n`);

    const exportTo = (output) => spawnSync(process.execPath, [exporter, "--manifest", manifest, "--output", output, "--module", modulePath, "--wasm", wasm], {
      cwd: root,
      encoding: "utf8",
      timeout: 120_000,
    });
    const firstOutput = path.join(temporary, "release-wasm-first");
    const secondOutput = path.join(temporary, "release-wasm-second");
    const firstRun = exportTo(firstOutput);
    assert.equal(firstRun.status, 0, `${firstRun.stdout}\n${firstRun.stderr}`);
    const secondRun = exportTo(secondOutput);
    assert.equal(secondRun.status, 0, `${secondRun.stdout}\n${secondRun.stderr}`);

    const parityFixtures = candidate.fixtures.filter((fixture) => fixture.parity_required === true);
    assert.equal(parityFixtures.length, 10);
    assert.deepEqual((await readdir(firstOutput)).sort(), parityFixtures.map(({ id }) => `${id}.json`).sort());
    for (const fixtureRef of parityFixtures) {
      const descriptor = JSON.parse(await readFile(path.join(root, fixtureRef.path), "utf8"));
      const first = JSON.parse(await readFile(path.join(firstOutput, `${fixtureRef.id}.json`), "utf8"));
      const second = JSON.parse(await readFile(path.join(secondOutput, `${fixtureRef.id}.json`), "utf8"));
      assert.equal(first.status, "passed", `${fixtureRef.id}: ${JSON.stringify(first.result)}`);
      assert.equal(second.status, "passed", `repeat ${fixtureRef.id}: ${JSON.stringify(second.result)}`);
      for (const field of [
        "result",
        "oracle_assertions",
        "accepted_document_hash_before",
        "accepted_document_hash_after",
        "body_hashes_before",
        "body_hashes_after",
        "executed_lifecycle_steps",
      ]) assert.deepEqual(first[field], second[field], `${fixtureRef.id}.${field} determinism`);

      assert.deepEqual(first.executed_lifecycle_steps, [...descriptor.lifecycle_steps].sort(), `${fixtureRef.id} lifecycle`);
      if (descriptor.expected.kind === "structured_error") {
        assert.deepEqual(first.result, { kind: "structured_error", ...descriptor.expected.error }, `${fixtureRef.id} diagnostic`);
        assert.equal(first.accepted_document_hash_before, first.accepted_document_hash_after, `${fixtureRef.id} document atomicity`);
        assert.deepEqual(first.body_hashes_before, first.body_hashes_after, `${fixtureRef.id} body atomicity`);
      } else {
        assert.deepEqual(first.oracle_assertions, descriptor.expected.result, `${fixtureRef.id} result oracle`);
        assert.deepEqual(first.result.stable_identity_sets, descriptor.identity_sets, `${fixtureRef.id} identity oracle`);
      }
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("Sprint 3 signed-edit evidence executes and observes the exact zero-offset boundary", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "crawler-wasm-offset-plane-zero-"));
  try {
    const candidate = JSON.parse(await readFile(path.join(root, "contracts/solid-feature-candidate/sprint-3.json"), "utf8"));
    candidate.runtime_lock.wasm_sha256 = sha256(await readFile(wasm));
    candidate.artifacts.find((artifact) => artifact.id === candidate.runtime_lock.wasm_artifact_id).expected_sha256 = candidate.runtime_lock.wasm_sha256;
    const fixtureRef = candidate.fixtures.find((fixture) => fixture.id === "extrude-offset-plane-signed-edit");
    const descriptor = JSON.parse(await readFile(path.join(root, fixtureRef.path), "utf8"));
    const expectedZeroAssertions = {
      zero_offset_frame_origin_nm: [0, 0, 0],
      zero_offset_bounds_nm: [-5_000_000, -3_000_000, 0, 5_000_000, 3_000_000, 4_000_000],
      zero_offset_stable_plane_id: "construction-plane:extrude-offset-plane-signed-edit",
      zero_offset_stable_sketch_id: "sketch:extrude-offset-plane-signed-edit",
      zero_offset_stable_feature_id: "feature:extrude-offset-plane-signed-edit",
      zero_offset_stable_body_id: "body:extrude-offset-plane-signed-edit",
    };
    descriptor.input.payload.zero_offset_nanometers = 0;
    Object.assign(descriptor.expected.result, expectedZeroAssertions);
    const descriptorPath = path.join(temporary, "extrude-offset-plane-signed-edit.json");
    await writeFile(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`);
    fixtureRef.path = descriptorPath;
    const manifest = path.join(temporary, "candidate.json"), output = path.join(temporary, "release-wasm");
    await writeFile(manifest, `${JSON.stringify(candidate, null, 2)}\n`);
    const run = spawnSync(process.execPath, [exporter, "--manifest", manifest, "--output", output, "--module", modulePath, "--wasm", wasm], {
      cwd: root,
      encoding: "utf8",
      timeout: 120_000,
    });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    const record = JSON.parse(await readFile(path.join(output, "extrude-offset-plane-signed-edit.json"), "utf8"));
    assert.equal(record.status, "passed");
    for (const [field, expected] of Object.entries(expectedZeroAssertions)) assert.deepEqual(record.oracle_assertions[field], expected, field);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("Sprint 3 revision-2 parameter and support negatives execute real release-WASM refusal and repair lifecycles", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "crawler-wasm-offset-plane-parameter-negatives-"));
  try {
    const candidate = JSON.parse(await readFile(path.join(root, "contracts/solid-feature-candidate/sprint-3.json"), "utf8"));
    candidate.revision = 2;
    candidate.runtime_lock.wasm_sha256 = sha256(await readFile(wasm));
    candidate.artifacts.find((artifact) => artifact.id === candidate.runtime_lock.wasm_artifact_id).expected_sha256 = candidate.runtime_lock.wasm_sha256;
    const tolerances = { relative: 1e-9, aabb_nm: 1, signed_volume_nm3: 1_000_000, surface_area_nm2: 1_000, centroid_nm: 1 };
    const descriptors = [
      {
        schema_version: 1,
        fixture_id: "construction-plane-wrong-type-offset-parameter",
        story_ids: ["E3D-S3-01", "E3D-S3-02", "E3D-S3-04"],
        description: "An attempt to bind a Boolean offset parameter is refused atomically by construction-plane preview and commit.",
        units: { length: "nanometer", angle: "radian" },
        input: { schema_version: 3, kind: "construction_plane_wrong_type_parameter_v3", payload: {
          plane: "construction-plane:wrong-type-offset", base_plane: "origin.xy", offset_parameter: "parameter:wrong-type-offset",
          parameter_value: { kind: "boolean", value: true }, request_offset_nanometers: 0, attempted_offset_nanometers: 0,
          repair_offset_nanometers: 0, repair_offset_parameter: "parameter:wrong-type-offset:repair", distance_nm: 4_000_000,
          direction: "positive", profile: "rectangle-10x6mm",
        } },
        expected: { kind: "structured_error", error: { category: "reference", code: "wrong_type_construction_plane_offset_parameter", field_path: "construction_plane.offset_parameter", referenced_entity_ids: ["parameter:wrong-type-offset"] } },
        tolerances,
        identity_sets: { retained: ["body:accepted-before-construction-plane-error"], replaced: [] },
        lifecycle_steps: ["preview", "commit", "save", "reopen", "repair"],
        evidence_test_ids: ["construction-plane-document-contracts", "native-construction-plane-offset-extrude", "wasm-construction-plane-offset-extrude", "construction-plane-offset-native-wasm-parity"],
        legacy_provenance: null,
      },
      {
        schema_version: 1,
        fixture_id: "construction-plane-unsafe-offset-parameter",
        story_ids: ["E3D-S3-01", "E3D-S3-02", "E3D-S3-04"],
        description: "An attempt to bind an offset outside the exact JavaScript-safe nanometer range is refused atomically by construction-plane preview and commit.",
        units: { length: "nanometer", angle: "radian" },
        input: { schema_version: 3, kind: "construction_plane_unsafe_parameter_v3", payload: {
          plane: "construction-plane:unsafe-offset", base_plane: "origin.xy", offset_parameter: "parameter:unsafe-offset",
          parameter_value: { kind: "length_nanometers", value: 9_007_199_254_740_992 }, request_offset_nanometers: 0,
          attempted_offset_nanometers: 0, repair_offset_nanometers: 9_007_199_254_740_991, distance_nm: 4_000_000,
          direction: "positive", profile: "rectangle-10x6mm",
        } },
        expected: { kind: "structured_error", error: { category: "reference", code: "unsafe_construction_plane_offset_parameter", field_path: "construction_plane.offset_parameter", referenced_entity_ids: ["parameter:unsafe-offset"] } },
        tolerances,
        identity_sets: { retained: ["body:accepted-before-construction-plane-error"], replaced: [] },
        lifecycle_steps: ["preview", "commit", "save", "reopen", "repair"],
        evidence_test_ids: ["construction-plane-document-contracts", "native-construction-plane-offset-extrude", "wasm-construction-plane-offset-extrude", "construction-plane-offset-native-wasm-parity"],
        legacy_provenance: null,
      },
    ];
    for (const [fixtureId, kind, plane, parameter, code, referencedEntityIds] of [
      ["extrude-missing-construction-plane-support", "extrude_missing_construction_plane_support_v3", "construction-plane:missing-support", "parameter:missing-support-offset", "missing_construction_plane_support", ["construction-plane:missing-support"]],
      ["extrude-suppressed-construction-plane-support", "extrude_suppressed_construction_plane_support_v3", "construction-plane:suppressed-support", "parameter:suppressed-support-offset", "suppressed_construction_plane_support", ["construction-plane:suppressed-support"]],
      ["extrude-invalid-construction-plane-dependency", "extrude_invalid_construction_plane_dependency_v3", "construction-plane:invalid-dependency", "parameter:invalid-dependency-offset", "invalid_construction_plane_dependency", ["origin-plane:missing-dependency"]],
    ]) descriptors.push({
      schema_version: 1,
      fixture_id: fixtureId,
      story_ids: ["E3D-S3-02", "E3D-S3-03", "E3D-S3-04"],
      description: "An invalid construction-plane Extrude support is refused atomically and remains repairable.",
      units: { length: "nanometer", angle: "radian" },
      input: { schema_version: 3, kind, payload: { plane, offset_parameter: parameter, invalid_dependency: "origin-plane:missing-dependency" } },
      expected: { kind: "structured_error", error: { category: "reference", code, field_path: "extrude.support", referenced_entity_ids: referencedEntityIds } },
      tolerances,
      identity_sets: { retained: ["body:accepted-before-construction-plane-error"], replaced: [] },
      lifecycle_steps: kind === "extrude_invalid_construction_plane_dependency_v3" ? ["load", "save", "reopen", "repair"] : ["preview", "save", "reopen", "repair"],
      evidence_test_ids: ["construction-plane-document-contracts", "native-construction-plane-offset-extrude", "wasm-construction-plane-offset-extrude", "construction-plane-offset-native-wasm-parity"],
      legacy_provenance: null,
    });
    for (const descriptor of descriptors) {
      const descriptorPath = path.join(temporary, `${descriptor.fixture_id}.json`);
      await writeFile(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`);
      const existing = candidate.fixtures.find((fixture) => fixture.id === descriptor.fixture_id);
      if (existing) existing.path = descriptorPath;
      else candidate.fixtures.push({ id: descriptor.fixture_id, path: descriptorPath, parity_required: true });
    }
    const manifest = path.join(temporary, "candidate.json"), output = path.join(temporary, "release-wasm");
    await writeFile(manifest, `${JSON.stringify(candidate, null, 2)}\n`);
    const run = spawnSync(process.execPath, [exporter, "--manifest", manifest, "--output", output, "--module", modulePath, "--wasm", wasm], {
      cwd: root,
      encoding: "utf8",
      timeout: 120_000,
    });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    for (const descriptor of descriptors) {
      const record = JSON.parse(await readFile(path.join(output, `${descriptor.fixture_id}.json`), "utf8"));
      assert.equal(record.status, "passed", descriptor.fixture_id);
      assert.deepEqual(record.result, { kind: "structured_error", ...descriptor.expected.error });
      assert.deepEqual(record.executed_lifecycle_steps, [...descriptor.lifecycle_steps].sort());
      assert.equal(record.accepted_document_hash_before, record.accepted_document_hash_after);
      assert.deepEqual(record.body_hashes_before, record.body_hashes_after);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("Sprint 3 release-WASM fixture ownership rejects missing, extra, and changed kinds", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "crawler-wasm-offset-plane-ownership-"));
  try {
    const baseline = JSON.parse(await readFile(path.join(root, "contracts/solid-feature-candidate/sprint-3.json"), "utf8"));
    baseline.runtime_lock.wasm_sha256 = sha256(await readFile(wasm));
    baseline.artifacts.find((artifact) => artifact.id === baseline.runtime_lock.wasm_artifact_id).expected_sha256 = baseline.runtime_lock.wasm_sha256;

    const runCandidate = async (name, candidate) => {
      const manifest = path.join(temporary, `${name}.json`);
      await writeFile(manifest, `${JSON.stringify(candidate, null, 2)}\n`);
      return spawnSync(process.execPath, [exporter, "--manifest", manifest, "--output", path.join(temporary, name), "--module", modulePath, "--wasm", wasm], {
        cwd: root,
        encoding: "utf8",
        timeout: 120_000,
      });
    };

    const missing = structuredClone(baseline);
    missing.fixtures.pop();
    const missingRun = await runCandidate("missing", missing);
    assert.notEqual(missingRun.status, 0);
    assert.match(`${missingRun.stdout}\n${missingRun.stderr}`, /fixture list differs/i);

    const extra = structuredClone(baseline);
    extra.fixtures.push({ id: "extrude-offset-plane-extra", path: extra.fixtures[0].path, parity_required: true });
    const extraRun = await runCandidate("extra", extra);
    assert.notEqual(extraRun.status, 0);
    assert.match(`${extraRun.stdout}\n${extraRun.stderr}`, /fixture list differs/i);

    const changed = structuredClone(baseline);
    const changedRef = changed.fixtures[0];
    const changedDescriptor = JSON.parse(await readFile(path.join(root, changedRef.path), "utf8"));
    changedDescriptor.input.kind = "extrude_offset_plane_unowned_v3";
    const changedDescriptorPath = path.join(temporary, "changed-kind-fixture.json");
    await writeFile(changedDescriptorPath, `${JSON.stringify(changedDescriptor, null, 2)}\n`);
    changedRef.path = changedDescriptorPath;
    const changedRun = await runCandidate("changed-kind", changed);
    assert.notEqual(changedRun.status, 0);
    assert.match(`${changedRun.stdout}\n${changedRun.stderr}`, /unowned or changed kind/i);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
