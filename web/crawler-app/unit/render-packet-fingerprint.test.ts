import assert from "node:assert/strict";
import test from "node:test";

import type { RenderPacket } from "../src/protocol.ts";
import { renderPacketTopologyFingerprint } from "../src/render-packet-fingerprint.ts";

function packet(): RenderPacket {
  return {
    version: 1,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    triangleIndices: new Uint32Array([0, 1, 2]),
    faceRanges: new Uint32Array([0, 3, 11]),
    edgePositions: new Float32Array([0, 0, 0, 1, 0, 0]),
    edgeRanges: new Uint32Array([0, 2, 12]),
    vertexPositions: new Float32Array([0, 0, 0]),
    vertexPickTokens: new Uint32Array([13]),
    pickTable: new Uint32Array([11, 1, 100, 0, 12, 2, 200, 0, 13, 3, 300, 0]),
    bounds: new Float64Array([0, 0, 0, 1, 1, 0]),
  };
}

test("renderer packet fingerprint is stable without mutating packet arrays", () => {
  const candidate = packet();
  const originalPositions = [...candidate.positions];
  const first = renderPacketTopologyFingerprint(candidate);

  assert.match(first, /^render-packet-v1:\d+:[0-9a-f]{8}:[0-9a-f]{8}$/);
  assert.equal(renderPacketTopologyFingerprint(candidate), first);
  assert.deepEqual([...candidate.positions], originalPositions);
});

test("renderer packet fingerprint detects same-bounds topology and geometry changes", () => {
  const accepted = packet();
  const pocketPreview = packet();
  pocketPreview.positions[3] = 0.5;
  pocketPreview.triangleIndices = new Uint32Array([0, 2, 1]);

  assert.deepEqual([...pocketPreview.bounds], [...accepted.bounds]);
  assert.notEqual(renderPacketTopologyFingerprint(pocketPreview), renderPacketTopologyFingerprint(accepted));
});
