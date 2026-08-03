use std::collections::{BTreeMap, BTreeSet};
#[cfg(not(target_arch = "wasm32"))]
use std::time::Instant;

use crawler_interchange::{StepImportError, import_step_body};

use crate::mesh;
use crate::protocol::{
    BooleanMode, BoundsNm, CancellationMode, Command, CommandEnvelope, ErrorCode, Event,
    EventEnvelope, IndexComponentType, MeshQualification, MessageMetadata, PROTOCOL_VERSION,
    PrimitiveTopology, PrismDimensionsNm, ResultPayload, StepImportResult, StepImportSettings,
};

const NANOMETERS_PER_MODEL_UNIT: f64 = 1_000_000.0;
const MAX_SAFE_INTEGER_NM: i64 = 9_007_199_254_740_991;

/// Last worker state acknowledged for a document.
#[derive(Debug, Clone, PartialEq)]
pub struct AcknowledgedState {
    /// Document revision that produced the state.
    pub document_revision: u64,
    /// Preview generation that produced the state.
    pub preview_generation: u64,
    /// Reference cube edge length.
    pub edge: f64,
    /// Stable operation identity for an acknowledged M1 operation.
    pub operation_id: Option<String>,
    /// Stable feature identity for an acknowledged M1 operation.
    pub feature_id: Option<String>,
    /// Exact dimensions for an acknowledged M1 extrusion.
    pub dimensions_nm: Option<PrismDimensionsNm>,
    /// Complete body/render result for the last successfully acknowledged STEP import.
    pub step_import: Option<StepImportResult>,
}

/// Stateful command executor owned by the dedicated worker.
#[derive(Debug, Default)]
pub struct WorkerEngine {
    cancelled: BTreeSet<String>,
    acknowledged: BTreeMap<String, AcknowledgedState>,
}

impl WorkerEngine {
    /// Executes a command and emits its ordered event stream.
    pub fn execute(&mut self, command: CommandEnvelope) -> Vec<EventEnvelope> {
        self.execute_with_phase_hook(command, |_, _| {})
    }

    /// Returns the last state acknowledged for `document_id`.
    pub fn acknowledged_state(&self, document_id: &str) -> Option<&AcknowledgedState> {
        self.acknowledged.get(document_id)
    }

    fn execute_with_phase_hook<F>(
        &mut self,
        command: CommandEnvelope,
        mut phase_hook: F,
    ) -> Vec<EventEnvelope>
    where
        F: FnMut(&str, &mut BTreeSet<String>),
    {
        let metadata = command.metadata;
        if metadata.protocol_version != PROTOCOL_VERSION {
            vec![event(
                &metadata,
                Event::Error {
                    code: ErrorCode::IncompatibleProtocol,
                    message: format!(
                        "unsupported protocol version {}; expected {PROTOCOL_VERSION}",
                        metadata.protocol_version
                    ),
                    expected_protocol_version: Some(PROTOCOL_VERSION),
                    field: Some("protocol_version".to_owned()),
                    recovery: Some(format!("resend with protocol_version {PROTOCOL_VERSION}")),
                    preserved_source: None,
                    source_sha256: None,
                },
            )]
        } else {
            match command.command {
                Command::Health => vec![
                    event(&metadata, Event::Accepted),
                    event(
                        &metadata,
                        Event::Result {
                            result: ResultPayload::Health {
                                protocol_version: PROTOCOL_VERSION,
                            },
                        },
                    ),
                ],
                Command::Cancel { target_request_id } => {
                    self.cancelled.insert(target_request_id.clone());
                    vec![
                        event(&metadata, Event::Accepted),
                        event(
                            &metadata,
                            Event::Result {
                                result: ResultPayload::CancellationRequested { target_request_id },
                            },
                        ),
                    ]
                }
                Command::BuildReferenceCube { edge } => {
                    if valid_positive(edge) {
                        self.execute_build(metadata, edge, &mut phase_hook)
                    } else {
                        invalid_edge(&metadata)
                    }
                }
                Command::TessellateReferenceCube {
                    edge,
                    tolerance,
                    phase_delay_ms: _,
                } => {
                    if !valid_positive(edge) {
                        invalid_edge(&metadata)
                    } else if !valid_positive(tolerance) {
                        vec![event(
                            &metadata,
                            Event::Error {
                                code: ErrorCode::InvalidCommand,
                                message: "tolerance must be finite and greater than zero"
                                    .to_owned(),
                                expected_protocol_version: None,
                                field: Some("tolerance".to_owned()),
                                recovery: Some(
                                    "provide a finite tolerance greater than zero".to_owned(),
                                ),
                                preserved_source: None,
                                source_sha256: None,
                            },
                        )]
                    } else {
                        self.execute_tessellation(metadata, edge, tolerance, &mut phase_hook)
                    }
                }
                Command::ExtrudeRectangularPrism {
                    operation_id,
                    feature_id,
                    width_nm,
                    height_nm,
                    distance_nm,
                    tolerance_nm,
                    boolean_mode,
                    phase_delay_ms: _,
                } => {
                    let dimensions = PrismDimensionsNm {
                        width_nm,
                        height_nm,
                        distance_nm,
                    };
                    match validate_extrude(
                        &metadata,
                        &operation_id,
                        &feature_id,
                        dimensions,
                        tolerance_nm,
                        boolean_mode,
                    ) {
                        Ok(()) => self.execute_extrude(
                            metadata,
                            operation_id,
                            feature_id,
                            dimensions,
                            tolerance_nm,
                            &mut phase_hook,
                        ),
                        Err(failure) => vec![*failure],
                    }
                }
                Command::ImportStep {
                    import_id,
                    source_bytes,
                    settings,
                    phase_delay_ms: _,
                } => match validate_step_import(&metadata, &import_id, &source_bytes, settings) {
                    Ok(()) => self.execute_step_import(
                        metadata,
                        import_id,
                        source_bytes,
                        settings,
                        &mut phase_hook,
                    ),
                    Err(failure) => vec![*failure],
                },
            }
        }
    }

