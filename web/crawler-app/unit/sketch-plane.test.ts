import assert from "node:assert/strict";
import test from "node:test";

import {
  intersectRayWithSketchPlane,
  originPlaneSupport,
  planeLocalToWorldMillimeters,
  planarFaceEvidenceKey,
  resolvedSketchPlanesEqual,
  resolveSketchPlane,
  worldMillimetersToPlaneLocal,
  type OriginPlane,
} from "../src/sketch-plane.ts";
import type { PlanarFaceFrameAuthority } from "../src/protocol.ts";

function nativeAuthority(bodyId: string, faceStableId: string, origin: readonly [number, number, number]): PlanarFaceFrameAuthority {
  return {
    acceptedRevision: 7, bodyId, componentId: "component:part", producerFeatureId: "feature:producer",
    faceStableId, originVertexStableId: "1", frameConvention: "planar-face-v1", handedness: "right",
    scaleMillionths: 1_000_000, orthonormalToleranceMillionths: 2,
    frame: { originNanometers: origin, xAxisMillionths: [1_000_000, 0, 0], yAxisMillionths: [0, 1_000_000, 0], normalMillionths: [0, 0, 1_000_000] },
  };
}

const document = {
  origin_planes: {
    "origin-plane:xy": { id: "origin-plane:xy", plane: "xy" as const, normal_millionths: [0, 0, 1_000_000], x_axis_millionths: [1_000_000, 0, 0] },
    "origin-plane:xz": { id: "origin-plane:xz", plane: "xz" as const, normal_millionths: [0, -1_000_000, 0], x_axis_millionths: [1_000_000, 0, 0] },
    "origin-plane:yz": { id: "origin-plane:yz", plane: "yz" as const, normal_millionths: [1_000_000, 0, 0], x_axis_millionths: [0, 1_000_000, 0] },
  },
};

test("XY, XZ, and YZ resolve to right-handed durable local frames", () => {
  const expected = {
    xy: { x: [1_000_000, 0, 0], y: [0, 1_000_000, 0], n: [0, 0, 1_000_000] },
    xz: { x: [1_000_000, 0, 0], y: [0, 0, 1_000_000], n: [0, -1_000_000, 0] },
    yz: { x: [0, 1_000_000, 0], y: [0, 0, 1_000_000], n: [1_000_000, 0, 0] },
  } as const;
  for (const planeName of ["xy", "xz", "yz"] satisfies OriginPlane[]) {
    const result = resolveSketchPlane(originPlaneSupport(planeName), document);
    assert.equal(result.status, "ready");
    if (result.status !== "ready") continue;
    assert.deepEqual(result.plane.x_axis_millionths, expected[planeName].x);
    assert.deepEqual(result.plane.y_axis_millionths, expected[planeName].y);
    assert.deepEqual(result.plane.normal_millionths, expected[planeName].n);
  }
});

test("plane-local nanometers round-trip through 3D model millimeters", () => {
  const point = { x_nm: 3_250_000, y_nm: -7_500_000 };
  for (const planeName of ["xy", "xz", "yz"] satisfies OriginPlane[]) {
    const result = resolveSketchPlane(originPlaneSupport(planeName), document);
    assert.equal(result.status, "ready");
    if (result.status !== "ready") continue;
    const world = planeLocalToWorldMillimeters(point, result.plane);
    assert.deepEqual(worldMillimetersToPlaneLocal(world, result.plane), point);
  }
});

test("resolved support equality normalizes serialized origin support while preserving plane boundaries", () => {
  const directXy = resolveSketchPlane({ kind: "origin_plane", plane: "xy" }, document);
  const referencedXy = resolveSketchPlane(originPlaneSupport("xy"), document);
  const referencedXz = resolveSketchPlane(originPlaneSupport("xz"), document);
  assert.equal(directXy.status, "ready");
  assert.equal(referencedXy.status, "ready");
  assert.equal(referencedXz.status, "ready");
  if (directXy.status !== "ready" || referencedXy.status !== "ready" || referencedXz.status !== "ready") return;
  assert.equal(resolvedSketchPlanesEqual(directXy.plane, referencedXy.plane), true);
  assert.equal(resolvedSketchPlanesEqual(referencedXy.plane, referencedXz.plane), false);
});

