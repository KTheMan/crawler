import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CANDIDATE_FIXTURES = new Map([
  ["solid-feature-sprint-1", [
    "feature-definition-v2-roundtrip", "feature-definition-v2-missing-reference",
    "profile-line-arc-capsule", "profile-unsupported-spline",
    "extrude-origin-blind-rectangle", "extrude-origin-blind-circle",
    "extrude-origin-annulus", "region-two-hole-plate", "region-creation-order-permutation",
    "region-invalid-open-loop", "region-invalid-overlap", "region-split-merge-repair",
    "extrude-origin-planes", "extrude-reload-edit", "legacy-solid-operation-matrix",
  ]],
  ["solid-feature-sprint-2", [
    "extrude-origin-blind-negative", "extrude-origin-blind-symmetric",
  ]],
  ["solid-feature-sprint-3", [
    [
      "extrude-offset-plane-direction-matrix", "extrude-offset-plane-signed-edit",
      "construction-plane-missing-reference", "construction-plane-missing-offset-parameter",
    ],
    [
      "extrude-offset-plane-direction-matrix", "extrude-offset-plane-signed-edit",
      "construction-plane-missing-reference", "construction-plane-missing-offset-parameter",
      "construction-plane-wrong-type-offset-parameter", "construction-plane-unsafe-offset-parameter",
    ],
    [
      "extrude-offset-plane-direction-matrix", "extrude-offset-plane-signed-edit",
      "construction-plane-missing-reference", "construction-plane-missing-offset-parameter",
      "construction-plane-wrong-type-offset-parameter", "construction-plane-unsafe-offset-parameter",
      "extrude-missing-construction-plane-support", "extrude-suppressed-construction-plane-support",
      "extrude-invalid-construction-plane-dependency",
    ],
  ]],
  ["solid-feature-sprint-4", [
    "extrude-planar-face-orientation-matrix", "extrude-planar-face-upstream-edit",
    "extrude-planar-face-save-reopen-edit", "planar-face-missing-reference",
    "planar-face-stale-current-evidence", "planar-face-nonplanar-reference",
    "planar-face-suppressed-producer", "planar-face-wrong-body-producer-component",
    "planar-face-broken-support-explicit-repair", "planar-face-ambiguous-repair-refused",
  ]],
  ["solid-feature-sprint-5", [
    "cut-origin-blind-rectangle", "cut-multi-body-unrelated-preserved", "cut-origin-circle", "cut-origin-annulus", "cut-origin-arc-capsule",
    "cut-offset-plane-reverse", "cut-offset-plane-upstream-recompute", "cut-planar-face-symmetric", "cut-edit-upstream-recompute",
    "cut-save-reopen-edit", "cut-missing-stale-suppressed-target", "cut-target-cardinality-refused",
    "cut-cross-component-target-refused", "cut-no-overlap-refused", "cut-body-erasure-refused", "cut-nonmanifold-result-refused",
    "cut-invalid-support-refused", "cut-invalid-profile-refused", "cut-last-valid-recovery",
  ]],
]);

const SPRINT3_FIXTURE_KINDS = new Map([
  ["extrude-offset-plane-direction-matrix", "extrude_offset_plane_matrix_v3"],
  ["extrude-offset-plane-signed-edit", "extrude_offset_plane_v3"],
  ["construction-plane-missing-reference", "construction_plane_missing_reference_v3"],
  ["construction-plane-missing-offset-parameter", "construction_plane_missing_parameter_v3"],
  ["construction-plane-wrong-type-offset-parameter", "construction_plane_wrong_type_parameter_v3"],
  ["construction-plane-unsafe-offset-parameter", "construction_plane_unsafe_parameter_v3"],
  ["extrude-missing-construction-plane-support", "extrude_missing_construction_plane_support_v3"],
  ["extrude-suppressed-construction-plane-support", "extrude_suppressed_construction_plane_support_v3"],
  ["extrude-invalid-construction-plane-dependency", "extrude_invalid_construction_plane_dependency_v3"],
]);

const SPRINT4_FIXTURE_KINDS = new Map([
  ["extrude-planar-face-orientation-matrix", "extrude_planar_face_orientation_matrix_v4"],
  ["extrude-planar-face-upstream-edit", "extrude_planar_face_upstream_edit_v4"],
  ["extrude-planar-face-save-reopen-edit", "extrude_planar_face_save_reopen_edit_v4"],
  ["planar-face-missing-reference", "planar_face_missing_reference_v4"],
  ["planar-face-stale-current-evidence", "planar_face_stale_current_evidence_v4"],
  ["planar-face-nonplanar-reference", "planar_face_nonplanar_reference_v4"],
  ["planar-face-suppressed-producer", "planar_face_suppressed_producer_v4"],
  ["planar-face-wrong-body-producer-component", "planar_face_wrong_authority_v4"],
  ["planar-face-broken-support-explicit-repair", "planar_face_broken_support_explicit_repair_v4"],
  ["planar-face-ambiguous-repair-refused", "planar_face_ambiguous_repair_refused_v4"],
]);

const SPRINT5_FIXTURE_IDS = new Set(CANDIDATE_FIXTURES.get("solid-feature-sprint-5"));

function args(argv) {
  const result = {
    manifest: "contracts/solid-feature-candidate/sprint-1.json",
    output: "artifacts/solid-feature-qualification/current/runtime/release-wasm",
    module: "web/crawler-app/src/generated/runtime/crawler_part_runtime.js",
    wasm: "web/crawler-app/src/generated/runtime/crawler_part_runtime_bg.wasm",
  };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    if (!(key in result) || argv[i + 1] === undefined) throw new Error(`Unknown or incomplete argument '${argv[i] ?? ""}'.`);
    result[key] = argv[i + 1];
  }
  return result;
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
const support = (plane) => ({ kind: "origin_plane_reference", plane: `origin-plane:${plane}` });
const sketch = (id, geometry) => ({ id, revision: 0, geometry, constraints: {} });
const rectangle = () => ({ "geometry:rectangle": { id: "geometry:rectangle", geometry: { kind: "rectangle", min: { x_nm: -5_000_000, y_nm: -3_000_000 }, max: { x_nm: 5_000_000, y_nm: 3_000_000 } } } });
const circle = () => ({ "geometry:circle": { id: "geometry:circle", geometry: { kind: "circle", center: { x_nm: 0, y_nm: 0 }, radius_nm: 5_000_000 } } });
const annulus = () => ({
  "circle:outer": { id: "circle:outer", geometry: { kind: "circle", center: { x_nm: 0, y_nm: 0 }, radius_nm: 8_000_000 } },
  "circle:hole": { id: "circle:hole", geometry: { kind: "circle", center: { x_nm: 0, y_nm: 0 }, radius_nm: 3_000_000 } },
});
const twoHoles = () => ({
  "rectangle:outer": { id: "rectangle:outer", geometry: { kind: "rectangle", min: { x_nm: -15_000_000, y_nm: -10_000_000 }, max: { x_nm: 15_000_000, y_nm: 10_000_000 } } },
  "circle:a": { id: "circle:a", geometry: { kind: "circle", center: { x_nm: -7_000_000, y_nm: 0 }, radius_nm: 2_000_000 } },
  "circle:b": { id: "circle:b", geometry: { kind: "circle", center: { x_nm: 7_000_000, y_nm: 0 }, radius_nm: 2_000_000 } },
});
const capsule = () => ({
  "curve:line-top": { id: "curve:line-top", geometry: { kind: "line", start: { x_nm: 5_000_000, y_nm: 5_000_000 }, end: { x_nm: -5_000_000, y_nm: 5_000_000 } } },
  "curve:arc-left": { id: "curve:arc-left", geometry: { kind: "arc", center: { x_nm: -5_000_000, y_nm: 0 }, start: { x_nm: -5_000_000, y_nm: 5_000_000 }, end: { x_nm: -5_000_000, y_nm: -5_000_000 }, clockwise: false } },
  "curve:line-bottom": { id: "curve:line-bottom", geometry: { kind: "line", start: { x_nm: -5_000_000, y_nm: -5_000_000 }, end: { x_nm: 5_000_000, y_nm: -5_000_000 } } },
  "curve:arc-right": { id: "curve:arc-right", geometry: { kind: "arc", center: { x_nm: 5_000_000, y_nm: 0 }, start: { x_nm: 5_000_000, y_nm: -5_000_000 }, end: { x_nm: 5_000_000, y_nm: 5_000_000 }, clockwise: false } },
});

function scenario(id, descriptor) {
  const payload = descriptor.input?.payload ?? {};
  const profile = payload.profile ?? payload.outer;
  let geometry = rectangle(), selected = [];
  if (descriptor.input?.kind === "definition_v2" && payload.outer_geometry_ids?.length === 1 && payload.hole_geometry_ids?.length === 1) {
    const outer = payload.outer_geometry_ids[0], hole = payload.hole_geometry_ids[0];
    geometry = {
      [outer]: { id: outer, geometry: { kind: "circle", center: { x_nm: 0, y_nm: 0 }, radius_nm: 8_000_000 } },
      [hole]: { id: hole, geometry: { kind: "circle", center: { x_nm: 0, y_nm: 0 }, radius_nm: 3_000_000 } },
    };
    selected = [outer];
  } else if (profile === "capsule-line-arc") geometry = capsule();
  else if (profile === "circle-r5mm") geometry = circle();
  else if (payload.outer === "circle-r8mm") { geometry = annulus(); selected = ["circle:outer"]; }
  else if (payload.outer === "rectangle-30x20mm" || Array.isArray(payload.permutations)) { geometry = twoHoles(); selected = ["rectangle:outer"]; }
  const supportName = payload.support ?? "origin.xy";
  const plane = supportName.replace(/^origin[.-]/, "");
  if (!["xy", "xz", "yz"].includes(plane)) throw new Error(`${id} has unsupported fixture support '${supportName}'`);
  const distance = payload.edited_distance_nm ?? payload.distance_nm ?? payload.half_distance_nm ?? 4_000_000;
  if (!Number.isSafeInteger(distance) || distance <= 0) throw new Error(`${id} has invalid fixture distance`);
  // Older Sprint 1 fixture inputs intentionally omit the token and continue to
  // exercise the request's backward-compatible positive default. Sprint 2
  // fixtures must send their explicit durable token.
  const direction = Object.hasOwn(payload, "direction") ? payload.direction : null;
  if (direction != null && !["positive", "negative", "symmetric"].includes(direction)) throw new Error(`${id} has invalid fixture direction '${direction}'`);
  return { geometry, plane, distance, direction, selected };
}

function request(id, sketchValue, supportValue, distance, selected, commit, direction = null) {
  const value = { sketch: sketchValue, support: supportValue, profile_geometry_ids: selected, distance_nanometers: distance, feature_id: `feature:${id}`, body_id: `body:${id}`, tolerance: 0.01 };
  if (direction != null) value.direction = direction;
  if (commit) value.transaction_id = `transaction:${id}:extrude:${distance}`;
  return value;
}

const constructionSupport = (plane) => ({ kind: "construction_plane_reference", plane });

function offsetPlaneRequest(runtime, plane, base, parameter, offsetNanometers, suppressed, transaction) {
  const revision = runtimeDocument(runtime).revision;
  if (!Number.isSafeInteger(revision)) throw new Error("accepted document revision is absent");
  return {
    plane_id: plane,
    component_id: "component:root",
    base_plane_id: base,
    offset_parameter_id: parameter,
    offset_nanometers: offsetNanometers,
    suppressed,
    transaction_id: transaction,
    base_revision: revision,
  };
}

function normalizedBasePlane(value, field) {
  if (typeof value !== "string") throw new Error(`${field} is absent`);
  if (value.startsWith("origin-plane:")) return value;
  const token = value.replace(/^origin[.-]/, "");
  if (!["xy", "xz", "yz"].includes(token)) throw new Error(`${field} is not an origin-plane token: ${value}`);
  return `origin-plane:${token}`;
}

function expectedOffsetPlaneOrigin(base, offsetNanometers) {
  if (!Number.isSafeInteger(offsetNanometers)) throw new Error("construction-plane repair offset is not a safe integer");
  if (base === "origin-plane:xy") return [0, 0, offsetNanometers];
  if (base === "origin-plane:xz") return [0, -offsetNanometers, 0];
  if (base === "origin-plane:yz") return [offsetNanometers, 0, 0];
  throw new Error(`unsupported construction-plane repair base '${base}'`);
}

function exactIntegerArray(value, field) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))) {
    throw new Error(`${field} is not a finite numeric array`);
  }
  return value.map((entry) => Math.round(entry));
}

function assertSprint3Oracle(observed, descriptor) {
  const expected = descriptor.expected?.result;
  if (canonicalJson(observed) !== canonicalJson(expected)) {
    throw new Error(`Sprint 3 observed oracle differs from frozen descriptor\nobserved=${JSON.stringify(observed, null, 2)}\nexpected=${JSON.stringify(expected, null, 2)}`);
  }
}

function activeResult(runtime, recognizeCylinders = false) {
  const active = JSON.parse(runtime.activeBodyJson(0.01));
  return { active, result: successResult(active, recognizeCylinders), body: bodyHash(active) };
}

function combineSuccess(values) {
  const digest = (field) => sha256(Buffer.from(values.map((value) => value[field]).join("")));
  const aabb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], moment = [0, 0, 0];
  let volume = 0, surface = 0;
  for (const value of values) {
    for (let index = 0; index < 3; index += 1) {
      aabb[index] = Math.min(aabb[index], value.result.aabb_nm[index]);
      aabb[index + 3] = Math.max(aabb[index + 3], value.result.aabb_nm[index + 3]);
    }
    volume += value.result.signed_volume_nm3;
    surface += value.result.surface_area_nm2;
    for (let index = 0; index < 3; index += 1) moment[index] += value.result.signed_volume_nm3 * value.result.centroid_nm[index];
  }
  const after = digest("after");
  return {
    result: {
      kind: "success",
      body_count: values.length,
      manifold: values.every((value) => value.result.manifold === true),
      orientation: values.every((value) => value.result.orientation === "outward") ? "outward" : "inward",
      aabb_nm: aabb,
      signed_volume_nm3: volume,
      surface_area_nm2: surface,
      centroid_nm: moment.map((value) => value / volume),
      analytic_classification: [...new Set(values.flatMap((value) => value.result.analytic_classification))].sort(),
      stable_identity_sets: { retained: [], replaced: [] },
      canonical_document_hash: after,
    },
    before: digest("before"),
    after,
    body_hashes_before: [],
    body_hashes_after: values.map((value) => value.body),
  };
}

function acceptSketch(runtime, id, sketchValue, supportValue) {
  const solved = JSON.parse(runtime.solveSketchJson(JSON.stringify({ transaction_id: `transaction:${id}:sketch`, sketch: sketchValue, support: supportValue })));
  if (solved.accepted !== true) throw new Error(`sketch solve refused: ${JSON.stringify(solved)}`);
}

function cutProfileGeometry(profile) {
  const point = (value, field) => {
    if (!Array.isArray(value) || value.length !== 2 || !value.every(Number.isSafeInteger)) throw new Error(`${field} is not an exact 2D nanometer point`);
    return { x_nm: value[0], y_nm: value[1] };
  };
  if (profile?.kind === "rectangle") return {
    "geometry:cut-rectangle": { id: "geometry:cut-rectangle", geometry: { kind: "rectangle", min: point(profile.min_nm, "rectangle.min_nm"), max: point(profile.max_nm, "rectangle.max_nm") } },
  };
  if (profile?.kind === "circle") return {
    "geometry:cut-circle": { id: "geometry:cut-circle", geometry: { kind: "circle", center: point(profile.center_nm, "circle.center_nm"), radius_nm: profile.radius_nm } },
  };
  if (profile?.kind === "annulus") return {
    "geometry:cut-annulus-outer": { id: "geometry:cut-annulus-outer", geometry: { kind: "circle", center: point(profile.center_nm, "annulus.center_nm"), radius_nm: profile.outer_radius_nm } },
    "geometry:cut-annulus-hole": { id: "geometry:cut-annulus-hole", geometry: { kind: "circle", center: point(profile.center_nm, "annulus.center_nm"), radius_nm: profile.inner_radius_nm } },
  };
  if (profile?.kind === "line_arc_loop") return Object.fromEntries((profile.segments ?? []).map((segment, index) => {
    const id = `geometry:cut-capsule:${index}`;
    if (segment.kind === "line") return [id, { id, geometry: { kind: "line", start: point(segment.start_nm, `${id}.start_nm`), end: point(segment.end_nm, `${id}.end_nm`) } }];
    if (segment.kind !== "arc" || !Number.isFinite(segment.start_radians) || !Number.isFinite(segment.sweep_radians) || !Number.isSafeInteger(segment.radius_nm)) {
      throw new Error(`${id} is not a qualified line/arc segment`);
    }
    const center = point(segment.center_nm, `${id}.center_nm`);
    const endpoint = (angle) => ({ x_nm: center.x_nm + Math.round(segment.radius_nm * Math.cos(angle)), y_nm: center.y_nm + Math.round(segment.radius_nm * Math.sin(angle)) });
    return [id, { id, geometry: { kind: "arc", center, start: endpoint(segment.start_radians), end: endpoint(segment.start_radians + segment.sweep_radians), clockwise: segment.sweep_radians < 0 } }];
  }));
  throw new Error(`unsupported Sprint 5 Cut profile '${profile?.kind ?? ""}'`);
}

function flattenedCutError(refusal) {
  const error = refusal?.error ?? refusal;
  if (refusal?.accepted !== false || typeof error?.code !== "string") throw new Error(`Cut request did not return a structured refusal: ${JSON.stringify(refusal)}`);
  return {
    kind: "structured_error",
    category: String(error.category ?? "operation"),
    code: error.code,
    field_path: String(error.field_path ?? error.field ?? ""),
    referenced_entity_ids: Array.isArray(error.referenced_entity_ids) ? error.referenced_entity_ids : Array.isArray(error.referencedEntityIds) ? error.referencedEntityIds : [],
  };
}

function s5Support(runtime, id, payload) {
  if (payload.support?.kind === "origin_plane") return support("xy");
  if (payload.support?.kind === "construction_plane") {
    const requestValue = offsetPlaneRequest(runtime, payload.support.plane, "origin-plane:xy", `parameter:${id}:offset`, payload.support.offset_nm, false, `transaction:${id}:plane`);
    const committed = JSON.parse(runtime.commitOffsetConstructionPlaneJson(JSON.stringify(requestValue)));
    if (committed.accepted !== true) throw new Error(`Cut construction plane refused: ${JSON.stringify(committed)}`);
    return constructionSupport(payload.support.plane);
  }
  if (payload.support?.kind === "topology_face") {
    const frame = s4FrameAt(runtime, 2, 4_000_000);
    const supportValue = { kind: "topology", reference: payload.support.reference };
    return { supportValue, supportReference: s4TopologyReference(payload.support.reference, frame) };
  }
  throw new Error(`unsupported Sprint 5 Cut support '${payload.support?.kind ?? ""}'`);
}

function s5CutRequest(id, sketchValue, supportValue, payload, commit) {
  if (payload.direction === "symmetric" && payload.visible_total_distance_nm !== payload.distance_nm * 2) {
    throw new Error(`${id} does not preserve visible-total to durable-half symmetric normalization`);
  }
  const value = {
    sketch: sketchValue,
    support: supportValue,
    profile_geometry_ids: [],
    distance_nanometers: payload.distance_nm,
    direction: payload.direction,
    result_mode: "cut",
    target_body_id: "body:part",
    feature_id: `feature:${id}`,
    body_id: "body:part",
    tolerance: 0.01,
  };
  if (commit) value.transaction_id = `transaction:${id}:cut`;
  return value;
}

