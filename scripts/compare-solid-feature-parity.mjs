import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

const SHA256 = /^[a-f0-9]{64}$/;

function parseArgs(argv) {
  const values = {
    manifest: "contracts/solid-feature-candidate/sprint-1.json",
    native: "artifacts/solid-feature-qualification/current/runtime/native",
    wasm: "artifacts/solid-feature-qualification/current/runtime/release-wasm",
    output: "artifacts/solid-feature-qualification/current/parity/parity.json",
    junit: "artifacts/solid-feature-qualification/current/parity/parity.junit.xml",
  };
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]?.replace(/^--/, "");
    if (!Object.hasOwn(values, key) || argv[index + 1] === undefined) throw new Error(`Unknown or incomplete argument '${argv[index] ?? ""}'.`);
    values[key] = argv[index + 1];
  }
  return values;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function sorted(value) {
  return [...value].sort((left, right) => String(left).localeCompare(String(right)));
}

export function hasManifestParityBinding(candidate, fixture) {
  const parityTestIds = new Set(
    (candidate.tests ?? [])
      .filter((testCase) => testCase.kind === "parity")
      .map((testCase) => testCase.id),
  );
  return (fixture.evidence_test_ids ?? []).some((id) => parityTestIds.has(id));
}

function exact(pathName, left, right, differences) {
  if (canonicalJson(left) !== canonicalJson(right)) differences.push({ field_path: pathName, native: left, release_wasm: right });
}

function numeric(pathName, left, right, absolute, relative, differences) {
  if (typeof left !== "number" || typeof right !== "number" || !Number.isFinite(left) || !Number.isFinite(right)) {
    differences.push({ field_path: pathName, native: left, release_wasm: right, reason: "non_finite_or_non_numeric" });
    return;
  }
  const allowed = Math.max(absolute, relative * Math.max(Math.abs(left), Math.abs(right)));
  if (Math.abs(left - right) > allowed) differences.push({ field_path: pathName, native: left, release_wasm: right, allowed_difference: allowed });
}

function numericArray(pathName, left, right, absolute, relative, differences) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    differences.push({ field_path: pathName, native: left, release_wasm: right, reason: "array_shape" });
    return;
  }
  left.forEach((value, index) => numeric(`${pathName}[${index}]`, value, right[index], absolute, relative, differences));
}

function assertEvidence(record, runtime, fixtureId, candidate, manifestHash, descriptorSha256, inputSha256) {
  if (!record || record.schema_version !== 1) throw new Error(`${runtime}/${fixtureId}: unsupported evidence schema.`);
  if (record.fixture_id !== fixtureId || record.runtime !== runtime) throw new Error(`${runtime}/${fixtureId}: evidence identity mismatch.`);
  if (record.fixture_descriptor_sha256 !== descriptorSha256 || record.normalized_input_sha256 !== inputSha256) throw new Error(`${runtime}/${fixtureId}: evidence is not bound to the consumed fixture descriptor/input.`);
  if (record.candidate_id !== candidate.candidate_id || record.candidate_revision !== candidate.revision || record.manifest_sha256 !== manifestHash) {
    throw new Error(`${runtime}/${fixtureId}: stale evidence.`);
  }
  if (record.status !== "passed") throw new Error(`${runtime}/${fixtureId}: status '${record.status}' cannot satisfy parity.`);
  if (!record.result || !["success", "structured_error"].includes(record.result.kind)) throw new Error(`${runtime}/${fixtureId}: invalid result.`);
  for (const key of ["accepted_document_hash_before", "accepted_document_hash_after"]) {
    if (!SHA256.test(record[key] ?? "")) throw new Error(`${runtime}/${fixtureId}: invalid ${key}.`);
  }
}