test("offset construction planes derive exact frames from all three durable origin bases", () => {
  const constructionDocument = {
    ...document,
    construction_planes: Object.fromEntries((["xy", "xz", "yz"] as const).map((plane) => [`plane:${plane}`, {
      schema_version: 1,
      id: `plane:${plane}`,
      definition: { kind: "offset", base_plane: `origin-plane:${plane}`, offset: `parameter:${plane}` },
    }])),
    parameters: Object.fromEntries((["xy", "xz", "yz"] as const).map((plane) => [`parameter:${plane}`, {
      value: { kind: "length_nanometers", value: plane === "xz" ? -4_000_000 : 4_000_000 },
    }])),
  };
  const expectedOrigins = { xy: [0, 0, 4_000_000], xz: [0, 4_000_000, 0], yz: [4_000_000, 0, 0] } as const;
  for (const plane of ["xy", "xz", "yz"] as const) {
    const result = resolveSketchPlane({ kind: "construction_plane_reference", plane: `plane:${plane}` }, constructionDocument);
    assert.equal(result.status, "ready");
    if (result.status === "ready") {
      assert.deepEqual(result.plane.origin_nanometers, expectedOrigins[plane]);
      assert.deepEqual(worldMillimetersToPlaneLocal(planeLocalToWorldMillimeters({ x_nm: 7_000_000, y_nm: -9_000_000 }, result.plane), result.plane), { x_nm: 7_000_000, y_nm: -9_000_000 });
    }
  }
});

test("offset construction-plane translation remains exact near the safe-integer boundary", () => {
  const offset = Number.MAX_SAFE_INTEGER - 10;
  assert.notEqual(offset * 1_000_000 / 1_000_000, offset, "fixture must expose Number multiplication drift");
  for (const [plane, expected] of [
    ["xy", [0, 0, offset]],
    ["xz", [0, -offset, 0]],
    ["yz", [offset, 0, 0]],
  ] as const) {
    const result = resolveSketchPlane({ kind: "construction_plane_reference", plane: `plane:boundary:${plane}` }, {
      ...document,
      construction_planes: {
        [`plane:boundary:${plane}`]: {
          schema_version: 1,
          id: `plane:boundary:${plane}`,
          definition: { kind: "offset", base_plane: `origin-plane:${plane}`, offset: "parameter:boundary" },
        },
      },
      parameters: { "parameter:boundary": { value: { kind: "length_nanometers", value: offset } } },
    });
    assert.equal(result.status, "ready");
    if (result.status === "ready") assert.deepEqual(result.plane.origin_nanometers, expected);
  }
});

test("construction planes reject captured frames and missing, suppressed, or invalid authority", () => {
  const support = { kind: "construction_plane_reference" as const, plane: "plane:offset" };
  assert.equal(resolveSketchPlane(support, {
    construction_planes: { "plane:offset": { origin_nanometers: [0, 0, 5_000_000], x_axis_millionths: [1_000_000, 0, 0], normal_millionths: [0, 0, 1_000_000] } } as never,
  }).status, "invalid_reference");
  assert.equal(resolveSketchPlane(support, {
    construction_planes: { "plane:offset": { schema_version: 1, definition: { kind: "offset", base_plane: "origin-plane:xy", offset: "parameter:missing" } } },
    origin_planes: document.origin_planes,
  }).status, "missing_reference");
  assert.equal(resolveSketchPlane(support, {
    construction_planes: { "plane:offset": { schema_version: 1, definition: { kind: "offset", base_plane: "origin-plane:xy", offset: "parameter:offset" }, suppressed: true } },
  }).status, "suppressed_reference");
  assert.equal(resolveSketchPlane(support, {
    construction_planes: { "plane:offset": { schema_version: 1, definition: { kind: "offset", base_plane: "origin-plane:xy", offset: "parameter:offset" } } },
    origin_planes: document.origin_planes,
    parameters: { "parameter:offset": { value: { kind: "scalar_millionths", value: 4_000_000 } } },
  }).status, "invalid_reference");
});

test("camera rays intersect XZ and YZ into the same solver-local 2D coordinates", () => {
  const xz = resolveSketchPlane(originPlaneSupport("xz"), document);
  const yz = resolveSketchPlane(originPlaneSupport("yz"), document);
  assert.equal(xz.status, "ready");
  assert.equal(yz.status, "ready");
  if (xz.status !== "ready" || yz.status !== "ready") return;
  assert.deepEqual(intersectRayWithSketchPlane([1, -10, 2], [0, 1, 0], xz.plane), { x_nm: 1_000_000, y_nm: 2_000_000 });
  assert.deepEqual(intersectRayWithSketchPlane([10, 1, 2], [-1, 0, 0], yz.plane), { x_nm: 1_000_000, y_nm: 2_000_000 });
  assert.equal(intersectRayWithSketchPlane([0, 0, 1], [1, 0, 0], xz.plane), undefined);
});

