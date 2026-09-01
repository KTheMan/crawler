import assert from "node:assert/strict";
import test from "node:test";

import { structuredErrorFromRuntime } from "./export-solid-feature-wasm-evidence.mjs";

test("structured evidence is derived from the observed runtime error and request", () => {
  const spline = {
    geometry: {
      "curve:observed": { geometry: { kind: "control_point_spline" } },
    },
  };
  assert.deepEqual(
    structuredErrorFromRuntime("invalid part document: Extrude profile is open or branched", spline, []),
    {
      kind: "structured_error",
      category: "capability",
      code: "unsupported_curve_kind",
    field_path: "sketch.geometry[curve:observed].geometry.kind",
      referenced_entity_ids: ["curve:observed"],
    },
  );

  const missing = structuredErrorFromRuntime(
    "invalid part document: Extrude selected profile is stale or no longer closed",
    { geometry: {} },
    ["region:observed-missing"],
  );
  assert.deepEqual(missing.referenced_entity_ids, ["region:observed-missing"]);
  assert.equal(missing.code, "missing_reference");
});

test("an unrecognized runtime error refuses evidence instead of manufacturing a result", () => {
  assert.throws(
    () => structuredErrorFromRuntime("different runtime failure", { geometry: {} }, []),
    /unclassified runtime error \(evidence refused\)/,
  );
});
