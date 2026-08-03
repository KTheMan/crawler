export const PACKET_VERSION = 1;

export const PickKind = {
  Face: 1,
  Edge: 2,
  Vertex: 3,
} as const;

export type PickKindValue = (typeof PickKind)[keyof typeof PickKind];

export interface TransferableRenderPacket {
  version: number;
  positions: Float32Array;
  normals: Float32Array;
  triangleIndices: Uint32Array;
  faceRanges: Uint32Array;
  edgePositions: Float32Array;
  edgeRanges: Uint32Array;
  vertexPositions: Float32Array;
  vertexPickTokens: Uint32Array;
  pickTable: Uint32Array;
  bounds: Float64Array;
}

export interface WorkerEvidence {
  packetBuildMs: number;
  wasmToJsCopyMs: number;
  transferredBytes: number;
  senderDetached: boolean;
}

export interface PickResult {
  token: number;
  kind: PickKindValue;
  stableId: string;
  latencyMs: number;
}

export interface SpikeApi {
  ready: boolean;
  backend: "webgl2";
  packetSummary: {
    version: number;
    faces: number;
    edges: number;
    vertices: number;
    transferredBytes: number;
    senderDetached: boolean;
  };
  pickAt(x: number, y: number): PickResult | null;
  scanForKinds(): {
    face: PickResult | null;
    edge: PickResult | null;
    vertex: PickResult | null;
  };
  sampleFrames(count: number): Promise<number[]>;
  workerEvidence: WorkerEvidence;
}

declare global {
  interface Window {
    __crawlerSpike?: SpikeApi;
  }
}