test("topology support requires native frame authority; renderer evidence alone cannot authorize it", () => {
  const support = { kind: "topology" as const, reference: "topology:face" };
  const kernelId = "18446744073709551614";
  const body = "body:face";
  const faceDocument = {
    topology_references: {
      "topology:face": {
        id: "topology:face",
        body,
        kind: "face",
        stable_kernel_id: kernelId,
        fallback_signature: {
          kind: "face",
          centroid_nanometers: [5_000_000, 6_000_000, 7_000_000],
          normal_millionths: [0, 0, 1_000_000],
        },
      },
    },
  };
  assert.equal(resolveSketchPlane(support, faceDocument).status, "surface_evidence_required");
  // A bare stable-ID set proves neither current position nor owning body.
  assert.equal(resolveSketchPlane(support, faceDocument, new Set([kernelId])).status, "surface_evidence_required");
  const current = {
    body,
    stable_kernel_id: kernelId,
    centroid_nanometers: [9_000_000, 10_000_000, 11_000_000] as const,
    normal_millionths: [0, 0, 1_000_000] as const,
    area_square_nanometers: 12_000_000,
  };
  const resolved = resolveSketchPlane(support, faceDocument, new Map([[planarFaceEvidenceKey(body, kernelId), current]]));
  assert.equal(resolved.status, "surface_evidence_required");
  const authority = nativeAuthority(body, kernelId, [1_000_000, 2_000_000, 3_000_000]);
  const nativeResolved = resolveSketchPlane(
    support, faceDocument,
    new Map([[planarFaceEvidenceKey(body, kernelId), current]]),
    new Map([[planarFaceEvidenceKey(body, kernelId), authority]]),
  );
  assert.equal(nativeResolved.status, "ready");
  if (nativeResolved.status === "ready") assert.deepEqual(nativeResolved.plane.origin_nanometers, authority.frame.originNanometers);
});

test("renderer centroid and winding never own the planar-face frame", () => {
  const support = { kind: "topology" as const, reference: "topology:moving-face" };
  const body = "body:moving";
  const kernelId = "42";
  const faceDocument = {
    topology_references: {
      "topology:moving-face": {
        id: "topology:moving-face", body, kind: "face", stable_kernel_id: kernelId,
        fallback_signature: { kind: "face", centroid_nanometers: [1, 2, 3], normal_millionths: [0, 0, 1_000_000] },
      },
    },
  };
  const rendererEvidence = { body, stable_kernel_id: kernelId, centroid_nanometers: [40_000_000, 50_000_000, 60_000_000] as const, normal_millionths: [0, 0, -1_000_000] as const };
  const authority = nativeAuthority(body, kernelId, [7, 8, 9]);
  const result = resolveSketchPlane(
    support, faceDocument,
    new Map([[planarFaceEvidenceKey(body, kernelId), rendererEvidence]]),
    new Map([[planarFaceEvidenceKey(body, kernelId), authority]]),
  );
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.deepEqual(result.plane.origin_nanometers, [7, 8, 9]);
  assert.deepEqual(result.plane.normal_millionths, [0, 0, 1_000_000]);
});

test("topology evidence cannot cross body or stable-ID boundaries", () => {
  const support = { kind: "topology" as const, reference: "topology:face" };
  const documentValue = {
    topology_references: {
      "topology:face": {
        id: "topology:face",
        body: "body:expected",
        kind: "face",
        stable_kernel_id: "9",
        fallback_signature: { kind: "face", centroid_nanometers: [0, 0, 0], normal_millionths: [0, 0, 1_000_000] },
      },
    },
  };
  const wrongBody = { body: "body:other", stable_kernel_id: "9", centroid_nanometers: [1, 2, 3] as const, normal_millionths: [0, 0, 1_000_000] as const };
  const wrongId = { body: "body:expected", stable_kernel_id: "10", centroid_nanometers: [1, 2, 3] as const, normal_millionths: [0, 0, 1_000_000] as const };
  assert.equal(resolveSketchPlane(support, documentValue, new Map([[planarFaceEvidenceKey(wrongBody.body, wrongBody.stable_kernel_id), wrongBody]])).status, "surface_evidence_required");
  assert.equal(resolveSketchPlane(support, documentValue, new Map([[planarFaceEvidenceKey(wrongId.body, wrongId.stable_kernel_id), wrongId]])).status, "surface_evidence_required");
});