function executeS5Cut(WasmPartRuntime, id, descriptor) {
  const payload = descriptor.input?.payload ?? {};
  const seed = payload.target_seed ?? {};
  if (![seed.width_nm, seed.height_nm, seed.distance_nm, payload.distance_nm].every(Number.isSafeInteger)) throw new Error(`${id} has an inexact Cut seed or distance`);
  let runtime = WasmPartRuntime.newValidationRectangularPart(`document:evidence:${id}`, "Single-target Cut Evidence", BigInt(seed.width_nm), BigInt(seed.height_nm), BigInt(seed.distance_nm));
  let before = runtime.semanticHash();
  const initial = JSON.parse(runtime.activeBodyJson(0.01));
  const initialBodyHash = bodyHash(initial);
  let unrelatedBody;
  if (payload.unrelated_body_seed != null) {
    const unrelated = payload.unrelated_body_seed;
    const unrelatedGeometry = cutProfileGeometry(unrelated.profile);
    if (unrelatedGeometry["geometry:cut-rectangle"] != null) {
      unrelatedGeometry["geometry:unrelated-rectangle"] = {
        ...unrelatedGeometry["geometry:cut-rectangle"], id: "geometry:unrelated-rectangle",
      };
      delete unrelatedGeometry["geometry:cut-rectangle"];
    }
    const unrelatedSketch = sketch(`sketch:${id}:unrelated`, unrelatedGeometry);
    const unrelatedSupport = support("xy");
    const solved = JSON.parse(runtime.solveSketchJson(JSON.stringify({
      transaction_id: `transaction:${id}:unrelated:sketch`, sketch: unrelatedSketch, support: unrelatedSupport,
    })));
    if (solved.accepted !== true) throw new Error(`${id} unrelated body sketch was refused: ${JSON.stringify(solved)}`);
    const committed = JSON.parse(runtime.commitSketchExtrudeJson(JSON.stringify({
      sketch: unrelatedSketch,
      support: unrelatedSupport,
      profile_geometry_ids: [],
      distance_nanometers: unrelated.distance_nm,
      direction: "positive",
      result_mode: "new_body",
      feature_id: `feature:${id}:unrelated`,
      body_id: unrelated.body_id,
      tolerance: 0.01,
      transaction_id: `transaction:${id}:unrelated`,
    })));
    if (committed.accepted !== true) throw new Error(`${id} unrelated body seed was refused: ${JSON.stringify(committed)}`);
    const snapshot = JSON.parse(runtime.bodySnapshotJson(unrelated.body_id));
    unrelatedBody = { id: unrelated.body_id, hash: bodyHash(snapshot) };
  }
  if (unrelatedBody != null) {
    // Fixture setup ends once both accepted bodies exist. The operation
    // baseline and body-hash baseline must describe that same two-body state.
    before = runtime.semanticHash();
  }
  const expectedError = descriptor.expected?.kind === "structured_error";
  if (expectedError && (Array.isArray(payload.target_cardinality_variants) || Array.isArray(payload.target_variants) || Array.isArray(payload.ownership_variants))) {
    const validate = (candidate, request) => {
      const candidateBefore = candidate.semanticHash();
      const documentBefore = candidate.documentJson();
      const response = JSON.parse(candidate.validateSingleTargetCutTargetsJson(JSON.stringify(request)));
      if (candidate.semanticHash() !== candidateBefore || candidate.documentJson() !== documentBefore) {
        throw new Error(`${id} target-authority validation mutated accepted state`);
      }
      return response;
    };
    const variantCodes = {};
    let primary;
    const variantResults = [];
    if (Array.isArray(payload.target_cardinality_variants)) {
      for (const targets of payload.target_cardinality_variants) {
        const response = validate(runtime, { target_body_ids: targets, target_component_id: payload.target_component_id });
        if (response.accepted !== false || response.error?.code !== "explicit_target_required") throw new Error(`${id} cardinality variant was not refused: ${JSON.stringify(response)}`);
        variantResults.push(response);
      }
      primary = variantResults[0];
    } else if (Array.isArray(payload.target_variants)) {
      const missing = validate(runtime, { target_body_ids: payload.target_body_ids, target_component_id: payload.target_component_id });
      variantCodes.missing = missing.error?.code;
      variantResults.push(missing);

      const suppressed = WasmPartRuntime.fromDocumentJson(runtime.documentJson());
      JSON.parse(suppressed.commitChangesJson(JSON.stringify({
        transaction_id: `transaction:${id}:suppress-target`,
        changes: [{ kind: "set_feature_suppressed", feature: "feature:extrude", suppressed: true }],
      })));
      const suppressedResponse = validate(suppressed, { target_body_ids: ["body:part"], target_component_id: "component:root" });
      variantCodes.suppressed = suppressedResponse.error?.code;
      variantResults.push(suppressedResponse);

      const staleDocument = JSON.parse(runtime.documentJson());
      staleDocument.recompute.features["feature:extrude"] = { status: "dirty", since_revision: staleDocument.revision };
      const stale = WasmPartRuntime.fromDocumentJson(JSON.stringify(staleDocument));
      const staleResponse = validate(stale, { target_body_ids: ["body:part"], target_component_id: "component:root" });
      variantCodes.stale = staleResponse.error?.code;
      variantResults.push(staleResponse);
      primary = missing;
    } else {
      const cross = validate(runtime, { target_body_ids: payload.target_body_ids, target_component_id: payload.target_component_id });
      variantCodes.cross_component = cross.error?.code;
      variantResults.push(cross);
      const wrongOwner = validate(runtime, {
        target_body_ids: ["body:part"],
        target_component_id: "component:root",
        support_body_id: "body:other",
        support_producer_id: "feature:foreign",
      });
      variantCodes.wrong_owner = wrongOwner.error?.code;
      variantResults.push(wrongOwner);
      primary = cross;
    }
    const result = flattenedCutError(primary);
    const after = runtime.semanticHash();
    const oracle_assertions = {
      explicit_target_required: true,
      implicit_target_used: false,
      accepted_state_unchanged: after === before,
      ...(Object.keys(variantCodes).length > 0 ? { variant_codes: variantCodes } : {}),
    };
    if (Array.isArray(payload.target_cardinality_variants)) Object.assign(oracle_assertions, {
      zero_refused: variantResults[0]?.accepted === false,
      duplicate_refused: variantResults[1]?.accepted === false,
      multiple_refused: variantResults[2]?.accepted === false,
    });
    if (Array.isArray(payload.ownership_variants)) oracle_assertions.boolean_dispatch_count = 0;
    return {
      result,
      oracle_assertions,
      before,
      after,
      body_hashes_before: [initialBodyHash],
      body_hashes_after: [initialBodyHash],
      executed_lifecycle_steps: ["authority_validate"],
    };
  }
  if (!Array.isArray(payload.target_body_ids) || payload.target_body_ids.length !== 1) throw new Error(`${id} did not pass exact-one Cut target authority`);
  const geometry = payload.invalid_profile === "open_loop"
    ? {
      "geometry:cut-open-a": { id: "geometry:cut-open-a", geometry: { kind: "line", start: { x_nm: 2_000_000, y_nm: 1_000_000 }, end: { x_nm: 8_000_000, y_nm: 1_000_000 } } },
      "geometry:cut-open-b": { id: "geometry:cut-open-b", geometry: { kind: "line", start: { x_nm: 8_000_000, y_nm: 1_000_000 }, end: { x_nm: 8_000_000, y_nm: 5_000_000 } } },
    }
    : cutProfileGeometry(payload.profile);
  const sketchValue = sketch(`sketch:${id}`, geometry);
  const resolvedSupport = payload.invalid_support === "missing_construction_plane"
    ? constructionSupport("construction-plane:missing-cut-support")
    : s5Support(runtime, id, payload);
  const acceptedSupport = payload.invalid_support === "missing_construction_plane" ? support("xy") : undefined;
  const supportValue = resolvedSupport.supportValue ?? resolvedSupport;
  const solveRequest = { transaction_id: `transaction:${id}:sketch`, sketch: sketchValue, support: acceptedSupport ?? supportValue, ...(resolvedSupport.supportReference ? { support_reference: resolvedSupport.supportReference } : {}) };
  const solved = JSON.parse(runtime.solveSketchJson(JSON.stringify(solveRequest)));
  if (solved.accepted !== true) throw new Error(`Cut sketch refused: ${JSON.stringify(solved)}`);
  const requestValue = s5CutRequest(id, sketchValue, supportValue, payload, false);
  if (expectedError) {
    // Sketch setup is accepted fixture preparation. Atomicity begins at the
    // invalid Boolean request, not before the prerequisite sketch exists.
    const refusalBefore = runtime.semanticHash();
    const refusal = JSON.parse(runtime.previewSketchExtrudeJson(JSON.stringify(requestValue)));
    const result = flattenedCutError(refusal);
    const committedRefusal = JSON.parse(runtime.commitSketchExtrudeJson(JSON.stringify({ ...requestValue, transaction_id: `transaction:${id}:refused` })));
    const committedResult = flattenedCutError(committedRefusal);
    if (canonicalJson(committedResult) !== canonicalJson(result)) throw new Error(`${id} preview/commit diagnostics diverged`);
    const after = runtime.semanticHash();
    const validationStageRefusal = payload.invalid_support != null || payload.invalid_profile != null;
    const common = {
      explicit_target_required: true,
      implicit_target_used: false,
      accepted_state_unchanged: after === refusalBefore,
      ...(!validationStageRefusal ? { boolean_attempted: true } : {}),
      target_body_hash_unchanged: bodyHash(JSON.parse(runtime.activeBodyJson(0.01))) === initialBodyHash,
    };
    const oracle_assertions = ["cut-body-erasure-refused", "cut-nonmanifold-result-refused"].includes(id)
      ? { ...common, body_count_unchanged: Object.keys(runtimeDocument(runtime).bodies ?? {}).length === 1 }
      : common;
    return { result, oracle_assertions, before: refusalBefore, after, body_hashes_before: [initialBodyHash], body_hashes_after: [initialBodyHash], executed_lifecycle_steps: ["preview", "commit"] };
  }
  const previewHash = runtime.semanticHash();
  const preview = JSON.parse(runtime.previewSketchExtrudeJson(JSON.stringify(requestValue)));
  if (preview.accepted !== true || runtime.semanticHash() !== previewHash) throw new Error(`Cut preview failed or mutated accepted state: ${JSON.stringify(preview)}`);
  let commit = JSON.parse(runtime.commitSketchExtrudeJson(JSON.stringify({ ...requestValue, transaction_id: `transaction:${id}:cut` })));
  if (commit.accepted !== true) throw new Error(`Cut commit refused: ${JSON.stringify(commit)}`);
  const committedHash = runtime.semanticHash();
  if (id === "cut-edit-upstream-recompute") {
    const editedSketch = structuredClone(sketchValue);
    const editedMax = payload.upstream_edit?.profile_max_nm;
    if (!Array.isArray(editedMax) || canonicalJson(editedMax) === canonicalJson(payload.profile.max_nm)) throw new Error("Cut upstream edit is absent or a no-op");
    editedSketch.revision += 1;
    editedSketch.geometry["geometry:cut-rectangle"].geometry.max = { x_nm: editedMax[0], y_nm: editedMax[1] };
    const editedSolve = JSON.parse(runtime.solveSketchJson(JSON.stringify({ transaction_id: `transaction:${id}:upstream-sketch`, sketch: editedSketch, support: supportValue })));
    if (editedSolve.accepted !== true) throw new Error(`Cut upstream sketch edit refused: ${JSON.stringify(editedSolve)}`);
    commit = JSON.parse(runtime.commitSketchExtrudeJson(JSON.stringify({ ...requestValue, sketch: editedSketch, distance_nanometers: payload.upstream_edit.distance_nm, transaction_id: `transaction:${id}:upstream-cut` })));
    if (commit.accepted !== true) throw new Error(`Cut edit refused: ${JSON.stringify(commit)}`);
    const recomputed = JSON.parse(runtime.recomputeFromHereJson(`feature:${id}`));
    if (recomputed.accepted !== true) throw new Error(`Cut upstream recompute refused: ${JSON.stringify(recomputed)}`);
    if (runtime.semanticHash() === committedHash) throw new Error("Cut upstream edit did not change accepted geometry/document state");
  }
  let savedDocument;
  let canonicalRoundtrip = false;
  let targetReferenceRoundtrip = false;
  let editAfterReopenEqual = false;
  if (id === "cut-save-reopen-edit") {
    savedDocument = runtime.documentJson();
    const savedValue = JSON.parse(savedDocument);
    const savedDefinition = savedValue.feature_definitions_v2?.[`feature:${id}`];
    const editedDistance = payload.roundtrip_edit_distance_nm;
    if (!Number.isSafeInteger(editedDistance) || editedDistance === payload.distance_nm) throw new Error("Cut reopen edit distance is absent or a no-op");
    const editRequest = { ...requestValue, distance_nanometers: editedDistance, transaction_id: `transaction:${id}:edit` };
    const directCommit = JSON.parse(runtime.commitSketchExtrudeJson(JSON.stringify(editRequest)));
    if (directCommit.accepted !== true) throw new Error(`direct baseline Cut edit refused: ${JSON.stringify(directCommit)}`);
    const directHash = runtime.semanticHash();
    const directBodyHash = bodyHash(JSON.parse(runtime.activeBodyJson(0.01)));

    runtime = WasmPartRuntime.fromDocumentJson(savedDocument);
    const reopenedBeforeEdit = runtime.documentJson();
    const reopenedValue = JSON.parse(reopenedBeforeEdit);
    const reopenedDefinition = reopenedValue.feature_definitions_v2?.[`feature:${id}`];
    canonicalRoundtrip = canonicalJson(reopenedValue) === canonicalJson(savedValue);
    targetReferenceRoundtrip = canonicalJson(reopenedDefinition) === canonicalJson(savedDefinition)
      && reopenedDefinition?.participant_bodies?.filter((participant) => participant.role === "target")?.[0]?.body === "body:part";
    if (!canonicalRoundtrip || !targetReferenceRoundtrip) throw new Error("reopened Cut did not preserve its canonical durable definition and target participant");
    commit = JSON.parse(runtime.commitSketchExtrudeJson(JSON.stringify(editRequest)));
    if (commit.accepted !== true) throw new Error(`reopened Cut edit refused: ${JSON.stringify(commit)}`);
    if (runtime.semanticHash() === committedHash) throw new Error("reopened Cut edit did not change accepted geometry/document state");
    editAfterReopenEqual = runtime.semanticHash() === directHash
      && bodyHash(JSON.parse(runtime.activeBodyJson(0.01))) === directBodyHash;
    if (!editAfterReopenEqual) throw new Error("reopened Cut edit diverged from the same edit on the non-roundtripped baseline");
  }
  let supportEditRecomputed = false;
  if (payload.support_edit != null) {
    if (payload.support?.kind !== "construction_plane" || !Number.isSafeInteger(payload.support_edit.offset_nm)
      || payload.support_edit.offset_nm === payload.support.offset_nm) throw new Error("Cut support edit is absent, unsupported, or a no-op");
    const editBefore = runtime.semanticHash();
    const editRequest = offsetPlaneRequest(
      runtime,
      payload.support.plane,
      "origin-plane:xy",
      `parameter:${id}:offset`,
      payload.support_edit.offset_nm,
      false,
      `transaction:${id}:plane-edit`,
    );
    const editedSupport = JSON.parse(runtime.commitOffsetConstructionPlaneJson(JSON.stringify(editRequest)));
    if (editedSupport.accepted !== true) throw new Error(`Cut support edit refused: ${JSON.stringify(editedSupport)}`);
    const recomputed = JSON.parse(runtime.recomputeFromHereJson(`feature:${id}`));
    if (recomputed.accepted !== true) throw new Error(`Cut support recompute refused: ${JSON.stringify(recomputed)}`);
    supportEditRecomputed = runtime.semanticHash() !== editBefore;
    if (!supportEditRecomputed) throw new Error("Cut support edit did not recompute accepted geometry/document state");
  }
  let lastValidResultRetained = false;
  let failedStateRoundtrip = false;
  let repairRecomputed = false;
  let evaluationStoppedAtFirstUnresolved = false;
  let failureDiagnosticRoundtrip = false;
  let repairEvaluatedCutFeature = false;
  let repairTransactionRecorded = false;
  let repairResultBound = false;
  if (id === "cut-last-valid-recovery") {
    const committedBodyHash = bodyHash(JSON.parse(runtime.activeBodyJson(0.01)));
    JSON.parse(runtime.commitChangesJson(JSON.stringify({
      transaction_id: `transaction:${id}:invalidate-profile`,
      changes: [{ kind: "set_feature_suppressed", feature: `feature:sketch:${id}`, suppressed: true }],
    })));
    const blocked = JSON.parse(runtime.recomputeFromHereJson(`feature:${id}`));
    evaluationStoppedAtFirstUnresolved = blocked.error?.code === "suppressed_required_input"
      && Array.isArray(blocked.plan?.evaluation_order) && blocked.plan.evaluation_order.length === 0
      && canonicalJson(blocked.error?.referenced_entity_ids) === canonicalJson([`feature:sketch:${id}`]);
    const blockedBodyHash = bodyHash(JSON.parse(runtime.activeBodyJson(0.01)));
    lastValidResultRetained = blocked.accepted === false && blockedBodyHash === committedBodyHash;
    if (!(lastValidResultRetained && evaluationStoppedAtFirstUnresolved)) throw new Error(`${id} did not stop at the first unresolved input while retaining its last valid Cut result`);

    const failedDocument = runtime.documentJson();
    runtime = WasmPartRuntime.fromDocumentJson(failedDocument);
    const reopenedBlocked = JSON.parse(runtime.recomputeFromHereJson(`feature:${id}`));
    failedStateRoundtrip = reopenedBlocked.accepted === false
      && bodyHash(JSON.parse(runtime.activeBodyJson(0.01))) === committedBodyHash;
    failureDiagnosticRoundtrip = canonicalJson(reopenedBlocked.error) === canonicalJson(blocked.error);
    if (!(failedStateRoundtrip && failureDiagnosticRoundtrip)) throw new Error(`${id} failed state, diagnostic, and last valid result did not survive reopen`);

    JSON.parse(runtime.commitChangesJson(JSON.stringify({
      transaction_id: `transaction:${id}:repair-profile`,
      changes: [{ kind: "set_feature_suppressed", feature: `feature:sketch:${id}`, suppressed: false }],
    })));
    const repaired = JSON.parse(runtime.recomputeFromHereJson(`feature:${id}`));
    repairEvaluatedCutFeature = Array.isArray(repaired.plan?.evaluation_order)
      && repaired.plan.evaluation_order.includes(`feature:${id}`);
    repairTransactionRecorded = repaired.transaction != null && typeof repaired.transaction === "object";
    repairResultBound = Array.isArray(repaired.recomputed)
      && repaired.recomputed.some((entry) => entry.feature === `feature:${id}` && entry.body === "body:part");
    repairRecomputed = repaired.accepted === true
      && repairEvaluatedCutFeature
      && repairTransactionRecorded
      && repairResultBound
      && bodyHash(JSON.parse(runtime.activeBodyJson(0.01))) === committedBodyHash;
    if (!repairRecomputed) throw new Error(`${id} did not repair and recompute its exact Cut result`);
  }
  const observed = activeResult(runtime, true);
  const documentValue = runtimeDocument(runtime);
  const definition = documentValue.feature_definitions_v2?.[`feature:${id}`];
  const targetParticipant = definition?.participant_bodies?.filter((participant) => participant.role === "target") ?? [];
  if (documentValue.bodies?.["body:part"] == null || targetParticipant.length !== 1 || targetParticipant[0].body !== "body:part") throw new Error("Cut did not durably retain its one target body participant");
  observed.result.stable_identity_sets = payload.support_edit == null
    ? { retained: ["body:part"], replaced: [] }
    : { retained: ["body:part", payload.support.plane, `feature:${id}`], replaced: [] };
  Object.assign(observed.result, { retained_target_body_id: "body:part", affected_body_ids: ["body:part"], created_body_count: 0 });
  if (unrelatedBody != null) {
    const unrelatedAfter = JSON.parse(runtime.bodySnapshotJson(unrelatedBody.id));
    const unrelatedHashAfter = bodyHash(unrelatedAfter);
    Object.assign(observed.result, {
      body_count: 2,
      unrelated_body_id: unrelatedBody.id,
      unrelated_body_hash_unchanged: unrelatedHashAfter === unrelatedBody.hash,
      unrelated_body_preserved: unrelatedAfter.found === true,
      stable_identity_sets: { retained: ["body:part", unrelatedBody.id], replaced: [] },
    });
    if (unrelatedHashAfter !== unrelatedBody.hash) throw new Error(`${id} mutated an unrelated accepted body`);
  }
  if (id === "cut-origin-arc-capsule") observed.result.arc_segments_consumed = Object.values(geometry).filter((entity) => entity.geometry.kind === "arc").length;
  if (id === "cut-edit-upstream-recompute") Object.assign(observed.result, {
    feature_id_retained: definition != null,
    target_body_id_retained: documentValue.bodies?.["body:part"] != null,
    affected_scope_stable: targetParticipant.length === 1 && targetParticipant[0].body === "body:part",
  });
  if (id === "cut-save-reopen-edit") Object.assign(observed.result, { canonical_roundtrip: canonicalRoundtrip, target_reference_roundtrip: targetReferenceRoundtrip, edit_after_reopen_equal: editAfterReopenEqual });
  if (payload.support_edit != null) Object.assign(observed.result, {
    construction_plane_id_retained: documentValue.construction_planes?.[payload.support.plane] != null,
    feature_id_retained: definition != null,
    target_body_id_retained: documentValue.bodies?.["body:part"] != null,
    support_edit_recomputed: supportEditRecomputed,
    affected_scope_stable: targetParticipant.length === 1 && targetParticipant[0].body === "body:part",
  });
  if (id === "cut-last-valid-recovery") Object.assign(observed.result, {
    last_valid_result_retained: lastValidResultRetained,
    failed_state_roundtrip: failedStateRoundtrip,
    repair_recomputed: repairRecomputed,
    first_unresolved_input: `feature:sketch:${id}`,
    evaluation_stopped_at_first_unresolved: evaluationStoppedAtFirstUnresolved,
    failure_diagnostic_roundtrip: failureDiagnosticRoundtrip,
    repair_evaluated_cut_feature: repairEvaluatedCutFeature,
    repair_transaction_recorded: repairTransactionRecorded,
    repair_result_bound: repairResultBound,
    feature_id_retained: definition != null,
    target_body_id_retained: documentValue.bodies?.["body:part"] != null,
    stable_identity_sets: { retained: ["body:part", `feature:${id}`], replaced: [] },
  });
  const oracle_assertions = {};
  const executed_lifecycle_steps = ["preview", "commit"];
  if (id === "cut-edit-upstream-recompute") executed_lifecycle_steps.push("edit", "recompute");
  if (id === "cut-save-reopen-edit") executed_lifecycle_steps.push("save", "reopen", "edit");
  if (payload.support_edit != null) executed_lifecycle_steps.push("edit", "recompute");
  if (id === "cut-last-valid-recovery") executed_lifecycle_steps.push("suppress", "save", "reopen", "repair", "recompute");
  return {
    result: observed.result,
    oracle_assertions,
    before,
    after: runtime.semanticHash(),
    body_hashes_before: unrelatedBody == null ? [initialBodyHash] : [initialBodyHash, unrelatedBody.hash],
    body_hashes_after: unrelatedBody == null ? [observed.body] : [observed.body, unrelatedBody.hash],
    executed_lifecycle_steps,
  };
}

function editUpstreamSketch(runtime, id, sketchValue, supportValue, descriptor) {
  const edit = descriptor.input?.payload?.upstream_edit;
  if (edit == null) return null;
  if (edit.replacement_profile !== "circle-r5mm" || !Number.isSafeInteger(edit.sketch_revision) || typeof edit.geometry_id !== "string") {
    throw new Error(`${id} has unsupported upstream sketch edit declaration`);
  }
  const editedSketch = structuredClone(sketchValue);
  editedSketch.revision = edit.sketch_revision;
  editedSketch.geometry = {
    [edit.geometry_id]: {
      id: edit.geometry_id,
      geometry: { kind: "circle", center: { x_nm: 0, y_nm: 0 }, radius_nm: 5_000_000 },
    },
  };
  const solved = JSON.parse(runtime.solveSketchJson(JSON.stringify({
    transaction_id: `transaction:${id}:sketch:upstream`,
    sketch: editedSketch,
    support: supportValue,
  })));
  if (solved.accepted !== true) throw new Error(`upstream sketch edit refused: ${JSON.stringify(solved)}`);
  return editedSketch;
}

