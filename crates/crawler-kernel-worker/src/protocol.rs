use serde::{Deserialize, Serialize};

pub use crawler_interchange::{
    BodySnapshot, RenderPacket, StepImportResult, StepImportSettings, StepImportSummary,
};

/// Current worker protocol version.
pub const PROTOCOL_VERSION: u16 = 1;

/// Metadata shared by every command and event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MessageMetadata {
    /// Protocol version used to decode the message.
    pub protocol_version: u16,
    /// Caller-generated request identifier.
    pub request_id: String,
    /// Stable document identifier.
    pub document_id: String,
    /// Document revision observed by the caller.
    pub document_revision: u64,
    /// Monotonic preview generation within a document revision.
    pub preview_generation: u64,
}

/// Versioned command accepted by the kernel worker.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommandEnvelope {
    /// Metadata used for compatibility and stale-result protection.
    #[serde(flatten)]
    pub metadata: MessageMetadata,
    /// Requested worker operation.
    #[serde(flatten)]
    pub command: Command,
}

/// Bounded commands supported by the worker spike.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "command", rename_all = "snake_case")]
pub enum Command {
    /// Report worker and protocol health.
    Health,
    /// Build the worker-owned reference cube.
    BuildReferenceCube {
        /// Cube edge length in model units.
        edge: f64,
    },
    /// Tessellate the worker-owned reference cube.
    TessellateReferenceCube {
        /// Cube edge length in model units.
        edge: f64,
        /// Tessellation tolerance in model units.
        tolerance: f64,
        /// Optional delay used only by the cancellation fixture.
        #[serde(default)]
        phase_delay_ms: u32,
    },
    /// Build and tessellate an exact rectangular-prism extrusion operation.
    ExtrudeRectangularPrism {
        /// Stable operation identity from the document timeline.
        operation_id: String,
        /// Stable feature identity produced by the operation.
        feature_id: String,
        /// Profile width in exact integer nanometers.
        width_nm: i64,
        /// Profile height in exact integer nanometers.
        height_nm: i64,
        /// Positive extrusion distance in exact integer nanometers.
        distance_nm: i64,
        /// Qualified tessellation tolerance in integer nanometers.
        #[serde(default = "default_tolerance_nm")]
        tolerance_nm: i64,
        /// Requested result-body behavior.
        #[serde(default)]
        boolean_mode: BooleanMode,
        /// Optional delay used only by cancellation and stale-preview tests.
        #[serde(default)]
        phase_delay_ms: u32,
    },
    /// Inspect and qualify a STEP file while retaining source provenance.
    ImportStep {
        /// Stable caller-owned import identity.
        import_id: String,
        /// Transferable source bytes. The JavaScript host transfers this buffer.
        source_bytes: Vec<u8>,
        /// Exact deterministic import settings.
        settings: StepImportSettings,
        /// Optional adapter delay used by cancellation/stale-result tests.
        #[serde(default)]
        phase_delay_ms: u32,
    },
    /// Request cancellation of another command.
    Cancel {
        /// Request identifier to cancel.
        target_request_id: String,
    },
}

/// Versioned event emitted by the kernel worker.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EventEnvelope {
    /// Metadata copied from the originating command.
    #[serde(flatten)]
    pub metadata: MessageMetadata,
    /// Event payload.
    #[serde(flatten)]
    pub event: Event,
}

/// Typed worker event variants.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum Event {
    /// The command passed compatibility and validation checks.
    Accepted,
    /// The command advanced to a named phase.
    Progress {
        /// Stable phase name.
        phase: String,
        /// Whole-number completion percentage.
        percent: u8,
    },
    /// The command completed successfully.
    Result {
        /// Command-specific result.
        result: ResultPayload,
    },
    /// The command stopped before acknowledgement.
    Cancelled {
        /// Cancellation implementation used by the host.
        cancellation_mode: CancellationMode,
        /// Stable typed failure category.
        code: ErrorCode,
        /// Command field associated with cancellation.
        field: String,
        /// Stable caller action that recovers from cancellation.
        recovery: String,
    },
    /// The command failed with a typed category.
    Error {
        /// Stable machine-readable category.
        code: ErrorCode,
        /// Human-readable diagnostic.
        message: String,
        /// Protocol version expected by this worker, when relevant.
        expected_protocol_version: Option<u16>,
        /// Input field responsible for the failure, when applicable.
        #[serde(skip_serializing_if = "Option::is_none")]
        field: Option<String>,
        /// Stable caller action that may recover from the failure.
        #[serde(skip_serializing_if = "Option::is_none")]
        recovery: Option<String>,
        /// Diagnosed source retained when STEP inspection fails.
        #[serde(skip_serializing_if = "Option::is_none")]
        preserved_source: Option<Vec<u8>>,
        /// Hash of the retained source when STEP inspection was attempted.
        #[serde(skip_serializing_if = "Option::is_none")]
        source_sha256: Option<String>,
    },
}