    fn execute_build<F>(
        &mut self,
        metadata: MessageMetadata,
        edge: f64,
        phase_hook: &mut F,
    ) -> Vec<EventEnvelope>
    where
        F: FnMut(&str, &mut BTreeSet<String>),
    {
        let mut events = vec![event(&metadata, Event::Accepted)];
        phase_hook("build", &mut self.cancelled);
        if self.cancelled.remove(&metadata.request_id) {
            events.push(cancelled(&metadata));
        } else {
            match mesh::reference_cube(edge) {
                Ok(_) => {
                    events.push(event(
                        &metadata,
                        Event::Progress {
                            phase: "build".to_owned(),
                            percent: 100,
                        },
                    ));
                    self.acknowledge(&metadata, edge);
                    events.push(event(
                        &metadata,
                        Event::Result {
                            result: ResultPayload::ReferenceCube { edge },
                        },
                    ));
                }
                Err(message) => events.push(kernel_error(&metadata, message)),
            }
        }
        events
    }

    fn execute_extrude<F>(
        &mut self,
        metadata: MessageMetadata,
        operation_id: String,
        feature_id: String,
        dimensions_nm: PrismDimensionsNm,
        tolerance_nm: i64,
        phase_hook: &mut F,
    ) -> Vec<EventEnvelope>
    where
        F: FnMut(&str, &mut BTreeSet<String>),
    {
        let mut events = vec![event(&metadata, Event::Accepted)];
        phase_hook("build", &mut self.cancelled);
        if self.cancelled.remove(&metadata.request_id) {
            events.push(cancelled(&metadata));
            return events;
        }
        events.push(event(
            &metadata,
            Event::Progress {
                phase: "build".to_owned(),
                percent: 40,
            },
        ));
        phase_hook("tessellate", &mut self.cancelled);
        if self.cancelled.remove(&metadata.request_id) {
            events.push(cancelled(&metadata));
            return events;
        }

        let width = dimensions_nm.width_nm as f64 / NANOMETERS_PER_MODEL_UNIT;
        let height = dimensions_nm.height_nm as f64 / NANOMETERS_PER_MODEL_UNIT;
        let distance = dimensions_nm.distance_nm as f64 / NANOMETERS_PER_MODEL_UNIT;
        let tolerance = tolerance_nm as f64 / NANOMETERS_PER_MODEL_UNIT;
        let started = KernelTimer::start();
        match mesh::tessellate_rectangular_prism(width, height, distance, tolerance) {
            Ok(mesh) => {
                let kernel_time_ms = started.elapsed_ms();
                let transferred_bytes =
                    mesh.vertices.len() * size_of::<f32>() + mesh.indices.len() * size_of::<u32>();
                events.push(event(
                    &metadata,
                    Event::Progress {
                        phase: "tessellate".to_owned(),
                        percent: 100,
                    },
                ));
                self.acknowledge_extrude(&metadata, &operation_id, &feature_id, dimensions_nm);
                events.push(event(
                    &metadata,
                    Event::Result {
                        result: ResultPayload::ExtrudeMesh {
                            operation_id,
                            feature_id,
                            dimensions_nm,
                            bounds_nm: BoundsNm {
                                min: [0, 0, 0],
                                max: [
                                    dimensions_nm.width_nm,
                                    dimensions_nm.height_nm,
                                    dimensions_nm.distance_nm,
                                ],
                            },
                            qualification: MeshQualification {
                                vertex_stride_f32: 8,
                                index_component_type: IndexComponentType::Uint32,
                                primitive_topology: PrimitiveTopology::TriangleList,
                                tolerance_nm,
                            },
                            vertices: mesh.vertices,
                            indices: mesh.indices,
                            transferred_bytes,
                            kernel_time_ms,
                        },
                    },
                ));
            }
            Err(message) => events.push(operation_error(
                &metadata,
                ErrorCode::Internal,
                format!("rectangular-prism kernel failure: {message}"),
                None,
                Some("retry the preview; if it repeats, reopen the document"),
            )),
        }
        events
    }