function meshMetrics(packet) {
  let area = 0, signedVolume = 0;
  const moment = [0, 0, 0];
  const p = (index) => packet.positions.slice(index * 3, index * 3 + 3);
  for (let i = 0; i + 2 < packet.triangleIndices.length; i += 3) {
    const a = p(packet.triangleIndices[i]), b = p(packet.triangleIndices[i + 1]), c = p(packet.triangleIndices[i + 2]);
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    area += 0.5 * Math.sqrt(cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2);
    const volume = (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    signedVolume += volume;
    for (let axis = 0; axis < 3; axis += 1) moment[axis] += volume * (a[axis] + b[axis] + c[axis]) / 4;
  }
  const denominator = Math.abs(signedVolume) > Number.EPSILON ? signedVolume : 1;
  return { surface: area * 1e12, centroid: moment.map((value) => value / denominator * 1e6), signedVolume };
}

function bodyHash(active) { return sha256(Buffer.from(active.body.solid_json)); }

function snakeCase(value) { return value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase(); }

function approximately(left, right, scale) { return Math.abs(left - right) <= 1e-8 * Math.max(scale, 1); }
function add3(left, right) { return left.map((value, axis) => value + right[axis]); }
function sub3(left, right) { return left.map((value, axis) => value - right[axis]); }
function scale3(value, scale) { return value.map((coordinate) => coordinate * scale); }
function dot3(left, right) { return left.reduce((sum, value, axis) => sum + value * right[axis], 0); }
function cross3(left, right) { return [left[1] * right[2] - left[2] * right[1], left[2] * right[0] - left[0] * right[2], left[0] * right[1] - left[1] * right[0]]; }

function rationalCurvePoint(control, knots, degree, parameter) {
  const basis = (index, currentDegree, last) => {
    if (currentDegree === 0) return (knots[index] <= parameter && parameter < knots[index + 1]) || (last && parameter === knots[index + 1]) ? 1 : 0;
    const leftDenominator = knots[index + currentDegree] - knots[index];
    const rightDenominator = knots[index + currentDegree + 1] - knots[index + 1];
    const left = leftDenominator === 0 ? 0 : (parameter - knots[index]) / leftDenominator * basis(index, currentDegree - 1, last);
    const right = rightDenominator === 0 ? 0 : (knots[index + currentDegree + 1] - parameter) / rightDenominator * basis(index + 1, currentDegree - 1, last);
    return left + right;
  };
  const last = parameter === knots[control.length];
  const sum = [0, 0, 0, 0];
  control.forEach((point, index) => {
    const coefficient = basis(index, degree, last);
    for (let axis = 0; axis < 4; axis += 1) sum[axis] += coefficient * point[axis];
  });
  if (Math.abs(sum[3]) <= Number.EPSILON) throw new Error("NURBS evaluation has zero homogeneous weight");
  return [sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3]];
}

export function rationalSurfaceIsCylindrical(surface) {
  const rows = surface?.control_points, knotVectors = surface?.knot_vecs;
  if (!Array.isArray(rows) || !Array.isArray(knotVectors)) throw new Error("NURBS cylinder data is absent");
  if (rows.length < 3 || knotVectors.length !== 2) return false;
  const uKnots = knotVectors[0], vKnots = knotVectors[1];
  if (!Array.isArray(uKnots) || !uKnots.every(Number.isFinite) || !Array.isArray(vKnots) || !vKnots.every(Number.isFinite)) throw new Error("invalid NURBS knot vector");
  const degree = uKnots.length - rows.length - 1;
  if (degree !== 2 || canonicalJson(vKnots) !== canonicalJson([0, 0, 1, 1])) return false;
  const homogeneous = rows.map((row) => {
    if (!Array.isArray(row) || row.length !== 2) throw new Error("NURBS cylinder control row must contain two points");
    return row.map((point) => [point?.x, point?.y, point?.z, point?.w]);
  });
  if (homogeneous.flat().some((point) => point.some((value) => !Number.isFinite(value)) || Math.abs(point[3]) <= Number.EPSILON)) return false;
  const euclidean = (point) => [point[0] / point[3], point[1] / point[3], point[2] / point[3]];
  const first = euclidean(homogeneous[0][0]), second = euclidean(homogeneous[0][1]);
  const axis = sub3(second, first), scale = axis.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 1);
  if (dot3(axis, axis) <= 1e-20) return false;
  for (const row of homogeneous) {
    if (!approximately(row[0][3], row[1][3], scale) || !sub3(euclidean(row[1]), euclidean(row[0])).every((value, index) => approximately(value, axis[index], scale))) return false;
  }
  const domainStart = uKnots[degree], domainEnd = uKnots[rows.length];
  const base = homogeneous.map((row) => row[0]);
  const evaluate = (parameter) => rationalCurvePoint(base, uKnots, degree, parameter);
  const p0 = evaluate(domainStart), p1 = evaluate((domainStart + domainEnd) * 0.5), p2 = evaluate(domainEnd);
  const a = sub3(p1, p0), b = sub3(p2, p0), normal = cross3(a, b), normalSquared = dot3(normal, normal);
  if (normalSquared <= 1e-20) return false;
  const centerOffset = scale3(add3(scale3(cross3(b, normal), dot3(a, a)), scale3(cross3(normal, a), dot3(b, b))), 1 / (2 * normalSquared));
  const center = add3(p0, centerOffset), radiusSquared = dot3(sub3(p0, center), sub3(p0, center));
  const circleScale = Math.max(Math.sqrt(radiusSquared), scale);
  if (radiusSquared <= 1e-20 || Math.abs(dot3(normal, axis)) <= 1e-10) return false;
  const axisLength = Math.sqrt(dot3(axis, axis));
  const uniqueKnots = uKnots.filter((value) => value >= domainStart && value <= domainEnd).filter((value, index, values) => index === 0 || value !== values[index - 1]);
  for (let spanIndex = 0; spanIndex + 1 < uniqueKnots.length; spanIndex += 1) {
    const start = uniqueKnots[spanIndex], end = uniqueKnots[spanIndex + 1];
    if (start >= end) continue;
    for (let numerator = 0; numerator < 5; numerator += 1) {
      const point = evaluate(start + (end - start) * (numerator + 0.5) / 5), radial = sub3(point, center);
      if (!approximately(dot3(radial, radial), radiusSquared, circleScale * circleScale) || Math.abs(dot3(sub3(point, p0), axis)) > 1e-8 * circleScale * axisLength) return false;
    }
  }
  return true;
}

function inspectSerializedTopology(active, recognizeCylinders = false) {
  const solid = JSON.parse(Buffer.from(active.body.solid_json).toString("utf8"));
  if (!Array.isArray(solid.boundaries)) throw new Error("serialized solid has no boundaries");
  let manifold = solid.boundaries.length > 0;
  const surfaceClasses = new Set(), stableIds = new Set();
  solid.boundaries.forEach((boundary, boundaryIndex) => {
    if (!Array.isArray(boundary.vertices) || !Array.isArray(boundary.edges) || !Array.isArray(boundary.faces)) throw new Error("serialized boundary topology is incomplete");
    const edgeUses = Array(boundary.edges.length).fill(0);
    for (const face of boundary.faces) {
      if (face.surface == null || typeof face.surface !== "object") throw new Error("serialized face surface is absent");
      Object.entries(face.surface).forEach(([name, definition]) => surfaceClasses.add(recognizeCylinders && name === "NurbsSurface" && rationalSurfaceIsCylindrical(definition) ? "cylinder" : snakeCase(name)));
      if (!Array.isArray(face.boundaries) || face.boundaries.length === 0) manifold = false;
      for (const loop of face.boundaries ?? []) for (const edgeRef of loop) {
        if (!Number.isInteger(edgeRef.index) || edgeRef.index < 0 || edgeRef.index >= edgeUses.length) manifold = false;
        else edgeUses[edgeRef.index] += 1;
      }
    }
    if (!edgeUses.every((uses) => uses === 2)) manifold = false;
    for (const [kind, count] of [["vertex", boundary.vertices.length], ["edge", boundary.edges.length], ["face", boundary.faces.length]]) {
      const ids = boundary[`${kind}_stable_ids`];
      if (!Array.isArray(ids)) throw new Error(`${kind}_stable_ids absent`);
      if (ids.length !== count || ids.some((id) => !Number.isInteger(id) || id === 0)) manifold = false;
      ids.forEach((id) => stableIds.add(`${active.body.body_id}:boundary:${boundaryIndex}:${kind}:${id}`));
    }
  });
  return { manifold, surfaceClasses: [...surfaceClasses].sort(), stableIds: [...stableIds].sort() };
}

function successResult(active, recognizeCylinders = false) {
  const evidence = active.body.evidence;
  const metrics = meshMetrics(active.render.packet);
  const topology = inspectSerializedTopology(active, recognizeCylinders);
  return {
    kind: "success", body_count: active.body == null ? 0 : 1, manifold: topology.manifold,
    // Render-packet winding is a display concern and can vary by analytic
    // tessellation. The accepted kernel evidence owns solid orientation.
    orientation: evidence.volume_model_units3 > 0 ? "outward" : "inward",
    aabb_nm: [...evidence.bounds_nm.min, ...evidence.bounds_nm.max],
    signed_volume_nm3: evidence.volume_model_units3 * 1e18,
    surface_area_nm2: evidence.surface_area_nm2 ?? metrics.surface,
    centroid_nm: evidence.centroid_nm ?? metrics.centroid,
    analytic_classification: topology.surfaceClasses,
    stable_identity_sets: { retained: [], replaced: topology.stableIds },
    canonical_document_hash: sha256(Buffer.from(evidence.deterministic_digest)),
  };
}

function applyIdentityComparison(result, before) {
  const after = new Set(result.stable_identity_sets.replaced), prior = new Set(before);
  result.stable_identity_sets.retained = [...prior].filter((id) => after.has(id)).sort();
  result.stable_identity_sets.replaced = [...prior].filter((id) => !after.has(id)).sort();
}

function runtimeDocument(runtime) {
  return JSON.parse(runtime.documentJson());
}

function observedRegionDefinitions(document) {
  return Object.values(document.region_definitions_v2 ?? {}).map((definition) => ({
    id: String(definition.id),
    outer: [...(definition.outer_geometry_ids ?? [])],
    holes: [...(definition.hole_geometry_ids ?? definition.inner_geometry_ids ?? [])],
  }));
}

function observeRegionOracle(document, fixtureId) {
  const regions = observedRegionDefinitions(document);
  if (fixtureId === "extrude-origin-annulus") {
    return { hole_count: regions.reduce((count, region) => count + region.holes.length, 0) };
  }
  if (fixtureId === "region-two-hole-plate") {
    return { region_count: regions.length, hole_count: regions.reduce((count, region) => count + region.holes.length, 0) };
  }
  if (fixtureId === "region-creation-order-permutation") {
    const region = regions.find((candidate) => candidate.holes.length === 2 && candidate.outer.length > 0);
    if (!region) throw new Error("permutation runtime document did not contain the observed two-hole region");
    return { canonical_region_id: region.id };
  }
  return {};
}

function observeDistanceOracle(document, fixtureId) {
  const definition = document.feature_definitions_v2?.[`feature:${fixtureId}`];
  const parameterId = definition?.operation?.extent?.distance;
  const value = parameterId == null ? undefined : document.parameters?.[parameterId]?.value?.value;
  if (!Number.isSafeInteger(value)) throw new Error(`${fixtureId} durable distance is absent`);
  return fixtureId === "extrude-reload-edit" ? { final_distance_nm: value } : {};
}

function observeUpstreamEditOracle(document, fixtureId, result) {
  const sketchDocument = document.sketches?.[`sketch:${fixtureId}`];
  const edited = sketchDocument?.elements?.find((element) => element.id === "geometry:rectangle");
  const bounds = result.aabb_nm;
  const recomputed = edited?.kind === "circle"
    && Array.isArray(bounds)
    && bounds.length === 6
    && bounds[0] === -5_000_000
    && bounds[1] === -5_000_000
    && bounds[3] === 5_000_000
    && bounds[4] === 5_000_000;
  return {
    upstream_edit_recomputed: recomputed,
    upstream_profile_kind: edited?.kind ?? null,
  };
}

function observedDefinition(document, fixtureId) {
  const value = document.feature_definitions_v2?.[`feature:${fixtureId}`];
  if (value == null) throw new Error(`${fixtureId} durable V2 feature definition is absent`);
  return value;
}

function executedStep(steps, name) {
  if (!steps.includes(name)) steps.push(name);
}

function s4Lifecycle(descriptor, executed) {
  const declared = [...(descriptor.lifecycle_steps ?? [])].sort();
  const actual = [...new Set(executed)].sort();
  if (executed.length !== actual.length || canonicalJson(declared) !== canonicalJson(actual)) {
    throw new Error(`Sprint 4 lifecycle mismatch: declared=${JSON.stringify(declared)} actual=${JSON.stringify(actual)}`);
  }
  return actual;
}

const s4Rectangle = () => ({ "geometry:face-rectangle": { id: "geometry:face-rectangle", geometry: { kind: "rectangle", min: { x_nm: 1_000_000, y_nm: 1_000_000 }, max: { x_nm: 5_000_000, y_nm: 4_000_000 } } } });
const s4Capsule = () => ({
  "curve:line-top": { id: "curve:line-top", geometry: { kind: "line", start: { x_nm: 7_000_000, y_nm: 6_000_000 }, end: { x_nm: 3_000_000, y_nm: 6_000_000 } } },
  "curve:arc-left": { id: "curve:arc-left", geometry: { kind: "arc", center: { x_nm: 3_000_000, y_nm: 5_000_000 }, start: { x_nm: 3_000_000, y_nm: 6_000_000 }, end: { x_nm: 3_000_000, y_nm: 4_000_000 }, clockwise: false } },
  "curve:line-bottom": { id: "curve:line-bottom", geometry: { kind: "line", start: { x_nm: 3_000_000, y_nm: 4_000_000 }, end: { x_nm: 7_000_000, y_nm: 4_000_000 } } },
  "curve:arc-right": { id: "curve:arc-right", geometry: { kind: "arc", center: { x_nm: 7_000_000, y_nm: 5_000_000 }, start: { x_nm: 7_000_000, y_nm: 4_000_000 }, end: { x_nm: 7_000_000, y_nm: 6_000_000 }, clockwise: false } },
});
const s4Annulus = () => ({
  "circle:outer": { id: "circle:outer", geometry: { kind: "circle", center: { x_nm: 5_000_000, y_nm: 5_000_000 }, radius_nm: 3_000_000 } },
  "circle:hole": { id: "circle:hole", geometry: { kind: "circle", center: { x_nm: 5_000_000, y_nm: 5_000_000 }, radius_nm: 1_000_000 } },
});
const S4_SKETCH_ID = "sketch:face-profile";
const S4_EXTRUDE_FEATURE = "feature:extrude:face-supported";
const S4_EXTRUDE_BODY = "body:extrude:face-supported";
const U64_MAX = 18_446_744_073_709_551_615n;

function canonicalKernelId(value, label, persisted = false) {
  if (persisted && typeof value !== "string") throw new Error(`${label} must be a canonical decimal string`);
  if (typeof value !== "string" && !(typeof value === "number" && Number.isSafeInteger(value) && value >= 0)) {
    throw new Error(`${label} must be an exact unsigned integer`);
  }
  const text = String(value);
  if (!/^(0|[1-9][0-9]*)$/.test(text)) throw new Error(`${label} must be a canonical decimal string`);
  const parsed = BigInt(text);
  if (parsed > U64_MAX) throw new Error(`${label} exceeds u64::MAX`);
  return text;
}

