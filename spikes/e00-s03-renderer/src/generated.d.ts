declare module "../generated/packet/crawler_render_packet.js" {
  export default function init(input?: RequestInfo | URL | Response | BufferSource | WebAssembly.Module): Promise<unknown>;

  export class WasmRenderPacket {
    static referenceCube(tolerance: number): WasmRenderPacket;
    readonly version: number;
    positions(): Float32Array;
    normals(): Float32Array;
    triangleIndices(): Uint32Array;
    faceRanges(): Uint32Array;
    edgePositions(): Float32Array;
    edgeRanges(): Uint32Array;
    vertexPositions(): Float32Array;
    vertexPickTokens(): Uint32Array;
    pickTable(): Uint32Array;
    bounds(): Float64Array;
    transferableBytes(): number;
  }
}

declare module "../generated/wgpu/crawler_wgpu_probe.js" {
  export default function init(input?: RequestInfo | URL | Response | BufferSource | WebAssembly.Module): Promise<unknown>;
  export function compiledRendererSurface(): string;
}