    fn execute_tessellation<F>(
        &mut self,
        metadata: MessageMetadata,
        edge: f64,
        tolerance: f64,
        phase_hook: &mut F,
    ) -> Vec<EventEnvelope>
    where
        F: FnMut(&str, &mut BTreeSet<String>),
    {
        let mut events = vec![event(&metadata, Event::Accepted)];
        phase_hook("build", &mut self.cancelled);
        if self.cancelled.remove(&metadata.request_id) {
            events.push(cancelled(&metadata));
        } else {
            events.push(event(
                &metadata,
                Event::Progress {
                    phase: "build".to_owned(),
                    percent: 40,
                },
            ));
            phase_hook("tessellate", &mut self.cancelled);
            if self.cancelled.remove(&metadata.request_id) {
                events.push(cancelled(&metadata));
            } else {
                let started = KernelTimer::start();
                match mesh::tessellate_reference_cube(edge, tolerance) {
                    Ok(mesh) => {
                        let kernel_time_ms = started.elapsed_ms();
                        let transferred_bytes = mesh.vertices.len() * size_of::<f32>()
                            + mesh.indices.len() * size_of::<u32>();
                        events.push(event(
                            &metadata,
                            Event::Progress {
                                phase: "tessellate".to_owned(),
                                percent: 100,
                            },
                        ));
                        self.acknowledge(&metadata, edge);
                        events.push(event(
                            &metadata,
                            Event::Result {
                                result: ResultPayload::Mesh {
                                    vertices: mesh.vertices,
                                    indices: mesh.indices,
                                    transferred_bytes,
                                    kernel_time_ms,
                                },
                            },
                        ));
                    }
                    Err(message) => events.push(kernel_error(&metadata, message)),
                }
            }
        }
        events
    }

    fn acknowledge(&mut self, metadata: &MessageMetadata, edge: f64) {
        self.acknowledged.insert(
            metadata.document_id.clone(),
            AcknowledgedState {
                document_revision: metadata.document_revision,
                preview_generation: metadata.preview_generation,
                edge,
                operation_id: None,
                feature_id: None,
                dimensions_nm: None,
                step_import: None,
            },
        );
    }

    fn acknowledge_extrude(
        &mut self,
        metadata: &MessageMetadata,
        operation_id: &str,
        feature_id: &str,
        dimensions_nm: PrismDimensionsNm,
    ) {
        self.acknowledged.insert(
            metadata.document_id.clone(),
            AcknowledgedState {
                document_revision: metadata.document_revision,
                preview_generation: metadata.preview_generation,
                edge: dimensions_nm.width_nm as f64 / NANOMETERS_PER_MODEL_UNIT,
                operation_id: Some(operation_id.to_owned()),
                feature_id: Some(feature_id.to_owned()),
                dimensions_nm: Some(dimensions_nm),
                step_import: None,
            },
        );
    }