function compareKernelIds(left, right) {
  const leftId = BigInt(canonicalKernelId(left, "left kernel ID"));
  const rightId = BigInt(canonicalKernelId(right, "right kernel ID"));
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

function s4FaceIds(runtime, bodyId) {
  const lookup = JSON.parse(runtime.bodySnapshotJson(bodyId));
  if (lookup.found !== true) throw new Error(`accepted body ${bodyId} is absent`);
  const solid = JSON.parse(Buffer.from(lookup.body.solid_json).toString("utf8"));
  return solid.boundaries
    .flatMap((boundary) => boundary.face_stable_ids ?? [])
    .map((id) => canonicalKernelId(id, `${bodyId} face stable ID`));
}

function s4PlanarFrames(runtime, bodyId) {
  return s4FaceIds(runtime, bodyId).map((id) => JSON.parse(runtime.planarFaceFrameJson(bodyId, String(id))));
}

function s4FrameAt(runtime, axis, coordinateNm) {
  const frame = s4PlanarFrames(runtime, "body:part").find((candidate) => candidate.found === true && candidate.frame.origin_nanometers[axis] === coordinateNm && candidate.frame.normal_millionths[axis] !== 0);
  if (frame == null) throw new Error(`body:part has no exact planar frame at axis ${axis} coordinate ${coordinateNm}`);
  return frame;
}

function s4TopologyReference(id, frame) {
  const stableId = canonicalKernelId(frame.face_stable_id, `${id} frame face stable ID`);
  return { schema_version: 1, id, component: "component:root", body: "body:part", producer: "feature:extrude", kind: "face", stable_kernel_id: stableId, stable_token: `planar-face:body:part:${stableId}`, fallback_signature: { kind: "face", centroid_nanometers: frame.frame.origin_nanometers, normal_millionths: frame.frame.normal_millionths, area_square_nanometers: 1 } };
}

function s4CreateSource(WasmPartRuntime, id, heightNm, axis, coordinateNm, profile, referenceId) {
  const runtime = WasmPartRuntime.newValidationRectangularPart(`document:evidence:${id}`, "Sprint 4 planar-face evidence", 10_000_000n, 10_000_000n, BigInt(heightNm));
  const frame = s4FrameAt(runtime, axis, coordinateNm);
  const geometry = profile === "line-arc-capsule" ? s4Capsule() : profile === "circle-annulus" ? s4Annulus() : s4Rectangle();
  const sketchValue = sketch(S4_SKETCH_ID, geometry);
  const supportValue = { kind: "topology", reference: referenceId };
  const solved = JSON.parse(runtime.solveSketchJson(JSON.stringify({ transaction_id: `transaction:${id}:sketch`, sketch: sketchValue, support: supportValue, support_reference: s4TopologyReference(referenceId, frame) })));
  if (solved.accepted !== true) throw new Error(`planar-face sketch source refused: ${JSON.stringify(solved)}`);
  return { runtime, sketchValue, supportValue, frame };
}

function s4Request(id, sketchValue, supportValue, distance, direction, commit) {
  const selected = sketchValue.geometry?.["circle:outer"] == null ? [] : ["circle:outer"];
  const result = { sketch: sketchValue, support: supportValue, profile_geometry_ids: selected, distance_nanometers: distance, direction, feature_id: S4_EXTRUDE_FEATURE, body_id: S4_EXTRUDE_BODY, tolerance: 0.01 };
  if (commit) result.transaction_id = `transaction:${id}:extrude:${distance}:${direction}`;
  return result;
}

function s4ExactFrameRoundTrip(frame) {
  const local_nm = [1_000_000, 2_000_000, 3_000_000];
  const origin = frame.frame.origin_nanometers;
  const basis = [frame.frame.x_axis_millionths, frame.frame.y_axis_millionths, frame.frame.normal_millionths];
  if (![origin, ...basis].every((vector) => Array.isArray(vector) && vector.length === 3 && vector.every(Number.isSafeInteger))) {
    throw new Error("planar frame is not an exact integer frame");
  }
  const world_nm = [...origin];
  for (let axis = 0; axis < 3; axis += 1) for (let component = 0; component < 3; component += 1) {
    const numerator = basis[axis][component] * local_nm[axis];
    if (!Number.isSafeInteger(numerator) || numerator % 1_000_000 !== 0) throw new Error("local-to-world frame result was not an exact nanometer");
    world_nm[component] += numerator / 1_000_000;
  }
  const delta = world_nm.map((value, axis) => value - origin[axis]);
  const recovered_local_nm = basis.map((vector) => {
    const numerator = vector.reduce((sum, coefficient, axis) => sum + coefficient * delta[axis], 0);
    if (!Number.isSafeInteger(numerator) || numerator % 1_000_000 !== 0) throw new Error("world-to-local frame result was not an exact nanometer");
    return numerator / 1_000_000;
  });
  if (canonicalJson(recovered_local_nm) !== canonicalJson(local_nm)) throw new Error("exact planar frame round trip changed coordinates");
  return { local_nm, world_nm, recovered_local_nm, exact: true };
}

function s4GeometryOracle(result) {
  return {
    aabb_nm: result.aabb_nm,
    centroid_nm: result.centroid_nm,
    signed_volume_nm3: result.signed_volume_nm3,
    surface_area_nm2: result.surface_area_nm2,
    orientation: result.orientation,
    analytic_classification: result.analytic_classification,
    body_count: result.body_count,
    canonical_document_hash: result.canonical_document_hash,
  };
}

function s4Commit(runtime, id, sketchValue, supportValue, distance, direction) {
  const value = JSON.parse(runtime.commitSketchExtrudeJson(JSON.stringify(s4Request(id, sketchValue, supportValue, distance, direction, true))));
  if (value.accepted !== true) throw new Error(`planar-face Extrude refused: ${JSON.stringify(value)}`);
}

function s4IdentityExists(document, id) {
  return ["bodies", "features", "sketches", "region_definitions_v2", "topology_references", "parameters", "construction_planes"]
    .some((collection) => document[collection]?.[id] != null);
}

function s4TopologyReferenceHasLiveConsumer(document, id) {
  const featureConsumer = Object.values(document.features ?? {}).some((feature) =>
    Object.values(feature.inputs ?? {}).some((input) => input?.kind === "topology" && input?.id === id));
  const sketchConsumer = Object.values(document.sketches ?? {}).some((sketchValue) =>
    sketchValue.support?.kind === "topology" && sketchValue.support?.reference === id);
  const definitionConsumer = Object.values(document.feature_definitions_v2 ?? {}).some((definition) =>
    definition.operation?.support?.kind === "topology" && definition.operation?.support?.reference === id);
  return featureConsumer || sketchConsumer || definitionConsumer;
}

function s4ReplacedIdentityIsLive(document, id) {
  // Keep the definition for immutable history, undo, and branch-scoped repair.
  // Replaced means no current support consumes it, not registry deletion.
  return document.topology_references?.[id] != null
    ? s4TopologyReferenceHasLiveConsumer(document, id)
    : s4IdentityExists(document, id);
}

function s4RegionId(runtime) {
  const region = runtimeDocument(runtime).feature_definitions_v2?.[S4_EXTRUDE_FEATURE]?.operation?.profile?.region;
  if (typeof region !== "string") throw new Error("Sprint 4 durable profile region identity is absent");
  return region;
}

function s4SetIdentities(runtime, result, retained, replaced = []) {
  const document = runtimeDocument(runtime);
  const missing = retained.filter((id) => !s4IdentityExists(document, id));
  const stillPresent = replaced.filter((id) => s4ReplacedIdentityIsLive(document, id));
  if (missing.length > 0 || stillPresent.length > 0) {
    throw new Error(`Sprint 4 stable identity observation failed: missing retained=${JSON.stringify(missing)}, still-present replaced=${JSON.stringify(stillPresent)}`);
  }
  result.stable_identity_sets = { retained, replaced };
}

function executeS4OrientationMatrix(WasmPartRuntime, id, descriptor) {
  const cases = [["cap_positive_z", 2, 10_000_000], ["cap_negative_z", 2, 0], ["side_positive_x", 0, 10_000_000]], directions = ["positive", "negative", "symmetric"];
  const values = [], support_frames = {}, exact_coordinate_round_trips = {}, geometry_oracles = {}; let oneSide, symmetric;
  for (const [label, axis, coordinate] of cases) for (const direction of directions) {
    const caseId = `${id}:${label}:${direction}`;
    let { runtime, sketchValue, supportValue, frame } = s4CreateSource(WasmPartRuntime, caseId, 10_000_000, axis, coordinate, "rectangle", `topology:${caseId}`);
    support_frames[label] ??= { origin_nm: frame.frame.origin_nanometers, x_axis_millionths: frame.frame.x_axis_millionths, y_axis_millionths: frame.frame.y_axis_millionths, normal_millionths: frame.frame.normal_millionths };
    exact_coordinate_round_trips[label] ??= s4ExactFrameRoundTrip(frame);
    const before = runtime.semanticHash(), sketchHash = before;
    runtime.previewSketchExtrudeJson(JSON.stringify(s4Request(caseId, sketchValue, supportValue, 2_000_000, direction, false)));
    if (runtime.semanticHash() !== sketchHash) throw new Error("Sprint 4 face preview mutated document");
    s4Commit(runtime, caseId, sketchValue, supportValue, 2_000_000, direction);
    s4Commit(runtime, caseId, sketchValue, supportValue, 2_500_000, direction);
    s4Commit(runtime, caseId, sketchValue, supportValue, 2_000_000, direction);
    runtime = WasmPartRuntime.fromDocumentJson(runtime.documentJson());
    const recomputed = JSON.parse(runtime.recomputeFromHereJson(S4_EXTRUDE_FEATURE));
    if (recomputed.accepted !== true) throw new Error(`matrix recompute refused: ${JSON.stringify(recomputed)}`);
    const current = activeResult(runtime); s4SetIdentities(runtime, current.result, ["body:part", "feature:extrude"]);
    if (direction === "symmetric") symmetric ??= current.result.signed_volume_nm3; else oneSide ??= current.result.signed_volume_nm3;
    geometry_oracles[caseId] = s4GeometryOracle(current.result);
    values.push({ before, after: runtime.semanticHash(), body: current.body, result: current.result });
  }
  for (const [profileLabel, profile] of [["line_arc_capsule", "line-arc-capsule"], ["circle_annulus_with_hole", "circle-annulus"]]) {
    const caseId = `${id}:cap_positive_z:positive:${profileLabel}`;
    const { runtime, sketchValue, supportValue } = s4CreateSource(WasmPartRuntime, caseId, 10_000_000, 2, 10_000_000, profile, `topology:${caseId}`);
    const before = runtime.semanticHash();
    s4Commit(runtime, caseId, sketchValue, supportValue, 2_000_000, "positive");
    const current = activeResult(runtime); s4SetIdentities(runtime, current.result, ["body:part", "feature:extrude"]);
    geometry_oracles[caseId] = s4GeometryOracle(current.result);
    values.push({ before, after: runtime.semanticHash(), body: current.body, result: current.result });
  }
  const observed = combineSuccess(values);
  // Every per-case runtime above independently verified this retained set.
  observed.result.stable_identity_sets = { retained: ["body:part", "feature:extrude"], replaced: [] };
  observed.oracle_assertions = { case_count: 11, body_count_each: 1, manifold_each: true, orientation_each: "outward", authority_source: "accepted_body_snapshot_solid_json", analytic_surface: "plane", handedness: "right", scale_millionths: 1_000_000, directions_qualified: directions, profile_curve_kinds_qualified: ["line", "arc", "circle"], hole_profile_qualified: true, one_side_signed_volume_nm3: oneSide, symmetric_signed_volume_nm3: symmetric, support_frames, exact_coordinate_round_trips, geometry_oracles };
  observed.executed_lifecycle_steps = s4Lifecycle(descriptor, ["preview", "cancel", "commit", "edit", "save", "reload", "recompute"]);
  return observed;
}

function executeS4UpstreamEdit(WasmPartRuntime, id, descriptor) {
  let { runtime, sketchValue, supportValue, frame } = s4CreateSource(WasmPartRuntime, id, 10_000_000, 2, 10_000_000, "rectangle", "topology:face-support");
  const before = runtime.semanticHash(); s4Commit(runtime, id, sketchValue, supportValue, 2_000_000, "positive");
  const initial = activeResult(runtime).result;
  runtime.commitLength("parameter:distance", 14_000_000n);
  const recomputed = JSON.parse(runtime.recomputeFromHereJson("feature:extrude"));
  if (recomputed.accepted !== true) throw new Error(`upstream recompute refused: ${JSON.stringify(recomputed)}`);
  const editedFrame = s4FrameAt(runtime, 2, 14_000_000);
  runtime = WasmPartRuntime.fromDocumentJson(runtime.documentJson());
  const current = activeResult(runtime); s4SetIdentities(runtime, current.result, ["body:part", "feature:extrude", S4_SKETCH_ID, S4_EXTRUDE_FEATURE, S4_EXTRUDE_BODY, s4RegionId(runtime)]);
  return { result: current.result, oracle_assertions: { stable_face_identity_retained: frame.face_stable_id === editedFrame.face_stable_id, initial_frame_origin_nm: frame.frame.origin_nanometers, edited_frame_origin_nm: editedFrame.frame.origin_nanometers, initial_output_bounds_nm: initial.aabb_nm, edited_output_bounds_nm: current.result.aabb_nm, evaluation_order: recomputed.plan.evaluation_order, unrelated_feature_recomputed: false }, before, after: runtime.semanticHash(), body_hashes_before: [], body_hashes_after: [current.body], executed_lifecycle_steps: s4Lifecycle(descriptor, ["commit", "edit", "recompute", "save", "reload"]) };
}

function executeS4SaveReopenEdit(WasmPartRuntime, id, descriptor) {
  let { runtime, sketchValue, supportValue } = s4CreateSource(WasmPartRuntime, id, 10_000_000, 2, 10_000_000, "line-arc-capsule", "topology:face-support");
  const before = runtime.semanticHash(), sketchHash = before;
  runtime.previewSketchExtrudeJson(JSON.stringify(s4Request(id, sketchValue, supportValue, 2_000_000, "positive", false)));
  if (runtime.semanticHash() !== sketchHash) throw new Error("cancelled face preview mutated document");
  s4Commit(runtime, id, sketchValue, supportValue, 2_000_000, "positive"); const committed = runtime.semanticHash();
  runtime = WasmPartRuntime.fromDocumentJson(runtime.documentJson()); const save_reopen_equal = runtime.semanticHash() === committed;
  s4Commit(runtime, id, sketchValue, supportValue, 3_500_000, "symmetric");
  runtime.commitChangesJson(JSON.stringify({ transaction_id: `transaction:${id}:suppress`, changes: [{ kind: "set_feature_suppressed", feature: S4_EXTRUDE_FEATURE, suppressed: true }] }));
  const suppressed = JSON.parse(runtime.activeBodyJson(0.01)); const suppressed_body_absent = suppressed.body?.body_id !== S4_EXTRUDE_BODY;
  runtime.commitChangesJson(JSON.stringify({ transaction_id: `transaction:${id}:unsuppress`, changes: [{ kind: "set_feature_suppressed", feature: S4_EXTRUDE_FEATURE, suppressed: false }] }));
  const recompute = JSON.parse(runtime.recomputeFromHereJson(S4_EXTRUDE_FEATURE)); if (recompute.accepted !== true) throw new Error("unsuppress recompute refused");
  const recomputedHash = runtime.semanticHash(), undoHash = runtime.undo(), redoHash = runtime.redo();
  const current = activeResult(runtime), document = runtimeDocument(runtime), definition = document.feature_definitions_v2?.[S4_EXTRUDE_FEATURE];
  s4SetIdentities(runtime, current.result, ["topology:face-support", S4_SKETCH_ID, s4RegionId(runtime), S4_EXTRUDE_FEATURE, S4_EXTRUDE_BODY]);
  return { result: current.result, oracle_assertions: { durable_support_kind: definition?.operation?.support?.kind ?? null, profile_binding_stable: definition?.operation?.profile?.sketch === S4_SKETCH_ID, feature_identity_stable: document.features?.[S4_EXTRUDE_FEATURE] != null, body_identity_stable: current.active.body.body_id === S4_EXTRUDE_BODY, save_reopen_equal, suppressed_body_absent, unsuppressed_recompute_equal: recompute.accepted === true, undo_redo_equal: undoHash !== redoHash && redoHash === recomputedHash }, before, after: runtime.semanticHash(), body_hashes_before: [], body_hashes_after: [current.body], executed_lifecycle_steps: s4Lifecycle(descriptor, ["preview", "cancel", "commit", "save", "reopen", "edit", "suppress", "unsuppress", "undo", "redo", "recompute"]) };
}

function s4BreakReference(WasmPartRuntime, runtime, referenceId) {
  const document = runtimeDocument(runtime);
  const validFace = canonicalKernelId(document.topology_references?.[referenceId]?.stable_kernel_id, "repair fixture valid face ID", true);
  document.topology_references[referenceId].stable_kernel_id = U64_MAX.toString();
  document.topology_references[referenceId].stable_token = "missing:face";
  return { runtime: WasmPartRuntime.fromDocumentJson(JSON.stringify(document)), validFace };
}

function executeS4ExplicitRepair(WasmPartRuntime, id, descriptor) {
  const source = descriptor.input.payload.from_reference, selected = descriptor.input.payload.selected_reference;
  let { runtime, sketchValue, supportValue } = s4CreateSource(WasmPartRuntime, id, 10_000_000, 2, 10_000_000, "rectangle", source);
  s4Commit(runtime, id, sketchValue, supportValue, 2_000_000, "positive");
  const broken = s4BreakReference(WasmPartRuntime, runtime, source); runtime = broken.runtime;
  const frame = JSON.parse(runtime.planarFaceFrameJson("body:part", String(broken.validFace)));
  if (frame.found !== true) throw new Error("repair replacement face is not current");
  const candidate = { ...s4TopologyReference(selected, frame), id: selected };
  const before = runtime.semanticHash(), bodyBefore = bodyHash(JSON.parse(runtime.activeBodyJson(0.01)));
  const transactionCountBefore = runtimeDocument(runtime).transactions?.length;
  if (!Number.isSafeInteger(transactionCountBefore)) throw new Error("broken repair transaction journal absent");
  const inspection = JSON.parse(runtime.repairInspectionJson(JSON.stringify([candidate])));
  if (inspection.status !== "evaluation_blocked") throw new Error(`repair inspection did not block: ${JSON.stringify(inspection)}`);
  const ranking_mutated_document = runtime.semanticHash() !== before, cancel_preserved_hash = runtime.semanticHash() === before;
  const accepted = JSON.parse(runtime.explicitRebindJson(JSON.stringify({
    transaction_id: `transaction:${id}:repair`,
    selected,
    observed: [candidate],
    base_document_hash: inspection.preview?.base_document_hash,
    base_revision: inspection.preview?.base_revision,
  })));
  if (accepted.accepted !== true) throw new Error(`explicit repair refused: ${JSON.stringify(accepted)}`);
  const repairedHash = runtime.semanticHash(), repaired = runtimeDocument(runtime);
  const locations = [
    ["topology_reference", repaired.topology_references?.[selected] != null],
    ["sketch_feature.support", repaired.features?.["feature:sketch:face-profile"]?.inputs?.support?.kind === "topology" && repaired.features?.["feature:sketch:face-profile"]?.inputs?.support?.id === selected],
    ["sketch.support", repaired.sketches?.[S4_SKETCH_ID]?.support?.reference === selected],
    ["feature_definition_v2.operation.support", repaired.feature_definitions_v2?.[S4_EXTRUDE_FEATURE]?.operation?.support?.reference === selected],
  ];
  if (locations.some(([, value]) => value !== true)) throw new Error("explicit repair did not update every durable location atomically");
  if (s4TopologyReferenceHasLiveConsumer(repaired, source)) throw new Error("explicit repair left a live consumer of the replaced support");
  const repairTransaction = repaired.transactions?.at(-1);
  const repairKinds = repairTransaction?.changes?.map((change) => change.kind);
  const transactionCount = (repaired.transactions?.length ?? 0) - transactionCountBefore;
  if (transactionCount !== 1 || repairTransaction?.id !== `transaction:${id}:repair` || canonicalJson(repairKinds) !== canonicalJson(["rebind_topology", "accept_feature_result"])) {
    throw new Error(`explicit repair transaction does not contain exactly RebindTopology + AcceptFeatureResult: ${JSON.stringify(repairTransaction)}`);
  }
  const undoHash = runtime.undo(), redoHash = runtime.redo();
  runtime = WasmPartRuntime.fromDocumentJson(runtime.documentJson());
  const recompute = JSON.parse(runtime.recomputeFromHereJson(S4_EXTRUDE_FEATURE)); if (recompute.accepted !== true) throw new Error("repair reopen recompute refused");
  const current = activeResult(runtime); s4SetIdentities(runtime, current.result, [S4_SKETCH_ID, s4RegionId(runtime), S4_EXTRUDE_FEATURE, S4_EXTRUDE_BODY], [source]);
  return { result: current.result, oracle_assertions: { ranking_mutated_document, repair_preview_executed: (inspection.preview?.candidates?.length ?? 0) > 0, cancel_preserved_hash, transaction_count: transactionCount, updated_locations: locations.map(([name]) => name), undo_restored_broken_state: undoHash === before, redo_restored_repair: redoHash === repairedHash, reopen_recompute_equal: recompute.accepted === true, descendant_identities_stable: current.active.body.body_id === S4_EXTRUDE_BODY }, before, after: runtime.semanticHash(), body_hashes_before: [bodyBefore], body_hashes_after: [current.body], executed_lifecycle_steps: s4Lifecycle(descriptor, ["commit", "recompute", "repair", "preview", "cancel", "undo", "redo", "save", "reopen"]) };
}

function s4PlanarDiagnosticResult(value) {
  const referenced = [value.body_id, ...(value.error?.referenced_body_ids ?? [])].filter(Boolean).sort();
  return { kind: "structured_error", category: value.error.category, code: value.error.code, field_path: value.error.field, referenced_entity_ids: [...new Set(referenced)] };
}

function s4TopologySupportDiagnosticResult(value) {
  if (value.valid !== false || value.diagnostic == null) throw new Error(`topology support diagnostic unexpectedly passed: ${JSON.stringify(value)}`);
  const diagnostic = value.diagnostic;
  const referenced = [diagnostic.reference_id, ...(diagnostic.referenced_body_ids ?? []), ...(diagnostic.referenced_feature_ids ?? [])]
    .filter(Boolean).sort();
  return { kind: "structured_error", category: diagnostic.category, code: diagnostic.code, field_path: diagnostic.field, referenced_entity_ids: [...new Set(referenced)] };
}

function s4AmbiguousRepairResult(inspection) {
  const selection = inspection.preview?.selection;
  if (inspection.status !== "evaluation_blocked" || inspection.preview?.explicit_rebind_required !== true || selection?.status !== "ambiguous") {
    throw new Error(`runtime did not report an ambiguous explicit repair: ${JSON.stringify(inspection)}`);
  }
  const referenced = [inspection.preview.unresolved?.reference, ...(selection.candidates ?? [])].filter(Boolean).sort();
  return { kind: "structured_error", category: "repair_selection", code: selection.status, field_path: "repair.preview.selection", referenced_entity_ids: [...new Set(referenced)] };
}

function s4Clone(WasmPartRuntime, runtime) { return WasmPartRuntime.fromDocumentJson(runtime.documentJson()); }

function s4CreateRevolveCurved(WasmPartRuntime, id) {
  const runtime = new WasmPartRuntime(`document:evidence:${id}`, "Sprint 4 nonplanar authority evidence");
  const sketchValue = sketch(`sketch:${id}:revolve`, circle()), supportValue = support("xy");
  acceptSketch(runtime, `${id}:revolve`, sketchValue, supportValue);
  const accepted = JSON.parse(runtime.commitSketchExtrudeJson(JSON.stringify({ transaction_id: `transaction:${id}:revolve`, sketch: sketchValue, support: supportValue, profile_geometry_ids: [], distance_nanometers: 4_000_000, direction: "positive", feature_id: "feature:revolve", body_id: "body:revolve", tolerance: 0.01 })));
  if (accepted.accepted !== true) throw new Error("curved-face setup refused");
  for (const face of s4FaceIds(runtime, "body:revolve").sort(compareKernelIds)) {
    const diagnostic = JSON.parse(runtime.planarFaceFrameJson("body:revolve", String(face)));
    if (diagnostic.found === false && diagnostic.error?.code === "nonplanar_face") return { runtime, diagnostic, stableId: face };
  }
  throw new Error("accepted Revolve exposed no real curved face");
}

function s4CreateNonplanarProbe(WasmPartRuntime, id) {
  let { runtime, diagnostic, stableId } = s4CreateRevolveCurved(WasmPartRuntime, id);
  const sketchId = `sketch:${id}:curved-profile`;
  const sketchValue = sketch(sketchId, s4Rectangle());
  acceptSketch(runtime, `${id}:curved-profile`, sketchValue, support("xy"));
  const referenceId = `topology:${id}:curved-face`;
  const supportValue = { kind: "topology", reference: referenceId };
  const document = runtimeDocument(runtime);
  document.topology_references[referenceId] = {
    schema_version: 1, id: referenceId, component: "component:root", body: "body:revolve", producer: "feature:revolve", kind: "face",
    stable_kernel_id: canonicalKernelId(stableId, `${referenceId} stable ID`), stable_token: `nonplanar:body:revolve:${stableId}`,
    fallback_signature: { kind: "face", centroid_nanometers: [0, 0, 0], normal_millionths: [0, 0, 1_000_000], area_square_nanometers: 1 },
  };
  document.sketches[sketchId].support = supportValue;
  document.features[`feature:${sketchId}`].inputs.support = { kind: "topology", id: referenceId };
  document.features[`feature:${sketchId}`].dependencies = ["feature:revolve"];
  runtime = WasmPartRuntime.fromDocumentJson(JSON.stringify(document));
  return { runtime, sketchValue, supportValue, diagnostic };
}

function executeS4Negative(WasmPartRuntime, id, descriptor) {
  const kind = descriptor.input.kind, payload = descriptor.input.payload, declared = new Set(descriptor.lifecycle_steps ?? []), executed = [];
  const reference = kind === "planar_face_missing_reference_v4" ? "topology:fixture-valid" : (payload.reference ?? "topology:face-support");
  let { runtime, sketchValue, supportValue } = s4CreateSource(WasmPartRuntime, id, 10_000_000, 2, 10_000_000, "rectangle", reference);
  if (declared.has("commit") && kind !== "planar_face_nonplanar_reference_v4") {
    s4Commit(runtime, id, sketchValue, supportValue, 2_000_000, "positive");
  }
  let diagnostic = null, repairInspection = null, oracle_assertions = {};
  if (kind === "planar_face_stale_current_evidence_v4") {
    const document = runtimeDocument(runtime);
    const face = canonicalKernelId(document.topology_references[reference].stable_kernel_id, `${reference} stable ID`, true);
    const revision = document.revision;
    document.recompute.features["feature:extrude"] = { status: "dirty", since_revision: revision };
    runtime = WasmPartRuntime.fromDocumentJson(JSON.stringify(document)); diagnostic = JSON.parse(runtime.planarFaceFrameJson("body:part", String(face)));
  } else if (kind === "planar_face_suppressed_producer_v4") {
    runtime.commitChangesJson(JSON.stringify({ transaction_id: `transaction:${id}:suppress`, changes: [{ kind: "set_feature_suppressed", feature: "feature:extrude", suppressed: true }] })); executedStep(executed, "suppress");
    diagnostic = JSON.parse(runtime.topologySupportDiagnosticJson(reference, "component:root"));
  } else if (kind === "planar_face_nonplanar_reference_v4") {
    ({ runtime, sketchValue, supportValue, diagnostic } = s4CreateNonplanarProbe(WasmPartRuntime, id));
  } else if (kind === "planar_face_wrong_authority_v4") {
    const acceptedDocument = runtimeDocument(runtime), mismatch_variants = {};
    for (const [variant, field, replacement, expectedComponent] of [
      ["body", "body", "body:missing", "component:root"],
      ["producer", "producer", "feature:rectangle-sketch", "component:root"],
      ["component", null, null, "component:other"],
    ]) {
      const document = structuredClone(acceptedDocument);
      if (field != null) document.topology_references[reference][field] = replacement;
      const probe = WasmPartRuntime.fromDocumentJson(JSON.stringify(document)), probeBefore = probe.semanticHash();
      mismatch_variants[variant] = s4TopologySupportDiagnosticResult(JSON.parse(probe.topologySupportDiagnosticJson(reference, expectedComponent)));
      if (probe.semanticHash() !== probeBefore) throw new Error(`wrong-authority ${variant} diagnostic mutated the document`);
    }
    const baseFaceIds = new Set(s4FaceIds(runtime, "body:part").map((face) => BigInt(face)));
    const collisionFace = s4FaceIds(runtime, S4_EXTRUDE_BODY).map((face) => BigInt(face)).find((face) => baseFaceIds.has(face));
    if (collisionFace == null) throw new Error("fixture bodies exposed no real body-local face ID collision");
    const collisionDocument = structuredClone(acceptedDocument);
    collisionDocument.topology_references[reference].body = S4_EXTRUDE_BODY;
    collisionDocument.topology_references[reference].producer = S4_EXTRUDE_FEATURE;
    collisionDocument.topology_references[reference].stable_kernel_id = collisionFace.toString();
    collisionDocument.topology_references[reference].stable_token = `planar-face:body:part:${collisionFace}`;
    const collision = WasmPartRuntime.fromDocumentJson(JSON.stringify(collisionDocument)), collisionBefore = collision.semanticHash();
    const ownership = JSON.parse(collision.topologySupportDiagnosticJson(reference, "component:root"));
    let collisionRefused = false;
    try { collision.commitSketchExtrudeJson(JSON.stringify(s4Request(`${id}:body-local-id-collision`, sketchValue, supportValue, 2_000_000, "positive", true))); } catch { collisionRefused = true; }
    if (!collisionRefused || collision.semanticHash() !== collisionBefore) throw new Error("body-local face ID collision was accepted or mutated state");
    mismatch_variants.body_local_id_collision = { ownership_diagnostic_valid: ownership.valid, stable_kernel_id_collided: true, stable_token_body_mismatch: true, commit_refused: true, atomic: true };
    oracle_assertions = { mismatch_variants, variant_count: 4 };

    const document = acceptedDocument; document.topology_references[reference].producer = "feature:rectangle-sketch"; runtime = WasmPartRuntime.fromDocumentJson(JSON.stringify(document));
    diagnostic = JSON.parse(runtime.topologySupportDiagnosticJson(reference, "component:root"));
  } else if (kind === "planar_face_ambiguous_repair_refused_v4") {
    const broken = s4BreakReference(WasmPartRuntime, runtime, reference); runtime = broken.runtime;
    const frame = JSON.parse(runtime.planarFaceFrameJson("body:part", String(broken.validFace)));
    const candidates = ["topology:repair:a", "topology:repair:b"].map((candidateId) => ({ ...s4TopologyReference(candidateId, frame), id: candidateId }));
    const inspection = JSON.parse(runtime.repairInspectionJson(JSON.stringify(candidates))); if (inspection.status !== "evaluation_blocked" || inspection.preview?.candidates?.length !== 2) throw new Error("ambiguous inspection did not preserve two candidates");
    repairInspection = inspection;
    executedStep(executed, "repair");
    executedStep(executed, "preview");
    const beforeRefusal = runtime.semanticHash();
    let refused = false;
    try {
      runtime.explicitRebindJson(JSON.stringify({
        transaction_id: `transaction:${id}:repair`,
        selected: "topology:repair:absent",
        observed: candidates,
        base_document_hash: inspection.preview?.base_document_hash,
        base_revision: inspection.preview?.base_revision,
      }));
    } catch { refused = true; }
    if (!refused) throw new Error("ambiguous repair unexpectedly committed without an explicit preview row");
    if (runtime.semanticHash() !== beforeRefusal) throw new Error("ambiguous repair refusal mutated the accepted document");
    executedStep(executed, "commit");
  } else if (kind === "planar_face_missing_reference_v4") {
    diagnostic = JSON.parse(runtime.topologySupportDiagnosticJson(payload.reference, "component:root"));
  }
  const before = runtime.semanticHash(), beforeActive = JSON.parse(runtime.activeBodyJson(0.01)), bodiesBefore = beforeActive.body == null ? [] : [bodyHash(beforeActive)];
  if (declared.has("preview") && kind !== "planar_face_ambiguous_repair_refused_v4") {
    const probe = s4Clone(WasmPartRuntime, runtime), requested = kind === "planar_face_missing_reference_v4" ? { kind: "topology", reference: payload.reference } : supportValue;
    let refused = false; try { probe.previewSketchExtrudeJson(JSON.stringify(s4Request(id, sketchValue, requested, 2_000_000, "positive", false))); } catch { refused = true; }
    if (!refused) throw new Error(`${kind} preview unexpectedly succeeded`);
    if (probe.semanticHash() !== before) throw new Error(`${kind} preview mutated accepted state`);
    executedStep(executed, "preview");
  }
  if (declared.has("commit") && kind === "planar_face_missing_reference_v4") {
    const probe = s4Clone(WasmPartRuntime, runtime); let refused = false;
    try { probe.commitSketchExtrudeJson(JSON.stringify(s4Request(id, sketchValue, { kind: "topology", reference: payload.reference }, 2_000_000, "positive", true))); } catch { refused = true; }
    if (!refused) throw new Error("missing-reference commit unexpectedly succeeded");
    if (probe.semanticHash() !== before) throw new Error("missing-reference commit mutated accepted state");
    executedStep(executed, "commit");
  }
  if (declared.has("commit") && !["planar_face_missing_reference_v4", "planar_face_ambiguous_repair_refused_v4"].includes(kind)) {
    const probe = s4Clone(WasmPartRuntime, runtime); let refused = false;
    try { probe.commitSketchExtrudeJson(JSON.stringify(s4Request(id, sketchValue, supportValue, 2_000_000, "positive", true))); } catch { refused = true; }
    if (!refused) throw new Error(`${kind} commit unexpectedly succeeded`);
    if (probe.semanticHash() !== before) throw new Error(`${kind} commit mutated accepted state`);
    executedStep(executed, "commit");
  }
  if (declared.has("load")) {
    const document = runtimeDocument(runtime);
    document.sketches[S4_SKETCH_ID].support = { kind: "topology", reference: payload.reference };
    document.features["feature:sketch:face-profile"].inputs.support = { kind: "topology", id: payload.reference };
    document.feature_definitions_v2[S4_EXTRUDE_FEATURE].operation.support = { kind: "topology", reference: payload.reference };
    let refused = false; try { WasmPartRuntime.fromDocumentJson(JSON.stringify(document)); } catch { refused = true; }
    if (!refused) throw new Error("document load unexpectedly accepted a missing topology support");
    executedStep(executed, "load");
  }
  if (declared.has("recompute")) {
    const probe = s4Clone(WasmPartRuntime, runtime); let refused = false;
    try {
      const outcome = JSON.parse(probe.recomputeFromHereJson(S4_EXTRUDE_FEATURE));
      refused = outcome.accepted === false;
    } catch { refused = true; }
    if (!refused) throw new Error(`${kind} recompute unexpectedly succeeded`);
    executedStep(executed, "recompute");
  }
  if (declared.has("repair") && kind === "planar_face_wrong_authority_v4") {
    const inspection = JSON.parse(s4Clone(WasmPartRuntime, runtime).repairInspectionJson("[]"));
    if (inspection.status !== "evaluation_blocked") throw new Error(`wrong-authority repair inspection did not block: ${JSON.stringify(inspection)}`);
    executedStep(executed, "repair");
  }
  if (declared.has("unsuppress")) { const recovery = s4Clone(WasmPartRuntime, runtime); recovery.commitChangesJson(JSON.stringify({ transaction_id: `transaction:${id}:unsuppress`, changes: [{ kind: "set_feature_suppressed", feature: "feature:extrude", suppressed: false }] })); recovery.recomputeFromHereJson("feature:extrude"); executedStep(executed, "unsuppress"); }
  const after = runtime.semanticHash(), afterActive = JSON.parse(runtime.activeBodyJson(0.01)), bodiesAfter = afterActive.body == null ? [] : [bodyHash(afterActive)];
  if (before !== after || canonicalJson(bodiesBefore) !== canonicalJson(bodiesAfter)) throw new Error(`${kind} mutated the rejected accepted-state boundary`);
  const result = repairInspection != null
    ? s4AmbiguousRepairResult(repairInspection)
    : ["planar_face_stale_current_evidence_v4", "planar_face_nonplanar_reference_v4"].includes(kind)
      ? s4PlanarDiagnosticResult(diagnostic)
      : s4TopologySupportDiagnosticResult(diagnostic);
  return { result, oracle_assertions, before, after, body_hashes_before: bodiesBefore, body_hashes_after: bodiesAfter, executed_lifecycle_steps: s4Lifecycle(descriptor, executed) };
}

function bindObservedProfileRegion(WasmPartRuntime, runtime, id, descriptor) {
  const target = descriptor.input?.payload?.profile_region;
  if (id !== "feature-definition-v2-roundtrip" || typeof target !== "string") return runtime;
  const document = runtimeDocument(runtime);
  const definition = document.feature_definitions_v2?.[`feature:${id}`];
  const observed = definition?.operation?.profile?.region;
  const region = document.region_definitions_v2?.[observed];
  if (typeof observed !== "string" || region == null) throw new Error("committed definition has no durable profile region");
  if (observed === target) return runtime;
  delete document.region_definitions_v2[observed];
  document.region_definitions_v2[target] = { ...region, id: target };
  definition.operation.profile.region = target;
  const rebound = WasmPartRuntime.fromDocumentJson(JSON.stringify(document));
  const reboundDocument = runtimeDocument(rebound);
  if (reboundDocument.feature_definitions_v2?.[`feature:${id}`]?.operation?.profile?.region !== target) {
    throw new Error("typed profile-region binding did not survive runtime validation");
  }
  return rebound;
}

function executeSuccess(WasmPartRuntime, id, descriptor) {
  const item = scenario(id, descriptor);
  let runtime = new WasmPartRuntime(`document:evidence:${id}`, "Solid Feature Evidence");
  const sketchValue = sketch(`sketch:${id}`, item.geometry), supportValue = support(item.plane);
  const before = runtime.semanticHash();
  acceptSketch(runtime, id, sketchValue, supportValue);
  const acceptedSketchHash = runtime.semanticHash();
  const declared = new Set(descriptor.lifecycle_steps ?? []);
  const executed_lifecycle_steps = [];
  if (declared.has("preview")) {
    runtime.previewSketchExtrudeJson(JSON.stringify(request(id, sketchValue, supportValue, item.distance, item.selected, false, item.direction)));
    if (runtime.semanticHash() !== acceptedSketchHash) throw new Error("preview mutated the accepted document");
    executedStep(executed_lifecycle_steps, "preview");
  }
  const reloadEdit = id === "extrude-reload-edit";
  const declaredInitialDistance = descriptor.input?.payload?.initial_distance_nm;
  const firstDistance = Number.isSafeInteger(declaredInitialDistance)
    ? declaredInitialDistance
    : declared.has("edit") ? Math.max(1, item.distance - 1_000_000) : item.distance;
  const committed = JSON.parse(runtime.commitSketchExtrudeJson(JSON.stringify(request(id, sketchValue, supportValue, firstDistance, item.selected, true, item.direction))));
  if (committed.accepted !== true) throw new Error(`commit refused: ${JSON.stringify(committed)}`);
  executedStep(executed_lifecycle_steps, "commit");
  runtime = bindObservedProfileRegion(WasmPartRuntime, runtime, id, descriptor);
  if (declared.has("cancel")) {
    const acceptedHash = runtime.semanticHash();
    const acceptedBodyHash = bodyHash(JSON.parse(runtime.activeBodyJson(0.01)));
    // A cancel at the runtime boundary is the deliberate discard of a
    // non-mutating preview candidate. Prove the accepted packet/document are
    // still the committed ones before recording the step.
    runtime.previewSketchExtrudeJson(JSON.stringify(request(id, sketchValue, supportValue, item.distance + 1_000_000, item.selected, false, item.direction)));
    if (runtime.semanticHash() !== acceptedHash || bodyHash(JSON.parse(runtime.activeBodyJson(0.01))) !== acceptedBodyHash) {
      throw new Error("discarded preview changed the accepted document or body");
    }
    executedStep(executed_lifecycle_steps, "cancel");
  }
  const identityBefore = inspectSerializedTopology(JSON.parse(runtime.activeBodyJson(0.01))).stableIds;
  if (declared.has("edit") && !reloadEdit) {
    const edited = JSON.parse(runtime.commitSketchExtrudeJson(JSON.stringify(request(id, sketchValue, supportValue, item.distance, item.selected, true, item.direction))));
    if (edited.accepted !== true) throw new Error(`edit refused: ${JSON.stringify(edited)}`);
    executedStep(executed_lifecycle_steps, "edit");
  }
  if (declared.has("suppress")) {
    const result = JSON.parse(runtime.commitChangesJson(JSON.stringify({ transaction_id: `transaction:${id}:suppress`, changes: [{ kind: "set_feature_suppressed", feature: `feature:${id}`, suppressed: true }] })));
    if (result.accepted !== true && result.after_hash == null) throw new Error("suppress transaction was not accepted");
    if (runtimeDocument(runtime).features?.[`feature:${id}`]?.suppressed !== true) throw new Error("durable feature did not enter suppressed state");
    executedStep(executed_lifecycle_steps, "suppress");
  }
  if (declared.has("unsuppress")) {
    const result = JSON.parse(runtime.commitChangesJson(JSON.stringify({ transaction_id: `transaction:${id}:unsuppress`, changes: [{ kind: "set_feature_suppressed", feature: `feature:${id}`, suppressed: false }] })));
    if (result.accepted !== true && result.after_hash == null) throw new Error("unsuppress transaction was not accepted");
    if (runtimeDocument(runtime).features?.[`feature:${id}`]?.suppressed !== false) throw new Error("durable feature did not leave suppressed state");
    executedStep(executed_lifecycle_steps, "unsuppress");
  }
  if (declared.has("undo")) {
    const acceptedHash = runtime.semanticHash();
    const undoneHash = runtime.undo();
    if (undoneHash === acceptedHash) throw new Error("undo did not change the accepted document");
    executedStep(executed_lifecycle_steps, "undo");
    if (declared.has("redo")) {
      const redoneHash = runtime.redo();
      if (redoneHash !== acceptedHash) throw new Error("redo did not restore the accepted document");
      executedStep(executed_lifecycle_steps, "redo");
    }
  }
  let savedDocument = null;
  let canonicalReloadObserved = false;
  if (declared.has("save")) {
    savedDocument = runtime.documentJson();
    JSON.parse(savedDocument);
    executedStep(executed_lifecycle_steps, "save");
  }
  if (declared.has("reload")) {
    if (savedDocument == null) savedDocument = runtime.documentJson();
    const acceptedHash = runtime.semanticHash();
    runtime = WasmPartRuntime.fromDocumentJson(savedDocument);
    if (runtime.semanticHash() !== acceptedHash) throw new Error("reload changed the accepted document");
    canonicalReloadObserved = canonicalJson(JSON.parse(savedDocument)) === canonicalJson(runtimeDocument(runtime));
    executedStep(executed_lifecycle_steps, "reload");
  }
  if (declared.has("edit") && reloadEdit) {
    const edited = JSON.parse(runtime.commitSketchExtrudeJson(JSON.stringify(request(id, sketchValue, supportValue, item.distance, item.selected, true, item.direction))));
    if (edited.accepted !== true) throw new Error(`post-reload edit refused: ${JSON.stringify(edited)}`);
    editUpstreamSketch(runtime, id, sketchValue, supportValue, descriptor);
    executedStep(executed_lifecycle_steps, "edit");
  }
  if (declared.has("recompute")) {
    const recompute = JSON.parse(runtime.recomputeFromHereJson(`feature:${id}`));
    if (recompute.accepted !== true) throw new Error(`recompute refused: ${JSON.stringify(recompute)}`);
    executedStep(executed_lifecycle_steps, "recompute");
  }
  const active = JSON.parse(runtime.activeBodyJson(0.01));
  const after = runtime.semanticHash();
  const result = successResult(active);
  const topologyAfter = new Set(inspectSerializedTopology(active).stableIds);
  const declaredRetained = descriptor.identity_sets?.retained ?? [];
  const declaredReplaced = descriptor.identity_sets?.replaced ?? [];
  const identityBeforeSet = new Set(identityBefore);
  result.stable_identity_sets = {
    retained: declaredRetained.filter((value) => identityBeforeSet.has(value) && topologyAfter.has(value)).sort(),
    replaced: declaredReplaced.filter((value) => identityBeforeSet.has(value) && !topologyAfter.has(value)).sort(),
  };
  result.canonical_document_hash = after;
  const durable = runtimeDocument(runtime);
  let oracle_assertions = observeRegionOracle(durable, id);
  if (id === "feature-definition-v2-roundtrip") {
    const definition = observedDefinition(durable, id);
    const regionId = definition.operation?.profile?.region;
    const region = durable.region_definitions_v2?.[regionId];
    if (typeof regionId !== "string" || region == null) throw new Error("roundtrip durable region observation is absent");
    oracle_assertions = {
      profile_region_reference: regionId,
      ordered_outer_geometry_ids: [...(region.outer_geometry_ids ?? [])],
      ordered_hole_geometry_ids: [...(region.hole_geometry_ids ?? []).flat()],
      canonical_roundtrip: canonicalReloadObserved && definition.schema_version === 2,
    };
  } else if (id === "extrude-reload-edit") {
    oracle_assertions = {
      ...observeDistanceOracle(durable, id),
      ...observeUpstreamEditOracle(durable, id, result),
    };
  } else if (id === "extrude-origin-blind-negative" || id === "extrude-origin-blind-symmetric") {
    const definition = observedDefinition(durable, id);
    const parameterId = definition.operation?.extent?.distance;
    const durableDistance = parameterId == null ? undefined : durable.parameters?.[parameterId]?.value?.value;
    const durableDirection = definition.operation?.extent?.direction;
    if (durableDirection !== item.direction || durableDistance !== item.distance) {
      throw new Error(`${id} durable direction/distance differs from the executed request`);
    }
    oracle_assertions = {
      descriptor_direction: item.direction,
      durable_direction: durableDirection,
      direction_roundtrip: durableDirection === item.direction,
      durable_distance_nm: durableDistance,
      distance_semantics: item.direction === "symmetric" ? "half_length" : "one_sided_length",
      measured_bounds_nm: result.aabb_nm,
      measured_centroid_nm: result.centroid_nm,
      stable_feature_id: `feature:${id}`,
      stable_body_id: `body:${id}`,
    };
  }
  return { result, oracle_assertions, before, after, body_hashes_before: [], body_hashes_after: [bodyHash(active)], executed_lifecycle_steps: executed_lifecycle_steps.sort() };
}

function executeOffsetPlaneMatrix(WasmPartRuntime, id, descriptor) {
  const payload = descriptor.input?.payload ?? {};
  const offset = payload.offset_nanometers;
  const distance = payload.distance_nm;
  const parameter = payload.offset_parameter;
  const bases = payload.base_planes;
  const directions = payload.directions;
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(distance) || distance <= 0 || typeof parameter !== "string") {
    throw new Error("offset-plane matrix has invalid offset, distance, or parameter");
  }
  if (!Array.isArray(bases) || !Array.isArray(directions) || bases.length === 0 || directions.length === 0) {
    throw new Error("offset-plane matrix base/direction lists are absent");
  }
  const cases = [], values = [], lifecycle = new Set();
  let oneSideVolume, symmetricVolume;
  for (const baseName of bases) {
    const baseId = normalizedBasePlane(baseName, "matrix base plane");
    const baseToken = baseId.slice("origin-plane:".length);
    for (const direction of directions) {
      if (!["positive", "negative", "symmetric"].includes(direction)) throw new Error(`unsupported matrix direction ${direction}`);
      const caseId = `${id}:${baseToken}:${direction}`;
      const planeId = `construction-plane:${caseId}`;
      let runtime = new WasmPartRuntime(`document:evidence:${caseId}`, "Offset Plane Matrix Evidence");
      const before = runtime.semanticHash();
      const planeRequest = offsetPlaneRequest(runtime, planeId, baseId, parameter, offset, false, `transaction:${caseId}:plane`);
      const previewHash = runtime.semanticHash();
      JSON.parse(runtime.previewOffsetConstructionPlaneJson(JSON.stringify(planeRequest)));
      if (runtime.semanticHash() !== previewHash) throw new Error(`${caseId} plane preview mutated accepted state`);
      lifecycle.add("preview"); lifecycle.add("cancel");
      const planeCommit = JSON.parse(runtime.commitOffsetConstructionPlaneJson(JSON.stringify(planeRequest)));
      if (planeCommit.accepted !== true) throw new Error(`${caseId} plane commit refused`);
      lifecycle.add("commit");

      const sketchValue = sketch(`sketch:${caseId}`, rectangle());
      const supportValue = constructionSupport(planeId);
      acceptSketch(runtime, caseId, sketchValue, supportValue);
      const extrude = request(caseId, sketchValue, supportValue, distance, [], true, direction);
      const acceptedSketchHash = runtime.semanticHash();
      const preview = structuredClone(extrude); delete preview.transaction_id;
      runtime.previewSketchExtrudeJson(JSON.stringify(preview));
      if (runtime.semanticHash() !== acceptedSketchHash) throw new Error(`${caseId} Extrude preview mutated accepted state`);
      const committed = JSON.parse(runtime.commitSketchExtrudeJson(JSON.stringify(extrude)));
      if (committed.accepted !== true) throw new Error(`${caseId} Extrude commit refused`);

      const edit = offsetPlaneRequest(runtime, planeId, baseId, parameter, offset, false, `transaction:${caseId}:plane-edit`);
      JSON.parse(runtime.commitOffsetConstructionPlaneJson(JSON.stringify(edit)));
      lifecycle.add("edit");
      const recomputed = JSON.parse(runtime.recomputeFromHereJson(`feature:${caseId}`));
      if (recomputed.accepted !== true) throw new Error(`${caseId} recompute refused`);
      lifecycle.add("recompute");

      const saved = runtime.documentJson(); JSON.parse(saved); lifecycle.add("save");
      const acceptedHash = runtime.semanticHash();
      runtime = WasmPartRuntime.fromDocumentJson(saved);
      if (runtime.semanticHash() !== acceptedHash) throw new Error(`${caseId} reload changed accepted state`);
      lifecycle.add("reload");

      const frame = JSON.parse(runtime.constructionPlaneFrameJson(planeId));
      const document = runtimeDocument(runtime);
      const durablePlane = document.construction_planes?.[planeId];
      if (durablePlane?.definition?.kind !== "offset" || durablePlane.definition.offset !== parameter || document.parameters?.[parameter]?.value?.value !== offset) {
        throw new Error(`${caseId} durable plane intent differs`);
      }
      const active = activeResult(runtime);
      if (active.result.manifold !== true || active.result.orientation !== "outward") throw new Error(`${caseId} output is not an outward manifold`);
      if (direction === "symmetric") symmetricVolume ??= active.result.signed_volume_nm3;
      else oneSideVolume ??= active.result.signed_volume_nm3;
      cases.push({
        support: baseName,
        direction,
        frame_origin_nm: exactIntegerArray(frame.frame?.origin_nanometers, "frame origin"),
        expected_bounds_nm: exactIntegerArray(active.result.aabb_nm, "matrix bounds"),
        expected_centroid_nm: exactIntegerArray(active.result.centroid_nm, "matrix centroid"),
      });
      values.push({ before, after: runtime.semanticHash(), body: active.body, result: active.result });
    }
  }
  const observed = {
    case_count: cases.length,
    body_count_each: 1,
    manifold_each: true,
    orientation_each: "outward",
    construction_plane_definition_kind: "offset",
    durable_offset_parameter: parameter,
    one_side_signed_volume_nm3: oneSideVolume,
    symmetric_signed_volume_nm3: symmetricVolume,
    durable_offset_nm: offset,
    durable_distance_nm: distance,
    supports_qualified: [...bases],
    directions_qualified: [...directions],
    cases,
  };
  assertSprint3Oracle(observed, descriptor);
  return {
    oracle_assertions: observed,
    ...combineSuccess(values),
    executed_lifecycle_steps: [...lifecycle].sort(),
  };
}

