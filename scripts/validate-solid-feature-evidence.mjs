import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { validateEvidenceAgainstFixture } from "./compare-solid-feature-parity.mjs";

const options = { manifest: "contracts/solid-feature-candidate/sprint-1.json", evidence: "", runtime: "" };
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index]?.replace(/^--/, "");
  if (!Object.hasOwn(options, key) || process.argv[index + 1] === undefined) throw new Error(`Unknown or incomplete argument '${process.argv[index] ?? ""}'.`);
  options[key] = process.argv[index + 1];
}
if (!options.evidence || !["native", "release_wasm"].includes(options.runtime)) throw new Error("--evidence and --runtime are required.");
const candidate = JSON.parse(await readFile(options.manifest, "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const canonicalJson = (value) => Array.isArray(value) ? `[${value.map(canonicalJson).join(",")}]` : value !== null && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}` : JSON.stringify(value);
const failures = [];
for (const fixtureRef of candidate.fixtures.filter((fixture) => fixture.parity_required)) {
  const descriptorBytes = await readFile(fixtureRef.path), fixture = JSON.parse(descriptorBytes);
  const record = JSON.parse(await readFile(path.join(options.evidence, `${fixtureRef.id}.json`), "utf8"));
  const differences = validateEvidenceAgainstFixture(fixture, record);
  if (record.fixture_descriptor_sha256 !== sha256(descriptorBytes)) differences.push({ field_path: "fixture_descriptor_sha256", reason: "descriptor_binding_mismatch" });
  if (record.normalized_input_sha256 !== sha256(Buffer.from(canonicalJson(fixture.input)))) differences.push({ field_path: "normalized_input_sha256", reason: "input_binding_mismatch" });
  if (differences.length > 0) failures.push({ fixture_id: fixtureRef.id, differences });
}
if (failures.length > 0) {
  process.stderr.write(`${options.runtime} fixture-oracle validation failed for ${failures.length} fixture(s):\n${JSON.stringify(failures, null, 2)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${options.runtime} fixture-oracle validation passed for all parity fixtures.\n`);
}