    fn execute_step_import<F>(
        &mut self,
        metadata: MessageMetadata,
        import_id: String,
        source_bytes: Vec<u8>,
        settings: StepImportSettings,
        phase_hook: &mut F,
    ) -> Vec<EventEnvelope>
    where
        F: FnMut(&str, &mut BTreeSet<String>),
    {
        let mut events = vec![event(&metadata, Event::Accepted)];
        phase_hook("parse", &mut self.cancelled);
        if self.cancelled.remove(&metadata.request_id) {
            events.push(cancelled(&metadata));
            return events;
        }
        events.push(event(
            &metadata,
            Event::Progress {
                phase: "parse".to_owned(),
                percent: 25,
            },
        ));
        phase_hook("materialize", &mut self.cancelled);
        if self.cancelled.remove(&metadata.request_id) {
            events.push(cancelled(&metadata));
            return events;
        }

        let started = KernelTimer::start();
        match import_step_body(&source_bytes, settings, format!("body:{import_id}")) {
            Ok(imported) => {
                let kernel_time_ms = started.elapsed_ms();
                let transferred_bytes = imported.render_packet.transferable_bytes();
                events.push(event(
                    &metadata,
                    Event::Progress {
                        phase: "materialize".to_owned(),
                        percent: 100,
                    },
                ));
                self.acknowledged.insert(
                    metadata.document_id.clone(),
                    AcknowledgedState {
                        document_revision: metadata.document_revision,
                        preview_generation: metadata.preview_generation,
                        edge: 0.0,
                        operation_id: Some(import_id.clone()),
                        feature_id: None,
                        dimensions_nm: None,
                        step_import: Some(imported.clone()),
                    },
                );
                events.push(event(
                    &metadata,
                    Event::Result {
                        result: ResultPayload::StepImport {
                            import_id,
                            provenance: imported.provenance,
                            body: imported.body,
                            render_packet: Box::new(imported.render_packet),
                            transferred_bytes,
                            kernel_time_ms,
                        },
                    },
                ));
            }
            Err(error) => events.push(step_import_error(&metadata, error)),
        }
        events
    }
}

#[cfg(not(target_arch = "wasm32"))]
struct KernelTimer(Instant);

#[cfg(not(target_arch = "wasm32"))]
impl KernelTimer {
    fn start() -> Self {
        Self(Instant::now())
    }

    fn elapsed_ms(&self) -> f64 {
        self.0.elapsed().as_secs_f64() * 1_000.0
    }
}

#[cfg(target_arch = "wasm32")]
struct KernelTimer(f64);

#[cfg(target_arch = "wasm32")]
impl KernelTimer {
    fn start() -> Self {
        Self(performance_now())
    }

    fn elapsed_ms(&self) -> f64 {
        performance_now() - self.0
    }
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen]
extern "C" {
    #[wasm_bindgen::prelude::wasm_bindgen(js_namespace = performance, js_name = now)]
    fn performance_now() -> f64;
}

fn validate_extrude(
    metadata: &MessageMetadata,
    operation_id: &str,
    feature_id: &str,
    dimensions: PrismDimensionsNm,
    tolerance_nm: i64,
    boolean_mode: BooleanMode,
) -> Result<(), Box<EventEnvelope>> {
    for (field, value) in [
        ("request_id", metadata.request_id.as_str()),
        ("document_id", metadata.document_id.as_str()),
        ("operation_id", operation_id),
        ("feature_id", feature_id),
    ] {
        if value.trim().is_empty() {
            return Err(Box::new(operation_error(
                metadata,
                ErrorCode::InvalidInput,
                format!("{field} must be a non-empty stable identifier"),
                Some(field),
                Some("supply the stable identifier from the document timeline"),
            )));
        }
    }
    for (field, value) in [
        ("width_nm", dimensions.width_nm),
        ("height_nm", dimensions.height_nm),
        ("distance_nm", dimensions.distance_nm),
        ("tolerance_nm", tolerance_nm),
    ] {
        if value <= 0 {
            return Err(Box::new(operation_error(
                metadata,
                ErrorCode::InvalidInput,
                format!("{field} must be an integer greater than zero"),
                Some(field),
                Some("enter a positive dimension in nanometers"),
            )));
        }
        if value > MAX_SAFE_INTEGER_NM {
            return Err(Box::new(operation_error(
                metadata,
                ErrorCode::NumericalFailure,
                format!("{field} exceeds the exact worker transport range"),
                Some(field),
                Some("use a value no greater than 9007199254740991 nanometers"),
            )));
        }
    }
    if boolean_mode != BooleanMode::NewBody {
        return Err(Box::new(operation_error(
            metadata,
            ErrorCode::UnsupportedOperation,
            format!("boolean mode {boolean_mode:?} is not supported by the M1 bridge"),
            Some("boolean_mode"),
            Some("use new_body or wait for the boolean operation milestone"),
        )));
    }
    Ok(())
}