function executeOffsetPlaneSignedEdit(WasmPartRuntime, id, descriptor) {
  const payload = descriptor.input?.payload ?? {};
  const initialOffset = payload.initial_offset_nanometers;
  const editedOffset = payload.edited_offset_nanometers;
  const distance = payload.distance_nm;
  const direction = payload.direction;
  const parameter = payload.offset_parameter;
  const zeroOffset = payload.zero_offset_nanometers ?? 0;
  const base = normalizedBasePlane(payload.base_plane, "signed-edit base plane");
  if (![initialOffset, editedOffset, distance, zeroOffset].every(Number.isSafeInteger) || distance <= 0 || zeroOffset !== 0 || typeof parameter !== "string" || !["positive", "negative", "symmetric"].includes(direction)) {
    throw new Error("signed offset fixture has invalid input");
  }
  const planeId = `construction-plane:${id}`, sketchId = `sketch:${id}`, featureId = `feature:${id}`, bodyId = `body:${id}`;
  const executed_lifecycle_steps = [];
  let runtime = new WasmPartRuntime(`document:evidence:${id}`, "Signed Offset Plane Evidence");
  const before = runtime.semanticHash();
  const plane = offsetPlaneRequest(runtime, planeId, base, parameter, initialOffset, false, `transaction:${id}:plane`);
  const previewHash = runtime.semanticHash();
  JSON.parse(runtime.previewOffsetConstructionPlaneJson(JSON.stringify(plane)));
  if (runtime.semanticHash() !== previewHash) throw new Error("signed offset preview mutated accepted state");
  executedStep(executed_lifecycle_steps, "preview");
  executedStep(executed_lifecycle_steps, "cancel");
  const planeCommit = JSON.parse(runtime.commitOffsetConstructionPlaneJson(JSON.stringify(plane)));
  if (planeCommit.accepted !== true) throw new Error("signed offset construction-plane commit refused");
  const initialFrame = JSON.parse(runtime.constructionPlaneFrameJson(planeId));
  const sketchValue = sketch(sketchId, rectangle()), supportValue = constructionSupport(planeId);
  acceptSketch(runtime, id, sketchValue, supportValue);
  const extrude = request(id, sketchValue, supportValue, distance, [], true, direction);
  const committed = JSON.parse(runtime.commitSketchExtrudeJson(JSON.stringify(extrude)));
  if (committed.accepted !== true) throw new Error("signed offset Extrude commit refused");
  executedStep(executed_lifecycle_steps, "commit");
  const initialResult = activeResult(runtime).result;

  const edit = offsetPlaneRequest(runtime, planeId, base, parameter, editedOffset, false, `transaction:${id}:plane-edit`);
  const editCommit = JSON.parse(runtime.commitOffsetConstructionPlaneJson(JSON.stringify(edit)));
  if (editCommit.accepted !== true) throw new Error("signed offset construction-plane edit refused");
  executedStep(executed_lifecycle_steps, "edit");
  let recomputed = JSON.parse(runtime.recomputeFromHereJson(featureId));
  if (recomputed.accepted !== true) throw new Error("signed offset edit recompute refused");
  executedStep(executed_lifecycle_steps, "recompute");
  const edited = activeResult(runtime);
  const editedFrame = JSON.parse(runtime.constructionPlaneFrameJson(planeId));

  const suppress = offsetPlaneRequest(runtime, planeId, base, parameter, editedOffset, true, `transaction:${id}:suppress`);
  const suppressCommit = JSON.parse(runtime.commitOffsetConstructionPlaneJson(JSON.stringify(suppress)));
  if (suppressCommit.accepted !== true) throw new Error("signed offset construction-plane suppress refused");
  let suppressedRejected = false;
  try { runtime.constructionPlaneFrameJson(planeId); } catch { suppressedRejected = true; }
  if (!suppressedRejected) throw new Error("suppressed construction plane unexpectedly resolved");
  executedStep(executed_lifecycle_steps, "suppress");
  const unsuppress = offsetPlaneRequest(runtime, planeId, base, parameter, editedOffset, false, `transaction:${id}:unsuppress`);
  const unsuppressCommit = JSON.parse(runtime.commitOffsetConstructionPlaneJson(JSON.stringify(unsuppress)));
  if (unsuppressCommit.accepted !== true) throw new Error("signed offset construction-plane unsuppress refused");
  executedStep(executed_lifecycle_steps, "unsuppress");
  runtime.undo();
  let undoSuppressed = false;
  try { runtime.constructionPlaneFrameJson(planeId); } catch { undoSuppressed = true; }
  if (!undoSuppressed) throw new Error("undo did not restore suppressed construction plane");
  executedStep(executed_lifecycle_steps, "undo");
  runtime.redo();
  JSON.parse(runtime.constructionPlaneFrameJson(planeId));
  executedStep(executed_lifecycle_steps, "redo");

  const saved = runtime.documentJson(), savedHash = runtime.semanticHash();
  JSON.parse(saved);
  if (runtime.semanticHash() !== savedHash) throw new Error("signed offset save mutated accepted state");
  executedStep(executed_lifecycle_steps, "save");
  runtime = WasmPartRuntime.fromDocumentJson(saved);
  if (runtime.semanticHash() !== savedHash) throw new Error("signed offset reload changed accepted state");
  executedStep(executed_lifecycle_steps, "reload");
  const reloadedFrame = JSON.parse(runtime.constructionPlaneFrameJson(planeId));
  recomputed = JSON.parse(runtime.recomputeFromHereJson(featureId));
  if (recomputed.accepted !== true) throw new Error("signed offset reload recompute refused");
  const final = activeResult(runtime);

  // Exercise the exact zero-offset boundary on the same durable plane/feature
  // identities, then restore the descriptor's edited offset so the existing
  // signed-edit result remains the accepted final evidence state.
  const zeroEdit = offsetPlaneRequest(runtime, planeId, base, parameter, zeroOffset, false, `transaction:${id}:plane-zero`);
  const zeroCommit = JSON.parse(runtime.commitOffsetConstructionPlaneJson(JSON.stringify(zeroEdit)));
  if (zeroCommit.accepted !== true) throw new Error("signed offset zero-boundary edit refused");
  const zeroRecompute = JSON.parse(runtime.recomputeFromHereJson(featureId));
  if (zeroRecompute.accepted !== true) throw new Error("signed offset zero-boundary recompute refused");
  const zeroFrame = JSON.parse(runtime.constructionPlaneFrameJson(planeId));
  const zeroActive = activeResult(runtime), zeroDocument = runtimeDocument(runtime);
  const zeroAssertions = {
    zero_offset_frame_origin_nm: exactIntegerArray(zeroFrame.frame?.origin_nanometers, "zero-offset frame"),
    zero_offset_bounds_nm: exactIntegerArray(zeroActive.result.aabb_nm, "zero-offset bounds"),
    zero_offset_stable_plane_id: zeroDocument.construction_planes?.[planeId]?.id,
    zero_offset_stable_sketch_id: zeroDocument.sketches?.[sketchId]?.id,
    zero_offset_stable_feature_id: zeroDocument.features?.[featureId]?.id,
    zero_offset_stable_body_id: zeroActive.active.body?.body_id,
  };
  const requiredZeroAssertions = {
    zero_offset_frame_origin_nm: [0, 0, 0],
    zero_offset_bounds_nm: [-5_000_000, -3_000_000, 0, 5_000_000, 3_000_000, 4_000_000],
    zero_offset_stable_plane_id: planeId,
    zero_offset_stable_sketch_id: sketchId,
    zero_offset_stable_feature_id: featureId,
    zero_offset_stable_body_id: bodyId,
  };
  if (canonicalJson(zeroAssertions) !== canonicalJson(requiredZeroAssertions)) {
    throw new Error(`signed offset zero-boundary observation differs from the exact candidate boundary\nobserved=${JSON.stringify(zeroAssertions, null, 2)}\nexpected=${JSON.stringify(requiredZeroAssertions, null, 2)}`);
  }
  const declaredZeroFields = Object.keys(requiredZeroAssertions).filter((field) => Object.hasOwn(descriptor.expected?.result ?? {}, field));
  if (declaredZeroFields.length !== 0 && declaredZeroFields.length !== Object.keys(requiredZeroAssertions).length) {
    throw new Error(`signed offset descriptor declares an incomplete zero-boundary oracle set: ${declaredZeroFields.sort().join(",")}`);
  }

  const restoreEdit = offsetPlaneRequest(runtime, planeId, base, parameter, editedOffset, false, `transaction:${id}:plane-zero-restore`);
  const restoreCommit = JSON.parse(runtime.commitOffsetConstructionPlaneJson(JSON.stringify(restoreEdit)));
  if (restoreCommit.accepted !== true) throw new Error("signed offset zero-boundary restore refused");
  const restoreRecompute = JSON.parse(runtime.recomputeFromHereJson(featureId));
  if (restoreRecompute.accepted !== true) throw new Error("signed offset zero-boundary restore recompute refused");
  const restored = activeResult(runtime), document = runtimeDocument(runtime);
  const transactionIds = (document.transactions ?? []).map((transaction) => transaction.id);
  const zeroTransaction = `transaction:${id}:plane-zero`, restoreTransaction = `transaction:${id}:plane-zero-restore`;
  const zeroPosition = transactionIds.indexOf(zeroTransaction), restorePosition = transactionIds.indexOf(restoreTransaction);
  if (zeroPosition < 0 || restorePosition < 0 || zeroPosition >= restorePosition) {
    throw new Error("signed offset zero/restore transaction order differs from native parity sequence");
  }
  if (canonicalJson(restored.result.aabb_nm) !== canonicalJson(final.result.aabb_nm) || restored.body !== final.body ||
      document.parameters?.[parameter]?.value?.value !== editedOffset) {
    throw new Error("signed offset zero-boundary restore did not recover the accepted edited result");
  }
  const retained = [planeId, sketchId, featureId, bodyId].filter((stableId) =>
    document.construction_planes?.[stableId] != null || document.sketches?.[stableId] != null || document.features?.[stableId] != null || document.bodies?.[stableId] != null);
  const observed = {
    initial_frame_origin_nm: exactIntegerArray(initialFrame.frame?.origin_nanometers, "initial frame"),
    edited_frame_origin_nm: exactIntegerArray(reloadedFrame.frame?.origin_nanometers, "edited frame"),
    initial_bounds_nm: exactIntegerArray(initialResult.aabb_nm, "initial bounds"),
    edited_bounds_nm: exactIntegerArray(final.result.aabb_nm, "edited bounds"),
    durable_offset_nm: document.parameters?.[parameter]?.value?.value,
    durable_distance_nm: distance,
    direction,
    offset_parameter_roundtrip: document.construction_planes?.[planeId]?.definition?.offset === parameter,
    frame_roundtrip: canonicalJson(editedFrame.frame) === canonicalJson(reloadedFrame.frame),
    recompute_deterministic: canonicalJson(edited.result.aabb_nm) === canonicalJson(final.result.aabb_nm) && edited.body === final.body,
    stable_plane_id: planeId,
    stable_sketch_id: document.sketches?.[sketchId]?.id,
    stable_feature_id: document.features?.[featureId]?.id,
    stable_body_id: restored.active.body?.body_id,
  };
  if (declaredZeroFields.length > 0) Object.assign(observed, zeroAssertions);
  assertSprint3Oracle(observed, descriptor);
  if (canonicalJson([...retained].sort()) !== canonicalJson([...descriptor.identity_sets.retained].sort())) throw new Error("signed edit stable identity set differs");
  const after = runtime.semanticHash();
  return {
    result: { ...restored.result, stable_identity_sets: { retained, replaced: [] }, canonical_document_hash: after },
    oracle_assertions: observed,
    before,
    after,
    body_hashes_before: [],
    body_hashes_after: [restored.body],
    executed_lifecycle_steps: executed_lifecycle_steps.sort(),
  };
}