/// Successful command results.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ResultPayload {
    /// Worker health response.
    Health {
        /// Running protocol version.
        protocol_version: u16,
    },
    /// Worker-owned reference cube state.
    ReferenceCube {
        /// Cube edge length in model units.
        edge: f64,
    },
    /// Transferable render buffers for the reference cube.
    Mesh {
        /// Interleaved position and normal values.
        vertices: Vec<f32>,
        /// Triangle indices.
        indices: Vec<u32>,
        /// Sum of the transferable buffer byte lengths.
        transferred_bytes: usize,
        /// Time spent in the deterministic kernel fixture.
        kernel_time_ms: f64,
    },
    /// Qualified transferable render buffers for an extrusion operation.
    ExtrudeMesh {
        /// Stable operation identity echoed from the command.
        operation_id: String,
        /// Stable feature identity echoed from the command.
        feature_id: String,
        /// Exact operation dimensions.
        dimensions_nm: PrismDimensionsNm,
        /// Exact expected model bounds.
        bounds_nm: BoundsNm,
        /// Render-buffer layout and tessellation qualification.
        qualification: MeshQualification,
        /// Interleaved position, UV, and normal values.
        vertices: Vec<f32>,
        /// Triangle indices.
        indices: Vec<u32>,
        /// Sum of the transferable buffer byte lengths.
        transferred_bytes: usize,
        /// Time spent building and tessellating in the worker kernel.
        kernel_time_ms: f64,
    },
    /// STEP import provenance and deterministic inspection evidence.
    StepImport {
        /// Stable caller-owned import identity.
        import_id: String,
        /// Qualified source provenance and shell/face/triangle evidence.
        provenance: StepImportSummary,
        /// Save-ready imported kernel B-rep with deterministic geometry evidence.
        body: BodySnapshot,
        /// Authoritative selectable render payload derived from the imported B-rep.
        render_packet: Box<RenderPacket>,
        /// Sum of the renderer packet's transferable numeric buffers.
        transferred_bytes: usize,
        /// Time spent in the import kernel.
        kernel_time_ms: f64,
    },
    /// A cancellation request was registered.
    CancellationRequested {
        /// Target request identifier.
        target_request_id: String,
    },
}

/// Observable cancellation implementations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CancellationMode {
    /// Cancellation was observed between adapter phases.
    Cooperative,
    /// The host terminated and recreated a blocked worker.
    WorkerRestart,
}

/// Stable worker error categories.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    /// The command protocol version is unsupported.
    IncompatibleProtocol,
    /// Command arguments failed validation.
    InvalidCommand,
    /// The kernel adapter failed.
    Kernel,
    /// A typed operation input failed validation.
    InvalidInput,
    /// The requested operation or body behavior is not in the alpha contract.
    UnsupportedOperation,
    /// Exact input could not be represented by the qualified render path.
    NumericalFailure,
    /// The preview was cancelled before acknowledgement.
    Cancelled,
    /// A failure escaped the operation adapter without a narrower category.
    Internal,
    /// STEP syntax or referenced entities were invalid.
    InvalidEntity,
    /// The STEP file uses a valid but unsupported entity or representation.
    UnsupportedImport,
}

/// Result-body behavior requested by an extrusion operation.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BooleanMode {
    /// Produce a new independent body.
    #[default]
    NewBody,
    /// Join to an existing body (not supported by this bridge).
    Join,
    /// Cut an existing body (not supported by this bridge).
    Cut,
    /// Intersect with an existing body (not supported by this bridge).
    Intersect,
}

/// Exact rectangular-prism dimensions persisted by the operation layer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PrismDimensionsNm {
    pub width_nm: i64,
    pub height_nm: i64,
    pub distance_nm: i64,
}

/// Exact axis-aligned result bounds in nanometers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct BoundsNm {
    pub min: [i64; 3],
    pub max: [i64; 3],
}

/// Qualified layout for buffers crossing the worker boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct MeshQualification {
    /// `[position.xyz, uv.xy, normal.xyz]` values per vertex.
    pub vertex_stride_f32: u8,
    /// Stable GPU index component type.
    pub index_component_type: IndexComponentType,
    /// Stable primitive topology.
    pub primitive_topology: PrimitiveTopology,
    /// Tessellation tolerance used by the kernel.
    pub tolerance_nm: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IndexComponentType {
    Uint32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PrimitiveTopology {
    TriangleList,
}

fn default_tolerance_nm() -> i64 {
    10_000
}