fn validate_step_import(
    metadata: &MessageMetadata,
    import_id: &str,
    source_bytes: &[u8],
    settings: StepImportSettings,
) -> Result<(), Box<EventEnvelope>> {
    for (field, value) in [
        ("request_id", metadata.request_id.as_str()),
        ("document_id", metadata.document_id.as_str()),
        ("import_id", import_id),
    ] {
        if value.trim().is_empty() {
            return Err(Box::new(step_validation_error(
                metadata,
                &format!("{field} must be a non-empty stable identifier"),
                field,
                source_bytes,
            )));
        }
    }
    if settings.tolerance_nanometers == 0 {
        return Err(Box::new(step_validation_error(
            metadata,
            "settings.tolerance_nanometers must be greater than zero",
            "settings.tolerance_nanometers",
            source_bytes,
        )));
    }
    if settings.tolerance_nanometers > MAX_SAFE_INTEGER_NM as u64 {
        return Err(Box::new(step_validation_error(
            metadata,
            "settings.tolerance_nanometers exceeds the exact worker transport range",
            "settings.tolerance_nanometers",
            source_bytes,
        )));
    }
    Ok(())
}

fn event(metadata: &MessageMetadata, event: Event) -> EventEnvelope {
    EventEnvelope {
        metadata: metadata.clone(),
        event,
    }
}

fn cancelled(metadata: &MessageMetadata) -> EventEnvelope {
    event(
        metadata,
        Event::Cancelled {
            cancellation_mode: CancellationMode::Cooperative,
            code: ErrorCode::Cancelled,
            field: "request_id".to_owned(),
            recovery: "submit the newest preview generation or retry the operation".to_owned(),
        },
    )
}

fn valid_positive(value: f64) -> bool {
    value.is_finite() && value > 0.0
}

fn invalid_edge(metadata: &MessageMetadata) -> Vec<EventEnvelope> {
    vec![event(
        metadata,
        Event::Error {
            code: ErrorCode::InvalidCommand,
            message: "edge must be finite and greater than zero".to_owned(),
            expected_protocol_version: None,
            field: Some("edge".to_owned()),
            recovery: Some("provide a finite edge greater than zero".to_owned()),
            preserved_source: None,
            source_sha256: None,
        },
    )]
}

fn kernel_error(metadata: &MessageMetadata, message: String) -> EventEnvelope {
    event(
        metadata,
        Event::Error {
            code: ErrorCode::Kernel,
            message,
            expected_protocol_version: None,
            field: None,
            recovery: Some("retry the command or restart the kernel worker".to_owned()),
            preserved_source: None,
            source_sha256: None,
        },
    )
}

fn operation_error(
    metadata: &MessageMetadata,
    code: ErrorCode,
    message: String,
    field: Option<&str>,
    recovery: Option<&str>,
) -> EventEnvelope {
    event(
        metadata,
        Event::Error {
            code,
            message,
            expected_protocol_version: None,
            field: field.map(str::to_owned),
            recovery: recovery.map(str::to_owned),
            preserved_source: None,
            source_sha256: None,
        },
    )
}

fn step_validation_error(
    metadata: &MessageMetadata,
    message: &str,
    field: &str,
    source_bytes: &[u8],
) -> EventEnvelope {
    event(
        metadata,
        Event::Error {
            code: ErrorCode::InvalidInput,
            message: message.to_owned(),
            expected_protocol_version: None,
            field: Some(field.to_owned()),
            recovery: Some("correct the exact import settings and retry".to_owned()),
            preserved_source: Some(source_bytes.to_vec()),
            source_sha256: None,
        },
    )
}