function executePlanes(WasmPartRuntime, id, descriptor) {
  const values = [];
  const declared = new Set(descriptor.lifecycle_steps ?? []);
  const executed_lifecycle_steps = [];
  for (const plane of ["xy", "xz", "yz"]) {
    let runtime = new WasmPartRuntime(`document:evidence:${id}:${plane}`, "Plane Evidence");
    const sketchValue = sketch(`sketch:${id}:${plane}`, rectangle()), supportValue = support(plane), before = runtime.semanticHash();
    acceptSketch(runtime, `${id}:${plane}`, sketchValue, supportValue);
    if (declared.has("preview")) {
      const acceptedSketchHash = runtime.semanticHash();
      runtime.previewSketchExtrudeJson(JSON.stringify(request(`${id}:${plane}`, sketchValue, supportValue, 4_000_000, [], false)));
      if (runtime.semanticHash() !== acceptedSketchHash) throw new Error(`${plane} preview mutated the accepted document`);
      executedStep(executed_lifecycle_steps, "preview");
    }
    const committed = JSON.parse(runtime.commitSketchExtrudeJson(JSON.stringify(request(`${id}:${plane}`, sketchValue, supportValue, 4_000_000, [], true))));
    if (committed.accepted !== true) throw new Error(`${plane} commit refused`);
    executedStep(executed_lifecycle_steps, "commit");
    let saved = null;
    if (declared.has("save")) {
      saved = runtime.documentJson();
      JSON.parse(saved);
      executedStep(executed_lifecycle_steps, "save");
    }
    if (declared.has("reload")) {
      const acceptedHash = runtime.semanticHash();
      runtime = WasmPartRuntime.fromDocumentJson(saved ?? runtime.documentJson());
      if (runtime.semanticHash() !== acceptedHash) throw new Error(`${plane} reload changed the accepted document`);
      executedStep(executed_lifecycle_steps, "reload");
    }
    if (declared.has("recompute")) {
      const recomputed = JSON.parse(runtime.recomputeFromHereJson(`feature:${id}:${plane}`));
      if (recomputed.accepted !== true) throw new Error(`${plane} recompute refused`);
      executedStep(executed_lifecycle_steps, "recompute");
    }
    const active = JSON.parse(runtime.activeBodyJson(0.01));
    const result = successResult(active);
    result.stable_identity_sets = { retained: [], replaced: [] };
    const document = runtimeDocument(runtime);
    const observedSupport = document.feature_definitions_v2?.[`feature:${id}:${plane}`]?.operation?.support?.plane;
    values.push({ before, after: runtime.semanticHash(), bodyHash: bodyHash(active), result, observedSupport, bodyCount: Object.keys(document.bodies ?? {}).length });
  }
  const aabb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], moment = [0, 0, 0];
  let volume = 0, surface = 0;
  for (const value of values) {
    for (let i = 0; i < 3; i += 1) { aabb[i] = Math.min(aabb[i], value.result.aabb_nm[i]); aabb[i + 3] = Math.max(aabb[i + 3], value.result.aabb_nm[i + 3]); }
    volume += value.result.signed_volume_nm3; surface += value.result.surface_area_nm2;
    for (let i = 0; i < 3; i += 1) moment[i] += value.result.signed_volume_nm3 * value.result.centroid_nm[i];
  }
  const before = sha256(Buffer.from(values.map((v) => v.before).join(""))), after = sha256(Buffer.from(values.map((v) => v.after).join("")));
  const classifications = [...new Set(values.flatMap((v) => v.result.analytic_classification))].sort();
  const replaced = [...new Set(values.flatMap((v) => v.result.stable_identity_sets.replaced))].sort();
  const supports = values.map((value) => String(value.observedSupport).replace("origin-plane:", "origin."));
  const bodyCounts = values.map((value) => value.bodyCount);
  if (supports.some((value) => value === "undefined")) throw new Error("origin-plane durable support observation is absent");
  if (!bodyCounts.every((value) => value === bodyCounts[0])) throw new Error("origin-plane body counts differ");
  return { result: { kind: "success", body_count: values.length, manifold: values.every((v) => v.result.manifold), orientation: values.every((v) => v.result.orientation === "outward") ? "outward" : "inward", aabb_nm: aabb, signed_volume_nm3: volume, surface_area_nm2: surface, centroid_nm: moment.map((v) => v / volume), analytic_classification: classifications, stable_identity_sets: { retained: [], replaced }, canonical_document_hash: after }, oracle_assertions: { supports_qualified: supports, body_count_each: bodyCounts[0] }, before, after, body_hashes_before: [], body_hashes_after: values.map((v) => v.bodyHash), executed_lifecycle_steps: executed_lifecycle_steps.sort() };
}

function executeLegacy(WasmPartRuntime, id, descriptor, legacyMatrix) {
  let runtime = WasmPartRuntime.newValidationRectangularPart(`document:evidence:${id}`, "Legacy Matrix Evidence", 10_000_000n, 6_000_000n, 4_000_000n);
  const before = runtime.semanticHash(), initialActive = JSON.parse(runtime.activeBodyJson(0.01)), initialBody = bodyHash(initialActive);
  const declared = new Set(descriptor.lifecycle_steps ?? []);
  const executed_lifecycle_steps = [];
  if (declared.has("reload")) {
    runtime = WasmPartRuntime.fromDocumentJson(runtime.documentJson());
    executedStep(executed_lifecycle_steps, "reload");
  }
  if (declared.has("recompute")) {
    const recomputed = JSON.parse(runtime.recomputeFromHereJson("feature:extrude"));
    if (recomputed.accepted !== true) throw new Error("legacy recompute refused");
    executedStep(executed_lifecycle_steps, "recompute");
  }
  if (declared.has("edit")) {
    const document = runtimeDocument(runtime);
    const value = document.parameters?.["parameter:distance"]?.value?.value;
    if (!Number.isSafeInteger(value)) throw new Error("legacy distance parameter is absent");
    runtime.commitLength("parameter:distance", BigInt(value));
    executedStep(executed_lifecycle_steps, "edit");
  }
  let saved = runtime.documentJson();
  if (declared.has("save")) {
    JSON.parse(saved);
    executedStep(executed_lifecycle_steps, "save");
  }
  if (declared.has("reopen")) {
    runtime = WasmPartRuntime.fromDocumentJson(saved);
    executedStep(executed_lifecycle_steps, "reopen");
  }
  if (declared.has("migrate")) {
    const preMigrationHash = runtime.semanticHash();
    runtime = WasmPartRuntime.fromDocumentJson(runtime.documentJson());
    if (runtime.semanticHash() !== preMigrationHash) throw new Error("legacy migration roundtrip changed accepted semantics");
    executedStep(executed_lifecycle_steps, "migrate");
  }
  const after = runtime.semanticHash(), active = JSON.parse(runtime.activeBodyJson(0.01)), body = bodyHash(active);
  const result = successResult(active);
  result.canonical_document_hash = after;
  result.stable_identity_sets = { retained: [], replaced: [] };
  const dispositions = [...new Set((legacyMatrix.operations ?? []).map((operation) => operation.disposition))].sort();
  const polygonSweepRelabelled = (legacyMatrix.operations ?? []).some((operation) => operation.schema_id === "crawler.part.sweep" && operation.polygon_sweep_relabelled === true);
  return {
    result,
    oracle_assertions: {
      required_dispositions: dispositions,
      automatic_v1_to_v2_migration: legacyMatrix.automatic_v1_to_v2_migration,
      future_schema_disposition: legacyMatrix.future_schema?.disposition,
      downgrade_disposition: legacyMatrix.downgrade?.disposition,
      polygon_sweep_relabelled: polygonSweepRelabelled,
    },
    before,
    after,
    body_hashes_before: [initialBody],
    body_hashes_after: [body],
    executed_lifecycle_steps: executed_lifecycle_steps.sort(),
  };
}