export function compareEvidence(fixture, nativeRecord, wasmRecord) {
  const differences = [];
  const left = nativeRecord.result;
  const right = wasmRecord.result;
  exact("result.kind", left.kind, right.kind, differences);
  if (left.kind !== right.kind) return differences;
  if (left.kind === "structured_error") {
    for (const field of ["category", "code", "field_path"]) exact(`result.${field}`, left[field], right[field], differences);
    exact("result.referenced_entity_ids", sorted(left.referenced_entity_ids ?? []), sorted(right.referenced_entity_ids ?? []), differences);
    for (const record of [nativeRecord, wasmRecord]) {
      if (record.accepted_document_hash_before !== record.accepted_document_hash_after) {
        differences.push({ field_path: `${record.runtime}.accepted_document_hash`, reason: "negative_result_mutated_document" });
      }
      if (JSON.stringify(record.body_hashes_before) !== JSON.stringify(record.body_hashes_after)) {
        differences.push({ field_path: `${record.runtime}.body_hashes`, reason: "negative_result_mutated_bodies" });
      }
    }
  } else {
    for (const field of ["body_count", "manifold", "orientation", "canonical_document_hash"]) exact(`result.${field}`, left[field], right[field], differences);
    exact("result.analytic_classification", sorted(left.analytic_classification ?? []), sorted(right.analytic_classification ?? []), differences);
    exact("result.stable_identity_sets.retained", sorted(left.stable_identity_sets?.retained ?? []), sorted(right.stable_identity_sets?.retained ?? []), differences);
    exact("result.stable_identity_sets.replaced", sorted(left.stable_identity_sets?.replaced ?? []), sorted(right.stable_identity_sets?.replaced ?? []), differences);
    const tolerance = fixture.tolerances;
    numericArray("result.aabb_nm", left.aabb_nm, right.aabb_nm, tolerance.aabb_nm, tolerance.relative, differences);
    numeric("result.signed_volume_nm3", left.signed_volume_nm3, right.signed_volume_nm3, tolerance.signed_volume_nm3, tolerance.relative, differences);
    numeric("result.surface_area_nm2", left.surface_area_nm2, right.surface_area_nm2, tolerance.surface_area_nm2, tolerance.relative, differences);
    numericArray("result.centroid_nm", left.centroid_nm, right.centroid_nm, tolerance.centroid_nm, tolerance.relative, differences);
  }
  exact("accepted_document_hash_before", nativeRecord.accepted_document_hash_before, wasmRecord.accepted_document_hash_before, differences);
  exact("accepted_document_hash_after", nativeRecord.accepted_document_hash_after, wasmRecord.accepted_document_hash_after, differences);
  exact("body_hashes_before", sorted(nativeRecord.body_hashes_before ?? []), sorted(wasmRecord.body_hashes_before ?? []), differences);
  exact("body_hashes_after", sorted(nativeRecord.body_hashes_after ?? []), sorted(wasmRecord.body_hashes_after ?? []), differences);
  exact("oracle_assertions", nativeRecord.oracle_assertions ?? {}, wasmRecord.oracle_assertions ?? {}, differences);
  return differences;
}