fn step_import_error(metadata: &MessageMetadata, error: StepImportError) -> EventEnvelope {
    let code = match error.code {
        "invalid_step" | "invalid_entity" | "invalid_topology" | "empty_body" => {
            ErrorCode::InvalidEntity
        }
        "unsupported_step" | "unsupported_entity" | "unsupported_geometry" => {
            ErrorCode::UnsupportedImport
        }
        "render_failed" | "body_encode_failed" => ErrorCode::Kernel,
        _ if error.message.contains("no inspectable shells") => ErrorCode::UnsupportedImport,
        _ => ErrorCode::Internal,
    };
    event(
        metadata,
        Event::Error {
            code,
            message: error.message,
            expected_protocol_version: None,
            field: Some("source_bytes".to_owned()),
            recovery: Some("retain the source and review the STEP diagnostic".to_owned()),
            preserved_source: Some(error.source_bytes),
            source_sha256: Some(error.source_sha256),
        },
    )
}

#[cfg(test)]
mod tests {
    use crate::protocol::{
        BooleanMode, BoundsNm, Command, ErrorCode, Event, MessageMetadata, PROTOCOL_VERSION,
        PrismDimensionsNm,
    };

    use super::*;

    fn envelope(request_id: &str, command: Command) -> CommandEnvelope {
        CommandEnvelope {
            metadata: MessageMetadata {
                protocol_version: PROTOCOL_VERSION,
                request_id: request_id.to_owned(),
                document_id: "document-a".to_owned(),
                document_revision: 4,
                preview_generation: 2,
            },
            command,
        }
    }

    fn extrude(
        request_id: &str,
        width_nm: i64,
        height_nm: i64,
        distance_nm: i64,
        boolean_mode: BooleanMode,
    ) -> CommandEnvelope {
        envelope(
            request_id,
            Command::ExtrudeRectangularPrism {
                operation_id: "operation-extrude-1".to_owned(),
                feature_id: "feature-body-1".to_owned(),
                width_nm,
                height_nm,
                distance_nm,
                tolerance_nm: 10_000,
                boolean_mode,
                phase_delay_ms: 0,
            },
        )
    }

    fn import_step(request_id: &str, source_bytes: Vec<u8>) -> CommandEnvelope {
        envelope(
            request_id,
            Command::ImportStep {
                import_id: "import-step-1".to_owned(),
                source_bytes,
                settings: StepImportSettings {
                    tolerance_nanometers: 10_000,
                },
                phase_delay_ms: 0,
            },
        )
    }

    #[test]
    fn unknown_protocol_fails_closed() {
        let mut command = envelope("health", Command::Health);
        command.metadata.protocol_version = PROTOCOL_VERSION + 1;
        let events = WorkerEngine::default().execute(command);

        assert!(matches!(
            events.as_slice(),
            [EventEnvelope {
                event: Event::Error {
                    code: ErrorCode::IncompatibleProtocol,
                    expected_protocol_version: Some(PROTOCOL_VERSION),
                    ..
                },
                ..
            }]
        ));
    }

    #[test]
    fn cancellation_between_phases_does_not_acknowledge_state() {
        let command = envelope(
            "long-running",
            Command::TessellateReferenceCube {
                edge: 1.0,
                tolerance: 0.01,
                phase_delay_ms: 25,
            },
        );
        let mut engine = WorkerEngine::default();
        let events = engine.execute_with_phase_hook(command, |phase, cancelled| {
            if phase == "tessellate" {
                cancelled.insert("long-running".to_owned());
            }
        });

        assert!(matches!(
            events.last().map(|event| &event.event),
            Some(Event::Cancelled {
                cancellation_mode: CancellationMode::Cooperative,
                ..
            })
        ));
        assert_eq!(engine.acknowledged_state("document-a"), None);
    }

    #[test]
    fn cube_mesh_reports_exact_transferable_bytes() {
        let events = WorkerEngine::default().execute(envelope(
            "mesh",
            Command::TessellateReferenceCube {
                edge: 1.0,
                tolerance: 0.01,
                phase_delay_ms: 0,
            },
        ));
        let result = events.last().map(|event| &event.event);

        assert!(matches!(
            result,
            Some(Event::Result {
                result: ResultPayload::Mesh {
                    vertices,
                    indices,
                    transferred_bytes,
                    ..
                }
            }) if !vertices.is_empty()
                && !indices.is_empty()
                && *transferred_bytes
                    == vertices.len() * size_of::<f32>() + indices.len() * size_of::<u32>()
        ));
    }