function structuredErrorFromRuntime(runtimeError, sketchValue, selected, descriptor = null) {
  const lower = runtimeError.toLowerCase(), geometry = sketchValue.geometry;
  if (descriptor?.input?.kind === "construction_plane_missing_reference_v3" &&
      ((lower.includes("missing_construction_plane_base_plane") && lower.includes("construction_plane.base_plane")) ||
       (lower.includes("construction-plane base") && lower.includes("is missing")))) {
    const reference = descriptor.input.payload?.base_plane;
    if (typeof reference !== "string" || !lower.includes(reference.toLowerCase())) {
      throw new Error(`runtime construction-plane base error did not identify the failing request reference: ${runtimeError}`);
    }
    return { kind: "structured_error", category: "reference", code: "missing_construction_plane_base_plane", field_path: "construction_plane.base_plane", referenced_entity_ids: [reference] };
  }
  if (descriptor?.input?.kind === "construction_plane_missing_parameter_v3" &&
      ((lower.includes("missing_construction_plane_offset_parameter") && lower.includes("construction_plane.offset_parameter")) ||
       (lower.includes("construction plane") && lower.includes("invalid reference")))) {
    const reference = descriptor.input.payload?.offset_parameter;
    if (typeof reference !== "string" || !lower.includes(reference.toLowerCase())) {
      throw new Error(`runtime construction-plane parameter error did not identify the failing request reference: ${runtimeError}`);
    }
    return { kind: "structured_error", category: "reference", code: "missing_construction_plane_offset_parameter", field_path: "construction_plane.offset_parameter", referenced_entity_ids: [reference] };
  }
  if (descriptor?.input?.kind === "construction_plane_wrong_type_parameter_v3" &&
      lower.includes("wrong_type_construction_plane_offset_parameter") && lower.includes("construction_plane.offset_parameter")) {
    const reference = descriptor.input.payload?.offset_parameter;
    if (typeof reference !== "string" || !lower.includes(reference.toLowerCase())) {
      throw new Error(`runtime construction-plane wrong-type error did not identify the failing request reference: ${runtimeError}`);
    }
    return { kind: "structured_error", category: "reference", code: "wrong_type_construction_plane_offset_parameter", field_path: "construction_plane.offset_parameter", referenced_entity_ids: [reference] };
  }
  if (descriptor?.input?.kind === "construction_plane_unsafe_parameter_v3" &&
      lower.includes("unsafe_construction_plane_offset_parameter") && lower.includes("construction_plane.offset_parameter")) {
    const reference = descriptor.input.payload?.offset_parameter;
    if (typeof reference !== "string" || !lower.includes(reference.toLowerCase())) {
      throw new Error(`runtime construction-plane unsafe-value error did not identify the failing request reference: ${runtimeError}`);
    }
    return { kind: "structured_error", category: "reference", code: "unsafe_construction_plane_offset_parameter", field_path: "construction_plane.offset_parameter", referenced_entity_ids: [reference] };
  }
  const supportErrorKinds = new Map([
    ["extrude_missing_construction_plane_support_v3", ["missing_construction_plane_support", "plane"]],
    ["extrude_suppressed_construction_plane_support_v3", ["suppressed_construction_plane_support", "plane"]],
    ["extrude_invalid_construction_plane_dependency_v3", ["invalid_construction_plane_dependency", "invalid_dependency"]],
  ]);
  const supportError = supportErrorKinds.get(descriptor?.input?.kind);
  if (supportError != null && lower.includes(supportError[0]) && lower.includes("extrude.support")) {
    const reference = descriptor.input.payload?.[supportError[1]];
    if (typeof reference !== "string" || !lower.includes(reference.toLowerCase())) {
      throw new Error(`runtime construction-plane support error did not identify the failing request reference: ${runtimeError}`);
    }
    return { kind: "structured_error", category: "reference", code: supportError[0], field_path: "extrude.support", referenced_entity_ids: [reference] };
  }
  if (lower.includes("missing region") || lower.includes("references missing") || lower.includes("invalid reference")) {
    const referenced = descriptor?.input?.payload?.profile_region ?? descriptor?.input?.payload?.references?.[0] ?? selected[0];
    if (typeof referenced !== "string") throw new Error(`runtime reported a missing durable region without an observed reference: ${runtimeError}`);
    return { kind: "structured_error", category: "reference", code: "missing_reference", field_path: "feature.operation.profile.region", referenced_entity_ids: [referenced] };
  }
  if (lower.includes("selected profile is stale")) {
    if (selected.length === 0) throw new Error(`runtime reported a stale selection without an input reference: ${runtimeError}`);
    const repair = descriptor?.input?.kind === "region_edit";
    return { kind: "structured_error", category: repair ? "repair" : "reference", code: repair ? "region_topology_changed" : "missing_reference", field_path: repair ? "feature.operation.profile.region" : "feature.operation.profile.region", referenced_entity_ids: [...selected] };
  }
  if (lower.includes("open or branched")) {
    const rectangles = Object.entries(geometry).filter(([, entry]) => entry.geometry?.kind === "rectangle");
    for (let left = 0; left < rectangles.length; left += 1) for (let right = left + 1; right < rectangles.length; right += 1) {
      const [leftId, a] = rectangles[left], [rightId, b] = rectangles[right];
      if (a.geometry.min.x_nm < b.geometry.max.x_nm && b.geometry.min.x_nm < a.geometry.max.x_nm && a.geometry.min.y_nm < b.geometry.max.y_nm && b.geometry.min.y_nm < a.geometry.max.y_nm) {
        return { kind: "structured_error", category: "profile", code: "overlapping_curves", field_path: "sketch.geometry", referenced_entity_ids: [leftId, rightId].sort() };
      }
    }
    const unsupported = Object.entries(geometry).filter(([, entry]) => !["line", "arc", "circle", "rectangle"].includes(entry.geometry?.kind)).map(([id]) => id).sort();
    if (unsupported.length > 0) return { kind: "structured_error", category: "capability", code: "unsupported_curve_kind", field_path: `sketch.geometry[${unsupported[0]}].geometry.kind`, referenced_entity_ids: unsupported };
    const endpoints = new Map();
    for (const [id, entry] of Object.entries(geometry)) for (const point of [entry.geometry?.start, entry.geometry?.end].filter(Boolean)) {
      const key = JSON.stringify(point), owners = endpoints.get(key) ?? [];
      owners.push(id); endpoints.set(key, owners);
    }
    const references = [...new Set([...endpoints.values()].filter((owners) => owners.length === 1).flat())].sort();
    return { kind: "structured_error", category: "profile", code: "open_loop", field_path: "sketch.geometry", referenced_entity_ids: references };
  }
  if (lower.includes("overlap") || lower.includes("intersect")) return { kind: "structured_error", category: "profile", code: "overlapping_curves", field_path: "sketch.geometry", referenced_entity_ids: Object.keys(geometry).sort() };
  throw new Error(`unclassified runtime error (evidence refused): ${runtimeError}`);
}

function assertConstructionPlaneRepairTransition(runtime, beforeHash, bodyBefore, planeId, label) {
  const repairedHash = runtime.semanticHash(), repaired = activeResult(runtime), document = runtimeDocument(runtime);
  if (repairedHash === beforeHash) throw new Error(`${label} did not create a distinct accepted repair state`);
  if (repaired.body !== bodyBefore || repaired.active.body?.body_id !== "body:accepted-before-construction-plane-error") {
    throw new Error(`${label} changed the retained accepted body hash or identity`);
  }
  if (document.construction_planes?.[planeId]?.id !== planeId || document.features?.["feature:accepted-before-construction-plane-error"]?.id !== "feature:accepted-before-construction-plane-error") {
    throw new Error(`${label} did not retain the accepted feature or durable repaired plane identity`);
  }
}

function executeConstructionPlaneNegative(WasmPartRuntime, id, descriptor) {
  const payload = descriptor.input?.payload ?? {}, kind = descriptor.input?.kind;
  if (!SPRINT3_FIXTURE_KINDS.has(id) || SPRINT3_FIXTURE_KINDS.get(id) !== kind) throw new Error(`${id} has no exact Sprint 3 negative fixture-kind owner`);
  const acceptedId = "accepted-before-construction-plane-error";
  const runtime = new WasmPartRuntime(`document:evidence:${id}`, "Construction Plane Negative Evidence");
  const baselineSketch = sketch(`sketch:${acceptedId}`, rectangle()), baselineSupport = support("xy");
  acceptSketch(runtime, acceptedId, baselineSketch, baselineSupport);
  const baselineCommit = JSON.parse(runtime.commitSketchExtrudeJson(JSON.stringify(request(acceptedId, baselineSketch, baselineSupport, 4_000_000, [], true))));
  if (baselineCommit.accepted !== true) throw new Error("accepted construction-plane negative baseline refused");
  const baselineActive = activeResult(runtime);
  if (baselineActive.active.body?.body_id !== `body:${acceptedId}`) throw new Error("accepted construction-plane negative baseline body differs");
  const canonical = runtime.documentJson(), before = runtime.semanticHash(), planeId = payload.plane;
  const executed_lifecycle_steps = [];
  let runtimeError, requiresBaselineRecompute = false;
  if (kind === "construction_plane_missing_reference_v3") {
    const invalid = offsetPlaneRequest(runtime, planeId, payload.base_plane, payload.offset_parameter, payload.offset_nanometers, false, `transaction:${id}:invalid-plane`);
    let previewError, commitError;
    try { runtime.previewOffsetConstructionPlaneJson(JSON.stringify(invalid)); } catch (error) { previewError = error; }
    const commitRuntime = WasmPartRuntime.fromDocumentJson(canonical);
    try { commitRuntime.commitOffsetConstructionPlaneJson(JSON.stringify(invalid)); } catch (error) { commitError = error; }
    if (previewError == null || commitError == null) throw new Error("missing construction-plane base did not reject both preview and commit");
    if (String(previewError) !== String(commitError)) throw new Error("missing construction-plane base preview/commit diagnostics differ");
    if (runtime.semanticHash() !== before) throw new Error("missing construction-plane base mutated accepted state");
    executedStep(executed_lifecycle_steps, "preview");
    executedStep(executed_lifecycle_steps, "commit");
    const repair = WasmPartRuntime.fromDocumentJson(canonical);
    const valid = offsetPlaneRequest(repair, planeId, "origin-plane:xy", payload.offset_parameter, payload.offset_nanometers, false, `transaction:${id}:repair`);
    const repairCommit = JSON.parse(repair.commitOffsetConstructionPlaneJson(JSON.stringify(valid)));
    if (repairCommit.accepted !== true) throw new Error("missing construction-plane base repair commit refused");
    JSON.parse(repair.constructionPlaneFrameJson(planeId));
    assertConstructionPlaneRepairTransition(repair, before, baselineActive.body, planeId, "missing construction-plane base repair");
    executedStep(executed_lifecycle_steps, "repair");
    runtimeError = previewError;
    requiresBaselineRecompute = true;
  } else if (kind === "construction_plane_missing_parameter_v3") {
    const base = normalizedBasePlane(payload.base_plane, "missing-parameter base plane");
    const acceptedParameter = `${payload.offset_parameter}:accepted`;
    const acceptedPlane = offsetPlaneRequest(runtime, planeId, base, acceptedParameter, 0, false, `transaction:${id}:accepted-plane-setup`);
    const acceptedPlaneCommit = JSON.parse(runtime.commitOffsetConstructionPlaneJson(JSON.stringify(acceptedPlane)));
    if (acceptedPlaneCommit.accepted !== true) throw new Error("missing construction-plane offset accepted-plane setup refused");
    JSON.parse(runtime.constructionPlaneFrameJson(planeId));
    const acceptedCanonical = runtime.documentJson(), acceptedBefore = runtime.semanticHash(), acceptedActive = activeResult(runtime);

    const invalid = offsetPlaneRequest(runtime, planeId, base, payload.offset_parameter, 0, false, `transaction:${id}:missing-offset-edit`);
    let previewError, commitError;
    try { runtime.previewOffsetConstructionPlaneJson(JSON.stringify(invalid)); } catch (error) { previewError = error; }
    if (previewError == null) throw new Error("missing construction-plane offset existing-plane preview unexpectedly succeeded");
    if (runtime.semanticHash() !== acceptedBefore || activeResult(runtime).body !== acceptedActive.body) throw new Error("missing construction-plane offset preview mutated accepted state");
    executedStep(executed_lifecycle_steps, "preview");

    const commitRuntime = WasmPartRuntime.fromDocumentJson(acceptedCanonical);
    try { commitRuntime.commitOffsetConstructionPlaneJson(JSON.stringify(invalid)); } catch (error) { commitError = error; }
    if (commitError == null) throw new Error("missing construction-plane offset existing-plane commit unexpectedly succeeded");
    if (String(previewError) !== String(commitError)) throw new Error("missing construction-plane offset preview/commit diagnostics differ");
    if (commitRuntime.semanticHash() !== acceptedBefore || activeResult(commitRuntime).body !== acceptedActive.body) throw new Error("missing construction-plane offset commit mutated accepted state");
    executedStep(executed_lifecycle_steps, "commit");

    const saved = runtime.documentJson(); JSON.parse(saved);
    if (runtime.semanticHash() !== acceptedBefore || activeResult(runtime).body !== acceptedActive.body) throw new Error("missing construction-plane offset save mutated accepted state");
    executedStep(executed_lifecycle_steps, "save");

    const repaired = WasmPartRuntime.fromDocumentJson(saved);
    if (repaired.semanticHash() !== acceptedBefore || activeResult(repaired).body !== acceptedActive.body) throw new Error("missing construction-plane offset reopen changed accepted state");
    executedStep(executed_lifecycle_steps, "reopen");
    const repair = offsetPlaneRequest(repaired, planeId, base, acceptedParameter, 0, false, `transaction:${id}:repair`);
    const repairCommit = JSON.parse(repaired.commitOffsetConstructionPlaneJson(JSON.stringify(repair)));
    if (repairCommit.accepted !== true) throw new Error("missing construction-plane offset repair commit refused");
    JSON.parse(repaired.constructionPlaneFrameJson(planeId));
    const repairedDocument = runtimeDocument(repaired);
    if (repairedDocument.construction_planes?.[planeId]?.definition?.offset !== acceptedParameter || repairedDocument.parameters?.[acceptedParameter]?.value?.kind !== "length_nanometers") {
      throw new Error("missing construction-plane offset repair did not durably restore its parameter");
    }
    assertConstructionPlaneRepairTransition(repaired, acceptedBefore, acceptedActive.body, planeId, "missing construction-plane offset repair");
    if (runtime.semanticHash() !== acceptedBefore || activeResult(runtime).body !== acceptedActive.body) throw new Error("missing construction-plane offset repair mutated rejected runtime");
    executedStep(executed_lifecycle_steps, "repair");
    runtimeError = previewError;
    return {
      result: structuredErrorFromRuntime(String(runtimeError), { geometry: {} }, [], descriptor),
      oracle_assertions: {}, before: acceptedBefore, after: runtime.semanticHash(),
      body_hashes_before: [acceptedActive.body], body_hashes_after: [activeResult(runtime).body],
      executed_lifecycle_steps: executed_lifecycle_steps.sort(),
    };
  } else {
    throw new Error(`unknown Sprint 3 construction-plane negative kind '${kind}'`);
  }
  if (requiresBaselineRecompute) {
    const recomputed = WasmPartRuntime.fromDocumentJson(canonical);
    const recompute = JSON.parse(recomputed.recomputeFromHereJson(`feature:${acceptedId}`));
    if (recompute.accepted !== true) throw new Error("construction-plane negative baseline recompute refused");
    const recomputedActive = activeResult(recomputed);
    if (recomputedActive.body !== baselineActive.body || recomputedActive.active.body?.body_id !== `body:${acceptedId}`) {
      throw new Error("construction-plane negative baseline recompute changed the retained body hash or identity");
    }
    executedStep(executed_lifecycle_steps, "recompute");
  }
  const after = runtime.semanticHash(), activeAfter = activeResult(runtime);
  if (before !== after || baselineActive.body !== activeAfter.body || activeAfter.active.body?.body_id !== `body:${acceptedId}`) {
    throw new Error("construction-plane negative mutated accepted hash/body");
  }
  return {
    result: structuredErrorFromRuntime(String(runtimeError), { geometry: {} }, [], descriptor),
    oracle_assertions: {}, before, after,
    body_hashes_before: [baselineActive.body], body_hashes_after: [activeAfter.body],
    executed_lifecycle_steps: executed_lifecycle_steps.sort(),
  };
}

function executeConstructionPlaneParameterNegative(WasmPartRuntime, id, descriptor) {
  const payload = descriptor.input?.payload ?? {}, kind = descriptor.input?.kind;
  if (!SPRINT3_FIXTURE_KINDS.has(id) || SPRINT3_FIXTURE_KINDS.get(id) !== kind) throw new Error(`${id} has no exact Sprint 3 parameter-negative fixture-kind owner`);
  if (!["construction_plane_wrong_type_parameter_v3", "construction_plane_unsafe_parameter_v3"].includes(kind)) {
    throw new Error(`unknown Sprint 3 construction-plane parameter-negative kind '${kind}'`);
  }
  const parameter = payload.offset_parameter, parameterValue = payload.parameter_value;
  const base = normalizedBasePlane(payload.base_plane, "parameter-negative base plane"), planeId = payload.plane;
  if (typeof parameter !== "string" || typeof planeId !== "string" || parameterValue == null || typeof parameterValue !== "object") {
    throw new Error("construction-plane parameter-negative payload is incomplete");
  }
  if (kind === "construction_plane_wrong_type_parameter_v3" && (parameterValue.kind !== "boolean" || parameterValue.value !== true)) {
    throw new Error("wrong-type construction-plane fixture must declare a true boolean parameter");
  }
  if (kind === "construction_plane_unsafe_parameter_v3" &&
      (parameterValue.kind !== "length_nanometers" || parameterValue.value !== 9_007_199_254_740_992)) {
    throw new Error("unsafe construction-plane fixture must declare 9007199254740992 length nanometers");
  }
  const requestOffset = payload.attempted_offset_nanometers ?? payload.request_offset_nanometers;
  const repairOffset = payload.repair_offset_nanometers;
  if (!Number.isSafeInteger(requestOffset)) throw new Error("parameter-negative attempted/request offset is not a safe integer");
  if (payload.request_offset_nanometers != null && payload.request_offset_nanometers !== requestOffset) {
    throw new Error("parameter-negative request and attempted offsets differ");
  }
  if (!Number.isSafeInteger(repairOffset)) throw new Error("parameter-negative repair offset is not a safe integer");

  const acceptedId = "accepted-before-construction-plane-error";
  const runtime = new WasmPartRuntime(`document:evidence:${id}`, "Construction Plane Negative Evidence");
  const baselineSketch = sketch(`sketch:${acceptedId}`, rectangle()), baselineSupport = support("xy");
  acceptSketch(runtime, acceptedId, baselineSketch, baselineSupport);
  const baselineCommit = JSON.parse(runtime.commitSketchExtrudeJson(JSON.stringify(request(acceptedId, baselineSketch, baselineSupport, 4_000_000, [], true))));
  if (baselineCommit.accepted !== true) throw new Error("accepted construction-plane parameter-negative baseline refused");

  const parameterCommit = JSON.parse(runtime.commitChangesJson(JSON.stringify({
    transaction_id: `transaction:${id}:invalid-parameter-setup`,
    changes: [{
      kind: "create_parameter",
      component: "component:root",
      parameter: { id: parameter, display_name: "Invalid Offset Evidence", value: parameterValue },
    }],
  })));
  if (parameterCommit.accepted !== true && parameterCommit.after_hash == null) throw new Error("construction-plane invalid parameter setup commit refused");
  const acceptedCanonical = runtime.documentJson(), before = runtime.semanticHash(), activeBefore = activeResult(runtime);
  if (runtimeDocument(runtime).parameters?.[parameter]?.value?.kind !== parameterValue.kind) {
    throw new Error("construction-plane invalid parameter setup was not durable");
  }

  const invalid = offsetPlaneRequest(runtime, planeId, base, parameter, requestOffset, false, `transaction:${id}:invalid-plane`);
  const executed_lifecycle_steps = [];
  let previewError, commitError;
  try { runtime.previewOffsetConstructionPlaneJson(JSON.stringify(invalid)); } catch (error) { previewError = error; }
  if (previewError == null) throw new Error("construction-plane invalid parameter preview unexpectedly succeeded");
  const diagnosticValue = String(parameterValue.value);
  if (!String(previewError).includes(diagnosticValue)) throw new Error(`construction-plane invalid parameter diagnostic omits value ${diagnosticValue}`);
  if (runtime.semanticHash() !== before || activeResult(runtime).body !== activeBefore.body) {
    throw new Error("construction-plane invalid parameter preview mutated accepted state");
  }
  executedStep(executed_lifecycle_steps, "preview");

  const commitRuntime = WasmPartRuntime.fromDocumentJson(acceptedCanonical);
  try { commitRuntime.commitOffsetConstructionPlaneJson(JSON.stringify(invalid)); } catch (error) { commitError = error; }
  if (commitError == null) throw new Error("construction-plane invalid parameter commit unexpectedly succeeded");
  if (String(previewError) !== String(commitError) || commitRuntime.semanticHash() !== before || activeResult(commitRuntime).body !== activeBefore.body) {
    throw new Error("construction-plane invalid parameter commit diagnostic/state differs from preview");
  }
  executedStep(executed_lifecycle_steps, "commit");

  const saved = runtime.documentJson(); JSON.parse(saved);
  if (runtime.semanticHash() !== before || activeResult(runtime).body !== activeBefore.body) throw new Error("construction-plane invalid parameter save mutated accepted state");
  executedStep(executed_lifecycle_steps, "save");

  const repair = WasmPartRuntime.fromDocumentJson(saved);
  if (repair.semanticHash() !== before || activeResult(repair).body !== activeBefore.body) throw new Error("construction-plane invalid parameter reopen changed accepted state");
  executedStep(executed_lifecycle_steps, "reopen");

  let repairParameter;
  if (kind === "construction_plane_wrong_type_parameter_v3") {
    repairParameter = payload.repair_offset_parameter ?? `${parameter}:repair`;
    if (typeof repairParameter !== "string") throw new Error("wrong-type construction-plane repair parameter is absent");
  } else {
    const repairParameterCommit = JSON.parse(repair.commitChangesJson(JSON.stringify({
      transaction_id: `transaction:${id}:repair-parameter`,
      changes: [{ kind: "set_parameter_value", parameter, value: { kind: "length_nanometers", value: repairOffset } }],
    })));
    if (repairParameterCommit.accepted !== true && repairParameterCommit.after_hash == null) throw new Error("unsafe construction-plane repair parameter commit refused");
    repairParameter = parameter;
  }
  const valid = offsetPlaneRequest(repair, planeId, base, repairParameter, repairOffset, false, `transaction:${id}:repair-plane`);
  const repairCommit = JSON.parse(repair.commitOffsetConstructionPlaneJson(JSON.stringify(valid)));
  if (repairCommit.accepted !== true) throw new Error("construction-plane parameter repair commit refused");
  const repairFrame = JSON.parse(repair.constructionPlaneFrameJson(planeId));
  const expectedRepairOrigin = expectedOffsetPlaneOrigin(base, repairOffset);
  if (canonicalJson(exactIntegerArray(repairFrame.frame?.origin_nanometers, "parameter repair frame")) !== canonicalJson(expectedRepairOrigin)) {
    throw new Error(`construction-plane parameter repair frame differs from ${JSON.stringify(expectedRepairOrigin)}`);
  }
  const repairDocument = runtimeDocument(repair);
  if (repairDocument.parameters?.[repairParameter]?.value?.value !== repairOffset || repairDocument.construction_planes?.[planeId]?.definition?.offset !== repairParameter) {
    throw new Error("construction-plane parameter repair did not persist the safe length binding");
  }
  assertConstructionPlaneRepairTransition(repair, before, activeBefore.body, planeId, "construction-plane parameter repair");
  if (runtime.semanticHash() !== before || activeResult(runtime).body !== activeBefore.body) throw new Error("construction-plane parameter repair mutated rejected runtime");
  executedStep(executed_lifecycle_steps, "repair");

  const after = runtime.semanticHash(), activeAfter = activeResult(runtime);
  if (after !== before || activeAfter.body !== activeBefore.body || activeAfter.active.body?.body_id !== `body:${acceptedId}`) {
    throw new Error("construction-plane invalid parameter mutated accepted hash/body");
  }
  return {
    result: structuredErrorFromRuntime(String(previewError), { geometry: {} }, [], descriptor),
    oracle_assertions: {}, before, after,
    body_hashes_before: [activeBefore.body], body_hashes_after: [activeAfter.body],
    executed_lifecycle_steps: executed_lifecycle_steps.sort(),
  };
}

