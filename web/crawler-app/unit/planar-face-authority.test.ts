import assert from "node:assert/strict";
import test from "node:test";

import { bodyAcceptsFeatureProducer, normalizePlanarFaceFrameResult } from "../src/planar-face-authority.ts";
import type { PlanarFaceFrameRequest } from "../src/protocol.ts";

const request: PlanarFaceFrameRequest = {
  type: "resolve-planar-face-frame", requestId: "request:1", topologyReferenceId: "topology:face",
  bodyId: "body:1", faceStableId: "42", expectedAcceptedRevision: 9,
  expectedProducerFeatureId: "feature:extrude", expectedComponentId: "component:1",
};

const success = {
  found: true, accepted_revision: 9, body_id: "body:1", component_id: "component:1",
  producer_feature_id: "feature:extrude", face_kind: "face", face_stable_id: "42",
  analytic_surface: "plane", origin_vertex_stable_id: "7", handedness: "right",
  scale_millionths: 1_000_000, orthonormal_tolerance_millionths: 2,
  frame_convention: "lowest-vertex-and-longest-edge-v1",
  frame: {
    origin_nanometers: [1, 2, 3], x_axis_millionths: [1_000_000, 0, 0],
    y_axis_millionths: [0, 1_000_000, 0], normal_millionths: [0, 0, 1_000_000],
  },
};

test("same-body modifier lineage accepts only explicitly retained producers", () => {
  const body = { generated_by: "feature:cut", producer_lineage: ["feature:base"] };
  assert.equal(bodyAcceptsFeatureProducer(body, "feature:cut"), true);
  assert.equal(bodyAcceptsFeatureProducer(body, "feature:base"), true);
  assert.equal(bodyAcceptsFeatureProducer(body, "feature:wrong"), false);
  assert.equal(bodyAcceptsFeatureProducer(undefined, "feature:base"), false);
});

test("normalizes an exact native planar-face frame", () => {
  const result = normalizePlanarFaceFrameResult(success, request);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.authority.frame.originNanometers, [1, 2, 3]);
    assert.equal(result.authority.originVertexStableId, "7");
  }
});

test("rejects a stale revision/body/producer/component identity without a frame", () => {
  for (const override of [
    { accepted_revision: 10 }, { body_id: "body:other" }, { producer_feature_id: "feature:other" }, { component_id: "component:other" },
  ]) {
    const result = normalizePlanarFaceFrameResult({ ...success, ...override }, request);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.diagnostic.code, "stale_planar_face_authority");
  }
});

test("preserves native missing/nonplanar diagnostics", () => {
  const result = normalizePlanarFaceFrameResult({
    found: false, body_id: "body:1", face_stable_id: "42",
    error: { code: "nonplanar_face", category: "unsupported", field: "planar_face.face_stable_id", message: "face is cylindrical",
      reference: { body_id: "body:1", face_stable_id: "42" }, referenced_body_ids: ["body:1"] },
  }, request);
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.diagnostic, {
    code: "nonplanar_face", category: "unsupported", field: "planar_face.face_stable_id", message: "face is cylindrical",
    reference: { bodyId: "body:1", faceStableId: "42" }, referencedBodyIds: ["body:1"],
  });
});

test("rejects malformed unsafe frame coordinates", () => {
  const result = normalizePlanarFaceFrameResult({ ...success, frame: { ...success.frame, origin_nanometers: [Number.MAX_SAFE_INTEGER + 1, 2, 3] } }, request);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.diagnostic.code, "invalid_planar_face_frame_response");
});