    #[test]
    fn edited_extrude_dimensions_change_exact_bounds_and_acknowledged_state() {
        let mut engine = WorkerEngine::default();
        let first = engine.execute(extrude(
            "extrude-first",
            10_000_000,
            20_000_000,
            30_000_000,
            BooleanMode::NewBody,
        ));
        let mut edited = extrude(
            "extrude-edited",
            15_000_000,
            20_000_000,
            30_000_000,
            BooleanMode::NewBody,
        );
        edited.metadata.preview_generation += 1;
        let second = engine.execute(edited);

        let bounds = |events: &[EventEnvelope]| match &events.last().unwrap().event {
            Event::Result {
                result: ResultPayload::ExtrudeMesh { bounds_nm, .. },
            } => *bounds_nm,
            other => panic!("expected extrusion mesh, got {other:?}"),
        };
        assert_eq!(
            bounds(&first),
            BoundsNm {
                min: [0, 0, 0],
                max: [10_000_000, 20_000_000, 30_000_000],
            }
        );
        assert_eq!(bounds(&second).max[0], 15_000_000);
        assert_eq!(
            engine
                .acknowledged_state("document-a")
                .and_then(|state| state.dimensions_nm),
            Some(PrismDimensionsNm {
                width_nm: 15_000_000,
                height_nm: 20_000_000,
                distance_nm: 30_000_000,
            })
        );
    }

    #[test]
    fn invalid_and_unsupported_extrudes_do_not_replace_acknowledged_state() {
        let mut engine = WorkerEngine::default();
        engine.execute(extrude(
            "valid",
            10_000_000,
            20_000_000,
            30_000_000,
            BooleanMode::NewBody,
        ));
        let acknowledged = engine.acknowledged_state("document-a").cloned();

        let invalid = engine.execute(extrude(
            "invalid",
            0,
            20_000_000,
            30_000_000,
            BooleanMode::NewBody,
        ));
        assert!(matches!(
            &invalid.last().unwrap().event,
            Event::Error {
                code: ErrorCode::InvalidInput,
                field: Some(field),
                recovery: Some(_),
                ..
            } if field == "width_nm"
        ));

        let unsupported = engine.execute(extrude(
            "join",
            10_000_000,
            20_000_000,
            30_000_000,
            BooleanMode::Join,
        ));
        assert!(matches!(
            &unsupported.last().unwrap().event,
            Event::Error {
                code: ErrorCode::UnsupportedOperation,
                field: Some(field),
                recovery: Some(_),
                ..
            } if field == "boolean_mode"
        ));
        assert_eq!(
            engine.acknowledged_state("document-a"),
            acknowledged.as_ref()
        );
    }

    #[test]
    fn extrude_preview_cancellation_does_not_acknowledge_state() {
        let command = extrude(
            "cancel-extrude",
            10_000_000,
            20_000_000,
            30_000_000,
            BooleanMode::NewBody,
        );
        let mut engine = WorkerEngine::default();
        let events = engine.execute_with_phase_hook(command, |phase, cancelled| {
            if phase == "tessellate" {
                cancelled.insert("cancel-extrude".to_owned());
            }
        });

        assert!(matches!(
            events.last().unwrap().event,
            Event::Cancelled { .. }
        ));
        assert_eq!(engine.acknowledged_state("document-a"), None);
    }

    #[test]
    fn checked_in_brep_step_cube_returns_provenance_and_acknowledges_only_success() {
        let source = include_bytes!(
            "../../../fixtures/reference-models/step-roundtrip-cube/samples/cube-brep.step"
        );
        let mut engine = WorkerEngine::default();
        let events = engine.execute(import_step("step-cube", source.to_vec()));

        assert!(matches!(events[0].event, Event::Accepted));
        assert!(matches!(
            &events[1].event,
            Event::Progress { phase, percent: 25 } if phase == "parse"
        ));
        assert!(matches!(
            &events[2].event,
            Event::Progress { phase, percent: 100 } if phase == "materialize"
        ));
        let provenance = match &events.last().unwrap().event {
            Event::Result {
                result:
                    ResultPayload::StepImport {
                        import_id,
                        provenance,
                        body,
                        render_packet,
                        transferred_bytes,
                        ..
                    },
            } => {
                assert_eq!(import_id, "import-step-1");
                assert_eq!(body.body_id, "body:import-step-1");
                assert_eq!(body.evidence.vertex_count, 24);
                assert_eq!(body.evidence.edge_count, 24);
                assert_eq!(body.evidence.face_count, 6);
                assert_eq!(body.evidence.bounds_nm.min, [0, 0, 0]);
                assert_eq!(body.evidence.bounds_nm.max, [10_000_000; 3]);
                assert_eq!(render_packet.bounds.min, [0.0, 0.0, 0.0]);
                assert_eq!(render_packet.bounds.max, [10.0, 10.0, 10.0]);
                assert_eq!(render_packet.face_ranges.len(), 6);
                assert_eq!(render_packet.edge_ranges.len(), 12);
                assert_eq!(render_packet.vertex_pick_tokens.len(), 8);
                assert_eq!(render_packet.pick_table.len(), 26);
                assert_eq!(*transferred_bytes, render_packet.transferable_bytes());
                provenance
            }
            other => panic!("expected STEP provenance, got {other:?}"),
        };
        assert_eq!(provenance.source_bytes, source.len());
        assert_eq!(provenance.settings.tolerance_nanometers, 10_000);
        assert_eq!(provenance.shell_count, 1);
        assert_eq!(provenance.face_count, 6);
        assert!(provenance.triangle_count >= 12);
        assert_eq!(
            engine
                .acknowledged_state("document-a")
                .and_then(|state| state.step_import.as_ref())
                .map(|imported| &imported.provenance),
            Some(provenance)
        );
    }

