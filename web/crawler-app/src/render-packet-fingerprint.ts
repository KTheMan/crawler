import type { RenderPacket } from "./protocol";

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const SECONDARY_OFFSET = 0x9e3779b9;

/**
 * Produce a stable, read-only identity for the complete geometry packet that is
 * actually installed in the renderer. Hashing raw typed-array bytes preserves
 * Float32/Float64 and index distinctions without making this test observation
 * path an authority for durable model state.
 */
export function renderPacketTopologyFingerprint(packet: RenderPacket): string {
  let primary = FNV_OFFSET;
  let secondary = SECONDARY_OFFSET;
  let byteCount = 0;

  const mix = (value: number): void => {
    primary = Math.imul(primary ^ value, FNV_PRIME) >>> 0;
    secondary = (Math.imul(secondary ^ value, 0x85ebca6b) + 0xc2b2ae35) >>> 0;
    byteCount += 1;
  };
  const mixUint32 = (value: number): void => {
    mix(value & 0xff);
    mix((value >>> 8) & 0xff);
    mix((value >>> 16) & 0xff);
    mix((value >>> 24) & 0xff);
  };
  const mixField = (label: string, view: ArrayBufferView): void => {
    for (let index = 0; index < label.length; index += 1) mix(label.charCodeAt(index) & 0xff);
    mixUint32(view.byteLength);
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    for (const byte of bytes) mix(byte);
  };

  mixUint32(packet.version);
  mixField("positions", packet.positions);
  mixField("normals", packet.normals);
  mixField("triangleIndices", packet.triangleIndices);
  mixField("faceRanges", packet.faceRanges);
  mixField("edgePositions", packet.edgePositions);
  mixField("edgeRanges", packet.edgeRanges);
  mixField("vertexPositions", packet.vertexPositions);
  mixField("vertexPickTokens", packet.vertexPickTokens);
  mixField("pickTable", packet.pickTable);
  mixField("bounds", packet.bounds);

  return `render-packet-v1:${byteCount}:${primary.toString(16).padStart(8, "0")}:${secondary.toString(16).padStart(8, "0")}`;
}
