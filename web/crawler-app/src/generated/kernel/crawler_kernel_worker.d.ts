/* tslint:disable */
/* eslint-disable */

/**
 * abstract shape, effectively an enumerated type
 */
export class AbstractShape {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * downcast
     */
    into_edge(): Edge | undefined;
    /**
     * downcast
     */
    into_face(): Face | undefined;
    /**
     * downcast
     */
    into_shell(): Shell | undefined;
    /**
     * downcast
     */
    into_solid(): Solid | undefined;
    /**
     * downcast
     */
    into_vertex(): Vertex | undefined;
    /**
     * downcast
     */
    into_wire(): Wire | undefined;
    /**
     * check the type
     */
    is_edge(): boolean;
    /**
     * check the type
     */
    is_face(): boolean;
    /**
     * check the type
     */
    is_shell(): boolean;
    /**
     * check the type
     */
    is_solid(): boolean;
    /**
     * check the type
     */
    is_vertex(): boolean;
    /**
     * check the type
     */
    is_wire(): boolean;
}

/**
 * wasm shape wrapper
 */
export class Edge {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * upcast to abstract shape
     */
    upcast(): AbstractShape;
}

/**
 * wasm shape wrapper
 */
export class Face {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * upcast to abstract shape
     */
    upcast(): AbstractShape;
}

/**
 * Buffer for rendering polygon
 */
export class PolygonBuffer {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * index buffer. `u32`.
     */
    index_buffer(): Uint32Array;
    /**
     * the length (bytes) of index buffer. (Num of triangles) * 3 vertices * 4 bytes.
     */
    index_buffer_size(): number;
    /**
     * vertex buffer. One attribute contains `position: [f32; 3]`, `uv_coord: [f32; 2]` and `normal: [f32; 3]`.
     */
    vertex_buffer(): Float32Array;
    /**
     * the length (bytes) of vertex buffer. (Num of attributes) * 8 components * 4 bytes.
     */
    vertex_buffer_size(): number;
}

/**
 * Wasm wrapper by Polygonmesh
 */
export class PolygonMesh {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Returns the bonding box
     */
    bounding_box(): Float64Array;
    /**
     * input from obj format
     */
    static from_obj(data: Uint8Array): PolygonMesh | undefined;
    /**
     * meshing shell
     */
    static from_shell(shell: Shell, tol: number): PolygonMesh;
    /**
     * meshing solid
     */
    static from_solid(solid: Solid, tol: number): PolygonMesh;
    /**
     * input from STL format
     */
    static from_stl(data: Uint8Array, stl_type: StlType): PolygonMesh | undefined;
    /**
     * merge two polygons: `self` and `other`.
     */
    merge(other: PolygonMesh): void;
    /**
     * Returns polygon buffer
     */
    to_buffer(): PolygonBuffer;
    /**
     * output obj format
     */
    to_obj(): Uint8Array | undefined;
    /**
     * output stl format
     */
    to_stl(stl_type: StlType): Uint8Array | undefined;
}

/**
 * Shell and solid parsed from STEP.
 */
export class ShapeFromStep {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Meshes a shape from STEP.
     */
    to_polygon(tol: number): PolygonMesh;
}

/**
 * wasm shape wrapper
 */
export class Shell {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * read shape from json
     */
    static from_json(data: Uint8Array): Shell | undefined;
    /**
     * Creates Solid if `self` is a closed shell.
     */
    into_solid(): Solid | undefined;
    /**
     * write shape to json
     */
    to_json(): Uint8Array;
    /**
     * meshing shape
     */
    to_polygon(tol: number): PolygonMesh;
    /**
     * write shape to STEP
     */
    to_step(header: StepHeaderDescriptor): string;
    /**
     * upcast to abstract shape
     */
    upcast(): AbstractShape;
}

/**
 * wasm shape wrapper
 */
export class Solid {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * read shape from json
     */
    static from_json(data: Uint8Array): Solid | undefined;
    /**
     * write shape to json
     */
    to_json(): Uint8Array;
    /**
     * meshing shape
     */
    to_polygon(tol: number): PolygonMesh;
    /**
     * write shape to STEP
     */
    to_step(header: StepHeaderDescriptor): string;
    /**
     * upcast to abstract shape
     */
    upcast(): AbstractShape;
}

/**
 * Describe STEP file header
 */
export class StepHeaderDescriptor {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    authorization: string;
    authors: string[];
    filename: string;
    organization: string[];
    organization_system: string;
    time_stamp: string;
}

/**
 * STL type.
 */
