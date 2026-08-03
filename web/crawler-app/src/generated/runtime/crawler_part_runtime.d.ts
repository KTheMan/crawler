/* tslint:disable */
/* eslint-disable */

/**
 * JavaScript-facing document-engine owner intended for a dedicated worker.
 */
export class WasmPartRuntime {
    free(): void;
    [Symbol.dispose](): void;
    activeBodyJson(tolerance: number): string;
    applySketchCommandJson(request_json: string): string;
    bodySnapshotJson(body_id: string): string;
    commitChangesJson(transaction_json: string): string;
    commitLength(parameter_id: string, value_nanometers: bigint): string;
    dimensionsJson(): string;
    documentJson(): string;
    dragSketchJson(request_json: string): string;
    executeFeatureJson(envelope_json: string): string;
    executeNewFeatureJson(envelope_json: string): string;
    explicitRebindJson(request_json: string): string;
    exportObj(): string;
    exportPortablePackage(): Uint8Array;
    exportStep(): string;
    exportStl(): string;
    featureServicesJson(selected: string): string;
    static fromDocumentJson(document_json: string): WasmPartRuntime;
    static fromPortablePackage(package_bytes: Uint8Array): WasmPartRuntime;
    importedStepSource(source_sha256: string): Uint8Array;
    constructor(document_id: string, display_name: string, width_nanometers: bigint, height_nanometers: bigint, distance_nanometers: bigint);
    parametersJson(): string;
    previewExtrudeJson(value_nanometers: bigint, tolerance: number): string;
    promoteOrReuseParameterJson(request_json: string): string;
    recomputeFromHereJson(selected: string): string;
    redo(): string;
    renameParameterJson(request_json: string): string;
    renderPacketJson(tolerance: number): string;
    repairInspectionJson(observed_json: string): string;
    retainImportedStepSource(source_bytes: Uint8Array): string;
    semanticHash(): string;
    setFieldExpressionJson(request_json: string): string;
    setTimelineRollback(rollback_json: string): string;
    solveSketchJson(request_json: string): string;
    timelineRollbackJson(): string;
    undo(): string;
}

/**
 * JavaScript-facing ownership wrapper for transferable packet arrays.
 */
