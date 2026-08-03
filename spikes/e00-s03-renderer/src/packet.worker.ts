/// <reference lib="webworker" />

import init, { WasmRenderPacket } from "./generated/packet/crawler_render_packet.js";

import type { TransferableRenderPacket } from "./protocol";

const scope = self as DedicatedWorkerGlobalScope;

scope.addEventListener("message", async () => {
  await init();
  const packetStart = performance.now();
  const packet = WasmRenderPacket.referenceCube(0.01);
  const packetBuilt = performance.now();
  const result: TransferableRenderPacket = {
    version: packet.version,
    positions: packet.positions(),
    normals: packet.normals(),
    triangleIndices: packet.triangleIndices(),
    faceRanges: packet.faceRanges(),
    edgePositions: packet.edgePositions(),
    edgeRanges: packet.edgeRanges(),
    vertexPositions: packet.vertexPositions(),
    vertexPickTokens: packet.vertexPickTokens(),
    pickTable: packet.pickTable(),
    bounds: packet.bounds(),
  };
  const copied = performance.now();
  const transferredBytes = packet.transferableBytes();
  const transferList = Object.values(result)
    .filter((value): value is ArrayBufferView => ArrayBuffer.isView(value))
    .map((view) => view.buffer);
  scope.postMessage(
    {
      packet: result,
      evidence: {
        packetBuildMs: packetBuilt - packetStart,
        wasmToJsCopyMs: copied - packetBuilt,
        transferredBytes,
      },
    },
    transferList,
  );
  const senderDetached = transferList.every((buffer) => buffer.byteLength === 0);
  scope.postMessage({ senderDetached });
});