export function validateEvidenceAgainstFixture(fixture, record) {
  const differences = [];
  const expected = fixture.expected;
  const executedArray = record.executed_lifecycle_steps ?? [];
  const executed = new Set(executedArray);
  const declaredArray = fixture.lifecycle_steps ?? [];
  const declared = new Set(declaredArray);
  if (declared.size !== declaredArray.length) differences.push({ field_path: "lifecycle_steps", actual: declaredArray, reason: "duplicate_declared_lifecycle_step" });
  if (executed.size !== executedArray.length) differences.push({ field_path: "executed_lifecycle_steps", actual: executedArray, reason: "duplicate_lifecycle_step" });
  for (const step of fixture.lifecycle_steps) if (!executed.has(step)) differences.push({ field_path: "executed_lifecycle_steps", expected: step, actual: [...executed].sort(), reason: "declared_lifecycle_step_not_executed" });
  for (const step of executed) if (!declared.has(step)) differences.push({ field_path: "executed_lifecycle_steps", actual: step, reason: "undeclared_lifecycle_step_executed" });
  exact("result.kind", expected.kind, record.result?.kind, differences);
  if (expected.kind === "structured_error") {
    for (const field of ["category", "code", "field_path"]) exact(`result.${field}`, expected.error[field], record.result?.[field], differences);
    exact("result.referenced_entity_ids", sorted(expected.error.referenced_entity_ids ?? []), sorted(record.result?.referenced_entity_ids ?? []), differences);
    if (record.accepted_document_hash_before !== record.accepted_document_hash_after) differences.push({ field_path: "accepted_document_hash", reason: "negative_result_mutated_document" });
    if (JSON.stringify(sorted(record.body_hashes_before ?? [])) !== JSON.stringify(sorted(record.body_hashes_after ?? []))) differences.push({ field_path: "body_hashes", reason: "negative_result_mutated_bodies" });
    exact(
      "oracle_assertions",
      expected.oracle_assertions ?? {},
      record.oracle_assertions ?? {},
      differences,
    );
    return differences;
  }
  const tolerance = fixture.tolerances;
  const normalizedResultFields = new Set([
    "body_count", "manifold", "orientation", "expected_bounds_nm", "signed_volume_nm3",
    "surface_area_nm2", "centroid_nm", "analytic_classification",
  ]);
  const expectedAssertionFields = new Set(Object.keys(expected.result).filter((field) => !normalizedResultFields.has(field)));
  for (const field of Object.keys(record.oracle_assertions ?? {})) {
    if (!expectedAssertionFields.has(field)) differences.push({ field_path: `oracle_assertions.${field}`, actual: record.oracle_assertions[field], reason: "unexpected_fixture_oracle_field" });
  }
  for (const [field, value] of Object.entries(expected.result)) {
    const actualField = field === "expected_bounds_nm" ? "aabb_nm" : field;
    const actual = record.result?.[actualField] ?? record.oracle_assertions?.[field];
    if (actual === undefined) {
      differences.push({ field_path: `result.${field}`, expected: value, actual, reason: "missing_fixture_oracle_field" });
    } else if (["aabb_nm", "expected_bounds_nm"].includes(field)) {
      numericArray(`result.${field}`, value, actual, tolerance.aabb_nm, tolerance.relative, differences);
    } else if (field === "centroid_nm") {
      numericArray(`result.${field}`, value, actual, tolerance.centroid_nm, tolerance.relative, differences);
    } else if (field === "signed_volume_nm3") {
      numeric(`result.${field}`, value, actual, tolerance.signed_volume_nm3, tolerance.relative, differences);
    } else if (field === "surface_area_nm2") {
      numeric(`result.${field}`, value, actual, tolerance.surface_area_nm2, tolerance.relative, differences);
    } else if (field === "analytic_classification") {
      exact(`result.${field}`, sorted(value), sorted(actual ?? []), differences);
    } else {
      exact(`result.${field}`, value, actual, differences);
    }
  }
  exact("result.stable_identity_sets.retained", sorted(fixture.identity_sets.retained ?? []), sorted(record.result?.stable_identity_sets?.retained ?? []), differences);
  exact("result.stable_identity_sets.replaced", sorted(fixture.identity_sets.replaced ?? []), sorted(record.result?.stable_identity_sets?.replaced ?? []), differences);
  return differences;
}