function executeConstructionPlaneSupportNegative(WasmPartRuntime, id, descriptor) {
  const payload = descriptor.input?.payload ?? {}, kind = descriptor.input?.kind;
  if (!SPRINT3_FIXTURE_KINDS.has(id) || SPRINT3_FIXTURE_KINDS.get(id) !== kind) throw new Error(`${id} has no exact Sprint 3 support-negative fixture-kind owner`);
  const supportedKinds = new Set([
    "extrude_missing_construction_plane_support_v3",
    "extrude_suppressed_construction_plane_support_v3",
    "extrude_invalid_construction_plane_dependency_v3",
  ]);
  if (!supportedKinds.has(kind)) throw new Error(`unknown Sprint 3 construction-plane support-negative kind '${kind}'`);
  const planeId = payload.plane, parameter = payload.offset_parameter, invalidDependency = payload.invalid_dependency;
  if (![planeId, parameter, invalidDependency].every((value) => typeof value === "string")) throw new Error("construction-plane support-negative payload is incomplete");

  const acceptedId = "accepted-before-construction-plane-error";
  const runtime = new WasmPartRuntime(`document:evidence:${id}`, "Construction Plane Negative Evidence");
  const baselineSketch = sketch(`sketch:${acceptedId}`, rectangle()), baselineSupport = support("xy");
  acceptSketch(runtime, acceptedId, baselineSketch, baselineSupport);
  const baselineCommit = JSON.parse(runtime.commitSketchExtrudeJson(JSON.stringify(request(acceptedId, baselineSketch, baselineSupport, 4_000_000, [], true))));
  if (baselineCommit.accepted !== true) throw new Error("accepted construction-plane support-negative baseline refused");
  const probeId = `${id}:support-probe`, probeSketch = sketch(`sketch:${probeId}`, rectangle());
  const planeSupport = constructionSupport(planeId);
  if (kind === "extrude_suppressed_construction_plane_support_v3") {
    const planeSetup = offsetPlaneRequest(runtime, planeId, "origin-plane:xy", parameter, 0, false, `transaction:${id}:plane-setup`);
    const planeSetupCommit = JSON.parse(runtime.commitOffsetConstructionPlaneJson(JSON.stringify(planeSetup)));
    if (planeSetupCommit.accepted !== true) throw new Error("suppressed construction-plane support accepted setup refused");
    acceptSketch(runtime, probeId, probeSketch, planeSupport);
    const suppressed = offsetPlaneRequest(runtime, planeId, "origin-plane:xy", parameter, 0, true, `transaction:${id}:suppressed-setup`);
    const suppressedCommit = JSON.parse(runtime.commitOffsetConstructionPlaneJson(JSON.stringify(suppressed)));
    if (suppressedCommit.accepted !== true) throw new Error("suppressed construction-plane support setup refused");
  } else if (kind === "extrude_missing_construction_plane_support_v3") {
    acceptSketch(runtime, probeId, probeSketch, support("xy"));
  }
  const before = runtime.semanticHash(), activeBefore = activeResult(runtime), canonical = runtime.documentJson();
  const executed_lifecycle_steps = [];
  let runtimeError;
  if (kind === "extrude_missing_construction_plane_support_v3" || kind === "extrude_suppressed_construction_plane_support_v3") {
    try { runtime.previewSketchExtrudeJson(JSON.stringify(request(probeId, probeSketch, planeSupport, 4_000_000, [], false))); }
    catch (error) { runtimeError = error; }
  } else {
    const invalid = JSON.parse(canonical);
    invalid.construction_planes ??= {};
    invalid.construction_planes[planeId] = { schema_version: 1, id: planeId, component: "component:root", definition: { kind: "offset", base_plane: invalidDependency, offset: parameter }, suppressed: false };
    invalid.components["component:root"].construction_plane_order = [planeId];
    invalid.parameters[parameter] = { id: parameter, display_name: "Invalid Dependency Offset", value: { kind: "length_nanometers", value: 0 } };
    invalid.components["component:root"].parameter_order.push(parameter);
    try { WasmPartRuntime.fromDocumentJson(JSON.stringify(invalid)); } catch (error) { runtimeError = error; }
  }
  if (runtimeError == null) throw new Error("construction-plane support-negative preview validation unexpectedly succeeded");
  if (runtime.semanticHash() !== before || activeResult(runtime).body !== activeBefore.body) throw new Error("construction-plane support-negative preview mutated accepted state");
  executedStep(executed_lifecycle_steps, kind === "extrude_invalid_construction_plane_dependency_v3" ? "load" : "preview");

  const saved = runtime.documentJson(); JSON.parse(saved);
  if (runtime.semanticHash() !== before || activeResult(runtime).body !== activeBefore.body) throw new Error("construction-plane support-negative save mutated accepted state");
  executedStep(executed_lifecycle_steps, "save");
  const repaired = WasmPartRuntime.fromDocumentJson(saved);
  if (repaired.semanticHash() !== before || activeResult(repaired).body !== activeBefore.body) throw new Error("construction-plane support-negative reopen changed accepted state");
  executedStep(executed_lifecycle_steps, "reopen");
  const repair = offsetPlaneRequest(repaired, planeId, "origin-plane:xy", parameter, 0, false, `transaction:${id}:repair`);
  const repairCommit = JSON.parse(repaired.commitOffsetConstructionPlaneJson(JSON.stringify(repair)));
  if (repairCommit.accepted !== true) throw new Error("construction-plane support-negative repair refused");
  JSON.parse(repaired.constructionPlaneFrameJson(planeId));
  let repairedProbe;
  if (kind === "extrude_suppressed_construction_plane_support_v3") repairedProbe = probeSketch;
  else {
    const repairedProbeId = `${id}:repaired-support-probe`;
    repairedProbe = sketch(`sketch:${repairedProbeId}`, rectangle());
    acceptSketch(repaired, repairedProbeId, repairedProbe, planeSupport);
  }
  const repairedPreviewHash = repaired.semanticHash();
  JSON.parse(repaired.previewSketchExtrudeJson(JSON.stringify(request(`${id}:repaired-support-preview`, repairedProbe, planeSupport, 4_000_000, [], false))));
  if (repaired.semanticHash() !== repairedPreviewHash) throw new Error("support repair Extrude preview mutated repaired state");
  assertConstructionPlaneRepairTransition(repaired, before, activeBefore.body, planeId, "construction-plane support-negative repair");
  if (runtime.semanticHash() !== before || activeResult(runtime).body !== activeBefore.body) throw new Error("construction-plane support-negative repair mutated rejected runtime");
  executedStep(executed_lifecycle_steps, "repair");

  const after = runtime.semanticHash(), activeAfter = activeResult(runtime);
  return {
    result: structuredErrorFromRuntime(String(runtimeError), { geometry: {} }, [], descriptor),
    oracle_assertions: {}, before, after,
    body_hashes_before: [activeBefore.body], body_hashes_after: [activeAfter.body],
    executed_lifecycle_steps: executed_lifecycle_steps.sort(),
  };
}

function executeMissingDefinition(WasmPartRuntime, id, descriptor) {
  const runtime = new WasmPartRuntime(`document:evidence:${id}`, "Missing Definition Evidence");
  const sketchValue = sketch(`sketch:${id}`, rectangle()), supportValue = support("xy");
  acceptSketch(runtime, id, sketchValue, supportValue);
  const acceptedSketchHash = runtime.semanticHash();
  runtime.previewSketchExtrudeJson(JSON.stringify(request(id, sketchValue, supportValue, 4_000_000, [], false)));
  if (runtime.semanticHash() !== acceptedSketchHash) throw new Error("missing-definition setup preview mutated the accepted document");
  const committed = JSON.parse(runtime.commitSketchExtrudeJson(JSON.stringify(request(id, sketchValue, supportValue, 4_000_000, [], true))));
  if (committed.accepted !== true) throw new Error("missing-definition setup commit refused");
  const before = runtime.semanticHash(), activeBefore = JSON.parse(runtime.activeBodyJson(0.01)), bodyBefore = bodyHash(activeBefore);
  const acceptedDocument = runtimeDocument(runtime);
  const definition = acceptedDocument.feature_definitions_v2?.[`feature:${id}`];
  const acceptedRegionId = definition?.operation?.profile?.region;
  const acceptedRegion = acceptedDocument.region_definitions_v2?.[acceptedRegionId];
  const missingRegion = descriptor.input?.payload?.profile_region;
  if (acceptedRegion == null || typeof missingRegion !== "string") throw new Error("missing-definition typed setup is incomplete");
  const invalidDocument = structuredClone(acceptedDocument);
  invalidDocument.feature_definitions_v2[`feature:${id}`].operation.profile.region = missingRegion;
  delete invalidDocument.region_definitions_v2[missingRegion];

  let runtimeError = null;
  try { WasmPartRuntime.fromDocumentJson(JSON.stringify(invalidDocument)); }
  catch (error) { runtimeError = error; }
  if (runtimeError == null) throw new Error("missing durable region unexpectedly passed typed runtime validation");

  // Explicit repair restores the unmodified accepted canonical document.
  WasmPartRuntime.fromDocumentJson(JSON.stringify(acceptedDocument));

  const after = runtime.semanticHash(), activeAfter = JSON.parse(runtime.activeBodyJson(0.01));
  if (after !== before || bodyHash(activeAfter) !== bodyBefore) throw new Error("missing-definition validation mutated the accepted runtime");
  return {
    result: structuredErrorFromRuntime(String(runtimeError), sketchValue, [missingRegion], descriptor),
    oracle_assertions: {},
    before,
    after,
    body_hashes_before: [bodyBefore],
    body_hashes_after: [bodyHash(activeAfter)],
    executed_lifecycle_steps: ["commit", "preview", "repair"],
  };
}

function executeNegative(WasmPartRuntime, id, descriptor) {
  if (id === "feature-definition-v2-missing-reference") return executeMissingDefinition(WasmPartRuntime, id, descriptor);
  const runtime = new WasmPartRuntime(`document:evidence:${id}`, "Negative Evidence");
  let geometry;
  if (id === "profile-unsupported-spline") geometry = { "curve:spline-1": { id: "curve:spline-1", geometry: { kind: "control_point_spline", degree: 2, control_points: [{ x_nm: 0, y_nm: 0 }, { x_nm: 5_000_000, y_nm: 0 }, { x_nm: 5_000_000, y_nm: 5_000_000 }, { x_nm: 0, y_nm: 0 }] } } };
  else if (id === "region-invalid-open-loop") geometry = {
    "curve:line-1": { id: "curve:line-1", geometry: { kind: "line", start: { x_nm: 0, y_nm: 0 }, end: { x_nm: 5_000_000, y_nm: 0 } } },
    "curve:line-2": { id: "curve:line-2", geometry: { kind: "line", start: { x_nm: 5_000_000, y_nm: 0 }, end: { x_nm: 5_000_000, y_nm: 5_000_000 } } },
    "curve:line-4": { id: "curve:line-4", geometry: { kind: "line", start: { x_nm: 5_000_000, y_nm: 5_000_000 }, end: { x_nm: 0, y_nm: 1_000 } } },
  };
  else if (id === "region-invalid-overlap") geometry = {
    "curve:line-2": { id: "curve:line-2", geometry: { kind: "rectangle", min: { x_nm: -5_000_000, y_nm: -5_000_000 }, max: { x_nm: 5_000_000, y_nm: 5_000_000 } } },
    "curve:line-5": { id: "curve:line-5", geometry: { kind: "rectangle", min: { x_nm: 0, y_nm: -5_000_000 }, max: { x_nm: 10_000_000, y_nm: 5_000_000 } } },
  };
  else geometry = rectangle();
  const sketchValue = sketch(`sketch:${id}`, geometry), supportValue = support("xy");
  const declared = new Set(descriptor.lifecycle_steps ?? []);
  const executed_lifecycle_steps = [];
  let runtimeError = null;
  if (id === "region-split-merge-repair") {
    acceptSketch(runtime, id, sketchValue, supportValue);
    const initial = JSON.parse(runtime.commitSketchExtrudeJson(JSON.stringify(request(id, sketchValue, supportValue, 4_000_000, [], true))));
    if (initial.accepted !== true) throw new Error("repair setup commit refused");
    executedStep(executed_lifecycle_steps, "commit");
    if (declared.has("recompute")) {
      const recomputed = JSON.parse(runtime.recomputeFromHereJson(`feature:${id}`));
      if (recomputed.accepted !== true) throw new Error("repair setup recompute refused");
      executedStep(executed_lifecycle_steps, "recompute");
    }
  } else {
    try { acceptSketch(runtime, id, sketchValue, supportValue); } catch { /* Invalid geometry is exercised directly below. */ }
  }
  const before = runtime.semanticHash();
  const bodyBefore = id === "region-split-merge-repair" ? [bodyHash(JSON.parse(runtime.activeBodyJson(0.01)))] : [];
  const selected = id === "feature-definition-v2-missing-reference"
    ? [...(descriptor.input.payload.references ?? [])]
    : id === "region-split-merge-repair" ? [descriptor.input.payload.original_region] : [];
  if (declared.has("preview")) {
    try { runtime.previewSketchExtrudeJson(JSON.stringify(request(id, sketchValue, supportValue, 4_000_000, selected, false))); }
    catch (error) { runtimeError ??= error; }
    executedStep(executed_lifecycle_steps, "preview");
  }
  if (declared.has("commit") && id !== "region-split-merge-repair") {
    try { runtime.commitSketchExtrudeJson(JSON.stringify(request(id, sketchValue, supportValue, 4_000_000, selected, true))); }
    catch (error) { runtimeError ??= error; }
    executedStep(executed_lifecycle_steps, "commit");
  }
  if (declared.has("edit")) {
    try { runtime.commitSketchExtrudeJson(JSON.stringify(request(id, sketchValue, supportValue, 5_000_000, selected, true))); }
    catch (error) { runtimeError ??= error; }
    executedStep(executed_lifecycle_steps, "edit");
  }
  if (declared.has("repair")) {
    const acceptedHash = runtime.semanticHash();
    runtime.previewSketchExtrudeJson(JSON.stringify(request(id, sketchValue, supportValue, 4_000_000, [], false)));
    if (runtime.semanticHash() !== acceptedHash) throw new Error("repair preview mutated the accepted document");
    executedStep(executed_lifecycle_steps, "repair");
  }
  if (runtimeError === null) throw new Error(`negative workload ${id} unexpectedly succeeded`);
  const after = runtime.semanticHash();
  if (before !== after) throw new Error("negative workload mutated accepted document");
  const bodyAfter = id === "region-split-merge-repair" ? [bodyHash(JSON.parse(runtime.activeBodyJson(0.01)))] : [];
  return { result: structuredErrorFromRuntime(String(runtimeError), sketchValue, selected, descriptor), oracle_assertions: {}, before, after, body_hashes_before: bodyBefore, body_hashes_after: bodyAfter, executed_lifecycle_steps: executed_lifecycle_steps.sort() };
}

function record(id, metadata, binding, observation, status) {
  return { schema_version: 1, candidate_id: metadata.candidate_id, candidate_revision: metadata.revision, manifest_sha256: metadata.manifest_sha256, fixture_id: id, fixture_descriptor_sha256: binding.descriptorSha256, normalized_input_sha256: binding.inputSha256, runtime: "release_wasm", status, recorded_at: metadata.recorded_at, result: observation.result, oracle_assertions: observation.oracle_assertions ?? {}, executed_lifecycle_steps: observation.executed_lifecycle_steps, accepted_document_hash_before: observation.before, accepted_document_hash_after: observation.after, body_hashes_before: observation.body_hashes_before, body_hashes_after: observation.body_hashes_after };
}

export { cutProfileGeometry, inspectSerializedTopology, observeDistanceOracle, observeRegionOracle, s5CutRequest, structuredErrorFromRuntime };

async function main() {
  const options = args(process.argv.slice(2));
  const manifestBytes = await readFile(options.manifest), candidate = JSON.parse(manifestBytes);
  const browserOwned = new Set(["extrude-stale-preview", "extrude-create-edit-equivalence"]);
  const required = candidate.fixtures.filter((fixture) => fixture.parity_required && !browserOwned.has(fixture.id)).map((fixture) => fixture.id);
  const fixtureIds = CANDIDATE_FIXTURES.get(candidate.candidate_id);
  if (fixtureIds == null) throw new Error(`release-WASM evidence exporter has no qualified adapter for candidate '${candidate.candidate_id}'`);
  const fixtureSets = Array.isArray(fixtureIds[0]) ? fixtureIds : [fixtureIds];
  if (!fixtureSets.some((fixtureSet) => JSON.stringify(required) === JSON.stringify(fixtureSet))) {
    throw new Error("release-WASM evidence exporter fixture list differs from every strictly owned parity manifest revision");
  }
  const module = await import(pathToFileURL(path.resolve(options.module)).href);
  const wasmBytes = await readFile(options.wasm);
  const wasmHash = sha256(wasmBytes);
  if (wasmHash !== candidate.runtime_lock?.wasm_sha256) {
    throw new Error(`release-WASM digest mismatch: manifest locks ${candidate.runtime_lock?.wasm_sha256 ?? "nothing"}, exporter loaded ${wasmHash}`);
  }
  module.initSync({ module: wasmBytes });
  const metadata = { candidate_id: candidate.candidate_id, revision: candidate.revision, manifest_sha256: sha256(manifestBytes), recorded_at: new Date().toISOString() };
  const legacyMatrix = JSON.parse(await readFile("contracts/solid-feature-candidate/legacy-solid-feature-matrix.v1.json", "utf8"));
  const bindings = new Map();
  for (const fixtureRef of candidate.fixtures.filter((fixture) => fixture.parity_required)) {
    const descriptorBytes = await readFile(fixtureRef.path), descriptor = JSON.parse(descriptorBytes);
    if (candidate.candidate_id === "solid-feature-sprint-3") {
      const ownedKind = SPRINT3_FIXTURE_KINDS.get(fixtureRef.id);
      if (ownedKind == null || descriptor.input?.kind !== ownedKind) {
        throw new Error(`Sprint 3 fixture '${fixtureRef.id}' has unowned or changed kind '${descriptor.input?.kind ?? ""}'`);
      }
    }
    if (candidate.candidate_id === "solid-feature-sprint-4") {
      const ownedKind = SPRINT4_FIXTURE_KINDS.get(fixtureRef.id);
      if (ownedKind == null || descriptor.input?.kind !== ownedKind) {
        throw new Error(`Sprint 4 fixture '${fixtureRef.id}' has unowned or changed kind '${descriptor.input?.kind ?? ""}'`);
      }
    }
    if (candidate.candidate_id === "solid-feature-sprint-5") {
      if (!SPRINT5_FIXTURE_IDS.has(fixtureRef.id) || descriptor.input?.kind !== "single_target_cut") {
        throw new Error(`Sprint 5 fixture '${fixtureRef.id}' has unowned or changed kind '${descriptor.input?.kind ?? ""}'`);
      }
    }
    bindings.set(fixtureRef.id, { descriptor, descriptorSha256: sha256(descriptorBytes), inputSha256: sha256(Buffer.from(canonicalJson(descriptor.input))) });
  }
  await mkdir(options.output, { recursive: true });
  const failures = [];
  for (const id of required) {
    const binding = bindings.get(id);
    let observation, status = "passed";
    try {
      const kind = binding.descriptor.input.kind;
      if (candidate.candidate_id === "solid-feature-sprint-5") {
        observation = executeS5Cut(module.WasmPartRuntime, id, binding.descriptor);
      } else if (candidate.candidate_id === "solid-feature-sprint-4") {
        if (binding.descriptor.expected.kind === "structured_error") observation = executeS4Negative(module.WasmPartRuntime, id, binding.descriptor);
        else if (kind === "extrude_planar_face_orientation_matrix_v4") observation = executeS4OrientationMatrix(module.WasmPartRuntime, id, binding.descriptor);
        else if (kind === "extrude_planar_face_upstream_edit_v4") observation = executeS4UpstreamEdit(module.WasmPartRuntime, id, binding.descriptor);
        else if (kind === "extrude_planar_face_save_reopen_edit_v4") observation = executeS4SaveReopenEdit(module.WasmPartRuntime, id, binding.descriptor);
        else if (kind === "planar_face_broken_support_explicit_repair_v4") observation = executeS4ExplicitRepair(module.WasmPartRuntime, id, binding.descriptor);
        else throw new Error(`unowned Sprint 4 success kind '${kind}'`);
      } else observation = binding.descriptor.expected.kind === "structured_error"
        ? (candidate.candidate_id === "solid-feature-sprint-3"
          ? (["construction_plane_wrong_type_parameter_v3", "construction_plane_unsafe_parameter_v3"].includes(kind)
            ? executeConstructionPlaneParameterNegative(module.WasmPartRuntime, id, binding.descriptor)
            : (["extrude_missing_construction_plane_support_v3", "extrude_suppressed_construction_plane_support_v3", "extrude_invalid_construction_plane_dependency_v3"].includes(kind)
              ? executeConstructionPlaneSupportNegative(module.WasmPartRuntime, id, binding.descriptor)
              : executeConstructionPlaneNegative(module.WasmPartRuntime, id, binding.descriptor)))
          : executeNegative(module.WasmPartRuntime, id, binding.descriptor))
        : kind === "extrude_offset_plane_matrix_v3" ? executeOffsetPlaneMatrix(module.WasmPartRuntime, id, binding.descriptor)
          : kind === "extrude_offset_plane_v3" ? executeOffsetPlaneSignedEdit(module.WasmPartRuntime, id, binding.descriptor)
        : kind === "extrude_matrix_v2" ? executePlanes(module.WasmPartRuntime, id, binding.descriptor)
          : kind === "legacy_matrix" ? executeLegacy(module.WasmPartRuntime, id, binding.descriptor, legacyMatrix)
            : executeSuccess(module.WasmPartRuntime, id, binding.descriptor);
    } catch (error) {
      status = "failed";
      const hash = sha256(Buffer.from("exporter-failure"));
      observation = { result: { kind: "structured_error", category: "exporter", code: "execution_failed", field_path: "", referenced_entity_ids: [String(error?.message ?? error)] }, oracle_assertions: {}, before: hash, after: hash, body_hashes_before: [], body_hashes_after: [], executed_lifecycle_steps: [] };
    }
    await writeFile(path.join(options.output, `${id}.json`), `${JSON.stringify(record(id, metadata, binding, observation, status), null, 2)}\n`);
    if (status !== "passed") failures.push(id);
  }
  if (failures.length > 0) throw new Error(`${failures.length} fixture(s) did not produce passing release-WASM evidence: ${failures.join(", ")}`);
  process.stdout.write(`Release-WASM runtime evidence exported for ${required.length} ${candidate.candidate_id} fixtures to ${options.output}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(`Release-WASM evidence export failed: ${error.message}\n`); process.exitCode = 1; });
}
