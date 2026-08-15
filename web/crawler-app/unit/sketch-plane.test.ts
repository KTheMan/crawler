import assert from "node:assert/strict";
import test from "node:test";

import {
  intersectRayWithSketchPlane,
  originPlaneSupport,
  planeLocalToWorldMillimeters,
  planarFaceEvidenceKey,
  resolveSketchPlane,
  worldMillimetersToPlaneLocal,
  type OriginPlane,
} from "../src/sketch-plane.ts";

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

test("topology support requires current body-qualified planar face evidence", () => {
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
  assert.equal(resolved.status, "ready");
  if (resolved.status === "ready") assert.deepEqual(resolved.plane.origin_nanometers, current.centroid_nanometers);
});

test("current face evidence owns the frame while durable fallback owns normal polarity only", () => {
  const support = { kind: "topology" as const, reference: "topology:moving-face" };
  const body = "body:moving";
  const kernelId = "42";
  const faceDocument = {
    topology_references: {
      "topology:moving-face": {
        id: "topology:moving-face",
        body,
        kind: "face",
        stable_kernel_id: kernelId,
        fallback_signature: {
          kind: "face",
          centroid_nanometers: [1, 2, 3],
          normal_millionths: [0, 0, 1_000_000],
        },
      },
    },
  };
  const current = {
    body,
    stable_kernel_id: kernelId,
    centroid_nanometers: [40_000_000, 50_000_000, 60_000_000] as const,
    // Simulate packet winding opposite the durable semantic orientation.
    normal_millionths: [0, 0, -1_000_000] as const,
  };
  const result = resolveSketchPlane(support, faceDocument, new Map([[planarFaceEvidenceKey(body, kernelId), current]]));
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.deepEqual(result.plane.origin_nanometers, current.centroid_nanometers);
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