function xml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const manifestBytes = await readFile(options.manifest);
  const manifestHash = sha256(manifestBytes);
  const candidate = JSON.parse(manifestBytes.toString("utf8"));
  const testIds = new Set(candidate.tests.map((testCase) => testCase.id));
  const allFixtures = new Map();
  for (const fixtureRef of candidate.fixtures) {
    const descriptorBytes = await readFile(fixtureRef.path);
    const fixture = JSON.parse(descriptorBytes);
    if (fixture.fixture_id !== fixtureRef.id) throw new Error(`Fixture descriptor identity mismatch for '${fixtureRef.id}'.`);
    if (!Array.isArray(fixture.evidence_test_ids) || fixture.evidence_test_ids.length === 0) throw new Error(`Fixture '${fixtureRef.id}' has no explicit evidence-test binding.`);
    const unknownTests = fixture.evidence_test_ids.filter((id) => !testIds.has(id));
    if (unknownTests.length > 0) throw new Error(`Fixture '${fixtureRef.id}' binds unknown evidence tests: ${unknownTests.join(", ")}.`);
    if (fixtureRef.parity_required && !hasManifestParityBinding(candidate, fixture)) throw new Error(`Parity fixture '${fixtureRef.id}' is not bound to a manifest parity test.`);
    allFixtures.set(fixtureRef.id, { fixture, descriptorSha256: sha256(descriptorBytes), inputSha256: sha256(Buffer.from(canonicalJson(fixture.input))) });
  }
  const fixtureRefs = candidate.fixtures.filter((fixture) => fixture.parity_required);
  if (fixtureRefs.length === 0) throw new Error("Candidate contains no parity-required fixtures.");

  for (const [runtime, directory] of [["native", options.native], ["release_wasm", options.wasm]]) {
    const names = await readdir(directory).catch(() => { throw new Error(`${runtime} evidence directory is absent: ${directory}`); });
    const expected = new Set(fixtureRefs.map((fixture) => `${fixture.id}.json`));
    const unknown = names.filter((name) => name.endsWith(".json") && !expected.has(name));
    if (unknown.length > 0) throw new Error(`${runtime} evidence contains unknown records: ${unknown.join(", ")}`);
  }

  const results = [];
  for (const fixtureRef of fixtureRefs) {
    const binding = allFixtures.get(fixtureRef.id);
    const fixture = binding.fixture;
    const nativeRecord = await readJson(path.join(options.native, `${fixtureRef.id}.json`)).catch(() => { throw new Error(`Missing native evidence for '${fixtureRef.id}'.`); });
    const wasmRecord = await readJson(path.join(options.wasm, `${fixtureRef.id}.json`)).catch(() => { throw new Error(`Missing release-WASM evidence for '${fixtureRef.id}'.`); });
    assertEvidence(nativeRecord, "native", fixtureRef.id, candidate, manifestHash, binding.descriptorSha256, binding.inputSha256);
    assertEvidence(wasmRecord, "release_wasm", fixtureRef.id, candidate, manifestHash, binding.descriptorSha256, binding.inputSha256);
    const differences = compareEvidence(fixture, nativeRecord, wasmRecord);
    for (const [runtime, record] of [["native", nativeRecord], ["release_wasm", wasmRecord]]) {
      for (const mismatch of validateEvidenceAgainstFixture(fixture, record)) differences.push({ ...mismatch, runtime });
    }
    results.push({ fixture_id: fixtureRef.id, status: differences.length === 0 ? "passed" : "failed", differences });
  }

  const failures = results.filter((result) => result.status !== "passed");
  const summary = {
    schema_version: 1,
    candidate_id: candidate.candidate_id,
    candidate_revision: candidate.revision,
    manifest_sha256: manifestHash,
    status: failures.length === 0 ? "passed" : "failed",
    compared_fixture_count: results.length,
    results,
  };
  await mkdir(path.dirname(options.output), { recursive: true });
  await mkdir(path.dirname(options.junit), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(summary, null, 2)}\n`);
  const cases = results.map((result) => {
    const failure = result.status === "failed" ? `<failure message="native/release-WASM divergence">${xml(JSON.stringify(result.differences))}</failure>` : "";
    return `  <testcase classname="solid-feature-parity" name="${xml(result.fixture_id)}">${failure}</testcase>`;
  }).join("\n");
  await writeFile(options.junit, `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="solid-feature-parity" tests="${results.length}" failures="${failures.length}">\n${cases}\n</testsuite>\n`);
  if (failures.length > 0) throw new Error(`${failures.length} native/release-WASM parity comparison(s) failed.`);
  process.stdout.write(`Native/release-WASM parity passed for ${results.length} fixture(s).\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  run().catch((error) => {
    process.stderr.write(`Solid-feature parity failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