export enum StlType {
    /**
     * Determine STL type automatically.
     *
     * # Reading
     * If the first 5 bytes are..
     * - "solid" => ascii format
     * - otherwise => binary format
     *
     * # Writing
     * Always binary format.
     */
    Automatic = 0,
    /**
     * ASCII format.
     */
    Ascii = 1,
    /**
     * Binary format.
     */
    Binary = 2,
}

/**
 * STEP parse table.
 */
export class Table {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Reads a STEP file.
     */
    static from_step(step_str: string): Table | undefined;
    /**
     * Gets a shape from an entity index.
     */
    shape(idx: bigint): ShapeFromStep | undefined;
    /**
     * Gets shell indices.
     */
    shell_indices(): BigUint64Array;
}

/**
 * wasm shape wrapper
 */
export class Vertex {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * upcast to abstract shape
     */
    upcast(): AbstractShape;
}

/**
 * Stateful WASM adapter owned by one dedicated module worker.
 */
export class WasmKernelAdapter {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Decodes one command and returns its ordered event stream as JSON.
     */
    dispatchJson(command_json: string): string;
    /**
     * Creates an adapter with no acknowledged document state.
     */
    constructor();
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

/**
 * wasm shape wrapper
 */
export class Wire {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * upcast to abstract shape
     */
    upcast(): AbstractShape;
}

/**
 * and operator
 */
export function and(solid0: Solid, solid1: Solid, tol?: number | null): Solid | undefined;

/**
 * Returns a Bezier curve from `vertex0` to `vertex1` with inter control points `inter_points`.
 */
export function bezier(vertex0: Vertex, vertex1: Vertex, inter_points: Float64Array): Edge;

/**
 * Returns a circle arc from `vertex0` to `vertex1` via `transit`.
 */
export function circle_arc(vertex0: Vertex, vertex1: Vertex, transit: Float64Array): Edge;

/**
 * Sweeps a vertex, an edge, a wire, a face, or a shell by a vector.
 */
export function extrude(shape: AbstractShape, vector: Float64Array): AbstractShape;

/**
 * Returns a homotopic face from `edge0` to `edge1`.
 */
export function homotopy(edge0: Edge, edge1: Edge): Face;

/**
 * Returns a line from `vertex0` to `vertex1`.
 */
export function line(vertex0: Vertex, vertex1: Vertex): Edge;

/**
 * not operator
 */
export function not(solid: Solid): Solid;

/**
 * or operator
 */
export function or(solid0: Solid, solid1: Solid, tol?: number | null): Solid | undefined;

/**
 * Sweeps a vertex, an edge, a wire, a face, or a shell by the rotation.
 */
export function revolve(shape: AbstractShape, origin: Float64Array, axis: Float64Array, angle: number, division: number): AbstractShape;

/**
 * Returns a rotated vertex, edge, wire, face, shell or solid.
 */
export function rotated(shape: AbstractShape, origin: Float64Array, axis: Float64Array, angle: number): AbstractShape;

/**
 * Returns a scaled vertex, edge, wire, face, shell or solid.
 */
export function scaled(shape: AbstractShape, origin: Float64Array, scalars: Float64Array): AbstractShape;

/**
 * Returns a translated vertex, edge, wire, face, shell or solid.
 */
export function translated(shape: AbstractShape, vector: Float64Array): AbstractShape;

/**
 * Try attatiching a plane whose boundary is `wire`.
 */
export function try_attach_plane(wire: Wire): Face | undefined;

/**
 * Creates and returns a vertex by a three dimensional point.
 */
export function vertex(x: number, y: number, z: number): Vertex;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_wasmkerneladapter_free: (a: number, b: number) => void;
    readonly wasmkerneladapter_dispatchJson: (a: number, b: number, c: number) => [number, number, number, number];
    readonly wasmkerneladapter_new: () => number;
    readonly __wbg_shapefromstep_free: (a: number, b: number) => void;
    readonly __wbg_table_free: (a: number, b: number) => void;
    readonly shapefromstep_to_polygon: (a: number, b: number) => number;
    readonly table_from_step: (a: number, b: number) => number;
    readonly table_shape: (a: number, b: bigint) => number;
    readonly table_shell_indices: (a: number) => [number, number];
    readonly __wbg_abstractshape_free: (a: number, b: number) => void;
    readonly __wbg_edge_free: (a: number, b: number) => void;
    readonly __wbg_face_free: (a: number, b: number) => void;
    readonly __wbg_shell_free: (a: number, b: number) => void;
    readonly __wbg_solid_free: (a: number, b: number) => void;
    readonly __wbg_stepheaderdescriptor_free: (a: number, b: number) => void;
    readonly __wbg_vertex_free: (a: number, b: number) => void;
    readonly __wbg_wire_free: (a: number, b: number) => void;
    readonly abstractshape_into_edge: (a: number) => number;
    readonly abstractshape_into_face: (a: number) => number;
    readonly abstractshape_into_shell: (a: number) => number;
    readonly abstractshape_into_solid: (a: number) => number;
    readonly abstractshape_into_vertex: (a: number) => number;
    readonly abstractshape_into_wire: (a: number) => number;
    readonly abstractshape_is_edge: (a: number) => number;
    readonly abstractshape_is_face: (a: number) => number;
    readonly abstractshape_is_shell: (a: number) => number;
    readonly abstractshape_is_solid: (a: number) => number;
    readonly abstractshape_is_vertex: (a: number) => number;
    readonly abstractshape_is_wire: (a: number) => number;
    readonly edge_upcast: (a: number) => number;
    readonly face_upcast: (a: number) => number;
    readonly shell_from_json: (a: number, b: number) => number;
    readonly shell_into_solid: (a: number) => number;
    readonly shell_to_json: (a: number) => [number, number];
    readonly shell_to_polygon: (a: number, b: number) => number;
    readonly shell_to_step: (a: number, b: number) => [number, number];
    readonly shell_upcast: (a: number) => number;
    readonly solid_from_json: (a: number, b: number) => number;
    readonly solid_to_json: (a: number) => [number, number];
    readonly solid_to_polygon: (a: number, b: number) => number;
    readonly solid_to_step: (a: number, b: number) => [number, number];
    readonly solid_upcast: (a: number) => number;
    readonly stepheaderdescriptor_authorization: (a: number) => any;
    readonly stepheaderdescriptor_authors: (a: number) => [number, number];
    readonly stepheaderdescriptor_filename: (a: number) => any;
    readonly stepheaderdescriptor_organization: (a: number) => [number, number];
    readonly stepheaderdescriptor_organization_system: (a: number) => any;
    readonly stepheaderdescriptor_set_authorization: (a: number, b: any) => void;
    readonly stepheaderdescriptor_set_authors: (a: number, b: number, c: number) => void;
    readonly stepheaderdescriptor_set_filename: (a: number, b: any) => void;
    readonly stepheaderdescriptor_set_organization: (a: number, b: number, c: number) => void;
    readonly stepheaderdescriptor_set_organization_system: (a: number, b: any) => void;
    readonly stepheaderdescriptor_set_time_stamp: (a: number, b: any) => void;
    readonly stepheaderdescriptor_time_stamp: (a: number) => any;
    readonly vertex_upcast: (a: number) => number;
    readonly wire_upcast: (a: number) => number;
    readonly __wbg_polygonbuffer_free: (a: number, b: number) => void;
    readonly __wbg_polygonmesh_free: (a: number, b: number) => void;
    readonly and: (a: number, b: number, c: number, d: number) => number;
    readonly not: (a: number) => number;
    readonly or: (a: number, b: number, c: number, d: number) => number;
    readonly polygonbuffer_index_buffer: (a: number) => [number, number];
    readonly polygonbuffer_index_buffer_size: (a: number) => number;
    readonly polygonbuffer_vertex_buffer: (a: number) => [number, number];
    readonly polygonbuffer_vertex_buffer_size: (a: number) => number;
    readonly polygonmesh_bounding_box: (a: number) => [number, number];
    readonly polygonmesh_from_obj: (a: number, b: number) => number;
    readonly polygonmesh_from_shell: (a: number, b: number) => number;
    readonly polygonmesh_from_solid: (a: number, b: number) => number;
    readonly polygonmesh_from_stl: (a: number, b: number, c: number) => number;
    readonly polygonmesh_merge: (a: number, b: number) => void;
    readonly polygonmesh_to_buffer: (a: number) => number;
    readonly polygonmesh_to_obj: (a: number) => [number, number];
    readonly polygonmesh_to_stl: (a: number, b: number) => [number, number];
    readonly bezier: (a: number, b: number, c: number, d: number) => number;
    readonly circle_arc: (a: number, b: number, c: number, d: number) => number;
    readonly extrude: (a: number, b: number, c: number) => number;
    readonly homotopy: (a: number, b: number) => number;
    readonly line: (a: number, b: number) => number;
    readonly revolve: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly rotated: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly scaled: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly translated: (a: number, b: number, c: number) => number;
    readonly try_attach_plane: (a: number) => number;
    readonly vertex: (a: number, b: number, c: number) => number;
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
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_drop_slice: (a: number, b: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __externref_table_dealloc: (a: number) => void;
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