export class WasmRenderPacket {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Packet bounds as six f64 values.
     */
    bounds(): Float64Array;
    /**
     * Edge line-list positions.
     */
    edgePositions(): Float32Array;
    /**
     * Flattened edge ranges as first vertex, count, and pick token.
     */
    edgeRanges(): Uint32Array;
    /**
     * Flattened face ranges as first index, count, and pick token.
     */
    faceRanges(): Uint32Array;
    /**
     * Triangle normals.
     */
    normals(): Float32Array;
    /**
     * Flattened token table as token, kind, stable-id low word, and high word.
     */
    pickTable(): Uint32Array;
    /**
     * Triangle positions.
     */
    positions(): Float32Array;
    /**
     * Creates the shared reference-cube packet.
     */
    static referenceCube(tolerance: number): WasmRenderPacket;
    /**
     * Bytes copied into JavaScript-owned typed arrays before transfer.
     */
    transferableBytes(): number;
    /**
     * Triangle indices.
     */
    triangleIndices(): Uint32Array;
    /**
     * Source vertex pick tokens.
     */
    vertexPickTokens(): Uint32Array;
    /**
     * Source vertex positions.
     */
    vertexPositions(): Float32Array;
    /**
     * Packet schema version.
     */
    readonly version: number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_wasmpartruntime_free: (a: number, b: number) => void;
    readonly wasmpartruntime_activeBodyJson: (a: number, b: number) => [number, number, number, number];
    readonly wasmpartruntime_applySketchCommandJson: (a: number, b: number, c: number) => [number, number, number, number];
    readonly wasmpartruntime_bodySnapshotJson: (a: number, b: number, c: number) => [number, number, number, number];
    readonly wasmpartruntime_commitChangesJson: (a: number, b: number, c: number) => [number, number, number, number];
    readonly wasmpartruntime_commitLength: (a: number, b: number, c: number, d: bigint) => [number, number, number, number];
    readonly wasmpartruntime_dimensionsJson: (a: number) => [number, number, number, number];
    readonly wasmpartruntime_documentJson: (a: number) => [number, number, number, number];
    readonly wasmpartruntime_dragSketchJson: (a: number, b: number, c: number) => [number, number, number, number];
    readonly wasmpartruntime_executeFeatureJson: (a: number, b: number, c: number) => [number, number, number, number];
    readonly wasmpartruntime_executeNewFeatureJson: (a: number, b: number, c: number) => [number, number, number, number];
    readonly wasmpartruntime_explicitRebindJson: (a: number, b: number, c: number) => [number, number, number, number];
    readonly wasmpartruntime_exportObj: (a: number) => [number, number, number, number];
    readonly wasmpartruntime_exportPortablePackage: (a: number) => [number, number, number, number];
    readonly wasmpartruntime_exportStep: (a: number) => [number, number, number, number];
    readonly wasmpartruntime_exportStl: (a: number) => [number, number, number, number];
    readonly wasmpartruntime_featureServicesJson: (a: number, b: number, c: number) => [number, number, number, number];
    readonly wasmpartruntime_fromDocumentJson: (a: number, b: number) => [number, number, number];
    readonly wasmpartruntime_fromPortablePackage: (a: number, b: number) => [number, number, number];
    readonly wasmpartruntime_importedStepSource: (a: number, b: number, c: number) => [number, number, number, number];
    readonly wasmpartruntime_new: (a: number, b: number, c: number, d: number, e: bigint, f: bigint, g: bigint) => [number, number, number];
    readonly wasmpartruntime_parametersJson: (a: number) => [number, number, number, number];
    readonly wasmpartruntime_previewExtrudeJson: (a: number, b: bigint, c: number) => [number, number, number, number];
    readonly wasmpartruntime_promoteOrReuseParameterJson: (a: number, b: number, c: number) => [number, number, number, number];
    readonly wasmpartruntime_recomputeFromHereJson: (a: number, b: number, c: number) => [number, number, number, number];
    readonly wasmpartruntime_redo: (a: number) => [number, number, number, number];
    readonly wasmpartruntime_renameParameterJson: (a: number, b: number, c: number) => [number, number, number, number];
    readonly wasmpartruntime_renderPacketJson: (a: number, b: number) => [number, number, number, number];
    readonly wasmpartruntime_repairInspectionJson: (a: number, b: number, c: number) => [number, number, number, number];
    readonly wasmpartruntime_retainImportedStepSource: (a: number, b: number, c: number) => [number, number];
    readonly wasmpartruntime_semanticHash: (a: number) => [number, number, number, number];
    readonly wasmpartruntime_setFieldExpressionJson: (a: number, b: number, c: number) => [number, number, number, number];
    readonly wasmpartruntime_setTimelineRollback: (a: number, b: number, c: number) => [number, number, number, number];
    readonly wasmpartruntime_solveSketchJson: (a: number, b: number, c: number) => [number, number, number, number];
    readonly wasmpartruntime_timelineRollbackJson: (a: number) => [number, number, number, number];
    readonly wasmpartruntime_undo: (a: number) => [number, number, number, number];
    readonly __wbg_wasmrenderpacket_free: (a: number, b: number) => void;
    readonly wasmrenderpacket_bounds: (a: number) => [number, number];
    readonly wasmrenderpacket_edgePositions: (a: number) => [number, number];
    readonly wasmrenderpacket_edgeRanges: (a: number) => [number, number];
    readonly wasmrenderpacket_faceRanges: (a: number) => [number, number];
    readonly wasmrenderpacket_normals: (a: number) => [number, number];
    readonly wasmrenderpacket_pickTable: (a: number) => [number, number];
    readonly wasmrenderpacket_positions: (a: number) => [number, number];
    readonly wasmrenderpacket_referenceCube: (a: number) => [number, number, number];
    readonly wasmrenderpacket_transferableBytes: (a: number) => number;
    readonly wasmrenderpacket_triangleIndices: (a: number) => [number, number];
    readonly wasmrenderpacket_version: (a: number) => number;
    readonly wasmrenderpacket_vertexPickTokens: (a: number) => [number, number];
    readonly wasmrenderpacket_vertexPositions: (a: number) => [number, number];
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
