/* @ts-self-types="./crawler_kernel_worker.d.ts" */

/**
 * abstract shape, effectively an enumerated type
 */
export class AbstractShape {
    static __wrap(ptr) {
        const obj = Object.create(AbstractShape.prototype);
        obj.__wbg_ptr = ptr;
        AbstractShapeFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        AbstractShapeFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_abstractshape_free(ptr, 0);
    }
    /**
     * downcast
     * @returns {Edge | undefined}
     */
    into_edge() {
        const ptr = this.__destroy_into_raw();
        const ret = wasm.abstractshape_into_edge(ptr);
        return ret === 0 ? undefined : Edge.__wrap(ret);
    }
    /**
     * downcast
     * @returns {Face | undefined}
     */
    into_face() {
        const ptr = this.__destroy_into_raw();
        const ret = wasm.abstractshape_into_face(ptr);
        return ret === 0 ? undefined : Face.__wrap(ret);
    }
    /**
     * downcast
     * @returns {Shell | undefined}
     */
    into_shell() {
        const ptr = this.__destroy_into_raw();
        const ret = wasm.abstractshape_into_shell(ptr);
        return ret === 0 ? undefined : Shell.__wrap(ret);
    }
    /**
     * downcast
     * @returns {Solid | undefined}
     */
    into_solid() {
        const ptr = this.__destroy_into_raw();
        const ret = wasm.abstractshape_into_solid(ptr);
        return ret === 0 ? undefined : Solid.__wrap(ret);
    }
    /**
     * downcast
     * @returns {Vertex | undefined}
     */
    into_vertex() {
        const ptr = this.__destroy_into_raw();
        const ret = wasm.abstractshape_into_vertex(ptr);
        return ret === 0 ? undefined : Vertex.__wrap(ret);
    }
    /**
     * downcast
     * @returns {Wire | undefined}
     */
    into_wire() {
        const ptr = this.__destroy_into_raw();
        const ret = wasm.abstractshape_into_wire(ptr);
        return ret === 0 ? undefined : Wire.__wrap(ret);
    }
    /**
     * check the type
     * @returns {boolean}
     */
    is_edge() {
        const ret = wasm.abstractshape_is_edge(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * check the type
     * @returns {boolean}
     */
    is_face() {
        const ret = wasm.abstractshape_is_face(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * check the type
     * @returns {boolean}
     */
    is_shell() {
        const ret = wasm.abstractshape_is_shell(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * check the type
     * @returns {boolean}
     */
    is_solid() {
        const ret = wasm.abstractshape_is_solid(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * check the type
     * @returns {boolean}
     */
    is_vertex() {
        const ret = wasm.abstractshape_is_vertex(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * check the type
     * @returns {boolean}
     */
    is_wire() {
        const ret = wasm.abstractshape_is_wire(this.__wbg_ptr);
        return ret !== 0;
    }
}
if (Symbol.dispose) AbstractShape.prototype[Symbol.dispose] = AbstractShape.prototype.free;

/**
 * wasm shape wrapper
 */
export class Edge {
    static __wrap(ptr) {
        const obj = Object.create(Edge.prototype);
        obj.__wbg_ptr = ptr;
        EdgeFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        EdgeFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_edge_free(ptr, 0);
    }
    /**
     * upcast to abstract shape
     * @returns {AbstractShape}
     */
    upcast() {
        const ptr = this.__destroy_into_raw();
        const ret = wasm.edge_upcast(ptr);
        return AbstractShape.__wrap(ret);
    }
}
if (Symbol.dispose) Edge.prototype[Symbol.dispose] = Edge.prototype.free;

/**
 * wasm shape wrapper
 */
export class Face {
    static __wrap(ptr) {
        const obj = Object.create(Face.prototype);
        obj.__wbg_ptr = ptr;
        FaceFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        FaceFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_face_free(ptr, 0);
    }
    /**
     * upcast to abstract shape
     * @returns {AbstractShape}
     */
    upcast() {
        const ptr = this.__destroy_into_raw();
        const ret = wasm.face_upcast(ptr);
        return AbstractShape.__wrap(ret);
    }
}
if (Symbol.dispose) Face.prototype[Symbol.dispose] = Face.prototype.free;

/**
 * Buffer for rendering polygon
 */
export class PolygonBuffer {
    static __wrap(ptr) {
        const obj = Object.create(PolygonBuffer.prototype);
        obj.__wbg_ptr = ptr;
        PolygonBufferFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PolygonBufferFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_polygonbuffer_free(ptr, 0);
    }
    /**
     * index buffer. `u32`.
     * @returns {Uint32Array}
     */
    index_buffer() {
        const ret = wasm.polygonbuffer_index_buffer(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * the length (bytes) of index buffer. (Num of triangles) * 3 vertices * 4 bytes.
     * @returns {number}
     */
    index_buffer_size() {
        const ret = wasm.polygonbuffer_index_buffer_size(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * vertex buffer. One attribute contains `position: [f32; 3]`, `uv_coord: [f32; 2]` and `normal: [f32; 3]`.
     * @returns {Float32Array}
     */
    vertex_buffer() {
        const ret = wasm.polygonbuffer_vertex_buffer(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * the length (bytes) of vertex buffer. (Num of attributes) * 8 components * 4 bytes.
     * @returns {number}
     */
    vertex_buffer_size() {
        const ret = wasm.polygonbuffer_vertex_buffer_size(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) PolygonBuffer.prototype[Symbol.dispose] = PolygonBuffer.prototype.free;

/**
 * Wasm wrapper by Polygonmesh
 */
export class PolygonMesh {
    static __wrap(ptr) {
        const obj = Object.create(PolygonMesh.prototype);
        obj.__wbg_ptr = ptr;
        PolygonMeshFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PolygonMeshFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_polygonmesh_free(ptr, 0);
    }
    /**
     * Returns the bonding box
     * @returns {Float64Array}
     */
    bounding_box() {
        const ret = wasm.polygonmesh_bounding_box(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * input from obj format
     * @param {Uint8Array} data
     * @returns {PolygonMesh | undefined}
     */
    static from_obj(data) {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.polygonmesh_from_obj(ptr0, len0);
        return ret === 0 ? undefined : PolygonMesh.__wrap(ret);
    }
    /**
     * meshing shell
     * @param {Shell} shell
     * @param {number} tol
     * @returns {PolygonMesh}
     */
    static from_shell(shell, tol) {
        _assertClass(shell, Shell);
        var ptr0 = shell.__destroy_into_raw();
        const ret = wasm.polygonmesh_from_shell(ptr0, tol);
        return PolygonMesh.__wrap(ret);
    }
    /**
     * meshing solid
     * @param {Solid} solid
     * @param {number} tol
     * @returns {PolygonMesh}
     */
    static from_solid(solid, tol) {
        _assertClass(solid, Solid);
        var ptr0 = solid.__destroy_into_raw();
        const ret = wasm.polygonmesh_from_solid(ptr0, tol);
        return PolygonMesh.__wrap(ret);
    }
    /**
     * input from STL format
     * @param {Uint8Array} data
     * @param {StlType} stl_type
     * @returns {PolygonMesh | undefined}
     */
    static from_stl(data, stl_type) {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.polygonmesh_from_stl(ptr0, len0, stl_type);
        return ret === 0 ? undefined : PolygonMesh.__wrap(ret);
    }
    /**
     * merge two polygons: `self` and `other`.
     * @param {PolygonMesh} other
     */
    merge(other) {
        _assertClass(other, PolygonMesh);
        var ptr0 = other.__destroy_into_raw();
        wasm.polygonmesh_merge(this.__wbg_ptr, ptr0);
    }
    /**
     * Returns polygon buffer
     * @returns {PolygonBuffer}
     */
    to_buffer() {
        const ret = wasm.polygonmesh_to_buffer(this.__wbg_ptr);
        return PolygonBuffer.__wrap(ret);
    }
    /**
     * output obj format
     * @returns {Uint8Array | undefined}
     */
    to_obj() {
        const ret = wasm.polygonmesh_to_obj(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * output stl format
     * @param {StlType} stl_type
     * @returns {Uint8Array | undefined}
     */
    to_stl(stl_type) {
        const ret = wasm.polygonmesh_to_stl(this.__wbg_ptr, stl_type);
        let v1;
        if (ret[0] !== 0) {
            v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
}
if (Symbol.dispose) PolygonMesh.prototype[Symbol.dispose] = PolygonMesh.prototype.free;

/**
 * Shell and solid parsed from STEP.
 */
export class ShapeFromStep {
    static __wrap(ptr) {
        const obj = Object.create(ShapeFromStep.prototype);
        obj.__wbg_ptr = ptr;
        ShapeFromStepFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ShapeFromStepFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_shapefromstep_free(ptr, 0);
    }
    /**
     * Meshes a shape from STEP.
     * @param {number} tol
     * @returns {PolygonMesh}
     */
    to_polygon(tol) {
        const ret = wasm.shapefromstep_to_polygon(this.__wbg_ptr, tol);
        return PolygonMesh.__wrap(ret);
    }
}
if (Symbol.dispose) ShapeFromStep.prototype[Symbol.dispose] = ShapeFromStep.prototype.free;

/**
 * wasm shape wrapper
 */
export class Shell {
    static __wrap(ptr) {
        const obj = Object.create(Shell.prototype);
        obj.__wbg_ptr = ptr;
        ShellFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ShellFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_shell_free(ptr, 0);
    }
    /**
     * read shape from json
     * @param {Uint8Array} data
     * @returns {Shell | undefined}
     */
    static from_json(data) {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.shell_from_json(ptr0, len0);
        return ret === 0 ? undefined : Shell.__wrap(ret);
    }
    /**
     * Creates Solid if `self` is a closed shell.
     * @returns {Solid | undefined}
     */
    into_solid() {
        const ptr = this.__destroy_into_raw();
        const ret = wasm.shell_into_solid(ptr);
        return ret === 0 ? undefined : Solid.__wrap(ret);
    }
    /**
     * write shape to json
     * @returns {Uint8Array}
     */
    to_json() {
        const ret = wasm.shell_to_json(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * meshing shape
     * @param {number} tol
     * @returns {PolygonMesh}
     */
    to_polygon(tol) {
        const ret = wasm.shell_to_polygon(this.__wbg_ptr, tol);
        return PolygonMesh.__wrap(ret);
    }
    /**
     * write shape to STEP
     * @param {StepHeaderDescriptor} header
     * @returns {string}
     */
    to_step(header) {
        let deferred2_0;
        let deferred2_1;
        try {
            _assertClass(header, StepHeaderDescriptor);
            var ptr0 = header.__destroy_into_raw();
            const ret = wasm.shell_to_step(this.__wbg_ptr, ptr0);
            deferred2_0 = ret[0];
            deferred2_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * upcast to abstract shape
     * @returns {AbstractShape}
     */
    upcast() {
        const ptr = this.__destroy_into_raw();
        const ret = wasm.shell_upcast(ptr);
        return AbstractShape.__wrap(ret);
    }
}
if (Symbol.dispose) Shell.prototype[Symbol.dispose] = Shell.prototype.free;

/**
 * wasm shape wrapper
 */
export class Solid {
    static __wrap(ptr) {
        const obj = Object.create(Solid.prototype);
        obj.__wbg_ptr = ptr;
        SolidFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SolidFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_solid_free(ptr, 0);
    }
    /**
     * read shape from json
     * @param {Uint8Array} data
     * @returns {Solid | undefined}
     */
    static from_json(data) {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.solid_from_json(ptr0, len0);
        return ret === 0 ? undefined : Solid.__wrap(ret);
    }
    /**
     * write shape to json
     * @returns {Uint8Array}
     */
    to_json() {
        const ret = wasm.solid_to_json(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * meshing shape
     * @param {number} tol
     * @returns {PolygonMesh}
     */
    to_polygon(tol) {
        const ret = wasm.solid_to_polygon(this.__wbg_ptr, tol);
        return PolygonMesh.__wrap(ret);
    }
    /**
     * write shape to STEP
     * @param {StepHeaderDescriptor} header
     * @returns {string}
     */
    to_step(header) {
        let deferred2_0;
        let deferred2_1;
        try {
            _assertClass(header, StepHeaderDescriptor);
            var ptr0 = header.__destroy_into_raw();
            const ret = wasm.solid_to_step(this.__wbg_ptr, ptr0);
            deferred2_0 = ret[0];
            deferred2_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * upcast to abstract shape
     * @returns {AbstractShape}
     */
    upcast() {
        const ptr = this.__destroy_into_raw();
        const ret = wasm.solid_upcast(ptr);
        return AbstractShape.__wrap(ret);
    }
}
if (Symbol.dispose) Solid.prototype[Symbol.dispose] = Solid.prototype.free;

/**
 * Describe STEP file header
 */
export class StepHeaderDescriptor {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        StepHeaderDescriptorFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_stepheaderdescriptor_free(ptr, 0);
    }
    /**
     * @returns {string}
     */
    get authorization() {
        const ret = wasm.stepheaderdescriptor_authorization(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {string[]}
     */
    get authors() {
        const ret = wasm.stepheaderdescriptor_authors(this.__wbg_ptr);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {string}
     */
    get filename() {
        const ret = wasm.stepheaderdescriptor_filename(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {string[]}
     */
    get organization() {
        const ret = wasm.stepheaderdescriptor_organization(this.__wbg_ptr);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {string}
     */
    get organization_system() {
        const ret = wasm.stepheaderdescriptor_organization_system(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {string} authorization
     */
    set authorization(authorization) {
        wasm.stepheaderdescriptor_set_authorization(this.__wbg_ptr, authorization);
    }
    /**
     * @param {string[]} authors
     */
    set authors(authors) {
        const ptr0 = passArrayJsValueToWasm0(authors, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.stepheaderdescriptor_set_authors(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {string} filename
     */
    set filename(filename) {
        wasm.stepheaderdescriptor_set_filename(this.__wbg_ptr, filename);
    }
    /**
     * @param {string[]} organization
     */
    set organization(organization) {
        const ptr0 = passArrayJsValueToWasm0(organization, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.stepheaderdescriptor_set_organization(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {string} organization_system
     */
    set organization_system(organization_system) {
        wasm.stepheaderdescriptor_set_organization_system(this.__wbg_ptr, organization_system);
    }
    /**
     * @param {string} time_stamp
     */
    set time_stamp(time_stamp) {
        wasm.stepheaderdescriptor_set_time_stamp(this.__wbg_ptr, time_stamp);
    }
    /**
     * @returns {string}
     */
    get time_stamp() {
        const ret = wasm.stepheaderdescriptor_time_stamp(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) StepHeaderDescriptor.prototype[Symbol.dispose] = StepHeaderDescriptor.prototype.free;

/**
 * STL type.
 * @enum {0 | 1 | 2}
 */
export const StlType = Object.freeze({
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
    Automatic: 0, "0": "Automatic",
    /**
     * ASCII format.
     */
    Ascii: 1, "1": "Ascii",
    /**
     * Binary format.
     */
    Binary: 2, "2": "Binary",
});

/**
 * STEP parse table.
 */
export class Table {
    static __wrap(ptr) {
        const obj = Object.create(Table.prototype);
        obj.__wbg_ptr = ptr;
        TableFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        TableFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_table_free(ptr, 0);
    }
    /**
     * Reads a STEP file.
     * @param {string} step_str
     * @returns {Table | undefined}
     */
    static from_step(step_str) {
        const ptr0 = passStringToWasm0(step_str, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.table_from_step(ptr0, len0);
        return ret === 0 ? undefined : Table.__wrap(ret);
    }
    /**
     * Gets a shape from an entity index.
     * @param {bigint} idx
     * @returns {ShapeFromStep | undefined}
     */
    shape(idx) {
        const ret = wasm.table_shape(this.__wbg_ptr, idx);
        return ret === 0 ? undefined : ShapeFromStep.__wrap(ret);
    }
    /**
     * Gets shell indices.
     * @returns {BigUint64Array}
     */
    shell_indices() {
        const ret = wasm.table_shell_indices(this.__wbg_ptr);
        var v1 = getArrayU64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
}
if (Symbol.dispose) Table.prototype[Symbol.dispose] = Table.prototype.free;

/**
 * wasm shape wrapper
 */
export class Vertex {
    static __wrap(ptr) {
        const obj = Object.create(Vertex.prototype);
        obj.__wbg_ptr = ptr;
        VertexFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        VertexFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_vertex_free(ptr, 0);
    }
    /**
     * upcast to abstract shape
     * @returns {AbstractShape}
     */
    upcast() {
        const ptr = this.__destroy_into_raw();
        const ret = wasm.vertex_upcast(ptr);
        return AbstractShape.__wrap(ret);
    }
}
if (Symbol.dispose) Vertex.prototype[Symbol.dispose] = Vertex.prototype.free;

/**
 * Stateful WASM adapter owned by one dedicated module worker.
 */
export class WasmKernelAdapter {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmKernelAdapterFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmkerneladapter_free(ptr, 0);
    }
    /**
     * Decodes one command and returns its ordered event stream as JSON.
     * @param {string} command_json
     * @returns {string}
     */
    dispatchJson(command_json) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(command_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.wasmkerneladapter_dispatchJson(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Creates an adapter with no acknowledged document state.
     */
    constructor() {
        const ret = wasm.wasmkerneladapter_new();
        this.__wbg_ptr = ret;
        WasmKernelAdapterFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) WasmKernelAdapter.prototype[Symbol.dispose] = WasmKernelAdapter.prototype.free;

/**
 * JavaScript-facing ownership wrapper for transferable packet arrays.
 */
export class WasmRenderPacket {
    static __wrap(ptr) {
        const obj = Object.create(WasmRenderPacket.prototype);
        obj.__wbg_ptr = ptr;
        WasmRenderPacketFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmRenderPacketFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmrenderpacket_free(ptr, 0);
    }
    /**
     * Packet bounds as six f64 values.
     * @returns {Float64Array}
     */
    bounds() {
        const ret = wasm.wasmrenderpacket_bounds(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * Edge line-list positions.
     * @returns {Float32Array}
     */
    edgePositions() {
        const ret = wasm.wasmrenderpacket_edgePositions(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Flattened edge ranges as first vertex, count, and pick token.
     * @returns {Uint32Array}
     */
    edgeRanges() {
        const ret = wasm.wasmrenderpacket_edgeRanges(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Flattened face ranges as first index, count, and pick token.
     * @returns {Uint32Array}
     */
    faceRanges() {
        const ret = wasm.wasmrenderpacket_faceRanges(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Triangle normals.
     * @returns {Float32Array}
     */
    normals() {
        const ret = wasm.wasmrenderpacket_normals(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Flattened token table as token, kind, stable-id low word, and high word.
     * @returns {Uint32Array}
     */
    pickTable() {
        const ret = wasm.wasmrenderpacket_pickTable(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Triangle positions.
     * @returns {Float32Array}
     */
    positions() {
        const ret = wasm.wasmrenderpacket_positions(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Creates the shared reference-cube packet.
     * @param {number} tolerance
     * @returns {WasmRenderPacket}
     */
    static referenceCube(tolerance) {
        const ret = wasm.wasmrenderpacket_referenceCube(tolerance);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmRenderPacket.__wrap(ret[0]);
    }
    /**
     * Bytes copied into JavaScript-owned typed arrays before transfer.
     * @returns {number}
     */
    transferableBytes() {
        const ret = wasm.wasmrenderpacket_transferableBytes(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Triangle indices.
     * @returns {Uint32Array}
     */
    triangleIndices() {
        const ret = wasm.wasmrenderpacket_triangleIndices(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Packet schema version.
     * @returns {number}
     */
    get version() {
        const ret = wasm.wasmrenderpacket_version(this.__wbg_ptr);
        return ret;
    }
    /**
     * Source vertex pick tokens.
     * @returns {Uint32Array}
     */
    vertexPickTokens() {
        const ret = wasm.wasmrenderpacket_vertexPickTokens(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Source vertex positions.
     * @returns {Float32Array}
     */
    vertexPositions() {
        const ret = wasm.wasmrenderpacket_vertexPositions(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
}
if (Symbol.dispose) WasmRenderPacket.prototype[Symbol.dispose] = WasmRenderPacket.prototype.free;

/**
 * wasm shape wrapper
 */
export class Wire {
    static __wrap(ptr) {
        const obj = Object.create(Wire.prototype);
        obj.__wbg_ptr = ptr;
        WireFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WireFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wire_free(ptr, 0);
    }
    /**
     * upcast to abstract shape
     * @returns {AbstractShape}
     */
    upcast() {
        const ptr = this.__destroy_into_raw();
        const ret = wasm.wire_upcast(ptr);
        return AbstractShape.__wrap(ret);
    }
}
if (Symbol.dispose) Wire.prototype[Symbol.dispose] = Wire.prototype.free;

/**
 * and operator
 * @param {Solid} solid0
 * @param {Solid} solid1
 * @param {number | null} [tol]
 * @returns {Solid | undefined}
 */
export function and(solid0, solid1, tol) {
    _assertClass(solid0, Solid);
    _assertClass(solid1, Solid);
    const ret = wasm.and(solid0.__wbg_ptr, solid1.__wbg_ptr, !isLikeNone(tol), isLikeNone(tol) ? 0 : tol);
    return ret === 0 ? undefined : Solid.__wrap(ret);
}

/**
 * Returns a Bezier curve from `vertex0` to `vertex1` with inter control points `inter_points`.
 * @param {Vertex} vertex0
 * @param {Vertex} vertex1
 * @param {Float64Array} inter_points
 * @returns {Edge}
 */
export function bezier(vertex0, vertex1, inter_points) {
    _assertClass(vertex0, Vertex);
    _assertClass(vertex1, Vertex);
    const ptr0 = passArrayF64ToWasm0(inter_points, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.bezier(vertex0.__wbg_ptr, vertex1.__wbg_ptr, ptr0, len0);
    return Edge.__wrap(ret);
}

/**
 * Returns a circle arc from `vertex0` to `vertex1` via `transit`.
 * @param {Vertex} vertex0
 * @param {Vertex} vertex1
 * @param {Float64Array} transit
 * @returns {Edge}
 */
export function circle_arc(vertex0, vertex1, transit) {
    _assertClass(vertex0, Vertex);
    _assertClass(vertex1, Vertex);
    const ptr0 = passArrayF64ToWasm0(transit, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.circle_arc(vertex0.__wbg_ptr, vertex1.__wbg_ptr, ptr0, len0);
    return Edge.__wrap(ret);
}

/**
 * Sweeps a vertex, an edge, a wire, a face, or a shell by a vector.
 * @param {AbstractShape} shape
 * @param {Float64Array} vector
 * @returns {AbstractShape}
 */
export function extrude(shape, vector) {
    _assertClass(shape, AbstractShape);
    const ptr0 = passArrayF64ToWasm0(vector, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.extrude(shape.__wbg_ptr, ptr0, len0);
    return AbstractShape.__wrap(ret);
}

/**
 * Returns a homotopic face from `edge0` to `edge1`.
 * @param {Edge} edge0
 * @param {Edge} edge1
 * @returns {Face}
 */
export function homotopy(edge0, edge1) {
    _assertClass(edge0, Edge);
    _assertClass(edge1, Edge);
    const ret = wasm.homotopy(edge0.__wbg_ptr, edge1.__wbg_ptr);
    return Face.__wrap(ret);
}

/**
 * Returns a line from `vertex0` to `vertex1`.
 * @param {Vertex} vertex0
 * @param {Vertex} vertex1
 * @returns {Edge}
 */
export function line(vertex0, vertex1) {
    _assertClass(vertex0, Vertex);
    _assertClass(vertex1, Vertex);
    const ret = wasm.line(vertex0.__wbg_ptr, vertex1.__wbg_ptr);
    return Edge.__wrap(ret);
}

/**
 * not operator
 * @param {Solid} solid
 * @returns {Solid}
 */
export function not(solid) {
    _assertClass(solid, Solid);
    const ret = wasm.not(solid.__wbg_ptr);
    return Solid.__wrap(ret);
}

/**
 * or operator
 * @param {Solid} solid0
 * @param {Solid} solid1
 * @param {number | null} [tol]
 * @returns {Solid | undefined}
 */
export function or(solid0, solid1, tol) {
    _assertClass(solid0, Solid);
    _assertClass(solid1, Solid);
    const ret = wasm.or(solid0.__wbg_ptr, solid1.__wbg_ptr, !isLikeNone(tol), isLikeNone(tol) ? 0 : tol);
    return ret === 0 ? undefined : Solid.__wrap(ret);
}

/**
 * Sweeps a vertex, an edge, a wire, a face, or a shell by the rotation.
 * @param {AbstractShape} shape
 * @param {Float64Array} origin
 * @param {Float64Array} axis
 * @param {number} angle
 * @param {number} division
 * @returns {AbstractShape}
 */
export function revolve(shape, origin, axis, angle, division) {
    _assertClass(shape, AbstractShape);
    const ptr0 = passArrayF64ToWasm0(origin, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF64ToWasm0(axis, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.revolve(shape.__wbg_ptr, ptr0, len0, ptr1, len1, angle, division);
    return AbstractShape.__wrap(ret);
}

/**
 * Returns a rotated vertex, edge, wire, face, shell or solid.
 * @param {AbstractShape} shape
 * @param {Float64Array} origin
 * @param {Float64Array} axis
 * @param {number} angle
 * @returns {AbstractShape}
 */
export function rotated(shape, origin, axis, angle) {
    _assertClass(shape, AbstractShape);
    const ptr0 = passArrayF64ToWasm0(origin, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF64ToWasm0(axis, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.rotated(shape.__wbg_ptr, ptr0, len0, ptr1, len1, angle);
    return AbstractShape.__wrap(ret);
}

/**
 * Returns a scaled vertex, edge, wire, face, shell or solid.
 * @param {AbstractShape} shape
 * @param {Float64Array} origin
 * @param {Float64Array} scalars
 * @returns {AbstractShape}
 */
export function scaled(shape, origin, scalars) {
    _assertClass(shape, AbstractShape);
    const ptr0 = passArrayF64ToWasm0(origin, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF64ToWasm0(scalars, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.scaled(shape.__wbg_ptr, ptr0, len0, ptr1, len1);
    return AbstractShape.__wrap(ret);
}

/**
 * Returns a translated vertex, edge, wire, face, shell or solid.
 * @param {AbstractShape} shape
 * @param {Float64Array} vector
 * @returns {AbstractShape}
 */
export function translated(shape, vector) {
    _assertClass(shape, AbstractShape);
    const ptr0 = passArrayF64ToWasm0(vector, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.translated(shape.__wbg_ptr, ptr0, len0);
    return AbstractShape.__wrap(ret);
}

/**
 * Try attatiching a plane whose boundary is `wire`.
 * @param {Wire} wire
 * @returns {Face | undefined}
 */
export function try_attach_plane(wire) {
    _assertClass(wire, Wire);
    const ret = wasm.try_attach_plane(wire.__wbg_ptr);
    return ret === 0 ? undefined : Face.__wrap(ret);
}

/**
 * Creates and returns a vertex by a three dimensional point.
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {Vertex}
 */
export function vertex(x, y, z) {
    const ret = wasm.vertex(x, y, z);
    return Vertex.__wrap(ret);
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_is_undefined_c05833b95a3cf397: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_string_get_b0ca35b86a603356: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_344f42d3211c4765: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_error_ada576b138020f01: function(arg0, arg1) {
            var v0 = getArrayJsValueFromWasm0(arg0, arg1).slice();
            wasm.__wbindgen_free(arg0, arg1 * 4, 4);
            console.error(...v0);
        },
        __wbg_now_e7c6795a7f81e10f: function(arg0) {
            const ret = arg0.now();
            return ret;
        },
        __wbg_now_edcc07a36ce76996: function() {
            const ret = performance.now();
            return ret;
        },
        __wbg_performance_3fcf6e32a7e1ed0a: function(arg0) {
            const ret = arg0.performance;
            return ret;
        },
        __wbg_static_accessor_GLOBAL_4ef717fb391d88b7: function() {
            const ret = typeof global === 'undefined' ? null : global;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_GLOBAL_THIS_8d1badc68b5a74f4: function() {
            const ret = typeof globalThis === 'undefined' ? null : globalThis;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_SELF_146583524fe1469b: function() {
            const ret = typeof self === 'undefined' ? null : self;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_WINDOW_f2829a2234d7819e: function() {
            const ret = typeof window === 'undefined' ? null : window;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./crawler_kernel_worker_bg.js": import0,
    };
}

const AbstractShapeFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_abstractshape_free(ptr, 1));
const EdgeFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_edge_free(ptr, 1));
const FaceFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_face_free(ptr, 1));
const PolygonBufferFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_polygonbuffer_free(ptr, 1));
const PolygonMeshFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_polygonmesh_free(ptr, 1));
const ShapeFromStepFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_shapefromstep_free(ptr, 1));
const ShellFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_shell_free(ptr, 1));
const SolidFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_solid_free(ptr, 1));
const StepHeaderDescriptorFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_stepheaderdescriptor_free(ptr, 1));
const TableFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_table_free(ptr, 1));
const VertexFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_vertex_free(ptr, 1));
const WasmKernelAdapterFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmkerneladapter_free(ptr, 1));
const WasmRenderPacketFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmrenderpacket_free(ptr, 1));
const WireFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wire_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

function getArrayJsValueFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    const mem = getDataViewMemory0();
    const result = [];
    for (let i = ptr; i < ptr + 4 * len; i += 4) {
        result.push(wasm.__wbindgen_externrefs.get(mem.getUint32(i, true)));
    }
    wasm.__externref_drop_slice(ptr, len);
    return result;
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getBigUint64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedBigUint64ArrayMemory0 = null;
function getBigUint64ArrayMemory0() {
    if (cachedBigUint64ArrayMemory0 === null || cachedBigUint64ArrayMemory0.byteLength === 0) {
        cachedBigUint64ArrayMemory0 = new BigUint64Array(wasm.memory.buffer);
    }
    return cachedBigUint64ArrayMemory0;
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF64ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 8, 8) >>> 0;
    getFloat64ArrayMemory0().set(arg, ptr / 8);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayJsValueToWasm0(array, malloc) {
    const ptr = malloc(array.length * 4, 4) >>> 0;
    for (let i = 0; i < array.length; i++) {
        const add = addToExternrefTable0(array[i]);
        getDataViewMemory0().setUint32(ptr + 4 * i, add, true);
    }
    WASM_VECTOR_LEN = array.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedBigUint64ArrayMemory0 = null;
    cachedDataViewMemory0 = null;
    cachedFloat32ArrayMemory0 = null;
    cachedFloat64ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('crawler_kernel_worker_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