    #[test]
    fn invalid_step_retains_source_and_does_not_replace_acknowledged_state() {
        let valid = include_bytes!(
            "../../../fixtures/reference-models/step-roundtrip-cube/samples/cube-brep.step"
        );
        let invalid = b"ISO-10303-21;\nDATA;\n#broken\nENDSEC;\nEND-ISO-10303-21;\n";
        let mut engine = WorkerEngine::default();
        engine.execute(import_step("step-valid", valid.to_vec()));
        let acknowledged = engine.acknowledged_state("document-a").cloned();
        let events = engine.execute(import_step("step-invalid", invalid.to_vec()));

        assert!(matches!(
            &events.last().unwrap().event,
            Event::Error {
                code: ErrorCode::InvalidEntity,
                preserved_source: Some(source),
                source_sha256: Some(hash),
                ..
            } if source == invalid && !hash.is_empty()
        ));
        assert_eq!(
            engine.acknowledged_state("document-a"),
            acknowledged.as_ref()
        );
    }

    #[test]
    fn step_cancellation_before_inspection_never_acknowledges() {
        let source = include_bytes!(
            "../../../fixtures/reference-models/step-roundtrip-cube/samples/cube-brep.step"
        );
        let mut engine = WorkerEngine::default();
        let events = engine.execute_with_phase_hook(
            import_step("step-cancelled", source.to_vec()),
            |phase, cancelled| {
                if phase == "materialize" {
                    cancelled.insert("step-cancelled".to_owned());
                }
            },
        );

        assert!(matches!(
            events.last().unwrap().event,
            Event::Cancelled { .. }
        ));
        assert_eq!(engine.acknowledged_state("document-a"), None);
    }

    #[test]
    fn crawler_csg_step_cube_is_typed_unsupported_and_preserved() {
        let source = include_bytes!(
            "../../../fixtures/reference-models/step-roundtrip-cube/samples/cube-import.step"
        );
        let mut engine = WorkerEngine::default();
        let events = engine.execute(import_step("step-csg", source.to_vec()));

        assert!(matches!(
            &events.last().unwrap().event,
            Event::Error {
                code: ErrorCode::UnsupportedImport,
                preserved_source: Some(preserved),
                source_sha256: Some(hash),
                ..
            } if preserved == source && !hash.is_empty()
        ));
        assert_eq!(engine.acknowledged_state("document-a"), None);
    }

    #[test]
    fn unexpected_import_failure_maps_to_internal_and_preserves_diagnostics() {
        let source = b"diagnostic-source".to_vec();
        let error = StepImportError {
            code: "unexpected_import_failure",
            message: "unexpected import failure".to_owned(),
            source_sha256: "diagnostic-hash".to_owned(),
            source_bytes: source.clone(),
            settings: StepImportSettings {
                tolerance_nanometers: 10_000,
            },
        };
        let failure = step_import_error(&envelope("internal", Command::Health).metadata, error);

        assert!(matches!(
            failure.event,
            Event::Error {
                code: ErrorCode::Internal,
                preserved_source: Some(preserved),
                source_sha256: Some(hash),
                ..
            } if preserved == source && hash == "diagnostic-hash"
        ));
    }
}
