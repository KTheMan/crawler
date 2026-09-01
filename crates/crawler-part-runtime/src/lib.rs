//! Browser-worker ownership wrapper for the authoritative M1 part engine.

use crawler_document::{
    BodyId, ComponentId, ConstructionPlaneDefinitionV1, ConstructionPlaneGeometryV1,
    ConstructionPlaneId, DocumentChange, DocumentId, EntityId, ExtrudeDirectionV2, Feature,
    FeatureDefinitionV2, FeatureId, FeatureInput, OriginPlaneId, Parameter, ParameterExpression,
    ParameterExpressionNode, ParameterId, ParameterValue, PlanarSupportReferenceV2,
    ProfileReferenceV2, RegionDefinitionV2, RegionReferenceId, TransactionId,
};
use crawler_feature_graph::{
    FeatureGraphCommand, FeatureGraphDocument, FeatureGroupId, FeatureTimingDiagnostic,
    RollbackPosition, RuntimeDiagnostics, apply_transaction as validate_graph_transaction,
    compute_diagnostics_view, direct_relationships,
    prepare_transaction as prepare_graph_transaction, recompute_from_here,
};
use crawler_feature_kernel::{
    AxisAlignedBoundsNm, BodySnapshot, FeatureError, FeatureOperation, FeatureRequest,
    FeatureResult, GeometryEvidence, LoftInput, NativeCurveLoopV2, NativeCurveV2,
    NativeExtrudeCutInputV2, NativeExtrudeInputV2, NativeProfileRegionV2, ProfileRevolveInput,
    RevolveCutInput, SweepInput, execute as execute_feature, execute_native_extrude_extent_edit,
};
use crawler_interchange::{BodyExportSettings, ExportFormat, export_body, export_part};
use crawler_package::{
    DocumentKind, PackageFormatVersion, PackageManifest, PayloadDescriptor, PayloadMediaType,
    PayloadRole, PortablePackage, sha256_hex,
};
use crawler_parameters::{
    ExpressionNode, NamedParameter, NamedParameterId, ParameterDiagnostic, ParameterDiagnosticCode,
    ParameterExpression as TypedParameterExpression, ParameterSet,
};
use crawler_part_engine::{
    BlankPartCommand, EngineError, NewPartCommand, ParameterEdit, PartDimensions, PartEngine,
    SAFE_NANOMETER_BOUND, validate_construction_plane_offset_parameter,
};
use crawler_quantity::Quantity;
use crawler_render_packet::{RenderPacket, packet_from_solid, reference_cube_packet};
use crawler_sketch::{
    Constraint as SolverConstraint, DragRequest, EzpzSolver, Geometry, SketchCommand, SketchSolver,
    SolveState,
};
use crawler_topology_repair::{RepairInspection, draft_explicit_rebind, inspect_topology_repair};
use crawler_versioning::MigrationRegistry;
use monstertruck_modeling::{InnerSpace, Point3, Solid, Surface, Vector3, builder};
use std::collections::{BTreeMap, BTreeSet};
#[cfg(not(target_arch = "wasm32"))]
use std::time::Instant;

struct EvaluationTimer {
    #[cfg(not(target_arch = "wasm32"))]
    started: Instant,
}

impl EvaluationTimer {
    fn start() -> Self {
        Self {
            #[cfg(not(target_arch = "wasm32"))]
            started: Instant::now(),
        }
    }

    fn elapsed_microseconds(&self) -> u64 {
        #[cfg(not(target_arch = "wasm32"))]
        {
            self.started.elapsed().as_micros().max(1) as u64
        }
        #[cfg(target_arch = "wasm32")]
        {
            // `std::time::Instant::now()` traps on wasm32-unknown-unknown.
            // Browser wall-clock timing is collected outside the kernel; this
            // deterministic floor keeps relative diagnostic accounting valid.
            1
        }
    }
}

/// Fine-grained timings for large sketch preview work. Unlike feature timing,
/// these values are diagnostic-only and may use the browser's monotonic clock.
struct SketchPhaseTimer {
    #[cfg(not(target_arch = "wasm32"))]
    started: Instant,
    #[cfg(target_arch = "wasm32")]
    started_ms: f64,
}

impl SketchPhaseTimer {
    fn start() -> Self {
        Self {
            #[cfg(not(target_arch = "wasm32"))]
            started: Instant::now(),
            #[cfg(target_arch = "wasm32")]
            started_ms: js_sys::Date::now(),
        }
    }

    fn elapsed_milliseconds(&self) -> f64 {
        #[cfg(not(target_arch = "wasm32"))]
        {
            self.started.elapsed().as_secs_f64() * 1_000.0
        }
        #[cfg(target_arch = "wasm32")]
        {
            js_sys::Date::now() - self.started_ms
        }
    }
}

/// Stateful accepted part document. UI components receive snapshots and never
/// become owners of this state.
#[derive(Debug)]
pub struct PartRuntime {
    engine: PartEngine,
    /// Exact imported interchange sources retained outside canonical document
    /// JSON and emitted as immutable, content-addressed package payloads.
    imported_step_sources: BTreeMap<String, Vec<u8>>,
    timeline_rollback: TimelineRollback,
    diagnostics: RuntimeDiagnostics,
    evaluation_sequence: u64,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
enum TimelineRollback {
    BeforeFirst,
    After(FeatureId),
    #[default]
    End,
}

/// Shared durable feature envelope used by create, edit, and preview. Preview
/// deliberately accepts the commit payload unchanged so callers do not need a
/// second operation contract for transient geometry.
#[derive(Clone, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct AdvancedFeatureEnvelope {
    transaction_id: TransactionId,
    feature: Feature,
    #[serde(default)]
    parameter_definitions: Vec<Parameter>,
    #[serde(default)]
    before: Option<FeatureId>,
    /// Complete accepted design intent for feature-definition V2 adopters.
    /// Legacy callers omit this field and retain their V1 journal contract.
    #[serde(default)]
    feature_definition_v2: Option<FeatureDefinitionV2>,
    #[serde(default)]
    region_definition_v2: Option<RegionDefinitionV2>,
    request: FeatureRequest,
}

#[derive(Clone, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct OffsetConstructionPlaneRequest {
    plane_id: ConstructionPlaneId,
    component_id: ComponentId,
    base_plane_id: OriginPlaneId,
    offset_parameter_id: ParameterId,
    offset_nanometers: i64,
    suppressed: bool,
    transaction_id: TransactionId,
    base_revision: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize)]
struct ResolvedPlanarFrame {
    origin_nanometers: [i64; 3],
    x_axis_millionths: [i64; 3],
    y_axis_millionths: [i64; 3],
    normal_millionths: [i64; 3],
}

#[derive(Clone, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct TopologyRebindRequest {
    #[serde(default)]
    transaction_id: Option<TransactionId>,
    selected: crawler_document::TopologyReferenceId,
    observed: Vec<crawler_document::TopologyReference>,
    #[serde(default)]
    tolerance: Option<f64>,
    #[serde(default)]
    base_document_hash: Option<String>,
    #[serde(default)]
    base_revision: Option<u64>,
}

struct TopologyRebindPlan {
    base_document_hash: String,
    base_revision: u64,
    selected: crawler_document::TopologyReferenceId,
    candidate_frame: ResolvedPlanarFrame,
    output: BodySnapshot,
    changes: Vec<DocumentChange>,
    repaired_feature: FeatureId,
    recomputed_features: Vec<FeatureId>,
}

const DEFAULT_FEATURE_PREVIEW_TOLERANCE: f64 = 0.01;

impl PartRuntime {
    /// Restore a validated canonical document snapshot. Undo/redo history is
    /// intentionally process-local and starts empty after recovery.
    pub fn from_document_json(document_json: &str) -> Result<Self, EngineError> {
        let document = MigrationRegistry::default()
            .migrate(
                document_json.as_bytes(),
                &BTreeSet::new(),
                &BTreeSet::from(["document.core".to_owned()]),
                1,
            )
            .map_err(|error| EngineError::Serialization(error.to_string()))?
            .document;
        Ok(Self {
            engine: PartEngine::from_document(document)?,
            imported_step_sources: BTreeMap::new(),
            timeline_rollback: TimelineRollback::End,
            diagnostics: RuntimeDiagnostics::default(),
            evaluation_sequence: 0,
        })
    }

    /// Restore a validated portable `.crawlerpart` ZIP. Compatibility and all
    /// declared payload hashes are checked before the document becomes accepted.
    pub fn from_portable_package(package_bytes: &[u8]) -> Result<Self, EngineError> {
        let package = PortablePackage::from_archive_bytes(package_bytes).map_err(package_error)?;
        package
            .manifest()
            .ensure_compatible(
                &BTreeSet::from([1]),
                &BTreeSet::from(["document.core".to_owned()]),
            )
            .map_err(package_error)?;
        if package.manifest().document_kind != DocumentKind::Part {
            return Err(EngineError::InvalidDocument(
                "portable package is not a part document".into(),
            ));
        }
        let document_bytes = package
            .payload(&package.manifest().root_payload)
            .ok_or_else(|| {
                EngineError::InvalidDocument("portable package root payload is missing".into())
            })?;
        let migration = MigrationRegistry::default()
            .migrate(
                document_bytes,
                &package.manifest().required_features,
                &BTreeSet::from(["document.core".to_owned()]),
                1,
            )
            .map_err(|error| EngineError::Serialization(error.to_string()))?;
        let document = migration.document;
        if package.manifest().document_schema_version != migration.source_version {
            return Err(EngineError::InvalidDocument(
                "manifest and document schema versions differ".into(),
            ));
        }
        let referenced_sources = referenced_step_source_hashes(&document)?;
        let mut imported_step_sources = BTreeMap::new();
        for (logical_name, descriptor) in &package.manifest().payloads {
            if descriptor.role != PayloadRole::ImportedGeometry {
                continue;
            }
            if descriptor.media_type != PayloadMediaType::Step {
                return Err(EngineError::InvalidDocument(format!(
                    "portable package payload {logical_name} is not a STEP source"
                )));
            }
            if !referenced_sources.contains_key(&descriptor.sha256) {
                return Err(EngineError::InvalidDocument(format!(
                    "portable package STEP payload {logical_name} is not referenced by the document"
                )));
            }
            let source = package.payload(logical_name).ok_or_else(|| {
                EngineError::InvalidDocument(format!(
                    "portable package STEP payload {logical_name} is missing"
                ))
            })?;
            imported_step_sources.insert(logical_name.clone(), source.to_vec());
        }
        ensure_referenced_step_sources_present(&referenced_sources, &imported_step_sources)?;

        Ok(Self {
            engine: PartEngine::from_document(document)?,
            imported_step_sources,
            timeline_rollback: TimelineRollback::End,
            diagnostics: RuntimeDiagnostics::default(),
            evaluation_sequence: 0,
        })
    }

    pub fn new_blank_part(
        document_id: impl Into<DocumentId>,
        display_name: impl Into<String>,
    ) -> Result<Self, EngineError> {
        Ok(Self {
            engine: PartEngine::new_blank_part(BlankPartCommand {
                document_id: document_id.into(),
                display_name: display_name.into(),
            })?,
            imported_step_sources: BTreeMap::new(),
            timeline_rollback: TimelineRollback::End,
            diagnostics: RuntimeDiagnostics::default(),
            evaluation_sequence: 0,
        })
    }

    /// Build the deterministic rectangular reference used by qualification and
    /// validation. User-facing New Part flows use `new_blank_part` instead.
    pub fn new_rectangular_part(
        document_id: impl Into<DocumentId>,
        display_name: impl Into<String>,
        width_nanometers: i64,
        height_nanometers: i64,
        distance_nanometers: i64,
    ) -> Result<Self, EngineError> {
        Ok(Self {
            engine: PartEngine::new_part(NewPartCommand {
                document_id: document_id.into(),
                display_name: display_name.into(),
                width_nanometers,
                height_nanometers,
                distance_nanometers,
            })?,
            imported_step_sources: BTreeMap::new(),
            timeline_rollback: TimelineRollback::End,
            diagnostics: RuntimeDiagnostics::default(),
            evaluation_sequence: 0,
        })
    }

    pub fn document_json(&self) -> Result<String, EngineError> {
        String::from_utf8(self.engine.canonical_document_bytes()?)
            .map_err(|error| EngineError::Serialization(error.to_string()))
    }

    pub fn semantic_hash(&self) -> Result<String, EngineError> {
        self.engine.semantic_hash()
    }

    /// Evaluate an offset-plane edit against an isolated candidate document.
    /// The accepted document, hash, and undo/redo stacks remain unchanged.
    pub fn preview_offset_construction_plane_json(
        &self,
        request_json: &str,
    ) -> Result<String, EngineError> {
        let request: OffsetConstructionPlaneRequest = serde_json::from_str(request_json)
            .map_err(|error| EngineError::Serialization(error.to_string()))?;
        let accepted_document_hash = self.semantic_hash()?;
        let changes = offset_construction_plane_changes(self.engine.document(), &request)?;
        let mut candidate = PartEngine::from_document(self.engine.document().clone())?;
        candidate.commit_changes(request.transaction_id.clone(), changes)?;
        let plane = candidate
            .document()
            .construction_planes
            .get(&request.plane_id)
            .ok_or_else(|| {
                EngineError::InvalidDocument(format!(
                    "construction plane {} was not created",
                    request.plane_id.0
                ))
            })?;
        let frame = (!plane.suppressed)
            .then(|| {
                construction_plane_frame(
                    candidate.document(),
                    &request.plane_id,
                    "Offset plane preview",
                )
            })
            .transpose()?;
        serde_json::to_string(&serde_json::json!({
            "accepted": true,
            "accepted_document_hash": accepted_document_hash,
            "plane": plane,
            "frame": frame,
        }))
        .map_err(|error| EngineError::Serialization(error.to_string()))
    }

    /// Atomically create or edit an origin-offset construction plane and its
    /// signed length parameter. Candidate validation, including exact frame
    /// overflow checks, completes before accepted state is replaced.
    pub fn commit_offset_construction_plane_json(
        &mut self,
        request_json: &str,
    ) -> Result<String, EngineError> {
        let request: OffsetConstructionPlaneRequest = serde_json::from_str(request_json)
            .map_err(|error| EngineError::Serialization(error.to_string()))?;
        let changes = offset_construction_plane_changes(self.engine.document(), &request)?;

        let mut candidate = PartEngine::from_document(self.engine.document().clone())?;
        candidate.commit_changes(request.transaction_id.clone(), changes.clone())?;
        if !request.suppressed {
            construction_plane_frame(
                candidate.document(),
                &request.plane_id,
                "Offset plane commit",
            )?;
        }

        let changes = if request.suppressed {
            changes
        } else {
            append_construction_plane_recompute_results(self.engine.document(), &request, changes)?
        };
        let mut candidate = PartEngine::from_document(self.engine.document().clone())?;
        candidate.commit_changes(request.transaction_id.clone(), changes.clone())?;

        self.engine
            .commit_changes(request.transaction_id.clone(), changes)?;
        let document = self.engine.document();
        let plane = document
            .construction_planes
            .get(&request.plane_id)
            .expect("validated construction plane commit inserted its definition");
        let frame = (!plane.suppressed)
            .then(|| construction_plane_frame(document, &request.plane_id, "Offset plane commit"))
            .transpose()?;
        let transaction = document.transactions.last().ok_or_else(|| {
            EngineError::InvalidDocument("construction-plane transaction was not recorded".into())
        })?;
        serde_json::to_string(&serde_json::json!({
            "accepted": true,
            "document_hash": self.semantic_hash()?,
            "document_json": self.document_json()?,
            "plane": plane,
            "frame": frame,
            "transaction": transaction,
        }))
        .map_err(|error| EngineError::Serialization(error.to_string()))
    }

    /// Resolve one accepted, unsuppressed construction plane into an exact
    /// right-handed world-space frame.
    pub fn construction_plane_frame_json(&self, plane_id: &str) -> Result<String, EngineError> {
        let plane_id = ConstructionPlaneId::from(plane_id);
        let plane = self
            .engine
            .document()
            .construction_planes
            .get(&plane_id)
            .ok_or_else(|| {
                EngineError::InvalidDocument(format!(
                    "missing_construction_plane_support at extrude.support: referenced entity {} is missing",
                    plane_id.0
                ))
            })?;
        let frame = construction_plane_frame(
            self.engine.document(),
            &plane_id,
            "Construction plane query",
        )?;
        serde_json::to_string(&serde_json::json!({ "plane": plane, "frame": frame }))
            .map_err(|error| EngineError::Serialization(error.to_string()))
    }

    /// Retain an exact STEP source for the next portable save. The returned
    /// SHA-256 is the stable provenance key persisted by STEP import results.
    /// Sources not referenced by accepted document history are never emitted.
    pub fn retain_imported_step_source(&mut self, source_bytes: &[u8]) -> String {
        let sha256 = sha256_hex(source_bytes);
        if !self
            .imported_step_sources
            .values()
            .any(|existing| sha256_hex(existing) == sha256)
        {
            self.imported_step_sources
                .insert(format!("source-step-{sha256}"), source_bytes.to_vec());
        }
        sha256
    }

    /// Return the exact retained source matching persisted STEP provenance.
    pub fn imported_step_source(&self, source_sha256: &str) -> Option<&[u8]> {
        self.imported_step_sources
            .values()
            .find(|source| sha256_hex(source) == source_sha256)
            .map(Vec::as_slice)
    }

    /// Save the complete accepted semantic document as a byte-stable portable
    /// `.crawlerpart` ZIP. Runtime history, camera, selection, and caches are not
    /// part of the authoritative document and therefore are not serialized.
    pub fn export_portable_package(&self) -> Result<Vec<u8>, EngineError> {
        let document = self.engine.document();
        let document_bytes = self.engine.canonical_document_bytes()?;
        let referenced_sources = referenced_step_source_hashes(document)?;
        ensure_referenced_step_sources_present(&referenced_sources, &self.imported_step_sources)?;
        let descriptor = PayloadDescriptor::from_bytes(
            PayloadRole::SemanticDocument,
            PayloadMediaType::CrawlerDocumentJson,
            &document_bytes,
        );
        let mut descriptors = BTreeMap::from([("document".into(), descriptor)]);
        let mut payloads = BTreeMap::from([("document".into(), document_bytes)]);
        for (logical_name, source) in &self.imported_step_sources {
            let descriptor = PayloadDescriptor::from_bytes(
                PayloadRole::ImportedGeometry,
                PayloadMediaType::Step,
                source,
            );
            if referenced_sources.contains_key(&descriptor.sha256) {
                descriptors.insert(logical_name.clone(), descriptor);
                payloads.insert(logical_name.clone(), source.clone());
            }
        }
        let manifest = PackageManifest {
            format_version: PackageFormatVersion::V1,
            package_id: format!("package:{}", document.id.0),
            document_kind: DocumentKind::Part,
            document_schema_version: document.schema_version.get(),
            required_features: BTreeSet::from(["document.core".to_owned()]),
            root_payload: "document".into(),
            payloads: descriptors,
        };
        PortablePackage::from_payloads(manifest, payloads)
            .and_then(|package| package.to_archive_bytes())
            .map_err(package_error)
    }

    pub fn dimensions(&self) -> Result<PartDimensions, EngineError> {
        self.engine.dimensions()
    }

    pub fn dimensions_json(&self) -> Result<String, EngineError> {
        let document = self.engine.document();
        let has_reference_dimensions = [
            crawler_part_engine::WIDTH_PARAMETER_ID,
            crawler_part_engine::HEIGHT_PARAMETER_ID,
            crawler_part_engine::DISTANCE_PARAMETER_ID,
        ]
        .into_iter()
        .all(|id| document.parameters.contains_key(&ParameterId::from(id)));
        let value = if has_reference_dimensions {
            Some(dimensions_json(self.dimensions()?))
        } else {
            None
        };
        serde_json::to_string(&value).map_err(|error| EngineError::Serialization(error.to_string()))
    }

    pub fn commit_length(
        &mut self,
        parameter_id: impl Into<ParameterId>,
        value_nanometers: i64,
    ) -> Result<String, EngineError> {
        let parameter_id = parameter_id.into();
        let accepted_document = self.document_json()?;
        let mut staged = Self::from_document_json(&accepted_document)?;
        staged.timeline_rollback = self.timeline_rollback.clone();
        let outcome = staged.engine.commit(vec![ParameterEdit::length(
            parameter_id.clone(),
            value_nanometers,
        )])?;
        let transaction_id = staged
            .engine
            .document()
            .transactions
            .last()
            .expect("a successful parameter commit records its transaction")
            .id
            .clone();

        // PartEngine owns base-parameter validation and dependency planning,
        // but advanced body snapshots are evaluated by this runtime. Execute
        // the reported transitive branch against an isolated candidate, then
        // accept the parameter and every real kernel result together so the
        // public commit remains one atomic undo step.
        let recompute: serde_json::Value = serde_json::from_str(
            &staged.recompute_from_here_json(crawler_part_engine::EXTRUDE_FEATURE_ID)?,
        )
        .map_err(|error| EngineError::Serialization(error.to_string()))?;
        if recompute["accepted"] != true {
            return Err(EngineError::InvalidDocument(format!(
                "transitive parameter recompute refused: {}",
                recompute
                    .get("error")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null)
            )));
        }
        let accepted_results = staged
            .engine
            .document()
            .transactions
            .last()
            .into_iter()
            .flat_map(|transaction| transaction.changes.iter())
            .filter(|change| matches!(change, DocumentChange::AcceptFeatureResult { .. }))
            .cloned()
            .collect::<Vec<_>>();
        let mut changes = vec![DocumentChange::SetParameterValue {
            parameter: parameter_id,
            value: ParameterValue::LengthNanometers(value_nanometers),
        }];
        changes.extend(accepted_results);
        let started = EvaluationTimer::start();
        self.engine.commit_changes(transaction_id, changes)?;
        self.record_evaluation_timing(
            &outcome.plan.evaluation_order,
            started.elapsed_microseconds(),
        );
        let after_hash = self.semantic_hash()?;
        let dimensions = self.dimensions()?;
        serde_json::to_string(&serde_json::json!({
            "base_revision": outcome.base_revision,
            "result_revision": outcome.result_revision,
            "before_hash": outcome.before_hash,
            "after_hash": after_hash,
            "dirty_roots": outcome.plan.dirty_roots.into_iter().map(|id| id.0).collect::<Vec<_>>(),
            "evaluation_order": outcome.plan.evaluation_order.into_iter().map(|id| id.0).collect::<Vec<_>>(),
            "dimensions": dimensions_json(dimensions),
        }))
        .map_err(|error| EngineError::Serialization(error.to_string()))
    }

    /// Evaluate an Extrude distance through an isolated runtime and return its
    /// real render packet without changing the accepted document, hash, or
    /// history owned by this runtime.
    pub fn preview_extrude_json(
        &self,
        value_nanometers: i64,
        tolerance: f64,
    ) -> Result<String, EngineError> {
        let accepted_document_hash = self.semantic_hash()?;
        let accepted_document = self.document_json()?;
        let mut candidate = Self::from_document_json(&accepted_document)?;
        candidate.commit_length("parameter:distance", value_nanometers)?;
        let candidate_document_hash = candidate.semantic_hash()?;
        let render =
            serde_json::from_str::<serde_json::Value>(&candidate.render_packet_json(tolerance)?)
                .map_err(|error| EngineError::Serialization(error.to_string()))?;

        if self.semantic_hash()? != accepted_document_hash
            || self.document_json()? != accepted_document
        {
            return Err(EngineError::InvalidDocument(
                "Extrude preview mutated the accepted runtime".into(),
            ));
        }

        serde_json::to_string(&serde_json::json!({
            "accepted_document_hash": accepted_document_hash,
            "candidate_document_hash": candidate_document_hash,
            "distance_nanometers": value_nanometers,
            "render": render,
        }))
        .map_err(|error| EngineError::Serialization(error.to_string()))
    }

    /// Preview an accepted sketch profile as a real kernel Extrude without
    /// mutating the document or its undo history.
    pub fn preview_sketch_extrude_json(&self, request_json: &str) -> Result<String, EngineError> {
        let request: SketchExtrudeRequest = serde_json::from_str(request_json)
            .map_err(|error| EngineError::Serialization(error.to_string()))?;
        let accepted_document_hash = self.semantic_hash()?;
        let feature_request = match self.sketch_extrude_feature_request(&request) {
            Ok(request) => request,
            Err(error) if request.result_mode == SketchExtrudeResultMode::Cut => {
                return cut_sketch_extrude_refusal_json(
                    &error.to_string(),
                    &request,
                    accepted_document_hash,
                    true,
                );
            }
            Err(error) => return Err(error),
        };
        let result = match self.execute_feature_with_extent_edit(&feature_request) {
            Ok(result) => result,
            Err(error) if request.result_mode == SketchExtrudeResultMode::Cut => {
                return cut_feature_refusal_json(
                    error,
                    request.target_body_id.as_deref(),
                    accepted_document_hash,
                    true,
                );
            }
            Err(error) => return Err(EngineError::InvalidDocument(error.to_string())),
        };
        let render = packet_value(
            Some(&result.output.body_id),
            Some(packet_for_snapshot(&result.output, request.tolerance)?),
        );
        if self.semantic_hash()? != accepted_document_hash {
            return Err(EngineError::InvalidDocument(
                "Sketch Extrude preview mutated the accepted runtime".into(),
            ));
        }
        serde_json::to_string(&serde_json::json!({
            "accepted": true,
            "accepted_document_hash": accepted_document_hash,
            "distance_nanometers": request.distance_nanometers,
            "direction": request.direction,
            "result_mode": request.result_mode,
            "target_body_id": request.target_body_id,
            "render": render,
        }))
        .map_err(|error| EngineError::Serialization(error.to_string()))
    }

    /// Execute and durably accept the first closed profile in an accepted
    /// sketch as a new parametric Extrude feature and body.
    pub fn commit_sketch_extrude_json(
        &mut self,
        request_json: &str,
    ) -> Result<String, EngineError> {
        let request: SketchExtrudeRequest = serde_json::from_str(request_json)
            .map_err(|error| EngineError::Serialization(error.to_string()))?;
        let before_hash = self.semantic_hash()?;
        let transaction_id = match request.transaction_id.clone() {
            Some(transaction) => transaction,
            None if request.result_mode == SketchExtrudeResultMode::Cut => {
                return cut_runtime_refusal_json(
                    "Cut Extrude commit requires transaction_id",
                    request.target_body_id.as_deref(),
                    before_hash,
                    false,
                );
            }
            None => {
                return Err(EngineError::InvalidDocument(
                    "Sketch Extrude commit requires transaction_id".into(),
                ));
            }
        };
        let feature_request = match self.sketch_extrude_feature_request(&request) {
            Ok(request) => request,
            Err(error) if request.result_mode == SketchExtrudeResultMode::Cut => {
                return cut_sketch_extrude_refusal_json(
                    &error.to_string(),
                    &request,
                    before_hash,
                    false,
                );
            }
            Err(error) => return Err(error),
        };
        let accepted_profile = self.accepted_planar_sketch_profile(
            &request.sketch,
            &request.support,
            &request.profile_geometry_ids,
            "Extrude",
        )?;
        let sketch_id = crawler_document::SketchId(request.sketch.id.clone());
        let sketch_feature = self
            .engine
            .document()
            .features
            .values()
            .find(|feature| {
                feature.operation.schema_id == "crawler.operation.sketch"
                    && feature
                        .inputs
                        .values()
                        .any(|input| input == &FeatureInput::Sketch(sketch_id.clone()))
            })
            .map(|feature| feature.id.clone())
            .ok_or_else(|| {
                EngineError::InvalidDocument("Extrude profile sketch has no durable feature".into())
            })?;
        let parameter_id = ParameterId(format!("parameter:{}:distance", request.feature_id));
        let support = durable_planar_support(&request.support)?;
        let topology_support = match &support {
            PlanarSupportReferenceV2::TopologyFace { reference } => Some(reference.clone()),
            _ => None,
        };
        let profile_reference = ProfileReferenceV2::SketchRegion {
            sketch: sketch_id.clone(),
            region: RegionReferenceId(accepted_profile.region_id.clone()),
        };
        let feature_definition_v2 = match request.result_mode {
            SketchExtrudeResultMode::NewBody => {
                FeatureDefinitionV2::exact_blind_new_body_extrude_with_direction(
                    profile_reference,
                    support.clone(),
                    parameter_id.clone(),
                    request.direction,
                    BodyId(request.body_id.clone()),
                )
            }
            SketchExtrudeResultMode::Cut => {
                let target_body_id = request.target_body_id.as_deref().ok_or_else(|| {
                    EngineError::InvalidDocument(
                        "Cut Extrude requires one explicit target_body_id".into(),
                    )
                })?;
                FeatureDefinitionV2::exact_blind_cut_extrude_with_direction(
                    profile_reference,
                    support.clone(),
                    parameter_id.clone(),
                    request.direction,
                    BodyId(target_body_id.into()),
                )
            }
        };
        let region_definition_v2 = RegionDefinitionV2 {
            id: RegionReferenceId(accepted_profile.region_id.clone()),
            sketch: sketch_id.clone(),
            outer_geometry_ids: accepted_profile.outer_geometry.clone(),
            hole_geometry_ids: accepted_profile.hole_geometry.clone(),
        };
        let mut dependencies = vec![sketch_feature];
        let mut inputs =
            BTreeMap::from([("profile".into(), FeatureInput::Sketch(sketch_id.clone()))]);
        if let Some(reference_id) = topology_support {
            let reference = self
                .engine
                .document()
                .topology_references
                .get(&reference_id)
                .ok_or_else(|| {
                    EngineError::InvalidDocument(format!(
                        "missing_topology_face_support at extrude.support: referenced entity {} is missing",
                        reference_id.0
                    ))
                })?;
            dependencies.push(reference.producer.clone());
            dependencies.sort();
            dependencies.dedup();
            inputs.insert("support".into(), FeatureInput::Topology(reference_id));
        }
        if request.result_mode == SketchExtrudeResultMode::Cut {
            let target_body_id = request.target_body_id.as_deref().expect("validated above");
            let (_, target_producer) = self.cut_target_source(
                target_body_id,
                &request.feature_id,
                &sketch_id,
                &request.support,
                "Cut Extrude",
            )?;
            dependencies.push(target_producer);
            dependencies.sort();
            dependencies.dedup();
            inputs.insert(
                "target".into(),
                FeatureInput::Body(BodyId(target_body_id.into())),
            );
        }
        let feature = Feature {
            id: FeatureId(request.feature_id.clone()),
            display_name: if request.result_mode == SketchExtrudeResultMode::Cut {
                "Extrude Cut".into()
            } else {
                "Extrude".into()
            },
            component: self.engine.document().root_component.clone(),
            operation: crawler_document::OperationReference {
                schema_id: "crawler.part.extrude".into(),
                schema_version: 1,
            },
            dependencies,
            inputs,
            parameters: BTreeMap::from([("distance".into(), parameter_id.clone())]),
            suppressed: false,
        };
        let is_edit = self.engine.document().features.contains_key(&feature.id);
        if is_edit {
            let existing = self
                .engine
                .document()
                .feature_definitions_v2
                .get(&feature.id)
                .ok_or_else(|| {
                    EngineError::InvalidDocument(
                        "Extrude edit requires its durable V2 definition".into(),
                    )
                })?;
            let same_result_mode = matches!(
                (&existing.result, request.result_mode),
                (
                    crawler_document::FeatureResultV2::NewBody { .. },
                    SketchExtrudeResultMode::NewBody
                ) | (
                    crawler_document::FeatureResultV2::Cut,
                    SketchExtrudeResultMode::Cut
                )
            );
            if !same_result_mode {
                return Err(EngineError::InvalidDocument(
                    "Extrude edit cannot change its durable result mode".into(),
                ));
            }
            if request.result_mode == SketchExtrudeResultMode::Cut
                && existing
                    .participant_bodies
                    .first()
                    .map(|participant| participant.body.0.as_str())
                    != request.target_body_id.as_deref()
            {
                return Err(EngineError::InvalidDocument(
                    "Cut Extrude edit cannot replace its explicit target body".into(),
                ));
            }
        }
        let envelope = serde_json::json!({
            "transaction_id": transaction_id,
            "feature": feature,
            "parameter_definitions": [{
                "id": parameter_id,
                "display_name": "Distance",
                "value": { "kind": "length_nanometers", "value": request.distance_nanometers }
            }],
            "before": null,
            "region_definition_v2": region_definition_v2,
            "feature_definition_v2": feature_definition_v2,
            "request": feature_request,
        });
        let response = if is_edit {
            self.execute_feature_json(&envelope.to_string())
        } else {
            self.execute_new_feature_json(&envelope.to_string())
        }?;
        if request.result_mode == SketchExtrudeResultMode::Cut {
            add_cut_code_to_refusal_json(&response, request.target_body_id.as_deref())
        } else {
            Ok(response)
        }
    }

    /// Validate the array-valued Cut target selection before constructing the
    /// scalar kernel request. This is the command-layer authority boundary:
    /// zero, duplicate, and multiple targets are refused without inference.
    pub fn validate_single_target_cut_targets_json(
        &self,
        request_json: &str,
    ) -> Result<String, EngineError> {
        #[derive(serde::Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Request {
            target_body_ids: Vec<String>,
            target_component_id: String,
            #[serde(default)]
            support_body_id: Option<String>,
            #[serde(default)]
            support_producer_id: Option<String>,
        }
        let request: Request = serde_json::from_str(request_json)
            .map_err(|error| EngineError::Serialization(error.to_string()))?;
        let document_hash = self.semantic_hash()?;
        let target = request.target_body_ids.first().map(String::as_str);
        if request.target_body_ids.len() != 1 {
            return cut_runtime_refusal_json(
                "Cut Extrude requires one explicit target_body_id",
                target,
                document_hash,
                false,
            );
        }
        let body_id = target.expect("exactly one target checked above");
        if request.target_component_id != self.engine.document().root_component.0 {
            return cut_runtime_refusal_json(
                "wrong_component_cut_target at target: target belongs to another component",
                Some(body_id),
                document_hash,
                false,
            );
        }
        let body = match self.engine.document().bodies.get(&BodyId::from(body_id)) {
            Some(body) => body,
            None => {
                return cut_runtime_refusal_json(
                    "missing_cut_target at target: target body is missing",
                    Some(body_id),
                    document_hash,
                    false,
                );
            }
        };
        if body.component.0 != request.target_component_id {
            return cut_runtime_refusal_json(
                "wrong_component_cut_target at target: target body component differs",
                Some(body_id),
                document_hash,
                false,
            );
        }
        let producer = self
            .engine
            .document()
            .features
            .get(&body.generated_by)
            .ok_or_else(|| EngineError::InvalidDocument("target producer is missing".into()))?;
        if producer.suppressed {
            return cut_runtime_refusal_json(
                "suppressed_cut_target at target: target producer is suppressed",
                Some(body_id),
                document_hash,
                false,
            );
        }
        if !feature_is_clean_at_accepted_revision(self.engine.document(), &producer.id) {
            return cut_runtime_refusal_json(
                "stale_cut_target at target: target producer is not clean",
                Some(body_id),
                document_hash,
                false,
            );
        }
        if request
            .support_body_id
            .as_deref()
            .is_some_and(|id| id != body_id)
            || request
                .support_producer_id
                .as_deref()
                .is_some_and(|producer| !body.accepts_producer(&FeatureId::from(producer)))
        {
            return cut_runtime_refusal_json(
                "wrong_owner_cut_target at target: planar-face support has another owner",
                Some(body_id),
                document_hash,
                false,
            );
        }
        serde_json::to_string(&serde_json::json!({
            "accepted": true,
            "result_mode": "cut",
            "target_body_id": body_id,
            "document_hash": document_hash,
        }))
        .map_err(|error| EngineError::Serialization(error.to_string()))
    }

    fn sketch_extrude_feature_request(
        &self,
        request: &SketchExtrudeRequest,
    ) -> Result<FeatureRequest, EngineError> {
        if request.distance_nanometers <= 0 {
            return Err(EngineError::InvalidDocument(
                "Extrude distance must be greater than zero".into(),
            ));
        }
        let profile = self.accepted_planar_sketch_profile(
            &request.sketch,
            &request.support,
            &request.profile_geometry_ids,
            "Extrude",
        )?;
        let native_input = exact_blind_extrude_input(
            profile
                .native_region
                .map_err(EngineError::InvalidDocument)?,
            profile.normal_millionths,
            request.distance_nanometers,
            request.direction,
            10_000,
        )?;
        let operation = match request.result_mode {
            SketchExtrudeResultMode::NewBody => {
                if request.target_body_id.is_some() {
                    return Err(EngineError::InvalidDocument(
                        "New Body Extrude cannot contain target_body_id".into(),
                    ));
                }
                FeatureOperation::NativeExtrudeV2(native_input)
            }
            SketchExtrudeResultMode::Cut => {
                let target_body_id = request.target_body_id.as_deref().ok_or_else(|| {
                    EngineError::InvalidDocument(
                        "Cut Extrude requires one explicit target_body_id".into(),
                    )
                })?;
                if request.body_id != target_body_id {
                    return Err(EngineError::InvalidDocument(
                        "Cut Extrude must retain target_body_id as body_id".into(),
                    ));
                }
                let (target, _) = self.cut_target_source(
                    target_body_id,
                    &request.feature_id,
                    &crawler_document::SketchId(request.sketch.id.clone()),
                    &request.support,
                    "Cut Extrude",
                )?;
                FeatureOperation::NativeExtrudeCutV2(NativeExtrudeCutInputV2 {
                    target,
                    region: native_input.region,
                    direction_nm: native_input.direction_nm,
                    tolerance_nm: native_input.tolerance_nm,
                })
            }
        };
        Ok(FeatureRequest {
            schema_version: crawler_feature_kernel::FEATURE_KERNEL_SCHEMA_VERSION,
            document_id: self.engine.document().id.0.clone(),
            feature_id: request.feature_id.clone(),
            output_body_id: request.body_id.clone(),
            operation,
        })
    }

    fn execute_feature_with_extent_edit(
        &self,
        request: &FeatureRequest,
    ) -> Result<FeatureResult, FeatureError> {
        let feature = FeatureId(request.feature_id.clone());
        if self.engine.document().features.contains_key(&feature)
            && let Ok(Some(previous_request)) =
                latest_kernel_request(self.engine.document(), &feature)
            && let (
                FeatureOperation::NativeExtrudeV2(current),
                FeatureOperation::NativeExtrudeV2(previous),
            ) = (&request.operation, &previous_request.operation)
        {
            let changed_axes = (0..3)
                .filter(|axis| {
                    current.direction_nm[*axis] != 0 || previous.direction_nm[*axis] != 0
                })
                .count();
            if current.region == previous.region
                && current.tolerance_nm == previous.tolerance_nm
                && changed_axes == 1
                && let Ok(Some(previous_body)) = latest_accepted_body_snapshot(
                    self.engine.document(),
                    &feature,
                    &previous_request.output_body_id,
                )
                && let Ok(result) =
                    execute_native_extrude_extent_edit(request, &previous_request, &previous_body)
            {
                return Ok(result);
            }
        }
        execute_feature(request)
    }

    /// Resolve an accepted sketch into world-space closed polygons plus its
    /// stable plane frame. Revolve, Loft, and Sweep adapters can share this
    /// contract rather than each inventing profile sampling and support
    /// validation. It intentionally returns no kernel-operation-specific DTO.
    fn accepted_planar_sketch_profile(
        &self,
        sketch: &crawler_sketch::Sketch,
        support: &crawler_document::SketchSupport,
        profile_geometry_ids: &[crawler_sketch::GeometryId],
        operation_name: &str,
    ) -> Result<AcceptedPlanarSketchProfile, EngineError> {
        let sketch_id = crawler_document::SketchId(sketch.id.clone());
        let accepted = self
            .engine
            .document()
            .sketches
            .get(&sketch_id)
            .ok_or_else(|| {
                EngineError::InvalidDocument(format!(
                    "{operation_name} sketch {} is not accepted",
                    sketch.id
                ))
            })?;
        // Resolve the requested support first so a missing, suppressed, or
        // invalid construction-plane dependency retains its stable typed
        // diagnostic instead of being collapsed into a generic DTO mismatch.
        let frame = self.sketch_plane_frame_authoritative(support, operation_name)?;
        if let crawler_document::SketchSupport::Topology { reference } = support {
            self.validate_topology_support_component(
                reference,
                &accepted.component,
                operation_name,
            )?;
        }
        if &accepted.support != support {
            return Err(EngineError::InvalidDocument(format!(
                "{operation_name} sketch support differs from the accepted document"
            )));
        }
        // The accepted document is authoritative. Requests may have been
        // assembled from an editor DTO that became stale after another sketch
        // acceptance; never validate or generate a feature from that DTO.
        let accepted_profile_sketch = document_sketch_profile_geometry(accepted);
        let region_report = accepted_profile_sketch.region_report();
        let selected_region = if profile_geometry_ids.is_empty() {
            if !region_report.diagnostics.is_empty() {
                return Err(EngineError::InvalidDocument(format!(
                    "{operation_name} profile is open or branched; close the sketch profile or select one material region explicitly"
                )));
            }
            if region_report.regions.len() != 1 {
                return Err(EngineError::InvalidDocument(format!(
                    "{operation_name} requires one unambiguous closed material region; select a region explicitly"
                )));
            }
            region_report.regions.first()
        } else {
            let mut requested = profile_geometry_ids.to_vec();
            requested.sort();
            requested.dedup();
            if requested.len() != profile_geometry_ids.len()
                || !region_report
                    .regions
                    .iter()
                    .any(|region| region.outer == requested)
            {
                return Err(EngineError::InvalidDocument(format!(
                    "{operation_name} selected profile is stale or no longer closed, bounds a hole, or no longer bounds a material region; select the region again"
                )));
            }
            region_report
                .regions
                .iter()
                .find(|region| region.outer == requested)
        };
        let selected_region = selected_region.ok_or_else(|| {
            EngineError::InvalidDocument(format!(
                "{operation_name} selected material region is unavailable"
            ))
        })?;
        let selected = selected_region
            .outer
            .iter()
            .chain(selected_region.holes.iter().flatten())
            .cloned()
            .collect::<std::collections::BTreeSet<_>>();
        let mut selected_sketch = accepted_profile_sketch.clone();
        for (id, entity) in &mut selected_sketch.geometry {
            if !selected.contains(id) {
                entity.construction = true;
            }
        }
        let profile_sketch = &selected_sketch;
        let native_region = native_profile_region(
            profile_sketch,
            &selected_region.outer,
            &selected_region.holes,
            frame.x_axis_millionths,
            frame.y_axis_millionths,
        )
        .and_then(|region| translate_native_profile_region(region, frame.origin_nanometers))
        .map_err(|error| error.to_string());
        let profiles_nm = sketch_profile_polygons(profile_sketch, operation_name)?
            .into_iter()
            .map(|profile| {
                profile
                    .into_iter()
                    .map(|point| plane_point_world_nm(point, &frame))
                    .collect::<Result<Vec<_>, _>>()
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(AcceptedPlanarSketchProfile {
            profiles_nm,
            native_region,
            region_id: selected_region.id.clone(),
            outer_geometry: selected_region
                .outer
                .iter()
                .map(|id| id.0.clone())
                .collect(),
            hole_geometry: selected_region
                .holes
                .iter()
                .map(|boundary| boundary.iter().map(|id| id.0.clone()).collect())
                .collect(),
            x_axis_millionths: frame.x_axis_millionths,
            y_axis_millionths: frame.y_axis_millionths,
            normal_millionths: frame.normal_millionths,
        })
    }

    fn sketch_feature_producer(
        &self,
        sketch_id: &crawler_document::SketchId,
        operation_name: &str,
    ) -> Result<FeatureId, EngineError> {
        self.engine
            .document()
            .features
            .values()
            .find(|feature| {
                !feature.suppressed
                    && feature.operation.schema_id == "crawler.operation.sketch"
                    && feature
                        .inputs
                        .values()
                        .any(|input| input == &FeatureInput::Sketch(sketch_id.clone()))
            })
            .map(|feature| feature.id.clone())
            .ok_or_else(|| {
                EngineError::InvalidDocument(format!(
                    "{operation_name} sketch {} has no durable feature",
                    sketch_id.0
                ))
            })
    }

    fn accepted_body_source(
        &self,
        body_id: &str,
        operation_name: &str,
    ) -> Result<(BodySnapshot, FeatureId), EngineError> {
        let document = self.engine.document();
        let body = document.bodies.get(&BodyId::from(body_id)).ok_or_else(|| {
            EngineError::InvalidDocument(format!(
                "missing_cut_target at target: {operation_name} target body {body_id} is missing"
            ))
        })?;
        let producer = document.features.get(&body.generated_by).ok_or_else(|| {
            EngineError::InvalidDocument(format!(
                "missing_cut_target_producer at target: {operation_name} target body {body_id} has no producer"
            ))
        })?;
        if producer.suppressed {
            return Err(EngineError::InvalidDocument(format!(
                "suppressed_cut_target at target: {operation_name} target body {body_id} producer {} is suppressed",
                producer.id.0
            )));
        }
        if !feature_is_clean_at_accepted_revision(document, &producer.id) {
            return Err(EngineError::InvalidDocument(format!(
                "stale_cut_target at target: {operation_name} target body {body_id} producer {} is not clean at accepted revision {}",
                producer.id.0, document.revision
            )));
        }
        let value: serde_json::Value = serde_json::from_str(&self.body_snapshot_json(body_id)?)
            .map_err(|error| EngineError::Serialization(error.to_string()))?;
        if value["found"] != true {
            return Err(EngineError::InvalidDocument(format!(
                "{operation_name} target body {body_id} is not accepted"
            )));
        }
        let snapshot = serde_json::from_value(value["body"].clone())
            .map_err(|error| EngineError::Serialization(error.to_string()))?;
        let feature = serde_json::from_value(value["feature_id"].clone())
            .map_err(|error| EngineError::Serialization(error.to_string()))?;
        Ok((snapshot, feature))
    }

    fn cut_target_source(
        &self,
        body_id: &str,
        cut_feature_id: &str,
        sketch_id: &crawler_document::SketchId,
        support: &crawler_document::SketchSupport,
        operation_name: &str,
    ) -> Result<(BodySnapshot, FeatureId), EngineError> {
        let document = self.engine.document();
        let source = if let Some(cut_feature) =
            document.features.get(&FeatureId::from(cut_feature_id))
        {
            let mut source = None;
            for dependency in &cut_feature.dependencies {
                if let Some(snapshot) =
                    latest_accepted_body_snapshot(document, dependency, body_id)?
                {
                    source = Some((snapshot, dependency.clone()));
                    break;
                }
                if dependency.0 == crawler_part_engine::EXTRUDE_FEATURE_ID
                    && body_id == crawler_part_engine::BODY_ID
                {
                    // The parameter-driven base Extrude predates journaled
                    // FeatureResult snapshots. Reconstruct its exact accepted
                    // body rather than feeding the Cut's current output back
                    // into its own edit.
                    source = Some((self.base_body_snapshot()?, dependency.clone()));
                    break;
                }
            }
            source.ok_or_else(|| {
                EngineError::InvalidDocument(format!(
                    "missing_cut_target at target: {operation_name} cannot recover the pre-Cut target snapshot {body_id}"
                ))
            })?
        } else {
            self.accepted_body_source(body_id, operation_name)?
        };
        let sketch = document.sketches.get(sketch_id).ok_or_else(|| {
            EngineError::InvalidDocument(format!(
                "missing_cut_profile at profile: {operation_name} sketch {} is missing",
                sketch_id.0
            ))
        })?;
        let body = document.bodies.get(&BodyId::from(body_id)).ok_or_else(|| {
            EngineError::InvalidDocument(format!(
                "missing_cut_target at target: {operation_name} target body {body_id} is missing"
            ))
        })?;
        if sketch.component != body.component {
            return Err(EngineError::InvalidDocument(format!(
                "wrong_component_cut_target at target: {operation_name} profile and target must belong to the same component"
            )));
        }
        if let crawler_document::SketchSupport::Topology { reference } = support {
            let topology = document.topology_references.get(reference).ok_or_else(|| {
                EngineError::InvalidDocument(format!(
                    "missing_topology_face_support at extrude.support: reference {} is missing",
                    reference.0
                ))
            })?;
            if topology.body.0 != body_id
                || topology.producer != source.1
                || topology.component != body.component
            {
                return Err(EngineError::InvalidDocument(format!(
                    "wrong_owner_cut_target at target: {operation_name} planar-face support must be owned by the explicit current target body and producer"
                )));
            }
        }
        Ok(source)
    }

    fn accepted_planar_sketch_path(
        &self,
        sketch: &crawler_sketch::Sketch,
        support: &crawler_document::SketchSupport,
        operation_name: &str,
    ) -> Result<Vec<[i64; 3]>, EngineError> {
        let sketch_id = crawler_document::SketchId(sketch.id.clone());
        let accepted = self
            .engine
            .document()
            .sketches
            .get(&sketch_id)
            .ok_or_else(|| {
                EngineError::InvalidDocument(format!(
                    "{operation_name} path sketch {} is not accepted",
                    sketch.id
                ))
            })?;
        let frame = self.sketch_plane_frame_authoritative(support, operation_name)?;
        if let crawler_document::SketchSupport::Topology { reference } = support {
            self.validate_topology_support_component(
                reference,
                &accepted.component,
                operation_name,
            )?;
        }
        if &accepted.support != support {
            return Err(EngineError::InvalidDocument(format!(
                "{operation_name} path support differs from the accepted document"
            )));
        }
        sketch_path_polyline(sketch, operation_name)?
            .into_iter()
            .map(|point| plane_point_world_nm(point, &frame))
            .collect()
    }

    fn validate_topology_support_component(
        &self,
        reference_id: &crawler_document::TopologyReferenceId,
        expected_component: &ComponentId,
        operation_name: &str,
    ) -> Result<(), EngineError> {
        let document = self.engine.document();
        let reference = document.topology_references.get(reference_id).ok_or_else(|| {
            EngineError::InvalidDocument(format!(
                "missing_topology_face_support at extrude.support: {operation_name} referenced entity {} is missing",
                reference_id.0
            ))
        })?;
        if reference.kind != crawler_document::TopologyKind::Face {
            return Err(EngineError::InvalidDocument(format!(
                "wrong_kind_topology_face_support at extrude.support: reference {} is not a face",
                reference_id.0
            )));
        }
        let body = document.bodies.get(&reference.body).ok_or_else(|| {
            EngineError::InvalidDocument(format!(
                "missing_topology_face_body at extrude.support: reference {} body {} is missing",
                reference_id.0, reference.body.0
            ))
        })?;
        let producer = document.features.get(&reference.producer).ok_or_else(|| {
            EngineError::InvalidDocument(format!(
                "missing_topology_face_producer at extrude.support: reference {} producer {} is missing",
                reference_id.0, reference.producer.0
            ))
        })?;
        if !body.accepts_producer(&reference.producer) {
            return Err(EngineError::InvalidDocument(format!(
                "wrong_producer_topology_face_support at extrude.support: reference {} producer {} does not own body {}",
                reference_id.0, reference.producer.0, reference.body.0
            )));
        }
        if producer.suppressed {
            return Err(EngineError::InvalidDocument(format!(
                "suppressed_topology_face_producer at extrude.support: reference {} producer {} is suppressed",
                reference_id.0, reference.producer.0
            )));
        }
        if reference.component != *expected_component
            || body.component != reference.component
            || producer.component != reference.component
        {
            return Err(EngineError::InvalidDocument(format!(
                "cross_component_topology_face_support at extrude.support: reference {} is outside component {}",
                reference_id.0, expected_component.0
            )));
        }
        if !feature_is_clean_at_accepted_revision(document, &reference.producer) {
            return Err(EngineError::InvalidDocument(format!(
                "stale_topology_face_support at extrude.support: producer {} is not clean at accepted revision {}",
                reference.producer.0, document.revision
            )));
        }
        Ok(())
    }

    fn sketch_plane_frame_authoritative(
        &self,
        support: &crawler_document::SketchSupport,
        operation_name: &str,
    ) -> Result<ResolvedPlanarFrame, EngineError> {
        let crawler_document::SketchSupport::Topology { reference } = support else {
            return sketch_plane_frame(self.engine.document(), support, operation_name);
        };
        let document = self.engine.document();
        let topology = document.topology_references.get(reference).ok_or_else(|| {
            EngineError::InvalidDocument(format!(
                "missing_topology_face_support at extrude.support: {operation_name} referenced entity {} is missing",
                reference.0
            ))
        })?;
        let body = document.bodies.get(&topology.body).ok_or_else(|| {
            EngineError::InvalidDocument(format!(
                "missing_topology_face_body at extrude.support: referenced body {} is missing",
                topology.body.0
            ))
        })?;
        self.validate_topology_support_component(reference, &body.component, operation_name)?;
        let value: serde_json::Value = serde_json::from_str(
            &self
                .planar_face_frame_json(&topology.body.0, &topology.stable_kernel_id.to_string())?,
        )
        .map_err(|error| EngineError::Serialization(error.to_string()))?;
        if value["found"] != true {
            let code = value["error"]["code"]
                .as_str()
                .unwrap_or("invalid_topology_face");
            return Err(EngineError::InvalidDocument(format!(
                "{code} at extrude.support: topology reference {} cannot resolve current planar face {} on body {}",
                reference.0, topology.stable_kernel_id, topology.body.0
            )));
        }
        if value["producer_feature_id"].as_str() != Some(&topology.producer.0) {
            return Err(EngineError::InvalidDocument(format!(
                "wrong_producer_topology_face_support at extrude.support: current body producer differs for reference {}",
                reference.0
            )));
        }
        let tuple = |field: &str| {
            serde_json::from_value::<[i64; 3]>(value["frame"][field].clone())
                .map_err(|error| EngineError::Serialization(error.to_string()))
        };
        Ok(ResolvedPlanarFrame {
            origin_nanometers: tuple("origin_nanometers")?,
            x_axis_millionths: tuple("x_axis_millionths")?,
            y_axis_millionths: tuple("y_axis_millionths")?,
            normal_millionths: tuple("normal_millionths")?,
        })
    }

    /// Enumerate every durable document parameter in stable identity order.
    /// Numeric values are evaluated from the latest structural expression in
    /// the accepted transaction journal; Boolean and text parameters remain
    /// exact document literals.
    pub fn parameters_json(&self) -> Result<String, EngineError> {
        let set = parameter_set(self.engine.document())?;
        let evaluated = set
            .evaluate_all()
            .map_err(|error| EngineError::InvalidDocument(error.to_string()))?;
        let parameters = self
            .engine
            .document()
            .parameters
            .iter()
            .map(|(id, parameter)| {
                let typed_id = NamedParameterId(id.0.clone());
                if let Some(definition) = set.parameters.get(&typed_id) {
                    let evaluated = evaluated.get(&typed_id).ok_or_else(|| {
                        EngineError::InvalidDocument(format!(
                            "parameter {} did not produce an evaluated value",
                            id.0
                        ))
                    })?;
                    Ok(serde_json::json!({
                        "id": id,
                        "name": parameter.display_name,
                        "kind": definition.kind,
                        "source": definition.expression.source,
                        "display_expression": set.display_expression(&typed_id)
                            .map_err(|error| EngineError::InvalidDocument(error.to_string()))?,
                        "evaluated_value": evaluated.value,
                    }))
                } else {
                    Ok(serde_json::json!({
                        "id": id,
                        "name": parameter.display_name,
                        "kind": document_parameter_kind(&parameter.value),
                        "source": document_literal_source(&parameter.value),
                        "display_expression": document_literal_source(&parameter.value),
                        "evaluated_value": parameter.value,
                    }))
                }
            })
            .collect::<Result<Vec<_>, EngineError>>()?;
        serde_json::to_string(&serde_json::json!({ "parameters": parameters }))
            .map_err(|error| EngineError::Serialization(error.to_string()))
    }

    /// Parse an operation field's source text, resolve names once to stable
    /// parameter IDs, evaluate exactly, and commit the complete change only if
    /// syntax, units, dependency evaluation, and document validation succeed.
    /// Expected user-input failures are returned as structured field
    /// diagnostics rather than mutating the accepted document or undo stack.
    pub fn set_field_expression_json(&mut self, request_json: &str) -> Result<String, EngineError> {
        #[derive(serde::Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Request {
            transaction_id: TransactionId,
            feature: FeatureId,
            field: String,
            source: String,
        }

        let request: Request = serde_json::from_str(request_json)
            .map_err(|error| EngineError::Serialization(error.to_string()))?;
        let before_hash = self.semantic_hash()?;
        let parameter = match self.field_parameter(&request.feature, &request.field) {
            Ok(parameter) => parameter,
            Err(message) => {
                return parameter_refusal_json(
                    parameter_diagnostic(
                        &request.field,
                        ParameterDiagnosticCode::UnknownName,
                        message,
                    ),
                    before_hash,
                );
            }
        };
        let accepted = parameter_set(self.engine.document())?;
        let typed_id = NamedParameterId(parameter.0.clone());
        let candidate = match accepted.set_expression_source(
            &typed_id,
            request.field.clone(),
            request.source,
        ) {
            Ok(candidate) => candidate,
            Err(diagnostic) => return parameter_refusal_json(diagnostic, before_hash),
        };
        let values = candidate
            .evaluate_all()
            .map_err(|error| EngineError::InvalidDocument(error.to_string()))?;
        let dependents = dependent_parameter_ids(&candidate, &typed_id);
        let mut changes = Vec::new();
        for (candidate_id, definition) in &candidate.parameters {
            let document_id = ParameterId(candidate_id.0.clone());
            let is_edited = document_id == parameter;
            let is_dependent = dependents.contains(candidate_id);
            if !is_edited && !is_dependent {
                continue;
            }
            let value = quantity_to_document(
                values
                    .get(candidate_id)
                    .expect("candidate evaluation returned every parameter")
                    .value,
            )?;
            if is_edited || self.engine.document().parameters[&document_id].value != value {
                changes.push(DocumentChange::SetParameterExpression {
                    parameter: document_id,
                    expression: expression_to_document(&definition.expression),
                    evaluated_value: value,
                });
            }
        }
        let outcome = self
            .engine
            .commit_changes(request.transaction_id, changes)?;
        let transaction: serde_json::Value = serde_json::from_str(&outcome)
            .map_err(|error| EngineError::Serialization(error.to_string()))?;
        let evaluated = values
            .get(&typed_id)
            .expect("edited parameter was evaluated");
        serde_json::to_string(&serde_json::json!({
            "accepted": true,
            "parameter": {
                "id": parameter,
                "name": self.engine.document().parameters[&parameter].display_name,
                "kind": candidate.parameters[&typed_id].kind,
                "source": candidate.parameters[&typed_id].expression.source,
                "evaluated_value": evaluated.value,
            },
            "transaction": transaction,
            "document_hash": self.semantic_hash()?,
        }))
        .map_err(|error| EngineError::Serialization(error.to_string()))
    }

    /// Rename a parameter by stable identity. Structural expression references
    /// are not rewritten because they never store the mutable display name.
    pub fn rename_parameter_json(&mut self, request_json: &str) -> Result<String, EngineError> {
        #[derive(serde::Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Request {
            transaction_id: TransactionId,
            parameter: ParameterId,
            display_name: String,
        }
        let request: Request = serde_json::from_str(request_json)
            .map_err(|error| EngineError::Serialization(error.to_string()))?;
        let before_hash = self.semantic_hash()?;
        if !self
            .engine
            .document()
            .parameters
            .contains_key(&request.parameter)
        {
            return parameter_refusal_json(
                parameter_diagnostic(
                    "display_name",
                    ParameterDiagnosticCode::UnknownName,
                    format!("parameter {} does not exist", request.parameter.0),
                ),
                before_hash,
            );
        }
        if request.display_name.trim().is_empty() {
            return parameter_refusal_json(
                parameter_diagnostic(
                    "display_name",
                    ParameterDiagnosticCode::UnexpectedToken,
                    "parameter name must not be empty",
                ),
                before_hash,
            );
        }
        let parameter = request.parameter.clone();
        let outcome = self.engine.commit_changes(
            request.transaction_id,
            vec![DocumentChange::RenameEntity {
                entity: EntityId::Parameter(request.parameter),
                display_name: request.display_name,
            }],
        )?;
        serde_json::to_string(&serde_json::json!({
            "accepted": true,
            "parameter": parameter,
            "transaction": serde_json::from_str::<serde_json::Value>(&outcome)
                .map_err(|error| EngineError::Serialization(error.to_string()))?,
            "document_hash": self.semantic_hash()?,
        }))
        .map_err(|error| EngineError::Serialization(error.to_string()))
    }

    /// Promote the field's existing stable dimensional binding, or reuse a
    /// compatible existing parameter for that field. The document model does
    /// not duplicate values: promotion keeps the current binding and may name
    /// it, while reuse edits the feature's binding structurally.
    pub fn promote_or_reuse_parameter_json(
        &mut self,
        request_json: &str,
    ) -> Result<String, EngineError> {
        #[derive(serde::Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Request {
            transaction_id: TransactionId,
            feature: FeatureId,
            field: String,
            #[serde(default)]
            parameter: Option<ParameterId>,
            #[serde(default)]
            display_name: Option<String>,
        }
        let request: Request = serde_json::from_str(request_json)
            .map_err(|error| EngineError::Serialization(error.to_string()))?;
        let before_hash = self.semantic_hash()?;
        let current = match self.field_parameter(&request.feature, &request.field) {
            Ok(parameter) => parameter,
            Err(message) => {
                return parameter_refusal_json(
                    parameter_diagnostic(
                        &request.field,
                        ParameterDiagnosticCode::UnknownName,
                        message,
                    ),
                    before_hash,
                );
            }
        };
        let target = request.parameter.unwrap_or_else(|| current.clone());
        let document = self.engine.document();
        let Some(current_value) = document.parameters.get(&current).map(|value| &value.value)
        else {
            unreachable!("field_parameter validates its binding")
        };
        let Some(target_value) = document.parameters.get(&target).map(|value| &value.value) else {
            return parameter_refusal_json(
                parameter_diagnostic(
                    &request.field,
                    ParameterDiagnosticCode::UnknownName,
                    format!("parameter {} does not exist", target.0),
                ),
                before_hash,
            );
        };
        if document_parameter_kind(current_value) != document_parameter_kind(target_value) {
            return parameter_refusal_json(
                parameter_diagnostic(
                    &request.field,
                    ParameterDiagnosticCode::KindMismatch,
                    format!(
                        "parameter {} is incompatible with field {}",
                        target.0, request.field
                    ),
                ),
                before_hash,
            );
        }
        if request
            .display_name
            .as_deref()
            .is_some_and(|name| name.trim().is_empty())
        {
            return parameter_refusal_json(
                parameter_diagnostic(
                    "display_name",
                    ParameterDiagnosticCode::UnexpectedToken,
                    "parameter name must not be empty",
                ),
                before_hash,
            );
        }
        let mut changes = Vec::new();
        if target != current {
            let mut feature = document.features[&request.feature].clone();
            feature
                .parameters
                .insert(request.field.clone(), target.clone());
            changes.push(DocumentChange::EditFeature { feature });
        }
        if let Some(display_name) = request.display_name
            && document.parameters[&target].display_name != display_name
        {
            changes.push(DocumentChange::RenameEntity {
                entity: EntityId::Parameter(target.clone()),
                display_name,
            });
        }
        let transaction = if changes.is_empty() {
            serde_json::json!({
                "before_hash": before_hash,
                "after_hash": before_hash,
                "revision": document.revision,
            })
        } else {
            serde_json::from_str::<serde_json::Value>(
                &self
                    .engine
                    .commit_changes(request.transaction_id, changes)?,
            )
            .map_err(|error| EngineError::Serialization(error.to_string()))?
        };
        serde_json::to_string(&serde_json::json!({
            "accepted": true,
            "feature": request.feature,
            "field": request.field,
            "parameter": target,
            "transaction": transaction,
            "document_hash": self.semantic_hash()?,
        }))
        .map_err(|error| EngineError::Serialization(error.to_string()))
    }

    fn field_parameter(&self, feature: &FeatureId, field: &str) -> Result<ParameterId, String> {
        let feature = self
            .engine
            .document()
            .features
            .get(feature)
            .ok_or_else(|| format!("feature {} does not exist", feature.0))?;
        feature
            .parameters
            .get(field)
            .cloned()
            .ok_or_else(|| format!("feature field {field:?} has no parameter binding"))
    }

    /// Apply a caller-owned transaction of shared durable document changes.
    pub fn commit_changes_json(&mut self, transaction_json: &str) -> Result<String, EngineError> {
        #[derive(serde::Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Request {
            transaction_id: TransactionId,
            changes: Vec<DocumentChange>,
        }
        let request: Request = serde_json::from_str(transaction_json)
            .map_err(|error| EngineError::Serialization(error.to_string()))?;
        let mut graph_state = self.graph_state()?;
        for (index, change) in request.changes.iter().enumerate() {
            let command = match change {
                DocumentChange::CreateFeature { feature, before } => {
                    Some(FeatureGraphCommand::Create {
                        feature: feature.clone(),
                        before: before.clone(),
                    })
                }
                DocumentChange::ReorderFeature {
                    feature, before, ..
                } => Some(FeatureGraphCommand::Reorder {
                    feature: feature.clone(),
                    before: before.clone(),
                }),
                DocumentChange::GroupFeatures {
                    group_id,
                    display_name,
                    features,
                } => Some(FeatureGraphCommand::Group {
                    group: FeatureGroupId(group_id.clone()),
                    display_name: display_name.clone(),
                    features: features.clone(),
                }),
                _ => None,
            };
            if let Some(command) = command {
                let commit = prepare_graph_transaction(
                    &graph_state,
                    format!("validate:{}:{index}", request.transaction_id.0),
                    command,
                )
                .and_then(|transaction| validate_graph_transaction(&graph_state, &transaction))
                .map_err(|error| EngineError::InvalidDocument(error.to_string()))?;
                graph_state = commit.after;
            }
        }
        self.engine
            .commit_changes(request.transaction_id, request.changes)
    }

    /// Move the process-local timeline cursor without creating an undo entry or
    /// mutating the accepted semantic document.
    pub fn set_timeline_rollback(&mut self, rollback_json: &str) -> Result<String, EngineError> {
        #[derive(serde::Deserialize)]
        #[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
        enum Request {
            BeforeFirst,
            After { feature: FeatureId },
            End,
        }
        self.timeline_rollback = match serde_json::from_str::<Request>(rollback_json)
            .map_err(|error| EngineError::Serialization(error.to_string()))?
        {
            Request::BeforeFirst => TimelineRollback::BeforeFirst,
            Request::After { feature } => {
                if !self.engine.document().features.contains_key(&feature) {
                    return Err(EngineError::InvalidDocument(format!(
                        "timeline feature {} is missing",
                        feature.0
                    )));
                }
                TimelineRollback::After(feature)
            }
            Request::End => TimelineRollback::End,
        };
        self.timeline_rollback_json()
    }

    pub fn timeline_rollback_json(&self) -> Result<String, EngineError> {
        let value = match &self.timeline_rollback {
            TimelineRollback::BeforeFirst => serde_json::json!({ "kind": "before_first" }),
            TimelineRollback::After(feature) => {
                serde_json::json!({ "kind": "after", "feature": feature })
            }
            TimelineRollback::End => serde_json::json!({ "kind": "end" }),
        };
        serde_json::to_string(&value).map_err(|error| EngineError::Serialization(error.to_string()))
    }

    fn graph_state(&self) -> Result<FeatureGraphDocument, EngineError> {
        FeatureGraphDocument::new(self.engine.document().clone())
            .map_err(|error| EngineError::InvalidDocument(error.to_string()))
    }

    fn graph_rollback(&self) -> RollbackPosition {
        match &self.timeline_rollback {
            TimelineRollback::BeforeFirst => RollbackPosition::BeforeFirst,
            TimelineRollback::After(feature) => RollbackPosition::After(feature.clone()),
            TimelineRollback::End => RollbackPosition::End,
        }
    }

    /// JSON-ready dependency highlights, rollback-aware timeline projection,
    /// and process-local compute timings. The query is read-only.
    pub fn feature_services_json(&self, selected: &str) -> Result<String, EngineError> {
        let state = self.graph_state()?;
        let selected = FeatureId::from(selected);
        let timeline = crawler_feature_graph::project_timeline(
            &state,
            &self.graph_rollback(),
            &self.diagnostics,
        )
        .map_err(|error| EngineError::InvalidDocument(error.to_string()))?;
        let relationships = direct_relationships(&state, &selected)
            .map_err(|error| EngineError::InvalidDocument(error.to_string()))?;
        let diagnostics = compute_diagnostics_view(&state, &self.diagnostics)
            .map_err(|error| EngineError::InvalidDocument(error.to_string()))?;
        serde_json::to_string(&serde_json::json!({
            "timeline": timeline,
            "relationships": relationships,
            "diagnostics": diagnostics,
        }))
        .map_err(|error| EngineError::Serialization(error.to_string()))
    }

    /// Re-evaluate the selected accepted kernel feature and every active
    /// downstream kernel consumer in dependency order. Refusal leaves the
    /// document unchanged; successful body results are accepted atomically in
    /// one normal undoable transaction.
    pub fn recompute_from_here_json(&mut self, selected: &str) -> Result<String, EngineError> {
        let state = self.graph_state()?;
        let selected = FeatureId::from(selected);
        let before_hash = self.semantic_hash()?;
        if self
            .engine
            .document()
            .features
            .get(&selected)
            .is_some_and(|feature| feature.suppressed)
        {
            let supports_face_branch = self
                .engine
                .document()
                .topology_references
                .values()
                .any(|reference| reference.producer == selected);
            let code = if supports_face_branch {
                "suppressed_topology_face_producer at recompute.feature"
            } else {
                "suppressed_feature_recompute at recompute.feature"
            };
            return Err(EngineError::InvalidDocument(format!(
                "{code}: feature {} is suppressed",
                selected.0
            )));
        }
        let started = EvaluationTimer::start();
        let mut plan = recompute_from_here(&state, &selected, &self.graph_rollback())
            .map_err(|error| EngineError::InvalidDocument(error.to_string()))?;
        let document = self.engine.document();
        if let Some(unresolved) = plan.required_inputs.iter().find(|feature| {
            document
                .features
                .get(*feature)
                .is_some_and(|record| record.suppressed)
        }) {
            plan.evaluation_order.clear();
            return serde_json::to_string(&serde_json::json!({
                "accepted": false,
                "error": {
                    "category": "reference",
                    "code": "suppressed_required_input",
                    "field": "recompute.required_inputs",
                    "field_path": "recompute.required_inputs",
                    "message": format!("required input {} is suppressed", unresolved.0),
                    "referenced_entity_ids": [unresolved.0.clone()],
                    "recovery": "restore or replace the first unresolved input, then recompute",
                },
                "plan": plan,
                "before_hash": before_hash,
                "document_hash": before_hash,
            }))
            .map_err(|error| EngineError::Serialization(error.to_string()));
        }
        let dirty_required: BTreeSet<_> = plan
            .required_inputs
            .iter()
            .filter(|feature| {
                matches!(
                    document.recompute.features.get(*feature),
                    Some(crawler_document::FeatureRecomputeState::Dirty { .. })
                        | Some(crawler_document::FeatureRecomputeState::Failed { .. })
                )
            })
            .cloned()
            .collect();
        let stale_required_topology = document.topology_references.values().find(|reference| {
            dirty_required.contains(&reference.producer)
                && plan.evaluation_order.iter().any(|feature_id| {
                    document.features[feature_id].inputs.values().any(
                        |input| matches!(input, FeatureInput::Topology(id) if id == &reference.id),
                    ) || document
                        .feature_definitions_v2
                        .get(feature_id)
                        .is_some_and(|definition| {
                            matches!(
                                &definition.operation,
                                crawler_document::FeatureOperationV2::Extrude {
                                    support: PlanarSupportReferenceV2::TopologyFace { reference: id },
                                    ..
                                } if id == &reference.id
                            )
                        })
                })
        });
        if let Some(reference) = stale_required_topology {
            return Err(EngineError::InvalidDocument(format!(
                "stale_topology_face_support at recompute.required_inputs: topology reference {} depends on dirty producer {}; recompute that producer explicitly before evaluating its face-supported descendants",
                reference.id.0, reference.producer.0
            )));
        }
        let mut evaluation_order = plan
            .required_inputs
            .iter()
            .filter(|feature| {
                let is_dirty = matches!(
                    document.recompute.features.get(*feature),
                    Some(crawler_document::FeatureRecomputeState::Dirty { .. })
                        | Some(crawler_document::FeatureRecomputeState::Failed { .. })
                );
                let produces_body = **feature
                    == FeatureId::from(crawler_part_engine::EXTRUDE_FEATURE_ID)
                    || document
                        .bodies
                        .values()
                        .any(|body| body.generated_by == **feature);
                is_dirty && produces_body
            })
            .cloned()
            .collect::<Vec<_>>();
        for feature in &plan.evaluation_order {
            if !evaluation_order.contains(feature) {
                evaluation_order.push(feature.clone());
            }
        }
        plan.evaluation_order = evaluation_order;
        let mut snapshots = accepted_body_snapshots(self.engine.document())?;
        let base_feature = FeatureId::from(crawler_part_engine::EXTRUDE_FEATURE_ID);
        let base_requires_evaluation = plan.evaluation_order.contains(&base_feature)
            && matches!(
                self.engine.document().recompute.features.get(&base_feature),
                Some(crawler_document::FeatureRecomputeState::Dirty { .. })
                    | Some(crawler_document::FeatureRecomputeState::Failed { .. })
            );
        if self.base_body_is_active() && !base_requires_evaluation {
            let base = self.base_body_snapshot()?;
            snapshots.insert(base.body_id.clone(), base);
        }
        let mut changes = Vec::new();
        let mut recomputed = Vec::new();
        for feature in &plan.evaluation_order {
            let stored_request = latest_kernel_request_with_snapshots(
                self.engine.document(),
                feature,
                Some(&snapshots),
            )?;
            if stored_request.is_none() && feature == &base_feature && self.base_body_is_active() {
                // The parameter-driven base feature is evaluated by
                // crawler-part-engine rather than crawler-feature-kernel. Its
                // exact current native snapshot is nevertheless accepted in
                // the same durable result envelope so downstream consumers
                // cannot read the prior stale body.
                let output = self.base_body_snapshot()?;
                let result = FeatureResult {
                    schema_version: crawler_feature_kernel::FEATURE_KERNEL_SCHEMA_VERSION,
                    document_id: self.engine.document().id.0.clone(),
                    feature_id: feature.0.clone(),
                    output: output.clone(),
                    ordered_input_body_ids: Vec::new(),
                    instance_body_ids: Vec::new(),
                };
                snapshots.insert(output.body_id.clone(), output.clone());
                changes.push(DocumentChange::AcceptFeatureResult {
                    feature: feature.clone(),
                    body: BodyId(output.body_id.clone()),
                    request_json: serde_json::to_string(&serde_json::json!({
                        "kind": "base_part_rebuild",
                        "document_id": self.engine.document().id,
                        "feature_id": feature,
                        "output_body_id": output.body_id,
                        "accepted_revision": self.engine.document().revision,
                    }))
                    .map_err(|error| EngineError::Serialization(error.to_string()))?,
                    result_json: serde_json::to_string(&result)
                        .map_err(|error| EngineError::Serialization(error.to_string()))?,
                });
                recomputed.push(serde_json::json!({
                    "feature": feature,
                    "body": output.body_id,
                }));
                continue;
            }
            let Some(stored_request) = stored_request else {
                let produces_body = self
                    .engine
                    .document()
                    .bodies
                    .values()
                    .any(|body| body.generated_by == *feature);
                if produces_body
                    && matches!(
                        self.engine.document().recompute.features.get(feature),
                        Some(crawler_document::FeatureRecomputeState::Dirty { .. })
                            | Some(crawler_document::FeatureRecomputeState::Failed { .. })
                    )
                {
                    return Err(EngineError::InvalidDocument(format!(
                        "missing_feature_recompute_authority at recompute.feature: dirty feature {} has no executable request",
                        feature.0
                    )));
                }
                continue;
            };
            let rebound_request = rebind_request_snapshots(stored_request, &snapshots)?;
            let result = match execute_feature(&rebound_request) {
                Ok(result) => result,
                Err(error) => {
                    return serde_json::to_string(&serde_json::json!({
                        "accepted": false,
                        "error": error,
                        "plan": plan,
                        "before_hash": before_hash,
                        "document_hash": before_hash,
                    }))
                    .map_err(|error| EngineError::Serialization(error.to_string()));
                }
            };
            let request_json = serde_json::to_string(&rebound_request)
                .map_err(|error| EngineError::Serialization(error.to_string()))?;
            let result_json = serde_json::to_string(&result)
                .map_err(|error| EngineError::Serialization(error.to_string()))?;
            snapshots.insert(result.output.body_id.clone(), result.output.clone());
            changes.push(DocumentChange::AcceptFeatureResult {
                feature: feature.clone(),
                body: crawler_document::BodyId(result.output.body_id.clone()),
                request_json,
                result_json,
            });
            recomputed.push(serde_json::json!({
                "feature": feature,
                "body": result.output.body_id,
            }));
        }
        let transaction = if changes.is_empty() {
            None
        } else {
            let transaction_id = TransactionId(format!(
                "transaction:recompute:{}:{}",
                self.engine.document().revision + 1,
                selected.0
            ));
            self.engine.commit_changes(transaction_id, changes)?;
            self.engine.document().transactions.last().cloned()
        };
        self.record_evaluation_timing(&plan.evaluation_order, started.elapsed_microseconds());
        let diagnostics = compute_diagnostics_view(&self.graph_state()?, &self.diagnostics)
            .map_err(|error| EngineError::InvalidDocument(error.to_string()))?;
        serde_json::to_string(&serde_json::json!({
            "accepted": true,
            "plan": plan,
            "recomputed": recomputed,
            "transaction": transaction,
            "diagnostics": diagnostics,
            "before_hash": before_hash,
            "document_hash": self.semantic_hash()?,
        }))
        .map_err(|error| EngineError::Serialization(error.to_string()))
    }

    /// Validate one caller- or document-owned candidate against the current
    /// native B-rep. Fallback signatures are deliberately absent from this
    /// authority boundary.
    fn validate_current_planar_candidate(
        &self,
        candidate: &crawler_document::TopologyReference,
        expected_component: Option<&ComponentId>,
        operation_name: &str,
    ) -> Result<(ResolvedPlanarFrame, serde_json::Value), EngineError> {
        if candidate.kind != crawler_document::TopologyKind::Face {
            return Err(EngineError::InvalidDocument(format!(
                "wrong_kind_topology_face_support at extrude.support: {operation_name} candidate {} is not a face",
                candidate.id.0
            )));
        }
        let document = self.engine.document();
        let body = document.bodies.get(&candidate.body).ok_or_else(|| {
            EngineError::InvalidDocument(format!(
                "missing_topology_face_body at extrude.support: {operation_name} candidate {} body {} is missing",
                candidate.id.0, candidate.body.0
            ))
        })?;
        let producer = document.features.get(&candidate.producer).ok_or_else(|| {
            EngineError::InvalidDocument(format!(
                "missing_topology_face_producer at extrude.support: {operation_name} candidate {} producer {} is missing",
                candidate.id.0, candidate.producer.0
            ))
        })?;
        if body.generated_by != candidate.producer {
            return Err(EngineError::InvalidDocument(format!(
                "wrong_producer_topology_face_support at extrude.support: {operation_name} candidate {} producer {} does not own body {}",
                candidate.id.0, candidate.producer.0, candidate.body.0
            )));
        }
        if producer.suppressed {
            return Err(EngineError::InvalidDocument(format!(
                "suppressed_topology_face_producer at extrude.support: {operation_name} candidate {} producer {} is suppressed",
                candidate.id.0, candidate.producer.0
            )));
        }
        if candidate.component != body.component
            || candidate.component != producer.component
            || expected_component.is_some_and(|expected| candidate.component != *expected)
        {
            return Err(EngineError::InvalidDocument(format!(
                "cross_component_topology_face_support at extrude.support: {operation_name} candidate {} body, producer, and expected component do not agree",
                candidate.id.0
            )));
        }
        if !feature_is_clean_at_accepted_revision(document, &candidate.producer) {
            return Err(EngineError::InvalidDocument(format!(
                "stale_topology_face_support at extrude.support: {operation_name} candidate {} producer {} is not clean at accepted revision {}",
                candidate.id.0, candidate.producer.0, document.revision
            )));
        }
        let authority: serde_json::Value =
            serde_json::from_str(&self.planar_face_frame_json(
                &candidate.body.0,
                &candidate.stable_kernel_id.to_string(),
            )?)
            .map_err(|error| EngineError::Serialization(error.to_string()))?;
        if authority["found"] != true {
            let code = authority["error"]["code"]
                .as_str()
                .unwrap_or("invalid_topology_face");
            return Err(EngineError::InvalidDocument(format!(
                "{code} at extrude.support: {operation_name} candidate {} is absent from current native body {}",
                candidate.id.0, candidate.body.0
            )));
        }
        if authority["accepted_revision"].as_u64() != Some(document.revision)
            || authority["body_id"].as_str() != Some(&candidate.body.0)
            || authority["component_id"].as_str() != Some(&candidate.component.0)
            || authority["producer_feature_id"].as_str() != Some(&candidate.producer.0)
            || authority["face_stable_id"]
                .as_str()
                .and_then(parse_canonical_decimal_u64)
                != Some(candidate.stable_kernel_id)
        {
            return Err(EngineError::InvalidDocument(format!(
                "planar_face_authority_mismatch at extrude.support: {operation_name} candidate {} authority does not match its exact durable owner",
                candidate.id.0
            )));
        }
        let tuple = |field: &str| {
            serde_json::from_value::<[i64; 3]>(authority["frame"][field].clone())
                .map_err(|error| EngineError::Serialization(error.to_string()))
        };
        Ok((
            ResolvedPlanarFrame {
                origin_nanometers: tuple("origin_nanometers")?,
                x_axis_millionths: tuple("x_axis_millionths")?,
                y_axis_millionths: tuple("y_axis_millionths")?,
                normal_millionths: tuple("normal_millionths")?,
            },
            authority,
        ))
    }

    /// Merge validated caller observations with current native validation of
    /// every stored reference. A caller omission cannot manufacture a broken
    /// state while the exact durable face remains current.
    fn current_repair_observations(
        &self,
        observed: &[crawler_document::TopologyReference],
    ) -> Vec<crawler_document::TopologyReference> {
        let mut current = BTreeMap::new();
        for candidate in observed {
            if self
                .validate_current_planar_candidate(candidate, None, "Topology repair inspection")
                .is_ok()
            {
                current.insert(candidate.id.clone(), candidate.clone());
            }
        }
        // Stored current evidence wins over any caller object with the same
        // application identity.
        for stored in self.engine.document().topology_references.values() {
            if self
                .validate_current_planar_candidate(stored, None, "Stored topology inspection")
                .is_ok()
            {
                current.insert(stored.id.clone(), stored.clone());
            }
        }
        current.into_values().collect()
    }

    fn inspect_current_topology_repair(
        &self,
        current: &[crawler_document::TopologyReference],
    ) -> Result<RepairInspection, EngineError> {
        let runtime_hash = self.semantic_hash()?;
        let mut inspection = inspect_topology_repair(self.engine.document(), current)
            .map_err(|error| EngineError::InvalidDocument(error.to_string()))?;
        match &mut inspection {
            RepairInspection::Ready {
                document_hash,
                revision,
            } => {
                *document_hash = runtime_hash;
                *revision = self.engine.document().revision;
            }
            RepairInspection::EvaluationBlocked { preview } => {
                preview.base_document_hash = runtime_hash;
                preview.base_revision = self.engine.document().revision;
            }
        }
        Ok(inspection)
    }

    /// Read-only structured validation for durable topology support. This is
    /// intentionally separate from EngineError text so native and WASM
    /// qualification adapters consume the exact same diagnostic DTO.
    pub fn topology_support_diagnostic_json(
        &self,
        reference_id: &str,
        expected_component_id: &str,
    ) -> Result<String, EngineError> {
        let document = self.engine.document();
        let base = serde_json::json!({
            "base_document_hash": self.semantic_hash()?,
            "base_revision": document.revision,
        });
        let diagnostic = |code: &str,
                          category: &str,
                          body_ids: Vec<String>,
                          feature_ids: Vec<String>,
                          message: String| {
            serde_json::json!({
                "valid": false,
                "base_document_hash": base["base_document_hash"],
                "base_revision": base["base_revision"],
                "diagnostic": {
                    "code": code,
                    "category": category,
                    "field": "extrude.support",
                    "reference_id": reference_id,
                    "referenced_body_ids": body_ids,
                    "referenced_feature_ids": feature_ids,
                    "message": message,
                }
            })
        };
        let id = crawler_document::TopologyReferenceId::from(reference_id);
        let Some(reference) = document.topology_references.get(&id) else {
            return serde_json::to_string(&diagnostic(
                "missing_topology_face_support",
                "missing_reference",
                Vec::new(),
                Vec::new(),
                format!("topology reference {reference_id} is missing"),
            ))
            .map_err(|error| EngineError::Serialization(error.to_string()));
        };
        let body_ids = vec![reference.body.0.clone()];
        let feature_ids = vec![reference.producer.0.clone()];
        let refusal = if reference.kind != crawler_document::TopologyKind::Face {
            Some((
                "wrong_kind_topology_face_support",
                "wrong_kind",
                "reference is not a face",
            ))
        } else if !document.bodies.contains_key(&reference.body) {
            Some((
                "missing_topology_face_body",
                "missing_reference",
                "referenced body is missing",
            ))
        } else if !document.features.contains_key(&reference.producer) {
            Some((
                "missing_topology_face_producer",
                "missing_reference",
                "referenced producer is missing",
            ))
        } else {
            let body = &document.bodies[&reference.body];
            let producer = &document.features[&reference.producer];
            if !body.accepts_producer(&reference.producer) {
                Some((
                    "wrong_producer_topology_face_support",
                    "wrong_owner",
                    "producer does not own the referenced body",
                ))
            } else if producer.suppressed {
                Some((
                    "suppressed_topology_face_producer",
                    "suppressed",
                    "referenced producer is suppressed",
                ))
            } else if reference.component.0 != expected_component_id
                || body.component != reference.component
                || producer.component != reference.component
            {
                Some((
                    "cross_component_topology_face_support",
                    "wrong_owner",
                    "reference, body, or producer belongs to another component",
                ))
            } else if !feature_is_clean_at_accepted_revision(document, &reference.producer) {
                Some((
                    "stale_topology_face_support",
                    "stale_reference",
                    "producer is not clean at the accepted revision",
                ))
            } else {
                None
            }
        };
        if let Some((code, category, message)) = refusal {
            return serde_json::to_string(&diagnostic(
                code,
                category,
                body_ids,
                feature_ids,
                message.into(),
            ))
            .map_err(|error| EngineError::Serialization(error.to_string()));
        }
        let authority: serde_json::Value =
            serde_json::from_str(&self.planar_face_frame_json(
                &reference.body.0,
                &reference.stable_kernel_id.to_string(),
            )?)
            .map_err(|error| EngineError::Serialization(error.to_string()))?;
        if authority["found"] != true {
            let error = &authority["error"];
            return serde_json::to_string(&diagnostic(
                error["code"].as_str().unwrap_or("invalid_topology_face"),
                error["category"].as_str().unwrap_or("invalid_geometry"),
                body_ids,
                feature_ids,
                error["message"]
                    .as_str()
                    .unwrap_or("native planar-face authority refused the reference")
                    .into(),
            ))
            .map_err(|error| EngineError::Serialization(error.to_string()));
        }
        serde_json::to_string(&serde_json::json!({
            "valid": true,
            "base_document_hash": base["base_document_hash"],
            "base_revision": base["base_revision"],
            "reference_id": reference_id,
            "authority": authority,
            "diagnostic": null,
        }))
        .map_err(|error| EngineError::Serialization(error.to_string()))
    }

    /// Inspect the first unresolved topology input against current native
    /// topology. Ranking cannot mutate or silently select a candidate.
    pub fn repair_inspection_json(&self, observed_json: &str) -> Result<String, EngineError> {
        let observed: Vec<crawler_document::TopologyReference> =
            serde_json::from_str(observed_json)
                .map_err(|error| EngineError::Serialization(error.to_string()))?;
        let current = self.current_repair_observations(&observed);
        let inspection = self.inspect_current_topology_repair(&current)?;
        serde_json::to_string(&inspection)
            .map_err(|error| EngineError::Serialization(error.to_string()))
    }

    fn topology_rebind_plan(
        &self,
        request: &TopologyRebindRequest,
        require_basis: bool,
    ) -> Result<TopologyRebindPlan, EngineError> {
        let base_document_hash = self.semantic_hash()?;
        let base_revision = self.engine.document().revision;
        if require_basis
            && (request.base_document_hash.as_deref() != Some(&base_document_hash)
                || request.base_revision != Some(base_revision))
        {
            return Err(EngineError::InvalidDocument(
                "stale_topology_rebind_preview_basis at repair.preview: base document hash or revision differs from the accepted document".into(),
            ));
        }
        let current = self.current_repair_observations(&request.observed);
        let inspection = self.inspect_current_topology_repair(&current)?;
        let RepairInspection::EvaluationBlocked { preview } = inspection else {
            return Err(EngineError::InvalidDocument(
                "topology_repair_not_required at repair.preview: native current stored topology resolves every input".into(),
            ));
        };
        let candidate = current
            .iter()
            .find(|candidate| candidate.id == request.selected)
            .ok_or_else(|| {
                EngineError::InvalidDocument(
                    "replacement_not_in_current_preview at repair.selected: selected topology is absent from the native-validated candidate set".into(),
                )
            })?;
        let expected = preview.unresolved.expected.as_ref().ok_or_else(|| {
            EngineError::InvalidDocument(
                "missing_topology_face_support at repair.source: repair requires an existing source reference definition".into(),
            )
        })?;
        if candidate.body != expected.body || candidate.producer != expected.producer {
            return Err(EngineError::InvalidDocument(
                "invalid_topology_rebind_scope at repair.selected: replacement must have the same body and producer".into(),
            ));
        }
        let body = self
            .engine
            .document()
            .bodies
            .get(&candidate.body)
            .ok_or_else(|| {
                EngineError::InvalidDocument("missing_topology_face_body at repair.selected".into())
            })?;
        let (candidate_frame, _) = self.validate_current_planar_candidate(
            candidate,
            Some(&body.component),
            "Topology repair preview",
        )?;
        let transaction_id = request
            .transaction_id
            .clone()
            .unwrap_or_else(|| TransactionId("transaction:topology-rebind-preview".into()));
        let draft = draft_explicit_rebind(&preview, transaction_id.0.clone(), &request.selected)
            .map_err(|error| EngineError::InvalidDocument(error.to_string()))?;
        let change = draft
            .changes
            .first()
            .ok_or_else(|| EngineError::InvalidDocument("repair draft has no change".into()))?;
        // Re-verify exact full selection equality rather than trusting the
        // application ID that was used to pick the row.
        if &change.replacement != candidate {
            return Err(EngineError::InvalidDocument(
                "topology_rebind_selection_changed at repair.selected: candidate evidence differs from the inspected row".into(),
            ));
        }
        let rebind = DocumentChange::RebindTopology {
            feature: change.feature.clone(),
            input_name: change.input_name.clone(),
            from_reference: change.from_reference.clone(),
            replacement: change.replacement.clone(),
        };
        let mut changes = vec![rebind.clone()];
        let mut candidate_engine = PartEngine::from_document(self.engine.document().clone())?;
        candidate_engine.commit_changes(
            TransactionId(format!("{}:isolated-preview", transaction_id.0)),
            vec![rebind],
        )?;
        let branch_pending: BTreeSet<_> = crawler_topology_repair::summarize_downstream_recovery(
            candidate_engine.document(),
            &change.feature,
        )
        .map_err(|error| EngineError::InvalidDocument(error.to_string()))?
        .pending_features
        .into_iter()
        .collect();
        let evaluation_order = construction_plane_recompute_order(candidate_engine.document())?
            .into_iter()
            .filter(|feature| branch_pending.contains(feature))
            .collect::<Vec<_>>();
        let mut snapshots = accepted_body_snapshots(candidate_engine.document())?;
        if self.base_body_is_active() {
            let base = self.base_body_snapshot()?;
            snapshots.insert(base.body_id.clone(), base);
        }
        // A generic repaired face input can have no body-producing consumer;
        // in that case preview the exact current support body. A planar-face
        // Extrude branch replaces this with its final recomputed output.
        let mut output = snapshots.get(&candidate.body.0).cloned();
        let mut recomputed_features = Vec::new();
        for feature in evaluation_order {
            let Some(kernel_request) = latest_kernel_request_with_snapshots(
                candidate_engine.document(),
                &feature,
                Some(&snapshots),
            )?
            else {
                continue;
            };
            // Legacy requests can contain snapshots at arbitrary nesting
            // depth. Rebind on every hop so a second downstream consumer sees
            // the result produced immediately before it.
            let rebound_request = rebind_request_snapshots(kernel_request, &snapshots)?;
            let result = execute_feature(&rebound_request)
                .map_err(|error| EngineError::InvalidDocument(error.to_string()))?;
            let request_json = serde_json::to_string(&rebound_request)
                .map_err(|error| EngineError::Serialization(error.to_string()))?;
            let result_json = serde_json::to_string(&result)
                .map_err(|error| EngineError::Serialization(error.to_string()))?;
            snapshots.insert(result.output.body_id.clone(), result.output.clone());
            output = Some(result.output.clone());
            recomputed_features.push(feature.clone());
            changes.push(DocumentChange::AcceptFeatureResult {
                feature,
                body: BodyId(result.output.body_id.clone()),
                request_json,
                result_json,
            });
            // Later hops must read the exact staged durable definitions and
            // ownership produced by all preceding changes.
            candidate_engine = PartEngine::from_document(self.engine.document().clone())?;
            candidate_engine.commit_changes(
                TransactionId(format!("{}:isolated-preview", transaction_id.0)),
                changes.clone(),
            )?;
        }
        let output = output.ok_or_else(|| {
            EngineError::InvalidDocument(
                "topology_rebind_has_no_body_result at repair.preview: selected branch has no recoverable body-producing consumer".into(),
            )
        })?;
        Ok(TopologyRebindPlan {
            base_document_hash,
            base_revision,
            selected: request.selected.clone(),
            candidate_frame,
            output,
            changes,
            repaired_feature: change.feature.clone(),
            recomputed_features,
        })
    }

    /// Compute recovered candidate geometry in an isolated engine. The
    /// accepted document, transaction journal, and undo stack are untouched.
    pub fn preview_topology_rebind_json(&self, request_json: &str) -> Result<String, EngineError> {
        let request: TopologyRebindRequest = serde_json::from_str(request_json)
            .map_err(|error| EngineError::Serialization(error.to_string()))?;
        let tolerance = request
            .tolerance
            .unwrap_or(DEFAULT_FEATURE_PREVIEW_TOLERANCE);
        if !tolerance.is_finite() || tolerance <= 0.0 {
            return Err(EngineError::InvalidDocument(
                "invalid_topology_rebind_tolerance at repair.tolerance".into(),
            ));
        }
        let plan = self.topology_rebind_plan(&request, false)?;
        let render = packet_value(
            Some(&plan.output.body_id),
            Some(packet_for_snapshot(&plan.output, tolerance)?),
        );
        serde_json::to_string(&serde_json::json!({
            "accepted": true,
            "base_document_hash": plan.base_document_hash,
            "base_revision": plan.base_revision,
            "selected": plan.selected,
            "candidate_frame": plan.candidate_frame,
            "body_id": plan.output.body_id,
            "render": render,
            "repaired_feature": plan.repaired_feature,
            "recomputed_features": plan.recomputed_features,
        }))
        .map_err(|error| EngineError::Serialization(error.to_string()))
    }

    /// Commit only an exact, current preview basis. The selected candidate is
    /// re-inspected, natively revalidated, and recomputed before one ordinary
    /// atomic undoable transaction is accepted.
    pub fn explicit_rebind_json(&mut self, request_json: &str) -> Result<String, EngineError> {
        let request: TopologyRebindRequest = serde_json::from_str(request_json)
            .map_err(|error| EngineError::Serialization(error.to_string()))?;
        let transaction_id = request.transaction_id.clone().ok_or_else(|| {
            EngineError::InvalidDocument(
                "missing_topology_rebind_transaction at repair.transaction_id".into(),
            )
        })?;
        let started = EvaluationTimer::start();
        let plan = self.topology_rebind_plan(&request, true)?;
        self.engine.commit_changes(transaction_id, plan.changes)?;
        self.record_evaluation_timing(&plan.recomputed_features, started.elapsed_microseconds());
        serde_json::to_string(&serde_json::json!({
            "accepted": true,
            "selected": plan.selected,
            "transaction": self.engine.document().transactions.last(),
            "document_hash": self.semantic_hash()?,
        }))
        .map_err(|error| EngineError::Serialization(error.to_string()))
    }

    fn record_evaluation_timing(&mut self, features: &[FeatureId], elapsed_microseconds: u64) {
        if features.is_empty() {
            return;
        }
        let per_feature = elapsed_microseconds.div_ceil(features.len() as u64).max(1);
        for feature in features {
            self.evaluation_sequence = self.evaluation_sequence.saturating_add(1);
            self.diagnostics.timings.insert(
                feature.clone(),
                FeatureTimingDiagnostic {
                    elapsed_microseconds: per_feature,
                    evaluation_sequence: self.evaluation_sequence,
                },
            );
        }
    }

    /// Authoritative packet at the process-local timeline cursor. Accepted
    /// feature snapshots take precedence over the initial rectangular body;
    /// rolling before the first body-producing feature returns an empty packet.
    pub fn render_packet_json(&self, tolerance: f64) -> Result<String, EngineError> {
        let value = match self.active_result()? {
            Some(active) => packet_value(
                Some(active.body.body_id.as_str()),
                Some(active_packet(&active, tolerance)?),
            ),
            None if self.base_body_is_active() => {
                let mut packet = reference_cube_packet(tolerance)
                    .map_err(|error| EngineError::InvalidDocument(error.to_string()))?;
                let dimensions = self.dimensions()?;
                let scale = [
                    dimensions.width_nanometers as f32 / 1_000_000.0,
                    dimensions.height_nanometers as f32 / 1_000_000.0,
                    dimensions.distance_nanometers as f32 / 1_000_000.0,
                ];
                scale_xyz(&mut packet.positions, scale);
                scale_xyz(&mut packet.edge_positions, scale);
                scale_xyz(&mut packet.vertex_positions, scale);
                packet.bounds.min = [0.0; 3];
                packet.bounds.max = scale.map(f64::from);
                packet_value(Some(crawler_part_engine::BODY_ID), Some(packet))
            }
            None => packet_value(None, None),
        };
        serde_json::to_string(&value).map_err(|error| EngineError::Serialization(error.to_string()))
    }

    /// Query the body/result that is authoritative at the current rollback
    /// cursor. The semantic document is never modified by this query.
    pub fn active_body_json(&self, tolerance: f64) -> Result<String, EngineError> {
        let value = if let Some(active) = self.active_result()? {
            serde_json::json!({
                "kind": active.kind,
                "feature_id": active.feature,
                "body": active.body,
                "result": active.result,
                "render": packet_value(
                    Some(active.body.body_id.as_str()),
                    Some(active_packet(&active, tolerance)?),
                ),
                "timeline": serde_json::from_str::<serde_json::Value>(&self.timeline_rollback_json()?)
                    .map_err(|error| EngineError::Serialization(error.to_string()))?,
            })
        } else if self.base_body_is_active() {
            let body = self.base_body_snapshot()?;
            serde_json::json!({
                "kind": "base_part",
                "feature_id": crawler_part_engine::EXTRUDE_FEATURE_ID,
                "body": body,
                "render": serde_json::from_str::<serde_json::Value>(&self.render_packet_json(tolerance)?)
                    .map_err(|error| EngineError::Serialization(error.to_string()))?,
                "timeline": serde_json::from_str::<serde_json::Value>(&self.timeline_rollback_json()?)
                    .map_err(|error| EngineError::Serialization(error.to_string()))?,
            })
        } else {
            serde_json::json!({
                "kind": "none",
                "feature_id": null,
                "body": null,
                "render": packet_value(None, None),
                "timeline": serde_json::from_str::<serde_json::Value>(&self.timeline_rollback_json()?)
                    .map_err(|error| EngineError::Serialization(error.to_string()))?,
            })
        };
        serde_json::to_string(&value).map_err(|error| EngineError::Serialization(error.to_string()))
    }

    /// Solve the Crawler-owned sketch DTO and, only when feasible, commit the
    /// solved geometry and diagnostics into the accepted document transaction.
    pub fn solve_sketch_json(&mut self, request_json: &str) -> Result<String, EngineError> {
        #[derive(serde::Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Request {
            transaction_id: TransactionId,
            sketch: crawler_sketch::Sketch,
            #[serde(default)]
            support: Option<crawler_document::SketchSupport>,
            #[serde(default)]
            support_reference: Option<crawler_document::TopologyReference>,
        }
        let request: Request = serde_json::from_str(request_json)
            .map_err(|error| EngineError::Serialization(error.to_string()))?;
        let mut solved = EzpzSolver
            .solve_sketch(&request.sketch)
            .map_err(|error| EngineError::InvalidDocument(error.to_string()))?;
        if solved.solve.state == SolveState::Conflicting {
            return serde_json::to_string(&serde_json::json!({
                "accepted": false,
                "solve": solved.solve,
                "document_hash": self.semantic_hash()?,
            }))
            .map_err(|error| EngineError::Serialization(error.to_string()));
        }
        let id = crawler_document::SketchId(solved.sketch.id.clone());
        let existing = self.engine.document().sketches.get(&id).cloned();
        let is_new_sketch = existing.is_none();
        let support = request
            .support
            .clone()
            .or_else(|| existing.as_ref().map(|sketch| sketch.support.clone()))
            .ok_or_else(|| EngineError::InvalidDocument("new sketch support is required".into()))?;
        let template = existing.unwrap_or_else(|| crawler_document::Sketch {
            id: id.clone(),
            display_name: format!("Sketch {}", self.engine.document().sketches.len() + 1),
            component: self.engine.document().root_component.clone(),
            support: support.clone(),
            elements: Vec::new(),
            constraints: Vec::new(),
            dimension_positions: BTreeMap::new(),
            recipes: BTreeMap::new(),
            operations: BTreeMap::new(),
        });
        attach_dimension_parameter_ids(&mut solved.sketch, &template);
        let document_sketch = solved_to_document_sketch(&template, &solved.sketch, &support);
        let solve_state = serde_json::to_value(solved.solve.state)
            .ok()
            .and_then(|value| value.as_str().map(str::to_owned))
            .unwrap_or_else(|| "unknown".into());
        let conflicts = solved
            .solve
            .conflicts
            .iter()
            .flat_map(|conflict| conflict.constraints.iter().map(|id| id.0.clone()))
            .collect();
        let mut changes = Vec::new();
        if let crawler_document::SketchSupport::Topology { reference } = &support {
            let durable = self.engine.document().topology_references.get(reference);
            if request
                .support_reference
                .as_ref()
                .is_some_and(|evidence| &evidence.id != reference)
            {
                return Err(EngineError::InvalidDocument(
                    "topology_support_evidence_mismatch at sketch.support: evidence identity differs from support".into(),
                ));
            }
            if let (Some(stored), Some(evidence)) = (durable, request.support_reference.as_ref())
                && stored != evidence
            {
                return Err(EngineError::InvalidDocument(
                    "topology_support_evidence_collision at sketch.support: caller evidence differs from the durable reference".into(),
                ));
            }
            let evidence = durable.or(request.support_reference.as_ref()).ok_or_else(|| {
                EngineError::InvalidDocument(format!(
                    "missing_topology_face_support at sketch.support: topology support {} requires durable reference evidence",
                    reference.0
                ))
            })?;
            // A new or changed topology support is accepted only after exact
            // native face, owner, component, suppression, and freshness
            // validation. All refusal paths precede transaction construction.
            self.validate_current_planar_candidate(
                evidence,
                Some(&template.component),
                "Sketch solve",
            )?;
            if durable.is_none() {
                changes.push(DocumentChange::UpsertTopologyReference {
                    reference: evidence.clone(),
                });
            }
        } else if request.support_reference.is_some() {
            return Err(EngineError::InvalidDocument(
                "topology evidence is only valid for topology sketch support".into(),
            ));
        }
        changes.extend(dimension_parameter_changes(
            self.engine.document(),
            &solved.sketch,
        ));
        let support_producer = match &support {
            crawler_document::SketchSupport::Topology { reference } => self
                .engine
                .document()
                .topology_references
                .get(reference)
                .or(request.support_reference.as_ref())
                .map(|reference| reference.producer.clone()),
            _ => None,
        };
        let existing_feature =
            self.engine
                .document()
                .features
                .values()
                .find_map(|feature| {
                    (feature.operation.schema_id == "crawler.operation.sketch")
                        .then_some(feature)
                        .filter(|feature| {
                            feature.inputs.values().any(|input| {
                                input == &FeatureInput::Sketch(document_sketch.id.clone())
                            })
                        })
                        .cloned()
                });
        let desired_feature = sketch_feature(
            &document_sketch,
            support_producer,
            existing_feature.as_ref(),
        );
        changes.push(DocumentChange::ApplySketchSolution {
            sketch: document_sketch,
            solve_state,
            degrees_of_freedom: solved.solve.degrees_of_freedom,
            conflicts,
        });
        if is_new_sketch || existing_feature.is_none() {
            changes.push(DocumentChange::CreateFeature {
                feature: desired_feature,
                before: None,
            });
        } else if existing_feature
            .as_ref()
            .is_some_and(|feature| feature.operation.schema_id == "crawler.operation.sketch")
            && self.engine.document().features.get(&desired_feature.id) != Some(&desired_feature)
        {
            changes.push(DocumentChange::EditFeature {
                feature: desired_feature,
            });
        }
        self.engine
            .commit_changes(request.transaction_id, changes)?;
        serde_json::to_string(&serde_json::json!({
            "accepted": true,
            "sketch_id": id,
            "solve": solved.solve,
            "document_hash": self.semantic_hash()?,
        }))
        .map_err(|error| EngineError::Serialization(error.to_string()))
    }

    /// Apply one schema-driven sketch command to a caller-owned draft. This is
    /// deliberately read-only with respect to the accepted part document: the
    /// UI may preview, cancel, or subsequently commit the returned draft with
    /// `solve_sketch_json` as one atomic document transaction.
    pub fn apply_sketch_command_json(&self, request_json: &str) -> Result<String, EngineError> {
        #[derive(serde::Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Request {
            sketch: crawler_sketch::Sketch,
            command: SketchCommand,
        }
        let request: Request = serde_json::from_str(request_json)
            .map_err(|error| EngineError::Serialization(error.to_string()))?;
        let application = request
            .sketch
            .apply(request.command)
            .map_err(|error| EngineError::InvalidDocument(error.to_string()))?;
        let solved = EzpzSolver
            .solve_sketch(&application.after)
            .map_err(|error| EngineError::InvalidDocument(error.to_string()))?;
        serde_json::to_string(&serde_json::json!({
            "application": application,
            "profile": solved.sketch.profile_report(),
            "solve": solved.solve,
            "sketch": solved.sketch,
            "document_hash": self.semantic_hash()?,
        }))
        .map_err(|error| EngineError::Serialization(error.to_string()))
    }

    /// Apply a tool-sized command batch and solve only the final immutable
    /// draft. Rectangle creation uses this to avoid fourteen redundant WASM
    /// solves while retaining the individual durable command semantics.
    pub fn apply_sketch_commands_json(&self, request_json: &str) -> Result<String, EngineError> {
        #[derive(serde::Serialize)]
        #[serde(rename_all = "camelCase")]
        struct RuntimePerformance {
            request_parse_ms: f64,
            apply_batch_ms: f64,
            solve_ms: f64,
            profile_ms: f64,
            document_hash_ms: f64,
        }

        #[derive(serde::Serialize)]
        struct Response<'a> {
            application_count: usize,
            profile: &'a crawler_sketch::ProfileReport,
            solve: &'a crawler_sketch::SolveResult,
            sketch: &'a crawler_sketch::Sketch,
            document_hash: &'a str,
            runtime_performance: RuntimePerformance,
        }

        #[derive(serde::Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Request {
            sketch: crawler_sketch::Sketch,
            commands: Vec<SketchCommand>,
        }

        let phase = SketchPhaseTimer::start();
        let request: Request = serde_json::from_str(request_json)
            .map_err(|error| EngineError::Serialization(error.to_string()))?;
        let request_parse_ms = phase.elapsed_milliseconds();
        let application_count = request.commands.len();

        let phase = SketchPhaseTimer::start();
        let sketch = request
            .sketch
            .apply_batch(request.commands)
            .map_err(|error| EngineError::InvalidDocument(error.to_string()))?;
        let apply_batch_ms = phase.elapsed_milliseconds();

        let phase = SketchPhaseTimer::start();
        let solved = EzpzSolver
            .solve_prevalidated_sketch(&sketch)
            .map_err(|error| EngineError::InvalidDocument(error.to_string()))?;
        let solve_ms = phase.elapsed_milliseconds();

        let phase = SketchPhaseTimer::start();
        let profile = solved.sketch.profile_report();
        let profile_ms = phase.elapsed_milliseconds();

        let phase = SketchPhaseTimer::start();
        let document_hash = self.semantic_hash()?;
        let document_hash_ms = phase.elapsed_milliseconds();

        serde_json::to_string(&Response {
            application_count,
            profile: &profile,
            solve: &solved.solve,
            sketch: &solved.sketch,
            document_hash: &document_hash,
            runtime_performance: RuntimePerformance {
                request_parse_ms,
                apply_batch_ms,
                solve_ms,
                profile_ms,
                document_hash_ms,
            },
        })
        .map_err(|error| EngineError::Serialization(error.to_string()))
    }

    /// Resolve an under-constrained point drag against the same declarative
    /// solver used by commit. Like command application, dragging only returns a
    /// draft and cannot mutate the authoritative document.
    pub fn drag_sketch_json(&self, request_json: &str) -> Result<String, EngineError> {
        #[derive(serde::Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Request {
            sketch: crawler_sketch::Sketch,
            drag: DragRequest,
        }
        let request: Request = serde_json::from_str(request_json)
            .map_err(|error| EngineError::Serialization(error.to_string()))?;
        let drag = EzpzSolver
            .constrained_drag(&request.sketch, request.drag)
            .map_err(|error| EngineError::InvalidDocument(error.to_string()))?;
        serde_json::to_string(&serde_json::json!({
            "profile": drag.sketch.profile_report(),
            "drag": drag,
            "document_hash": self.semantic_hash()?,
        }))
        .map_err(|error| EngineError::Serialization(error.to_string()))
    }

    /// Describe the stable 2D WASM contract and the implementation currently
    /// serving it. This is intentionally separate from accepted document state.
    pub fn sketch_solver_contract_json(&self) -> Result<String, EngineError> {
        serde_json::to_string(&EzpzSolver.contract())
            .map_err(|error| EngineError::Serialization(error.to_string()))
    }

    /// Return the deterministic graph plan without mutating accepted state.
    /// This keeps decomposition observable through the same WASM boundary as
    /// solve and drag, which is useful for fixture and performance validation.
    pub fn decompose_sketch_json(&self, request_json: &str) -> Result<String, EngineError> {
        #[derive(serde::Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Request {
            sketch: crawler_sketch::Sketch,
        }
        let request: Request = serde_json::from_str(request_json)
            .map_err(|error| EngineError::Serialization(error.to_string()))?;
        request
            .sketch
            .validate()
            .map_err(|error| EngineError::InvalidDocument(error.to_string()))?;
        serde_json::to_string(&crawler_sketch::Decomposition::from_sketch(&request.sketch))
            .map_err(|error| EngineError::Serialization(error.to_string()))
    }

    pub fn export_sketch_dxf_json(&self, request_json: &str) -> Result<String, EngineError> {
        #[derive(serde::Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Request {
            sketch: crawler_sketch::Sketch,
        }
        let request: Request = serde_json::from_str(request_json)
            .map_err(|error| EngineError::Serialization(error.to_string()))?;
        let dxf = crawler_sketch::export_dxf(&request.sketch)
            .map_err(|error| EngineError::InvalidDocument(error.to_string()))?;
        serde_json::to_string(&serde_json::json!({ "dxf": dxf }))
            .map_err(|error| EngineError::Serialization(error.to_string()))
    }

    pub fn import_sketch_dxf_json(&self, request_json: &str) -> Result<String, EngineError> {
        #[derive(serde::Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Request {
            sketch_id: String,
            dxf: String,
        }
        let request: Request = serde_json::from_str(request_json)
            .map_err(|error| EngineError::Serialization(error.to_string()))?;
        let sketch = crawler_sketch::import_dxf(request.sketch_id, &request.dxf)
            .map_err(|error| EngineError::InvalidDocument(error.to_string()))?;
        serde_json::to_string(&serde_json::json!({
            "decomposition": crawler_sketch::Decomposition::from_sketch(&sketch),
            "sketch": sketch,
        }))
        .map_err(|error| EngineError::Serialization(error.to_string()))
    }

    /// Execute any qualified feature operation and tessellate its candidate
    /// body without committing document changes or adding undo history. The
    /// input is the exact full envelope accepted by `execute_feature_json` and
    /// `execute_new_feature_json`; whether it describes an edit or a new
    /// feature is determined from the durable feature identity.
    pub fn preview_feature_json(&self, envelope_json: &str) -> Result<String, EngineError> {
        let document_hash = self.semantic_hash()?;
        let document_json = self.document_json()?;
        let envelope: AdvancedFeatureEnvelope = match serde_json::from_str(envelope_json) {
            Ok(envelope) => envelope,
            Err(error) => {
                return preview_runtime_refusal_json(
                    "invalid_input",
                    "envelope",
                    &format!("feature preview envelope is invalid: {error}"),
                    "send the same complete envelope used to commit the feature",
                    document_hash,
                );
            }
        };
        if envelope.request.document_id != self.engine.document().id.0 {
            return preview_runtime_refusal_json(
                "invalid_input",
                "document_id",
                "feature request document identity differs",
                "use the stable identity of the open document",
                document_hash,
            );
        }
        if envelope.request.feature_id != envelope.feature.id.0 {
            return preview_runtime_refusal_json(
                "invalid_input",
                "feature_id",
                "feature and request identities differ",
                "use one caller-owned feature identity in both fields",
                document_hash,
            );
        }
        if let Some(existing) = self.engine.document().features.get(&envelope.feature.id)
            && envelope.feature.component != existing.component
        {
            return preview_runtime_refusal_json(
                "invalid_input",
                "feature.component",
                "edited feature component differs",
                "preserve the durable component identity while editing the feature",
                document_hash,
            );
        }
        if let Err(error) =
            validate_parameter_definitions(&envelope.feature, &envelope.parameter_definitions)
        {
            return preview_runtime_refusal_json(
                "invalid_input",
                "parameter_definitions",
                &error.to_string(),
                "provide one definition for every stable feature parameter binding",
                document_hash,
            );
        }
        let result = match self.execute_feature_with_extent_edit(&envelope.request) {
            Ok(result) => result,
            Err(error) => {
                return preview_feature_refusal_json(error, document_hash);
            }
        };
        let render = packet_value(
            Some(result.output.body_id.as_str()),
            Some(packet_for_snapshot(
                &result.output,
                DEFAULT_FEATURE_PREVIEW_TOLERANCE,
            )?),
        );
        if self.semantic_hash()? != document_hash || self.document_json()? != document_json {
            return Err(EngineError::InvalidDocument(
                "feature preview mutated the accepted runtime".into(),
            ));
        }
        serde_json::to_string(&serde_json::json!({
            "accepted": true,
            "result": result,
            "document_hash": document_hash,
            "render": render,
        }))
        .map_err(|error| EngineError::Serialization(error.to_string()))
    }

    /// Convert durable sketch/body selections and exact operation parameters
    /// into the same complete envelope consumed by preview and commit. No
    /// semantic state or history is changed while resolving the sources.
    pub fn prepare_sketch_feature_envelope_json(
        &self,
        request_json: &str,
    ) -> Result<String, EngineError> {
        let before_hash = self.semantic_hash()?;
        let before_document = self.document_json()?;
        let request: PrepareSketchFeatureEnvelopeRequest = serde_json::from_str(request_json)
            .map_err(|error| EngineError::Serialization(error.to_string()))?;
        if request.feature_id.trim().is_empty()
            || request.body_id.trim().is_empty()
            || request.transaction_id.0.trim().is_empty()
        {
            return Err(EngineError::InvalidDocument(
                "prepared feature identities must not be empty".into(),
            ));
        }
        if self
            .engine
            .document()
            .features
            .contains_key(&FeatureId::from(request.feature_id.as_str()))
        {
            return Err(EngineError::InvalidDocument(format!(
                "feature {} already exists",
                request.feature_id
            )));
        }
        if request.tolerance_nanometers <= 0 {
            return Err(EngineError::InvalidDocument(
                "tolerance_nanometers must be greater than zero".into(),
            ));
        }

        let operation_name = request.operation_id.display_name();
        let mut dependencies = Vec::<FeatureId>::new();
        let mut inputs = BTreeMap::<String, FeatureInput>::new();
        let mut profiles = Vec::<AcceptedPlanarSketchProfile>::new();
        for (index, source) in request.profile_sources.iter().enumerate() {
            let profile = self.accepted_planar_sketch_profile(
                &source.sketch,
                &source.support,
                &source.profile_geometry_ids,
                operation_name,
            )?;
            let sketch_id = crawler_document::SketchId(source.sketch.id.clone());
            let producer = self.sketch_feature_producer(&sketch_id, operation_name)?;
            push_dependency(&mut dependencies, producer);
            let field = if index == 0 {
                "profile".to_owned()
            } else {
                format!("profile_{}", index + 1)
            };
            inputs.insert(field, FeatureInput::Sketch(sketch_id));
            profiles.push(profile);
        }

        let target = request
            .target_body_id
            .as_deref()
            .map(|body_id| self.accepted_body_source(body_id, operation_name))
            .transpose()?;
        if let Some((snapshot, producer)) = &target {
            inputs.insert(
                "target".into(),
                FeatureInput::Body(BodyId(snapshot.body_id.clone())),
            );
            push_dependency(&mut dependencies, producer.clone());
        }

        let path = request
            .path_source
            .as_ref()
            .map(|source| {
                let points = self.accepted_planar_sketch_path(
                    &source.sketch,
                    &source.support,
                    operation_name,
                )?;
                let sketch_id = crawler_document::SketchId(source.sketch.id.clone());
                let producer = self.sketch_feature_producer(&sketch_id, operation_name)?;
                Ok::<_, EngineError>((points, sketch_id, producer))
            })
            .transpose()?;
        if let Some((_, sketch_id, producer)) = &path {
            inputs.insert("path".into(), FeatureInput::Sketch(sketch_id.clone()));
            push_dependency(&mut dependencies, producer.clone());
        }

        let first_profile = || -> Result<Vec<[i64; 3]>, EngineError> {
            let resolved = profiles.first().ok_or_else(|| {
                EngineError::InvalidDocument(format!(
                    "{operation_name} requires one profile source"
                ))
            })?;
            if profiles.len() != 1 || resolved.profiles_nm.len() != 1 {
                return Err(EngineError::InvalidDocument(format!(
                    "{operation_name} requires exactly one closed profile"
                )));
            }
            Ok(resolved.profiles_nm[0].clone())
        };
        let require_axis = || {
            Ok::<_, EngineError>((
                request.axis_origin_nanometers.ok_or_else(|| {
                    EngineError::InvalidDocument(format!(
                        "{operation_name} requires axis_origin_nanometers"
                    ))
                })?,
                request.axis_direction_nanometers.ok_or_else(|| {
                    EngineError::InvalidDocument(format!(
                        "{operation_name} requires axis_direction_nanometers"
                    ))
                })?,
            ))
        };
        let require_sweep = || {
            request.sweep_microdegrees.ok_or_else(|| {
                EngineError::InvalidDocument(format!(
                    "{operation_name} requires sweep_microdegrees"
                ))
            })
        };
        let require_divisions = || {
            request.divisions.ok_or_else(|| {
                EngineError::InvalidDocument(format!("{operation_name} requires divisions"))
            })
        };

        let mut parameter_definitions = Vec::new();
        let mut parameter_bindings = BTreeMap::new();
        let mut feature_definition_v2 = None;
        let mut region_definition_v2 = None;
        let operation = match request.operation_id {
            SketchFeatureOperationId::ProfileRevolve => {
                let (axis_origin_nm, raw_axis_direction_nm) = require_axis()?;
                let axis_direction_nm =
                    directed_axis(raw_axis_direction_nm, request.reverse, operation_name)?;
                let sweep_microdegrees = require_sweep()?;
                let divisions = require_divisions()?;
                bind_prepared_parameter(
                    &request.feature_id,
                    "angle",
                    "Angle",
                    ParameterValue::AngleMicrodegrees(sweep_microdegrees),
                    &mut parameter_bindings,
                    &mut parameter_definitions,
                );
                bind_prepared_parameter(
                    &request.feature_id,
                    "reverse",
                    "Reverse",
                    ParameterValue::Boolean(request.reverse),
                    &mut parameter_bindings,
                    &mut parameter_definitions,
                );
                FeatureOperation::ProfileRevolve(ProfileRevolveInput {
                    profile_nm: first_profile()?,
                    axis_origin_nm,
                    axis_direction_nm,
                    sweep_microdegrees,
                    divisions,
                    tolerance_nm: request.tolerance_nanometers,
                })
            }
            SketchFeatureOperationId::Loft => {
                if profiles.len() < 2
                    || profiles
                        .iter()
                        .any(|profile| profile.profiles_nm.len() != 1)
                {
                    return Err(EngineError::InvalidDocument(
                        "Loft requires at least two sources with exactly one closed profile each"
                            .into(),
                    ));
                }
                FeatureOperation::Loft(LoftInput {
                    profiles_nm: profiles
                        .into_iter()
                        .map(|profile| profile.profiles_nm.into_iter().next().unwrap())
                        .collect(),
                    tolerance_nm: request.tolerance_nanometers,
                })
            }
            SketchFeatureOperationId::Sweep => {
                let (path_nm, _, _) = path.ok_or_else(|| {
                    EngineError::InvalidDocument("Sweep requires path_source".into())
                })?;
                FeatureOperation::Sweep(SweepInput {
                    profile_nm: first_profile()?,
                    path_nm,
                    tolerance_nm: request.tolerance_nanometers,
                })
            }
            SketchFeatureOperationId::ExtrudeCut => {
                let distance = request.distance_nanometers.ok_or_else(|| {
                    EngineError::InvalidDocument("Extrude Cut requires distance_nanometers".into())
                })?;
                if distance <= 0 {
                    return Err(EngineError::InvalidDocument(
                        "Extrude Cut distance must be greater than zero".into(),
                    ));
                }
                let profile = profiles.first().ok_or_else(|| {
                    EngineError::InvalidDocument("Extrude Cut requires a profile source".into())
                })?;
                if profiles.len() != 1 {
                    return Err(EngineError::InvalidDocument(
                        "Extrude Cut requires exactly one profile source".into(),
                    ));
                }
                let (target, target_producer) = target.ok_or_else(|| {
                    EngineError::InvalidDocument("Extrude Cut requires target_body_id".into())
                })?;
                if request.body_id != target.body_id {
                    return Err(EngineError::InvalidDocument(
                        "single-target Extrude Cut must retain target_body_id as body_id".into(),
                    ));
                }
                let target_body = self
                    .engine
                    .document()
                    .bodies
                    .get(&BodyId::from(target.body_id.as_str()))
                    .ok_or_else(|| {
                        EngineError::InvalidDocument(
                            "missing_cut_target at target: target body record is missing".into(),
                        )
                    })?;
                let source = request
                    .profile_sources
                    .first()
                    .expect("profile exists above");
                let profile_sketch = self
                    .engine
                    .document()
                    .sketches
                    .get(&crawler_document::SketchId(source.sketch.id.clone()))
                    .ok_or_else(|| {
                        EngineError::InvalidDocument(
                            "missing_cut_profile at profile: accepted profile sketch is missing"
                                .into(),
                        )
                    })?;
                if profile_sketch.component != target_body.component {
                    return Err(EngineError::InvalidDocument(
                        "wrong_component_cut_target at target: profile and target must belong to the same component".into(),
                    ));
                }
                if let crawler_document::SketchSupport::Topology { reference } = &source.support {
                    let support = self
                        .engine
                        .document()
                        .topology_references
                        .get(reference)
                        .ok_or_else(|| {
                            EngineError::InvalidDocument(format!(
                                "missing_topology_face_support at extrude.support: reference {} is missing",
                                reference.0
                            ))
                        })?;
                    if support.body.0 != target.body_id
                        || support.producer != target_producer
                        || support.component != target_body.component
                    {
                        return Err(EngineError::InvalidDocument(
                            "wrong_owner_cut_target at target: planar-face support must be owned by the explicit current target body and producer".into(),
                        ));
                    }
                }
                let region = profile.native_region.clone().map_err(|message| {
                    EngineError::InvalidDocument(format!(
                        "unsupported_cut_profile at profile: {message}"
                    ))
                })?;
                let direction = if request.reverse {
                    if request.direction != ExtrudeDirectionV2::Positive {
                        return Err(EngineError::InvalidDocument(
                            "Extrude Cut direction and legacy reverse flag conflict".into(),
                        ));
                    }
                    ExtrudeDirectionV2::Negative
                } else {
                    request.direction
                };
                let cut_tool = exact_blind_extrude_input(
                    region,
                    profile.normal_millionths,
                    distance,
                    direction,
                    request.tolerance_nanometers,
                )?;
                let sketch_id = crawler_document::SketchId(source.sketch.id.clone());
                let region_id = RegionReferenceId(profile.region_id.clone());
                let durable_support = durable_planar_support(&source.support)?;
                if let PlanarSupportReferenceV2::TopologyFace { reference } = &durable_support {
                    inputs.insert("support".into(), FeatureInput::Topology(reference.clone()));
                }
                let distance_parameter =
                    ParameterId(format!("parameter:{}:distance", request.feature_id));
                region_definition_v2 = Some(RegionDefinitionV2 {
                    id: region_id.clone(),
                    sketch: sketch_id.clone(),
                    outer_geometry_ids: profile.outer_geometry.clone(),
                    hole_geometry_ids: profile.hole_geometry.clone(),
                });
                feature_definition_v2 =
                    Some(FeatureDefinitionV2::exact_blind_cut_extrude_with_direction(
                        ProfileReferenceV2::SketchRegion {
                            sketch: sketch_id,
                            region: region_id,
                        },
                        durable_support,
                        distance_parameter,
                        direction,
                        BodyId(target.body_id.clone()),
                    ));
                bind_prepared_parameter(
                    &request.feature_id,
                    "distance",
                    "Distance",
                    ParameterValue::LengthNanometers(distance),
                    &mut parameter_bindings,
                    &mut parameter_definitions,
                );
                FeatureOperation::NativeExtrudeCutV2(NativeExtrudeCutInputV2 {
                    target,
                    region: cut_tool.region,
                    direction_nm: cut_tool.direction_nm,
                    tolerance_nm: request.tolerance_nanometers,
                })
            }
            SketchFeatureOperationId::RevolveCut => {
                let (target, _) = target.ok_or_else(|| {
                    EngineError::InvalidDocument("Revolve Cut requires target_body_id".into())
                })?;
                let (axis_origin_nm, raw_axis_direction_nm) = require_axis()?;
                let axis_direction_nm =
                    directed_axis(raw_axis_direction_nm, request.reverse, operation_name)?;
                let sweep_microdegrees = require_sweep()?;
                let divisions = require_divisions()?;
                bind_prepared_parameter(
                    &request.feature_id,
                    "angle",
                    "Angle",
                    ParameterValue::AngleMicrodegrees(sweep_microdegrees),
                    &mut parameter_bindings,
                    &mut parameter_definitions,
                );
                bind_prepared_parameter(
                    &request.feature_id,
                    "reverse",
                    "Reverse",
                    ParameterValue::Boolean(request.reverse),
                    &mut parameter_bindings,
                    &mut parameter_definitions,
                );
                FeatureOperation::RevolveCut(RevolveCutInput {
                    target,
                    profile_nm: first_profile()?,
                    axis_origin_nm,
                    axis_direction_nm,
                    sweep_microdegrees,
                    divisions,
                    tolerance_nm: request.tolerance_nanometers,
                })
            }
        };

        let canonical_operation_id = request.operation_id.schema_suffix();
        let feature = Feature {
            id: FeatureId(request.feature_id.clone()),
            display_name: operation_name.into(),
            component: self.engine.document().root_component.clone(),
            operation: crawler_document::OperationReference {
                schema_id: format!("crawler.part.{canonical_operation_id}"),
                schema_version: 1,
            },
            dependencies,
            inputs,
            parameters: parameter_bindings,
            suppressed: false,
        };
        let envelope = serde_json::json!({
            "transaction_id": request.transaction_id,
            "feature": feature,
            "parameter_definitions": parameter_definitions,
            "before": null,
            "region_definition_v2": region_definition_v2,
            "feature_definition_v2": feature_definition_v2,
            "request": FeatureRequest {
                schema_version: crawler_feature_kernel::FEATURE_KERNEL_SCHEMA_VERSION,
                document_id: self.engine.document().id.0.clone(),
                feature_id: request.feature_id,
                output_body_id: request.body_id,
                operation,
            },
        });
        if self.semantic_hash()? != before_hash || self.document_json()? != before_document {
            return Err(EngineError::InvalidDocument(
                "sketch feature envelope preparation mutated the accepted runtime".into(),
            ));
        }
        serde_json::to_string(&envelope)
            .map_err(|error| EngineError::Serialization(error.to_string()))
    }

    /// Execute a qualified feature-kernel request before atomically recording
    /// its complete request, body snapshot, and provenance result.
    pub fn execute_feature_json(&mut self, envelope_json: &str) -> Result<String, EngineError> {
        let envelope: AdvancedFeatureEnvelope = serde_json::from_str(envelope_json)
            .map_err(|error| EngineError::Serialization(error.to_string()))?;
        if envelope.request.document_id != self.engine.document().id.0 {
            return Err(EngineError::InvalidDocument(
                "feature request document identity differs".into(),
            ));
        }
        let feature = FeatureId(envelope.request.feature_id.clone());
        let Some(existing) = self.engine.document().features.get(&feature) else {
            return Err(EngineError::InvalidDocument(format!(
                "feature {} is missing",
                feature.0
            )));
        };
        if envelope.feature.id != feature || envelope.feature.component != existing.component {
            return Err(EngineError::InvalidDocument(
                "edited feature identity or component differs".into(),
            ));
        }
        validate_parameter_definitions(&envelope.feature, &envelope.parameter_definitions)?;
        let before_hash = self.semantic_hash()?;
        let result = match self.execute_feature_with_extent_edit(&envelope.request) {
            Ok(result) => result,
            Err(error) => return feature_refusal_json(error, before_hash),
        };
        let mut graph_document = self.engine.document().clone();
        graph_document
            .features
            .insert(feature.clone(), envelope.feature.clone());
        let graph_state = FeatureGraphDocument::new(graph_document)
            .map_err(|error| EngineError::InvalidDocument(error.to_string()))?;
        let recompute = recompute_from_here(&graph_state, &feature, &self.graph_rollback())
            .map_err(|error| EngineError::InvalidDocument(error.to_string()))?;
        let mut snapshots = accepted_body_snapshots(self.engine.document())?;
        snapshots.insert(result.output.body_id.clone(), result.output.clone());
        let request_json = serde_json::to_string(&envelope.request)
            .map_err(|error| EngineError::Serialization(error.to_string()))?;
        let result_json = serde_json::to_string(&result)
            .map_err(|error| EngineError::Serialization(error.to_string()))?;
        let mut changes = parameter_definition_changes(
            self.engine.document(),
            &envelope.feature,
            envelope.parameter_definitions,
        )?;
        changes.push(DocumentChange::EditFeature {
            feature: envelope.feature,
        });
        if let Some(definition) = envelope.region_definition_v2 {
            changes.push(DocumentChange::UpsertRegionDefinitionV2 {
                region: definition.id.clone(),
                definition,
            });
        }
        if let Some(definition) = envelope.feature_definition_v2 {
            changes.push(DocumentChange::UpsertFeatureDefinitionV2 {
                feature: feature.clone(),
                definition,
            });
        }
        changes.push(DocumentChange::AcceptFeatureResult {
            feature: feature.clone(),
            body: crawler_document::BodyId(result.output.body_id.clone()),
            request_json,
            result_json,
        });
        let started = EvaluationTimer::start();
        let mut recomputed = Vec::new();
        for downstream in recompute
            .evaluation_order
            .iter()
            .filter(|candidate| *candidate != &feature)
        {
            let Some(stored_request) = latest_kernel_request_with_snapshots(
                self.engine.document(),
                downstream,
                Some(&snapshots),
            )?
            else {
                continue;
            };
            let rebound_request = rebind_request_snapshots(stored_request, &snapshots)?;
            let downstream_result = match execute_feature(&rebound_request) {
                Ok(result) => result,
                Err(error) => return feature_refusal_json(error, before_hash),
            };
            let downstream_request_json = serde_json::to_string(&rebound_request)
                .map_err(|error| EngineError::Serialization(error.to_string()))?;
            let downstream_result_json = serde_json::to_string(&downstream_result)
                .map_err(|error| EngineError::Serialization(error.to_string()))?;
            snapshots.insert(
                downstream_result.output.body_id.clone(),
                downstream_result.output.clone(),
            );
            changes.push(DocumentChange::AcceptFeatureResult {
                feature: downstream.clone(),
                body: crawler_document::BodyId(downstream_result.output.body_id.clone()),
                request_json: downstream_request_json,
                result_json: downstream_result_json,
            });
            recomputed.push(serde_json::json!({
                "feature": downstream,
                "body": downstream_result.output.body_id,
            }));
        }
        self.engine
            .commit_changes(envelope.transaction_id, changes)?;
        self.record_evaluation_timing(&recompute.evaluation_order, started.elapsed_microseconds());
        serde_json::to_string(&serde_json::json!({
            "accepted": true,
            "result": result,
            "recomputed": recomputed,
            "before_hash": before_hash,
            "document_hash": self.semantic_hash()?,
        }))
        .map_err(|error| EngineError::Serialization(error.to_string()))
    }

    /// Execute first, then atomically create the feature and accept its result
    /// in one document transaction. Kernel refusal leaves the document, hash,
    /// and undo history byte-for-byte unchanged.
    pub fn execute_new_feature_json(&mut self, envelope_json: &str) -> Result<String, EngineError> {
        let envelope: AdvancedFeatureEnvelope = serde_json::from_str(envelope_json)
            .map_err(|error| EngineError::Serialization(error.to_string()))?;
        let before_hash = self.semantic_hash()?;
        if envelope.request.document_id != self.engine.document().id.0 {
            return runtime_refusal_json(
                "invalid_input",
                "document_id",
                "feature request document identity differs",
                "use the stable identity of the open document",
                before_hash,
            );
        }
        if envelope.request.feature_id != envelope.feature.id.0 {
            return runtime_refusal_json(
                "invalid_input",
                "feature_id",
                "feature and request identities differ",
                "use one caller-owned feature identity in both fields",
                before_hash,
            );
        }
        if self
            .engine
            .document()
            .features
            .contains_key(&envelope.feature.id)
        {
            return runtime_refusal_json(
                "invalid_input",
                "feature.id",
                "feature identity already exists",
                "supply a new stable feature identity",
                before_hash,
            );
        }
        validate_parameter_definitions(&envelope.feature, &envelope.parameter_definitions)?;
        let result = match execute_feature(&envelope.request) {
            Ok(result) => result,
            Err(error) => return feature_refusal_json(error, before_hash),
        };
        let request_json = serde_json::to_string(&envelope.request)
            .map_err(|error| EngineError::Serialization(error.to_string()))?;
        let result_json = serde_json::to_string(&result)
            .map_err(|error| EngineError::Serialization(error.to_string()))?;
        let feature_id = envelope.feature.id.clone();
        let mut changes = parameter_definition_changes(
            self.engine.document(),
            &envelope.feature,
            envelope.parameter_definitions,
        )?;
        changes.push(DocumentChange::CreateFeature {
            feature: envelope.feature,
            before: envelope.before,
        });
        if let Some(definition) = envelope.region_definition_v2 {
            changes.push(DocumentChange::UpsertRegionDefinitionV2 {
                region: definition.id.clone(),
                definition,
            });
        }
        if let Some(definition) = envelope.feature_definition_v2 {
            changes.push(DocumentChange::UpsertFeatureDefinitionV2 {
                feature: feature_id.clone(),
                definition,
            });
        }
        changes.push(DocumentChange::AcceptFeatureResult {
            feature: feature_id,
            body: crawler_document::BodyId(result.output.body_id.clone()),
            request_json,
            result_json,
        });
        self.engine
            .commit_changes(envelope.transaction_id, changes)?;
        self.timeline_rollback = TimelineRollback::End;
        serde_json::to_string(&serde_json::json!({
            "accepted": true,
            "result": result,
            "before_hash": before_hash,
            "document_hash": self.semantic_hash()?,
        }))
        .map_err(|error| EngineError::Serialization(error.to_string()))
    }

    pub fn undo(&mut self) -> Result<String, EngineError> {
        self.engine.undo()
    }

    pub fn redo(&mut self) -> Result<String, EngineError> {
        self.engine.redo()
    }

    /// Produce a deterministic interchange document from the accepted result.
    /// Export receives an immutable engine reference and cannot add history.
    pub fn export_text(&self, format: ExportFormat) -> Result<String, EngineError> {
        let artifact = if let Some((body, settings)) = self.accepted_body_for_export()? {
            export_body(&body, format, settings)
                .map_err(|error| EngineError::InvalidDocument(error.to_string()))?
        } else {
            export_part(&self.engine, format).map_err(|error| match error {
                crawler_interchange::ExportError::InvalidDocument(error) => error,
            })?
        };
        String::from_utf8(artifact.bytes)
            .map_err(|error| EngineError::Serialization(error.to_string()))
    }

    /// Resolve a durable, unsuppressed accepted kernel snapshot by its caller-
    /// owned body identity. This lookup is independent of the timeline cursor
    /// so a UI can resolve explicit boolean target/tool selections.
    pub fn body_snapshot_json(&self, body_id: &str) -> Result<String, EngineError> {
        let document = self.engine.document();
        for change in document
            .transactions
            .iter()
            .rev()
            .flat_map(|transaction| transaction.changes.iter().rev())
        {
            let DocumentChange::AcceptFeatureResult {
                feature,
                body,
                result_json,
                ..
            } = change
            else {
                continue;
            };
            if body.0 != body_id
                || document
                    .features
                    .get(feature)
                    .is_none_or(|record| record.suppressed)
            {
                continue;
            }
            let value: serde_json::Value = serde_json::from_str(result_json).map_err(|error| {
                EngineError::Serialization(format!(
                    "accepted feature result {} is invalid JSON: {error}",
                    feature.0
                ))
            })?;
            let snapshot: BodySnapshot =
                if value.get("kind").and_then(serde_json::Value::as_str) == Some("step_import") {
                    serde_json::from_value(value.get("body").cloned().ok_or_else(|| {
                        EngineError::InvalidDocument(format!(
                            "accepted STEP import {} has no body snapshot",
                            feature.0
                        ))
                    })?)
                    .map_err(|error| EngineError::Serialization(error.to_string()))?
                } else {
                    serde_json::from_value::<FeatureResult>(value)
                        .map_err(|error| EngineError::Serialization(error.to_string()))?
                        .output
                };
            if snapshot.body_id != body.0 {
                return Err(EngineError::InvalidDocument(format!(
                    "accepted feature result {} body identity differs from its transaction",
                    feature.0
                )));
            }
            return serde_json::to_string(&serde_json::json!({
                "found": true,
                "feature_id": feature,
                "body": snapshot,
            }))
            .map_err(|error| EngineError::Serialization(error.to_string()));
        }
        if body_id == crawler_part_engine::BODY_ID && self.base_body_is_active() {
            return serde_json::to_string(&serde_json::json!({
                "found": true,
                "feature_id": crawler_part_engine::EXTRUDE_FEATURE_ID,
                "body": self.base_body_snapshot()?,
            }))
            .map_err(|error| EngineError::Serialization(error.to_string()));
        }
        serde_json::to_string(&serde_json::json!({
            "found": false,
            "feature_id": null,
            "body": null,
            "error": {
                "category": "not_found",
                "field": "body_id",
                "message": format!("accepted unsuppressed body {body_id} was not found"),
                "recovery": "choose a body produced by an accepted unsuppressed feature",
            }
        }))
        .map_err(|error| EngineError::Serialization(error.to_string()))
    }

    /// Resolve the exact, body-qualified working frame for a current analytic
    /// planar B-rep face. This authority query deliberately reads the accepted
    /// kernel snapshot: renderer packets and topology fallback signatures are
    /// not inputs to either identity lookup or frame construction.
    pub fn planar_face_frame_json(
        &self,
        body_id: &str,
        face_stable_id_decimal: &str,
    ) -> Result<String, EngineError> {
        let face_stable_id = match parse_canonical_decimal_u64(face_stable_id_decimal) {
            Some(value) => value,
            None => {
                return planar_face_frame_diagnostic(
                    "invalid_face_stable_id",
                    "invalid_input",
                    "planar_face.face_stable_id",
                    body_id,
                    face_stable_id_decimal,
                    Vec::new(),
                    "face_stable_id must be a canonical unsigned decimal u64",
                );
            }
        };
        let Some((producer, snapshot)) = self.accepted_unsuppressed_body_snapshot(body_id)? else {
            if let Some((producer, status)) = self.stale_unsuppressed_body_producer(body_id) {
                return planar_face_frame_diagnostic(
                    "stale_body",
                    "stale_reference",
                    "planar_face.body_id",
                    body_id,
                    face_stable_id_decimal,
                    vec![producer.0],
                    &format!(
                        "body producer has no clean result at accepted revision {} ({status})",
                        self.engine.document().revision
                    ),
                );
            }
            return planar_face_frame_diagnostic(
                "missing_body",
                "not_found",
                "planar_face.body_id",
                body_id,
                face_stable_id_decimal,
                Vec::new(),
                "accepted unsuppressed body was not found",
            );
        };
        let solid: Solid = serde_json::from_slice(&snapshot.solid_json).map_err(|error| {
            EngineError::Serialization(format!(
                "accepted body {body_id} is not a kernel solid: {error}"
            ))
        })?;
        let Some(face) = solid
            .face_iter()
            .find(|face| face.stable_id().raw() == face_stable_id)
        else {
            return planar_face_frame_diagnostic(
                "missing_face",
                "not_found",
                "planar_face.face_stable_id",
                body_id,
                face_stable_id_decimal,
                Vec::new(),
                "face stable ID is absent from the accepted body",
            );
        };

        let Surface::Plane(plane) = face.oriented_surface() else {
            return planar_face_frame_diagnostic(
                "nonplanar_face",
                "unsupported",
                "planar_face.face_stable_id",
                body_id,
                face_stable_id_decimal,
                Vec::new(),
                "face is not carried by a Crawler analytic plane",
            );
        };
        let frame = match exact_planar_face_frame(face, plane) {
            Ok(frame) => frame,
            Err(failure) => {
                return planar_face_frame_diagnostic(
                    failure.code,
                    "invalid_geometry",
                    failure.field,
                    body_id,
                    face_stable_id_decimal,
                    Vec::new(),
                    failure.message,
                );
            }
        };
        let document = self.engine.document();
        let accepted_revision = document.revision;
        let component_id = document
            .bodies
            .get(&BodyId::from(body_id))
            .map(|body| body.component.0.clone())
            .or_else(|| {
                document
                    .features
                    .get(&producer)
                    .map(|feature| feature.component.0.clone())
            })
            .unwrap_or_else(|| document.root_component.0.clone());
        serde_json::to_string(&serde_json::json!({
            "found": true,
            "accepted_revision": accepted_revision,
            "body_id": body_id,
            "component_id": component_id,
            "producer_feature_id": producer,
            "face_kind": "face",
            "face_stable_id": face_stable_id.to_string(),
            "analytic_surface": "plane",
            "origin_vertex_stable_id": frame.origin_vertex_stable_id.to_string(),
            "handedness": "right",
            "scale_millionths": 1_000_000,
            "orthonormal_tolerance_millionths": PLANAR_FRAME_ORTHONORMAL_TOLERANCE_MILLIONTHS,
            "frame_convention": "oriented_plane_normal__least_aligned_principal_x__y_equals_normal_cross_x__lexicographic_boundary_vertex_origin",
            "frame": {
                "origin_nanometers": frame.origin_nanometers,
                "x_axis_millionths": frame.x_axis_millionths,
                "y_axis_millionths": frame.y_axis_millionths,
                "normal_millionths": frame.normal_millionths,
            }
        }))
        .map_err(|error| EngineError::Serialization(error.to_string()))
    }

    fn accepted_unsuppressed_body_snapshot(
        &self,
        body_id: &str,
    ) -> Result<Option<(FeatureId, BodySnapshot)>, EngineError> {
        let document = self.engine.document();
        for change in document
            .transactions
            .iter()
            .rev()
            .flat_map(|transaction| transaction.changes.iter().rev())
        {
            let DocumentChange::AcceptFeatureResult {
                feature,
                body,
                result_json,
                ..
            } = change
            else {
                continue;
            };
            if body.0 != body_id
                || document
                    .features
                    .get(feature)
                    .is_none_or(|record| record.suppressed)
                || !feature_is_clean_at_accepted_revision(document, feature)
            {
                continue;
            }
            let value: serde_json::Value = serde_json::from_str(result_json).map_err(|error| {
                EngineError::Serialization(format!(
                    "accepted feature result {} is invalid JSON: {error}",
                    feature.0
                ))
            })?;
            let snapshot: BodySnapshot =
                if value.get("kind").and_then(serde_json::Value::as_str) == Some("step_import") {
                    serde_json::from_value(value.get("body").cloned().ok_or_else(|| {
                        EngineError::InvalidDocument(format!(
                            "accepted STEP import {} has no body snapshot",
                            feature.0
                        ))
                    })?)
                    .map_err(|error| EngineError::Serialization(error.to_string()))?
                } else {
                    serde_json::from_value::<FeatureResult>(value)
                        .map_err(|error| EngineError::Serialization(error.to_string()))?
                        .output
                };
            if snapshot.body_id != body.0 {
                return Err(EngineError::InvalidDocument(format!(
                    "accepted feature result {} body identity differs from its transaction",
                    feature.0
                )));
            }
            return Ok(Some((feature.clone(), snapshot)));
        }
        let base = FeatureId::from(crawler_part_engine::EXTRUDE_FEATURE_ID);
        if body_id == crawler_part_engine::BODY_ID
            && self.base_body_is_active()
            && feature_is_clean_at_accepted_revision(document, &base)
        {
            return Ok(Some((base, self.base_body_snapshot()?)));
        }
        Ok(None)
    }

    fn stale_unsuppressed_body_producer(&self, body_id: &str) -> Option<(FeatureId, String)> {
        let document = self.engine.document();
        let producer = document
            .transactions
            .iter()
            .rev()
            .flat_map(|transaction| transaction.changes.iter().rev())
            .find_map(|change| match change {
                DocumentChange::AcceptFeatureResult { feature, body, .. }
                    if body.0 == body_id
                        && document
                            .features
                            .get(feature)
                            .is_some_and(|record| !record.suppressed) =>
                {
                    Some(feature.clone())
                }
                _ => None,
            })
            .or_else(|| {
                (body_id == crawler_part_engine::BODY_ID && self.base_body_is_active())
                    .then(|| FeatureId::from(crawler_part_engine::EXTRUDE_FEATURE_ID))
            })?;
        if feature_is_clean_at_accepted_revision(document, &producer) {
            return None;
        }
        let status = document
            .recompute
            .features
            .get(&producer)
            .map(|state| match state {
                crawler_document::FeatureRecomputeState::Clean { evaluated_revision } => {
                    format!("clean_at_revision_{evaluated_revision}")
                }
                crawler_document::FeatureRecomputeState::Dirty { since_revision } => {
                    format!("dirty_since_revision_{since_revision}")
                }
                crawler_document::FeatureRecomputeState::Failed {
                    attempted_revision,
                    diagnostic_code,
                } => format!("failed_at_revision_{attempted_revision}:{diagnostic_code}"),
            })
            .unwrap_or_else(|| "missing_recompute_state".to_owned());
        Some((producer, status))
    }

    /// Locate the rollback-aware accepted kernel result in durable history.
    fn accepted_body_for_export(
        &self,
    ) -> Result<Option<(BodySnapshot, BodyExportSettings)>, EngineError> {
        let Some(active) = self.active_result()? else {
            return Ok(None);
        };
        let tolerance_nanometers = if active.kind == "step_import" {
            active
                .result
                .pointer("/provenance/settings/tolerance_nanometers")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(10_000)
        } else {
            10_000
        };
        Ok(Some((
            active.body,
            BodyExportSettings {
                tolerance_nanometers,
            },
        )))
    }

    fn active_feature_order(&self) -> Vec<FeatureId> {
        let document = self.engine.document();
        let component_id = match &self.timeline_rollback {
            TimelineRollback::After(feature) => document
                .features
                .get(feature)
                .map(|record| &record.component)
                .unwrap_or(&document.root_component),
            _ => &document.root_component,
        };
        let mut order = document
            .components
            .get(component_id)
            .map(|component| component.feature_order.clone())
            .unwrap_or_default();
        match &self.timeline_rollback {
            TimelineRollback::BeforeFirst => order.clear(),
            TimelineRollback::After(feature) => {
                if let Some(index) = order.iter().position(|candidate| candidate == feature) {
                    order.truncate(index + 1);
                } else {
                    order.clear();
                }
            }
            TimelineRollback::End => {}
        }
        order
    }

    fn base_body_is_active(&self) -> bool {
        let document = self.engine.document();
        let base = FeatureId::from(crawler_part_engine::EXTRUDE_FEATURE_ID);
        self.active_feature_order().contains(&base)
            && document
                .features
                .get(&base)
                .is_some_and(|feature| !feature.suppressed)
    }

    /// Rebuild the exact base Extrude body from accepted document parameters.
    /// This bridges the parameter-driven base engine into the same immutable
    /// kernel snapshot contract used by every later advanced feature.
    fn base_body_snapshot(&self) -> Result<BodySnapshot, EngineError> {
        base_body_snapshot_from_dimensions(self.dimensions()?)
    }

    fn active_result(&self) -> Result<Option<ActiveResult>, EngineError> {
        let document = self.engine.document();
        for feature in self.active_feature_order().into_iter().rev() {
            if document
                .features
                .get(&feature)
                .is_none_or(|record| record.suppressed)
                || !matches!(
                    document.recompute.features.get(&feature),
                    Some(crawler_document::FeatureRecomputeState::Clean { .. })
                )
            {
                continue;
            }
            for change in document
                .transactions
                .iter()
                .rev()
                .flat_map(|transaction| transaction.changes.iter().rev())
            {
                let DocumentChange::AcceptFeatureResult {
                    feature: accepted_feature,
                    body,
                    result_json,
                    ..
                } = change
                else {
                    continue;
                };
                if accepted_feature != &feature {
                    continue;
                }
                let value: serde_json::Value =
                    serde_json::from_str(result_json).map_err(|error| {
                        EngineError::Serialization(format!(
                            "accepted feature result {} is invalid JSON: {error}",
                            feature.0
                        ))
                    })?;
                let (kind, snapshot, packet) =
                    if value.get("kind").and_then(serde_json::Value::as_str) == Some("step_import")
                    {
                        (
                        "step_import",
                        serde_json::from_value(value.get("body").cloned().ok_or_else(|| {
                            EngineError::InvalidDocument(format!(
                                "accepted STEP import {} has no body snapshot",
                                feature.0
                            ))
                        })?)
                        .map_err(|error| EngineError::Serialization(error.to_string()))?,
                        value
                            .get("render_packet")
                            .cloned()
                            .map(serde_json::from_value)
                            .transpose()
                            .map_err(|error| {
                                EngineError::Serialization(format!(
                                    "accepted STEP import {} has an invalid render packet: {error}",
                                    feature.0
                                ))
                            })?,
                    )
                    } else {
                        let result: FeatureResult =
                        serde_json::from_value(value.clone()).map_err(|error| {
                            EngineError::Serialization(format!(
                                "accepted feature result {} has an invalid kernel result: {error}",
                                feature.0
                            ))
                        })?;
                        let kind = if feature.0 == crawler_part_engine::EXTRUDE_FEATURE_ID {
                            "base_part"
                        } else {
                            "feature_result"
                        };
                        (kind, result.output, None)
                    };
                if snapshot.body_id != body.0 {
                    return Err(EngineError::InvalidDocument(format!(
                        "accepted feature result {} body identity differs from its transaction",
                        feature.0
                    )));
                }
                return Ok(Some(ActiveResult {
                    kind,
                    feature,
                    body: snapshot,
                    result: value,
                    packet,
                }));
            }
        }
        Ok(None)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ExactPlanarFaceFrame {
    origin_vertex_stable_id: u64,
    origin_nanometers: [i64; 3],
    x_axis_millionths: [i64; 3],
    y_axis_millionths: [i64; 3],
    normal_millionths: [i64; 3],
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct PlanarFrameFailure {
    code: &'static str,
    field: &'static str,
    message: &'static str,
}

const PLANAR_FRAME_SCALE_MILLIONTHS: i64 = 1_000_000;
const PLANAR_FRAME_ORTHONORMAL_TOLERANCE_MILLIONTHS: i64 = 2;

fn parse_canonical_decimal_u64(value: &str) -> Option<u64> {
    if value.is_empty()
        || !value.bytes().all(|byte| byte.is_ascii_digit())
        || (value.len() > 1 && value.starts_with('0'))
    {
        return None;
    }
    let parsed = value.parse::<u64>().ok()?;
    (parsed.to_string() == value).then_some(parsed)
}

fn planar_face_frame_diagnostic(
    code: &str,
    category: &str,
    field: &str,
    body_id: &str,
    face_stable_id: &str,
    referenced_body_ids: Vec<String>,
    message: &str,
) -> Result<String, EngineError> {
    serde_json::to_string(&serde_json::json!({
        "found": false,
        "body_id": body_id,
        "face_stable_id": face_stable_id,
        "error": {
            "code": code,
            "category": category,
            "field": field,
            "message": message,
            "reference": {
                "body_id": body_id,
                "face_stable_id": face_stable_id,
            },
            "referenced_body_ids": referenced_body_ids,
        }
    }))
    .map_err(|error| EngineError::Serialization(error.to_string()))
}

fn exact_planar_face_frame(
    face: &monstertruck_modeling::Face,
    plane: monstertruck_modeling::Plane,
) -> Result<ExactPlanarFaceFrame, PlanarFrameFailure> {
    let axis_u = plane.axis_u();
    let axis_v = plane.axis_v();
    if !vector_is_finite(axis_u) || !vector_is_finite(axis_v) {
        return Err(PlanarFrameFailure {
            code: "degenerate_planar_face_frame",
            field: "planar_face.frame.normal_millionths",
            message: "oriented plane axes contain a non-finite component",
        });
    }
    let raw_normal = axis_u.cross(axis_v);
    let normal_magnitude_squared = raw_normal.magnitude2();
    if !normal_magnitude_squared.is_finite() || normal_magnitude_squared <= 1.0e-24 {
        return Err(PlanarFrameFailure {
            code: "degenerate_planar_face_frame",
            field: "planar_face.frame.normal_millionths",
            message: "oriented plane axes do not define a non-degenerate normal",
        });
    }
    let normal = raw_normal / normal_magnitude_squared.sqrt();

    // Match the durable UI convention without consulting UI evidence: choose
    // the least normal-aligned principal axis (X, then Y, then Z on ties),
    // project it into the current oriented plane, and normalize it.
    let principal_axes = [Vector3::unit_x(), Vector3::unit_y(), Vector3::unit_z()];
    let mut seed = principal_axes[0];
    let mut alignment = seed.dot(normal).abs();
    for candidate in principal_axes.into_iter().skip(1) {
        let candidate_alignment = candidate.dot(normal).abs();
        if candidate_alignment < alignment {
            seed = candidate;
            alignment = candidate_alignment;
        }
    }
    let projected_x = seed - normal * seed.dot(normal);
    let projected_x_magnitude_squared = projected_x.magnitude2();
    if !projected_x_magnitude_squared.is_finite() || projected_x_magnitude_squared <= 1.0e-24 {
        return Err(PlanarFrameFailure {
            code: "degenerate_planar_face_frame",
            field: "planar_face.frame.x_axis_millionths",
            message: "oriented plane normal does not admit a canonical in-plane x axis",
        });
    }
    let x_axis = projected_x / projected_x_magnitude_squared.sqrt();
    let y_axis = normal.cross(x_axis);
    if !vector_is_finite(y_axis) || y_axis.magnitude2() <= 1.0e-24 {
        return Err(PlanarFrameFailure {
            code: "degenerate_planar_face_frame",
            field: "planar_face.frame.y_axis_millionths",
            message: "oriented plane does not admit a canonical in-plane y axis",
        });
    }

    let Some((origin_vertex_stable_id, origin)) = face
        .vertex_iter()
        .map(|vertex| (vertex.stable_id().raw(), vertex.point()))
        .min_by(|left, right| {
            left.1
                .x
                .total_cmp(&right.1.x)
                .then_with(|| left.1.y.total_cmp(&right.1.y))
                .then_with(|| left.1.z.total_cmp(&right.1.z))
                .then_with(|| left.0.cmp(&right.0))
        })
    else {
        return Err(PlanarFrameFailure {
            code: "degenerate_planar_face_frame",
            field: "planar_face.frame.origin_nanometers",
            message: "planar face has no boundary vertex for an exact origin",
        });
    };
    let Some(origin_nanometers) = exact_point_nanometers(origin) else {
        return Err(PlanarFrameFailure {
            code: "unsafe_planar_face_origin",
            field: "planar_face.frame.origin_nanometers",
            message: "canonical boundary vertex is not an exact safe-integer nanometer point",
        });
    };
    let Some(x_axis_millionths) = direction_millionths(x_axis) else {
        return Err(PlanarFrameFailure {
            code: "unsafe_planar_face_axis",
            field: "planar_face.frame.x_axis_millionths",
            message: "canonical x axis cannot be represented by safe integer millionths",
        });
    };
    let Some(y_axis_millionths) = direction_millionths(y_axis) else {
        return Err(PlanarFrameFailure {
            code: "unsafe_planar_face_axis",
            field: "planar_face.frame.y_axis_millionths",
            message: "canonical y axis cannot be represented by safe integer millionths",
        });
    };
    let Some(normal_millionths) = direction_millionths(normal) else {
        return Err(PlanarFrameFailure {
            code: "unsafe_planar_face_axis",
            field: "planar_face.frame.normal_millionths",
            message: "oriented normal cannot be represented by safe integer millionths",
        });
    };

    if !quantized_frame_is_orthonormal(x_axis_millionths, y_axis_millionths, normal_millionths) {
        return Err(PlanarFrameFailure {
            code: "degenerate_planar_face_frame",
            field: "planar_face.frame",
            message: "quantized planar frame is not right-handed and orthonormal within two millionths",
        });
    }

    Ok(ExactPlanarFaceFrame {
        origin_vertex_stable_id,
        origin_nanometers,
        x_axis_millionths,
        y_axis_millionths,
        normal_millionths,
    })
}

fn vector_is_finite(vector: Vector3) -> bool {
    vector.x.is_finite() && vector.y.is_finite() && vector.z.is_finite()
}

fn exact_point_nanometers(point: Point3) -> Option<[i64; 3]> {
    Some([
        exact_model_coordinate_nanometers(point.x)?,
        exact_model_coordinate_nanometers(point.y)?,
        exact_model_coordinate_nanometers(point.z)?,
    ])
}

fn exact_model_coordinate_nanometers(value: f64) -> Option<i64> {
    let scaled = value * 1_000_000.0;
    let rounded = scaled.round();
    if !scaled.is_finite()
        || rounded.abs() > SAFE_NANOMETER_BOUND as f64
        || (scaled - rounded).abs() > 1.0e-6
    {
        return None;
    }
    Some(rounded as i64)
}

fn direction_millionths(vector: Vector3) -> Option<[i64; 3]> {
    if !vector_is_finite(vector) {
        return None;
    }
    let scaled = [vector.x, vector.y, vector.z].map(|component| (component * 1_000_000.0).round());
    if scaled
        .iter()
        .any(|component| !component.is_finite() || component.abs() > SAFE_NANOMETER_BOUND as f64)
    {
        return None;
    }
    Some(scaled.map(|component| component as i64))
}

fn vector_from_i64(value: [i64; 3]) -> Vector3 {
    Vector3::new(value[0] as f64, value[1] as f64, value[2] as f64)
}

fn feature_is_clean_at_accepted_revision(
    document: &crawler_document::Document,
    feature: &FeatureId,
) -> bool {
    document.recompute.accepted_revision == document.revision
        && matches!(
            document.recompute.features.get(feature),
            Some(crawler_document::FeatureRecomputeState::Clean { .. })
        )
}

fn quantized_frame_is_orthonormal(x: [i64; 3], y: [i64; 3], normal: [i64; 3]) -> bool {
    let x = vector_from_i64(x);
    let y = vector_from_i64(y);
    let normal = vector_from_i64(normal);
    let scale = PLANAR_FRAME_SCALE_MILLIONTHS as f64;
    let tolerance = PLANAR_FRAME_ORTHONORMAL_TOLERANCE_MILLIONTHS as f64;
    [x, y, normal]
        .into_iter()
        .all(|axis| (axis.magnitude() - scale).abs() <= tolerance)
        && x.dot(y).abs() <= tolerance * scale
        && x.dot(normal).abs() <= tolerance * scale
        && y.dot(normal).abs() <= tolerance * scale
        && x.cross(y).dot(normal) > 0.0
}

fn base_body_snapshot_from_dimensions(
    dimensions: PartDimensions,
) -> Result<BodySnapshot, EngineError> {
    let scale = [
        dimensions.width_nanometers as f64 / 1_000_000.0,
        dimensions.height_nanometers as f64 / 1_000_000.0,
        dimensions.distance_nanometers as f64 / 1_000_000.0,
    ];
    let vertex = builder::vertex(Point3::new(0.0, 0.0, 0.0));
    let edge = builder::extrude(&vertex, Vector3::unit_x() * scale[0]);
    let face = builder::extrude(&edge, Vector3::unit_y() * scale[1]);
    let mut solid: Solid = builder::extrude(&face, Vector3::unit_z() * scale[2]);
    solid.ensure_topology_stable_ids();
    let solid_json = serde_json::to_vec(&solid)
        .map_err(|error| EngineError::Serialization(error.to_string()))?;
    Ok(BodySnapshot {
        body_id: crawler_part_engine::BODY_ID.into(),
        solid_json,
        evidence: GeometryEvidence {
            vertex_count: solid.vertex_iter().count(),
            edge_count: solid.edge_iter().count(),
            face_count: solid.face_iter().count(),
            bounds_nm: AxisAlignedBoundsNm {
                min: [0; 3],
                max: [
                    dimensions.width_nanometers,
                    dimensions.height_nanometers,
                    dimensions.distance_nanometers,
                ],
            },
            volume_model_units3: scale.into_iter().product(),
            surface_area_nm2: None,
            centroid_nm: None,
            deterministic_digest: format!(
                "base-extrude:{}x{}x{}",
                dimensions.width_nanometers,
                dimensions.height_nanometers,
                dimensions.distance_nanometers
            ),
        },
    })
}

fn accepted_body_snapshots(
    document: &crawler_document::Document,
) -> Result<BTreeMap<String, BodySnapshot>, EngineError> {
    let mut snapshots = BTreeMap::new();
    for change in document
        .transactions
        .iter()
        .flat_map(|transaction| transaction.changes.iter())
    {
        let DocumentChange::AcceptFeatureResult {
            feature,
            body,
            result_json,
            ..
        } = change
        else {
            continue;
        };
        let value: serde_json::Value = serde_json::from_str(result_json).map_err(|error| {
            EngineError::Serialization(format!(
                "accepted feature result {} is invalid JSON: {error}",
                feature.0
            ))
        })?;
        let snapshot: BodySnapshot =
            if value.get("kind").and_then(serde_json::Value::as_str) == Some("step_import") {
                serde_json::from_value(value.get("body").cloned().ok_or_else(|| {
                    EngineError::InvalidDocument(format!(
                        "accepted STEP import {} has no body snapshot",
                        feature.0
                    ))
                })?)
                .map_err(|error| EngineError::Serialization(error.to_string()))?
            } else {
                serde_json::from_value::<FeatureResult>(value)
                    .map_err(|error| EngineError::Serialization(error.to_string()))?
                    .output
            };
        if snapshot.body_id != body.0 {
            return Err(EngineError::InvalidDocument(format!(
                "accepted feature result {} body identity differs from its transaction",
                feature.0
            )));
        }
        snapshots.insert(snapshot.body_id.clone(), snapshot);
    }
    Ok(snapshots)
}

/// Resolve only the latest accepted body for one feature. Extent preview/edit
/// runs on every input event, so rebuilding the complete historical body map
/// here would make latency grow with the document transaction count.
fn latest_accepted_body_snapshot(
    document: &crawler_document::Document,
    feature: &FeatureId,
    expected_body_id: &str,
) -> Result<Option<BodySnapshot>, EngineError> {
    for change in document
        .transactions
        .iter()
        .rev()
        .flat_map(|transaction| transaction.changes.iter().rev())
    {
        let DocumentChange::AcceptFeatureResult {
            feature: accepted_feature,
            body,
            result_json,
            ..
        } = change
        else {
            continue;
        };
        if accepted_feature != feature || body.0 != expected_body_id {
            continue;
        }
        let value: serde_json::Value = serde_json::from_str(result_json).map_err(|error| {
            EngineError::Serialization(format!(
                "accepted feature result {} is invalid JSON: {error}",
                feature.0
            ))
        })?;
        let snapshot = serde_json::from_value::<FeatureResult>(value)
            .map_err(|error| EngineError::Serialization(error.to_string()))?
            .output;
        if snapshot.body_id != expected_body_id {
            return Err(EngineError::InvalidDocument(format!(
                "accepted feature result {} body identity differs from its transaction",
                feature.0
            )));
        }
        return Ok(Some(snapshot));
    }
    Ok(None)
}

fn cut_recompute_target_snapshot(
    document: &crawler_document::Document,
    cut_feature: &FeatureId,
    target_body: &BodyId,
    pending_snapshots: Option<&BTreeMap<String, BodySnapshot>>,
) -> Result<BodySnapshot, EngineError> {
    let current_cut = latest_accepted_body_snapshot(document, cut_feature, &target_body.0)?;
    if let Some(pending) = pending_snapshots.and_then(|values| values.get(&target_body.0))
        && current_cut.as_ref() != Some(pending)
    {
        // An upstream feature has already been recomputed in this isolated
        // transaction. Its same-identity body supersedes the stored pre-Cut
        // source for this evaluation only.
        return Ok(pending.clone());
    }
    let feature = document.features.get(cut_feature).ok_or_else(|| {
        EngineError::InvalidDocument(format!("Cut feature {} is missing", cut_feature.0))
    })?;
    for dependency in &feature.dependencies {
        if let Some(snapshot) = latest_accepted_body_snapshot(document, dependency, &target_body.0)?
        {
            return Ok(snapshot);
        }
        if dependency.0 == crawler_part_engine::EXTRUDE_FEATURE_ID
            && target_body.0 == crawler_part_engine::BODY_ID
        {
            let dimensions =
                crawler_part_engine::PartEngine::from_document(document.clone())?.dimensions()?;
            return base_body_snapshot_from_dimensions(dimensions);
        }
    }
    Err(EngineError::InvalidDocument(format!(
        "missing_cut_target at target: Cut feature {} has no pre-Cut snapshot for {}",
        cut_feature.0, target_body.0
    )))
}

fn topology_face_frame_from_snapshots(
    document: &crawler_document::Document,
    reference_id: &crawler_document::TopologyReferenceId,
    expected_component: &ComponentId,
    snapshots: &BTreeMap<String, BodySnapshot>,
    operation_name: &str,
) -> Result<ResolvedPlanarFrame, EngineError> {
    let reference = document.topology_references.get(reference_id).ok_or_else(|| {
        EngineError::InvalidDocument(format!(
            "missing_topology_face_support at extrude.support: {operation_name} referenced entity {} is missing",
            reference_id.0
        ))
    })?;
    if reference.kind != crawler_document::TopologyKind::Face {
        return Err(EngineError::InvalidDocument(format!(
            "wrong_kind_topology_face_support at extrude.support: reference {} is not a face",
            reference_id.0
        )));
    }
    let body = document.bodies.get(&reference.body).ok_or_else(|| {
        EngineError::InvalidDocument(format!(
            "missing_topology_face_body at extrude.support: body {} is missing",
            reference.body.0
        ))
    })?;
    let producer = document.features.get(&reference.producer).ok_or_else(|| {
        EngineError::InvalidDocument(format!(
            "missing_topology_face_producer at extrude.support: producer {} is missing",
            reference.producer.0
        ))
    })?;
    if !body.accepts_producer(&reference.producer)
        || reference.component != *expected_component
        || body.component != reference.component
        || producer.component != reference.component
    {
        return Err(EngineError::InvalidDocument(format!(
            "invalid_topology_face_ownership at extrude.support: reference {} body, producer, and component do not agree",
            reference_id.0
        )));
    }
    if producer.suppressed {
        return Err(EngineError::InvalidDocument(format!(
            "suppressed_topology_face_producer at extrude.support: reference {} producer {} is suppressed",
            reference_id.0, reference.producer.0
        )));
    }
    let snapshot = snapshots.get(&reference.body.0).ok_or_else(|| {
        EngineError::InvalidDocument(format!(
            "missing_topology_face_snapshot at extrude.support: body {} has no pending current snapshot",
            reference.body.0
        ))
    })?;
    let solid: Solid = serde_json::from_slice(&snapshot.solid_json).map_err(|error| {
        EngineError::Serialization(format!(
            "accepted body {} is not a kernel solid: {error}",
            reference.body.0
        ))
    })?;
    let face = solid
        .face_iter()
        .find(|face| face.stable_id().raw() == reference.stable_kernel_id)
        .ok_or_else(|| {
            EngineError::InvalidDocument(format!(
                "missing_face at extrude.support: reference {} stable face {} is absent from current body {}",
                reference_id.0, reference.stable_kernel_id, reference.body.0
            ))
        })?;
    let Surface::Plane(plane) = face.oriented_surface() else {
        return Err(EngineError::InvalidDocument(format!(
            "nonplanar_face at extrude.support: reference {} is not an analytic plane",
            reference_id.0
        )));
    };
    let frame = exact_planar_face_frame(face, plane).map_err(|failure| {
        EngineError::InvalidDocument(format!(
            "{} at extrude.support: {}",
            failure.code, failure.message
        ))
    })?;
    Ok(ResolvedPlanarFrame {
        origin_nanometers: frame.origin_nanometers,
        x_axis_millionths: frame.x_axis_millionths,
        y_axis_millionths: frame.y_axis_millionths,
        normal_millionths: frame.normal_millionths,
    })
}

fn latest_kernel_request(
    document: &crawler_document::Document,
    feature: &FeatureId,
) -> Result<Option<FeatureRequest>, EngineError> {
    latest_kernel_request_with_snapshots(document, feature, None)
}

fn latest_kernel_request_with_snapshots(
    document: &crawler_document::Document,
    feature: &FeatureId,
    snapshots: Option<&BTreeMap<String, BodySnapshot>>,
) -> Result<Option<FeatureRequest>, EngineError> {
    if let Some(definition) = document.feature_definitions_v2.get(feature) {
        let crawler_document::FeatureOperationV2::Extrude {
            profile,
            support,
            extent,
            ..
        } = &definition.operation;
        let crawler_document::ProfileReferenceV2::SketchRegion { sketch, region } = profile;
        let region_definition = document.region_definitions_v2.get(region).ok_or_else(|| {
            EngineError::InvalidDocument(format!(
                "feature {} references missing region {}",
                feature.0, region.0
            ))
        })?;
        if &region_definition.sketch != sketch {
            return Err(EngineError::InvalidDocument(format!(
                "feature {} region belongs to a different sketch",
                feature.0
            )));
        }
        let sketch_document = document.sketches.get(sketch).ok_or_else(|| {
            EngineError::InvalidDocument(format!(
                "feature {} references missing sketch {}",
                feature.0, sketch.0
            ))
        })?;
        if &durable_planar_support(&sketch_document.support)? != support {
            return Err(EngineError::InvalidDocument(format!(
                "feature {} support differs from its sketch support",
                feature.0
            )));
        }
        let frame = match (&sketch_document.support, snapshots) {
            (crawler_document::SketchSupport::Topology { reference }, Some(snapshots)) => {
                topology_face_frame_from_snapshots(
                    document,
                    reference,
                    &sketch_document.component,
                    snapshots,
                    "Extrude recompute",
                )?
            }
            (crawler_document::SketchSupport::Topology { reference }, None) => {
                return Err(EngineError::InvalidDocument(format!(
                    "topology_face_authority_required at extrude.support: recompute of feature {} requires current snapshot authority for reference {}",
                    feature.0, reference.0
                )));
            }
            _ => sketch_plane_frame(document, &sketch_document.support, "Extrude recompute")?,
        };
        let profile_sketch = document_sketch_profile_geometry(sketch_document);
        let outer = region_definition
            .outer_geometry_ids
            .iter()
            .cloned()
            .map(crawler_sketch::GeometryId)
            .collect::<Vec<_>>();
        let holes = region_definition
            .hole_geometry_ids
            .iter()
            .map(|boundary| {
                boundary
                    .iter()
                    .cloned()
                    .map(crawler_sketch::GeometryId)
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();
        let region = native_profile_region(
            &profile_sketch,
            &outer,
            &holes,
            frame.x_axis_millionths,
            frame.y_axis_millionths,
        )
        .and_then(|region| translate_native_profile_region(region, frame.origin_nanometers))?;
        let crawler_document::ExtrudeExtentV2::Blind {
            distance,
            direction,
        } = extent;
        let distance_nm = match document.parameters.get(distance).map(|value| &value.value) {
            Some(ParameterValue::LengthNanometers(value)) if *value > 0 => *value,
            _ => {
                return Err(EngineError::InvalidDocument(format!(
                    "feature {} has no positive length distance",
                    feature.0
                )));
            }
        };
        let tool = exact_blind_extrude_input(
            region,
            frame.normal_millionths,
            distance_nm,
            *direction,
            10_000,
        )?;
        let (output_body_id, operation) = match &definition.result {
            crawler_document::FeatureResultV2::NewBody { body } => {
                (body.0.clone(), FeatureOperation::NativeExtrudeV2(tool))
            }
            crawler_document::FeatureResultV2::Cut => {
                let participant = definition.participant_bodies.first().ok_or_else(|| {
                    EngineError::InvalidDocument(format!(
                        "feature {} Cut definition has no explicit target body",
                        feature.0
                    ))
                })?;
                let target =
                    cut_recompute_target_snapshot(document, feature, &participant.body, snapshots)?;
                (
                    participant.body.0.clone(),
                    FeatureOperation::NativeExtrudeCutV2(NativeExtrudeCutInputV2 {
                        target,
                        region: tool.region,
                        direction_nm: tool.direction_nm,
                        tolerance_nm: tool.tolerance_nm,
                    }),
                )
            }
        };
        return Ok(Some(FeatureRequest {
            schema_version: crawler_feature_kernel::FEATURE_KERNEL_SCHEMA_VERSION,
            document_id: document.id.0.clone(),
            feature_id: feature.0.clone(),
            output_body_id,
            operation,
        }));
    }
    for change in document
        .transactions
        .iter()
        .rev()
        .flat_map(|transaction| transaction.changes.iter().rev())
    {
        let DocumentChange::AcceptFeatureResult {
            feature: accepted_feature,
            request_json,
            ..
        } = change
        else {
            continue;
        };
        if accepted_feature != feature {
            continue;
        }
        let value: serde_json::Value = serde_json::from_str(request_json).map_err(|error| {
            EngineError::Serialization(format!(
                "accepted feature request {} is invalid JSON: {error}",
                feature.0
            ))
        })?;
        if value.get("operation").is_none() || value.get("output_body_id").is_none() {
            return Ok(None);
        }
        let request = serde_json::from_value(value).map_err(|error| {
            EngineError::Serialization(format!(
                "accepted feature request {} is not a kernel request: {error}",
                feature.0
            ))
        })?;
        return Ok(Some(request));
    }
    Ok(None)
}

fn rebind_request_snapshots(
    request: FeatureRequest,
    snapshots: &BTreeMap<String, BodySnapshot>,
) -> Result<FeatureRequest, EngineError> {
    if matches!(&request.operation, FeatureOperation::NativeExtrudeCutV2(_)) {
        // V2 Cut reconstruction already selected either the stored pre-Cut
        // dependency snapshot or the pending upstream same-identity result.
        // A body-id-only replacement here would incorrectly feed the Cut's own
        // latest output back into itself.
        return Ok(request);
    }
    fn rebind(value: &mut serde_json::Value, snapshots: &BTreeMap<String, BodySnapshot>) {
        match value {
            serde_json::Value::Array(values) => {
                for value in values {
                    rebind(value, snapshots);
                }
            }
            serde_json::Value::Object(object) => {
                let replacement = object
                    .get("body_id")
                    .and_then(serde_json::Value::as_str)
                    .and_then(|body_id| snapshots.get(body_id))
                    .filter(|_| {
                        object.contains_key("solid_json") && object.contains_key("evidence")
                    })
                    .and_then(|snapshot| serde_json::to_value(snapshot).ok());
                if let Some(replacement) = replacement {
                    *value = replacement;
                } else {
                    for value in object.values_mut() {
                        rebind(value, snapshots);
                    }
                }
            }
            _ => {}
        }
    }

    let mut value = serde_json::to_value(request)
        .map_err(|error| EngineError::Serialization(error.to_string()))?;
    rebind(&mut value, snapshots);
    serde_json::from_value(value).map_err(|error| EngineError::Serialization(error.to_string()))
}

struct ActiveResult {
    kind: &'static str,
    feature: FeatureId,
    body: BodySnapshot,
    result: serde_json::Value,
    packet: Option<RenderPacket>,
}

fn active_packet(active: &ActiveResult, tolerance: f64) -> Result<RenderPacket, EngineError> {
    active
        .packet
        .clone()
        .map(Ok)
        .unwrap_or_else(|| packet_for_snapshot(&active.body, tolerance))
}

fn packet_for_snapshot(
    snapshot: &BodySnapshot,
    tolerance: f64,
) -> Result<RenderPacket, EngineError> {
    let mut solid: Solid = serde_json::from_slice(&snapshot.solid_json).map_err(|error| {
        EngineError::Serialization(format!(
            "accepted body {} is not a kernel solid: {error}",
            snapshot.body_id
        ))
    })?;
    packet_from_solid(&mut solid, tolerance)
        .map_err(|error| EngineError::InvalidDocument(error.to_string()))
}

fn packet_value(body_id: Option<&str>, packet: Option<RenderPacket>) -> serde_json::Value {
    let Some(packet) = packet else {
        return serde_json::json!({
            "body_id": null,
            "packet": {
                "version": crawler_render_packet::RENDER_PACKET_VERSION,
                "positions": [], "normals": [], "triangleIndices": [], "faceRanges": [],
                "edgePositions": [], "edgeRanges": [], "vertexPositions": [],
                "vertexPickTokens": [], "pickTable": [], "bounds": [],
            },
        });
    };
    let face_ranges = packet
        .face_ranges
        .iter()
        .flat_map(|range| [range.first_index, range.index_count, range.pick_token])
        .collect::<Vec<_>>();
    let edge_ranges = packet
        .edge_ranges
        .iter()
        .flat_map(|range| [range.first_vertex, range.vertex_count, range.pick_token])
        .collect::<Vec<_>>();
    let pick_table = packet
        .pick_table
        .iter()
        .flat_map(|record| {
            [
                record.token,
                record.kind as u32,
                record.stable_id as u32,
                (record.stable_id >> 32) as u32,
            ]
        })
        .collect::<Vec<_>>();
    let bounds = packet
        .bounds
        .min
        .into_iter()
        .chain(packet.bounds.max)
        .collect::<Vec<_>>();
    serde_json::json!({
        "body_id": body_id,
        "packet": {
            "version": packet.version,
            "positions": packet.positions,
            "normals": packet.normals,
            "triangleIndices": packet.triangle_indices,
            "faceRanges": face_ranges,
            "edgePositions": packet.edge_positions,
            "edgeRanges": edge_ranges,
            "vertexPositions": packet.vertex_positions,
            "vertexPickTokens": packet.vertex_pick_tokens,
            "pickTable": pick_table,
            "bounds": bounds,
        },
    })
}

fn feature_refusal_json(error: FeatureError, document_hash: String) -> Result<String, EngineError> {
    serde_json::to_string(&serde_json::json!({
        "accepted": false,
        "error": error,
        "document_hash": document_hash,
    }))
    .map_err(|error| EngineError::Serialization(error.to_string()))
}

fn empty_render_value() -> serde_json::Value {
    packet_value(None, None)
}

fn preview_feature_refusal_json(
    error: FeatureError,
    document_hash: String,
) -> Result<String, EngineError> {
    serde_json::to_string(&serde_json::json!({
        "accepted": false,
        "error": error,
        "document_hash": document_hash,
        "render": empty_render_value(),
    }))
    .map_err(|error| EngineError::Serialization(error.to_string()))
}

fn cut_error_code(message: &str) -> &'static str {
    let lower = message.to_ascii_lowercase();
    if lower.contains("missing_construction_plane_support") {
        "missing_construction_plane_support"
    } else if lower.contains("suppressed_construction_plane_support") {
        "suppressed_construction_plane_support"
    } else if lower.contains("invalid_construction_plane_dependency") {
        "invalid_construction_plane_dependency"
    } else if lower.contains("profile is open or branched")
        || lower.contains("requires at least one closed profile")
        || lower.contains("profile boundary is empty")
        || lower.contains("profile endpoints do not close")
    {
        "invalid_cut_profile"
    } else if lower.contains("stale_cut_target") {
        "stale_cut_target"
    } else if lower.contains("suppressed_cut_target") {
        "suppressed_cut_target"
    } else if lower.contains("wrong_component_cut_target") {
        "wrong_component_cut_target"
    } else if lower.contains("wrong_owner_cut_target") {
        "wrong_owner_cut_target"
    } else if lower.contains("no_intersection") {
        "no_intersection"
    } else if lower.contains("remove_all_material") {
        "remove_all_material"
    } else if lower.contains("nonmanifold_result") || lower.contains("not oriented and closed") {
        "nonmanifold_result"
    } else if lower.contains("requires one explicit target_body_id") {
        "explicit_target_required"
    } else if lower.contains("retain target_body_id")
        || lower.contains("replace its explicit target")
    {
        "wrong_owner_cut_target"
    } else if lower.contains("missing_cut_target") || lower.contains("target body") {
        "missing_cut_target"
    } else {
        "cut_refused"
    }
}

fn cut_error_category(code: &str) -> &'static str {
    match code {
        "missing_cut_target"
        | "stale_cut_target"
        | "suppressed_cut_target"
        | "missing_construction_plane_support"
        | "suppressed_construction_plane_support"
        | "invalid_construction_plane_dependency" => "reference",
        "invalid_cut_profile" => "profile",
        "wrong_component_cut_target" | "wrong_owner_cut_target" => "ownership",
        "no_intersection" | "remove_all_material" | "nonmanifold_result" => "boolean",
        "explicit_target_required" => "target",
        _ => "invalid_input",
    }
}

fn cut_error_field(code: &str) -> &'static str {
    match code {
        "missing_construction_plane_support"
        | "suppressed_construction_plane_support"
        | "invalid_construction_plane_dependency" => "extrude.support",
        "invalid_cut_profile" => "operation.profile",
        "no_intersection" => "operation.profile",
        "remove_all_material" | "nonmanifold_result" => "operation.result",
        "explicit_target_required" => "participant_bodies",
        _ => "participant_bodies.target",
    }
}

fn cut_sketch_extrude_refusal_json(
    message: &str,
    request: &SketchExtrudeRequest,
    document_hash: String,
    preview: bool,
) -> Result<String, EngineError> {
    let code = cut_error_code(message);
    let (reference_kind, referenced_entity_ids) = match code {
        "missing_construction_plane_support"
        | "suppressed_construction_plane_support"
        | "invalid_construction_plane_dependency" => {
            let reference = match &request.support {
                crawler_document::SketchSupport::ConstructionPlaneReference { plane } => {
                    Some(plane.0.clone())
                }
                crawler_document::SketchSupport::Topology { reference } => {
                    Some(reference.0.clone())
                }
                crawler_document::SketchSupport::OriginPlane { .. }
                | crawler_document::SketchSupport::OriginPlaneReference { .. } => None,
            };
            ("support", reference.into_iter().collect::<Vec<_>>())
        }
        "invalid_cut_profile" => ("sketch", vec![request.sketch.id.clone()]),
        _ => (
            "body",
            request
                .target_body_id
                .clone()
                .into_iter()
                .collect::<Vec<_>>(),
        ),
    };
    cut_runtime_refusal_json_with_references(
        message,
        request.target_body_id.as_deref(),
        reference_kind,
        referenced_entity_ids,
        document_hash,
        preview,
    )
}

fn cut_runtime_refusal_json(
    message: &str,
    target_body_id: Option<&str>,
    document_hash: String,
    preview: bool,
) -> Result<String, EngineError> {
    let referenced_entity_ids = target_body_id
        .into_iter()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    cut_runtime_refusal_json_with_references(
        message,
        target_body_id,
        "body",
        referenced_entity_ids,
        document_hash,
        preview,
    )
}

fn cut_runtime_refusal_json_with_references(
    message: &str,
    target_body_id: Option<&str>,
    reference_kind: &str,
    referenced_entity_ids: Vec<String>,
    document_hash: String,
    preview: bool,
) -> Result<String, EngineError> {
    let code = cut_error_code(message);
    let problematic_reference = referenced_entity_ids.first().map(|stable_id| {
        serde_json::json!({
            "kind": reference_kind, "stable_id": stable_id, "ordered_index": 0
        })
    });
    let mut value = serde_json::json!({
        "accepted": false,
        "result_mode": "cut",
        "target_body_id": target_body_id,
        "error": {
            "category": cut_error_category(code),
            "code": code,
            "message": message,
            "field": cut_error_field(code),
            "field_path": cut_error_field(code),
            "recovery": "repair the explicit Cut target, profile, or extent and retry",
            "preserved_inputs": [],
            "problematic_reference": problematic_reference,
            "referenced_entity_ids": referenced_entity_ids,
        },
        "document_hash": document_hash,
    });
    if preview {
        value["render"] = empty_render_value();
    }
    serde_json::to_string(&value).map_err(|error| EngineError::Serialization(error.to_string()))
}

fn cut_feature_refusal_json(
    error: FeatureError,
    target_body_id: Option<&str>,
    document_hash: String,
    preview: bool,
) -> Result<String, EngineError> {
    let code = cut_error_code(&error.message);
    let mut serialized = serde_json::to_value(error)
        .map_err(|error| EngineError::Serialization(error.to_string()))?;
    serialized["category"] = serde_json::json!(cut_error_category(code));
    serialized["code"] = serde_json::json!(code);
    serialized["field_path"] = serde_json::json!(cut_error_field(code));
    serialized["referenced_entity_ids"] =
        serde_json::json!(target_body_id.into_iter().collect::<Vec<_>>());
    let mut value = serde_json::json!({
        "accepted": false,
        "result_mode": "cut",
        "target_body_id": target_body_id,
        "error": serialized,
        "document_hash": document_hash,
    });
    if preview {
        value["render"] = empty_render_value();
    }
    serde_json::to_string(&value).map_err(|error| EngineError::Serialization(error.to_string()))
}

fn add_cut_code_to_refusal_json(
    response: &str,
    target_body_id: Option<&str>,
) -> Result<String, EngineError> {
    let mut value: serde_json::Value = serde_json::from_str(response)
        .map_err(|error| EngineError::Serialization(error.to_string()))?;
    if value["accepted"] == false {
        let message = value["error"]["message"].as_str().unwrap_or("Cut refused");
        let code = cut_error_code(message);
        value["result_mode"] = serde_json::json!("cut");
        value["target_body_id"] = serde_json::json!(target_body_id);
        value["error"]["category"] = serde_json::json!(cut_error_category(code));
        value["error"]["code"] = serde_json::json!(code);
        value["error"]["field_path"] = serde_json::json!(cut_error_field(code));
        value["error"]["referenced_entity_ids"] =
            serde_json::json!(target_body_id.into_iter().collect::<Vec<_>>());
    }
    serde_json::to_string(&value).map_err(|error| EngineError::Serialization(error.to_string()))
}

fn preview_runtime_refusal_json(
    category: &str,
    field: &str,
    message: &str,
    recovery: &str,
    document_hash: String,
) -> Result<String, EngineError> {
    serde_json::to_string(&serde_json::json!({
        "accepted": false,
        "error": {
            "category": category,
            "message": message,
            "field": field,
            "recovery": recovery,
            "preserved_inputs": [],
            "problematic_reference": null,
        },
        "document_hash": document_hash,
        "render": empty_render_value(),
    }))
    .map_err(|error| EngineError::Serialization(error.to_string()))
}

fn runtime_refusal_json(
    category: &str,
    field: &str,
    message: &str,
    recovery: &str,
    document_hash: String,
) -> Result<String, EngineError> {
    serde_json::to_string(&serde_json::json!({
        "accepted": false,
        "error": {
            "category": category,
            "message": message,
            "field": field,
            "recovery": recovery,
            "preserved_inputs": [],
            "problematic_reference": null,
        },
        "document_hash": document_hash,
    }))
    .map_err(|error| EngineError::Serialization(error.to_string()))
}

fn scale_xyz(values: &mut [f32], scale: [f32; 3]) {
    for point in values.chunks_exact_mut(3) {
        point[0] *= scale[0];
        point[1] *= scale[1];
        point[2] *= scale[2];
    }
}

fn sketch_feature(
    sketch: &crawler_document::Sketch,
    support_producer: Option<FeatureId>,
    existing: Option<&Feature>,
) -> Feature {
    let suffix = sketch.id.0.strip_prefix("sketch:").unwrap_or(&sketch.id.0);
    let mut feature = existing.cloned().unwrap_or_else(|| Feature {
        id: FeatureId(format!("feature:sketch:{suffix}")),
        display_name: sketch.display_name.clone(),
        component: sketch.component.clone(),
        operation: crawler_document::OperationReference {
            schema_id: "crawler.operation.sketch".into(),
            schema_version: 1,
        },
        dependencies: Vec::new(),
        inputs: BTreeMap::new(),
        parameters: BTreeMap::new(),
        suppressed: false,
    });
    feature.display_name = sketch.display_name.clone();
    feature.component = sketch.component.clone();
    feature.operation = crawler_document::OperationReference {
        schema_id: "crawler.operation.sketch".into(),
        schema_version: 1,
    };
    feature
        .inputs
        .insert("sketch".to_owned(), FeatureInput::Sketch(sketch.id.clone()));
    if let crawler_document::SketchSupport::Topology { reference } = &sketch.support {
        feature.inputs.insert(
            "support".to_owned(),
            FeatureInput::Topology(reference.clone()),
        );
    } else {
        feature.inputs.remove("support");
    }
    feature.dependencies = support_producer.into_iter().collect();
    let generated_parameter_prefix = format!("parameter:{}:", sketch.id.0);
    feature
        .parameters
        .retain(|_, parameter| !parameter.0.starts_with(&generated_parameter_prefix));
    let mut dimension_index = 1_usize;
    for parameter in sketch
        .constraints
        .iter()
        .filter_map(stored_constraint_parameter)
    {
        if feature.parameters.values().any(|bound| bound == parameter) {
            continue;
        }
        while feature
            .parameters
            .contains_key(&format!("d{dimension_index}"))
        {
            dimension_index += 1;
        }
        feature
            .parameters
            .insert(format!("d{dimension_index}"), parameter.clone());
        dimension_index += 1;
    }
    feature
}

/// Rehydrate only the geometry needed for profile discovery from the
/// authoritative document sketch. This is deliberately independent of an
/// editor-supplied sketch DTO so downstream features cannot consume geometry
/// that has since been replaced in the accepted document.
fn document_sketch_profile_geometry(stored: &crawler_document::Sketch) -> crawler_sketch::Sketch {
    use crawler_document::SketchElement;
    use crawler_sketch::{
        Arc, Circle, Conic, ControlPointSpline, Ellipse, EllipticalArc, FitPointSpline,
        GeometryEntity, Line, Point2, Rectangle,
    };

    let point = |value: &[i64; 2]| Point2::new(value[0], value[1]);
    let legacy_points = stored
        .elements
        .iter()
        .filter_map(|element| match element {
            SketchElement::Point {
                id,
                x_nanometers,
                y_nanometers,
            } => Some((id.as_str(), Point2::new(*x_nanometers, *y_nanometers))),
            _ => None,
        })
        .collect::<BTreeMap<_, _>>();
    let mut sketch = crawler_sketch::Sketch::new(stored.id.0.clone());
    for element in &stored.elements {
        let (id, construction, geometry) = match element {
            SketchElement::Point { .. } => continue,
            SketchElement::Line {
                id,
                start_element,
                end_element,
            } => {
                let (Some(start), Some(end)) = (
                    legacy_points.get(start_element.as_str()),
                    legacy_points.get(end_element.as_str()),
                ) else {
                    continue;
                };
                (
                    id,
                    false,
                    Geometry::Line(Line {
                        start: *start,
                        end: *end,
                    }),
                )
            }
            SketchElement::Circle {
                id,
                center_nanometers,
                radius_nanometers,
                construction,
            } => (
                id,
                *construction,
                Geometry::Circle(Circle {
                    center: point(center_nanometers),
                    radius_nm: *radius_nanometers,
                }),
            ),
            SketchElement::Arc {
                id,
                center_nanometers,
                start_nanometers,
                end_nanometers,
                clockwise,
                construction,
            } => (
                id,
                *construction,
                Geometry::Arc(Arc {
                    center: point(center_nanometers),
                    start: point(start_nanometers),
                    end: point(end_nanometers),
                    clockwise: *clockwise,
                }),
            ),
            SketchElement::Rectangle {
                id,
                min_nanometers,
                max_nanometers,
                construction,
            } => (
                id,
                *construction,
                Geometry::Rectangle(Rectangle {
                    min: point(min_nanometers),
                    max: point(max_nanometers),
                }),
            ),
            SketchElement::ControlPointSpline {
                id,
                degree,
                control_points_nanometers,
                knots_millionths,
                construction,
            } => (
                id,
                *construction,
                Geometry::ControlPointSpline(ControlPointSpline {
                    degree: *degree,
                    control_points: control_points_nanometers.iter().map(point).collect(),
                    knots_millionths: knots_millionths.clone(),
                }),
            ),
            SketchElement::FitPointSpline {
                id,
                fit_points_nanometers,
                construction,
            } => (
                id,
                *construction,
                Geometry::FitPointSpline(FitPointSpline {
                    fit_points: fit_points_nanometers.iter().map(point).collect(),
                }),
            ),
            SketchElement::Ellipse {
                id,
                center_nanometers,
                major_nanometers,
                minor_nanometers,
                construction,
            } => (
                id,
                *construction,
                Geometry::Ellipse(Ellipse {
                    center: point(center_nanometers),
                    major: point(major_nanometers),
                    minor: point(minor_nanometers),
                }),
            ),
            SketchElement::EllipticalArc {
                id,
                center_nanometers,
                major_nanometers,
                minor_nanometers,
                start_nanometers,
                end_nanometers,
                clockwise,
                construction,
            } => (
                id,
                *construction,
                Geometry::EllipticalArc(EllipticalArc {
                    center: point(center_nanometers),
                    major: point(major_nanometers),
                    minor: point(minor_nanometers),
                    start: point(start_nanometers),
                    end: point(end_nanometers),
                    clockwise: *clockwise,
                }),
            ),
            SketchElement::Conic {
                id,
                start_nanometers,
                control_nanometers,
                end_nanometers,
                weight_millionths,
                construction,
            } => (
                id,
                *construction,
                Geometry::Conic(Conic {
                    start: point(start_nanometers),
                    control: point(control_nanometers),
                    end: point(end_nanometers),
                    weight_millionths: *weight_millionths,
                }),
            ),
            SketchElement::SketchPoint {
                id,
                position_nanometers,
                construction,
            } => (
                id,
                *construction,
                Geometry::SketchPoint(point(position_nanometers)),
            ),
            SketchElement::ConstructionLine {
                id,
                start_nanometers,
                end_nanometers,
            } => (
                id,
                true,
                Geometry::Line(Line {
                    start: point(start_nanometers),
                    end: point(end_nanometers),
                }),
            ),
            SketchElement::LineSegment {
                id,
                start_nanometers,
                end_nanometers,
                construction,
            } => (
                id,
                *construction,
                Geometry::Line(Line {
                    start: point(start_nanometers),
                    end: point(end_nanometers),
                }),
            ),
            SketchElement::ExternalLine {
                id,
                start_nanometers,
                end_nanometers,
                ..
            } => (
                id,
                false,
                Geometry::Line(Line {
                    start: point(start_nanometers),
                    end: point(end_nanometers),
                }),
            ),
        };
        let mut entity = GeometryEntity::new(id.clone(), geometry);
        entity.construction = construction;
        sketch.geometry.insert(entity.id.clone(), entity);
    }
    sketch
}

fn solved_to_document_sketch(
    existing: &crawler_document::Sketch,
    solved: &crawler_sketch::Sketch,
    support: &crawler_document::SketchSupport,
) -> crawler_document::Sketch {
    let mut elements = existing.elements.clone();
    let retained_geometry = solved
        .geometry
        .keys()
        .map(|id| id.0.as_str())
        .collect::<BTreeSet<_>>();
    let retained_legacy_points = existing
        .elements
        .iter()
        .filter_map(|element| match element {
            crawler_document::SketchElement::Line {
                id,
                start_element,
                end_element,
            } if retained_geometry.contains(id.as_str()) => {
                Some([start_element.as_str(), end_element.as_str()])
            }
            _ => None,
        })
        .flatten()
        .collect::<BTreeSet<_>>();
    if existing.id.0 != crawler_part_engine::RECTANGLE_SKETCH_ID {
        elements.retain(|element| match element {
            crawler_document::SketchElement::Point { id, .. } => {
                retained_legacy_points.contains(id.as_str())
            }
            _ => retained_geometry.contains(stored_element_id(element)),
        });
    }
    for entity in solved.geometry.values() {
        if let Geometry::Line(line) = &entity.geometry {
            let legacy_points = elements.iter().find_map(|element| match element {
                crawler_document::SketchElement::Line {
                    id,
                    start_element,
                    end_element,
                } if id == &entity.id.0 => Some((start_element.clone(), end_element.clone())),
                _ => None,
            });
            if let Some((start, end)) = legacy_points {
                update_stored_point(&mut elements, &start, line.start.x_nm, line.start.y_nm);
                update_stored_point(&mut elements, &end, line.end.x_nm, line.end.y_nm);
                continue;
            }
        }
        let replacement = match &entity.geometry {
            Geometry::Line(line) => match solved.external_references.get(&entity.id) {
                Some(reference) => crawler_document::SketchElement::ExternalLine {
                    id: entity.id.0.clone(),
                    start_nanometers: [line.start.x_nm, line.start.y_nm],
                    end_nanometers: [line.end.x_nm, line.end.y_nm],
                    body: crawler_document::BodyId::from(reference.body.as_str()),
                    stable_kernel_id: reference
                        .stable_kernel_id
                        .parse()
                        .expect("validated decimal external edge identity"),
                },
                None => crawler_document::SketchElement::LineSegment {
                    id: entity.id.0.clone(),
                    start_nanometers: [line.start.x_nm, line.start.y_nm],
                    end_nanometers: [line.end.x_nm, line.end.y_nm],
                    construction: entity.construction,
                },
            },
            Geometry::Circle(circle) => crawler_document::SketchElement::Circle {
                id: entity.id.0.clone(),
                center_nanometers: [circle.center.x_nm, circle.center.y_nm],
                radius_nanometers: circle.radius_nm,
                construction: entity.construction,
            },
            Geometry::Arc(arc) => crawler_document::SketchElement::Arc {
                id: entity.id.0.clone(),
                center_nanometers: [arc.center.x_nm, arc.center.y_nm],
                start_nanometers: [arc.start.x_nm, arc.start.y_nm],
                end_nanometers: [arc.end.x_nm, arc.end.y_nm],
                clockwise: arc.clockwise,
                construction: entity.construction,
            },
            Geometry::Rectangle(rectangle) => crawler_document::SketchElement::Rectangle {
                id: entity.id.0.clone(),
                min_nanometers: [rectangle.min.x_nm, rectangle.min.y_nm],
                max_nanometers: [rectangle.max.x_nm, rectangle.max.y_nm],
                construction: entity.construction,
            },
            Geometry::ControlPointSpline(spline) => {
                crawler_document::SketchElement::ControlPointSpline {
                    id: entity.id.0.clone(),
                    degree: spline.degree,
                    control_points_nanometers: spline
                        .control_points
                        .iter()
                        .map(|point| [point.x_nm, point.y_nm])
                        .collect(),
                    knots_millionths: spline.knots_millionths.clone(),
                    construction: entity.construction,
                }
            }
            Geometry::FitPointSpline(spline) => crawler_document::SketchElement::FitPointSpline {
                id: entity.id.0.clone(),
                fit_points_nanometers: spline
                    .fit_points
                    .iter()
                    .map(|point| [point.x_nm, point.y_nm])
                    .collect(),
                construction: entity.construction,
            },
            Geometry::Ellipse(ellipse) => crawler_document::SketchElement::Ellipse {
                id: entity.id.0.clone(),
                center_nanometers: [ellipse.center.x_nm, ellipse.center.y_nm],
                major_nanometers: [ellipse.major.x_nm, ellipse.major.y_nm],
                minor_nanometers: [ellipse.minor.x_nm, ellipse.minor.y_nm],
                construction: entity.construction,
            },
            Geometry::EllipticalArc(arc) => crawler_document::SketchElement::EllipticalArc {
                id: entity.id.0.clone(),
                center_nanometers: [arc.center.x_nm, arc.center.y_nm],
                major_nanometers: [arc.major.x_nm, arc.major.y_nm],
                minor_nanometers: [arc.minor.x_nm, arc.minor.y_nm],
                start_nanometers: [arc.start.x_nm, arc.start.y_nm],
                end_nanometers: [arc.end.x_nm, arc.end.y_nm],
                clockwise: arc.clockwise,
                construction: entity.construction,
            },
            Geometry::Conic(conic) => crawler_document::SketchElement::Conic {
                id: entity.id.0.clone(),
                start_nanometers: [conic.start.x_nm, conic.start.y_nm],
                control_nanometers: [conic.control.x_nm, conic.control.y_nm],
                end_nanometers: [conic.end.x_nm, conic.end.y_nm],
                weight_millionths: conic.weight_millionths,
                construction: entity.construction,
            },
            Geometry::SketchPoint(point) => crawler_document::SketchElement::SketchPoint {
                id: entity.id.0.clone(),
                position_nanometers: [point.x_nm, point.y_nm],
                construction: entity.construction,
            },
        };
        elements.retain(|element| stored_element_id(element) != entity.id.0);
        elements.push(replacement);
    }
    let retained_constraints = solved
        .constraints
        .keys()
        .map(|id| id.0.as_str())
        .collect::<BTreeSet<_>>();
    let mut constraints = existing.constraints.clone();
    if existing.id.0 != crawler_part_engine::RECTANGLE_SKETCH_ID {
        constraints
            .retain(|constraint| retained_constraints.contains(stored_constraint_id(constraint)));
    }
    for (id, constraint) in &solved.constraints {
        if existing.id.0 == crawler_part_engine::RECTANGLE_SKETCH_ID
            && constraints
                .iter()
                .any(|stored| stored_constraint_id(stored) == id.0)
        {
            continue;
        }
        constraints.retain(|stored| stored_constraint_id(stored) != id.0);
        constraints.push(solver_constraint(
            id.0.clone(),
            constraint,
            solved
                .dimension_parameters
                .get(id)
                .map(|value| ParameterId(value.clone())),
            solved.suppressed_constraints.contains(id),
        ));
    }
    crawler_document::Sketch {
        id: existing.id.clone(),
        display_name: existing.display_name.clone(),
        component: existing.component.clone(),
        support: support.clone(),
        elements,
        constraints,
        dimension_positions: solved
            .dimension_positions
            .iter()
            .map(|(id, point)| (id.0.clone(), [point.x_nm, point.y_nm]))
            .collect(),
        recipes: solved
            .recipes
            .iter()
            .map(|(id, recipe)| {
                let stored = match recipe {
                    crawler_sketch::SketchRecipe::Polygon {
                        mode,
                        center,
                        radius_nm,
                        sides,
                        orientation_microdegrees,
                        geometry,
                    } => crawler_document::SketchRecipe::Polygon {
                        mode: mode.clone(),
                        center_nanometers: [center.x_nm, center.y_nm],
                        radius_nanometers: *radius_nm,
                        sides: *sides,
                        orientation_microdegrees: *orientation_microdegrees,
                        geometry: geometry.iter().map(|value| value.0.clone()).collect(),
                    },
                    crawler_sketch::SketchRecipe::Slot {
                        mode,
                        first,
                        second,
                        center,
                        through,
                        radius_nm,
                        geometry,
                    } => crawler_document::SketchRecipe::Slot {
                        mode: mode.clone(),
                        first_nanometers: [first.x_nm, first.y_nm],
                        second_nanometers: [second.x_nm, second.y_nm],
                        center_arc_nanometers: center.map(|value| [value.x_nm, value.y_nm]),
                        through_nanometers: through.map(|value| [value.x_nm, value.y_nm]),
                        radius_nanometers: *radius_nm,
                        geometry: geometry.iter().map(|value| value.0.clone()).collect(),
                    },
                    crawler_sketch::SketchRecipe::Text {
                        text,
                        origin,
                        height_nm,
                        rotation_microdegrees,
                        tracking_millionths,
                        horizontal_alignment,
                        path,
                        path_start_millionths,
                        reversed,
                        geometry,
                    } => crawler_document::SketchRecipe::Text {
                        text: text.clone(),
                        origin_nanometers: [origin.x_nm, origin.y_nm],
                        height_nanometers: *height_nm,
                        rotation_microdegrees: *rotation_microdegrees,
                        tracking_millionths: *tracking_millionths,
                        horizontal_alignment: horizontal_alignment.clone(),
                        path: path.as_ref().map(|value| value.0.clone()),
                        path_start_millionths: *path_start_millionths,
                        reversed: *reversed,
                        geometry: geometry.iter().map(|value| value.0.clone()).collect(),
                    },
                };
                (id.clone(), stored)
            })
            .collect(),
        operations: solved
            .operations
            .iter()
            .filter_map(|(id, operation)| {
                serde_json::to_value(operation)
                    .ok()
                    .map(|value| (id.clone(), value))
            })
            .collect(),
    }
}

fn update_stored_point(
    elements: &mut [crawler_document::SketchElement],
    point_id: &str,
    x_nanometers: i64,
    y_nanometers: i64,
) {
    if let Some(crawler_document::SketchElement::Point {
        x_nanometers: x,
        y_nanometers: y,
        ..
    }) = elements.iter_mut().find(|element| {
        matches!(element, crawler_document::SketchElement::Point { id, .. } if id == point_id)
    }) {
        *x = x_nanometers;
        *y = y_nanometers;
    }
}

fn stored_element_id(element: &crawler_document::SketchElement) -> &str {
    use crawler_document::SketchElement as Element;
    match element {
        Element::Point { id, .. }
        | Element::Line { id, .. }
        | Element::Circle { id, .. }
        | Element::Arc { id, .. }
        | Element::Rectangle { id, .. }
        | Element::ControlPointSpline { id, .. }
        | Element::FitPointSpline { id, .. }
        | Element::Ellipse { id, .. }
        | Element::EllipticalArc { id, .. }
        | Element::Conic { id, .. }
        | Element::SketchPoint { id, .. }
        | Element::ConstructionLine { id, .. }
        | Element::LineSegment { id, .. }
        | Element::ExternalLine { id, .. } => id,
    }
}

fn stored_constraint_id(constraint: &crawler_document::SketchConstraint) -> &str {
    use crawler_document::SketchConstraint as Constraint;
    match constraint {
        Constraint::Suppressed { id, .. }
        | Constraint::Coincident { id, .. }
        | Constraint::Horizontal { id, .. }
        | Constraint::Vertical { id, .. }
        | Constraint::HorizontalPoints { id, .. }
        | Constraint::VerticalPoints { id, .. }
        | Constraint::Collinear { id, .. }
        | Constraint::Symmetry { id, .. }
        | Constraint::CurvatureContinuous { id, .. }
        | Constraint::PointOnOrigin { id, .. }
        | Constraint::Fixed { id, .. }
        | Constraint::FixedGeometry { id, .. }
        | Constraint::Midpoint { id, .. }
        | Constraint::Concentric { id, .. }
        | Constraint::PointOnObject { id, .. }
        | Constraint::Parallel { id, .. }
        | Constraint::Perpendicular { id, .. }
        | Constraint::Tangent { id, .. }
        | Constraint::Equal { id, .. }
        | Constraint::Distance { id, .. }
        | Constraint::DistanceX { id, .. }
        | Constraint::DistanceY { id, .. }
        | Constraint::PointLineDistance { id, .. }
        | Constraint::LineDistance { id, .. }
        | Constraint::OffsetDistance { id, .. }
        | Constraint::Radius { id, .. }
        | Constraint::Diameter { id, .. }
        | Constraint::EllipseRadius { id, .. }
        | Constraint::Angle { id, .. }
        | Constraint::AngleToAxis { id, .. }
        | Constraint::DistanceLiteral { id, .. }
        | Constraint::DistanceXLiteral { id, .. }
        | Constraint::DistanceYLiteral { id, .. }
        | Constraint::PointLineDistanceLiteral { id, .. }
        | Constraint::LineDistanceLiteral { id, .. }
        | Constraint::OffsetDistanceLiteral { id, .. }
        | Constraint::RadiusLiteral { id, .. }
        | Constraint::DiameterLiteral { id, .. }
        | Constraint::EllipseRadiusLiteral { id, .. }
        | Constraint::AngleLiteral { id, .. }
        | Constraint::AngleToAxisLiteral { id, .. } => id,
    }
}

fn stored_constraint_parameter(
    constraint: &crawler_document::SketchConstraint,
) -> Option<&ParameterId> {
    use crawler_document::SketchConstraint as Constraint;
    match constraint {
        Constraint::Suppressed { constraint, .. } => stored_constraint_parameter(constraint),
        Constraint::Distance { parameter, .. }
        | Constraint::DistanceX { parameter, .. }
        | Constraint::DistanceY { parameter, .. }
        | Constraint::PointLineDistance { parameter, .. }
        | Constraint::LineDistance { parameter, .. }
        | Constraint::OffsetDistance { parameter, .. }
        | Constraint::Radius { parameter, .. }
        | Constraint::Diameter { parameter, .. }
        | Constraint::EllipseRadius { parameter, .. }
        | Constraint::Angle { parameter, .. }
        | Constraint::AngleToAxis { parameter, .. } => Some(parameter),
        _ => None,
    }
}

fn attach_dimension_parameter_ids(
    sketch: &mut crawler_sketch::Sketch,
    existing: &crawler_document::Sketch,
) {
    for (id, constraint) in &sketch.constraints {
        if !matches!(
            constraint,
            SolverConstraint::Distance { .. }
                | SolverConstraint::DistanceX { .. }
                | SolverConstraint::DistanceY { .. }
                | SolverConstraint::PointLineDistance { .. }
                | SolverConstraint::LineDistance { .. }
                | SolverConstraint::OffsetDistance { .. }
                | SolverConstraint::Radius { .. }
                | SolverConstraint::Diameter { .. }
                | SolverConstraint::EllipseRadius { .. }
                | SolverConstraint::Angle { .. }
                | SolverConstraint::AngleToAxis { .. }
        ) {
            continue;
        }
        sketch
            .dimension_parameters
            .entry(id.clone())
            .or_insert_with(|| {
                existing
                    .constraints
                    .iter()
                    .find(|stored| stored_constraint_id(stored) == id.0)
                    .and_then(stored_constraint_parameter)
                    .map(|parameter| parameter.0.clone())
                    .unwrap_or_else(|| format!("parameter:{}:{}", sketch.id, id.0))
            });
    }
    sketch
        .dimension_parameters
        .retain(|id, _| sketch.constraints.contains_key(id));
}

fn dimension_parameter_changes(
    document: &crawler_document::Document,
    sketch: &crawler_sketch::Sketch,
) -> Vec<DocumentChange> {
    let mut changes = Vec::new();
    let mut ordinal = document
        .parameters
        .values()
        .filter_map(|parameter| {
            parameter
                .display_name
                .strip_prefix('d')?
                .parse::<usize>()
                .ok()
        })
        .max()
        .unwrap_or(0)
        + 1;
    for (id, constraint) in &sketch.constraints {
        let Some(parameter_id) = sketch
            .dimension_parameters
            .get(id)
            .map(|value| ParameterId(value.clone()))
        else {
            continue;
        };
        let value = match constraint {
            SolverConstraint::Distance { distance_nm, .. }
            | SolverConstraint::DistanceX { distance_nm, .. }
            | SolverConstraint::DistanceY { distance_nm, .. }
            | SolverConstraint::PointLineDistance { distance_nm, .. }
            | SolverConstraint::LineDistance { distance_nm, .. }
            | SolverConstraint::OffsetDistance { distance_nm, .. }
            | SolverConstraint::Radius {
                radius_nm: distance_nm,
                ..
            }
            | SolverConstraint::EllipseRadius {
                radius_nm: distance_nm,
                ..
            }
            | SolverConstraint::Diameter {
                diameter_nm: distance_nm,
                ..
            } => ParameterValue::LengthNanometers(*distance_nm),
            SolverConstraint::Angle {
                angle_microdegrees, ..
            }
            | SolverConstraint::AngleToAxis {
                angle_microdegrees, ..
            } => ParameterValue::AngleMicrodegrees(*angle_microdegrees),
            _ => continue,
        };
        let is_new_parameter = !document.parameters.contains_key(&parameter_id);
        if let Some(existing) = document.parameters.get(&parameter_id) {
            if existing.value != value {
                let source = match value {
                    ParameterValue::LengthNanometers(value) => {
                        format!("{} mm", value as f64 / 1_000_000.0)
                    }
                    ParameterValue::AngleMicrodegrees(value) => {
                        format!("{} deg", value as f64 / 1_000_000.0)
                    }
                    _ => unreachable!(),
                };
                changes.push(DocumentChange::SetParameterExpression {
                    parameter: parameter_id,
                    expression: ParameterExpression {
                        source,
                        root: ParameterExpressionNode::Literal {
                            value: value.clone(),
                        },
                    },
                    evaluated_value: value,
                });
            }
        } else {
            changes.push(DocumentChange::CreateParameter {
                component: document.root_component.clone(),
                parameter: Parameter {
                    id: parameter_id,
                    display_name: format!("d{ordinal}"),
                    value,
                },
            });
        }
        if is_new_parameter {
            ordinal += 1;
        }
    }
    changes
}

fn point_key(point: &crawler_sketch::PointRef) -> String {
    let anchor = serde_json::to_value(point.anchor)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_else(|| "unknown".into());
    format!("{}#{anchor}", point.geometry.0)
}

fn solver_constraint(
    id: String,
    constraint: &SolverConstraint,
    parameter: Option<ParameterId>,
    suppressed: bool,
) -> crawler_document::SketchConstraint {
    use crawler_document::SketchConstraint as Stored;
    let wrapper_id = id.clone();
    let stored = match constraint {
        SolverConstraint::Coincident { a, b } => Stored::Coincident {
            id,
            first_point: point_key(a),
            second_point: point_key(b),
        },
        SolverConstraint::PointOnOrigin { point } => Stored::PointOnOrigin {
            id,
            point: point_key(point),
        },
        SolverConstraint::Fixed { point, .. } => Stored::Fixed {
            id,
            point: point_key(point),
        },
        SolverConstraint::FixedGeometry { geometry } => Stored::FixedGeometry {
            id,
            geometry: geometry.0.clone(),
        },
        SolverConstraint::Midpoint { point, line } => Stored::Midpoint {
            id,
            point: point_key(point),
            line: line.0.clone(),
        },
        SolverConstraint::Concentric { first, second } => Stored::Concentric {
            id,
            first: first.0.clone(),
            second: second.0.clone(),
        },
        SolverConstraint::PointOnObject { point, geometry } => Stored::PointOnObject {
            id,
            point: point_key(point),
            geometry: geometry.0.clone(),
        },
        SolverConstraint::Horizontal { line } => Stored::Horizontal {
            id,
            line: line.0.clone(),
        },
        SolverConstraint::Vertical { line } => Stored::Vertical {
            id,
            line: line.0.clone(),
        },
        SolverConstraint::HorizontalPoints { a, b } => Stored::HorizontalPoints {
            id,
            first_point: point_key(a),
            second_point: point_key(b),
        },
        SolverConstraint::VerticalPoints { a, b } => Stored::VerticalPoints {
            id,
            first_point: point_key(a),
            second_point: point_key(b),
        },
        SolverConstraint::Collinear { point, line } => Stored::Collinear {
            id,
            point: point_key(point),
            line: line.0.clone(),
        },
        SolverConstraint::Symmetry {
            first,
            second,
            axis,
        } => Stored::Symmetry {
            id,
            first_point: point_key(first),
            second_point: point_key(second),
            axis: axis.0.clone(),
        },
        SolverConstraint::CurvatureContinuous { first, second } => Stored::CurvatureContinuous {
            id,
            first: first.0.clone(),
            second: second.0.clone(),
        },
        SolverConstraint::Parallel { first, second } => Stored::Parallel {
            id,
            first: first.0.clone(),
            second: second.0.clone(),
        },
        SolverConstraint::Perpendicular { first, second } => Stored::Perpendicular {
            id,
            first: first.0.clone(),
            second: second.0.clone(),
        },
        SolverConstraint::Tangent {
            first,
            second,
            first_parameter_millionths,
            second_parameter_millionths,
        } => Stored::Tangent {
            id,
            first: first.0.clone(),
            second: second.0.clone(),
            first_parameter_millionths: *first_parameter_millionths,
            second_parameter_millionths: *second_parameter_millionths,
        },
        SolverConstraint::Equal { first, second } => Stored::Equal {
            id,
            first: first.0.clone(),
            second: second.0.clone(),
        },
        SolverConstraint::Distance { a, b, distance_nm } => match parameter {
            None => Stored::DistanceLiteral {
                id,
                first: point_key(a),
                second: point_key(b),
                distance_nanometers: *distance_nm,
            },
            Some(parameter) => Stored::Distance {
                id,
                first: point_key(a),
                second: point_key(b),
                parameter,
            },
        },
        SolverConstraint::DistanceX { a, b, distance_nm } => match parameter {
            Some(parameter) => Stored::DistanceX {
                id,
                start_point: point_key(a),
                end_point: point_key(b),
                parameter,
            },
            None => Stored::DistanceXLiteral {
                id,
                first: point_key(a),
                second: point_key(b),
                distance_nanometers: *distance_nm,
            },
        },
        SolverConstraint::DistanceY { a, b, distance_nm } => match parameter {
            Some(parameter) => Stored::DistanceY {
                id,
                start_point: point_key(a),
                end_point: point_key(b),
                parameter,
            },
            None => Stored::DistanceYLiteral {
                id,
                first: point_key(a),
                second: point_key(b),
                distance_nanometers: *distance_nm,
            },
        },
        SolverConstraint::PointLineDistance {
            point,
            line,
            distance_nm,
        } => match parameter {
            Some(parameter) => Stored::PointLineDistance {
                id,
                point: point_key(point),
                line: line.0.clone(),
                parameter,
            },
            None => Stored::PointLineDistanceLiteral {
                id,
                point: point_key(point),
                line: line.0.clone(),
                distance_nanometers: *distance_nm,
            },
        },
        SolverConstraint::LineDistance {
            first,
            second,
            distance_nm,
        } => match parameter {
            Some(parameter) => Stored::LineDistance {
                id,
                first: first.0.clone(),
                second: second.0.clone(),
                parameter,
            },
            None => Stored::LineDistanceLiteral {
                id,
                first: first.0.clone(),
                second: second.0.clone(),
                distance_nanometers: *distance_nm,
            },
        },
        SolverConstraint::OffsetDistance {
            source,
            offset,
            distance_nm,
            source_start_millionths,
            source_end_millionths,
        } => match parameter {
            Some(parameter) => Stored::OffsetDistance {
                id,
                source: source.0.clone(),
                offset: offset.0.clone(),
                source_start_millionths: *source_start_millionths,
                source_end_millionths: *source_end_millionths,
                parameter,
            },
            None => Stored::OffsetDistanceLiteral {
                id,
                source: source.0.clone(),
                offset: offset.0.clone(),
                source_start_millionths: *source_start_millionths,
                source_end_millionths: *source_end_millionths,
                distance_nanometers: *distance_nm,
            },
        },
        SolverConstraint::Radius {
            geometry,
            radius_nm,
        } => match parameter {
            None => Stored::RadiusLiteral {
                id,
                geometry: geometry.0.clone(),
                radius_nanometers: *radius_nm,
            },
            Some(parameter) => Stored::Radius {
                id,
                geometry: geometry.0.clone(),
                parameter,
            },
        },
        SolverConstraint::Diameter {
            geometry,
            diameter_nm,
        } => match parameter {
            Some(parameter) => Stored::Diameter {
                id,
                geometry: geometry.0.clone(),
                parameter,
            },
            None => Stored::DiameterLiteral {
                id,
                geometry: geometry.0.clone(),
                diameter_nanometers: *diameter_nm,
            },
        },
        SolverConstraint::EllipseRadius {
            geometry,
            axis,
            radius_nm,
        } => match parameter {
            Some(parameter) => Stored::EllipseRadius {
                id,
                geometry: geometry.0.clone(),
                axis: serde_json::to_value(axis)
                    .ok()
                    .and_then(|value| value.as_str().map(str::to_owned))
                    .unwrap_or_default(),
                parameter,
            },
            None => Stored::EllipseRadiusLiteral {
                id,
                geometry: geometry.0.clone(),
                axis: serde_json::to_value(axis)
                    .ok()
                    .and_then(|value| value.as_str().map(str::to_owned))
                    .unwrap_or_default(),
                radius_nanometers: *radius_nm,
            },
        },
        SolverConstraint::Angle {
            first,
            second,
            angle_microdegrees,
        } => match parameter {
            None => Stored::AngleLiteral {
                id,
                first: first.0.clone(),
                second: second.0.clone(),
                angle_microdegrees: *angle_microdegrees,
            },
            Some(parameter) => Stored::Angle {
                id,
                first: first.0.clone(),
                second: second.0.clone(),
                parameter,
            },
        },
        SolverConstraint::AngleToAxis {
            line,
            axis,
            angle_microdegrees,
        } => {
            let axis = match axis {
                crawler_sketch::Axis2d::X => "x",
                crawler_sketch::Axis2d::Y => "y",
            }
            .to_owned();
            match parameter {
                None => Stored::AngleToAxisLiteral {
                    id,
                    line: line.0.clone(),
                    axis,
                    angle_microdegrees: *angle_microdegrees,
                },
                Some(parameter) => Stored::AngleToAxis {
                    id,
                    line: line.0.clone(),
                    axis,
                    parameter,
                },
            }
        }
    };
    if suppressed {
        Stored::Suppressed {
            id: wrapper_id,
            constraint: Box::new(stored),
        }
    } else {
        stored
    }
}

fn referenced_step_source_hashes(
    document: &crawler_document::Document,
) -> Result<BTreeMap<String, usize>, EngineError> {
    let mut referenced = BTreeMap::new();
    for transaction in &document.transactions {
        for change in &transaction.changes {
            let DocumentChange::AcceptFeatureResult { result_json, .. } = change else {
                continue;
            };
            let result: serde_json::Value = serde_json::from_str(result_json).map_err(|error| {
                EngineError::Serialization(format!(
                    "accepted feature result is not valid JSON: {error}"
                ))
            })?;
            if result.get("kind").and_then(serde_json::Value::as_str) != Some("step_import") {
                continue;
            }
            let source_sha256 = result
                .pointer("/provenance/source_sha256")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| {
                    EngineError::InvalidDocument(
                        "accepted STEP import has no source SHA-256 provenance".into(),
                    )
                })?;
            if source_sha256.len() != 64
                || !source_sha256
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            {
                return Err(EngineError::InvalidDocument(
                    "accepted STEP import has invalid source SHA-256 provenance".into(),
                ));
            }
            let source_bytes = result
                .pointer("/provenance/source_bytes")
                .and_then(serde_json::Value::as_u64)
                .and_then(|value| usize::try_from(value).ok())
                .ok_or_else(|| {
                    EngineError::InvalidDocument(
                        "accepted STEP import has invalid source byte-length provenance".into(),
                    )
                })?;
            if let Some(existing) = referenced.insert(source_sha256.to_owned(), source_bytes)
                && existing != source_bytes
            {
                return Err(EngineError::InvalidDocument(format!(
                    "accepted STEP imports disagree on the byte length for source {source_sha256}"
                )));
            }
        }
    }
    Ok(referenced)
}

fn ensure_referenced_step_sources_present(
    referenced_sources: &BTreeMap<String, usize>,
    imported_step_sources: &BTreeMap<String, Vec<u8>>,
) -> Result<(), EngineError> {
    for (source_sha256, expected_length) in referenced_sources {
        let source = imported_step_sources
            .values()
            .find(|source| sha256_hex(source) == *source_sha256)
            .ok_or_else(|| {
                EngineError::InvalidDocument(format!(
                    "accepted STEP import source {source_sha256} is missing from the portable payloads"
                ))
            })?;
        if source.len() != *expected_length {
            return Err(EngineError::InvalidDocument(format!(
                "accepted STEP import source {source_sha256} has {} bytes; provenance declares {expected_length}",
                source.len()
            )));
        }
    }
    Ok(())
}

fn package_error(error: crawler_package::PackageError) -> EngineError {
    EngineError::Serialization(error.to_string())
}

fn validate_parameter_definitions(
    feature: &Feature,
    definitions: &[Parameter],
) -> Result<(), EngineError> {
    let definition_ids = definitions
        .iter()
        .map(|parameter| parameter.id.clone())
        .collect::<BTreeSet<_>>();
    let binding_ids = feature
        .parameters
        .values()
        .cloned()
        .collect::<BTreeSet<_>>();
    if definition_ids.len() != definitions.len() || definition_ids != binding_ids {
        return Err(EngineError::InvalidDocument(format!(
            "feature {} parameter definitions differ from its stable bindings",
            feature.id.0
        )));
    }
    if definitions.iter().any(|parameter| {
        parameter.id.0.trim().is_empty() || parameter.display_name.trim().is_empty()
    }) {
        return Err(EngineError::InvalidDocument(
            "feature parameter identity and display name must not be empty".into(),
        ));
    }
    Ok(())
}

fn parameter_definition_changes(
    document: &crawler_document::Document,
    feature: &Feature,
    definitions: Vec<Parameter>,
) -> Result<Vec<DocumentChange>, EngineError> {
    let mut changes = Vec::new();
    for parameter in definitions {
        if let Some(existing) = document.parameters.get(&parameter.id) {
            if std::mem::discriminant(&existing.value) != std::mem::discriminant(&parameter.value) {
                return Err(EngineError::InvalidDocument(format!(
                    "feature parameter {} cannot change quantity kind",
                    parameter.id.0
                )));
            }
            changes.push(DocumentChange::SetParameterValue {
                parameter: parameter.id.clone(),
                value: parameter.value,
            });
            if existing.display_name != parameter.display_name {
                changes.push(DocumentChange::RenameEntity {
                    entity: EntityId::Parameter(parameter.id),
                    display_name: parameter.display_name,
                });
            }
        } else {
            changes.push(DocumentChange::CreateParameter {
                component: feature.component.clone(),
                parameter,
            });
        }
    }
    Ok(changes)
}

fn parameter_set(document: &crawler_document::Document) -> Result<ParameterSet, EngineError> {
    let mut set = ParameterSet::default();
    for (id, parameter) in &document.parameters {
        let Some(value) = quantity_from_document(&parameter.value) else {
            continue;
        };
        let typed_id = NamedParameterId(id.0.clone());
        set.parameters.insert(
            typed_id.clone(),
            NamedParameter {
                id: typed_id,
                display_name: parameter.display_name.clone(),
                kind: value.kind(),
                expression: TypedParameterExpression {
                    source: document_literal_source(&parameter.value),
                    root: ExpressionNode::Literal { value },
                },
            },
        );
    }
    for id in document.parameters.keys() {
        let typed_id = NamedParameterId(id.0.clone());
        let Some(parameter) = set.parameters.get_mut(&typed_id) else {
            continue;
        };
        if let Some(expression) = latest_parameter_expression(document, id) {
            parameter.expression = expression_from_document(expression)?;
        }
    }
    Ok(set)
}

/// A plain value edit supersedes an older expression. This differs from simply
/// finding the newest expression and is important for exact undo/load replay.
fn latest_parameter_expression<'a>(
    document: &'a crawler_document::Document,
    parameter: &ParameterId,
) -> Option<&'a ParameterExpression> {
    for change in document
        .transactions
        .iter()
        .rev()
        .flat_map(|transaction| transaction.changes.iter().rev())
    {
        match change {
            DocumentChange::SetParameterExpression {
                parameter: candidate,
                expression,
                ..
            } if candidate == parameter => return Some(expression),
            DocumentChange::SetParameterValue {
                parameter: candidate,
                ..
            } if candidate == parameter => return None,
            _ => {}
        }
    }
    None
}

fn expression_from_document(
    expression: &ParameterExpression,
) -> Result<TypedParameterExpression, EngineError> {
    fn node(value: &ParameterExpressionNode) -> Result<ExpressionNode, EngineError> {
        Ok(match value {
            ParameterExpressionNode::Literal { value } => ExpressionNode::Literal {
                value: quantity_from_document(value).ok_or_else(|| {
                    EngineError::InvalidDocument(
                        "numeric parameter expression contains a non-numeric literal".into(),
                    )
                })?,
            },
            ParameterExpressionNode::Parameter { id } => ExpressionNode::Parameter {
                id: NamedParameterId(id.0.clone()),
            },
            ParameterExpressionNode::Add { left, right } => ExpressionNode::Add {
                left: Box::new(node(left)?),
                right: Box::new(node(right)?),
            },
            ParameterExpressionNode::Subtract { left, right } => ExpressionNode::Subtract {
                left: Box::new(node(left)?),
                right: Box::new(node(right)?),
            },
            ParameterExpressionNode::Multiply { value, scalar } => ExpressionNode::Multiply {
                value: Box::new(node(value)?),
                scalar: Box::new(node(scalar)?),
            },
            ParameterExpressionNode::Divide { value, scalar } => ExpressionNode::Divide {
                value: Box::new(node(value)?),
                scalar: Box::new(node(scalar)?),
            },
        })
    }
    Ok(TypedParameterExpression {
        source: expression.source.clone(),
        root: node(&expression.root)?,
    })
}

fn expression_to_document(expression: &TypedParameterExpression) -> ParameterExpression {
    fn node(value: &ExpressionNode) -> ParameterExpressionNode {
        match value {
            ExpressionNode::Literal { value } => ParameterExpressionNode::Literal {
                value: quantity_to_document(*value)
                    .expect("parameter expressions cannot contain tolerance literals"),
            },
            ExpressionNode::Parameter { id } => ParameterExpressionNode::Parameter {
                id: ParameterId(id.0.clone()),
            },
            ExpressionNode::Add { left, right } => ParameterExpressionNode::Add {
                left: Box::new(node(left)),
                right: Box::new(node(right)),
            },
            ExpressionNode::Subtract { left, right } => ParameterExpressionNode::Subtract {
                left: Box::new(node(left)),
                right: Box::new(node(right)),
            },
            ExpressionNode::Multiply { value, scalar } => ParameterExpressionNode::Multiply {
                value: Box::new(node(value)),
                scalar: Box::new(node(scalar)),
            },
            ExpressionNode::Divide { value, scalar } => ParameterExpressionNode::Divide {
                value: Box::new(node(value)),
                scalar: Box::new(node(scalar)),
            },
        }
    }
    ParameterExpression {
        source: expression.source.clone(),
        root: node(&expression.root),
    }
}

fn quantity_from_document(value: &ParameterValue) -> Option<Quantity> {
    match value {
        ParameterValue::LengthNanometers(value) => Some(Quantity::LengthNanometers(*value)),
        ParameterValue::AngleMicrodegrees(value) => Some(Quantity::AngleMicrodegrees(*value)),
        ParameterValue::ScalarMillionths(value) => Some(Quantity::ScalarMillionths(*value)),
        ParameterValue::Count(value) => Some(Quantity::Count(*value)),
        ParameterValue::Boolean(_) | ParameterValue::Text(_) => None,
    }
}

fn quantity_to_document(value: Quantity) -> Result<ParameterValue, EngineError> {
    match value {
        Quantity::LengthNanometers(value) => Ok(ParameterValue::LengthNanometers(value)),
        Quantity::AngleMicrodegrees(value) => Ok(ParameterValue::AngleMicrodegrees(value)),
        Quantity::ScalarMillionths(value) => Ok(ParameterValue::ScalarMillionths(value)),
        Quantity::Count(value) => Ok(ParameterValue::Count(value)),
        Quantity::ToleranceNanometers(_) => Err(EngineError::InvalidDocument(
            "document parameters do not store tolerance-only quantities".into(),
        )),
    }
}

fn document_parameter_kind(value: &ParameterValue) -> &'static str {
    match value {
        ParameterValue::LengthNanometers(_) => "length",
        ParameterValue::AngleMicrodegrees(_) => "angle",
        ParameterValue::ScalarMillionths(_) => "scalar",
        ParameterValue::Count(_) => "count",
        ParameterValue::Boolean(_) => "boolean",
        ParameterValue::Text(_) => "text",
    }
}

fn document_literal_source(value: &ParameterValue) -> String {
    match value {
        ParameterValue::LengthNanometers(value) => format!("{value} nm"),
        ParameterValue::AngleMicrodegrees(value) => format!("{value} udeg"),
        ParameterValue::ScalarMillionths(value) => format_millionths(*value),
        ParameterValue::Count(value) => value.to_string(),
        ParameterValue::Boolean(value) => value.to_string(),
        ParameterValue::Text(value) => value.clone(),
    }
}

fn format_millionths(value: i64) -> String {
    let negative = value < 0;
    let magnitude = i128::from(value).abs();
    let whole = magnitude / 1_000_000;
    let fraction = magnitude % 1_000_000;
    let prefix = if negative { "-" } else { "" };
    if fraction == 0 {
        format!("{prefix}{whole}")
    } else {
        format!("{prefix}{whole}.{fraction:06}")
            .trim_end_matches('0')
            .to_owned()
    }
}

fn expression_references_any(
    expression: &ExpressionNode,
    parameters: &BTreeSet<NamedParameterId>,
) -> bool {
    match expression {
        ExpressionNode::Literal { .. } => false,
        ExpressionNode::Parameter { id } => parameters.contains(id),
        ExpressionNode::Add { left, right } | ExpressionNode::Subtract { left, right } => {
            expression_references_any(left, parameters)
                || expression_references_any(right, parameters)
        }
        ExpressionNode::Multiply { value, scalar } | ExpressionNode::Divide { value, scalar } => {
            expression_references_any(value, parameters)
                || expression_references_any(scalar, parameters)
        }
    }
}

fn dependent_parameter_ids(
    set: &ParameterSet,
    root: &NamedParameterId,
) -> BTreeSet<NamedParameterId> {
    let mut dependencies = BTreeSet::from([root.clone()]);
    loop {
        let discovered = set
            .parameters
            .iter()
            .filter(|(id, parameter)| {
                !dependencies.contains(*id)
                    && expression_references_any(&parameter.expression.root, &dependencies)
            })
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        if discovered.is_empty() {
            break;
        }
        dependencies.extend(discovered);
    }
    dependencies.remove(root);
    dependencies
}

fn parameter_diagnostic(
    field: impl Into<String>,
    code: ParameterDiagnosticCode,
    message: impl Into<String>,
) -> ParameterDiagnostic {
    ParameterDiagnostic {
        code,
        field: field.into(),
        span: None,
        message: message.into().into_boxed_str(),
        candidates: Vec::new(),
        cycle: Vec::new(),
    }
}

fn parameter_refusal_json(
    diagnostic: ParameterDiagnostic,
    document_hash: String,
) -> Result<String, EngineError> {
    serde_json::to_string(&serde_json::json!({
        "accepted": false,
        "diagnostic": diagnostic,
        "document_hash": document_hash,
    }))
    .map_err(|error| EngineError::Serialization(error.to_string()))
}

#[derive(Clone, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct SketchExtrudeRequest {
    sketch: crawler_sketch::Sketch,
    support: crawler_document::SketchSupport,
    distance_nanometers: i64,
    #[serde(default)]
    direction: ExtrudeDirectionV2,
    #[serde(default)]
    result_mode: SketchExtrudeResultMode,
    #[serde(default)]
    target_body_id: Option<String>,
    feature_id: String,
    body_id: String,
    tolerance: f64,
    #[serde(default)]
    profile_geometry_ids: Vec<crawler_sketch::GeometryId>,
    #[serde(default)]
    transaction_id: Option<TransactionId>,
}

#[derive(Clone, Copy, Default, Eq, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
enum SketchExtrudeResultMode {
    #[default]
    NewBody,
    Cut,
}

#[derive(Clone, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct SketchFeatureSource {
    sketch: crawler_sketch::Sketch,
    support: crawler_document::SketchSupport,
    #[serde(default)]
    profile_geometry_ids: Vec<crawler_sketch::GeometryId>,
}

#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
enum SketchFeatureOperationId {
    #[serde(alias = "revolve")]
    ProfileRevolve,
    Loft,
    Sweep,
    ExtrudeCut,
    RevolveCut,
}

impl SketchFeatureOperationId {
    fn display_name(self) -> &'static str {
        match self {
            Self::ProfileRevolve => "Revolve",
            Self::Loft => "Loft",
            Self::Sweep => "Sweep",
            Self::ExtrudeCut => "Extrude Cut",
            Self::RevolveCut => "Revolve Cut",
        }
    }

    fn schema_suffix(self) -> &'static str {
        match self {
            Self::ProfileRevolve => "revolve",
            Self::Loft => "loft",
            Self::Sweep => "sweep",
            Self::ExtrudeCut => "extrude_cut",
            Self::RevolveCut => "revolve_cut",
        }
    }
}

#[derive(Clone, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct PrepareSketchFeatureEnvelopeRequest {
    transaction_id: TransactionId,
    feature_id: String,
    body_id: String,
    operation_id: SketchFeatureOperationId,
    #[serde(default)]
    profile_sources: Vec<SketchFeatureSource>,
    #[serde(default)]
    path_source: Option<SketchFeatureSource>,
    #[serde(default)]
    target_body_id: Option<String>,
    #[serde(default)]
    axis_origin_nanometers: Option<[i64; 3]>,
    #[serde(default)]
    axis_direction_nanometers: Option<[i64; 3]>,
    #[serde(default)]
    distance_nanometers: Option<i64>,
    #[serde(default)]
    sweep_microdegrees: Option<i64>,
    #[serde(default)]
    divisions: Option<u32>,
    #[serde(default)]
    reverse: bool,
    #[serde(default)]
    direction: ExtrudeDirectionV2,
    tolerance_nanometers: i64,
}

/// Kernel-independent world-space profile contract. Keeping the complete
/// frame beside the sampled loops lets future Revolve axis resolution and
/// Loft/Sweep section alignment remain deterministic.
struct AcceptedPlanarSketchProfile {
    profiles_nm: Vec<Vec<[i64; 3]>>,
    native_region: Result<NativeProfileRegionV2, String>,
    region_id: String,
    #[allow(dead_code)]
    outer_geometry: Vec<String>,
    #[allow(dead_code)]
    hole_geometry: Vec<Vec<String>>,
    #[allow(dead_code)]
    x_axis_millionths: [i64; 3],
    #[allow(dead_code)]
    y_axis_millionths: [i64; 3],
    normal_millionths: [i64; 3],
}

fn native_profile_region(
    sketch: &crawler_sketch::Sketch,
    outer: &[crawler_sketch::GeometryId],
    holes: &[Vec<crawler_sketch::GeometryId>],
    x_axis: [i64; 3],
    y_axis: [i64; 3],
) -> Result<NativeProfileRegionV2, EngineError> {
    Ok(NativeProfileRegionV2 {
        outer: native_curve_loop(sketch, outer, x_axis, y_axis)?,
        holes: holes
            .iter()
            .map(|boundary| native_curve_loop(sketch, boundary, x_axis, y_axis))
            .collect::<Result<_, _>>()?,
    })
}

fn native_curve_loop(
    sketch: &crawler_sketch::Sketch,
    ids: &[crawler_sketch::GeometryId],
    x_axis: [i64; 3],
    y_axis: [i64; 3],
) -> Result<NativeCurveLoopV2, EngineError> {
    if ids.len() == 1 {
        let entity = sketch.geometry.get(&ids[0]).ok_or_else(|| {
            EngineError::InvalidDocument("Exact Extrude profile geometry is missing".into())
        })?;
        return match &entity.geometry {
            Geometry::Circle(circle) => {
                let center_nm = plane_point_nm(circle.center, x_axis, y_axis);
                let radius_x = circle
                    .center
                    .x_nm
                    .checked_add(circle.radius_nm)
                    .ok_or_else(|| {
                        EngineError::InvalidDocument(
                            "Exact Extrude circle radius exceeds exact coordinate range".into(),
                        )
                    })?;
                let radius_y = circle
                    .center
                    .y_nm
                    .checked_add(circle.radius_nm)
                    .ok_or_else(|| {
                        EngineError::InvalidDocument(
                            "Exact Extrude circle radius exceeds exact coordinate range".into(),
                        )
                    })?;
                let radius_point_nm = plane_point_nm(
                    crawler_sketch::Point2::new(radius_x, circle.center.y_nm),
                    x_axis,
                    y_axis,
                );
                let transit_point_nm = plane_point_nm(
                    crawler_sketch::Point2::new(circle.center.x_nm, radius_y),
                    x_axis,
                    y_axis,
                );
                Ok(NativeCurveLoopV2 {
                    curves: vec![NativeCurveV2::Circle {
                        center_nm,
                        radius_point_nm,
                        transit_point_nm,
                    }],
                })
            }
            Geometry::Rectangle(rectangle) => {
                let corners = [
                    crawler_sketch::Point2::new(rectangle.min.x_nm, rectangle.min.y_nm),
                    crawler_sketch::Point2::new(rectangle.max.x_nm, rectangle.min.y_nm),
                    crawler_sketch::Point2::new(rectangle.max.x_nm, rectangle.max.y_nm),
                    crawler_sketch::Point2::new(rectangle.min.x_nm, rectangle.max.y_nm),
                ];
                Ok(NativeCurveLoopV2 {
                    curves: (0..4)
                        .map(|index| NativeCurveV2::Line {
                            start_nm: plane_point_nm(corners[index], x_axis, y_axis),
                            end_nm: plane_point_nm(corners[(index + 1) % 4], x_axis, y_axis),
                        })
                        .collect(),
                })
            }
            _ => Err(EngineError::InvalidDocument(
                "Exact Extrude single-curve boundaries must be circles or rectangles".into(),
            )),
        };
    }

    let mut remaining = ids
        .iter()
        .map(|id| {
            let geometry = &sketch
                .geometry
                .get(id)
                .ok_or_else(|| {
                    EngineError::InvalidDocument("Exact Extrude profile geometry is missing".into())
                })?
                .geometry;
            native_profile_curve(geometry, x_axis, y_axis)
        })
        .collect::<Result<Vec<_>, _>>()?;
    if remaining.is_empty() {
        return Err(EngineError::InvalidDocument(
            "Exact Extrude profile boundary is empty".into(),
        ));
    }
    let mut curves = vec![remaining.remove(0)];
    while !remaining.is_empty() {
        let endpoint = native_curve_end(curves.last().expect("curve loop is nonempty"));
        let (index, reverse) = remaining
            .iter()
            .enumerate()
            .find_map(|(index, curve)| {
                (native_curve_start(curve) == endpoint)
                    .then_some((index, false))
                    .or_else(|| (native_curve_end(curve) == endpoint).then_some((index, true)))
            })
            .ok_or_else(|| {
                EngineError::InvalidDocument(
                    "Exact Extrude profile could not be ordered into one closed native loop".into(),
                )
            })?;
        let curve = remaining.remove(index);
        curves.push(if reverse {
            reverse_native_curve(curve)
        } else {
            curve
        });
    }
    if native_curve_end(curves.last().expect("curve loop is nonempty"))
        != native_curve_start(&curves[0])
    {
        return Err(EngineError::InvalidDocument(
            "Exact Extrude native profile endpoints do not close".into(),
        ));
    }
    Ok(NativeCurveLoopV2 { curves })
}

fn native_profile_curve(
    geometry: &Geometry,
    x_axis: [i64; 3],
    y_axis: [i64; 3],
) -> Result<NativeCurveV2, EngineError> {
    match geometry {
        Geometry::Line(line) => Ok(NativeCurveV2::Line {
            start_nm: plane_point_nm(line.start, x_axis, y_axis),
            end_nm: plane_point_nm(line.end, x_axis, y_axis),
        }),
        Geometry::Arc(arc) => Ok(NativeCurveV2::CircularArc {
            start_nm: plane_point_nm(arc.start, x_axis, y_axis),
            end_nm: plane_point_nm(arc.end, x_axis, y_axis),
            transit_nm: plane_point_nm(
                crawler_sketch::evaluate_curve(geometry, 0.5),
                x_axis,
                y_axis,
            ),
        }),
        _ => Err(EngineError::InvalidDocument(
            "Exact Extrude segmented boundaries support only lines and circular arcs".into(),
        )),
    }
}

fn native_curve_start(curve: &NativeCurveV2) -> [i64; 3] {
    match curve {
        NativeCurveV2::Line { start_nm, .. } | NativeCurveV2::CircularArc { start_nm, .. } => {
            *start_nm
        }
        NativeCurveV2::Circle {
            radius_point_nm, ..
        } => *radius_point_nm,
    }
}

fn native_curve_end(curve: &NativeCurveV2) -> [i64; 3] {
    match curve {
        NativeCurveV2::Line { end_nm, .. } | NativeCurveV2::CircularArc { end_nm, .. } => *end_nm,
        NativeCurveV2::Circle {
            radius_point_nm, ..
        } => *radius_point_nm,
    }
}

fn reverse_native_curve(curve: NativeCurveV2) -> NativeCurveV2 {
    match curve {
        NativeCurveV2::Line { start_nm, end_nm } => NativeCurveV2::Line {
            start_nm: end_nm,
            end_nm: start_nm,
        },
        NativeCurveV2::CircularArc {
            start_nm,
            end_nm,
            transit_nm,
        } => NativeCurveV2::CircularArc {
            start_nm: end_nm,
            end_nm: start_nm,
            transit_nm,
        },
        circle @ NativeCurveV2::Circle { .. } => circle,
    }
}

fn durable_planar_support(
    support: &crawler_document::SketchSupport,
) -> Result<PlanarSupportReferenceV2, EngineError> {
    let plane = match support {
        crawler_document::SketchSupport::OriginPlane { plane } => crawler_document::OriginPlaneId(
            match plane {
                crawler_document::OriginPlane::Xy => crawler_part_engine::XY_PLANE_ID,
                crawler_document::OriginPlane::Xz => crawler_part_engine::XZ_PLANE_ID,
                crawler_document::OriginPlane::Yz => crawler_part_engine::YZ_PLANE_ID,
            }
            .to_owned(),
        ),
        crawler_document::SketchSupport::OriginPlaneReference { plane } => plane.clone(),
        crawler_document::SketchSupport::ConstructionPlaneReference { plane } => {
            return Ok(PlanarSupportReferenceV2::ConstructionPlane {
                plane: plane.clone(),
            });
        }
        crawler_document::SketchSupport::Topology { reference } => {
            return Ok(PlanarSupportReferenceV2::TopologyFace {
                reference: reference.clone(),
            });
        }
    };
    Ok(PlanarSupportReferenceV2::OriginPlane { plane })
}

fn offset_construction_plane_changes(
    document: &crawler_document::Document,
    request: &OffsetConstructionPlaneRequest,
) -> Result<Vec<DocumentChange>, EngineError> {
    if request.base_revision != document.revision {
        return Err(EngineError::InvalidDocument(format!(
            "construction-plane base revision {} differs from accepted revision {}",
            request.base_revision, document.revision
        )));
    }
    if request.plane_id.0.trim().is_empty()
        || request.component_id.0.trim().is_empty()
        || request.base_plane_id.0.trim().is_empty()
        || request.offset_parameter_id.0.trim().is_empty()
        || request.transaction_id.0.trim().is_empty()
    {
        return Err(EngineError::InvalidDocument(
            "construction-plane identities must not be empty".into(),
        ));
    }
    let component = document
        .components
        .get(&request.component_id)
        .ok_or_else(|| {
            EngineError::InvalidDocument(format!(
                "construction-plane component {} is missing",
                request.component_id.0
            ))
        })?;
    let base = document
        .origin_planes
        .get(&request.base_plane_id)
        .ok_or_else(|| {
            EngineError::InvalidDocument(format!(
                "missing_construction_plane_base_plane at construction_plane.base_plane: referenced entity {} is missing",
                request.base_plane_id.0
            ))
        })?;
    if base.component != request.component_id {
        return Err(EngineError::InvalidDocument(format!(
            "invalid_construction_plane_dependency at construction_plane.base_plane: construction plane {} references base plane {} from another component",
            request.plane_id.0, request.base_plane_id.0
        )));
    }
    if !(-SAFE_NANOMETER_BOUND..=SAFE_NANOMETER_BOUND).contains(&request.offset_nanometers) {
        return Err(EngineError::InvalidDocument(format!(
            "unsafe_construction_plane_offset_parameter at construction_plane.offset_parameter: referenced parameter {} has unsafe nanometer value {} outside [{}, {}]",
            request.offset_parameter_id.0,
            request.offset_nanometers,
            -SAFE_NANOMETER_BOUND,
            SAFE_NANOMETER_BOUND
        )));
    }
    if let Some(existing) = document.construction_planes.get(&request.plane_id)
        && existing.component != request.component_id
    {
        return Err(EngineError::InvalidDocument(format!(
            "construction plane {} cannot move across components",
            request.plane_id.0
        )));
    }

    let mut changes = Vec::new();
    match document.parameters.get(&request.offset_parameter_id) {
        Some(parameter) => {
            validate_construction_plane_offset_parameter(
                &request.offset_parameter_id,
                &parameter.value,
            )?;
            if !component
                .parameter_order
                .contains(&request.offset_parameter_id)
            {
                return Err(EngineError::InvalidDocument(format!(
                    "invalid_construction_plane_dependency at construction_plane.offset_parameter: construction plane {} references parameter {} from another component",
                    request.plane_id.0, request.offset_parameter_id.0
                )));
            }
            changes.push(DocumentChange::SetParameterValue {
                parameter: request.offset_parameter_id.clone(),
                value: ParameterValue::LengthNanometers(request.offset_nanometers),
            });
        }
        None if document.construction_planes.contains_key(&request.plane_id) => {
            return Err(EngineError::InvalidDocument(format!(
                "missing_construction_plane_offset_parameter at construction_plane.offset_parameter: existing construction plane {} referenced entity {} is missing",
                request.plane_id.0, request.offset_parameter_id.0
            )));
        }
        None => changes.push(DocumentChange::CreateParameter {
            component: request.component_id.clone(),
            parameter: Parameter {
                id: request.offset_parameter_id.clone(),
                display_name: "Offset".into(),
                value: ParameterValue::LengthNanometers(request.offset_nanometers),
            },
        }),
    }
    let mut definition = ConstructionPlaneDefinitionV1::offset(
        request.plane_id.clone(),
        request.component_id.clone(),
        request.base_plane_id.clone(),
        request.offset_parameter_id.clone(),
    );
    definition.suppressed = request.suppressed;
    changes.push(DocumentChange::UpsertConstructionPlaneDefinitionV1 {
        plane: request.plane_id.clone(),
        definition,
    });
    Ok(changes)
}

fn append_construction_plane_recompute_results(
    document: &crawler_document::Document,
    request: &OffsetConstructionPlaneRequest,
    mut changes: Vec<DocumentChange>,
) -> Result<Vec<DocumentChange>, EngineError> {
    let mut candidate = PartEngine::from_document(document.clone())?;
    candidate.commit_changes(request.transaction_id.clone(), changes.clone())?;
    let dirty_features = construction_plane_recompute_order(candidate.document())?;
    let mut snapshots = accepted_body_snapshots(candidate.document())?;
    for feature in dirty_features {
        let Some(kernel_request) =
            latest_kernel_request_with_snapshots(candidate.document(), &feature, Some(&snapshots))?
        else {
            continue;
        };
        let rebound_request = rebind_request_snapshots(kernel_request, &snapshots)?;
        let result = execute_feature(&rebound_request)
            .map_err(|error| EngineError::InvalidDocument(error.to_string()))?;
        let request_json = serde_json::to_string(&rebound_request)
            .map_err(|error| EngineError::Serialization(error.to_string()))?;
        let result_json = serde_json::to_string(&result)
            .map_err(|error| EngineError::Serialization(error.to_string()))?;
        snapshots.insert(result.output.body_id.clone(), result.output.clone());
        changes.push(DocumentChange::AcceptFeatureResult {
            feature,
            body: BodyId(result.output.body_id.clone()),
            request_json,
            result_json,
        });
        // Rebuild the isolated candidate with every accepted result accumulated
        // so far. This keeps later request lookup, body ownership, and recompute
        // state aligned with the exact single transaction that will be committed.
        candidate = PartEngine::from_document(document.clone())?;
        candidate.commit_changes(request.transaction_id.clone(), changes.clone())?;
    }
    Ok(changes)
}

fn construction_plane_recompute_order(
    document: &crawler_document::Document,
) -> Result<Vec<FeatureId>, EngineError> {
    let positions = runtime_feature_timeline_positions(document)?;
    let dirty: BTreeSet<_> = document
        .recompute
        .features
        .iter()
        .filter(|(_, state)| matches!(state, crawler_document::FeatureRecomputeState::Dirty { .. }))
        .map(|(feature, _)| feature.clone())
        .collect();
    let mut indegree: BTreeMap<FeatureId, usize> =
        dirty.iter().cloned().map(|feature| (feature, 0)).collect();
    let mut consumers: BTreeMap<FeatureId, Vec<FeatureId>> = BTreeMap::new();
    for feature in &dirty {
        for predecessor in runtime_feature_predecessors(document, feature, &positions) {
            if dirty.contains(&predecessor) {
                *indegree
                    .get_mut(feature)
                    .expect("dirty feature has indegree") += 1;
                consumers
                    .entry(predecessor)
                    .or_default()
                    .push(feature.clone());
            }
        }
    }
    let mut ready: BTreeSet<(usize, FeatureId)> = indegree
        .iter()
        .filter(|(_, degree)| **degree == 0)
        .map(|(feature, _)| (positions[feature], feature.clone()))
        .collect();
    let mut order = Vec::with_capacity(dirty.len());
    while let Some((_, feature)) = ready.pop_first() {
        order.push(feature.clone());
        for consumer in consumers.get(&feature).into_iter().flatten() {
            let degree = indegree.get_mut(consumer).expect("consumer is dirty");
            *degree -= 1;
            if *degree == 0 {
                ready.insert((positions[consumer], consumer.clone()));
            }
        }
    }
    if order.len() != dirty.len() {
        return Err(EngineError::InvalidDocument(
            "construction-plane recompute dependency cycle".into(),
        ));
    }
    Ok(order)
}

fn runtime_feature_timeline_positions(
    document: &crawler_document::Document,
) -> Result<BTreeMap<FeatureId, usize>, EngineError> {
    let mut positions = BTreeMap::new();
    for component in document.components.values() {
        for feature in &component.feature_order {
            let position = positions.len();
            if positions.insert(feature.clone(), position).is_some() {
                return Err(EngineError::InvalidDocument(format!(
                    "feature {} appears more than once in component timelines",
                    feature.0
                )));
            }
        }
    }
    if positions.len() != document.features.len()
        || document
            .features
            .keys()
            .any(|feature| !positions.contains_key(feature))
    {
        return Err(EngineError::InvalidDocument(
            "component feature timelines must contain every feature exactly once".into(),
        ));
    }
    Ok(positions)
}

fn runtime_feature_predecessors(
    document: &crawler_document::Document,
    feature_id: &FeatureId,
    positions: &BTreeMap<FeatureId, usize>,
) -> BTreeSet<FeatureId> {
    let Some(feature) = document.features.get(feature_id) else {
        return BTreeSet::new();
    };
    let mut predecessors: BTreeSet<_> = feature.dependencies.iter().cloned().collect();
    for input in feature.inputs.values() {
        let producer = match input {
            FeatureInput::Feature(feature) => Some(feature.clone()),
            FeatureInput::Body(body) => document.bodies.get(body).and_then(|body| {
                (body.generated_by != *feature_id
                    && positions.get(&body.generated_by) < positions.get(feature_id))
                .then(|| body.generated_by.clone())
            }),
            FeatureInput::Topology(reference) => document
                .topology_references
                .get(reference)
                .map(|reference| reference.producer.clone()),
            FeatureInput::Sketch(_) => None,
        };
        if let Some(producer) = producer {
            predecessors.insert(producer);
        }
    }
    predecessors
}

fn construction_plane_frame(
    document: &crawler_document::Document,
    plane_id: &ConstructionPlaneId,
    operation_name: &str,
) -> Result<ResolvedPlanarFrame, EngineError> {
    let plane = document.construction_planes.get(plane_id).ok_or_else(|| {
        EngineError::InvalidDocument(format!(
            "missing_construction_plane_support at extrude.support: {operation_name} referenced entity {} is missing",
            plane_id.0
        ))
    })?;
    if plane.suppressed {
        return Err(EngineError::InvalidDocument(format!(
            "suppressed_construction_plane_support at extrude.support: {operation_name} referenced entity {} is suppressed",
            plane_id.0
        )));
    }
    let (base_plane, offset_parameter) = match &plane.definition {
        ConstructionPlaneGeometryV1::Offset { base_plane, offset } => (base_plane, offset),
    };
    let base = document.origin_planes.get(base_plane).ok_or_else(|| {
        EngineError::InvalidDocument(format!(
            "invalid_construction_plane_dependency at extrude.support: {operation_name} construction plane {} references missing entity {}",
            plane_id.0, base_plane.0
        ))
    })?;
    if base.component != plane.component {
        return Err(EngineError::InvalidDocument(format!(
            "invalid_construction_plane_dependency at extrude.support: {operation_name} construction plane {} references base plane {} from another component",
            plane_id.0, base_plane.0
        )));
    }
    let offset_nanometers = match document.parameters.get(offset_parameter) {
        Some(parameter) => {
            validate_construction_plane_offset_parameter(offset_parameter, &parameter.value)?
        }
        None => {
            return Err(EngineError::InvalidDocument(format!(
                "missing_construction_plane_offset_parameter at construction_plane.offset_parameter: {operation_name} referenced entity {} is missing",
                offset_parameter.0
            )));
        }
    };
    let origin_nanometers = scale_millionths(base.normal_millionths, offset_nanometers)?;
    planar_frame(
        origin_nanometers,
        base.x_axis_millionths,
        base.normal_millionths,
        operation_name,
    )
}

fn planar_frame(
    origin_nanometers: [i64; 3],
    x_axis_millionths: [i64; 3],
    normal_millionths: [i64; 3],
    operation_name: &str,
) -> Result<ResolvedPlanarFrame, EngineError> {
    let cross = [
        normal_millionths[1] as i128 * x_axis_millionths[2] as i128
            - normal_millionths[2] as i128 * x_axis_millionths[1] as i128,
        normal_millionths[2] as i128 * x_axis_millionths[0] as i128
            - normal_millionths[0] as i128 * x_axis_millionths[2] as i128,
        normal_millionths[0] as i128 * x_axis_millionths[1] as i128
            - normal_millionths[1] as i128 * x_axis_millionths[0] as i128,
    ];
    let mut y_axis_millionths = [0; 3];
    for axis in 0..3 {
        y_axis_millionths[axis] = i64::try_from(cross[axis] / 1_000_000).map_err(|_| {
            EngineError::InvalidDocument(format!(
                "{operation_name} support frame exceeds exact range"
            ))
        })?;
    }
    Ok(ResolvedPlanarFrame {
        origin_nanometers,
        x_axis_millionths,
        y_axis_millionths,
        normal_millionths,
    })
}

fn sketch_plane_frame(
    document: &crawler_document::Document,
    support: &crawler_document::SketchSupport,
    operation_name: &str,
) -> Result<ResolvedPlanarFrame, EngineError> {
    if let crawler_document::SketchSupport::ConstructionPlaneReference { plane } = support {
        return construction_plane_frame(document, plane, operation_name);
    }
    let (normal, x_axis) = match support {
        crawler_document::SketchSupport::OriginPlane { plane } => match plane {
            crawler_document::OriginPlane::Xy => ([0, 0, 1_000_000], [1_000_000, 0, 0]),
            crawler_document::OriginPlane::Xz => ([0, -1_000_000, 0], [1_000_000, 0, 0]),
            crawler_document::OriginPlane::Yz => ([1_000_000, 0, 0], [0, 1_000_000, 0]),
        },
        crawler_document::SketchSupport::OriginPlaneReference { plane } => {
            let definition = document.origin_planes.get(plane).ok_or_else(|| {
                EngineError::InvalidDocument(format!(
                    "{operation_name} support plane {} is missing",
                    plane.0
                ))
            })?;
            (definition.normal_millionths, definition.x_axis_millionths)
        }
        crawler_document::SketchSupport::Topology { .. } => {
            return Err(EngineError::InvalidDocument(format!(
                "{operation_name} currently requires an origin-plane sketch"
            )));
        }
        crawler_document::SketchSupport::ConstructionPlaneReference { .. } => unreachable!(),
    };
    planar_frame([0; 3], x_axis, normal, operation_name)
}

fn plane_point_nm(point: crawler_sketch::Point2, x_axis: [i64; 3], y_axis: [i64; 3]) -> [i64; 3] {
    std::array::from_fn(|axis| {
        ((point.x_nm as i128 * x_axis[axis] as i128 + point.y_nm as i128 * y_axis[axis] as i128)
            / 1_000_000) as i64
    })
}

fn plane_point_world_nm(
    point: crawler_sketch::Point2,
    frame: &ResolvedPlanarFrame,
) -> Result<[i64; 3], EngineError> {
    let local = plane_point_nm(point, frame.x_axis_millionths, frame.y_axis_millionths);
    let mut world = [0; 3];
    for axis in 0..3 {
        world[axis] = local[axis]
            .checked_add(frame.origin_nanometers[axis])
            .ok_or_else(|| {
                EngineError::InvalidDocument(
                    "Sketch support translation exceeds exact range".into(),
                )
            })?;
    }
    Ok(world)
}

fn scale_millionths(axis: [i64; 3], value: i64) -> Result<[i64; 3], EngineError> {
    let mut result = [0; 3];
    for index in 0..3 {
        let exact = axis[index] as i128 * value as i128 / 1_000_000;
        result[index] = i64::try_from(exact).map_err(|_| {
            EngineError::InvalidDocument("Extrude direction exceeds exact range".into())
        })?;
    }
    Ok(result)
}

/// Convert the durable blind direction contract into the one exact native
/// region/vector representation consumed by the kernel. Reverse translates
/// the region by `-distance` and sweeps it forward so the resulting shell keeps
/// outward orientation. Symmetric distance is deliberately a half-length:
/// translate the region by `-distance`, then extrude it by `+2 * distance`
/// along the support normal.
fn exact_blind_extrude_input(
    region: NativeProfileRegionV2,
    normal_millionths: [i64; 3],
    distance_nanometers: i64,
    direction: ExtrudeDirectionV2,
    tolerance_nm: i64,
) -> Result<NativeExtrudeInputV2, EngineError> {
    if distance_nanometers <= 0 {
        return Err(EngineError::InvalidDocument(
            "Extrude distance must be greater than zero".into(),
        ));
    }
    let (region_offset_nm, directed_distance_nm) = match direction {
        ExtrudeDirectionV2::Positive => ([0; 3], distance_nanometers),
        ExtrudeDirectionV2::Negative => {
            let reversed = distance_nanometers.checked_neg().ok_or_else(|| {
                EngineError::InvalidDocument("Extrude reverse distance exceeds exact range".into())
            })?;
            (
                scale_millionths(normal_millionths, reversed)?,
                distance_nanometers,
            )
        }
        ExtrudeDirectionV2::Symmetric => {
            let reversed = distance_nanometers.checked_neg().ok_or_else(|| {
                EngineError::InvalidDocument("Extrude symmetric offset exceeds exact range".into())
            })?;
            let total = distance_nanometers.checked_mul(2).ok_or_else(|| {
                EngineError::InvalidDocument(
                    "Extrude symmetric total distance exceeds exact range".into(),
                )
            })?;
            (scale_millionths(normal_millionths, reversed)?, total)
        }
    };
    let region = if region_offset_nm == [0; 3] {
        region
    } else {
        translate_native_profile_region(region, region_offset_nm)?
    };
    Ok(NativeExtrudeInputV2 {
        region,
        direction_nm: scale_millionths(normal_millionths, directed_distance_nm)?,
        tolerance_nm,
    })
}

fn translate_native_profile_region(
    mut region: NativeProfileRegionV2,
    translation_nm: [i64; 3],
) -> Result<NativeProfileRegionV2, EngineError> {
    fn translate_point(point: &mut [i64; 3], translation_nm: [i64; 3]) -> Result<(), EngineError> {
        for axis in 0..3 {
            point[axis] = point[axis]
                .checked_add(translation_nm[axis])
                .ok_or_else(|| {
                    EngineError::InvalidDocument(
                        "Extrude symmetric profile translation exceeds exact range".into(),
                    )
                })?;
        }
        Ok(())
    }

    for loop_ in std::iter::once(&mut region.outer).chain(region.holes.iter_mut()) {
        for curve in &mut loop_.curves {
            match curve {
                NativeCurveV2::Line { start_nm, end_nm } => {
                    translate_point(start_nm, translation_nm)?;
                    translate_point(end_nm, translation_nm)?;
                }
                NativeCurveV2::CircularArc {
                    start_nm,
                    end_nm,
                    transit_nm,
                } => {
                    translate_point(start_nm, translation_nm)?;
                    translate_point(end_nm, translation_nm)?;
                    translate_point(transit_nm, translation_nm)?;
                }
                NativeCurveV2::Circle {
                    center_nm,
                    radius_point_nm,
                    transit_point_nm,
                } => {
                    translate_point(center_nm, translation_nm)?;
                    translate_point(radius_point_nm, translation_nm)?;
                    translate_point(transit_point_nm, translation_nm)?;
                }
            }
        }
    }
    Ok(region)
}

fn directed_axis(
    axis: [i64; 3],
    reverse: bool,
    operation_name: &str,
) -> Result<[i64; 3], EngineError> {
    if !reverse {
        return Ok(axis);
    }
    let mut directed = [0; 3];
    for (index, component) in axis.into_iter().enumerate() {
        directed[index] = component.checked_neg().ok_or_else(|| {
            EngineError::InvalidDocument(format!(
                "{operation_name} reversed axis direction exceeds exact range"
            ))
        })?;
    }
    Ok(directed)
}

fn sketch_profile_polygons(
    sketch: &crawler_sketch::Sketch,
    operation_name: &str,
) -> Result<Vec<Vec<crawler_sketch::Point2>>, EngineError> {
    let report = sketch.profile_report();
    if !report.diagnostics.is_empty() {
        return Err(EngineError::InvalidDocument(format!(
            "{operation_name} profile is open or branched; close the sketch profile and retry"
        )));
    }
    if report.closed_profiles.is_empty() {
        return Err(EngineError::InvalidDocument(format!(
            "{operation_name} requires at least one closed profile boundary"
        )));
    }
    report
        .closed_profiles
        .iter()
        .map(|ids| sampled_profile_polygon(sketch, ids, operation_name))
        .collect()
}

fn sampled_profile_polygon(
    sketch: &crawler_sketch::Sketch,
    ids: &[crawler_sketch::GeometryId],
    operation_name: &str,
) -> Result<Vec<crawler_sketch::Point2>, EngineError> {
    if ids.len() == 1 {
        let geometry = &sketch
            .geometry
            .get(&ids[0])
            .ok_or_else(|| {
                EngineError::InvalidDocument(format!(
                    "{operation_name} profile geometry is missing"
                ))
            })?
            .geometry;
        let divisions = match geometry {
            Geometry::Rectangle(_) => 4,
            Geometry::Circle(_) | Geometry::Ellipse(_) => 64,
            _ => 32,
        };
        return Ok((0..divisions)
            .map(|index| crawler_sketch::evaluate_curve(geometry, index as f64 / divisions as f64))
            .collect());
    }

    let mut remaining = ids.to_vec();
    let first_id = remaining.remove(0);
    let first = sketch.geometry.get(&first_id).ok_or_else(|| {
        EngineError::InvalidDocument(format!("{operation_name} profile geometry is missing"))
    })?;
    let mut polygon = sampled_profile_curve(&first.geometry);
    while !remaining.is_empty() {
        let endpoint = *polygon.last().ok_or_else(|| {
            EngineError::InvalidDocument(format!("{operation_name} profile has no points"))
        })?;
        let match_index = remaining
            .iter()
            .position(|id| {
                let Some(entity) = sketch.geometry.get(id) else {
                    return false;
                };
                let points = sampled_profile_curve(&entity.geometry);
                points.first() == Some(&endpoint) || points.last() == Some(&endpoint)
            })
            .ok_or_else(|| {
                EngineError::InvalidDocument(format!(
                    "{operation_name} profile could not be ordered into one closed loop"
                ))
            })?;
        let id = remaining.remove(match_index);
        let mut points = sampled_profile_curve(&sketch.geometry[&id].geometry);
        if points.last() == Some(&endpoint) {
            points.reverse();
        }
        polygon.extend(points.into_iter().skip(1));
    }
    if polygon.first() != polygon.last() {
        return Err(EngineError::InvalidDocument(format!(
            "{operation_name} profile endpoints do not close"
        )));
    }
    polygon.pop();
    Ok(polygon)
}

fn sampled_profile_curve(geometry: &Geometry) -> Vec<crawler_sketch::Point2> {
    let divisions = match geometry {
        Geometry::Line(_) => 1,
        Geometry::Arc(_) | Geometry::Conic(_) => 16,
        Geometry::EllipticalArc(_)
        | Geometry::ControlPointSpline(_)
        | Geometry::FitPointSpline(_) => 24,
        Geometry::Circle(_) | Geometry::Ellipse(_) | Geometry::Rectangle(_) => 32,
        Geometry::SketchPoint(_) => 1,
    };
    (0..=divisions)
        .map(|index| crawler_sketch::evaluate_curve(geometry, index as f64 / divisions as f64))
        .collect()
}

fn sketch_path_polyline(
    sketch: &crawler_sketch::Sketch,
    operation_name: &str,
) -> Result<Vec<crawler_sketch::Point2>, EngineError> {
    let mut segments = sketch
        .geometry
        .values()
        .filter(|entity| !matches!(entity.geometry, Geometry::SketchPoint(_)))
        .map(|entity| sampled_profile_curve(&entity.geometry))
        .collect::<Vec<_>>();
    if segments.is_empty() || segments.iter().any(|points| points.len() < 2) {
        return Err(EngineError::InvalidDocument(format!(
            "{operation_name} path must contain at least one curve"
        )));
    }
    let endpoint_degree = |point: crawler_sketch::Point2,
                           values: &[Vec<crawler_sketch::Point2>]| {
        values
            .iter()
            .filter(|points| points.first() == Some(&point) || points.last() == Some(&point))
            .count()
    };
    let start = segments
        .iter()
        .enumerate()
        .find_map(|(index, points)| {
            let first = *points.first()?;
            let last = *points.last()?;
            (endpoint_degree(first, &segments) == 1)
                .then_some((index, false))
                .or_else(|| (endpoint_degree(last, &segments) == 1).then_some((index, true)))
        })
        .ok_or_else(|| {
            EngineError::InvalidDocument(format!(
                "{operation_name} path must be one open, unbranched chain"
            ))
        })?;
    let mut points = segments.remove(start.0);
    if start.1 {
        points.reverse();
    }
    while !segments.is_empty() {
        let endpoint = *points.last().unwrap();
        let matches = segments
            .iter()
            .enumerate()
            .filter_map(|(index, segment)| {
                (segment.first() == Some(&endpoint))
                    .then_some((index, false))
                    .or_else(|| (segment.last() == Some(&endpoint)).then_some((index, true)))
            })
            .collect::<Vec<_>>();
        if matches.len() != 1 {
            return Err(EngineError::InvalidDocument(format!(
                "{operation_name} path must be one connected, unbranched chain"
            )));
        }
        let mut next = segments.remove(matches[0].0);
        if matches[0].1 {
            next.reverse();
        }
        points.extend(next.into_iter().skip(1));
    }
    if points.first() == points.last() {
        return Err(EngineError::InvalidDocument(format!(
            "{operation_name} path must be open"
        )));
    }
    Ok(points)
}

fn push_dependency(dependencies: &mut Vec<FeatureId>, feature: FeatureId) {
    if !dependencies.contains(&feature) {
        dependencies.push(feature);
    }
}

fn bind_prepared_parameter(
    feature_id: &str,
    field: &str,
    display_name: &str,
    value: ParameterValue,
    bindings: &mut BTreeMap<String, ParameterId>,
    definitions: &mut Vec<Parameter>,
) {
    let id = ParameterId(format!("parameter:{feature_id}:{field}"));
    bindings.insert(field.into(), id.clone());
    definitions.push(Parameter {
        id,
        display_name: display_name.into(),
        value,
    });
}

fn dimensions_json(dimensions: PartDimensions) -> serde_json::Value {
    serde_json::json!({
        "width_nanometers": dimensions.width_nanometers,
        "height_nanometers": dimensions.height_nanometers,
        "distance_nanometers": dimensions.distance_nanometers,
        "bounds_nanometers": dimensions.bounds(),
    })
}

#[cfg(target_arch = "wasm32")]
mod wasm {
    use super::*;
    use wasm_bindgen::prelude::*;

    /// JavaScript-facing document-engine owner intended for a dedicated worker.
    #[wasm_bindgen]
    pub struct WasmPartRuntime(PartRuntime);

    #[wasm_bindgen]
    impl WasmPartRuntime {
        #[wasm_bindgen(js_name = fromDocumentJson)]
        pub fn from_document_json(document_json: String) -> Result<WasmPartRuntime, JsValue> {
            PartRuntime::from_document_json(&document_json)
                .map(WasmPartRuntime)
                .map_err(js_error)
        }

        #[wasm_bindgen(js_name = fromPortablePackage)]
        pub fn from_portable_package(package_bytes: Vec<u8>) -> Result<WasmPartRuntime, JsValue> {
            PartRuntime::from_portable_package(&package_bytes)
                .map(WasmPartRuntime)
                .map_err(js_error)
        }

        #[wasm_bindgen(constructor)]
        pub fn new(document_id: String, display_name: String) -> Result<WasmPartRuntime, JsValue> {
            PartRuntime::new_blank_part(document_id.as_str(), display_name)
                .map(WasmPartRuntime)
                .map_err(js_error)
        }

        #[wasm_bindgen(js_name = newValidationRectangularPart)]
        pub fn new_validation_rectangular_part(
            document_id: String,
            display_name: String,
            width_nanometers: i64,
            height_nanometers: i64,
            distance_nanometers: i64,
        ) -> Result<WasmPartRuntime, JsValue> {
            PartRuntime::new_rectangular_part(
                document_id.as_str(),
                display_name,
                width_nanometers,
                height_nanometers,
                distance_nanometers,
            )
            .map(WasmPartRuntime)
            .map_err(js_error)
        }

        #[wasm_bindgen(js_name = documentJson)]
        pub fn document_json(&self) -> Result<String, JsValue> {
            self.0.document_json().map_err(js_error)
        }

        #[wasm_bindgen(js_name = semanticHash)]
        pub fn semantic_hash(&self) -> Result<String, JsValue> {
            self.0.semantic_hash().map_err(js_error)
        }

        #[wasm_bindgen(js_name = previewOffsetConstructionPlaneJson)]
        pub fn preview_offset_construction_plane_json(
            &self,
            request_json: String,
        ) -> Result<String, JsValue> {
            self.0
                .preview_offset_construction_plane_json(&request_json)
                .map_err(js_error)
        }

        #[wasm_bindgen(js_name = commitOffsetConstructionPlaneJson)]
        pub fn commit_offset_construction_plane_json(
            &mut self,
            request_json: String,
        ) -> Result<String, JsValue> {
            self.0
                .commit_offset_construction_plane_json(&request_json)
                .map_err(js_error)
        }

        #[wasm_bindgen(js_name = constructionPlaneFrameJson)]
        pub fn construction_plane_frame_json(&self, plane_id: String) -> Result<String, JsValue> {
            self.0
                .construction_plane_frame_json(&plane_id)
                .map_err(js_error)
        }

        #[wasm_bindgen(js_name = retainImportedStepSource)]
        pub fn retain_imported_step_source(&mut self, source_bytes: Vec<u8>) -> String {
            self.0.retain_imported_step_source(&source_bytes)
        }

        #[wasm_bindgen(js_name = importedStepSource)]
        pub fn imported_step_source(&self, source_sha256: String) -> Result<Vec<u8>, JsValue> {
            self.0
                .imported_step_source(&source_sha256)
                .map(<[u8]>::to_vec)
                .ok_or_else(|| {
                    js_error(EngineError::InvalidDocument(format!(
                        "imported STEP source {source_sha256} is not retained"
                    )))
                })
        }

        #[wasm_bindgen(js_name = exportPortablePackage)]
        pub fn export_portable_package(&self) -> Result<Vec<u8>, JsValue> {
            self.0.export_portable_package().map_err(js_error)
        }

        #[wasm_bindgen(js_name = dimensionsJson)]
        pub fn dimensions_json(&self) -> Result<String, JsValue> {
            self.0.dimensions_json().map_err(js_error)
        }

        #[wasm_bindgen(js_name = commitLength)]
        pub fn commit_length(
            &mut self,
            parameter_id: String,
            value_nanometers: i64,
        ) -> Result<String, JsValue> {
            self.0
                .commit_length(parameter_id.as_str(), value_nanometers)
                .map_err(js_error)
        }

        #[wasm_bindgen(js_name = previewExtrudeJson)]
        pub fn preview_extrude_json(
            &self,
            value_nanometers: i64,
            tolerance: f64,
        ) -> Result<String, JsValue> {
            self.0
                .preview_extrude_json(value_nanometers, tolerance)
                .map_err(js_error)
        }

        #[wasm_bindgen(js_name = previewSketchExtrudeJson)]
        pub fn preview_sketch_extrude_json(&self, request_json: String) -> Result<String, JsValue> {
            self.0
                .preview_sketch_extrude_json(&request_json)
                .map_err(js_error)
        }

        #[wasm_bindgen(js_name = commitSketchExtrudeJson)]
        pub fn commit_sketch_extrude_json(
            &mut self,
            request_json: String,
        ) -> Result<String, JsValue> {
            self.0
                .commit_sketch_extrude_json(&request_json)
                .map_err(js_error)
        }

        #[wasm_bindgen(js_name = validateSingleTargetCutTargetsJson)]
        pub fn validate_single_target_cut_targets_json(
            &self,
            request_json: String,
        ) -> Result<String, JsValue> {
            self.0
                .validate_single_target_cut_targets_json(&request_json)
                .map_err(js_error)
        }

        #[wasm_bindgen(js_name = parametersJson)]
        pub fn parameters_json(&self) -> Result<String, JsValue> {
            self.0.parameters_json().map_err(js_error)
        }

        #[wasm_bindgen(js_name = setFieldExpressionJson)]
        pub fn set_field_expression_json(
            &mut self,
            request_json: String,
        ) -> Result<String, JsValue> {
            self.0
                .set_field_expression_json(&request_json)
                .map_err(js_error)
        }

        #[wasm_bindgen(js_name = renameParameterJson)]
        pub fn rename_parameter_json(&mut self, request_json: String) -> Result<String, JsValue> {
            self.0
                .rename_parameter_json(&request_json)
                .map_err(js_error)
        }

        #[wasm_bindgen(js_name = promoteOrReuseParameterJson)]
        pub fn promote_or_reuse_parameter_json(
            &mut self,
            request_json: String,
        ) -> Result<String, JsValue> {
            self.0
                .promote_or_reuse_parameter_json(&request_json)
                .map_err(js_error)
        }

        #[wasm_bindgen(js_name = commitChangesJson)]
        pub fn commit_changes_json(&mut self, transaction_json: String) -> Result<String, JsValue> {
            self.0
                .commit_changes_json(&transaction_json)
                .map_err(js_error)
        }

        #[wasm_bindgen(js_name = setTimelineRollback)]
        pub fn set_timeline_rollback(&mut self, rollback_json: String) -> Result<String, JsValue> {
            self.0
                .set_timeline_rollback(&rollback_json)
                .map_err(js_error)
        }

        #[wasm_bindgen(js_name = timelineRollbackJson)]
        pub fn timeline_rollback_json(&self) -> Result<String, JsValue> {
            self.0.timeline_rollback_json().map_err(js_error)
        }

        #[wasm_bindgen(js_name = featureServicesJson)]
        pub fn feature_services_json(&self, selected: String) -> Result<String, JsValue> {
            self.0.feature_services_json(&selected).map_err(js_error)
        }

        #[wasm_bindgen(js_name = recomputeFromHereJson)]
        pub fn recompute_from_here_json(&mut self, selected: String) -> Result<String, JsValue> {
            self.0.recompute_from_here_json(&selected).map_err(js_error)
        }

        #[wasm_bindgen(js_name = repairInspectionJson)]
        pub fn repair_inspection_json(&self, observed_json: String) -> Result<String, JsValue> {
            self.0
                .repair_inspection_json(&observed_json)
                .map_err(js_error)
        }

        #[wasm_bindgen(js_name = topologySupportDiagnosticJson)]
        pub fn topology_support_diagnostic_json(
            &self,
            reference_id: String,
            expected_component_id: String,
        ) -> Result<String, JsValue> {
            self.0
                .topology_support_diagnostic_json(&reference_id, &expected_component_id)
                .map_err(js_error)
        }

        #[wasm_bindgen(js_name = previewTopologyRebindJson)]
        pub fn preview_topology_rebind_json(
            &self,
            request_json: String,
        ) -> Result<String, JsValue> {
            self.0
                .preview_topology_rebind_json(&request_json)
                .map_err(js_error)
        }

        #[wasm_bindgen(js_name = explicitRebindJson)]
        pub fn explicit_rebind_json(&mut self, request_json: String) -> Result<String, JsValue> {
            self.0.explicit_rebind_json(&request_json).map_err(js_error)
        }

        #[wasm_bindgen(js_name = renderPacketJson)]
        pub fn render_packet_json(&self, tolerance: f64) -> Result<String, JsValue> {
            self.0.render_packet_json(tolerance).map_err(js_error)
        }

        #[wasm_bindgen(js_name = activeBodyJson)]
        pub fn active_body_json(&self, tolerance: f64) -> Result<String, JsValue> {
            self.0.active_body_json(tolerance).map_err(js_error)
        }

        #[wasm_bindgen(js_name = bodySnapshotJson)]
        pub fn body_snapshot_json(&self, body_id: String) -> Result<String, JsValue> {
            self.0.body_snapshot_json(&body_id).map_err(js_error)
        }

        #[wasm_bindgen(js_name = planarFaceFrameJson)]
        pub fn planar_face_frame_json(
            &self,
            body_id: String,
            face_stable_id_decimal: String,
        ) -> Result<String, JsValue> {
            self.0
                .planar_face_frame_json(&body_id, &face_stable_id_decimal)
                .map_err(js_error)
        }

        #[wasm_bindgen(js_name = solveSketchJson)]
        pub fn solve_sketch_json(&mut self, request_json: String) -> Result<String, JsValue> {
            self.0.solve_sketch_json(&request_json).map_err(js_error)
        }

        #[wasm_bindgen(js_name = applySketchCommandJson)]
        pub fn apply_sketch_command_json(&self, request_json: String) -> Result<String, JsValue> {
            self.0
                .apply_sketch_command_json(&request_json)
                .map_err(js_error)
        }

        #[wasm_bindgen(js_name = applySketchCommandsJson)]
        pub fn apply_sketch_commands_json(&self, request_json: String) -> Result<String, JsValue> {
            self.0
                .apply_sketch_commands_json(&request_json)
                .map_err(js_error)
        }

        #[wasm_bindgen(js_name = dragSketchJson)]
        pub fn drag_sketch_json(&self, request_json: String) -> Result<String, JsValue> {
            self.0.drag_sketch_json(&request_json).map_err(js_error)
        }

        #[wasm_bindgen(js_name = sketchSolverContractJson)]
        pub fn sketch_solver_contract_json(&self) -> Result<String, JsValue> {
            self.0.sketch_solver_contract_json().map_err(js_error)
        }

        #[wasm_bindgen(js_name = decomposeSketchJson)]
        pub fn decompose_sketch_json(&self, request_json: String) -> Result<String, JsValue> {
            self.0
                .decompose_sketch_json(&request_json)
                .map_err(js_error)
        }

        #[wasm_bindgen(js_name = exportSketchDxfJson)]
        pub fn export_sketch_dxf_json(&self, request_json: String) -> Result<String, JsValue> {
            self.0
                .export_sketch_dxf_json(&request_json)
                .map_err(js_error)
        }

        #[wasm_bindgen(js_name = importSketchDxfJson)]
        pub fn import_sketch_dxf_json(&self, request_json: String) -> Result<String, JsValue> {
            self.0
                .import_sketch_dxf_json(&request_json)
                .map_err(js_error)
        }

        #[wasm_bindgen(js_name = executeFeatureJson)]
        pub fn execute_feature_json(&mut self, envelope_json: String) -> Result<String, JsValue> {
            self.0
                .execute_feature_json(&envelope_json)
                .map_err(js_error)
        }

        #[wasm_bindgen(js_name = previewFeatureJson)]
        pub fn preview_feature_json(&self, envelope_json: String) -> Result<String, JsValue> {
            self.0
                .preview_feature_json(&envelope_json)
                .map_err(js_error)
        }

        #[wasm_bindgen(js_name = prepareSketchFeatureEnvelopeJson)]
        pub fn prepare_sketch_feature_envelope_json(
            &self,
            request_json: String,
        ) -> Result<String, JsValue> {
            self.0
                .prepare_sketch_feature_envelope_json(&request_json)
                .map_err(js_error)
        }

        #[wasm_bindgen(js_name = executeNewFeatureJson)]
        pub fn execute_new_feature_json(
            &mut self,
            envelope_json: String,
        ) -> Result<String, JsValue> {
            self.0
                .execute_new_feature_json(&envelope_json)
                .map_err(js_error)
        }

        pub fn undo(&mut self) -> Result<String, JsValue> {
            self.0.undo().map_err(js_error)
        }

        pub fn redo(&mut self) -> Result<String, JsValue> {
            self.0.redo().map_err(js_error)
        }

        #[wasm_bindgen(js_name = exportStep)]
        pub fn export_step(&self) -> Result<String, JsValue> {
            self.0.export_text(ExportFormat::Step).map_err(js_error)
        }

        #[wasm_bindgen(js_name = exportStl)]
        pub fn export_stl(&self) -> Result<String, JsValue> {
            self.0.export_text(ExportFormat::Stl).map_err(js_error)
        }

        #[wasm_bindgen(js_name = exportObj)]
        pub fn export_obj(&self) -> Result<String, JsValue> {
            self.0.export_text(ExportFormat::Obj).map_err(js_error)
        }
    }

    fn js_error(error: EngineError) -> JsValue {
        JsValue::from_str(&error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crawler_document::{
        BodyId, ComponentId, Document, DocumentTransaction, Feature, FeatureInput,
        FeatureRecomputeState, ModelVisibility, OperationReference, ParameterExpression,
        ParameterExpressionNode, ParameterValue, SketchElement, SketchId, TopologyKind,
        TopologyReference, TopologyReferenceId, TopologySignature,
    };
    use crawler_feature_kernel::{AxisAlignedBoundsNm, GeometryEvidence};
    use monstertruck_modeling::{Point3, Vector3, builder};

    fn runtime() -> PartRuntime {
        PartRuntime::new_rectangular_part(
            "document:runtime-cube",
            "Runtime Cube",
            10_000_000,
            10_000_000,
            10_000_000,
        )
        .unwrap()
    }

    #[test]
    fn blank_runtime_has_no_validation_body_or_dimensions() {
        let runtime =
            PartRuntime::new_blank_part("document:blank-runtime", "Untitled Part").unwrap();
        let document: Document = serde_json::from_str(&runtime.document_json().unwrap()).unwrap();
        let packet: serde_json::Value =
            serde_json::from_str(&runtime.render_packet_json(0.01).unwrap()).unwrap();

        assert!(document.bodies.is_empty());
        assert!(document.features.is_empty());
        assert!(document.transactions.is_empty());
        assert_eq!(runtime.dimensions_json().unwrap(), "null");
        assert!(packet["body_id"].is_null());
        assert!(packet["packet"]["positions"].as_array().unwrap().is_empty());

        let restored = PartRuntime::from_document_json(&runtime.document_json().unwrap()).unwrap();
        assert_eq!(
            restored.semantic_hash().unwrap(),
            runtime.semantic_hash().unwrap()
        );
    }

    #[test]
    fn accepted_closed_sketch_previews_and_commits_a_real_extrude_body() {
        let mut runtime =
            PartRuntime::new_blank_part("document:sketch-extrude", "Sketch Extrude").unwrap();
        let sketch = serde_json::json!({
            "id": "sketch:profile",
            "revision": 0,
            "geometry": {
                "geometry:rectangle": {
                    "id": "geometry:rectangle",
                    "geometry": {
                        "kind": "rectangle",
                        "min": { "x_nm": 0, "y_nm": 0 },
                        "max": { "x_nm": 20_000_000, "y_nm": 10_000_000 }
                    }
                }
            },
            "constraints": {}
        });
        let support = serde_json::json!({
            "kind": "origin_plane_reference",
            "plane": "origin-plane:xy"
        });
        let solved: serde_json::Value = serde_json::from_str(
            &runtime
                .solve_sketch_json(
                    &serde_json::json!({
                        "transaction_id": "transaction:sketch",
                        "sketch": sketch,
                        "support": support
                    })
                    .to_string(),
                )
                .unwrap(),
        )
        .unwrap();
        assert_eq!(solved["accepted"], true);

        let request = serde_json::json!({
            "sketch": sketch,
            "support": support,
            "distance_nanometers": 5_000_000,
            "feature_id": "feature:extrude:profile",
            "body_id": "body:extrude:profile",
            "tolerance": 0.01
        });
        let before = runtime.semantic_hash().unwrap();
        let preview: serde_json::Value = serde_json::from_str(
            &runtime
                .preview_sketch_extrude_json(&request.to_string())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(preview["render"]["body_id"], "body:extrude:profile");
        assert_eq!(
            preview["render"]["packet"]["bounds"],
            serde_json::json!([0.0, 0.0, 0.0, 20.0, 10.0, 5.0])
        );
        assert_eq!(runtime.semantic_hash().unwrap(), before);

        let mut commit = request;
        commit["transaction_id"] = serde_json::json!("transaction:extrude");
        let outcome: serde_json::Value = serde_json::from_str(
            &runtime
                .commit_sketch_extrude_json(&commit.to_string())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(outcome["accepted"], true);
        let document: Document = serde_json::from_str(&runtime.document_json().unwrap()).unwrap();
        assert!(
            document
                .bodies
                .contains_key(&BodyId::from("body:extrude:profile"))
        );
        assert_eq!(
            document.features[&FeatureId::from("feature:extrude:profile")].dependencies,
            [FeatureId::from("feature:sketch:profile")]
        );
        let definition =
            &document.feature_definitions_v2[&FeatureId::from("feature:extrude:profile")];
        let ProfileReferenceV2::SketchRegion { region, .. } = match &definition.operation {
            crawler_document::FeatureOperationV2::Extrude { profile, .. } => profile,
        };
        let stored_region = &document.region_definitions_v2[region];
        assert_eq!(stored_region.outer_geometry_ids, ["geometry:rectangle"]);
        assert!(stored_region.hole_geometry_ids.is_empty());
        let request_json = document
            .transactions
            .last()
            .unwrap()
            .changes
            .iter()
            .find_map(|change| match change {
                DocumentChange::AcceptFeatureResult { request_json, .. } => Some(request_json),
                _ => None,
            })
            .unwrap();
        assert!(request_json.contains("native_extrude_v2"));
        assert!(!request_json.contains("profiles_nm"));

        let created_hash = runtime.semantic_hash().unwrap();
        commit["transaction_id"] = serde_json::json!("transaction:extrude-edit");
        commit["distance_nanometers"] = serde_json::json!(7_000_000);
        let edited: serde_json::Value = serde_json::from_str(
            &runtime
                .commit_sketch_extrude_json(&commit.to_string())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(edited["accepted"], true, "{edited:#}");
        assert_ne!(runtime.semantic_hash().unwrap(), created_hash);
        assert_eq!(
            edited["result"]["output"]["body_id"],
            "body:extrude:profile"
        );
        let edited_document = runtime.document_json().unwrap();
        let mut restored = PartRuntime::from_document_json(&edited_document).unwrap();
        let recompute: serde_json::Value = serde_json::from_str(
            &restored
                .recompute_from_here_json("feature:extrude:profile")
                .unwrap(),
        )
        .unwrap();
        assert_eq!(recompute["accepted"], true, "{recompute:#}");
    }

    #[test]
    fn extrude_missing_requested_support_is_typed_before_support_equality() {
        let mut runtime =
            PartRuntime::new_blank_part("document:extrude-missing-support", "Missing support")
                .unwrap();
        let sketch = serde_json::json!({
            "id":"sketch:accepted-origin-profile",
            "revision":0,
            "geometry":{"geometry:rectangle":{
                "id":"geometry:rectangle",
                "geometry":{"kind":"rectangle","min":{"x_nm":0,"y_nm":0},"max":{"x_nm":1_000_000,"y_nm":1_000_000}}
            }},
            "constraints":{}
        });
        runtime
            .solve_sketch_json(
                &serde_json::json!({
                    "transaction_id":"transaction:accepted-origin-profile",
                    "sketch":sketch,
                    "support":{"kind":"origin_plane_reference","plane":"origin-plane:xy"}
                })
                .to_string(),
            )
            .unwrap();
        let mut request = serde_json::json!({
            "sketch":sketch,
            "support":{"kind":"construction_plane_reference","plane":"construction-plane:missing-request-support"},
            "distance_nanometers":1_000_000,
            "feature_id":"feature:missing-request-support",
            "body_id":"body:missing-request-support",
            "tolerance":0.01
        });
        let before = runtime.semantic_hash().unwrap();
        let preview_error = runtime
            .preview_sketch_extrude_json(&request.to_string())
            .unwrap_err()
            .to_string();
        request["transaction_id"] = serde_json::json!("transaction:missing-request-support");
        let commit_error = runtime
            .commit_sketch_extrude_json(&request.to_string())
            .unwrap_err()
            .to_string();
        assert_eq!(preview_error, commit_error);
        for token in [
            "missing_construction_plane_support",
            "extrude.support",
            "construction-plane:missing-request-support",
        ] {
            assert!(commit_error.contains(token), "{commit_error}");
        }
        assert!(!commit_error.contains("support differs"), "{commit_error}");
        assert_eq!(runtime.semantic_hash().unwrap(), before);
    }

    #[test]
    fn explicit_profile_ids_select_one_region_and_refuse_stale_boundaries_without_mutation() {
        let mut runtime =
            PartRuntime::new_blank_part("document:multi-profile", "Multi Profile").unwrap();
        let sketch = serde_json::json!({
            "id": "sketch:multi-profile",
            "revision": 0,
            "geometry": {
                "rectangle:left": { "id": "rectangle:left", "geometry": { "kind": "rectangle", "min": { "x_nm": 0, "y_nm": 0 }, "max": { "x_nm": 4_000_000, "y_nm": 6_000_000 } } },
                "rectangle:right": { "id": "rectangle:right", "geometry": { "kind": "rectangle", "min": { "x_nm": 20_000_000, "y_nm": 0 }, "max": { "x_nm": 30_000_000, "y_nm": 8_000_000 } } },
                "line:unrelated-open": { "id": "line:unrelated-open", "geometry": { "kind": "line", "start": { "x_nm": -5_000_000, "y_nm": 0 }, "end": { "x_nm": -5_000_000, "y_nm": 5_000_000 } } },
                "line:axis": { "id": "line:axis", "construction": true, "geometry": { "kind": "line", "start": { "x_nm": 0, "y_nm": -5_000_000 }, "end": { "x_nm": 0, "y_nm": 10_000_000 } } }
            },
            "constraints": {}
        });
        let support =
            serde_json::json!({ "kind": "origin_plane_reference", "plane": "origin-plane:xy" });
        let solved: serde_json::Value = serde_json::from_str(&runtime.solve_sketch_json(&serde_json::json!({
            "transaction_id": "transaction:multi-profile-sketch", "sketch": sketch, "support": support
        }).to_string()).unwrap()).unwrap();
        assert_eq!(solved["accepted"], true, "{solved:#}");

        let base = serde_json::json!({
            "sketch": sketch, "support": support, "distance_nanometers": 3_000_000,
            "feature_id": "feature:multi-profile", "body_id": "body:multi-profile", "tolerance": 0.01
        });
        let before = runtime.semantic_hash().unwrap();
        assert!(
            runtime
                .preview_sketch_extrude_json(&base.to_string())
                .unwrap_err()
                .to_string()
                .contains("open or branched")
        );
        let mut selected = base.clone();
        selected["profile_geometry_ids"] = serde_json::json!(["rectangle:right"]);
        let preview: serde_json::Value = serde_json::from_str(
            &runtime
                .preview_sketch_extrude_json(&selected.to_string())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            preview["render"]["packet"]["bounds"],
            serde_json::json!([20.0, 0.0, 0.0, 30.0, 8.0, 3.0])
        );
        assert_eq!(runtime.semantic_hash().unwrap(), before);

        // Accept an edit that removes the selected region, then prove a
        // request assembled from the formerly accepted DTO cannot revive it.
        let mut edited_sketch = base["sketch"].clone();
        edited_sketch["revision"] = serde_json::json!(1);
        edited_sketch["geometry"]
            .as_object_mut()
            .unwrap()
            .remove("rectangle:right");
        let edited: serde_json::Value = serde_json::from_str(
            &runtime
                .solve_sketch_json(
                    &serde_json::json!({
                        "transaction_id": "transaction:multi-profile-edit",
                        "sketch": edited_sketch,
                        "support": support
                    })
                    .to_string(),
                )
                .unwrap(),
        )
        .unwrap();
        assert_eq!(edited["accepted"], true, "{edited:#}");
        let after_edit = runtime.semantic_hash().unwrap();
        let stale_error = runtime
            .preview_sketch_extrude_json(&selected.to_string())
            .unwrap_err();
        assert!(
            stale_error
                .to_string()
                .contains("stale or no longer closed")
        );
        assert_eq!(runtime.semantic_hash().unwrap(), after_edit);

        selected["profile_geometry_ids"] = serde_json::json!(["rectangle:deleted"]);
        let error = runtime
            .preview_sketch_extrude_json(&selected.to_string())
            .unwrap_err();
        assert!(error.to_string().contains("stale or no longer closed"));
        assert_eq!(runtime.semantic_hash().unwrap(), after_edit);
    }

    #[test]
    fn exact_circle_region_with_hole_round_trips_without_polygon_transport() {
        let mut runtime =
            PartRuntime::new_blank_part("document:annulus-extrude", "Annulus Extrude").unwrap();
        let sketch = serde_json::json!({
            "id": "sketch:annulus",
            "revision": 0,
            "geometry": {
                "circle:outer": { "id": "circle:outer", "geometry": { "kind": "circle", "center": { "x_nm": 0, "y_nm": 0 }, "radius_nm": 10_000_000 } },
                "circle:hole": { "id": "circle:hole", "geometry": { "kind": "circle", "center": { "x_nm": 0, "y_nm": 0 }, "radius_nm": 4_000_000 } }
            },
            "constraints": {}
        });
        let support =
            serde_json::json!({ "kind": "origin_plane_reference", "plane": "origin-plane:xy" });
        let solved: serde_json::Value = serde_json::from_str(
            &runtime
                .solve_sketch_json(
                    &serde_json::json!({
                        "transaction_id": "transaction:annulus-sketch",
                        "sketch": sketch,
                        "support": support
                    })
                    .to_string(),
                )
                .unwrap(),
        )
        .unwrap();
        assert_eq!(solved["accepted"], true, "{solved:#}");
        let outcome: serde_json::Value = serde_json::from_str(
            &runtime
                .commit_sketch_extrude_json(
                    &serde_json::json!({
                        "transaction_id": "transaction:annulus-extrude",
                        "sketch": sketch,
                        "support": support,
                        "profile_geometry_ids": ["circle:outer"],
                        "distance_nanometers": 5_000_000,
                        "feature_id": "feature:annulus-extrude",
                        "body_id": "body:annulus-extrude",
                        "tolerance": 0.01
                    })
                    .to_string(),
                )
                .unwrap(),
        )
        .unwrap();
        assert_eq!(outcome["accepted"], true, "{outcome:#}");
        let document: Document = serde_json::from_str(&runtime.document_json().unwrap()).unwrap();
        let definition =
            &document.feature_definitions_v2[&FeatureId::from("feature:annulus-extrude")];
        let region = match &definition.operation {
            crawler_document::FeatureOperationV2::Extrude {
                profile: ProfileReferenceV2::SketchRegion { region, .. },
                ..
            } => region,
        };
        let stored = &document.region_definitions_v2[region];
        assert_eq!(stored.outer_geometry_ids, ["circle:outer"]);
        assert_eq!(stored.hole_geometry_ids, [["circle:hole"]]);
        let request_json = document
            .transactions
            .last()
            .unwrap()
            .changes
            .iter()
            .find_map(|change| match change {
                DocumentChange::AcceptFeatureResult { request_json, .. } => Some(request_json),
                _ => None,
            })
            .unwrap();
        assert_eq!(request_json.matches("\"kind\":\"circle\"").count(), 2);
        assert!(!request_json.contains("profiles_nm"));
    }

    #[test]
    fn extent_edit_uses_latest_matching_body_and_matches_a_full_rebuild() {
        let mut runtime =
            PartRuntime::new_blank_part("document:annulus-extent-edit", "Annulus Edit").unwrap();
        let sketch = serde_json::json!({
            "id": "sketch:annulus-extent-edit",
            "revision": 0,
            "geometry": {
                "circle:outer": { "id": "circle:outer", "geometry": { "kind": "circle", "center": { "x_nm": 0, "y_nm": 0 }, "radius_nm": 10_000_000 } },
                "circle:hole": { "id": "circle:hole", "geometry": { "kind": "circle", "center": { "x_nm": 0, "y_nm": 0 }, "radius_nm": 4_000_000 } }
            },
            "constraints": {}
        });
        let support =
            serde_json::json!({ "kind": "origin_plane_reference", "plane": "origin-plane:xy" });
        let solved: serde_json::Value = serde_json::from_str(
            &runtime
                .solve_sketch_json(
                    &serde_json::json!({
                        "transaction_id": "transaction:annulus-extent-sketch",
                        "sketch": sketch,
                        "support": support
                    })
                    .to_string(),
                )
                .unwrap(),
        )
        .unwrap();
        assert_eq!(solved["accepted"], true, "{solved:#}");

        let mut request = serde_json::json!({
            "sketch": sketch,
            "support": support,
            "profile_geometry_ids": ["circle:outer"],
            "distance_nanometers": 5_000_000,
            "feature_id": "feature:annulus-extent-edit",
            "body_id": "body:annulus-extent-edit",
            "tolerance": 0.01,
            "transaction_id": "transaction:annulus-extent-create"
        });
        let created: serde_json::Value = serde_json::from_str(
            &runtime
                .commit_sketch_extrude_json(&request.to_string())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(created["accepted"], true, "{created:#}");

        request["distance_nanometers"] = serde_json::json!(7_000_000);
        request["transaction_id"] = serde_json::json!("transaction:annulus-extent-edit");
        let edit_request: SketchExtrudeRequest = serde_json::from_value(request.clone()).unwrap();
        let kernel_request = runtime
            .sketch_extrude_feature_request(&edit_request)
            .unwrap();
        let extent_edited = runtime
            .execute_feature_with_extent_edit(&kernel_request)
            .unwrap();
        let rebuilt = execute_feature(&kernel_request).unwrap();
        assert_eq!(extent_edited.schema_version, rebuilt.schema_version);
        assert_eq!(extent_edited.document_id, rebuilt.document_id);
        assert_eq!(extent_edited.feature_id, rebuilt.feature_id);
        assert_eq!(extent_edited.output.body_id, rebuilt.output.body_id);
        assert_eq!(extent_edited.output.evidence, rebuilt.output.evidence);

        let edited: serde_json::Value = serde_json::from_str(
            &runtime
                .commit_sketch_extrude_json(&request.to_string())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(edited["accepted"], true, "{edited:#}");
        let accepted_latest: BodySnapshot =
            serde_json::from_value(edited["result"]["output"].clone()).unwrap();
        assert_eq!(accepted_latest, extent_edited.output);

        // A newer unrelated journal entry may be malformed without poisoning
        // lookup for this feature/body. The reverse scan must skip it without
        // attempting to decode its payload, then return the 7 mm edit rather
        // than the older 5 mm creation result.
        let mut document: Document =
            serde_json::from_str(&runtime.document_json().unwrap()).unwrap();
        document.transactions.push(DocumentTransaction {
            id: TransactionId::from("transaction:unrelated-invalid-result"),
            base_revision: document.revision,
            result_revision: document.revision + 1,
            changes: vec![DocumentChange::AcceptFeatureResult {
                feature: FeatureId::from("feature:unrelated"),
                body: BodyId::from("body:unrelated"),
                request_json: "not-json".into(),
                result_json: "not-json".into(),
            }],
        });
        let selected = latest_accepted_body_snapshot(
            &document,
            &FeatureId::from("feature:annulus-extent-edit"),
            "body:annulus-extent-edit",
        )
        .unwrap()
        .expect("latest matching accepted body");
        assert_eq!(selected, accepted_latest);
        assert_eq!(selected.evidence.bounds_nm.max[2], 7_000_000);
    }

    #[test]
    fn blind_direction_modes_persist_recompute_and_preserve_exact_identity_and_evidence() {
        let mut runtime =
            PartRuntime::new_blank_part("document:direction-modes", "Direction Modes").unwrap();
        let sketch = serde_json::json!({
            "id": "sketch:direction-modes",
            "revision": 0,
            "geometry": {
                "circle:profile": { "id": "circle:profile", "geometry": { "kind": "circle", "center": { "x_nm": 0, "y_nm": 0 }, "radius_nm": 10_000_000 } }
            },
            "constraints": {}
        });
        let support =
            serde_json::json!({ "kind": "origin_plane_reference", "plane": "origin-plane:xy" });
        let solved: serde_json::Value = serde_json::from_str(
            &runtime
                .solve_sketch_json(
                    &serde_json::json!({
                        "transaction_id": "transaction:direction-sketch",
                        "sketch": sketch,
                        "support": support
                    })
                    .to_string(),
                )
                .unwrap(),
        )
        .unwrap();
        assert_eq!(solved["accepted"], true, "{solved:#}");

        // Omitting the newly-added request field is the compatibility path and
        // must retain the existing durable `positive` token.
        let mut request = serde_json::json!({
            "sketch": sketch,
            "support": support,
            "profile_geometry_ids": ["circle:profile"],
            "distance_nanometers": 5_000_000,
            "feature_id": "feature:direction-modes",
            "body_id": "body:direction-modes",
            "tolerance": 0.01,
            "transaction_id": "transaction:direction-positive"
        });
        let positive: serde_json::Value = serde_json::from_str(
            &runtime
                .commit_sketch_extrude_json(&request.to_string())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(positive["accepted"], true, "{positive:#}");
        let positive_result: FeatureResult =
            serde_json::from_value(positive["result"].clone()).unwrap();
        assert_eq!(positive_result.feature_id, "feature:direction-modes");
        assert_eq!(positive_result.output.body_id, "body:direction-modes");
        assert_eq!(
            positive_result.output.evidence.bounds_nm,
            AxisAlignedBoundsNm {
                min: [-10_000_000, -10_000_000, 0],
                max: [10_000_000, 10_000_000, 5_000_000],
            }
        );
        let topology_counts = (
            positive_result.output.evidence.vertex_count,
            positive_result.output.evidence.edge_count,
            positive_result.output.evidence.face_count,
        );
        assert!(topology_counts.0 > 0 && topology_counts.1 > 0 && topology_counts.2 > 0);
        let document: Document = serde_json::from_str(&runtime.document_json().unwrap()).unwrap();
        let definition =
            &document.feature_definitions_v2[&FeatureId::from("feature:direction-modes")];
        let crawler_document::FeatureOperationV2::Extrude { extent, .. } = &definition.operation;
        assert!(matches!(
            extent,
            crawler_document::ExtrudeExtentV2::Blind {
                direction: ExtrudeDirectionV2::Positive,
                ..
            }
        ));

        // A positive -> negative mode transition is ineligible for the fast
        // extent scaler. It must transparently use a full rebuild instead of
        // returning the scaler's sign-change refusal.
        request["direction"] = serde_json::json!("negative");
        request["transaction_id"] = serde_json::json!("transaction:direction-negative");
        let negative_request: SketchExtrudeRequest =
            serde_json::from_value(request.clone()).unwrap();
        let expected_negative = execute_feature(
            &runtime
                .sketch_extrude_feature_request(&negative_request)
                .unwrap(),
        )
        .unwrap();
        let negative: serde_json::Value = serde_json::from_str(
            &runtime
                .commit_sketch_extrude_json(&request.to_string())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(negative["accepted"], true, "{negative:#}");
        let negative_result: FeatureResult =
            serde_json::from_value(negative["result"].clone()).unwrap();
        assert_eq!(negative_result.output, expected_negative.output);
        assert_eq!(negative_result.feature_id, positive_result.feature_id);
        assert_eq!(
            negative_result.output.body_id,
            positive_result.output.body_id
        );
        assert_eq!(
            negative_result.output.evidence.bounds_nm,
            AxisAlignedBoundsNm {
                min: [-10_000_000, -10_000_000, -5_000_000],
                max: [10_000_000, 10_000_000, 0],
            }
        );
        assert_eq!(
            (
                negative_result.output.evidence.vertex_count,
                negative_result.output.evidence.edge_count,
                negative_result.output.evidence.face_count,
            ),
            topology_counts
        );

        // Reopen and recompute from the durable definition, not the accepted
        // request journal, to prove persistence semantics are executable.
        let persisted = runtime.document_json().unwrap();
        let mut runtime = PartRuntime::from_document_json(&persisted).unwrap();
        let recomputed: serde_json::Value = serde_json::from_str(
            &runtime
                .recompute_from_here_json("feature:direction-modes")
                .unwrap(),
        )
        .unwrap();
        assert_eq!(recomputed["accepted"], true, "{recomputed:#}");
        let recomputed_body = latest_accepted_body_snapshot(
            runtime.engine.document(),
            &FeatureId::from("feature:direction-modes"),
            "body:direction-modes",
        )
        .unwrap()
        .unwrap();
        assert_eq!(recomputed_body.evidence, negative_result.output.evidence);

        // Symmetric's durable 5 mm value is a half-length, yielding exact
        // bounds from -5 mm to +5 mm after region translation and 10 mm sweep.
        request["direction"] = serde_json::json!("symmetric");
        request["transaction_id"] = serde_json::json!("transaction:direction-symmetric");
        let symmetric: serde_json::Value = serde_json::from_str(
            &runtime
                .commit_sketch_extrude_json(&request.to_string())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(symmetric["accepted"], true, "{symmetric:#}");
        let symmetric_result: FeatureResult =
            serde_json::from_value(symmetric["result"].clone()).unwrap();
        assert_eq!(symmetric_result.feature_id, positive_result.feature_id);
        assert_eq!(
            symmetric_result.output.body_id,
            positive_result.output.body_id
        );
        assert_eq!(
            symmetric_result.output.evidence.bounds_nm,
            AxisAlignedBoundsNm {
                min: [-10_000_000, -10_000_000, -5_000_000],
                max: [10_000_000, 10_000_000, 5_000_000],
            }
        );
        assert_eq!(
            symmetric_result.output.evidence.centroid_nm.unwrap()[2],
            0.0
        );
        assert_eq!(
            (
                symmetric_result.output.evidence.vertex_count,
                symmetric_result.output.evidence.edge_count,
                symmetric_result.output.evidence.face_count,
            ),
            topology_counts
        );
        let document: Document = serde_json::from_str(&runtime.document_json().unwrap()).unwrap();
        let definition =
            &document.feature_definitions_v2[&FeatureId::from("feature:direction-modes")];
        let crawler_document::FeatureOperationV2::Extrude { extent, .. } = &definition.operation;
        let crawler_document::ExtrudeExtentV2::Blind {
            distance,
            direction,
        } = extent;
        assert_eq!(*direction, ExtrudeDirectionV2::Symmetric);
        assert_eq!(
            document.parameters[distance].value,
            ParameterValue::LengthNanometers(5_000_000)
        );

        let accepted_hash = runtime.semantic_hash().unwrap();
        request["direction"] = serde_json::json!("sideways");
        let error = runtime
            .preview_sketch_extrude_json(&request.to_string())
            .unwrap_err();
        assert!(error.to_string().contains("unknown variant `sideways`"));
        assert_eq!(runtime.semantic_hash().unwrap(), accepted_hash);
    }

    #[test]
    fn reverse_and_symmetric_origin_plane_matrix_has_exact_world_bounds() {
        let cases = [
            (
                "xy",
                ExtrudeDirectionV2::Negative,
                AxisAlignedBoundsNm {
                    min: [-5_000_000, -3_000_000, -4_000_000],
                    max: [5_000_000, 3_000_000, 0],
                },
            ),
            (
                "xy",
                ExtrudeDirectionV2::Symmetric,
                AxisAlignedBoundsNm {
                    min: [-5_000_000, -3_000_000, -4_000_000],
                    max: [5_000_000, 3_000_000, 4_000_000],
                },
            ),
            (
                "xz",
                ExtrudeDirectionV2::Negative,
                AxisAlignedBoundsNm {
                    min: [-5_000_000, 0, -3_000_000],
                    max: [5_000_000, 4_000_000, 3_000_000],
                },
            ),
            (
                "xz",
                ExtrudeDirectionV2::Symmetric,
                AxisAlignedBoundsNm {
                    min: [-5_000_000, -4_000_000, -3_000_000],
                    max: [5_000_000, 4_000_000, 3_000_000],
                },
            ),
            (
                "yz",
                ExtrudeDirectionV2::Negative,
                AxisAlignedBoundsNm {
                    min: [-4_000_000, -5_000_000, -3_000_000],
                    max: [0, 5_000_000, 3_000_000],
                },
            ),
            (
                "yz",
                ExtrudeDirectionV2::Symmetric,
                AxisAlignedBoundsNm {
                    min: [-4_000_000, -5_000_000, -3_000_000],
                    max: [4_000_000, 5_000_000, 3_000_000],
                },
            ),
        ];

        for (plane, direction, expected_bounds) in cases {
            let direction_token = serde_json::to_value(direction)
                .unwrap()
                .as_str()
                .unwrap()
                .to_owned();
            let case_id = format!("{plane}-{direction_token}");
            let feature_id = format!("feature:direction-matrix:{case_id}");
            let body_id = format!("body:direction-matrix:{case_id}");
            let document_id = format!("document:direction-matrix:{case_id}");
            let mut runtime =
                PartRuntime::new_blank_part(document_id.as_str(), "Direction Matrix").unwrap();
            let sketch = serde_json::json!({
                "id": format!("sketch:direction-matrix:{case_id}"),
                "revision": 0,
                "geometry": {
                    "rectangle:profile": {
                        "id": "rectangle:profile",
                        "geometry": {
                            "kind": "rectangle",
                            "min": { "x_nm": -5_000_000, "y_nm": -3_000_000 },
                            "max": { "x_nm": 5_000_000, "y_nm": 3_000_000 }
                        }
                    }
                },
                "constraints": {}
            });
            let support = serde_json::json!({
                "kind": "origin_plane_reference",
                "plane": format!("origin-plane:{plane}")
            });
            let solved: serde_json::Value = serde_json::from_str(
                &runtime
                    .solve_sketch_json(
                        &serde_json::json!({
                            "transaction_id": format!("transaction:direction-matrix:{case_id}:sketch"),
                            "sketch": sketch,
                            "support": support
                        })
                        .to_string(),
                    )
                    .unwrap(),
            )
            .unwrap();
            assert_eq!(solved["accepted"], true, "{case_id}: {solved:#}");

            let request = serde_json::json!({
                "sketch": sketch,
                "support": support,
                "profile_geometry_ids": [],
                "distance_nanometers": 4_000_000,
                "direction": direction_token,
                "feature_id": feature_id,
                "body_id": body_id,
                "tolerance": 0.01,
                "transaction_id": format!("transaction:direction-matrix:{case_id}:extrude")
            });
            let accepted_hash = runtime.semantic_hash().unwrap();
            runtime
                .preview_sketch_extrude_json(&request.to_string())
                .unwrap_or_else(|error| panic!("{case_id} preview failed: {error}"));
            assert_eq!(
                runtime.semantic_hash().unwrap(),
                accepted_hash,
                "{case_id} preview mutated the accepted document"
            );
            let committed: serde_json::Value = serde_json::from_str(
                &runtime
                    .commit_sketch_extrude_json(&request.to_string())
                    .unwrap_or_else(|error| panic!("{case_id} commit failed: {error}")),
            )
            .unwrap();
            assert_eq!(committed["accepted"], true, "{case_id}: {committed:#}");
            let result: FeatureResult =
                serde_json::from_value(committed["result"].clone()).unwrap();
            assert_eq!(
                result.output.evidence.bounds_nm, expected_bounds,
                "{case_id} commit world bounds"
            );
            assert_eq!(result.feature_id, feature_id, "{case_id} feature identity");
            assert_eq!(result.output.body_id, body_id, "{case_id} body identity");

            let recomputed: serde_json::Value = serde_json::from_str(
                &runtime
                    .recompute_from_here_json(&feature_id)
                    .unwrap_or_else(|error| panic!("{case_id} recompute failed: {error}")),
            )
            .unwrap();
            assert_eq!(recomputed["accepted"], true, "{case_id}: {recomputed:#}");
            let recomputed_body = latest_accepted_body_snapshot(
                runtime.engine.document(),
                &FeatureId::from(feature_id.as_str()),
                &body_id,
            )
            .unwrap()
            .unwrap();
            assert_eq!(
                recomputed_body.evidence.bounds_nm, expected_bounds,
                "{case_id} durable recompute world bounds"
            );
            assert!(
                recomputed_body
                    .evidence
                    .volume_model_units3
                    .is_sign_positive(),
                "{case_id} must retain outward solid orientation"
            );
        }
    }

    #[test]
    fn offset_plane_extrude_matrix_has_exact_world_bounds() {
        let cases = [
            ("xy", "positive", [-5, -3, 7], [5, 3, 11]),
            ("xy", "negative", [-5, -3, 3], [5, 3, 7]),
            ("xy", "symmetric", [-5, -3, 3], [5, 3, 11]),
            ("xz", "positive", [-5, -11, -3], [5, -7, 3]),
            ("xz", "negative", [-5, -7, -3], [5, -3, 3]),
            ("xz", "symmetric", [-5, -11, -3], [5, -3, 3]),
            ("yz", "positive", [7, -5, -3], [11, 5, 3]),
            ("yz", "negative", [3, -5, -3], [7, 5, 3]),
            ("yz", "symmetric", [3, -5, -3], [11, 5, 3]),
        ];
        let nm = |point: [i64; 3]| point.map(|value| value * 1_000_000);

        for (base, direction, expected_min, expected_max) in cases {
            let case_id = format!("{base}-{direction}");
            let plane_id = format!("construction-plane:{case_id}");
            let parameter_id = format!("parameter:offset:{case_id}");
            let sketch_id = format!("sketch:offset:{case_id}");
            let feature_id = format!("feature:offset:{case_id}");
            let body_id = format!("body:offset:{case_id}");
            let mut runtime = PartRuntime::new_blank_part(
                format!("document:{case_id}").as_str(),
                "Offset Matrix",
            )
            .unwrap();
            let plane_request = serde_json::json!({
                "plane_id": plane_id,
                "component_id": "component:root",
                "base_plane_id": format!("origin-plane:{base}"),
                "offset_parameter_id": parameter_id,
                "offset_nanometers": 7_000_000,
                "suppressed": false,
                "transaction_id": format!("transaction:plane:{case_id}"),
                "base_revision": 0,
            });
            runtime
                .commit_offset_construction_plane_json(&plane_request.to_string())
                .unwrap_or_else(|error| panic!("{case_id} plane commit failed: {error}"));
            let source = commit_test_sketch_source_on_support(
                &mut runtime,
                &sketch_id,
                serde_json::json!({
                    "kind": "construction_plane_reference",
                    "plane": plane_id,
                }),
                rectangle_geometry(
                    "rectangle:profile",
                    [-5_000_000, -3_000_000],
                    [5_000_000, 3_000_000],
                ),
            );
            let request = serde_json::json!({
                "sketch": source["sketch"],
                "support": source["support"],
                "profile_geometry_ids": [],
                "distance_nanometers": 4_000_000,
                "direction": direction,
                "feature_id": feature_id,
                "body_id": body_id,
                "tolerance": 0.01,
                "transaction_id": format!("transaction:extrude:{case_id}"),
            });
            let committed: serde_json::Value = serde_json::from_str(
                &runtime
                    .commit_sketch_extrude_json(&request.to_string())
                    .unwrap_or_else(|error| panic!("{case_id} extrude failed: {error}")),
            )
            .unwrap();
            let result: FeatureResult =
                serde_json::from_value(committed["result"].clone()).unwrap();
            assert_eq!(
                result.output.evidence.bounds_nm,
                AxisAlignedBoundsNm {
                    min: nm(expected_min),
                    max: nm(expected_max),
                },
                "{case_id}"
            );

            let saved = runtime.document_json().unwrap();
            let mut restored = PartRuntime::from_document_json(&saved).unwrap();
            restored.recompute_from_here_json(&feature_id).unwrap();
            let recomputed = latest_accepted_body_snapshot(
                restored.engine.document(),
                &FeatureId::from(feature_id.as_str()),
                &body_id,
            )
            .unwrap()
            .unwrap();
            assert_eq!(
                recomputed.evidence.bounds_nm,
                result.output.evidence.bounds_nm
            );
            if case_id == "xy-positive" {
                let revision = restored.engine.document().revision;
                let edit = serde_json::json!({
                    "plane_id": plane_id,
                    "component_id": "component:root",
                    "base_plane_id": "origin-plane:xy",
                    "offset_parameter_id": parameter_id,
                    "offset_nanometers": 9_000_000,
                    "suppressed": false,
                    "transaction_id": "transaction:plane:xy-positive:edit",
                    "base_revision": revision,
                });
                restored
                    .commit_offset_construction_plane_json(&edit.to_string())
                    .unwrap();
                assert_eq!(
                    restored.engine.document().recompute.features
                        [&FeatureId::from(feature_id.as_str())],
                    FeatureRecomputeState::Clean {
                        evaluated_revision: revision + 1
                    }
                );
                let edited = latest_accepted_body_snapshot(
                    restored.engine.document(),
                    &FeatureId::from(feature_id.as_str()),
                    &body_id,
                )
                .unwrap()
                .unwrap();
                assert_eq!(edited.evidence.bounds_nm.min[2], 9_000_000);
                assert_eq!(edited.evidence.bounds_nm.max[2], 13_000_000);
                let active: serde_json::Value =
                    serde_json::from_str(&restored.active_body_json(0.01).unwrap()).unwrap();
                assert_eq!(active["body"]["body_id"], body_id);
                assert_eq!(active["body"]["evidence"]["bounds_nm"]["min"][2], 9_000_000);
                assert_eq!(
                    active["body"]["evidence"]["bounds_nm"]["max"][2],
                    13_000_000
                );
            }
        }
    }

    #[test]
    fn offset_plane_edit_recomputes_and_accepts_multi_feature_chain_in_dependency_order() {
        let document_id = "document:offset-dependency-order";
        let plane_id = "construction-plane:dependency-order";
        let parameter_id = "parameter:offset:dependency-order";
        let sketch_id = "sketch:dependency-order";
        let root_id = "feature:z-plane-extrude";
        let direct_id = "feature:y-direct-child";
        let downstream_id = "feature:a-downstream-child";
        let unrelated_id = "feature:0-unrelated";
        let mut runtime = PartRuntime::new_blank_part(document_id, "Dependency Order").unwrap();
        runtime
            .commit_offset_construction_plane_json(
                &serde_json::json!({
                    "plane_id": plane_id,
                    "component_id": "component:root",
                    "base_plane_id": "origin-plane:xy",
                    "offset_parameter_id": parameter_id,
                    "offset_nanometers": 7_000_000,
                    "suppressed": false,
                    "transaction_id": "transaction:create-dependency-plane",
                    "base_revision": 0,
                })
                .to_string(),
            )
            .unwrap();
        let source = commit_test_sketch_source_on_support(
            &mut runtime,
            sketch_id,
            serde_json::json!({
                "kind": "construction_plane_reference",
                "plane": plane_id,
            }),
            rectangle_geometry(
                "rectangle:dependency-order",
                [-5_000_000, -3_000_000],
                [5_000_000, 3_000_000],
            ),
        );
        let root: serde_json::Value = serde_json::from_str(
            &runtime
                .commit_sketch_extrude_json(
                    &serde_json::json!({
                        "sketch": source["sketch"],
                        "support": source["support"],
                        "profile_geometry_ids": [],
                        "distance_nanometers": 4_000_000,
                        "direction": "positive",
                        "feature_id": root_id,
                        "body_id": "body:z-plane-extrude",
                        "tolerance": 0.01,
                        "transaction_id": "transaction:create-plane-extrude",
                    })
                    .to_string(),
                )
                .unwrap(),
        )
        .unwrap();

        let execute_new = |runtime: &mut PartRuntime,
                           feature_id: &str,
                           dependencies: Vec<FeatureId>,
                           operation: serde_json::Value|
         -> serde_json::Value {
            let feature = Feature {
                id: FeatureId::from(feature_id),
                display_name: feature_id.into(),
                component: ComponentId::from(crawler_part_engine::ROOT_COMPONENT_ID),
                operation: OperationReference {
                    schema_id: format!("crawler.operation.{}", operation["kind"].as_str().unwrap()),
                    schema_version: 1,
                },
                dependencies,
                inputs: BTreeMap::new(),
                parameters: BTreeMap::new(),
                suppressed: false,
            };
            serde_json::from_str(
                &runtime
                    .execute_new_feature_json(
                        &serde_json::json!({
                            "transaction_id": format!("transaction:create:{feature_id}"),
                            "feature": feature,
                            "before": null,
                            "request": {
                                "schema_version": 1,
                                "document_id": document_id,
                                "feature_id": feature_id,
                                "output_body_id": format!("body:{feature_id}"),
                                "operation": operation,
                            }
                        })
                        .to_string(),
                    )
                    .unwrap(),
            )
            .unwrap()
        };
        let direct = execute_new(
            &mut runtime,
            direct_id,
            vec![FeatureId::from(root_id)],
            serde_json::json!({
                "kind": "mirror",
                "source": { "semantics": "body", "body": root["result"]["output"].clone() },
                "plane_origin_nm": [0, 0, 0],
                "plane_normal": "x",
                "tolerance_nm": 10000,
            }),
        );
        let _downstream = execute_new(
            &mut runtime,
            downstream_id,
            vec![FeatureId::from(direct_id)],
            serde_json::json!({
                "kind": "mirror",
                "source": { "semantics": "body", "body": direct["result"]["output"].clone() },
                "plane_origin_nm": [0, 0, 0],
                "plane_normal": "y",
                "tolerance_nm": 10000,
            }),
        );
        let _unrelated = execute_new(
            &mut runtime,
            unrelated_id,
            Vec::new(),
            revolve_operation(20_000_000),
        );
        let unrelated_before =
            runtime.engine.document().recompute.features[&FeatureId::from(unrelated_id)].clone();
        let revision = runtime.engine.document().revision;
        runtime
            .commit_offset_construction_plane_json(
                &serde_json::json!({
                    "plane_id": plane_id,
                    "component_id": "component:root",
                    "base_plane_id": "origin-plane:xy",
                    "offset_parameter_id": parameter_id,
                    "offset_nanometers": 9_000_000,
                    "suppressed": false,
                    "transaction_id": "transaction:edit-dependency-plane",
                    "base_revision": revision,
                })
                .to_string(),
            )
            .unwrap();

        let transaction = runtime.engine.document().transactions.last().unwrap();
        let accepted_order: Vec<_> = transaction
            .changes
            .iter()
            .filter_map(|change| match change {
                DocumentChange::AcceptFeatureResult { feature, .. } => Some(feature.0.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(accepted_order, [root_id, direct_id, downstream_id]);
        for feature in [root_id, direct_id, downstream_id] {
            assert_eq!(
                runtime.engine.document().recompute.features[&FeatureId::from(feature)],
                FeatureRecomputeState::Clean {
                    evaluated_revision: revision + 1,
                }
            );
        }
        assert_eq!(
            runtime.engine.document().recompute.features[&FeatureId::from(unrelated_id)],
            unrelated_before
        );
        assert!(!accepted_order.contains(&unrelated_id));
        let root_result = latest_accepted_body_snapshot(
            runtime.engine.document(),
            &FeatureId::from(root_id),
            "body:z-plane-extrude",
        )
        .unwrap()
        .unwrap();
        assert_eq!(root_result.evidence.bounds_nm.min[2], 9_000_000);
        assert_eq!(root_result.evidence.bounds_nm.max[2], 13_000_000);
        let direct_request =
            latest_kernel_request(runtime.engine.document(), &FeatureId::from(direct_id))
                .unwrap()
                .unwrap();
        let direct_request = serde_json::to_value(direct_request).unwrap();
        assert_eq!(
            direct_request["operation"]["source"]["body"]["evidence"]["deterministic_digest"],
            root_result.evidence.deterministic_digest
        );
        let direct_result = latest_accepted_body_snapshot(
            runtime.engine.document(),
            &FeatureId::from(direct_id),
            "body:feature:y-direct-child",
        )
        .unwrap()
        .unwrap();
        let downstream_request =
            latest_kernel_request(runtime.engine.document(), &FeatureId::from(downstream_id))
                .unwrap()
                .unwrap();
        let downstream_request = serde_json::to_value(downstream_request).unwrap();
        assert_eq!(
            downstream_request["operation"]["source"]["body"]["evidence"]["deterministic_digest"],
            direct_result.evidence.deterministic_digest,
            "second-hop request must bind the freshly accepted direct child"
        );
        let downstream_result = latest_accepted_body_snapshot(
            runtime.engine.document(),
            &FeatureId::from(downstream_id),
            "body:feature:a-downstream-child",
        )
        .unwrap()
        .unwrap();
        assert_eq!(downstream_result.evidence.bounds_nm.min[2], 9_000_000);
        assert_eq!(downstream_result.evidence.bounds_nm.max[2], 13_000_000);
    }

    #[test]
    fn offset_plane_preview_edit_undo_redo_and_failures_are_atomic() {
        let mut runtime =
            PartRuntime::new_blank_part("document:offset-lifecycle", "Offset").unwrap();
        let request = |revision: u64, offset: i64, suppressed: bool, transaction: &str| {
            serde_json::json!({
                "plane_id": "construction-plane:stable",
                "component_id": "component:root",
                "base_plane_id": "origin-plane:xy",
                "offset_parameter_id": "parameter:offset:stable",
                "offset_nanometers": offset,
                "suppressed": suppressed,
                "transaction_id": transaction,
                "base_revision": revision,
            })
        };
        let initial_hash = runtime.semantic_hash().unwrap();
        let initial_depths = runtime.engine.history_depths();
        let preview: serde_json::Value = serde_json::from_str(
            &runtime
                .preview_offset_construction_plane_json(
                    &request(0, 7_000_000, false, "transaction:preview").to_string(),
                )
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            preview["frame"]["origin_nanometers"],
            serde_json::json!([0, 0, 7_000_000])
        );
        assert_eq!(runtime.semantic_hash().unwrap(), initial_hash);
        assert_eq!(runtime.engine.history_depths(), initial_depths);

        runtime
            .commit_offset_construction_plane_json(
                &request(0, 7_000_000, false, "transaction:create").to_string(),
            )
            .unwrap();
        let stable_id = runtime
            .engine
            .document()
            .construction_planes
            .keys()
            .next()
            .unwrap()
            .clone();
        runtime
            .commit_offset_construction_plane_json(
                &request(1, -2_000_000, false, "transaction:edit").to_string(),
            )
            .unwrap();
        assert_eq!(
            runtime.engine.document().construction_planes.keys().next(),
            Some(&stable_id)
        );
        let edited: serde_json::Value =
            serde_json::from_str(&runtime.construction_plane_frame_json(&stable_id.0).unwrap())
                .unwrap();
        assert_eq!(
            edited["frame"]["origin_nanometers"],
            serde_json::json!([0, 0, -2_000_000])
        );

        runtime.undo().unwrap();
        let undone: serde_json::Value =
            serde_json::from_str(&runtime.construction_plane_frame_json(&stable_id.0).unwrap())
                .unwrap();
        assert_eq!(
            undone["frame"]["origin_nanometers"],
            serde_json::json!([0, 0, 7_000_000])
        );
        runtime.redo().unwrap();
        let saved = runtime.document_json().unwrap();
        let mut restored = PartRuntime::from_document_json(&saved).unwrap();
        assert_eq!(restored.document_json().unwrap(), saved);

        let before_failure = restored.semantic_hash().unwrap();
        let revision = restored.engine.document().revision;
        let mut missing = request(revision, 1, false, "transaction:missing");
        missing["base_plane_id"] = serde_json::json!("origin-plane:missing");
        assert!(
            restored
                .commit_offset_construction_plane_json(&missing.to_string())
                .is_err()
        );
        assert_eq!(restored.semantic_hash().unwrap(), before_failure);

        let missing_parameter_hash = restored.semantic_hash().unwrap();
        let mut missing_parameter = request(
            restored.engine.document().revision,
            1,
            false,
            "transaction:missing-offset-parameter",
        );
        missing_parameter["offset_parameter_id"] =
            serde_json::json!("parameter:missing-edit-offset");
        let preview_error = restored
            .preview_offset_construction_plane_json(&missing_parameter.to_string())
            .unwrap_err()
            .to_string();
        let commit_error = restored
            .commit_offset_construction_plane_json(&missing_parameter.to_string())
            .unwrap_err()
            .to_string();
        assert_eq!(preview_error, commit_error);
        for token in [
            "missing_construction_plane_offset_parameter",
            "construction_plane.offset_parameter",
            "construction-plane:stable",
            "parameter:missing-edit-offset",
        ] {
            assert!(commit_error.contains(token), "{commit_error}");
        }
        assert_eq!(restored.semantic_hash().unwrap(), missing_parameter_hash);

        restored
            .commit_changes_json(
                &serde_json::json!({
                    "transaction_id": "transaction:boolean-offset",
                    "changes": [{
                        "kind": "create_parameter",
                        "component": "component:root",
                        "parameter": {
                            "id": "parameter:boolean-offset",
                            "display_name": "Boolean Offset",
                            "value": { "kind": "boolean", "value": true }
                        }
                    }]
                })
                .to_string(),
            )
            .unwrap();
        let wrong_type_hash = restored.semantic_hash().unwrap();
        let mut wrong_type = request(
            restored.engine.document().revision,
            1,
            false,
            "transaction:wrong-type",
        );
        wrong_type["plane_id"] = serde_json::json!("construction-plane:wrong-type");
        wrong_type["offset_parameter_id"] = serde_json::json!("parameter:boolean-offset");
        let preview_error = restored
            .preview_offset_construction_plane_json(&wrong_type.to_string())
            .unwrap_err()
            .to_string();
        let commit_error = restored
            .commit_offset_construction_plane_json(&wrong_type.to_string())
            .unwrap_err()
            .to_string();
        assert_eq!(preview_error, commit_error);
        for token in [
            "wrong_type_construction_plane_offset_parameter",
            "construction_plane.offset_parameter",
            "parameter:boolean-offset",
            "boolean value true",
        ] {
            assert!(commit_error.contains(token), "{commit_error}");
        }
        assert_eq!(restored.semantic_hash().unwrap(), wrong_type_hash);

        let revision = restored.engine.document().revision;
        restored
            .commit_offset_construction_plane_json(
                &request(revision, -2_000_000, true, "transaction:suppress").to_string(),
            )
            .unwrap();
        assert!(
            restored
                .construction_plane_frame_json(&stable_id.0)
                .is_err()
        );
        let suppressed_error = restored
            .construction_plane_frame_json(&stable_id.0)
            .unwrap_err()
            .to_string();
        for token in [
            "suppressed_construction_plane_support",
            "extrude.support",
            stable_id.0.as_str(),
        ] {
            assert!(suppressed_error.contains(token), "{suppressed_error}");
        }
        let missing_error = restored
            .construction_plane_frame_json("construction-plane:missing-support")
            .unwrap_err()
            .to_string();
        for token in [
            "missing_construction_plane_support",
            "extrude.support",
            "construction-plane:missing-support",
        ] {
            assert!(missing_error.contains(token), "{missing_error}");
        }

        let mut invalid_dependency_document = restored.engine.document().clone();
        let invalid_plane = invalid_dependency_document
            .construction_planes
            .get_mut(&stable_id)
            .unwrap();
        invalid_plane.suppressed = false;
        invalid_plane.definition = ConstructionPlaneGeometryV1::Offset {
            base_plane: OriginPlaneId::from("origin-plane:missing-dependency"),
            offset: ParameterId::from("parameter:offset:stable"),
        };
        let invalid_dependency_error =
            construction_plane_frame(&invalid_dependency_document, &stable_id, "Extrude preview")
                .unwrap_err()
                .to_string();
        for token in [
            "invalid_construction_plane_dependency",
            "extrude.support",
            stable_id.0.as_str(),
            "origin-plane:missing-dependency",
        ] {
            assert!(
                invalid_dependency_error.contains(token),
                "{invalid_dependency_error}"
            );
        }
        let suppressed_hash = restored.semantic_hash().unwrap();
        assert!(
            restored
                .commit_offset_construction_plane_json(
                    &request(revision, 0, false, "transaction:stale").to_string(),
                )
                .is_err()
        );
        assert_eq!(restored.semantic_hash().unwrap(), suppressed_hash);
    }

    #[test]
    fn offset_plane_safe_nanometer_edges_are_accepted_and_overflow_is_atomic() {
        let mut runtime =
            PartRuntime::new_blank_part("document:offset-safe-range", "Offset range").unwrap();
        let request = |revision: u64, offset: i64, transaction: &str| {
            serde_json::json!({
                "plane_id": "construction-plane:safe-range",
                "component_id": "component:root",
                "base_plane_id": "origin-plane:xy",
                "offset_parameter_id": "parameter:offset:safe-range",
                "offset_nanometers": offset,
                "suppressed": false,
                "transaction_id": transaction,
                "base_revision": revision,
            })
        };

        for (offset, transaction) in [
            (SAFE_NANOMETER_BOUND, "transaction:safe-max"),
            (-SAFE_NANOMETER_BOUND, "transaction:safe-min"),
        ] {
            let revision = runtime.engine.document().revision;
            let candidate = request(revision, offset, transaction);
            let preview: serde_json::Value = serde_json::from_str(
                &runtime
                    .preview_offset_construction_plane_json(&candidate.to_string())
                    .unwrap(),
            )
            .unwrap();
            assert_eq!(preview["frame"]["origin_nanometers"][2], offset);
            runtime
                .commit_offset_construction_plane_json(&candidate.to_string())
                .unwrap();
            let frame: serde_json::Value = serde_json::from_str(
                &runtime
                    .construction_plane_frame_json("construction-plane:safe-range")
                    .unwrap(),
            )
            .unwrap();
            assert_eq!(frame["frame"]["origin_nanometers"][2], offset);
        }

        for (offset, transaction) in [
            (SAFE_NANOMETER_BOUND + 1, "transaction:unsafe-max"),
            (-SAFE_NANOMETER_BOUND - 1, "transaction:unsafe-min"),
        ] {
            let before = runtime.semantic_hash().unwrap();
            let candidate = request(runtime.engine.document().revision, offset, transaction);
            let preview_error = runtime
                .preview_offset_construction_plane_json(&candidate.to_string())
                .unwrap_err()
                .to_string();
            let commit_error = runtime
                .commit_offset_construction_plane_json(&candidate.to_string())
                .unwrap_err()
                .to_string();
            assert_eq!(preview_error, commit_error);
            for token in [
                "unsafe_construction_plane_offset_parameter",
                "construction_plane.offset_parameter",
                "parameter:offset:safe-range",
            ] {
                assert!(commit_error.contains(token), "{commit_error}");
            }
            assert!(commit_error.contains(&offset.to_string()), "{commit_error}");
            assert_eq!(runtime.semantic_hash().unwrap(), before);
        }

        let accepted_hash = runtime.semantic_hash().unwrap();
        let accepted_document = runtime.document_json().unwrap();
        for (value, code, value_token) in [
            (
                serde_json::json!({"kind":"boolean", "value":true}),
                "wrong_type_construction_plane_offset_parameter",
                "boolean value true".to_owned(),
            ),
            (
                serde_json::json!({
                    "kind":"length_nanometers",
                    "value": SAFE_NANOMETER_BOUND + 1,
                }),
                "unsafe_construction_plane_offset_parameter",
                (SAFE_NANOMETER_BOUND + 1).to_string(),
            ),
        ] {
            let mut invalid: serde_json::Value = serde_json::from_str(&accepted_document).unwrap();
            invalid["parameters"]["parameter:offset:safe-range"]["value"] = value;
            let error = PartRuntime::from_document_json(&invalid.to_string())
                .unwrap_err()
                .to_string();
            for token in [
                code,
                "construction_plane.offset_parameter",
                "parameter:offset:safe-range",
                value_token.as_str(),
            ] {
                assert!(error.contains(token), "{error}");
            }
            assert_eq!(runtime.semantic_hash().unwrap(), accepted_hash);
        }
    }

    #[test]
    fn offset_plane_cross_component_dependencies_are_typed_and_atomic() {
        let blank = PartRuntime::new_blank_part(
            "document:offset-cross-component",
            "Offset cross component",
        )
        .unwrap();
        let mut document: serde_json::Value =
            serde_json::from_str(&blank.document_json().unwrap()).unwrap();
        let mut other_component = document["components"]["component:root"].clone();
        other_component["id"] = serde_json::json!("component:other");
        other_component["display_name"] = serde_json::json!("Other");
        other_component["parent"] = serde_json::json!("component:root");
        other_component["child_components"] = serde_json::json!([]);
        other_component["parameter_order"] = serde_json::json!(["parameter:other-offset"]);
        document["components"]["component:root"]["child_components"] =
            serde_json::json!(["component:other"]);
        document["components"]["component:other"] = other_component;
        let mut other_plane = document["origin_planes"]["origin-plane:xy"].clone();
        other_plane["id"] = serde_json::json!("origin-plane:other-xy");
        other_plane["component"] = serde_json::json!("component:other");
        document["origin_planes"]["origin-plane:other-xy"] = other_plane;
        document["parameters"]["parameter:other-offset"] = serde_json::json!({
            "id":"parameter:other-offset",
            "display_name":"Other Offset",
            "value":{"kind":"length_nanometers","value":0},
        });
        let document: crawler_document::Document = serde_json::from_value(document).unwrap();
        let request = |base: &str, parameter: &str, transaction: &str| {
            serde_json::from_value::<OffsetConstructionPlaneRequest>(serde_json::json!({
                "plane_id":"construction-plane:cross-component",
                "component_id":"component:root",
                "base_plane_id":base,
                "offset_parameter_id":parameter,
                "offset_nanometers":0,
                "suppressed":false,
                "transaction_id":transaction,
                "base_revision":document.revision,
            }))
            .unwrap()
        };
        for (candidate, field, referenced) in [
            (
                request(
                    "origin-plane:other-xy",
                    "parameter:new-root-offset",
                    "transaction:cross-base",
                ),
                "construction_plane.base_plane",
                "origin-plane:other-xy",
            ),
            (
                request(
                    "origin-plane:xy",
                    "parameter:other-offset",
                    "transaction:cross-parameter",
                ),
                "construction_plane.offset_parameter",
                "parameter:other-offset",
            ),
        ] {
            let before = document.clone();
            let preview_error = offset_construction_plane_changes(&document, &candidate)
                .unwrap_err()
                .to_string();
            let commit_error = offset_construction_plane_changes(&document, &candidate)
                .unwrap_err()
                .to_string();
            assert_eq!(preview_error, commit_error);
            for token in [
                "invalid_construction_plane_dependency",
                field,
                "construction-plane:cross-component",
                referenced,
            ] {
                assert!(commit_error.contains(token), "{commit_error}");
            }
            assert_eq!(document, before);
        }
    }

    #[test]
    fn symmetric_conversion_refuses_non_positive_and_overflowing_half_lengths() {
        let region = NativeProfileRegionV2 {
            outer: NativeCurveLoopV2 {
                curves: vec![NativeCurveV2::Line {
                    start_nm: [0; 3],
                    end_nm: [1, 0, 0],
                }],
            },
            holes: Vec::new(),
        };
        for distance in [0, -1] {
            let error = exact_blind_extrude_input(
                region.clone(),
                [0, 0, 1_000_000],
                distance,
                ExtrudeDirectionV2::Symmetric,
                10_000,
            )
            .unwrap_err();
            assert!(error.to_string().contains("greater than zero"));
        }
        let error = exact_blind_extrude_input(
            region,
            [0, 0, 1_000_000],
            i64::MAX,
            ExtrudeDirectionV2::Symmetric,
            10_000,
        )
        .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("total distance exceeds exact range")
        );
    }

    #[test]
    fn native_profile_transport_preserves_circular_arc_through_point() {
        let sketch: crawler_sketch::Sketch = serde_json::from_value(serde_json::json!({
            "id": "sketch:arc-loop",
            "revision": 0,
            "geometry": {
                "arc": { "id": "arc", "geometry": { "kind": "arc", "center": { "x_nm": 0, "y_nm": 0 }, "start": { "x_nm": -5_000_000, "y_nm": 0 }, "end": { "x_nm": 5_000_000, "y_nm": 0 }, "clockwise": true } },
                "line": { "id": "line", "geometry": { "kind": "line", "start": { "x_nm": 5_000_000, "y_nm": 0 }, "end": { "x_nm": -5_000_000, "y_nm": 0 } } }
            },
            "constraints": {}
        }))
        .unwrap();
        let region = native_profile_region(
            &sketch,
            &[
                crawler_sketch::GeometryId::from("arc"),
                crawler_sketch::GeometryId::from("line"),
            ],
            &[],
            [1_000_000, 0, 0],
            [0, 1_000_000, 0],
        )
        .unwrap();
        let NativeCurveV2::CircularArc { transit_nm, .. } = &region.outer.curves[0] else {
            panic!("arc transport changed curve class");
        };
        assert_eq!(transit_nm[0], 0);
        assert_eq!(transit_nm[1].abs(), 5_000_000);
        assert_eq!(transit_nm[2], 0);
        assert!(matches!(region.outer.curves[1], NativeCurveV2::Line { .. }));
    }

    #[test]
    fn sketch_wasm_contract_identifies_graph_frontend_and_ezpz_backend() {
        let contract: serde_json::Value =
            serde_json::from_str(&runtime().sketch_solver_contract_json().unwrap()).unwrap();
        assert_eq!(contract["schema_version"], 2);
        assert_eq!(
            contract["frontend"],
            "planegcs_inspired_graph_decomposition"
        );
        assert_eq!(contract["backend"], "kittycad_ezpz");
        assert_eq!(contract["backend_version"], "0.2.28");
        assert_eq!(contract["numeric_units"], "integer_nanometers");
        assert_eq!(contract["coordinate_space"], "resolved_plane_local_2d");
        assert_eq!(
            contract["support_reference_kinds"]
                .as_array()
                .unwrap()
                .len(),
            4
        );
        assert_eq!(
            contract["resolved_plane_frame_fields"]
                .as_array()
                .unwrap()
                .len(),
            4
        );
        assert_eq!(contract["geometry_kinds"].as_array().unwrap().len(), 10);
        for kind in [
            "control_point_spline",
            "fit_point_spline",
            "ellipse",
            "elliptical_arc",
            "conic",
            "sketch_point",
        ] {
            assert!(
                contract["geometry_kinds"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|value| value == kind)
            );
        }
        assert_eq!(contract["constraint_kinds"].as_array().unwrap().len(), 29);
        assert!(
            contract["operations"]
                .as_array()
                .unwrap()
                .iter()
                .any(|value| value == "decompose")
        );

        let decomposition: serde_json::Value = serde_json::from_str(
            &runtime()
                .decompose_sketch_json(
                    &serde_json::json!({
                        "sketch": {
                            "id": "sketch:components",
                            "revision": 0,
                            "geometry": {
                                "line:a": { "id": "line:a", "geometry": { "kind": "line", "start": { "x_nm": 0, "y_nm": 0 }, "end": { "x_nm": 10, "y_nm": 0 } } },
                                "line:b": { "id": "line:b", "geometry": { "kind": "line", "start": { "x_nm": 0, "y_nm": 10 }, "end": { "x_nm": 10, "y_nm": 10 } } }
                            },
                            "constraints": {}
                        }
                    })
                    .to_string(),
                )
                .unwrap(),
        )
        .unwrap();
        assert_eq!(decomposition["components"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn extrude_preview_returns_candidate_packet_without_mutating_accepted_state() {
        let runtime = runtime();
        let before_hash = runtime.semantic_hash().unwrap();
        let before_document = runtime.document_json().unwrap();
        let before_dimensions = runtime.dimensions().unwrap();

        let first: serde_json::Value =
            serde_json::from_str(&runtime.preview_extrude_json(24_000_000, 0.01).unwrap()).unwrap();
        let second: serde_json::Value =
            serde_json::from_str(&runtime.preview_extrude_json(24_000_000, 0.01).unwrap()).unwrap();

        assert_eq!(first, second);
        assert_eq!(first["accepted_document_hash"], before_hash);
        assert_ne!(first["candidate_document_hash"], before_hash);
        assert_eq!(first["distance_nanometers"], 24_000_000);
        assert_eq!(first["render"]["packet"]["bounds"][5], 24.0);
        assert_eq!(runtime.semantic_hash().unwrap(), before_hash);
        assert_eq!(runtime.document_json().unwrap(), before_document);
        assert_eq!(runtime.dimensions().unwrap(), before_dimensions);
    }

    #[test]
    fn refused_extrude_preview_preserves_accepted_state() {
        let runtime = runtime();
        let before_hash = runtime.semantic_hash().unwrap();
        let before_document = runtime.document_json().unwrap();

        assert!(runtime.preview_extrude_json(0, 0.01).is_err());
        assert_eq!(runtime.semantic_hash().unwrap(), before_hash);
        assert_eq!(runtime.document_json().unwrap(), before_document);
    }

    fn execute_new(
        runtime: &mut PartRuntime,
        feature_id: &str,
        operation: serde_json::Value,
    ) -> serde_json::Value {
        let envelope = new_feature_envelope(feature_id, operation);
        serde_json::from_str(
            &runtime
                .execute_new_feature_json(&envelope.to_string())
                .unwrap(),
        )
        .unwrap()
    }

    fn new_feature_envelope(feature_id: &str, operation: serde_json::Value) -> serde_json::Value {
        let feature = Feature {
            id: FeatureId::from(feature_id),
            display_name: feature_id.to_owned(),
            component: ComponentId::from(crawler_part_engine::ROOT_COMPONENT_ID),
            operation: OperationReference {
                schema_id: format!("crawler.operation.{}", operation["kind"].as_str().unwrap()),
                schema_version: 1,
            },
            dependencies: vec![FeatureId::from(crawler_part_engine::EXTRUDE_FEATURE_ID)],
            inputs: BTreeMap::new(),
            parameters: BTreeMap::new(),
            suppressed: false,
        };
        serde_json::json!({
            "transaction_id": format!("transaction:{feature_id}"),
            "feature": feature,
            "before": null,
            "request": {
                "schema_version": 1,
                "document_id": "document:runtime-cube",
                "feature_id": feature_id,
                "output_body_id": format!("body:{feature_id}"),
                "operation": operation,
            }
        })
    }

    fn revolve_operation(origin_x_nm: i64) -> serde_json::Value {
        serde_json::json!({
            "kind": "revolve",
            "axis_origin_nm": [origin_x_nm, 0, 0],
            "axis": "z",
            "inner_radius_nm": 1000000,
            "outer_radius_nm": 2000000,
            "axial_start_nm": 0,
            "axial_end_nm": 3000000,
            "sweep_microdegrees": 360000000,
            "divisions": 16,
            "tolerance_nm": 10000
        })
    }

    fn box_snapshot(body_id: &str, origin: [f64; 3], size: f64) -> BodySnapshot {
        let vertex = builder::vertex(Point3::new(origin[0], origin[1], origin[2]));
        let edge = builder::extrude(&vertex, Vector3::unit_x() * size);
        let face = builder::extrude(&edge, Vector3::unit_y() * size);
        let solid: Solid = builder::extrude(&face, Vector3::unit_z() * size);
        BodySnapshot {
            body_id: body_id.to_owned(),
            solid_json: serde_json::to_vec(&solid).unwrap(),
            evidence: GeometryEvidence {
                vertex_count: 8,
                edge_count: 12,
                face_count: 6,
                bounds_nm: AxisAlignedBoundsNm {
                    min: origin.map(|value| (value * 1_000_000.0).round() as i64),
                    max: origin.map(|value| ((value + size) * 1_000_000.0).round() as i64),
                },
                volume_model_units3: size.powi(3),
                surface_area_nm2: None,
                centroid_nm: None,
                deterministic_digest: "runtime-test-fixture".into(),
            },
        }
    }

    fn face_id_on_coordinate(solid: &Solid, axis: usize, coordinate: f64) -> u64 {
        solid
            .face_iter()
            .find(|face| {
                face.vertex_iter()
                    .all(|vertex| (vertex.point()[axis] - coordinate).abs() < 1.0e-9)
            })
            .unwrap()
            .stable_id()
            .raw()
    }

    fn assert_quantized_frame_within_declared_tolerance(value: &serde_json::Value) {
        let tuple = |field: &str| {
            let values = value["frame"][field].as_array().unwrap();
            [
                values[0].as_i64().unwrap(),
                values[1].as_i64().unwrap(),
                values[2].as_i64().unwrap(),
            ]
        };
        let x = tuple("x_axis_millionths");
        let y = tuple("y_axis_millionths");
        let normal = tuple("normal_millionths");
        assert!(quantized_frame_is_orthonormal(x, y, normal));
        assert_eq!(value["scale_millionths"], PLANAR_FRAME_SCALE_MILLIONTHS);
        assert_eq!(
            value["orthonormal_tolerance_millionths"],
            PLANAR_FRAME_ORTHONORMAL_TOLERANCE_MILLIONTHS
        );
    }

    #[test]
    fn planar_face_frame_resolves_oriented_cap_and_translated_side_exactly() {
        let runtime = runtime();
        let before_hash = runtime.semantic_hash().unwrap();
        let snapshot = runtime.base_body_snapshot().unwrap();
        let solid: Solid = serde_json::from_slice(&snapshot.solid_json).unwrap();
        let cap_id = face_id_on_coordinate(&solid, 2, 10.0);
        let side_id = face_id_on_coordinate(&solid, 0, 10.0);

        let cap: serde_json::Value = serde_json::from_str(
            &runtime
                .planar_face_frame_json(crawler_part_engine::BODY_ID, &cap_id.to_string())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(cap["found"], true);
        assert_eq!(cap["accepted_revision"], runtime.engine.document().revision);
        assert_eq!(cap["component_id"], crawler_part_engine::ROOT_COMPONENT_ID);
        assert_eq!(cap["face_kind"], "face");
        assert_eq!(cap["analytic_surface"], "plane");
        assert_eq!(cap["handedness"], "right");
        assert_eq!(cap["face_stable_id"], cap_id.to_string());
        assert!(
            cap["origin_vertex_stable_id"]
                .as_str()
                .unwrap()
                .parse::<u64>()
                .is_ok()
        );
        assert_eq!(
            cap["frame"]["origin_nanometers"],
            serde_json::json!([0, 0, 10_000_000])
        );
        assert_eq!(
            cap["frame"]["x_axis_millionths"],
            serde_json::json!([1_000_000, 0, 0])
        );
        assert_eq!(
            cap["frame"]["y_axis_millionths"],
            serde_json::json!([0, 1_000_000, 0])
        );
        assert_eq!(
            cap["frame"]["normal_millionths"],
            serde_json::json!([0, 0, 1_000_000])
        );
        assert_quantized_frame_within_declared_tolerance(&cap);

        let side_json = runtime
            .planar_face_frame_json(crawler_part_engine::BODY_ID, &side_id.to_string())
            .unwrap();
        let side: serde_json::Value = serde_json::from_str(&side_json).unwrap();
        assert_eq!(
            side["frame"]["origin_nanometers"],
            serde_json::json!([10_000_000, 0, 0])
        );
        assert_eq!(
            side["frame"]["x_axis_millionths"],
            serde_json::json!([0, 1_000_000, 0])
        );
        assert_eq!(
            side["frame"]["y_axis_millionths"],
            serde_json::json!([0, 0, 1_000_000])
        );
        assert_eq!(
            side["frame"]["normal_millionths"],
            serde_json::json!([1_000_000, 0, 0])
        );
        assert_quantized_frame_within_declared_tolerance(&side);

        let restored = PartRuntime::from_document_json(&runtime.document_json().unwrap()).unwrap();
        assert_eq!(
            restored
                .planar_face_frame_json(crawler_part_engine::BODY_ID, &side_id.to_string())
                .unwrap(),
            side_json
        );
        assert_eq!(runtime.semantic_hash().unwrap(), before_hash);
    }

    #[test]
    fn wasm_sampled_packet_face_ids_match_every_native_planar_frame() {
        let runtime = runtime();
        let snapshot = runtime.base_body_snapshot().unwrap();
        let mut solid: Solid = serde_json::from_slice(&snapshot.solid_json).unwrap();
        let source_face_ids = solid
            .face_iter()
            .map(|face| face.stable_id().raw())
            .collect::<BTreeSet<_>>();
        let packet = crawler_render_packet::fixed_sampled_packet_from_solid(&mut solid, 0.01)
            .expect("the WASM sampler must produce the base body packet");
        let mut packet_face_ids = BTreeSet::new();

        for range in &packet.face_ranges {
            let record = packet
                .pick_record(range.pick_token)
                .filter(|record| record.kind == crawler_render_packet::PickKind::Face)
                .expect("each face range must carry face provenance");
            packet_face_ids.insert(record.stable_id);
            let authority: serde_json::Value = serde_json::from_str(
                &runtime
                    .planar_face_frame_json(
                        crawler_part_engine::BODY_ID,
                        &record.stable_id.to_string(),
                    )
                    .unwrap(),
            )
            .unwrap();
            assert_eq!(authority["found"], true);
            let tuple = |field: &str| {
                let values = authority["frame"][field].as_array().unwrap();
                std::array::from_fn::<_, 3, _>(|axis| values[axis].as_i64().unwrap() as f64)
            };
            let origin_nm = tuple("origin_nanometers");
            let normal_millionths = tuple("normal_millionths");
            let origin = origin_nm.map(|value| value / 1_000_000.0);
            let normal = normal_millionths.map(|value| value / 1_000_000.0);

            let indices = &packet.triangle_indices
                [range.first_index as usize..(range.first_index + range.index_count) as usize];
            for index in indices {
                let offset = *index as usize * 3;
                let position = std::array::from_fn::<_, 3, _>(|axis| {
                    f64::from(packet.positions[offset + axis])
                });
                let packet_normal =
                    std::array::from_fn::<_, 3, _>(|axis| f64::from(packet.normals[offset + axis]));
                let plane_distance = (0..3)
                    .map(|axis| (position[axis] - origin[axis]) * normal[axis])
                    .sum::<f64>();
                let normal_alignment = (0..3)
                    .map(|axis| packet_normal[axis] * normal[axis])
                    .sum::<f64>();
                assert!(
                    plane_distance.abs() <= 1.0e-6,
                    "face {} packet geometry is off its native plane by {plane_distance}",
                    record.stable_id
                );
                assert!(
                    normal_alignment >= 0.999_999,
                    "face {} packet normal does not match its native frame: {normal_alignment}",
                    record.stable_id
                );
            }
        }
        assert_eq!(packet_face_ids, source_face_ids);
    }

    #[test]
    fn planar_face_frame_reports_missing_nonplanar_and_u64_max_without_cross_body_inference() {
        let mut runtime = runtime();
        let missing_body: serde_json::Value = serde_json::from_str(
            &runtime
                .planar_face_frame_json("body:absent", &u64::MAX.to_string())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(missing_body["error"]["code"], "missing_body");
        assert_eq!(missing_body["face_stable_id"], u64::MAX.to_string());

        let max_id: serde_json::Value = serde_json::from_str(
            &runtime
                .planar_face_frame_json(crawler_part_engine::BODY_ID, &u64::MAX.to_string())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(max_id["error"]["code"], "missing_face");
        assert_eq!(max_id["error"]["field"], "planar_face.face_stable_id");

        let invalid: serde_json::Value = serde_json::from_str(
            &runtime
                .planar_face_frame_json(crawler_part_engine::BODY_ID, "018")
                .unwrap(),
        )
        .unwrap();
        assert_eq!(invalid["error"]["code"], "invalid_face_stable_id");

        let outcome = execute_new(
            &mut runtime,
            "feature:planar-face-frame-revolve",
            revolve_operation(20_000_000),
        );
        assert_eq!(outcome["accepted"], true, "{outcome:#}");
        let revolve_body_id = "body:feature:planar-face-frame-revolve";
        let (_, revolve_snapshot) = runtime
            .accepted_unsuppressed_body_snapshot(revolve_body_id)
            .unwrap()
            .unwrap();
        let revolve: Solid = serde_json::from_slice(&revolve_snapshot.solid_json).unwrap();
        let curved_id = revolve
            .face_iter()
            .find(|face| !matches!(face.oriented_surface(), Surface::Plane(_)))
            .unwrap()
            .stable_id()
            .raw();
        let nonplanar: serde_json::Value = serde_json::from_str(
            &runtime
                .planar_face_frame_json(revolve_body_id, &curved_id.to_string())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(nonplanar["error"]["code"], "nonplanar_face");
        assert_eq!(nonplanar["error"]["category"], "unsupported");

        let base: Solid =
            serde_json::from_slice(&runtime.base_body_snapshot().unwrap().solid_json).unwrap();
        let revolve_ids: BTreeSet<u64> = revolve
            .face_iter()
            .map(|face| face.stable_id().raw())
            .collect();
        let body_local_id = base
            .face_iter()
            .map(|face| face.stable_id().raw())
            .find(|id| !revolve_ids.contains(id))
            .unwrap();
        let body_qualified_miss: serde_json::Value = serde_json::from_str(
            &runtime
                .planar_face_frame_json(revolve_body_id, &body_local_id.to_string())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(body_qualified_miss["error"]["code"], "missing_face");
        assert_eq!(
            body_qualified_miss["error"]["referenced_body_ids"],
            serde_json::json!([])
        );
    }

    #[test]
    fn planar_face_frame_refuses_dirty_and_failed_producer_snapshots() {
        let runtime = runtime();
        let snapshot = runtime.base_body_snapshot().unwrap();
        let solid: Solid = serde_json::from_slice(&snapshot.solid_json).unwrap();
        let face_id = face_id_on_coordinate(&solid, 2, 10.0);
        let document: serde_json::Value =
            serde_json::from_str(&runtime.document_json().unwrap()).unwrap();
        let revision = document["revision"].as_u64().unwrap();

        for state in [
            serde_json::json!({ "status": "dirty", "since_revision": revision }),
            serde_json::json!({
                "status": "failed",
                "attempted_revision": revision,
                "diagnostic_code": "test_failure"
            }),
        ] {
            let mut stale_document = document.clone();
            stale_document["recompute"]["features"][crawler_part_engine::EXTRUDE_FEATURE_ID] =
                state;
            let stale = PartRuntime::from_document_json(&stale_document.to_string()).unwrap();
            let response: serde_json::Value = serde_json::from_str(
                &stale
                    .planar_face_frame_json(crawler_part_engine::BODY_ID, &face_id.to_string())
                    .unwrap(),
            )
            .unwrap();
            assert_eq!(response["found"], false);
            assert_eq!(response["error"]["code"], "stale_body");
            assert_eq!(response["error"]["field"], "planar_face.body_id");
            assert_eq!(
                response["error"]["referenced_body_ids"],
                serde_json::json!([crawler_part_engine::EXTRUDE_FEATURE_ID])
            );
        }
    }

    #[test]
    fn planar_face_frame_rejects_degenerate_plane_axes() {
        let runtime = runtime();
        let solid: Solid =
            serde_json::from_slice(&runtime.base_body_snapshot().unwrap().solid_json).unwrap();
        let face = solid.face_iter().next().unwrap();
        let degenerate = monstertruck_modeling::Plane::new(
            Point3::new(0.0, 0.0, 0.0),
            Point3::new(1.0, 0.0, 0.0),
            Point3::new(2.0, 0.0, 0.0),
        );
        let error = exact_planar_face_frame(face, degenerate).unwrap_err();
        assert_eq!(error.code, "degenerate_planar_face_frame");
        assert_eq!(error.field, "planar_face.frame.normal_millionths");
    }

    #[test]
    fn topology_face_sketch_extrude_is_durable_and_rebuilds_from_current_face_frame() {
        let mut runtime = runtime();
        let solid: Solid =
            serde_json::from_slice(&runtime.base_body_snapshot().unwrap().solid_json).unwrap();
        let face_id = face_id_on_coordinate(&solid, 2, 10.0);
        let reference = TopologyReference {
            schema_version: crawler_document::TopologyReferenceVersion::V1,
            component: ComponentId::from(crawler_part_engine::ROOT_COMPONENT_ID),
            id: TopologyReferenceId::from("topology:s4-current-top"),
            body: BodyId::from(crawler_part_engine::BODY_ID),
            producer: FeatureId::from(crawler_part_engine::EXTRUDE_FEATURE_ID),
            kind: TopologyKind::Face,
            stable_kernel_id: face_id,
            stable_token: "s4:current-top".into(),
            fallback_signature: TopologySignature::Face {
                centroid_nanometers: [5_000_000, 5_000_000, 10_000_000],
                normal_millionths: [0, 0, 1_000_000],
                area_square_nanometers: 100_000_000_000_000,
            },
        };
        let sketch = serde_json::json!({
            "id": "sketch:s4-face-profile",
            "revision": 0,
            "geometry": {
                "geometry:s4-rectangle": {
                    "id": "geometry:s4-rectangle",
                    "geometry": {
                        "kind": "rectangle",
                        "min": { "x_nm": 1_000_000, "y_nm": 1_000_000 },
                        "max": { "x_nm": 4_000_000, "y_nm": 3_000_000 }
                    }
                }
            },
            "constraints": {}
        });
        let support = serde_json::json!({
            "kind": "topology",
            "reference": reference.id,
        });
        let solved: serde_json::Value = serde_json::from_str(
            &runtime
                .solve_sketch_json(
                    &serde_json::json!({
                        "transaction_id": "transaction:s4-face-sketch",
                        "sketch": sketch,
                        "support": support,
                        "support_reference": reference,
                    })
                    .to_string(),
                )
                .unwrap(),
        )
        .unwrap();
        assert_eq!(solved["accepted"], true, "{solved:#}");
        let document_after_sketch = runtime.engine.document();
        let FeatureRecomputeState::Clean { evaluated_revision } = document_after_sketch
            .recompute
            .features[&FeatureId::from(crawler_part_engine::EXTRUDE_FEATURE_ID)]
        else {
            panic!("unchanged base producer must remain clean");
        };
        assert!(evaluated_revision < document_after_sketch.revision);
        let authority_after_unrelated_revision: serde_json::Value = serde_json::from_str(
            &runtime
                .planar_face_frame_json(crawler_part_engine::BODY_ID, &face_id.to_string())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(authority_after_unrelated_revision["found"], true);

        let mut request = serde_json::json!({
            "sketch": sketch,
            "support": support,
            "distance_nanometers": 2_000_000,
            "feature_id": "feature:s4-face-extrude",
            "body_id": "body:s4-face-extrude",
            "tolerance": 0.01,
        });
        let preview: serde_json::Value = serde_json::from_str(
            &runtime
                .preview_sketch_extrude_json(&request.to_string())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            preview["render"]["packet"]["bounds"],
            serde_json::json!([1.0, 1.0, 10.0, 4.0, 3.0, 12.0])
        );
        request["transaction_id"] = serde_json::json!("transaction:s4-face-extrude");
        let committed: serde_json::Value = serde_json::from_str(
            &runtime
                .commit_sketch_extrude_json(&request.to_string())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(committed["accepted"], true, "{committed:#}");
        let document = runtime.engine.document();
        let extrude = &document.features[&FeatureId::from("feature:s4-face-extrude")];
        assert_eq!(
            extrude.inputs["support"],
            FeatureInput::Topology(TopologyReferenceId::from("topology:s4-current-top"))
        );
        assert!(
            extrude
                .dependencies
                .contains(&FeatureId::from(crawler_part_engine::EXTRUDE_FEATURE_ID))
        );
        assert!(matches!(
            &document.feature_definitions_v2[&FeatureId::from("feature:s4-face-extrude")].operation,
            crawler_document::FeatureOperationV2::Extrude {
                support: PlanarSupportReferenceV2::TopologyFace { reference },
                ..
            } if reference == &TopologyReferenceId::from("topology:s4-current-top")
        ));

        let saved = runtime.document_json().unwrap();
        let mut wrong_kind_document: serde_json::Value = serde_json::from_str(&saved).unwrap();
        wrong_kind_document["topology_references"]["topology:s4-current-top"]["kind"] =
            serde_json::json!("edge");
        let wrong_kind = PartRuntime::from_document_json(&wrong_kind_document.to_string()).unwrap();
        let wrong_kind_hash = wrong_kind.semantic_hash().unwrap();
        let error = wrong_kind
            .preview_sketch_extrude_json(&request.to_string())
            .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("wrong_kind_topology_face_support")
        );
        assert_eq!(wrong_kind.semantic_hash().unwrap(), wrong_kind_hash);

        let mut restored = PartRuntime::from_document_json(&saved).unwrap();
        restored
            .commit_length(crawler_part_engine::DISTANCE_PARAMETER_ID, 14_000_000)
            .unwrap();
        let recomputed: serde_json::Value = serde_json::from_str(
            &restored
                .recompute_from_here_json(crawler_part_engine::EXTRUDE_FEATURE_ID)
                .unwrap(),
        )
        .unwrap();
        assert_eq!(recomputed["accepted"], true, "{recomputed:#}");
        let active: serde_json::Value =
            serde_json::from_str(&restored.active_body_json(0.01).unwrap()).unwrap();
        assert_eq!(
            active["render"]["packet"]["bounds"],
            serde_json::json!([1.0, 1.0, 14.0, 4.0, 3.0, 16.0])
        );
    }

    #[test]
    fn solve_sketch_rejects_every_invalid_topology_support_atomically_and_recovers() {
        let valid_reference = |runtime: &PartRuntime, id: &str| {
            let solid: Solid =
                serde_json::from_slice(&runtime.base_body_snapshot().unwrap().solid_json).unwrap();
            TopologyReference {
                schema_version: crawler_document::TopologyReferenceVersion::V1,
                component: ComponentId::from(crawler_part_engine::ROOT_COMPONENT_ID),
                id: TopologyReferenceId::from(id),
                body: BodyId::from(crawler_part_engine::BODY_ID),
                producer: FeatureId::from(crawler_part_engine::EXTRUDE_FEATURE_ID),
                kind: TopologyKind::Face,
                stable_kernel_id: face_id_on_coordinate(&solid, 2, 10.0),
                stable_token: format!("solve-validation:{id}"),
                fallback_signature: TopologySignature::Face {
                    centroid_nanometers: [5_000_000, 5_000_000, 10_000_000],
                    normal_millionths: [0, 0, 1_000_000],
                    area_square_nanometers: 100_000_000_000_000,
                },
            }
        };
        let request = |transaction: &str, reference: &TopologyReference| {
            serde_json::json!({
                "transaction_id": transaction,
                "sketch": {
                    "id": format!("sketch:{transaction}"),
                    "revision": 0,
                    "geometry": {},
                    "constraints": {},
                },
                "support": { "kind": "topology", "reference": reference.id },
                "support_reference": reference,
            })
        };
        let cases = [
            ("wrong_kind_topology_face_support", {
                let runtime = runtime();
                let mut reference = valid_reference(&runtime, "topology:solve-wrong-kind");
                reference.kind = TopologyKind::Edge;
                (runtime, reference)
            }),
            ("missing_topology_face_body", {
                let runtime = runtime();
                let mut reference = valid_reference(&runtime, "topology:solve-missing-body");
                reference.body = BodyId::from("body:missing");
                (runtime, reference)
            }),
            ("missing_topology_face_producer", {
                let runtime = runtime();
                let mut reference = valid_reference(&runtime, "topology:solve-missing-producer");
                reference.producer = FeatureId::from("feature:missing");
                (runtime, reference)
            }),
            ("wrong_producer_topology_face_support", {
                let runtime = runtime();
                let mut reference = valid_reference(&runtime, "topology:solve-wrong-producer");
                reference.producer = FeatureId::from(crawler_part_engine::RECTANGLE_FEATURE_ID);
                (runtime, reference)
            }),
            ("cross_component_topology_face_support", {
                let runtime = runtime();
                let mut reference =
                    valid_reference(&runtime, "topology:solve-wrong-reference-component");
                reference.component = ComponentId::from("component:other");
                (runtime, reference)
            }),
            ("missing_face", {
                let runtime = runtime();
                let mut reference = valid_reference(&runtime, "topology:solve-missing-face");
                reference.stable_kernel_id = u64::MAX;
                (runtime, reference)
            }),
        ];
        for (code, (mut runtime, reference)) in cases {
            let before_hash = runtime.semantic_hash().unwrap();
            let before_transactions = runtime.engine.document().transactions.len();
            let error = runtime
                .solve_sketch_json(&request(&format!("transaction:{code}"), &reference).to_string())
                .unwrap_err();
            assert!(error.to_string().contains(code), "{error}");
            assert_eq!(runtime.semantic_hash().unwrap(), before_hash);
            assert_eq!(
                runtime.engine.document().transactions.len(),
                before_transactions
            );
        }

        let source = runtime();
        let cross_reference = valid_reference(&source, "topology:solve-cross-component");
        let mut cross_document: serde_json::Value =
            serde_json::from_str(&source.document_json().unwrap()).unwrap();
        cross_document["components"][crawler_part_engine::ROOT_COMPONENT_ID]["child_components"] =
            serde_json::json!(["component:other"]);
        cross_document["components"][crawler_part_engine::ROOT_COMPONENT_ID]["sketch_order"] =
            serde_json::json!([]);
        cross_document["components"]["component:other"] = serde_json::json!({
            "id": "component:other",
            "display_name": "Other",
            "parent": crawler_part_engine::ROOT_COMPONENT_ID,
            "child_components": [],
            "body_order": [],
            "sketch_order": [crawler_part_engine::RECTANGLE_SKETCH_ID],
            "feature_order": [],
            "parameter_order": [],
        });
        cross_document["sketches"][crawler_part_engine::RECTANGLE_SKETCH_ID]["component"] =
            serde_json::json!("component:other");
        let mut cross = PartRuntime::from_document_json(&cross_document.to_string()).unwrap();
        let cross_hash = cross.semantic_hash().unwrap();
        let error = cross
            .solve_sketch_json(
                &serde_json::json!({
                    "transaction_id": "transaction:reject-cross-component",
                    "sketch": {
                        "id": crawler_part_engine::RECTANGLE_SKETCH_ID,
                        "revision": 0,
                        "geometry": {},
                        "constraints": {},
                    },
                    "support": { "kind": "topology", "reference": cross_reference.id },
                    "support_reference": cross_reference,
                })
                .to_string(),
            )
            .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("cross_component_topology_face_support")
        );
        assert_eq!(cross.semantic_hash().unwrap(), cross_hash);

        let mut suppressed = runtime();
        let suppressed_reference =
            valid_reference(&suppressed, "topology:solve-suppressed-producer");
        suppressed
            .commit_changes_json(
                &serde_json::json!({
                    "transaction_id": "transaction:suppress-support-producer",
                    "changes": [{
                        "kind": "set_feature_suppressed",
                        "feature": crawler_part_engine::EXTRUDE_FEATURE_ID,
                        "suppressed": true,
                    }]
                })
                .to_string(),
            )
            .unwrap();
        let suppressed_hash = suppressed.semantic_hash().unwrap();
        let suppressed_transactions = suppressed.engine.document().transactions.len();
        let error = suppressed
            .solve_sketch_json(
                &request("transaction:reject-suppressed", &suppressed_reference).to_string(),
            )
            .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("suppressed_topology_face_producer")
        );
        assert_eq!(suppressed.semantic_hash().unwrap(), suppressed_hash);
        assert_eq!(
            suppressed.engine.document().transactions.len(),
            suppressed_transactions
        );
        suppressed
            .commit_changes_json(
                &serde_json::json!({
                    "transaction_id": "transaction:unsuppress-support-producer",
                    "changes": [{
                        "kind": "set_feature_suppressed",
                        "feature": crawler_part_engine::EXTRUDE_FEATURE_ID,
                        "suppressed": false,
                    }]
                })
                .to_string(),
            )
            .unwrap();
        let recovered = suppressed
            .recompute_from_here_json(crawler_part_engine::EXTRUDE_FEATURE_ID)
            .unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&recovered).unwrap()["accepted"],
            true
        );
        assert!(
            feature_is_clean_at_accepted_revision(
                suppressed.engine.document(),
                &FeatureId::from(crawler_part_engine::EXTRUDE_FEATURE_ID),
            ),
            "recovery did not clean producer: {recovered}; state={:?}",
            suppressed
                .engine
                .document()
                .recompute
                .features
                .get(&FeatureId::from(crawler_part_engine::EXTRUDE_FEATURE_ID))
        );
        let accepted = suppressed
            .solve_sketch_json(
                &request("transaction:accept-after-unsuppress", &suppressed_reference).to_string(),
            )
            .unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&accepted).unwrap()["accepted"],
            true
        );

        let source = runtime();
        let stale_reference = valid_reference(&source, "topology:solve-stale-producer");
        let mut stale_document: serde_json::Value =
            serde_json::from_str(&source.document_json().unwrap()).unwrap();
        let stale_revision = stale_document["revision"].as_u64().unwrap();
        stale_document["recompute"]["features"][crawler_part_engine::EXTRUDE_FEATURE_ID] =
            serde_json::json!({ "status": "dirty", "since_revision": stale_revision });
        let mut stale = PartRuntime::from_document_json(&stale_document.to_string()).unwrap();
        let stale_hash = stale.semantic_hash().unwrap();
        let error = stale
            .solve_sketch_json(&request("transaction:reject-stale", &stale_reference).to_string())
            .unwrap_err();
        assert!(error.to_string().contains("stale_topology_face_support"));
        assert_eq!(stale.semantic_hash().unwrap(), stale_hash);
        let recomputed = stale
            .recompute_from_here_json(crawler_part_engine::EXTRUDE_FEATURE_ID)
            .unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&recomputed).unwrap()["accepted"],
            true
        );
        let accepted = stale
            .solve_sketch_json(
                &request(
                    "transaction:accept-current-after-recompute",
                    &stale_reference,
                )
                .to_string(),
            )
            .unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&accepted).unwrap()["accepted"],
            true
        );
    }

    #[test]
    fn native_current_stored_face_overrides_caller_omission_and_refuses_repair() {
        let mut runtime = runtime();
        let solid: Solid =
            serde_json::from_slice(&runtime.base_body_snapshot().unwrap().solid_json).unwrap();
        let face = face_id_on_coordinate(&solid, 2, 10.0);
        let reference = TopologyReference {
            schema_version: crawler_document::TopologyReferenceVersion::V1,
            component: ComponentId::from(crawler_part_engine::ROOT_COMPONENT_ID),
            id: TopologyReferenceId::from("topology:stored-current-authority"),
            body: BodyId::from(crawler_part_engine::BODY_ID),
            producer: FeatureId::from(crawler_part_engine::EXTRUDE_FEATURE_ID),
            kind: TopologyKind::Face,
            stable_kernel_id: face,
            stable_token: "stored-current-authority".into(),
            fallback_signature: TopologySignature::Face {
                centroid_nanometers: [5_000_000, 5_000_000, 10_000_000],
                normal_millionths: [0, 0, 1_000_000],
                area_square_nanometers: 100_000_000_000_000,
            },
        };
        runtime
            .solve_sketch_json(
                &serde_json::json!({
                    "transaction_id": "transaction:store-current-authority",
                    "sketch": { "id": "sketch:stored-current-authority", "revision": 0, "geometry": {}, "constraints": {} },
                    "support": { "kind": "topology", "reference": reference.id },
                    "support_reference": reference,
                })
                .to_string(),
            )
            .unwrap();
        let before_hash = runtime.semantic_hash().unwrap();
        let before_revision = runtime.engine.document().revision;
        let inspection: serde_json::Value =
            serde_json::from_str(&runtime.repair_inspection_json("[]").unwrap()).unwrap();
        assert_eq!(inspection["status"], "ready");
        assert_eq!(inspection["document_hash"], before_hash);

        let mut caller_replacement = runtime.engine.document().topology_references
            [&TopologyReferenceId::from("topology:stored-current-authority")]
            .clone();
        caller_replacement.id = TopologyReferenceId::from("topology:caller-manufactured-repair");
        let refused = runtime.explicit_rebind_json(
            &serde_json::json!({
                "transaction_id": "transaction:must-refuse-manufactured-repair",
                "selected": caller_replacement.id,
                "observed": [caller_replacement],
                "base_document_hash": before_hash,
                "base_revision": before_revision,
            })
            .to_string(),
        );
        assert!(refused.is_err());
        assert_eq!(runtime.semantic_hash().unwrap(), before_hash);
        assert_eq!(runtime.engine.document().revision, before_revision);
    }

    #[test]
    fn topology_support_diagnostics_are_structured_exact_and_read_only() {
        let mut runtime = runtime();
        let solid: Solid =
            serde_json::from_slice(&runtime.base_body_snapshot().unwrap().solid_json).unwrap();
        let reference_id = "topology:structured-support-diagnostic";
        let reference = TopologyReference {
            schema_version: crawler_document::TopologyReferenceVersion::V1,
            component: ComponentId::from(crawler_part_engine::ROOT_COMPONENT_ID),
            id: TopologyReferenceId::from(reference_id),
            body: BodyId::from(crawler_part_engine::BODY_ID),
            producer: FeatureId::from(crawler_part_engine::EXTRUDE_FEATURE_ID),
            kind: TopologyKind::Face,
            stable_kernel_id: face_id_on_coordinate(&solid, 2, 10.0),
            stable_token: "structured-support-diagnostic".into(),
            fallback_signature: TopologySignature::Face {
                centroid_nanometers: [5_000_000, 5_000_000, 10_000_000],
                normal_millionths: [0, 0, 1_000_000],
                area_square_nanometers: 100_000_000_000_000,
            },
        };
        runtime
            .solve_sketch_json(
                &serde_json::json!({
                    "transaction_id": "transaction:structured-support-diagnostic",
                    "sketch": { "id": "sketch:structured-support-diagnostic", "revision": 0, "geometry": {}, "constraints": {} },
                    "support": { "kind": "topology", "reference": reference.id },
                    "support_reference": reference,
                })
                .to_string(),
            )
            .unwrap();
        let accepted_json = runtime.document_json().unwrap();
        let accepted_hash = runtime.semantic_hash().unwrap();
        let valid: serde_json::Value = serde_json::from_str(
            &runtime
                .topology_support_diagnostic_json(
                    reference_id,
                    crawler_part_engine::ROOT_COMPONENT_ID,
                )
                .unwrap(),
        )
        .unwrap();
        assert_eq!(valid["valid"], true);
        assert_eq!(valid["base_document_hash"], accepted_hash);
        assert_eq!(runtime.semantic_hash().unwrap(), accepted_hash);

        let missing: serde_json::Value = serde_json::from_str(
            &runtime
                .topology_support_diagnostic_json(
                    "topology:missing",
                    crawler_part_engine::ROOT_COMPONENT_ID,
                )
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            missing["diagnostic"]["code"],
            "missing_topology_face_support"
        );
        assert_eq!(missing["diagnostic"]["field"], "extrude.support");

        let cross: serde_json::Value = serde_json::from_str(
            &runtime
                .topology_support_diagnostic_json(reference_id, "component:other")
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            cross["diagnostic"]["code"],
            "cross_component_topology_face_support"
        );

        for (code, mutate) in [
            (
                "wrong_kind_topology_face_support",
                ("kind", serde_json::json!("edge")),
            ),
            (
                "missing_topology_face_body",
                ("body", serde_json::json!("body:missing")),
            ),
            (
                "missing_topology_face_producer",
                ("producer", serde_json::json!("feature:missing")),
            ),
            (
                "wrong_producer_topology_face_support",
                (
                    "producer",
                    serde_json::json!(crawler_part_engine::RECTANGLE_FEATURE_ID),
                ),
            ),
            (
                "cross_component_topology_face_support",
                ("component", serde_json::json!("component:other")),
            ),
        ] {
            let mut document: serde_json::Value = serde_json::from_str(&accepted_json).unwrap();
            document["topology_references"][reference_id][mutate.0] = mutate.1;
            let invalid = PartRuntime::from_document_json(&document.to_string()).unwrap();
            let before = invalid.semantic_hash().unwrap();
            let diagnostic: serde_json::Value = serde_json::from_str(
                &invalid
                    .topology_support_diagnostic_json(
                        reference_id,
                        crawler_part_engine::ROOT_COMPONENT_ID,
                    )
                    .unwrap(),
            )
            .unwrap();
            assert_eq!(diagnostic["diagnostic"]["code"], code);
            assert_eq!(invalid.semantic_hash().unwrap(), before);
        }

        let mut suppressed_document: serde_json::Value =
            serde_json::from_str(&accepted_json).unwrap();
        suppressed_document["features"][crawler_part_engine::EXTRUDE_FEATURE_ID]["suppressed"] =
            serde_json::json!(true);
        let suppressed = PartRuntime::from_document_json(&suppressed_document.to_string()).unwrap();
        let diagnostic: serde_json::Value = serde_json::from_str(
            &suppressed
                .topology_support_diagnostic_json(
                    reference_id,
                    crawler_part_engine::ROOT_COMPONENT_ID,
                )
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            diagnostic["diagnostic"]["code"],
            "suppressed_topology_face_producer"
        );

        let mut stale_document: serde_json::Value = serde_json::from_str(&accepted_json).unwrap();
        let revision = stale_document["revision"].as_u64().unwrap();
        stale_document["recompute"]["features"][crawler_part_engine::EXTRUDE_FEATURE_ID] =
            serde_json::json!({ "status": "dirty", "since_revision": revision });
        let stale = PartRuntime::from_document_json(&stale_document.to_string()).unwrap();
        let diagnostic: serde_json::Value = serde_json::from_str(
            &stale
                .topology_support_diagnostic_json(
                    reference_id,
                    crawler_part_engine::ROOT_COMPONENT_ID,
                )
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            diagnostic["diagnostic"]["code"],
            "stale_topology_face_support"
        );
    }

    #[test]
    fn descendant_recompute_evaluates_dirty_face_producer_before_consuming_snapshot() {
        let mut runtime = runtime();
        let solid: Solid =
            serde_json::from_slice(&runtime.base_body_snapshot().unwrap().solid_json).unwrap();
        let face = face_id_on_coordinate(&solid, 2, 10.0);
        let reference = TopologyReference {
            schema_version: crawler_document::TopologyReferenceVersion::V1,
            component: ComponentId::from(crawler_part_engine::ROOT_COMPONENT_ID),
            id: TopologyReferenceId::from("topology:dirty-required-producer"),
            body: BodyId::from(crawler_part_engine::BODY_ID),
            producer: FeatureId::from(crawler_part_engine::EXTRUDE_FEATURE_ID),
            kind: TopologyKind::Face,
            stable_kernel_id: face,
            stable_token: "dirty-required-producer".into(),
            fallback_signature: TopologySignature::Face {
                centroid_nanometers: [5_000_000, 5_000_000, 10_000_000],
                normal_millionths: [0, 0, 1_000_000],
                area_square_nanometers: 100_000_000_000_000,
            },
        };
        let sketch = serde_json::json!({
            "id": "sketch:dirty-required-producer",
            "revision": 0,
            "geometry": { "geometry:rectangle": { "id": "geometry:rectangle", "geometry": { "kind": "rectangle", "min": { "x_nm": 1_000_000, "y_nm": 1_000_000 }, "max": { "x_nm": 4_000_000, "y_nm": 3_000_000 } } } },
            "constraints": {},
        });
        let support = serde_json::json!({ "kind": "topology", "reference": reference.id });
        runtime
            .solve_sketch_json(
                &serde_json::json!({
                    "transaction_id": "transaction:dirty-required-sketch",
                    "sketch": sketch,
                    "support": support,
                    "support_reference": reference,
                })
                .to_string(),
            )
            .unwrap();
        runtime
            .commit_sketch_extrude_json(
                &serde_json::json!({
                    "transaction_id": "transaction:dirty-required-extrude",
                    "sketch": sketch,
                    "support": support,
                    "distance_nanometers": 2_000_000,
                    "feature_id": "feature:dirty-required-extrude",
                    "body_id": "body:dirty-required-extrude",
                    "tolerance": 0.01,
                })
                .to_string(),
            )
            .unwrap();
        let mut document: serde_json::Value =
            serde_json::from_str(&runtime.document_json().unwrap()).unwrap();
        let revision = document["revision"].as_u64().unwrap();
        document["recompute"]["features"][crawler_part_engine::EXTRUDE_FEATURE_ID] =
            serde_json::json!({ "status": "dirty", "since_revision": revision });
        let mut stale = PartRuntime::from_document_json(&document.to_string()).unwrap();
        let authority: serde_json::Value = serde_json::from_str(
            &stale
                .planar_face_frame_json(crawler_part_engine::BODY_ID, &face.to_string())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(authority["found"], false);
        assert_eq!(authority["error"]["code"], "stale_body");

        let stale_hash = stale.semantic_hash().unwrap();
        let stale_transactions = stale.engine.document().transactions.len();
        let refused = stale
            .recompute_from_here_json("feature:dirty-required-extrude")
            .unwrap_err();
        assert!(refused.to_string().contains("stale_topology_face_support"));
        assert_eq!(stale.semantic_hash().unwrap(), stale_hash);
        assert_eq!(
            stale.engine.document().transactions.len(),
            stale_transactions
        );

        // Recovery is explicit at the stale producer. Only then may the same
        // transaction evaluate its face-supported descendants from the fresh
        // native snapshot.
        let result: serde_json::Value = serde_json::from_str(
            &stale
                .recompute_from_here_json(crawler_part_engine::EXTRUDE_FEATURE_ID)
                .unwrap(),
        )
        .unwrap();
        assert_eq!(result["accepted"], true, "{result:#}");
        assert_eq!(
            result["plan"]["evaluation_order"][0],
            crawler_part_engine::EXTRUDE_FEATURE_ID
        );
        assert_eq!(result["recomputed"].as_array().unwrap().len(), 2);
        let recovered: serde_json::Value = serde_json::from_str(
            &stale
                .planar_face_frame_json(crawler_part_engine::BODY_ID, &face.to_string())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(recovered["found"], true, "{recovered:#}");
    }

    #[test]
    fn base_distance_edit_rebuilds_topology_supported_descendant_on_moved_face() {
        let mut runtime = runtime();
        let solid: Solid =
            serde_json::from_slice(&runtime.base_body_snapshot().unwrap().solid_json).unwrap();
        let top_face = face_id_on_coordinate(&solid, 2, 10.0);
        let reference = TopologyReference {
            schema_version: crawler_document::TopologyReferenceVersion::V1,
            component: ComponentId::from(crawler_part_engine::ROOT_COMPONENT_ID),
            id: TopologyReferenceId::from("topology:moving-base-top"),
            body: BodyId::from(crawler_part_engine::BODY_ID),
            producer: FeatureId::from(crawler_part_engine::EXTRUDE_FEATURE_ID),
            kind: TopologyKind::Face,
            stable_kernel_id: top_face,
            stable_token: "moving-base-top".into(),
            fallback_signature: TopologySignature::Face {
                centroid_nanometers: [5_000_000, 5_000_000, 10_000_000],
                normal_millionths: [0, 0, 1_000_000],
                area_square_nanometers: 100_000_000_000_000,
            },
        };
        let sketch = serde_json::json!({
            "id": "sketch:moving-base-top",
            "revision": 0,
            "geometry": {
                "geometry:rectangle": {
                    "id": "geometry:rectangle",
                    "geometry": { "kind": "rectangle", "min": { "x_nm": 1_000_000, "y_nm": 1_000_000 }, "max": { "x_nm": 5_000_000, "y_nm": 4_000_000 } }
                }
            },
            "constraints": {},
        });
        let support = serde_json::json!({ "kind": "topology", "reference": reference.id });
        runtime
            .solve_sketch_json(
                &serde_json::json!({
                    "transaction_id": "transaction:moving-base-sketch",
                    "sketch": sketch,
                    "support": support,
                    "support_reference": reference,
                })
                .to_string(),
            )
            .unwrap();
        runtime
            .commit_sketch_extrude_json(
                &serde_json::json!({
                    "transaction_id": "transaction:moving-base-extrude",
                    "sketch": sketch,
                    "support": support,
                    "distance_nanometers": 7_000_000,
                    "feature_id": "feature:moving-base-extrude",
                    "body_id": "body:moving-base-extrude",
                    "tolerance": 0.01,
                })
                .to_string(),
            )
            .unwrap();
        let initial: serde_json::Value =
            serde_json::from_str(&runtime.active_body_json(0.01).unwrap()).unwrap();
        assert_eq!(
            initial["render"]["packet"]["bounds"],
            serde_json::json!([1.0, 1.0, 10.0, 5.0, 4.0, 17.0])
        );

        let before_edit_hash = runtime.semantic_hash().unwrap();
        let before_edit_revision = runtime.engine.document().revision;
        let before_edit_transactions = runtime.engine.document().transactions.len();
        let edit: serde_json::Value = serde_json::from_str(
            &runtime
                .commit_length(crawler_part_engine::DISTANCE_PARAMETER_ID, 18_000_000)
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            edit["evaluation_order"],
            serde_json::json!([
                crawler_part_engine::EXTRUDE_FEATURE_ID,
                "feature:sketch:moving-base-top",
                "feature:moving-base-extrude"
            ])
        );
        assert_eq!(runtime.engine.document().revision, before_edit_revision + 1);
        assert_eq!(
            runtime.engine.document().transactions.len(),
            before_edit_transactions + 1
        );
        assert!(
            runtime
                .engine
                .document()
                .transactions
                .last()
                .unwrap()
                .changes
                .iter()
                .any(|change| matches!(
                    change,
                    DocumentChange::AcceptFeatureResult { feature, .. }
                        if feature == &FeatureId::from("feature:moving-base-extrude")
                ))
        );
        let moved: serde_json::Value =
            serde_json::from_str(&runtime.active_body_json(0.01).unwrap()).unwrap();
        assert_eq!(
            moved["render"]["packet"]["bounds"],
            serde_json::json!([1.0, 1.0, 18.0, 5.0, 4.0, 25.0])
        );
        assert_eq!(runtime.undo().unwrap(), before_edit_hash);
        let restored: serde_json::Value =
            serde_json::from_str(&runtime.active_body_json(0.01).unwrap()).unwrap();
        assert_eq!(
            restored["render"]["packet"]["bounds"],
            initial["render"]["packet"]["bounds"]
        );
    }

    #[test]
    fn suppressed_support_producer_refuses_preview_commit_and_recompute_then_recovers() {
        let mut runtime = runtime();
        let solid: Solid =
            serde_json::from_slice(&runtime.base_body_snapshot().unwrap().solid_json).unwrap();
        let face = face_id_on_coordinate(&solid, 2, 10.0);
        let reference = TopologyReference {
            schema_version: crawler_document::TopologyReferenceVersion::V1,
            component: ComponentId::from(crawler_part_engine::ROOT_COMPONENT_ID),
            id: TopologyReferenceId::from("topology:suppression-recovery"),
            body: BodyId::from(crawler_part_engine::BODY_ID),
            producer: FeatureId::from(crawler_part_engine::EXTRUDE_FEATURE_ID),
            kind: TopologyKind::Face,
            stable_kernel_id: face,
            stable_token: "suppression-recovery".into(),
            fallback_signature: TopologySignature::Face {
                centroid_nanometers: [5_000_000, 5_000_000, 10_000_000],
                normal_millionths: [0, 0, 1_000_000],
                area_square_nanometers: 100_000_000_000_000,
            },
        };
        let sketch = serde_json::json!({
            "id": "sketch:suppression-recovery",
            "revision": 0,
            "geometry": {
                "geometry:rectangle": {
                    "id": "geometry:rectangle",
                    "geometry": { "kind": "rectangle", "min": { "x_nm": 1_000_000, "y_nm": 1_000_000 }, "max": { "x_nm": 4_000_000, "y_nm": 3_000_000 } }
                }
            },
            "constraints": {},
        });
        let support = serde_json::json!({ "kind": "topology", "reference": reference.id });
        runtime
            .solve_sketch_json(
                &serde_json::json!({
                    "transaction_id": "transaction:suppression-recovery-sketch",
                    "sketch": sketch,
                    "support": support,
                    "support_reference": reference,
                })
                .to_string(),
            )
            .unwrap();
        let extrude_request = serde_json::json!({
            "transaction_id": "transaction:suppression-recovery-extrude",
            "sketch": sketch,
            "support": support,
            "distance_nanometers": 2_000_000,
            "feature_id": "feature:suppression-recovery-extrude",
            "body_id": "body:suppression-recovery-extrude",
            "tolerance": 0.01,
        });
        runtime
            .commit_sketch_extrude_json(&extrude_request.to_string())
            .unwrap();
        runtime
            .commit_changes_json(
                &serde_json::json!({
                    "transaction_id": "transaction:suppress-face-producer",
                    "changes": [{ "kind": "set_feature_suppressed", "feature": crawler_part_engine::EXTRUDE_FEATURE_ID, "suppressed": true }],
                })
                .to_string(),
            )
            .unwrap();
        let broken_hash = runtime.semantic_hash().unwrap();
        let broken_transactions = runtime.engine.document().transactions.len();
        let last_good: serde_json::Value =
            serde_json::from_str(&runtime.active_body_json(0.01).unwrap()).unwrap();
        assert_eq!(
            last_good["body"]["body_id"],
            "body:suppression-recovery-extrude"
        );
        assert_eq!(
            last_good["render"]["packet"]["bounds"],
            serde_json::json!([1.0, 1.0, 10.0, 4.0, 3.0, 12.0])
        );
        let preview_error = runtime
            .preview_sketch_extrude_json(&extrude_request.to_string())
            .unwrap_err();
        assert!(
            preview_error
                .to_string()
                .contains("suppressed_topology_face_producer")
        );
        let commit_error = runtime
            .commit_sketch_extrude_json(&extrude_request.to_string())
            .unwrap_err();
        assert!(
            commit_error
                .to_string()
                .contains("suppressed_topology_face_producer")
        );
        let recompute_error = runtime
            .recompute_from_here_json(crawler_part_engine::EXTRUDE_FEATURE_ID)
            .unwrap_err();
        assert!(
            recompute_error
                .to_string()
                .contains("suppressed_topology_face_producer")
        );
        assert_eq!(runtime.semantic_hash().unwrap(), broken_hash);
        assert_eq!(
            runtime.engine.document().transactions.len(),
            broken_transactions
        );

        runtime
            .commit_changes_json(
                &serde_json::json!({
                    "transaction_id": "transaction:unsuppress-face-producer",
                    "changes": [{ "kind": "set_feature_suppressed", "feature": crawler_part_engine::EXTRUDE_FEATURE_ID, "suppressed": false }],
                })
                .to_string(),
            )
            .unwrap();
        let recovery: serde_json::Value = serde_json::from_str(
            &runtime
                .recompute_from_here_json(crawler_part_engine::EXTRUDE_FEATURE_ID)
                .unwrap(),
        )
        .unwrap();
        assert_eq!(recovery["accepted"], true, "{recovery:#}");
        let recovered: serde_json::Value =
            serde_json::from_str(&runtime.active_body_json(0.01).unwrap()).unwrap();
        assert_eq!(
            recovered["body"]["body_id"],
            "body:suppression-recovery-extrude"
        );
    }

    #[test]
    fn topology_face_extrude_repair_is_explicit_atomic_and_durable() {
        let mut runtime = runtime();
        let solid: Solid =
            serde_json::from_slice(&runtime.base_body_snapshot().unwrap().solid_json).unwrap();
        let current_face_id = face_id_on_coordinate(&solid, 2, 10.0);
        let original_reference_id = TopologyReferenceId::from("topology:s4-repair-broken");
        let original_reference = TopologyReference {
            schema_version: crawler_document::TopologyReferenceVersion::V1,
            component: ComponentId::from(crawler_part_engine::ROOT_COMPONENT_ID),
            id: original_reference_id.clone(),
            body: BodyId::from(crawler_part_engine::BODY_ID),
            producer: FeatureId::from(crawler_part_engine::EXTRUDE_FEATURE_ID),
            kind: TopologyKind::Face,
            stable_kernel_id: current_face_id,
            stable_token: "s4:repair-original".into(),
            fallback_signature: TopologySignature::Face {
                centroid_nanometers: [5_000_000, 5_000_000, 10_000_000],
                normal_millionths: [0, 0, 1_000_000],
                area_square_nanometers: 100_000_000_000_000,
            },
        };
        let sketch_id = SketchId::from("sketch:s4-repair-profile");
        let sketch = serde_json::json!({
            "id": sketch_id,
            "revision": 0,
            "geometry": {
                "geometry:s4-repair-rectangle": {
                    "id": "geometry:s4-repair-rectangle",
                    "geometry": {
                        "kind": "rectangle",
                        "min": { "x_nm": 1_000_000, "y_nm": 1_000_000 },
                        "max": { "x_nm": 4_000_000, "y_nm": 3_000_000 }
                    }
                }
            },
            "constraints": {}
        });
        let support = serde_json::json!({
            "kind": "topology",
            "reference": original_reference_id,
        });
        let solved: serde_json::Value = serde_json::from_str(
            &runtime
                .solve_sketch_json(
                    &serde_json::json!({
                        "transaction_id": "transaction:s4-repair-sketch",
                        "sketch": sketch,
                        "support": support,
                        "support_reference": original_reference,
                    })
                    .to_string(),
                )
                .unwrap(),
        )
        .unwrap();
        assert_eq!(solved["accepted"], true, "{solved:#}");

        let feature_id = FeatureId::from("feature:s4-repair-extrude");
        let body_id = BodyId::from("body:s4-repair-extrude");
        let committed: serde_json::Value = serde_json::from_str(
            &runtime
                .commit_sketch_extrude_json(
                    &serde_json::json!({
                        "transaction_id": "transaction:s4-repair-extrude",
                        "sketch": sketch,
                        "support": support,
                        "distance_nanometers": 2_000_000,
                        "feature_id": feature_id,
                        "body_id": body_id,
                        "tolerance": 0.01,
                    })
                    .to_string(),
                )
                .unwrap(),
        )
        .unwrap();
        assert_eq!(committed["accepted"], true, "{committed:#}");

        let original_profile =
            match &runtime.engine.document().feature_definitions_v2[&feature_id].operation {
                crawler_document::FeatureOperationV2::Extrude { profile, .. } => profile.clone(),
            };
        let saved: serde_json::Value =
            serde_json::from_str(&runtime.document_json().unwrap()).unwrap();
        let mut broken_document = saved;
        broken_document["topology_references"][&original_reference_id.0]["stable_kernel_id"] =
            serde_json::json!(u64::MAX.to_string());
        broken_document["topology_references"][&original_reference_id.0]["stable_token"] =
            serde_json::json!("s4:repair-missing");
        let mut broken = PartRuntime::from_document_json(&broken_document.to_string()).unwrap();
        let broken_hash = broken.semantic_hash().unwrap();
        let broken_history_len = broken.engine.document().transactions.len();

        let mut replacement =
            broken.engine.document().topology_references[&original_reference_id].clone();
        replacement.id = TopologyReferenceId::from("topology:s4-repair-current-top");
        replacement.stable_kernel_id = current_face_id;
        replacement.stable_token = "s4:repair-current-top".into();
        let observed = serde_json::to_string(&vec![replacement.clone()]).unwrap();
        let inspection: serde_json::Value =
            serde_json::from_str(&broken.repair_inspection_json(&observed).unwrap()).unwrap();
        assert_eq!(inspection["status"], "evaluation_blocked");
        assert_eq!(
            inspection["preview"]["unresolved"]["reference"],
            original_reference_id.0
        );
        assert_eq!(
            inspection["preview"]["candidates"][0]["candidate"]["id"],
            replacement.id.0
        );
        assert_eq!(broken.semantic_hash().unwrap(), broken_hash);
        assert_eq!(
            broken.engine.document().transactions.len(),
            broken_history_len
        );
        let preview: serde_json::Value = serde_json::from_str(
            &broken
                .preview_topology_rebind_json(
                    &serde_json::json!({
                        "selected": replacement.id,
                        "observed": [replacement.clone()],
                        "tolerance": 0.01,
                    })
                    .to_string(),
                )
                .unwrap(),
        )
        .unwrap();
        assert_eq!(preview["accepted"], true, "{preview:#}");
        assert_eq!(preview["base_document_hash"], broken_hash);
        assert_eq!(preview["base_revision"], broken.engine.document().revision);
        assert_eq!(preview["selected"], replacement.id.0);
        assert_eq!(preview["body_id"], body_id.0);
        assert_eq!(
            preview["render"]["packet"]["bounds"],
            serde_json::json!([1.0, 1.0, 10.0, 4.0, 3.0, 12.0])
        );
        assert_eq!(broken.semantic_hash().unwrap(), broken_hash);
        assert_eq!(
            broken.engine.document().transactions.len(),
            broken_history_len
        );

        let stale_basis = serde_json::json!({
            "transaction_id": "transaction:s4-repair-stale-basis",
            "selected": replacement.id,
            "observed": [replacement.clone()],
            "base_document_hash": "stale",
            "base_revision": preview["base_revision"],
        });
        assert!(
            broken
                .explicit_rebind_json(&stale_basis.to_string())
                .is_err()
        );
        assert_eq!(broken.semantic_hash().unwrap(), broken_hash);

        for invalid in [
            {
                let mut candidate = replacement.clone();
                candidate.id = TopologyReferenceId::from("topology:s4-repair-wrong-kind");
                candidate.kind = TopologyKind::Edge;
                candidate
            },
            {
                let mut candidate = replacement.clone();
                candidate.id = TopologyReferenceId::from("topology:s4-repair-cross-owner");
                candidate.body = BodyId::from("body:other-owner");
                candidate.producer = FeatureId::from("feature:other-owner");
                candidate
            },
        ] {
            let invalid_request = serde_json::json!({
                "transaction_id": format!("transaction:reject:{}", invalid.id.0),
                "selected": invalid.id,
                "observed": [invalid],
                "base_document_hash": preview["base_document_hash"],
                "base_revision": preview["base_revision"],
            });
            assert!(
                broken
                    .explicit_rebind_json(&invalid_request.to_string())
                    .is_err()
            );
            assert_eq!(broken.semantic_hash().unwrap(), broken_hash);
            assert_eq!(
                broken.engine.document().transactions.len(),
                broken_history_len
            );
        }

        let repaired: serde_json::Value = serde_json::from_str(
            &broken
                .explicit_rebind_json(
                    &serde_json::json!({
                        "transaction_id": "transaction:s4-repair-accept",
                        "selected": replacement.id,
                        "observed": [replacement],
                        "base_document_hash": preview["base_document_hash"],
                        "base_revision": preview["base_revision"],
                    })
                    .to_string(),
                )
                .unwrap(),
        )
        .unwrap();
        assert_eq!(repaired["accepted"], true, "{repaired:#}");
        let repaired_hash = broken.semantic_hash().unwrap();
        assert_ne!(repaired_hash, broken_hash);
        let repaired_document = broken.engine.document();
        let repair_transaction = repaired_document.transactions.last().unwrap();
        assert_eq!(repair_transaction.id.0, "transaction:s4-repair-accept");
        assert_eq!(repair_transaction.changes.len(), 2);
        assert!(matches!(
            &repair_transaction.changes[0],
            DocumentChange::RebindTopology {
                feature,
                input_name,
                from_reference,
                replacement,
            } if feature == &FeatureId::from("feature:sketch:s4-repair-profile")
                && input_name == "support"
                && from_reference == &original_reference_id
                && replacement.id == TopologyReferenceId::from("topology:s4-repair-current-top")
        ));
        assert!(matches!(
            &repair_transaction.changes[1],
            DocumentChange::AcceptFeatureResult { feature, body, .. }
                if feature == &feature_id && body == &body_id
        ));
        assert!(repaired_document.features.contains_key(&feature_id));
        assert!(repaired_document.bodies.contains_key(&body_id));
        assert!(repaired_document.sketches.contains_key(&sketch_id));
        let repaired_definition = &repaired_document.feature_definitions_v2[&feature_id];
        match &repaired_definition.operation {
            crawler_document::FeatureOperationV2::Extrude {
                profile,
                support: PlanarSupportReferenceV2::TopologyFace { reference },
                ..
            } => {
                assert_eq!(profile, &original_profile);
                assert_eq!(
                    reference,
                    &TopologyReferenceId::from("topology:s4-repair-current-top")
                );
            }
            _ => panic!("repair must preserve a topology-supported Extrude"),
        }
        assert_eq!(
            repaired_document.sketches[&sketch_id].support,
            crawler_document::SketchSupport::Topology {
                reference: TopologyReferenceId::from("topology:s4-repair-current-top")
            }
        );
        assert_eq!(
            repaired_document.features[&feature_id].inputs["support"],
            FeatureInput::Topology(TopologyReferenceId::from("topology:s4-repair-current-top"))
        );
        let active: serde_json::Value =
            serde_json::from_str(&broken.active_body_json(0.01).unwrap()).unwrap();
        assert_eq!(active["body"]["body_id"], body_id.0);
        assert_eq!(
            active["render"]["packet"]["bounds"],
            serde_json::json!([1.0, 1.0, 10.0, 4.0, 3.0, 12.0])
        );

        assert_eq!(broken.undo().unwrap(), broken_hash);
        assert!(matches!(
            &broken.engine.document().feature_definitions_v2[&feature_id].operation,
            crawler_document::FeatureOperationV2::Extrude {
                support: PlanarSupportReferenceV2::TopologyFace { reference },
                ..
            } if reference == &original_reference_id
        ));
        assert_eq!(broken.redo().unwrap(), repaired_hash);
        assert!(matches!(
            &broken.engine.document().feature_definitions_v2[&feature_id].operation,
            crawler_document::FeatureOperationV2::Extrude {
                support: PlanarSupportReferenceV2::TopologyFace { reference },
                ..
            } if reference == &TopologyReferenceId::from("topology:s4-repair-current-top")
        ));

        let repaired_json = broken.document_json().unwrap();
        let before_recompute = broken
            .accepted_unsuppressed_body_snapshot(&body_id.0)
            .unwrap()
            .unwrap()
            .1;
        let mut reopened = PartRuntime::from_document_json(&repaired_json).unwrap();
        assert_eq!(reopened.document_json().unwrap(), repaired_json);
        let recomputed: serde_json::Value =
            serde_json::from_str(&reopened.recompute_from_here_json(&feature_id.0).unwrap())
                .unwrap();
        assert_eq!(recomputed["accepted"], true, "{recomputed:#}");
        let after_recompute = reopened
            .accepted_unsuppressed_body_snapshot(&body_id.0)
            .unwrap()
            .unwrap()
            .1;
        assert_eq!(after_recompute, before_recompute);
    }

    #[test]
    fn repair_recompute_second_hop_consumes_the_immediately_staged_snapshot() {
        let runtime = runtime();
        let base = runtime.base_body_snapshot().unwrap();
        let first_request = FeatureRequest {
            schema_version: crawler_feature_kernel::FEATURE_KERNEL_SCHEMA_VERSION,
            document_id: runtime.engine.document().id.0.clone(),
            feature_id: "feature:repair-hop-1".into(),
            output_body_id: "body:repair-hop-1".into(),
            operation: FeatureOperation::Transform(crawler_feature_kernel::TransformInput {
                source: crawler_feature_kernel::TransformSource::Body { body: base.clone() },
                translation_nm: [1_000_000, 0, 0],
                tolerance_nm: 10_000,
            }),
        };
        let mut snapshots = BTreeMap::from([(base.body_id.clone(), base)]);
        let first =
            execute_feature(&rebind_request_snapshots(first_request, &snapshots).unwrap()).unwrap();
        snapshots.insert(first.output.body_id.clone(), first.output.clone());

        let mut stale_placeholder = first.output.clone();
        stale_placeholder.solid_json = snapshots[crawler_part_engine::BODY_ID].solid_json.clone();
        stale_placeholder.evidence = snapshots[crawler_part_engine::BODY_ID].evidence.clone();
        assert_ne!(stale_placeholder, first.output);
        let second_request = FeatureRequest {
            schema_version: crawler_feature_kernel::FEATURE_KERNEL_SCHEMA_VERSION,
            document_id: runtime.engine.document().id.0.clone(),
            feature_id: "feature:repair-hop-2".into(),
            output_body_id: "body:repair-hop-2".into(),
            operation: FeatureOperation::Transform(crawler_feature_kernel::TransformInput {
                source: crawler_feature_kernel::TransformSource::Body {
                    body: stale_placeholder,
                },
                translation_nm: [0, 1_000_000, 0],
                tolerance_nm: 10_000,
            }),
        };
        let rebound = rebind_request_snapshots(second_request, &snapshots).unwrap();
        let FeatureOperation::Transform(input) = &rebound.operation else {
            panic!("second hop must remain a transform");
        };
        let crawler_feature_kernel::TransformSource::Body {
            body: resolved_body,
        } = &input.source
        else {
            panic!("second hop must retain direct-body semantics");
        };
        assert_eq!(resolved_body, &first.output);
        let second = execute_feature(&rebound).unwrap();
        assert_eq!(
            second.output.evidence.bounds_nm.min,
            [1_000_000, 1_000_000, 0]
        );
        assert_eq!(
            second.output.evidence.bounds_nm.max,
            [11_000_000, 11_000_000, 10_000_000]
        );
    }

    fn commit_test_sketch_source(
        runtime: &mut PartRuntime,
        id: &str,
        plane: &str,
        geometry: serde_json::Value,
    ) -> serde_json::Value {
        commit_test_sketch_source_on_support(
            runtime,
            id,
            serde_json::json!({
                "kind": "origin_plane_reference",
                "plane": format!("origin-plane:{plane}"),
            }),
            geometry,
        )
    }

    fn commit_test_sketch_source_on_support(
        runtime: &mut PartRuntime,
        id: &str,
        support: serde_json::Value,
        geometry: serde_json::Value,
    ) -> serde_json::Value {
        let sketch = serde_json::json!({
            "id": id,
            "revision": 0,
            "geometry": geometry,
            "constraints": {},
        });
        let outcome: serde_json::Value = serde_json::from_str(
            &runtime
                .solve_sketch_json(
                    &serde_json::json!({
                        "transaction_id": format!("transaction:{id}"),
                        "support": support,
                        "sketch": sketch,
                    })
                    .to_string(),
                )
                .unwrap(),
        )
        .unwrap();
        assert_eq!(outcome["accepted"], true, "{outcome:#}");
        serde_json::json!({ "sketch": sketch, "support": support })
    }

    fn rectangle_geometry(id: &str, min: [i64; 2], max: [i64; 2]) -> serde_json::Value {
        serde_json::json!({
            (id): {
                "id": id,
                "geometry": {
                    "kind": "rectangle",
                    "min": { "x_nm": min[0], "y_nm": min[1] },
                    "max": { "x_nm": max[0], "y_nm": max[1] },
                }
            }
        })
    }

    fn line_geometry(id: &str, start: [i64; 2], end: [i64; 2]) -> serde_json::Value {
        serde_json::json!({
            (id): {
                "id": id,
                "geometry": {
                    "kind": "line",
                    "start": { "x_nm": start[0], "y_nm": start[1] },
                    "end": { "x_nm": end[0], "y_nm": end[1] },
                }
            }
        })
    }

    fn assert_prepared_feature_lifecycle(
        runtime: &PartRuntime,
        request: serde_json::Value,
        expected_operation_kind: &str,
        expected_inputs: &[&str],
    ) {
        let before_hash = runtime.semantic_hash().unwrap();
        let before_document = runtime.document_json().unwrap();
        let envelope_json = runtime
            .prepare_sketch_feature_envelope_json(&request.to_string())
            .unwrap();
        let envelope: serde_json::Value = serde_json::from_str(&envelope_json).unwrap();
        assert_eq!(
            envelope["request"]["operation"]["kind"],
            expected_operation_kind
        );
        if matches!(expected_operation_kind, "profile_revolve" | "revolve_cut") {
            let reverse = request["reverse"].as_bool().unwrap_or(false);
            assert!(envelope["feature"]["parameters"]["reverse"].is_string());
            assert!(envelope["feature"]["parameters"].get("divisions").is_none());
            let reverse_definition = envelope["parameter_definitions"]
                .as_array()
                .unwrap()
                .iter()
                .find(|definition| definition["display_name"] == "Reverse")
                .unwrap();
            assert_eq!(reverse_definition["value"]["kind"], "boolean");
            assert_eq!(reverse_definition["value"]["value"], reverse);
            let raw_axis = request["axis_direction_nanometers"].as_array().unwrap();
            let prepared_axis = envelope["request"]["operation"]["axis_direction_nm"]
                .as_array()
                .unwrap();
            for index in 0..3 {
                let component = raw_axis[index].as_i64().unwrap();
                assert_eq!(
                    prepared_axis[index],
                    if reverse { -component } else { component }
                );
            }
        }
        for input in expected_inputs {
            assert!(
                envelope["feature"]["inputs"].get(*input).is_some(),
                "missing {input}: {envelope:#}"
            );
        }
        let preview: serde_json::Value =
            serde_json::from_str(&runtime.preview_feature_json(&envelope_json).unwrap()).unwrap();
        assert_eq!(preview["accepted"], true, "{preview:#}");
        assert!(preview["result"]["output"]["evidence"].is_object());
        assert_eq!(runtime.semantic_hash().unwrap(), before_hash);
        assert_eq!(runtime.document_json().unwrap(), before_document);

        let mut committed_runtime = PartRuntime::from_document_json(&before_document).unwrap();
        let committed: serde_json::Value = serde_json::from_str(
            &committed_runtime
                .execute_new_feature_json(&envelope_json)
                .unwrap(),
        )
        .unwrap();
        assert_eq!(committed["accepted"], true, "{committed:#}");
        let feature_id = request["feature_id"].as_str().unwrap();
        assert!(
            committed_runtime
                .engine
                .document()
                .features
                .contains_key(&FeatureId::from(feature_id))
        );

        let saved = committed_runtime.document_json().unwrap();
        let mut restored = PartRuntime::from_document_json(&saved).unwrap();
        assert_eq!(restored.document_json().unwrap(), saved);
        if matches!(expected_operation_kind, "profile_revolve" | "revolve_cut") {
            let reverse_parameter: ParameterId =
                serde_json::from_value(envelope["feature"]["parameters"]["reverse"].clone())
                    .unwrap();
            assert_eq!(
                restored.engine.document().parameters[&reverse_parameter].value,
                ParameterValue::Boolean(request["reverse"].as_bool().unwrap_or(false))
            );
        }
        let mut edit_envelope = envelope;
        edit_envelope["transaction_id"] =
            serde_json::json!(format!("transaction:{feature_id}:edit"));
        let edited: serde_json::Value = serde_json::from_str(
            &restored
                .execute_feature_json(&edit_envelope.to_string())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(edited["accepted"], true, "{edited:#}");
    }

    #[test]
    fn snapshots_are_canonical_and_authoritative() {
        let runtime = runtime();
        assert!(runtime.document_json().unwrap().ends_with('\n'));
        assert_eq!(runtime.dimensions().unwrap().bounds().1, [10_000_000; 3]);
    }

    #[test]
    fn one_parameter_commit_reports_minimum_recompute_and_supports_undo() {
        let mut runtime = runtime();
        let before = runtime.semantic_hash().unwrap();
        let outcome: serde_json::Value = serde_json::from_str(
            &runtime
                .commit_length("parameter:distance", 25_000_000)
                .unwrap(),
        )
        .unwrap();
        assert_eq!(outcome["dimensions"]["distance_nanometers"], 25_000_000);
        assert_eq!(
            outcome["dirty_roots"],
            serde_json::json!(["feature:extrude"])
        );
        assert_eq!(runtime.undo().unwrap(), before);
        assert_ne!(runtime.redo().unwrap(), before);
    }

    #[test]
    fn invalid_commit_preserves_the_accepted_hash() {
        let mut runtime = runtime();
        let before = runtime.semantic_hash().unwrap();
        assert!(runtime.commit_length("parameter:missing", 1).is_err());
        assert_eq!(runtime.semantic_hash().unwrap(), before);
    }

    #[test]
    fn canonical_snapshot_restores_the_same_document_and_dimensions() {
        let mut original = runtime();
        original
            .commit_length("parameter:width", 42_000_000)
            .unwrap();
        let json = original.document_json().unwrap();
        let mut restored = PartRuntime::from_document_json(&json).unwrap();

        assert_eq!(restored.document_json().unwrap(), json);
        assert_eq!(
            restored.semantic_hash().unwrap(),
            original.semantic_hash().unwrap()
        );
        assert_eq!(
            restored.dimensions().unwrap(),
            original.dimensions().unwrap()
        );
        assert!(matches!(restored.undo(), Err(EngineError::NothingToUndo)));
    }

    #[test]
    fn legacy_document_json_is_migrated_before_acceptance() {
        let original = runtime();
        let mut legacy: serde_json::Value =
            serde_json::from_str(&original.document_json().unwrap()).unwrap();
        legacy["schema_version"] = serde_json::json!(0);
        legacy["units"] = serde_json::json!({ "length": "millimeter", "angle": "degree" });
        let restored = PartRuntime::from_document_json(&legacy.to_string()).unwrap();
        assert_eq!(
            restored.dimensions().unwrap(),
            original.dimensions().unwrap()
        );
        let migrated: Document = serde_json::from_str(&restored.document_json().unwrap()).unwrap();
        assert_eq!(migrated.schema_version.get(), 1);
    }

    #[test]
    fn exports_are_deterministic_and_do_not_mutate_runtime_history() {
        let runtime = runtime();
        let before_hash = runtime.semantic_hash().unwrap();
        let before_json = runtime.document_json().unwrap();
        let step = runtime.export_text(ExportFormat::Step).unwrap();
        let stl = runtime.export_text(ExportFormat::Stl).unwrap();
        let obj = runtime.export_text(ExportFormat::Obj).unwrap();

        assert!(step.starts_with("ISO-10303-21;"));
        assert!(stl.starts_with("solid CrawlerPart"));
        assert!(obj.starts_with("# Crawler accepted part result"));
        assert_eq!(runtime.export_text(ExportFormat::Step).unwrap(), step);
        assert_eq!(runtime.semantic_hash().unwrap(), before_hash);
        assert_eq!(runtime.document_json().unwrap(), before_json);
    }

    #[test]
    fn portable_part_zip_is_deterministic_and_restores_the_accepted_document() {
        let mut original = runtime();
        original
            .commit_length("parameter:height", 31_500_000)
            .unwrap();
        let before_hash = original.semantic_hash().unwrap();
        let first = original.export_portable_package().unwrap();
        let second = original.export_portable_package().unwrap();
        assert_eq!(first, second);
        assert!(first.starts_with(b"PK\x03\x04"));

        let mut restored = PartRuntime::from_portable_package(&first).unwrap();
        assert_eq!(restored.semantic_hash().unwrap(), before_hash);
        assert_eq!(
            restored.document_json().unwrap(),
            original.document_json().unwrap()
        );
        assert!(matches!(restored.undo(), Err(EngineError::NothingToUndo)));
    }

    #[test]
    fn malformed_portable_part_never_replaces_an_existing_runtime() {
        let original = runtime();
        let before_hash = original.semantic_hash().unwrap();
        assert!(PartRuntime::from_portable_package(b"not a ZIP").is_err());
        assert_eq!(original.semantic_hash().unwrap(), before_hash);
    }

    #[test]
    fn m2_document_changes_are_atomic_undoable_and_package_durable() {
        let mut runtime = runtime();
        let mut sketch = runtime.engine.document().sketches
            [&SketchId::from(crawler_part_engine::RECTANGLE_SKETCH_ID)]
            .clone();
        sketch.elements.push(SketchElement::Circle {
            id: "circle:detail".into(),
            center_nanometers: [5_000_000, 5_000_000],
            radius_nanometers: 1_000_000,
            construction: false,
        });
        let feature = Feature {
            id: FeatureId::from("feature:detail"),
            display_name: "Detail".into(),
            component: ComponentId::from(crawler_part_engine::ROOT_COMPONENT_ID),
            operation: OperationReference {
                schema_id: "crawler.operation.detail".into(),
                schema_version: 1,
            },
            dependencies: vec![FeatureId::from(crawler_part_engine::EXTRUDE_FEATURE_ID)],
            inputs: BTreeMap::new(),
            parameters: BTreeMap::new(),
            suppressed: false,
        };
        let request = serde_json::json!({
            "transaction_id": "transaction:m2",
            "changes": [
                { "kind": "upsert_sketch", "sketch": sketch },
                { "kind": "create_feature", "feature": feature, "before": null },
                {
                    "kind": "group_features",
                    "group_id": "group:details",
                    "display_name": "Details",
                    "features": ["feature:detail"]
                },
                {
                    "kind": "set_body_visibility",
                    "body": crawler_part_engine::BODY_ID,
                    "visibility": "hidden"
                },
                {
                    "kind": "set_parameter_expression",
                    "parameter": crawler_part_engine::WIDTH_PARAMETER_ID,
                    "expression": {
                        "source": "12 mm",
                        "root": { "kind": "literal", "value": { "kind": "length_nanometers", "value": 12000000 } }
                    },
                    "evaluated_value": { "kind": "length_nanometers", "value": 12000000 }
                }
            ]
        });
        let before = runtime.semantic_hash().unwrap();
        runtime.commit_changes_json(&request.to_string()).unwrap();
        let accepted: Document = serde_json::from_str(&runtime.document_json().unwrap()).unwrap();
        assert_eq!(
            accepted.bodies[&BodyId::from(crawler_part_engine::BODY_ID)].visibility,
            ModelVisibility::Hidden
        );
        assert!(
            accepted
                .features
                .contains_key(&FeatureId::from("feature:detail"))
        );
        assert!(accepted.sketches[&SketchId::from(crawler_part_engine::RECTANGLE_SKETCH_ID)]
            .elements
            .iter()
            .any(|element| matches!(element, SketchElement::Circle { id, .. } if id == "circle:detail")));
        assert_eq!(runtime.dimensions().unwrap().width_nanometers, 12_000_000);
        assert_eq!(runtime.undo().unwrap(), before);
        runtime.redo().unwrap();

        let package = runtime.export_portable_package().unwrap();
        let restored = PartRuntime::from_portable_package(&package).unwrap();
        assert_eq!(
            restored.document_json().unwrap(),
            runtime.document_json().unwrap()
        );

        let last = accepted.transactions.last().unwrap();
        assert!(matches!(
            &last.changes[4],
            DocumentChange::SetParameterExpression {
                expression: ParameterExpression {
                    root: ParameterExpressionNode::Literal {
                        value: ParameterValue::LengthNanometers(12_000_000)
                    },
                    ..
                },
                ..
            }
        ));
    }

    #[test]
    fn rollback_is_not_undo_and_render_packet_has_kernel_topology_ids() {
        let mut runtime = runtime();
        let hash = runtime.semantic_hash().unwrap();
        runtime
            .set_timeline_rollback(r#"{"kind":"after","feature":"feature:rectangle-sketch"}"#)
            .unwrap();
        assert_eq!(runtime.semantic_hash().unwrap(), hash);
        assert!(matches!(runtime.undo(), Err(EngineError::NothingToUndo)));

        let packet: serde_json::Value =
            serde_json::from_str(&runtime.render_packet_json(0.01).unwrap()).unwrap();
        assert!(packet["body_id"].is_null());
        assert_eq!(packet["packet"]["bounds"], serde_json::json!([]));
        let pick_table = packet["packet"]["pickTable"].as_array().unwrap();
        assert!(pick_table.is_empty());

        runtime.set_timeline_rollback(r#"{"kind":"end"}"#).unwrap();
        let packet: serde_json::Value =
            serde_json::from_str(&runtime.render_packet_json(0.01).unwrap()).unwrap();
        assert_eq!(packet["body_id"], crawler_part_engine::BODY_ID);
        assert_eq!(
            packet["packet"]["bounds"],
            serde_json::json!([0.0, 0.0, 0.0, 10.0, 10.0, 10.0])
        );
    }

    #[test]
    fn base_extrude_exposes_an_exact_kernel_snapshot_after_parameter_edits() {
        let mut runtime = runtime();
        runtime
            .commit_length("parameter:distance", 24_000_000)
            .unwrap();
        let active: serde_json::Value =
            serde_json::from_str(&runtime.active_body_json(0.01).unwrap()).unwrap();
        assert_eq!(active["kind"], "base_part");
        assert_eq!(
            active["feature_id"],
            crawler_part_engine::EXTRUDE_FEATURE_ID
        );
        assert_eq!(active["body"]["body_id"], crawler_part_engine::BODY_ID);
        assert_eq!(
            active["body"]["evidence"]["bounds_nm"]["max"],
            serde_json::json!([10_000_000, 10_000_000, 24_000_000])
        );
        assert!(!active["body"]["solid_json"].as_array().unwrap().is_empty());

        let lookup: serde_json::Value = serde_json::from_str(
            &runtime
                .body_snapshot_json(crawler_part_engine::BODY_ID)
                .unwrap(),
        )
        .unwrap();
        assert_eq!(lookup["found"], true);
        assert_eq!(
            lookup["feature_id"],
            crawler_part_engine::EXTRUDE_FEATURE_ID
        );
        assert_eq!(lookup["body"], active["body"]);
    }

    #[test]
    fn history_services_repair_recompute_group_and_reorder_are_explicit() {
        let mut runtime = runtime();
        let detail = Feature {
            id: FeatureId::from("feature:topology-detail"),
            display_name: "Topology detail".into(),
            component: "component:root".into(),
            operation: crawler_document::OperationReference {
                schema_id: "crawler.operation.detail".into(),
                schema_version: 1,
            },
            dependencies: vec![FeatureId::from("feature:extrude")],
            inputs: BTreeMap::from([(
                "target".into(),
                crawler_document::FeatureInput::Topology("topology:extrude-top".into()),
            )]),
            parameters: BTreeMap::new(),
            suppressed: false,
        };
        runtime
            .commit_changes_json(
                &serde_json::json!({
                    "transaction_id": "transaction:history:create",
                    "changes": [{ "kind": "create_feature", "feature": detail, "before": null }]
                })
                .to_string(),
            )
            .unwrap();

        let services: serde_json::Value =
            serde_json::from_str(&runtime.feature_services_json("feature:extrude").unwrap())
                .unwrap();
        assert_eq!(
            services["relationships"]["direct_consumers"],
            serde_json::json!(["feature:topology-detail"])
        );
        let before_recompute = runtime.semantic_hash().unwrap();
        let recompute: serde_json::Value =
            serde_json::from_str(&runtime.recompute_from_here_json("feature:extrude").unwrap())
                .unwrap();
        assert!(
            recompute["plan"]["evaluation_order"]
                .as_array()
                .unwrap()
                .iter()
                .any(|feature| feature == "feature:topology-detail")
        );
        assert_ne!(
            recompute["diagnostics"]["features"]
                .as_array()
                .unwrap()
                .len(),
            0
        );
        assert_eq!(recompute["accepted"], true);
        assert!(recompute["transaction"].is_object());
        assert_ne!(runtime.semantic_hash().unwrap(), before_recompute);

        let document: crawler_document::Document =
            serde_json::from_str(&runtime.document_json().unwrap()).unwrap();
        let mut candidate = document.topology_references
            [&crawler_document::TopologyReferenceId::from("topology:extrude-top")]
            .clone();
        candidate.id = "topology:repair-candidate".into();
        let current: Solid =
            serde_json::from_slice(&runtime.base_body_snapshot().unwrap().solid_json).unwrap();
        candidate.stable_kernel_id = face_id_on_coordinate(&current, 2, 10.0);
        candidate.stable_token = "repair:candidate".into();
        let observed = serde_json::to_string(&vec![candidate.clone()]).unwrap();
        let inspection: serde_json::Value =
            serde_json::from_str(&runtime.repair_inspection_json(&observed).unwrap()).unwrap();
        assert_eq!(inspection["status"], "evaluation_blocked");
        assert_eq!(
            inspection["preview"]["candidates"][0]["candidate"]["id"],
            candidate.id.0
        );
        let before_repair = runtime.semantic_hash().unwrap();
        let before_repair_revision = runtime.engine.document().revision;
        let accepted: serde_json::Value = serde_json::from_str(
            &runtime
                .explicit_rebind_json(
                    &serde_json::json!({
                        "transaction_id": "transaction:history:repair",
                        "selected": candidate.id,
                        "observed": [candidate],
                        "base_document_hash": before_repair,
                        "base_revision": before_repair_revision,
                    })
                    .to_string(),
                )
                .unwrap(),
        )
        .unwrap();
        assert_eq!(accepted["accepted"], true);
        let after_repair = runtime.semantic_hash().unwrap();
        assert_ne!(after_repair, before_repair);
        assert_eq!(runtime.undo().unwrap(), before_repair);
        assert_eq!(runtime.redo().unwrap(), after_repair);

        runtime
            .commit_changes_json(
                r#"{"transaction_id":"transaction:history:group","changes":[{"kind":"group_features","group_id":"group:base","display_name":"Base","features":["feature:rectangle-sketch","feature:extrude"]}]}"#,
            )
            .unwrap();
        let before_bad_reorder = runtime.semantic_hash().unwrap();
        assert!(runtime
            .commit_changes_json(
                r#"{"transaction_id":"transaction:history:bad-reorder","changes":[{"kind":"reorder_feature","component":"component:root","feature":"feature:extrude","before":"feature:rectangle-sketch"}]}"#,
            )
            .is_err());
        assert_eq!(runtime.semantic_hash().unwrap(), before_bad_reorder);
    }

    #[test]
    fn sketch_solver_commits_feasible_geometry_and_rejects_conflicts_atomically() {
        let mut runtime = runtime();
        let feasible = serde_json::json!({
            "transaction_id": "transaction:solve-detail",
            "support": { "kind": "origin_plane_reference", "plane": "origin-plane:xy" },
            "sketch": {
                "id": crawler_part_engine::RECTANGLE_SKETCH_ID,
                "revision": 0,
                "geometry": {
                    "detail:line": {
                        "id": "detail:line",
                        "geometry": { "kind": "line", "start": { "x_nm": 0, "y_nm": 2000000 }, "end": { "x_nm": 1000000, "y_nm": 2000001 } }
                    }
                },
                "constraints": {
                    "detail:horizontal": { "kind": "horizontal", "line": "detail:line" }
                }
            }
        });
        let result: serde_json::Value =
            serde_json::from_str(&runtime.solve_sketch_json(&feasible.to_string()).unwrap())
                .unwrap();
        assert_eq!(result["accepted"], true);
        assert!(
            runtime
                .document_json()
                .unwrap()
                .contains("apply_sketch_solution")
        );
        assert!(runtime.document_json().unwrap().contains("detail:line"));
        assert_eq!(
            runtime.engine.document().sketches
                [&crawler_document::SketchId::from(crawler_part_engine::RECTANGLE_SKETCH_ID)]
                .support,
            crawler_document::SketchSupport::OriginPlaneReference {
                plane: crawler_document::OriginPlaneId::from("origin-plane:xy")
            }
        );

        let before_conflict = runtime.semantic_hash().unwrap();
        let conflicting = serde_json::json!({
            "transaction_id": "transaction:conflict",
            "sketch": {
                "id": crawler_part_engine::RECTANGLE_SKETCH_ID,
                "revision": 0,
                "geometry": {
                    "conflict:line": {
                        "id": "conflict:line",
                        "geometry": { "kind": "line", "start": { "x_nm": 0, "y_nm": 0 }, "end": { "x_nm": 1000000, "y_nm": 1000000 } }
                    }
                },
                "constraints": {
                    "conflict:h": { "kind": "horizontal", "line": "conflict:line" },
                    "conflict:v": { "kind": "vertical", "line": "conflict:line" }
                }
            }
        });
        let result: serde_json::Value =
            serde_json::from_str(&runtime.solve_sketch_json(&conflicting.to_string()).unwrap())
                .unwrap();
        assert_eq!(result["accepted"], false);
        assert_eq!(runtime.semantic_hash().unwrap(), before_conflict);
    }

    #[test]
    fn native_spline_commit_and_reload_preserve_control_point_identity() {
        let mut runtime = runtime();
        let request = serde_json::json!({
            "transaction_id": "transaction:native-spline",
            "support": { "kind": "origin_plane_reference", "plane": "origin-plane:xz" },
            "sketch": {
                "id": crawler_part_engine::RECTANGLE_SKETCH_ID,
                "revision": 4,
                "geometry": {
                    "spline:detail": {
                        "id": "spline:detail",
                        "geometry": {
                            "kind": "control_point_spline",
                            "degree": 3,
                            "knots_millionths": [0, 0, 0, 0, 500000, 1000000, 1000000, 1000000, 1000000],
                            "control_points": [
                                { "x_nm": 0, "y_nm": 0 },
                                { "x_nm": 1000000, "y_nm": 2000000 },
                                { "x_nm": 2000000, "y_nm": -1000000 },
                                { "x_nm": 3000000, "y_nm": 1000000 },
                                { "x_nm": 4000000, "y_nm": 0 }
                            ]
                        }
                    }
                },
                "constraints": {
                    "constraint:spline-origin": {
                        "kind": "point_on_origin",
                        "point": { "geometry": "spline:detail", "anchor": "control:0" }
                    }
                }
            }
        });
        let result: serde_json::Value =
            serde_json::from_str(&runtime.solve_sketch_json(&request.to_string()).unwrap())
                .unwrap();
        assert_eq!(result["accepted"], true);
        let document = runtime.document_json().unwrap();
        assert!(document.contains("control_point_spline"));
        assert!(document.contains("knots_millionths"));
        assert!(document.contains("spline:detail#control:0"));
        let restored = PartRuntime::from_document_json(&document).unwrap();
        assert_eq!(restored.document_json().unwrap(), document);
    }

    #[test]
    fn remaining_native_sketch_geometry_commits_and_reloads_without_expansion() {
        let mut runtime = runtime();
        let request = serde_json::json!({
            "transaction_id": "transaction:native-geometry",
            "support": { "kind": "origin_plane_reference", "plane": "origin-plane:xy" },
            "sketch": {
                "id": crawler_part_engine::RECTANGLE_SKETCH_ID,
                "revision": 7,
                "geometry": {
                    "fit:a": { "id": "fit:a", "geometry": { "kind": "fit_point_spline", "fit_points": [{"x_nm":0,"y_nm":0},{"x_nm":1000000,"y_nm":2000000},{"x_nm":2000000,"y_nm":-1000000},{"x_nm":3000000,"y_nm":0}] } },
                    "ellipse:a": { "id": "ellipse:a", "geometry": { "kind": "ellipse", "center":{"x_nm":5000000,"y_nm":5000000}, "major":{"x_nm":7000000,"y_nm":5000000}, "minor":{"x_nm":5000000,"y_nm":6000000} } },
                    "elliptical-arc:a": { "id": "elliptical-arc:a", "geometry": { "kind": "elliptical_arc", "center":{"x_nm":10000000,"y_nm":5000000}, "major":{"x_nm":12000000,"y_nm":5000000}, "minor":{"x_nm":10000000,"y_nm":6000000}, "start":{"x_nm":12000000,"y_nm":5000000}, "end":{"x_nm":10000000,"y_nm":6000000}, "clockwise":false } },
                    "conic:a": { "id": "conic:a", "geometry": { "kind": "conic", "start":{"x_nm":0,"y_nm":10000000}, "control":{"x_nm":2000000,"y_nm":12000000}, "end":{"x_nm":4000000,"y_nm":10000000}, "weight_millionths":707107 } },
                    "point:a": { "id": "point:a", "geometry": { "kind": "sketch_point", "x_nm":0, "y_nm":0 } }
                },
                "constraints": {
                    "constraint:fit": { "kind": "fixed", "point": { "geometry": "fit:a", "anchor": "fit:0" }, "x_nm": 0, "y_nm": 0 },
                    "constraint:major": { "kind": "fixed", "point": { "geometry": "ellipse:a", "anchor": "major" }, "x_nm": 7000000, "y_nm": 5000000 },
                    "constraint:elliptical-arc-start": { "kind": "fixed", "point": { "geometry": "elliptical-arc:a", "anchor": "start" }, "x_nm": 12000000, "y_nm": 5000000 },
                    "constraint:control": { "kind": "fixed", "point": { "geometry": "conic:a", "anchor": "control" }, "x_nm": 2000000, "y_nm": 12000000 },
                    "constraint:point-origin": { "kind": "point_on_origin", "point": { "geometry": "point:a", "anchor": "position" } }
                }
            }
        });
        let result: serde_json::Value =
            serde_json::from_str(&runtime.solve_sketch_json(&request.to_string()).unwrap())
                .unwrap();
        assert_eq!(result["accepted"], true);
        let document = runtime.document_json().unwrap();
        for kind in [
            "fit_point_spline",
            "ellipse",
            "elliptical_arc",
            "conic",
            "sketch_point",
        ] {
            assert!(document.contains(kind));
        }
        assert!(document.contains("fit:a#fit:0"));
        assert!(document.contains("elliptical-arc:a#start"));
        assert!(document.contains("ellipse:a#major"));
        assert!(document.contains("conic:a#control"));
        assert!(document.contains("point:a#position"));
        let restored = PartRuntime::from_document_json(&document).unwrap();
        assert_eq!(restored.document_json().unwrap(), document);
    }

    #[test]
    fn sketch_solver_persists_each_addressable_origin_plane_support() {
        for plane in ["xy", "xz", "yz"] {
            let mut runtime = runtime();
            let result: serde_json::Value = serde_json::from_str(
                &runtime
                    .solve_sketch_json(
                        &serde_json::json!({
                            "transaction_id": format!("transaction:plane:{plane}"),
                            "support": {
                                "kind": "origin_plane_reference",
                                "plane": format!("origin-plane:{plane}")
                            },
                            "sketch": {
                                "id": crawler_part_engine::RECTANGLE_SKETCH_ID,
                                "revision": 0,
                                "geometry": {},
                                "constraints": {}
                            }
                        })
                        .to_string(),
                    )
                    .unwrap(),
            )
            .unwrap();
            assert_eq!(result["accepted"], true);
            assert_eq!(
                runtime.engine.document().sketches
                    [&crawler_document::SketchId::from(crawler_part_engine::RECTANGLE_SKETCH_ID)]
                    .support,
                crawler_document::SketchSupport::OriginPlaneReference {
                    plane: crawler_document::OriginPlaneId::from(
                        format!("origin-plane:{plane}").as_str()
                    )
                }
            );
            if plane != "xy" {
                runtime.undo().unwrap();
                assert_eq!(
                    runtime.engine.document().sketches[&crawler_document::SketchId::from(
                        crawler_part_engine::RECTANGLE_SKETCH_ID
                    )]
                        .support,
                    crawler_document::SketchSupport::OriginPlaneReference {
                        plane: crawler_document::OriginPlaneId::from("origin-plane:xy")
                    }
                );
                runtime.redo().unwrap();
                assert_eq!(
                    runtime.engine.document().sketches[&crawler_document::SketchId::from(
                        crawler_part_engine::RECTANGLE_SKETCH_ID
                    )]
                        .support,
                    crawler_document::SketchSupport::OriginPlaneReference {
                        plane: crawler_document::OriginPlaneId::from(
                            format!("origin-plane:{plane}").as_str()
                        )
                    }
                );
            }
        }
    }

    #[test]
    fn sketch_solver_atomically_creates_a_planar_face_sketch_and_reference() {
        let mut runtime = runtime();
        let before = runtime.semantic_hash().unwrap();
        let request = serde_json::json!({
            "transaction_id": "transaction:new-face-sketch",
            "support": { "kind": "topology", "reference": "topology:sketch-face:body:part:26" },
            "support_reference": {
                "schema_version": 1,
                "id": "topology:sketch-face:body:part:26",
                "component": "component:root",
                "body": "body:part",
                "producer": "feature:extrude",
                "kind": "face",
                "stable_kernel_id": "26",
                "stable_token": "sketch-face:26",
                "fallback_signature": {
                    "kind": "face",
                    "centroid_nanometers": [5000000, 5000000, 10000000],
                    "normal_millionths": [0, 0, 1000000],
                    "area_square_nanometers": 100000000000000_u64
                }
            },
            "sketch": {
                "id": "sketch:face-detail",
                "revision": 0,
                "geometry": {
                    "line:face": {
                        "id": "line:face",
                        "geometry": { "kind": "line", "start": { "x_nm": 0, "y_nm": 0 }, "end": { "x_nm": 4000000, "y_nm": 0 } }
                    }
                },
                "constraints": {}
            }
        });
        let result: serde_json::Value =
            serde_json::from_str(&runtime.solve_sketch_json(&request.to_string()).unwrap())
                .unwrap();
        assert_eq!(result["accepted"], true);
        assert_eq!(result["sketch_id"], "sketch:face-detail");
        let document = runtime.engine.document();
        assert!(document.sketches.contains_key(&"sketch:face-detail".into()));
        assert!(
            document
                .topology_references
                .contains_key(&"topology:sketch-face:body:part:26".into())
        );
        let sketch_id = SketchId::from("sketch:face-detail");
        let feature_id = FeatureId::from("feature:sketch:face-detail");
        let component = &document.components[&document.root_component];
        assert_eq!(component.sketch_order.last(), Some(&sketch_id));
        assert_eq!(component.feature_order.last(), Some(&feature_id));
        let feature = &document.features[&feature_id];
        assert_eq!(feature.display_name, "Sketch 2");
        assert_eq!(
            feature.operation,
            OperationReference {
                schema_id: "crawler.operation.sketch".into(),
                schema_version: 1,
            }
        );
        assert_eq!(
            feature.dependencies,
            vec![FeatureId::from("feature:extrude")]
        );
        assert_eq!(
            feature.inputs,
            BTreeMap::from([
                ("sketch".into(), FeatureInput::Sketch(sketch_id.clone())),
                (
                    "support".into(),
                    FeatureInput::Topology("topology:sketch-face:body:part:26".into()),
                ),
            ])
        );
        assert!(matches!(
            document.recompute.features[&feature_id],
            FeatureRecomputeState::Dirty { since_revision }
                if since_revision == document.revision
        ));
        let accepted_feature = feature.clone();
        assert_eq!(document.transactions.last().unwrap().changes.len(), 3);

        assert_eq!(runtime.undo().unwrap(), before);
        assert!(!runtime.engine.document().features.contains_key(&feature_id));
        assert!(!runtime.engine.document().sketches.contains_key(&sketch_id));
        runtime.redo().unwrap();
        let redone = runtime.engine.document();
        assert_eq!(redone.features[&feature_id], accepted_feature);
        assert!(redone.sketches.contains_key(&sketch_id));
        assert!(
            redone
                .topology_references
                .contains_key(&"topology:sketch-face:body:part:26".into())
        );
        assert_eq!(
            redone.components[&redone.root_component]
                .feature_order
                .last(),
            Some(&feature_id)
        );
    }

    #[test]
    fn sketch_solver_treats_new_sketch_geometry_and_constraints_as_authoritative() {
        let mut runtime =
            PartRuntime::new_blank_part("document:exact-sketch", "Exact Sketch").unwrap();
        let first = serde_json::json!({
            "transaction_id": "transaction:exact-sketch:create",
            "support": { "kind": "origin_plane_reference", "plane": "origin-plane:xy" },
            "sketch": {
                "id": "sketch:exact",
                "revision": 0,
                "geometry": {
                    "line:keep": { "id": "line:keep", "geometry": { "kind": "line", "start": { "x_nm": 0, "y_nm": 0 }, "end": { "x_nm": 4000000, "y_nm": 1000000 } } },
                    "line:delete": { "id": "line:delete", "geometry": { "kind": "line", "start": { "x_nm": 0, "y_nm": 6000000 }, "end": { "x_nm": 4000000, "y_nm": 7000000 } } }
                },
                "constraints": {
                    "constraint:update": { "kind": "horizontal", "line": "line:keep" },
                    "constraint:delete": { "kind": "horizontal", "line": "line:delete" }
                }
            }
        });
        let created: serde_json::Value =
            serde_json::from_str(&runtime.solve_sketch_json(&first.to_string()).unwrap()).unwrap();
        assert_eq!(created["accepted"], true);
        let sketch_id = SketchId::from("sketch:exact");
        let feature_id = FeatureId::from("feature:sketch:exact");
        let document = runtime.engine.document();
        assert_eq!(document.features.len(), 1);
        let feature = &document.features[&feature_id];
        assert_eq!(feature.operation.schema_id, "crawler.operation.sketch");
        assert_eq!(
            feature.inputs.get("sketch"),
            Some(&FeatureInput::Sketch(sketch_id.clone()))
        );
        assert!(feature.dependencies.is_empty());
        assert_eq!(
            document.components[&document.root_component].feature_order,
            vec![feature_id.clone()]
        );
        assert!(matches!(
            document.recompute.features[&feature_id],
            FeatureRecomputeState::Dirty { since_revision }
                if since_revision == document.revision
        ));
        assert_eq!(document.transactions.last().unwrap().changes.len(), 2);

        let second = serde_json::json!({
            "transaction_id": "transaction:exact-sketch:replace",
            "sketch": {
                "id": "sketch:exact",
                "revision": 1,
                "geometry": {
                    "line:keep": { "id": "line:keep", "geometry": { "kind": "line", "start": { "x_nm": 1000000, "y_nm": 0 }, "end": { "x_nm": 2000000, "y_nm": 4000000 } } }
                },
                "constraints": {
                    "constraint:update": { "kind": "vertical", "line": "line:keep" }
                }
            }
        });
        let replaced: serde_json::Value =
            serde_json::from_str(&runtime.solve_sketch_json(&second.to_string()).unwrap()).unwrap();
        assert_eq!(replaced["accepted"], true);
        let sketch = &runtime.engine.document().sketches[&"sketch:exact".into()];
        assert_eq!(sketch.elements.len(), 1);
        assert_eq!(stored_element_id(&sketch.elements[0]), "line:keep");
        assert_eq!(sketch.constraints.len(), 1);
        assert!(matches!(
            &sketch.constraints[0],
            crawler_document::SketchConstraint::Vertical { id, line }
                if id == "constraint:update" && line == "line:keep"
        ));
        assert_eq!(runtime.engine.document().features.len(), 1);
        assert_eq!(
            runtime
                .engine
                .document()
                .transactions
                .last()
                .unwrap()
                .changes
                .len(),
            1
        );

        runtime.undo().unwrap();
        let restored = &runtime.engine.document().sketches[&"sketch:exact".into()];
        assert_eq!(restored.elements.len(), 2);
        assert_eq!(restored.constraints.len(), 2);
        assert!(runtime.engine.document().features.contains_key(&feature_id));
        runtime.redo().unwrap();
        assert_eq!(
            runtime.engine.document().sketches[&"sketch:exact".into()]
                .elements
                .len(),
            1
        );
        assert_eq!(
            runtime.engine.document().components[&runtime.engine.document().root_component]
                .feature_order,
            vec![feature_id]
        );
    }

    #[test]
    fn sketch_dimensions_external_edges_and_suppression_round_trip_durably() {
        let mut runtime = runtime();
        let create = serde_json::json!({
            "transaction_id": "transaction:linked-sketch:create",
            "support": { "kind": "origin_plane_reference", "plane": "origin-plane:xy" },
            "sketch": {
                "id": "sketch:linked",
                "revision": 0,
                "geometry": {
                    "external:edge": { "id": "external:edge", "construction": true, "geometry": { "kind": "line", "start": { "x_nm": 0, "y_nm": 0 }, "end": { "x_nm": 10000000, "y_nm": 0 } } }
                },
                "constraints": {
                    "constraint:length": { "kind": "distance", "a": { "geometry": "external:edge", "anchor": "start" }, "b": { "geometry": "external:edge", "anchor": "end" }, "distance_nm": 10000000 },
                    "constraint:horizontal": { "kind": "horizontal", "line": "external:edge" }
                },
                "external_references": {
                    "external:edge": { "body": "body:part", "stable_kernel_id": "18446744073709551614" }
                },
                "suppressed_constraints": ["constraint:horizontal"]
            }
        });
        let result: serde_json::Value =
            serde_json::from_str(&runtime.solve_sketch_json(&create.to_string()).unwrap()).unwrap();
        assert_eq!(result["accepted"], true);
        let document = runtime.engine.document();
        let sketch = &document.sketches[&SketchId::from("sketch:linked")];
        assert!(matches!(
            &sketch.elements[0],
            crawler_document::SketchElement::ExternalLine { body, stable_kernel_id, .. }
                if body == &crawler_document::BodyId::from("body:part") && *stable_kernel_id == u64::MAX - 1
        ));
        assert!(sketch.constraints.iter().any(|constraint| matches!(
            constraint,
            crawler_document::SketchConstraint::Suppressed { id, constraint }
                if id == "constraint:horizontal" && matches!(constraint.as_ref(), crawler_document::SketchConstraint::Horizontal { .. })
        )));
        let dimension_parameter = ParameterId::from("parameter:sketch:linked:constraint:length");
        assert_eq!(document.parameters[&dimension_parameter].display_name, "d1");
        assert_eq!(
            document.features[&FeatureId::from("feature:sketch:linked")].parameters["d1"],
            dimension_parameter
        );

        let edit = serde_json::json!({
            "transaction_id": "transaction:linked-sketch:edit",
            "sketch": {
                "id": "sketch:linked",
                "revision": 1,
                "geometry": {
                    "external:edge": { "id": "external:edge", "construction": true, "geometry": { "kind": "line", "start": { "x_nm": 0, "y_nm": 0 }, "end": { "x_nm": 20000000, "y_nm": 0 } } }
                },
                "constraints": {
                    "constraint:length": { "kind": "distance", "a": { "geometry": "external:edge", "anchor": "start" }, "b": { "geometry": "external:edge", "anchor": "end" }, "distance_nm": 20000000 },
                    "constraint:horizontal": { "kind": "horizontal", "line": "external:edge" }
                },
                "external_references": {
                    "external:edge": { "body": "body:part", "stable_kernel_id": "18446744073709551614" }
                },
                "suppressed_constraints": ["constraint:horizontal"]
            }
        });
        runtime.solve_sketch_json(&edit.to_string()).unwrap();
        let document = runtime.engine.document();
        assert_eq!(
            document.parameters[&ParameterId::from("parameter:sketch:linked:constraint:length")]
                .value,
            ParameterValue::LengthNanometers(20_000_000)
        );
        assert!(document.transactions.last().unwrap().changes.iter().any(|change| matches!(
            change,
            DocumentChange::SetParameterExpression { parameter, .. }
                if parameter == &ParameterId::from("parameter:sketch:linked:constraint:length")
        )));
        assert!(matches!(
            document.recompute.features[&FeatureId::from("feature:sketch:linked")],
            FeatureRecomputeState::Dirty { .. }
        ));
    }

    #[test]
    fn p0_constraints_and_dimension_parameters_reload_and_edit_durably() {
        let mut runtime = runtime();
        let constraints = serde_json::json!({
            "constraint:horizontal-points": { "kind": "horizontal_points", "a": { "geometry": "point:a", "anchor": "position" }, "b": { "geometry": "point:b", "anchor": "position" } },
            "constraint:vertical-points": { "kind": "vertical_points", "a": { "geometry": "point:a", "anchor": "position" }, "b": { "geometry": "point:b", "anchor": "position" } },
            "constraint:collinear": { "kind": "collinear", "point": { "geometry": "point:a", "anchor": "position" }, "line": "line:axis" },
            "constraint:symmetry": { "kind": "symmetry", "first": { "geometry": "point:a", "anchor": "position" }, "second": { "geometry": "point:b", "anchor": "position" }, "axis": "line:axis" },
            "constraint:curvature": { "kind": "curvature_continuous", "first": "spline:a", "second": "spline:b" },
            "constraint:fixed-geometry": { "kind": "fixed_geometry", "geometry": "ellipse:a" },
            "constraint:point-on-native": { "kind": "point_on_object", "point": { "geometry": "point:a", "anchor": "position" }, "geometry": "ellipse:a" },
            "constraint:distance-x": { "kind": "distance_x", "a": { "geometry": "point:a", "anchor": "position" }, "b": { "geometry": "point:b", "anchor": "position" }, "distance_nm": 8000000 },
            "constraint:distance-y": { "kind": "distance_y", "a": { "geometry": "point:a", "anchor": "position" }, "b": { "geometry": "point:b", "anchor": "position" }, "distance_nm": 4000000 },
            "constraint:point-line": { "kind": "point_line_distance", "point": { "geometry": "point:a", "anchor": "position" }, "line": "line:axis", "distance_nm": 2000000 },
            "constraint:line-distance": { "kind": "line_distance", "first": "line:axis", "second": "line:offset", "distance_nm": 3000000 },
            "constraint:offset": { "kind": "offset_distance", "source": "line:axis", "offset": "line:offset", "distance_nm": 3000000, "source_start_millionths": 0, "source_end_millionths": 1000000 },
            "constraint:diameter": { "kind": "diameter", "geometry": "circle:a", "diameter_nm": 6000000 },
            "constraint:ellipse-major": { "kind": "ellipse_radius", "geometry": "ellipse:a", "axis": "major", "radius_nm": 5000000 }
        });
        let suppressed_constraints = constraints
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        let request = serde_json::json!({
            "transaction_id": "transaction:p0-lifecycle:create",
            "support": { "kind": "origin_plane_reference", "plane": "origin-plane:xy" },
            "sketch": {
                "id": "sketch:p0-lifecycle",
                "revision": 0,
                "geometry": {
                    "point:a": { "id": "point:a", "geometry": { "kind": "sketch_point", "x_nm": -4000000, "y_nm": 2000000 } },
                    "point:b": { "id": "point:b", "geometry": { "kind": "sketch_point", "x_nm": 4000000, "y_nm": 6000000 } },
                    "line:axis": { "id": "line:axis", "geometry": { "kind": "line", "start": { "x_nm": -10000000, "y_nm": 0 }, "end": { "x_nm": 10000000, "y_nm": 0 } } },
                    "line:offset": { "id": "line:offset", "geometry": { "kind": "line", "start": { "x_nm": -10000000, "y_nm": 3000000 }, "end": { "x_nm": 10000000, "y_nm": 3000000 } } },
                    "circle:a": { "id": "circle:a", "geometry": { "kind": "circle", "center": { "x_nm": 15000000, "y_nm": 0 }, "radius_nm": 3000000 } },
                    "ellipse:a": { "id": "ellipse:a", "geometry": { "kind": "ellipse", "center": { "x_nm": 25000000, "y_nm": 0 }, "major": { "x_nm": 30000000, "y_nm": 0 }, "minor": { "x_nm": 25000000, "y_nm": 2000000 } } },
                    "spline:a": { "id": "spline:a", "geometry": { "kind": "control_point_spline", "degree": 3, "knots_millionths": [0,0,0,0,1000000,1000000,1000000,1000000], "control_points": [{"x_nm":0,"y_nm":10000000},{"x_nm":3000000,"y_nm":12000000},{"x_nm":6000000,"y_nm":12000000},{"x_nm":9000000,"y_nm":10000000}] } },
                    "spline:b": { "id": "spline:b", "geometry": { "kind": "control_point_spline", "degree": 3, "knots_millionths": [0,0,0,0,1000000,1000000,1000000,1000000], "control_points": [{"x_nm":9000000,"y_nm":10000000},{"x_nm":12000000,"y_nm":8000000},{"x_nm":15000000,"y_nm":8000000},{"x_nm":18000000,"y_nm":10000000}] } }
                },
                "constraints": constraints,
                "dimension_positions": {
                    "constraint:diameter": { "x_nm": 18000000, "y_nm": 4000000 }
                },
                "recipes": {
                    "recipe:polygon": {
                        "kind": "polygon", "center": { "x_nm": 0, "y_nm": 0 },
                        "radius_nm": 10000000, "sides": 3, "orientation_microdegrees": 0,
                        "geometry": ["line:axis", "line:offset", "spline:a"]
                    }
                },
                "suppressed_constraints": suppressed_constraints
            }
        });
        let result: serde_json::Value =
            serde_json::from_str(&runtime.solve_sketch_json(&request.to_string()).unwrap())
                .unwrap();
        assert_eq!(result["accepted"], true);

        let dimensional = [
            "constraint:distance-x",
            "constraint:distance-y",
            "constraint:point-line",
            "constraint:line-distance",
            "constraint:offset",
            "constraint:diameter",
            "constraint:ellipse-major",
        ];
        let document = runtime.engine.document();
        for id in dimensional {
            let parameter = ParameterId(format!("parameter:sketch:p0-lifecycle:{id}"));
            assert!(
                document.parameters.contains_key(&parameter),
                "missing {parameter:?}"
            );
            assert!(
                document.features[&FeatureId::from("feature:sketch:p0-lifecycle")]
                    .parameters
                    .values()
                    .any(|value| value == &parameter)
            );
        }
        assert_eq!(
            document.sketches[&SketchId::from("sketch:p0-lifecycle")]
                .constraints
                .len(),
            14
        );
        let stored_sketch = &document.sketches[&SketchId::from("sketch:p0-lifecycle")];
        assert_eq!(
            stored_sketch.dimension_positions["constraint:diameter"],
            [18_000_000, 4_000_000]
        );
        assert!(matches!(
            stored_sketch.recipes["recipe:polygon"],
            crawler_document::SketchRecipe::Polygon { sides: 3, .. }
        ));

        let serialized = runtime.document_json().unwrap();
        let mut restored = PartRuntime::from_document_json(&serialized).unwrap();
        assert_eq!(restored.document_json().unwrap(), serialized);
        assert_eq!(
            restored.engine.document().sketches[&SketchId::from("sketch:p0-lifecycle")]
                .dimension_positions["constraint:diameter"],
            [18_000_000, 4_000_000]
        );
        let mut edited = request;
        edited["transaction_id"] = serde_json::json!("transaction:p0-lifecycle:edit");
        edited["sketch"]["revision"] = serde_json::json!(1);
        edited["sketch"]["constraints"]["constraint:diameter"]["diameter_nm"] =
            serde_json::json!(8_000_000);
        let edit_result: serde_json::Value =
            serde_json::from_str(&restored.solve_sketch_json(&edited.to_string()).unwrap())
                .unwrap();
        assert_eq!(edit_result["accepted"], true);
        assert_eq!(
            restored.engine.document().parameters
                [&ParameterId::from("parameter:sketch:p0-lifecycle:constraint:diameter")]
                .value,
            ParameterValue::LengthNanometers(8_000_000)
        );
    }

    #[test]
    fn sketch_command_and_drag_are_preview_only_and_return_diagnostics() {
        let runtime = runtime();
        let before = runtime.semantic_hash().unwrap();
        let sketch = serde_json::json!({
            "id": crawler_part_engine::RECTANGLE_SKETCH_ID,
            "revision": 0,
            "geometry": {
                "line:preview": {
                    "id": "line:preview",
                    "geometry": { "kind": "line", "start": { "x_nm": 0, "y_nm": 0 }, "end": { "x_nm": 1000000, "y_nm": 500000 } }
                }
            },
            "constraints": {}
        });
        let command: serde_json::Value = serde_json::from_str(
            &runtime
                .apply_sketch_command_json(
                    &serde_json::json!({
                        "sketch": sketch,
                        "command": {
                            "kind": "add_constraint",
                            "id": "constraint:horizontal",
                            "constraint": { "kind": "horizontal", "line": "line:preview" }
                        }
                    })
                    .to_string(),
                )
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            command["sketch"]["geometry"]["line:preview"]["geometry"]["end"]["y_nm"],
            0
        );
        assert_eq!(command["solve"]["state"], "under_constrained");
        assert!(command.get("profile").is_some());
        assert_eq!(runtime.semantic_hash().unwrap(), before);

        let batch: serde_json::Value = serde_json::from_str(
            &runtime
                .apply_sketch_commands_json(
                    &serde_json::json!({
                        "sketch": command["sketch"],
                        "commands": [
                            {
                                "kind": "add_geometry",
                                "entity": {
                                    "id": "circle:preview",
                                    "geometry": { "kind": "circle", "center": { "x_nm": 2000000, "y_nm": 0 }, "radius_nm": 250000 }
                                }
                            },
                            { "kind": "set_radius", "geometry": "circle:preview", "radius_nm": 500000 }
                        ]
                    })
                    .to_string(),
                )
                .unwrap(),
        )
        .unwrap();
        assert_eq!(batch["application_count"], 2);
        assert_eq!(
            batch["sketch"]["geometry"]["circle:preview"]["geometry"]["radius_nm"],
            500000
        );
        assert_eq!(runtime.semantic_hash().unwrap(), before);

        let drag: serde_json::Value = serde_json::from_str(
            &runtime
                .drag_sketch_json(
                    &serde_json::json!({
                        "sketch": command["sketch"],
                        "drag": {
                            "point": { "geometry": "line:preview", "anchor": "start" },
                            "target": { "x_nm": 250000, "y_nm": 100000 }
                        }
                    })
                    .to_string(),
                )
                .unwrap(),
        )
        .unwrap();
        assert_eq!(drag["drag"]["accepted"], true);
        assert_eq!(drag["drag"]["resolved"]["x_nm"], 250000);
        assert_eq!(runtime.semantic_hash().unwrap(), before);
    }

    #[test]
    fn retained_sketch_operations_commit_reload_and_remain_editable() {
        let mut runtime = runtime();
        let draft = serde_json::json!({
            "id": crawler_part_engine::RECTANGLE_SKETCH_ID,
            "revision": 0,
            "geometry": {
                "line:source": { "id": "line:source", "geometry": { "kind": "line", "start": { "x_nm": 0, "y_nm": 0 }, "end": { "x_nm": 10000000, "y_nm": 0 } } },
                "line:offset": { "id": "line:offset", "geometry": { "kind": "line", "start": { "x_nm": 0, "y_nm": 2000000 }, "end": { "x_nm": 10000000, "y_nm": 2000000 } } }
            },
            "constraints": {},
            "operations": {
                "operation:offset": { "kind": "offset", "sources": ["line:source"], "result_chains": [["line:offset"]], "distance_nm": 2000000, "two_sided": false, "linked": true }
            }
        });
        let accepted: serde_json::Value = serde_json::from_str(
            &runtime
                .solve_sketch_json(
                    &serde_json::json!({
                        "transaction_id": "transaction:p1-operation",
                        "sketch": draft
                    })
                    .to_string(),
                )
                .unwrap(),
        )
        .unwrap();
        assert_eq!(accepted["accepted"], true);

        let saved = runtime.document_json().unwrap();
        let restored = PartRuntime::from_document_json(&saved).unwrap();
        let document: Document = serde_json::from_str(&restored.document_json().unwrap()).unwrap();
        let persisted = &document.sketches
            [&SketchId::from(crawler_part_engine::RECTANGLE_SKETCH_ID)]
            .operations["operation:offset"];
        assert_eq!(persisted["distance_nm"], 2_000_000);

        let hydrated = serde_json::json!({
            "id": crawler_part_engine::RECTANGLE_SKETCH_ID,
            "revision": 1,
            "geometry": {
                "line:source": { "id": "line:source", "geometry": { "kind": "line", "start": { "x_nm": 0, "y_nm": 0 }, "end": { "x_nm": 10000000, "y_nm": 0 } } },
                "line:offset": { "id": "line:offset", "geometry": { "kind": "line", "start": { "x_nm": 0, "y_nm": 2000000 }, "end": { "x_nm": 10000000, "y_nm": 2000000 } } }
            },
            "constraints": {},
            "operations": { "operation:offset": persisted }
        });
        let edited: serde_json::Value = serde_json::from_str(&restored.apply_sketch_command_json(&serde_json::json!({
            "sketch": hydrated,
            "command": { "kind": "set_operation", "id": "operation:offset", "operation": { "kind": "offset", "sources": ["line:source"], "result_chains": [["line:offset"]], "distance_nm": 3500000, "two_sided": false, "linked": true } }
        }).to_string()).unwrap()).unwrap();
        assert_eq!(
            edited["sketch"]["operations"]["operation:offset"]["distance_nm"],
            3_500_000
        );
        assert_eq!(
            edited["sketch"]["geometry"]["line:offset"]["geometry"]["start"]["y_nm"],
            3_500_000
        );
    }

    #[test]
    fn p2_text_and_creation_recipe_metadata_commit_reload_edit_and_explode() {
        let mut runtime = runtime();
        let text_geometry=(0..6).map(|index|(format!("text:{index}"),serde_json::json!({"id":format!("text:{index}"),"geometry":{"kind":"line","start":{"x_nm":0,"y_nm":0},"end":{"x_nm":1,"y_nm":0}}}))).collect::<serde_json::Map<_,_>>();
        let draft = serde_json::json!({"id":crawler_part_engine::RECTANGLE_SKETCH_ID,"revision":0,"geometry":text_geometry,"constraints":{},"recipes":{"recipe:text":{"kind":"text","text":"A","origin":{"x_nm":0,"y_nm":0},"height_nm":5000000,"rotation_microdegrees":0,"tracking_millionths":1000000,"horizontal_alignment":"left","path_start_millionths":0,"reversed":false,"geometry":["text:0","text:1","text:2","text:3","text:4","text:5"]}}});
        let accepted:serde_json::Value=serde_json::from_str(&runtime.solve_sketch_json(&serde_json::json!({"transaction_id":"transaction:p2-text","sketch":draft.clone()}).to_string()).unwrap()).unwrap();
        assert_eq!(accepted["accepted"], true);
        let saved = runtime.document_json().unwrap();
        let restored = PartRuntime::from_document_json(&saved).unwrap();
        let document: Document = serde_json::from_str(&restored.document_json().unwrap()).unwrap();
        assert!(
            matches!(&document.sketches[&SketchId::from(crawler_part_engine::RECTANGLE_SKETCH_ID)].recipes["recipe:text"],crawler_document::SketchRecipe::Text{text,height_nanometers:5_000_000,..} if text=="A")
        );
        let mut hydrated = draft;
        hydrated["revision"] = serde_json::json!(1);
        let edited:serde_json::Value=serde_json::from_str(&restored.apply_sketch_command_json(&serde_json::json!({"sketch":hydrated,"command":{"kind":"set_recipe","id":"recipe:text","recipe":{"kind":"text","text":"I","origin":{"x_nm":1000000,"y_nm":2000000},"height_nm":8000000,"rotation_microdegrees":90000000,"tracking_millionths":1000000,"horizontal_alignment":"center","path_start_millionths":0,"reversed":false,"geometry":["text:0","text:1","text:2","text:3"]}}}).to_string()).unwrap()).unwrap();
        assert_eq!(edited["sketch"]["recipes"]["recipe:text"]["text"], "I");
        assert_eq!(edited["sketch"]["geometry"].as_object().unwrap().len(), 4);
        let exploded:serde_json::Value=serde_json::from_str(&restored.apply_sketch_command_json(&serde_json::json!({"sketch":edited["sketch"],"command":{"kind":"remove_recipe","id":"recipe:text"}}).to_string()).unwrap()).unwrap();
        assert!(
            exploded["sketch"]
                .get("recipes")
                .is_none_or(|value| value.as_object().is_some_and(|recipes| recipes.is_empty()))
        );
        assert_eq!(exploded["sketch"]["geometry"].as_object().unwrap().len(), 4);
    }

    #[test]
    fn qualified_feature_execution_persists_body_snapshot_and_provenance() {
        let mut runtime = runtime();
        let feature = Feature {
            id: FeatureId::from("feature:revolve"),
            display_name: "Revolve".into(),
            component: ComponentId::from(crawler_part_engine::ROOT_COMPONENT_ID),
            operation: OperationReference {
                schema_id: "crawler.operation.revolve".into(),
                schema_version: 1,
            },
            dependencies: vec![FeatureId::from(crawler_part_engine::EXTRUDE_FEATURE_ID)],
            inputs: BTreeMap::new(),
            parameters: BTreeMap::new(),
            suppressed: false,
        };
        runtime
            .commit_changes_json(
                &serde_json::json!({
                    "transaction_id": "transaction:create-revolve",
                    "changes": [{ "kind": "create_feature", "feature": feature, "before": null }]
                })
                .to_string(),
            )
            .unwrap();
        let envelope = serde_json::json!({
            "transaction_id": "transaction:execute-revolve",
            "feature": feature,
            "request": {
                "schema_version": 1,
                "document_id": "document:runtime-cube",
                "feature_id": "feature:revolve",
                "output_body_id": "body:revolve",
                "operation": {
                    "kind": "revolve",
                    "axis_origin_nm": [0, 0, 0],
                    "axis": "z",
                    "inner_radius_nm": 1000000,
                    "outer_radius_nm": 2000000,
                    "axial_start_nm": 0,
                    "axial_end_nm": 3000000,
                    "sweep_microdegrees": 360000000,
                    "divisions": 16,
                    "tolerance_nm": 10000
                }
            }
        });
        let outcome: serde_json::Value =
            serde_json::from_str(&runtime.execute_feature_json(&envelope.to_string()).unwrap())
                .unwrap();
        assert_eq!(outcome["accepted"], true);
        let document = runtime.document_json().unwrap();
        assert!(document.contains("accept_feature_result"));
        assert!(document.contains("deterministic_digest"));
        assert!(document.contains("body:revolve"));
    }

    #[test]
    fn advanced_feature_parameters_are_durable_and_edit_in_place() {
        let mut runtime = runtime();
        let mut feature = Feature {
            id: FeatureId::from("feature:editable-revolve"),
            display_name: "Editable Revolve".into(),
            component: ComponentId::from(crawler_part_engine::ROOT_COMPONENT_ID),
            operation: OperationReference {
                schema_id: "crawler.part.revolve".into(),
                schema_version: 1,
            },
            dependencies: vec![FeatureId::from(crawler_part_engine::EXTRUDE_FEATURE_ID)],
            inputs: BTreeMap::new(),
            parameters: BTreeMap::from([(
                "outer_radius".into(),
                ParameterId::from("parameter:editable-revolve:outer_radius"),
            )]),
            suppressed: false,
        };
        let definition = Parameter {
            id: ParameterId::from("parameter:editable-revolve:outer_radius"),
            display_name: "Outer Radius".into(),
            value: ParameterValue::LengthNanometers(2_000_000),
        };
        let create: serde_json::Value = serde_json::from_str(
            &runtime
                .execute_new_feature_json(
                    &serde_json::json!({
                        "transaction_id": "transaction:create-editable-revolve",
                        "feature": feature,
                        "parameter_definitions": [definition],
                        "before": null,
                        "request": {
                            "schema_version": 1,
                            "document_id": "document:runtime-cube",
                            "feature_id": "feature:editable-revolve",
                            "output_body_id": "body:editable-revolve",
                            "operation": revolve_operation(0),
                        }
                    })
                    .to_string(),
                )
                .unwrap(),
        )
        .unwrap();
        assert_eq!(create["accepted"], true);
        let created_hash = runtime.semantic_hash().unwrap();
        assert_eq!(
            runtime.engine.document().parameters
                [&ParameterId::from("parameter:editable-revolve:outer_radius")]
                .value,
            ParameterValue::LengthNanometers(2_000_000)
        );

        let mut edited_operation = revolve_operation(0);
        edited_operation["outer_radius_nm"] = serde_json::json!(3_000_000);
        let edited_definition = Parameter {
            id: ParameterId::from("parameter:editable-revolve:outer_radius"),
            display_name: "Outer Radius".into(),
            value: ParameterValue::LengthNanometers(3_000_000),
        };
        feature.display_name = "Edited Revolve".into();
        let edit: serde_json::Value = serde_json::from_str(
            &runtime
                .execute_feature_json(
                    &serde_json::json!({
                        "transaction_id": "transaction:edit-editable-revolve",
                        "feature": feature,
                        "parameter_definitions": [edited_definition],
                        "request": {
                            "schema_version": 1,
                            "document_id": "document:runtime-cube",
                            "feature_id": "feature:editable-revolve",
                            "output_body_id": "body:editable-revolve",
                            "operation": edited_operation,
                        }
                    })
                    .to_string(),
                )
                .unwrap(),
        )
        .unwrap();
        assert_eq!(edit["accepted"], true);
        assert_eq!(edit["before_hash"], created_hash);
        assert_eq!(runtime.engine.document().features.len(), 3);
        assert_eq!(
            runtime.engine.document().parameters
                [&ParameterId::from("parameter:editable-revolve:outer_radius")]
                .value,
            ParameterValue::LengthNanometers(3_000_000)
        );
        let transaction = runtime.engine.document().transactions.last().unwrap();
        assert!(
            transaction
                .changes
                .iter()
                .any(|change| matches!(change, DocumentChange::SetParameterValue { .. }))
        );
        assert!(
            transaction
                .changes
                .iter()
                .any(|change| matches!(change, DocumentChange::EditFeature { .. }))
        );
        assert!(
            transaction
                .changes
                .iter()
                .any(|change| matches!(change, DocumentChange::AcceptFeatureResult { .. }))
        );

        assert_eq!(runtime.undo().unwrap(), created_hash);
        assert_eq!(
            runtime.engine.document().parameters
                [&ParameterId::from("parameter:editable-revolve:outer_radius")]
                .value,
            ParameterValue::LengthNanometers(2_000_000)
        );
        runtime.redo().unwrap();
        let restored = PartRuntime::from_document_json(&runtime.document_json().unwrap()).unwrap();
        assert_eq!(
            restored.engine.document().parameters
                [&ParameterId::from("parameter:editable-revolve:outer_radius")]
                .value,
            ParameterValue::LengthNanometers(3_000_000)
        );
    }

    #[test]
    fn editing_an_upstream_advanced_feature_atomically_recomputes_consumers() {
        let mut runtime = runtime();
        let upstream = execute_new(
            &mut runtime,
            "feature:upstream-revolve",
            revolve_operation(0),
        );
        assert_eq!(upstream["accepted"], true);
        let downstream_feature = Feature {
            id: FeatureId::from("feature:downstream-mirror"),
            display_name: "Downstream Mirror".into(),
            component: ComponentId::from(crawler_part_engine::ROOT_COMPONENT_ID),
            operation: OperationReference {
                schema_id: "crawler.part.mirror".into(),
                schema_version: 1,
            },
            dependencies: vec![FeatureId::from("feature:upstream-revolve")],
            inputs: BTreeMap::new(),
            parameters: BTreeMap::new(),
            suppressed: false,
        };
        let downstream: serde_json::Value = serde_json::from_str(
            &runtime
                .execute_new_feature_json(
                    &serde_json::json!({
                        "transaction_id": "transaction:create-downstream-mirror",
                        "feature": downstream_feature,
                        "before": null,
                        "request": {
                            "schema_version": 1,
                            "document_id": "document:runtime-cube",
                            "feature_id": "feature:downstream-mirror",
                            "output_body_id": "body:downstream-mirror",
                            "operation": {
                                "kind": "mirror",
                                "source": { "semantics": "body", "body": upstream["result"]["output"].clone() },
                                "plane_origin_nm": [0, 0, 0],
                                "plane_normal": "x",
                                "tolerance_nm": 10000
                            }
                        }
                    })
                    .to_string(),
                )
                .unwrap(),
        )
        .unwrap();
        assert_eq!(downstream["accepted"], true, "{downstream:#}");
        let before_explicit_recompute = runtime.semantic_hash().unwrap();
        let explicit: serde_json::Value = serde_json::from_str(
            &runtime
                .recompute_from_here_json("feature:upstream-revolve")
                .unwrap(),
        )
        .unwrap();
        assert_eq!(explicit["accepted"], true, "{explicit:#}");
        assert_eq!(explicit["recomputed"].as_array().unwrap().len(), 2);
        assert_eq!(
            explicit["transaction"]["changes"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|change| change["kind"] == "accept_feature_result")
                .count(),
            2
        );
        assert_ne!(runtime.semantic_hash().unwrap(), before_explicit_recompute);
        assert_eq!(runtime.undo().unwrap(), before_explicit_recompute);
        let before_edit = runtime.semantic_hash().unwrap();
        let upstream_feature = runtime.engine.document().features
            [&FeatureId::from("feature:upstream-revolve")]
            .clone();
        let mut edited_operation = revolve_operation(0);
        edited_operation["outer_radius_nm"] = serde_json::json!(3_000_000);
        let edited: serde_json::Value = serde_json::from_str(
            &runtime
                .execute_feature_json(
                    &serde_json::json!({
                        "transaction_id": "transaction:edit-upstream-revolve",
                        "feature": upstream_feature,
                        "request": {
                            "schema_version": 1,
                            "document_id": "document:runtime-cube",
                            "feature_id": "feature:upstream-revolve",
                            "output_body_id": "body:feature:upstream-revolve",
                            "operation": edited_operation
                        }
                    })
                    .to_string(),
                )
                .unwrap(),
        )
        .unwrap();
        assert_eq!(edited["accepted"], true, "{edited:#}");
        assert_eq!(
            edited["recomputed"][0]["feature"],
            "feature:downstream-mirror"
        );
        let transaction = runtime.engine.document().transactions.last().unwrap();
        assert_eq!(
            transaction
                .changes
                .iter()
                .filter(|change| matches!(change, DocumentChange::AcceptFeatureResult { .. }))
                .count(),
            2
        );
        let downstream_request = latest_kernel_request(
            runtime.engine.document(),
            &FeatureId::from("feature:downstream-mirror"),
        )
        .unwrap()
        .unwrap();
        let downstream_request = serde_json::to_value(downstream_request).unwrap();
        assert_eq!(
            downstream_request["operation"]["source"]["body"]["evidence"]["deterministic_digest"],
            edited["result"]["output"]["evidence"]["deterministic_digest"]
        );
        let active: serde_json::Value =
            serde_json::from_str(&runtime.active_body_json(0.01).unwrap()).unwrap();
        assert_eq!(active["feature_id"], "feature:downstream-mirror");
        assert_eq!(active["body"]["body_id"], "body:downstream-mirror");
        assert_eq!(runtime.undo().unwrap(), before_edit);
        assert_eq!(runtime.redo().unwrap(), edited["document_hash"]);
    }

    #[test]
    fn execute_new_feature_is_atomic_rollback_aware_and_durable() {
        let mut runtime = runtime();
        let before = runtime.semantic_hash().unwrap();
        let revolve = execute_new(&mut runtime, "feature:atomic-revolve", revolve_operation(0));
        assert_eq!(revolve["accepted"], true);
        assert_ne!(runtime.semantic_hash().unwrap(), before);
        let accepted_hash = runtime.semantic_hash().unwrap();
        let accepted_document: serde_json::Value =
            serde_json::from_str(&runtime.document_json().unwrap()).unwrap();
        assert_eq!(
            accepted_document["recompute"]["features"]["feature:atomic-revolve"]["status"],
            "clean"
        );

        let active: serde_json::Value =
            serde_json::from_str(&runtime.active_body_json(0.01).unwrap()).unwrap();
        assert_eq!(active["kind"], "feature_result");
        assert_eq!(active["feature_id"], "feature:atomic-revolve");
        assert_eq!(active["body"]["body_id"], "body:feature:atomic-revolve");
        assert!(
            !active["render"]["packet"]["triangleIndices"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        let resolved: serde_json::Value = serde_json::from_str(
            &runtime
                .body_snapshot_json("body:feature:atomic-revolve")
                .unwrap(),
        )
        .unwrap();
        assert_eq!(resolved["found"], true);
        assert_eq!(resolved["feature_id"], "feature:atomic-revolve");
        assert_eq!(resolved["body"], active["body"]);
        let missing: serde_json::Value =
            serde_json::from_str(&runtime.body_snapshot_json("body:missing").unwrap()).unwrap();
        assert_eq!(missing["found"], false);
        assert_eq!(missing["error"]["category"], "not_found");
        assert_eq!(missing["error"]["field"], "body_id");

        let restored = PartRuntime::from_document_json(&runtime.document_json().unwrap()).unwrap();
        let restored_active: serde_json::Value =
            serde_json::from_str(&restored.active_body_json(0.01).unwrap()).unwrap();
        assert_eq!(restored_active["body"], active["body"]);

        let shell = execute_new(
            &mut runtime,
            "feature:unsupported-shell",
            serde_json::json!({
                "kind": "shell",
                "target": active["body"].clone(),
                "removed_face_stable_ids": ["1"],
                "wall_thickness_nm": 100000,
                "tolerance_nm": 10000
            }),
        );
        assert_eq!(shell["accepted"], false);
        assert_eq!(shell["error"]["category"], "unsupported");
        assert_eq!(shell["error"]["field"], "target");
        assert!(
            shell["error"]["recovery"]
                .as_str()
                .is_some_and(|value| !value.is_empty())
        );
        assert_eq!(runtime.semantic_hash().unwrap(), accepted_hash);
        assert!(
            !runtime
                .document_json()
                .unwrap()
                .contains("feature:unsupported-shell")
        );

        runtime
            .set_timeline_rollback(r#"{"kind":"after","feature":"feature:extrude"}"#)
            .unwrap();
        let rolled: serde_json::Value =
            serde_json::from_str(&runtime.active_body_json(0.01).unwrap()).unwrap();
        assert_eq!(rolled["kind"], "base_part");
        assert_eq!(runtime.semantic_hash().unwrap(), accepted_hash);
        runtime.set_timeline_rollback(r#"{"kind":"end"}"#).unwrap();

        assert_eq!(runtime.undo().unwrap(), before);
        let after_undo: serde_json::Value =
            serde_json::from_str(&runtime.active_body_json(0.01).unwrap()).unwrap();
        assert_eq!(after_undo["kind"], "base_part");
        assert_eq!(runtime.redo().unwrap(), accepted_hash);
    }

    #[test]
    fn generic_feature_preview_reuses_commit_envelope_and_preserves_accepted_state() {
        let mut runtime = runtime();
        let envelope = new_feature_envelope("feature:preview-revolve", revolve_operation(0));
        let before_hash = runtime.semantic_hash().unwrap();
        let before_document = runtime.document_json().unwrap();
        let before_history = runtime.engine.history_depths();

        let first: serde_json::Value =
            serde_json::from_str(&runtime.preview_feature_json(&envelope.to_string()).unwrap())
                .unwrap();
        let second: serde_json::Value =
            serde_json::from_str(&runtime.preview_feature_json(&envelope.to_string()).unwrap())
                .unwrap();

        assert_eq!(first, second);
        assert_eq!(first["accepted"], true, "{first:#}");
        assert_eq!(first["document_hash"], before_hash);
        assert_eq!(first["result"]["output"]["evidence"]["face_count"], 64);
        assert!(
            !first["render"]["packet"]["triangleIndices"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        assert_eq!(runtime.semantic_hash().unwrap(), before_hash);
        assert_eq!(runtime.document_json().unwrap(), before_document);
        assert_eq!(runtime.engine.history_depths(), before_history);

        let committed: serde_json::Value = serde_json::from_str(
            &runtime
                .execute_new_feature_json(&envelope.to_string())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(committed["accepted"], true, "{committed:#}");
        assert_eq!(committed["result"], first["result"]);
    }

    #[test]
    fn generic_feature_preview_supports_edits_and_returns_structured_refusals() {
        let mut runtime = runtime();
        let created = execute_new(&mut runtime, "feature:preview-edit", revolve_operation(0));
        assert_eq!(created["accepted"], true, "{created:#}");
        let before_hash = runtime.semantic_hash().unwrap();
        let before_document = runtime.document_json().unwrap();
        let before_history = runtime.engine.history_depths();
        let feature =
            runtime.engine.document().features[&FeatureId::from("feature:preview-edit")].clone();
        let edit = serde_json::json!({
            "transaction_id": "transaction:preview-edit",
            "feature": feature,
            "parameter_definitions": [],
            "request": {
                "schema_version": 1,
                "document_id": "document:runtime-cube",
                "feature_id": "feature:preview-edit",
                "output_body_id": "body:feature:preview-edit",
                "operation": revolve_operation(500_000),
            }
        });
        let preview: serde_json::Value =
            serde_json::from_str(&runtime.preview_feature_json(&edit.to_string()).unwrap())
                .unwrap();
        assert_eq!(preview["accepted"], true, "{preview:#}");
        assert_ne!(preview["result"], created["result"]);

        let mut mismatched = edit;
        mismatched["request"]["feature_id"] = serde_json::json!("feature:other");
        let refusal: serde_json::Value = serde_json::from_str(
            &runtime
                .preview_feature_json(&mismatched.to_string())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(refusal["accepted"], false);
        assert_eq!(refusal["error"]["category"], "invalid_input");
        assert_eq!(refusal["error"]["field"], "feature_id");
        assert!(
            refusal["render"]["packet"]["positions"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        assert_eq!(refusal["document_hash"], before_hash);
        assert_eq!(runtime.semantic_hash().unwrap(), before_hash);
        assert_eq!(runtime.document_json().unwrap(), before_document);
        assert_eq!(runtime.engine.history_depths(), before_history);
    }

    #[test]
    fn generic_feature_preview_dispatches_every_current_operation_variant() {
        let runtime = runtime();
        let before_hash = runtime.semantic_hash().unwrap();
        let before_document = runtime.document_json().unwrap();
        let target =
            serde_json::to_value(box_snapshot("body:preview-target", [0.0; 3], 1.0)).unwrap();
        let tool =
            serde_json::to_value(box_snapshot("body:preview-tool", [0.5, 0.5, 0.5], 1.0)).unwrap();
        let source = serde_json::json!({ "semantics": "body", "body": target.clone() });
        let operations = [
            serde_json::json!({
                "kind": "extrude",
                "profiles_nm": [[[0,0,0],[1000000,0,0],[1000000,1000000,0],[0,1000000,0]]],
                "direction_nm": [0,0,1000000], "tolerance_nm": 10000
            }),
            revolve_operation(0),
            serde_json::json!({
                "kind": "boolean", "operation": "union", "target": target.clone(),
                "tools": [tool], "tolerance_nm": 10000
            }),
            serde_json::json!({
                "kind": "fillet", "target": target.clone(), "edge_stable_ids": ["1"],
                "radius_nm": 100000, "divisions": 5, "tolerance_nm": 10000
            }),
            serde_json::json!({
                "kind": "chamfer", "target": target.clone(), "edge_stable_ids": ["1"],
                "radius_nm": 100000, "divisions": 5, "tolerance_nm": 10000
            }),
            serde_json::json!({
                "kind": "shell", "target": target.clone(), "removed_face_stable_ids": ["1"],
                "wall_thickness_nm": 100000, "tolerance_nm": 10000
            }),
            serde_json::json!({
                "kind": "mirror", "source": source.clone(), "plane_origin_nm": [0,0,0],
                "plane_normal": "x", "tolerance_nm": 10000
            }),
            serde_json::json!({
                "kind": "transform", "source": source.clone(),
                "translation_nm": [2000000,0,0], "tolerance_nm": 10000
            }),
            serde_json::json!({
                "kind": "linear_pattern", "source": source.clone(),
                "instance_body_ids": ["linear:0", "linear:1"],
                "step_nm": [2000000,0,0], "tolerance_nm": 10000
            }),
            serde_json::json!({
                "kind": "circular_pattern", "source": source.clone(),
                "instance_body_ids": ["circular:0", "circular:1"],
                "axis_origin_nm": [0,0,0], "axis": "z",
                "step_microdegrees": 180000000, "tolerance_nm": 10000
            }),
            serde_json::json!({
                "kind": "profile_revolve",
                "profile_nm": [[1000000,0,0],[2000000,0,0],[2000000,0,1000000],[1000000,0,1000000]],
                "axis_origin_nm": [0,0,0], "axis_direction_nm": [0,0,1000000],
                "sweep_microdegrees": 360000000, "divisions": 16, "tolerance_nm": 10000
            }),
            serde_json::json!({
                "kind": "loft",
                "profiles_nm": [
                    [[0,0,0],[1000000,0,0],[1000000,1000000,0],[0,1000000,0]],
                    [[0,0,1000000],[1500000,0,1000000],[1500000,1500000,1000000],[0,1500000,1000000]]
                ],
                "tolerance_nm": 10000
            }),
            serde_json::json!({
                "kind": "sweep",
                "profile_nm": [[0,0,0],[1000000,0,0],[1000000,1000000,0],[0,1000000,0]],
                "path_nm": [[0,0,0],[0,0,2000000]], "tolerance_nm": 10000
            }),
            serde_json::json!({
                "kind": "draft", "target": target, "face_stable_ids": ["1"],
                "pull_direction": "z", "neutral_plane_origin_nm": [0,0,0],
                "angle_microdegrees": 5000000, "tolerance_nm": 10000
            }),
        ];

        for (index, operation) in operations.into_iter().enumerate() {
            let feature_id = format!("feature:preview-variant-{index}");
            let envelope = new_feature_envelope(&feature_id, operation);
            let response: serde_json::Value =
                serde_json::from_str(&runtime.preview_feature_json(&envelope.to_string()).unwrap())
                    .unwrap();
            assert!(response["accepted"].is_boolean(), "{response:#}");
            assert_eq!(response["document_hash"], before_hash);
            if response["accepted"] == true {
                assert!(response["result"]["output"]["evidence"].is_object());
                assert_eq!(response["render"]["body_id"], format!("body:{feature_id}"));
            } else {
                assert!(response["error"]["category"].is_string(), "{response:#}");
                assert_ne!(response["error"]["field"], "envelope");
            }
            assert_eq!(runtime.semantic_hash().unwrap(), before_hash);
            assert_eq!(runtime.document_json().unwrap(), before_document);
        }
    }

    #[test]
    fn prepared_profile_revolve_is_previewable_durable_reloadable_and_edit_ready() {
        let mut runtime = runtime();
        let profile = commit_test_sketch_source(
            &mut runtime,
            "sketch:prepared-revolve",
            "xz",
            rectangle_geometry(
                "rectangle:prepared-revolve",
                [1_000_000, 0],
                [3_000_000, 4_000_000],
            ),
        );
        assert_prepared_feature_lifecycle(
            &runtime,
            serde_json::json!({
                "transaction_id": "transaction:prepared-revolve",
                "feature_id": "feature:prepared-revolve",
                "body_id": "body:prepared-revolve",
                "operation_id": "profile_revolve",
                "profile_sources": [profile],
                "axis_origin_nanometers": [0,0,0],
                "axis_direction_nanometers": [0,0,1000000],
                "sweep_microdegrees": 360000000,
                "divisions": 24,
                "reverse": true,
                "tolerance_nanometers": 10000
            }),
            "profile_revolve",
            &["profile"],
        );
    }

    #[test]
    fn prepared_loft_is_previewable_durable_reloadable_and_edit_ready() {
        let mut runtime = runtime();
        let first = commit_test_sketch_source(
            &mut runtime,
            "sketch:prepared-loft-a",
            "xy",
            rectangle_geometry(
                "rectangle:prepared-loft-a",
                [1_000_000, 1_000_000],
                [3_000_000, 3_000_000],
            ),
        );
        let second = commit_test_sketch_source(
            &mut runtime,
            "sketch:prepared-loft-b",
            "xz",
            rectangle_geometry(
                "rectangle:prepared-loft-b",
                [1_000_000, 5_000_000],
                [4_000_000, 8_000_000],
            ),
        );
        assert_prepared_feature_lifecycle(
            &runtime,
            serde_json::json!({
                "transaction_id": "transaction:prepared-loft",
                "feature_id": "feature:prepared-loft",
                "body_id": "body:prepared-loft",
                "operation_id": "loft",
                "profile_sources": [first, second],
                "tolerance_nanometers": 10000
            }),
            "loft",
            &["profile", "profile_2"],
        );
    }

    #[test]
    fn prepared_sweep_is_previewable_durable_reloadable_and_edit_ready() {
        let mut runtime = runtime();
        let profile = commit_test_sketch_source(
            &mut runtime,
            "sketch:prepared-sweep-profile",
            "xy",
            rectangle_geometry("rectangle:prepared-sweep", [0, 0], [2_000_000, 2_000_000]),
        );
        let path = commit_test_sketch_source(
            &mut runtime,
            "sketch:prepared-sweep-path",
            "xz",
            line_geometry("line:prepared-sweep", [0, 0], [0, 6_000_000]),
        );
        assert_prepared_feature_lifecycle(
            &runtime,
            serde_json::json!({
                "transaction_id": "transaction:prepared-sweep",
                "feature_id": "feature:prepared-sweep",
                "body_id": "body:prepared-sweep",
                "operation_id": "sweep",
                "profile_sources": [profile],
                "path_source": path,
                "tolerance_nanometers": 10000
            }),
            "sweep",
            &["profile", "path"],
        );
    }

    #[test]
    fn prepared_extrude_cut_is_previewable_durable_reloadable_and_edit_ready() {
        let mut runtime = runtime();
        let profile = commit_test_sketch_source(
            &mut runtime,
            "sketch:prepared-extrude-cut",
            "xy",
            rectangle_geometry(
                "rectangle:prepared-extrude-cut",
                [2_000_000, 2_000_000],
                [4_000_000, 4_000_000],
            ),
        );
        let request = serde_json::json!({
            "transaction_id": "transaction:prepared-extrude-cut",
            "feature_id": "feature:prepared-extrude-cut",
            "body_id": crawler_part_engine::BODY_ID,
            "operation_id": "extrude_cut",
            "profile_sources": [profile],
            "target_body_id": crawler_part_engine::BODY_ID,
            "distance_nanometers": 10000000,
            "tolerance_nanometers": 10000
        });
        assert_prepared_feature_lifecycle(
            &runtime,
            request.clone(),
            "native_extrude_cut_v2",
            &["profile", "target"],
        );
        for distance in [0, -1] {
            let mut invalid = request.clone();
            invalid["feature_id"] =
                serde_json::json!(format!("feature:prepared-extrude-cut:invalid:{distance}"));
            invalid["body_id"] =
                serde_json::json!(format!("body:prepared-extrude-cut:invalid:{distance}"));
            invalid["distance_nanometers"] = serde_json::json!(distance);
            let before = runtime.semantic_hash().unwrap();
            let error = runtime
                .prepare_sketch_feature_envelope_json(&invalid.to_string())
                .unwrap_err();
            assert!(error.to_string().contains("greater than zero"));
            assert_eq!(runtime.semantic_hash().unwrap(), before);
        }
    }

    #[test]
    fn single_target_cut_result_mode_is_atomic_editable_and_retains_target_body() {
        let mut runtime = runtime();
        let profile = commit_test_sketch_source(
            &mut runtime,
            "sketch:base-cut",
            "xy",
            rectangle_geometry(
                "rectangle:base-cut",
                [2_000_000, 2_000_000],
                [4_000_000, 4_000_000],
            ),
        );
        let mut request = serde_json::json!({
            "transaction_id": "transaction:base-cut:create",
            "sketch": profile["sketch"],
            "support": profile["support"],
            "distance_nanometers": 5_000_000,
            "direction": "positive",
            "result_mode": "cut",
            "target_body_id": crawler_part_engine::BODY_ID,
            "feature_id": "feature:base-cut",
            "body_id": crawler_part_engine::BODY_ID,
            "tolerance": 0.01
        });
        let before_hash = runtime.semantic_hash().unwrap();
        let before_document = runtime.document_json().unwrap();
        let preview: serde_json::Value = serde_json::from_str(
            &runtime
                .preview_sketch_extrude_json(&request.to_string())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(preview["result_mode"], "cut");
        assert_eq!(preview["target_body_id"], crawler_part_engine::BODY_ID);
        assert_eq!(runtime.semantic_hash().unwrap(), before_hash);
        assert_eq!(runtime.document_json().unwrap(), before_document);

        let created: serde_json::Value = serde_json::from_str(
            &runtime
                .commit_sketch_extrude_json(&request.to_string())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(created["accepted"], true, "{created:#}");
        assert_eq!(
            created["result"]["output"]["body_id"],
            crawler_part_engine::BODY_ID
        );
        assert_eq!(
            created["result"]["ordered_input_body_ids"],
            serde_json::json!([crawler_part_engine::BODY_ID])
        );
        assert!(
            created["result"]["output"]["evidence"]["volume_model_units3"]
                .as_f64()
                .unwrap()
                < 1_000.0
        );
        let document: Document = serde_json::from_str(&runtime.document_json().unwrap()).unwrap();
        let definition = &document.feature_definitions_v2[&FeatureId::from("feature:base-cut")];
        assert_eq!(definition.result, crawler_document::FeatureResultV2::Cut);
        assert_eq!(definition.participant_bodies.len(), 1);
        assert_eq!(
            definition.participant_bodies[0].body,
            BodyId::from(crawler_part_engine::BODY_ID)
        );

        let created_hash = runtime.semantic_hash().unwrap();
        request["transaction_id"] = serde_json::json!("transaction:base-cut:edit");
        request["distance_nanometers"] = serde_json::json!(7_000_000);
        let edited: serde_json::Value = serde_json::from_str(
            &runtime
                .commit_sketch_extrude_json(&request.to_string())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(edited["accepted"], true, "{edited:#}");
        let edited_hash = runtime.semantic_hash().unwrap();
        assert_ne!(edited_hash, created_hash);
        runtime.undo().unwrap();
        assert_eq!(runtime.semantic_hash().unwrap(), created_hash);
        runtime.redo().unwrap();
        assert_eq!(runtime.semantic_hash().unwrap(), edited_hash);

        let saved = runtime.document_json().unwrap();
        let mut restored = PartRuntime::from_document_json(&saved).unwrap();
        assert_eq!(restored.document_json().unwrap(), saved);
        let recomputed: serde_json::Value = serde_json::from_str(
            &restored
                .recompute_from_here_json("feature:base-cut")
                .unwrap(),
        )
        .unwrap();
        assert_eq!(recomputed["accepted"], true, "{recomputed:#}");

        restored
            .commit_changes_json(
                &serde_json::json!({
                    "transaction_id": "transaction:base-cut:suppress",
                    "changes": [{
                        "kind": "set_feature_suppressed",
                        "feature": "feature:base-cut",
                        "suppressed": true
                    }]
                })
                .to_string(),
            )
            .unwrap();
        let suppressed: serde_json::Value = serde_json::from_str(
            &restored
                .body_snapshot_json(crawler_part_engine::BODY_ID)
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            suppressed["feature_id"],
            crawler_part_engine::EXTRUDE_FEATURE_ID
        );
    }

    #[test]
    fn single_target_cut_preview_returns_parse_safe_structured_refusals() {
        let mut runtime = runtime();
        let profile = commit_test_sketch_source(
            &mut runtime,
            "sketch:base-cut-refusal",
            "xy",
            rectangle_geometry(
                "rectangle:base-cut-refusal",
                [20_000_000, 20_000_000],
                [22_000_000, 22_000_000],
            ),
        );
        let before = runtime.semantic_hash().unwrap();
        let mut request = serde_json::json!({
            "sketch": profile["sketch"], "support": profile["support"],
            "distance_nanometers": 2_000_000, "direction": "positive",
            "result_mode": "cut", "target_body_id": crawler_part_engine::BODY_ID,
            "feature_id": "feature:base-cut-refusal", "body_id": crawler_part_engine::BODY_ID,
            "tolerance": 0.01
        });
        let no_overlap: serde_json::Value = serde_json::from_str(
            &runtime
                .preview_sketch_extrude_json(&request.to_string())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(no_overlap["accepted"], false);
        assert_eq!(no_overlap["result_mode"], "cut");
        assert_eq!(no_overlap["error"]["code"], "no_intersection");
        assert_eq!(no_overlap["error"]["category"], "boolean");
        assert_eq!(no_overlap["error"]["field_path"], "operation.profile");
        assert_eq!(
            no_overlap["error"]["referenced_entity_ids"],
            serde_json::json!([crawler_part_engine::BODY_ID])
        );
        assert!(no_overlap["render"].is_object());
        assert_eq!(runtime.semantic_hash().unwrap(), before);

        request["target_body_id"] = serde_json::json!("body:missing");
        request["body_id"] = serde_json::json!("body:missing");
        let missing: serde_json::Value = serde_json::from_str(
            &runtime
                .preview_sketch_extrude_json(&request.to_string())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(missing["accepted"], false);
        assert_eq!(missing["error"]["code"], "missing_cut_target");
        assert_eq!(missing["error"]["category"], "reference");
        assert_eq!(missing["error"]["field_path"], "participant_bodies.target");
        assert_eq!(
            missing["error"]["referenced_entity_ids"],
            serde_json::json!(["body:missing"])
        );
        assert_eq!(runtime.semantic_hash().unwrap(), before);
    }

    #[test]
    fn single_target_cut_support_and_profile_refusals_name_the_actual_input() {
        let mut runtime = runtime();
        let profile = commit_test_sketch_source(
            &mut runtime,
            "sketch:cut-input-diagnostics",
            "xy",
            rectangle_geometry(
                "rectangle:cut-input-diagnostics",
                [2_000_000, 1_000_000],
                [8_000_000, 5_000_000],
            ),
        );
        let before = runtime.semantic_hash().unwrap();
        let base = serde_json::json!({
            "sketch": profile["sketch"], "support": profile["support"],
            "distance_nanometers": 2_000_000, "direction": "positive",
            "result_mode": "cut", "target_body_id": crawler_part_engine::BODY_ID,
            "feature_id": "feature:cut-input-diagnostics", "body_id": crawler_part_engine::BODY_ID,
            "tolerance": 0.01
        });
        let mut missing_support = base.clone();
        missing_support["support"] = serde_json::json!({
            "kind":"construction_plane_reference", "plane":"construction-plane:missing-cut-support"
        });
        let support_refusal: serde_json::Value = serde_json::from_str(
            &runtime
                .preview_sketch_extrude_json(&missing_support.to_string())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            support_refusal["error"]["code"],
            "missing_construction_plane_support"
        );
        assert_eq!(support_refusal["error"]["category"], "reference");
        assert_eq!(support_refusal["error"]["field_path"], "extrude.support");
        assert_eq!(
            support_refusal["error"]["referenced_entity_ids"],
            serde_json::json!(["construction-plane:missing-cut-support"])
        );
        assert_eq!(runtime.semantic_hash().unwrap(), before);

        let open = commit_test_sketch_source(
            &mut runtime,
            "sketch:cut-open-diagnostic",
            "xy",
            serde_json::json!({
                "line:cut-open-a":{"id":"line:cut-open-a","geometry":{"kind":"line","start":{"x_nm":2_000_000,"y_nm":1_000_000},"end":{"x_nm":8_000_000,"y_nm":1_000_000}}},
                "line:cut-open-b":{"id":"line:cut-open-b","geometry":{"kind":"line","start":{"x_nm":8_000_000,"y_nm":1_000_000},"end":{"x_nm":8_000_000,"y_nm":5_000_000}}}
            }),
        );
        let mut open_profile = base;
        open_profile["sketch"] = open["sketch"].clone();
        open_profile["support"] = open["support"].clone();
        let before_profile = runtime.semantic_hash().unwrap();
        let profile_refusal: serde_json::Value = serde_json::from_str(
            &runtime
                .preview_sketch_extrude_json(&open_profile.to_string())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(profile_refusal["error"]["code"], "invalid_cut_profile");
        assert_eq!(profile_refusal["error"]["category"], "profile");
        assert_eq!(profile_refusal["error"]["field_path"], "operation.profile");
        assert_eq!(
            profile_refusal["error"]["referenced_entity_ids"],
            serde_json::json!(["sketch:cut-open-diagnostic"])
        );
        assert_eq!(runtime.semantic_hash().unwrap(), before_profile);
    }

    #[test]
    fn recompute_stops_at_suppressed_cut_input_and_retains_last_valid_result() {
        let mut runtime = runtime();
        let profile = commit_test_sketch_source(
            &mut runtime,
            "sketch:cut-last-valid",
            "xy",
            rectangle_geometry(
                "rectangle:cut-last-valid",
                [2_000_000, 1_000_000],
                [8_000_000, 5_000_000],
            ),
        );
        let request = serde_json::json!({
            "transaction_id":"transaction:cut-last-valid", "sketch":profile["sketch"], "support":profile["support"],
            "distance_nanometers":2_000_000, "direction":"positive", "result_mode":"cut",
            "target_body_id":crawler_part_engine::BODY_ID, "feature_id":"feature:cut-last-valid",
            "body_id":crawler_part_engine::BODY_ID, "tolerance":0.01
        });
        let accepted: serde_json::Value = serde_json::from_str(
            &runtime
                .commit_sketch_extrude_json(&request.to_string())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(accepted["accepted"], true);
        let last_valid = runtime
            .body_snapshot_json(crawler_part_engine::BODY_ID)
            .unwrap();
        runtime.commit_changes_json(&serde_json::json!({
            "transaction_id":"transaction:cut-last-valid:suppress-input",
            "changes":[{"kind":"set_feature_suppressed","feature":"feature:sketch:cut-last-valid","suppressed":true}]
        }).to_string()).unwrap();
        let blocked: serde_json::Value = serde_json::from_str(
            &runtime
                .recompute_from_here_json("feature:cut-last-valid")
                .unwrap(),
        )
        .unwrap();
        assert_eq!(blocked["accepted"], false, "{blocked:#}");
        assert_eq!(blocked["error"]["code"], "suppressed_required_input");
        assert_eq!(
            blocked["error"]["referenced_entity_ids"],
            serde_json::json!(["feature:sketch:cut-last-valid"])
        );
        assert_eq!(blocked["plan"]["evaluation_order"], serde_json::json!([]));
        assert_eq!(
            runtime
                .body_snapshot_json(crawler_part_engine::BODY_ID)
                .unwrap(),
            last_valid
        );
    }

    #[test]
    fn single_target_cut_tangent_opening_refuses_nonmanifold_result_atomically() {
        let mut runtime = runtime();
        let profile = commit_test_sketch_source(
            &mut runtime,
            "sketch:tangent-cut-refusal",
            "xy",
            serde_json::json!({
                "circle:tangent-cut": {
                    "id": "circle:tangent-cut",
                    "geometry": {
                        "kind": "circle",
                        "center": { "x_nm": 1_500_000, "y_nm": 5_000_000 },
                        "radius_nm": 1_500_000
                    }
                }
            }),
        );
        let before_hash = runtime.semantic_hash().unwrap();
        let before_document = runtime.document_json().unwrap();
        let request = serde_json::json!({
            "sketch": profile["sketch"], "support": profile["support"],
            "distance_nanometers": 5_000_000, "direction": "positive",
            "result_mode": "cut", "target_body_id": crawler_part_engine::BODY_ID,
            "feature_id": "feature:tangent-cut-refusal", "body_id": crawler_part_engine::BODY_ID,
            "tolerance": 0.01
        });
        let refusal: serde_json::Value = serde_json::from_str(
            &runtime
                .preview_sketch_extrude_json(&request.to_string())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(refusal["accepted"], false, "{refusal:#}");
        assert_eq!(
            refusal["error"]["code"], "nonmanifold_result",
            "{refusal:#}"
        );
        assert_eq!(refusal["error"]["category"], "boolean");
        assert_eq!(refusal["error"]["field_path"], "operation.result");
        assert_eq!(runtime.semantic_hash().unwrap(), before_hash);
        assert_eq!(runtime.document_json().unwrap(), before_document);
    }

    #[test]
    fn single_target_cut_array_and_current_authority_variants_fail_closed() {
        let runtime = runtime();
        let validate = |candidate: &PartRuntime, request: serde_json::Value| {
            serde_json::from_str::<serde_json::Value>(
                &candidate
                    .validate_single_target_cut_targets_json(&request.to_string())
                    .unwrap(),
            )
            .unwrap()
        };
        for targets in [
            serde_json::json!([]),
            serde_json::json!([crawler_part_engine::BODY_ID, crawler_part_engine::BODY_ID]),
            serde_json::json!([crawler_part_engine::BODY_ID, "body:other"]),
        ] {
            let refusal = validate(
                &runtime,
                serde_json::json!({"target_body_ids":targets,"target_component_id":"component:root"}),
            );
            assert_eq!(refusal["error"]["code"], "explicit_target_required");
        }
        let cross = validate(
            &runtime,
            serde_json::json!({"target_body_ids":["body:foreign"],"target_component_id":"component:other"}),
        );
        assert_eq!(cross["error"]["code"], "wrong_component_cut_target");
        let owner = validate(
            &runtime,
            serde_json::json!({"target_body_ids":[crawler_part_engine::BODY_ID],"target_component_id":"component:root","support_body_id":"body:other"}),
        );
        assert_eq!(owner["error"]["code"], "wrong_owner_cut_target");

        let mut suppressed =
            PartRuntime::from_document_json(&runtime.document_json().unwrap()).unwrap();
        suppressed.commit_changes_json(&serde_json::json!({"transaction_id":"transaction:suppress-cut-authority","changes":[{"kind":"set_feature_suppressed","feature":crawler_part_engine::EXTRUDE_FEATURE_ID,"suppressed":true}]}).to_string()).unwrap();
        let refusal = validate(
            &suppressed,
            serde_json::json!({"target_body_ids":[crawler_part_engine::BODY_ID],"target_component_id":"component:root"}),
        );
        assert_eq!(refusal["error"]["code"], "suppressed_cut_target");

        let mut stale: serde_json::Value =
            serde_json::from_str(&runtime.document_json().unwrap()).unwrap();
        let revision = stale["revision"].as_u64().unwrap();
        stale["recompute"]["features"][crawler_part_engine::EXTRUDE_FEATURE_ID] =
            serde_json::json!({"status":"dirty","since_revision":revision});
        let stale = PartRuntime::from_document_json(&stale.to_string()).unwrap();
        let refusal = validate(
            &stale,
            serde_json::json!({"target_body_ids":[crawler_part_engine::BODY_ID],"target_component_id":"component:root"}),
        );
        assert_eq!(refusal["error"]["code"], "stale_cut_target");
    }

    #[test]
    fn prepared_revolve_cut_is_previewable_durable_reloadable_and_edit_ready() {
        let mut runtime = runtime();
        let target_source = commit_test_sketch_source(
            &mut runtime,
            "sketch:prepared-revolve-cut-target",
            "xy",
            rectangle_geometry(
                "rectangle:prepared-revolve-cut-target",
                [-5_000_000, -5_000_000],
                [5_000_000, 5_000_000],
            ),
        );
        let target_commit: serde_json::Value = serde_json::from_str(
            &runtime
                .commit_sketch_extrude_json(
                    &serde_json::json!({
                        "transaction_id": "transaction:prepared-revolve-cut-target",
                        "sketch": target_source["sketch"],
                        "support": target_source["support"],
                        "distance_nanometers": 10_000_000,
                        "feature_id": "feature:prepared-revolve-cut-target",
                        "body_id": "body:prepared-revolve-cut-target",
                        "tolerance": 0.01
                    })
                    .to_string(),
                )
                .unwrap(),
        )
        .unwrap();
        assert_eq!(target_commit["accepted"], true, "{target_commit:#}");
        let profile = commit_test_sketch_source(
            &mut runtime,
            "sketch:prepared-revolve-cut",
            "xz",
            rectangle_geometry(
                "rectangle:prepared-revolve-cut",
                [1_000_000, -1_000_000],
                [3_000_000, 11_000_000],
            ),
        );
        assert_prepared_feature_lifecycle(
            &runtime,
            serde_json::json!({
                "transaction_id": "transaction:prepared-revolve-cut",
                "feature_id": "feature:prepared-revolve-cut",
                "body_id": "body:prepared-revolve-cut",
                "operation_id": "revolve_cut",
                "profile_sources": [profile],
                "target_body_id": "body:prepared-revolve-cut-target",
                "axis_origin_nanometers": [0,0,0],
                "axis_direction_nanometers": [0,0,1000000],
                "sweep_microdegrees": 90000000,
                "divisions": 24,
                "reverse": true,
                "tolerance_nanometers": 10000
            }),
            "revolve_cut",
            &["profile", "target"],
        );
    }

    #[test]
    fn atomic_api_covers_boolean_edge_treatments_and_transforms() {
        let mut runtime = runtime();
        let boolean_target =
            serde_json::to_value(box_snapshot("body:boolean-target", [0.0; 3], 1.0)).unwrap();
        let boolean_tool =
            serde_json::to_value(box_snapshot("body:boolean-tool", [0.5, 0.5, 0.5], 1.0)).unwrap();
        let invalid_boolean = execute_new(
            &mut runtime,
            "feature:boolean-invalid",
            serde_json::json!({
                "kind": "boolean", "operation": "union", "target": boolean_target.clone(),
                "tools": [], "tolerance_nm": 50000
            }),
        );
        assert_eq!(invalid_boolean["accepted"], false);
        assert_eq!(invalid_boolean["error"]["category"], "invalid_input");
        assert_eq!(invalid_boolean["error"]["field"], "tools");

        let boolean = execute_new(
            &mut runtime,
            "feature:boolean",
            serde_json::json!({
                "kind": "boolean", "operation": "union", "target": boolean_target,
                "tools": [boolean_tool], "tolerance_nm": 50000
            }),
        );
        assert_eq!(boolean["accepted"], true, "{boolean:#}");
        let boolean_body = boolean["result"]["output"].clone();

        let mirror = execute_new(
            &mut runtime,
            "feature:mirror",
            serde_json::json!({
                "kind": "mirror", "source": { "semantics": "body", "body": boolean_body },
                "plane_origin_nm": [0, 0, 0], "plane_normal": "x", "tolerance_nm": 10000
            }),
        );
        assert_eq!(mirror["accepted"], true, "{mirror:#}");
        let mirror_body = mirror["result"]["output"].clone();

        let linear = execute_new(
            &mut runtime,
            "feature:linear-pattern",
            serde_json::json!({
                "kind": "linear_pattern", "source": { "semantics": "body", "body": mirror_body },
                "instance_body_ids": ["instance:0", "instance:1"],
                "step_nm": [5000000, 0, 0], "tolerance_nm": 10000
            }),
        );
        assert_eq!(linear["accepted"], true, "{linear:#}");
        assert_eq!(
            linear["result"]["instance_body_ids"],
            serde_json::json!(["instance:0", "instance:1"])
        );

        let circular = execute_new(
            &mut runtime,
            "feature:circular-pattern",
            serde_json::json!({
                "kind": "circular_pattern",
                "source": { "semantics": "body", "body": mirror["result"]["output"].clone() },
                "instance_body_ids": ["circle:0", "circle:1"],
                "axis_origin_nm": [0, 0, 0], "axis": "z",
                "step_microdegrees": 180000000, "tolerance_nm": 10000
            }),
        );
        assert_eq!(circular["accepted"], true, "{circular:#}");

        let active: serde_json::Value =
            serde_json::from_str(&runtime.active_body_json(0.01).unwrap()).unwrap();
        let pick = active["render"]["packet"]["pickTable"].as_array().unwrap();
        let edge = pick
            .chunks_exact(4)
            .find(|record| record[1] == 2)
            .map(|record| record[2].as_u64().unwrap() | (record[3].as_u64().unwrap() << 32))
            .unwrap();
        for (name, kind) in [("fillet", "fillet"), ("chamfer", "chamfer")] {
            let outcome = execute_new(
                &mut runtime,
                &format!("feature:{name}"),
                serde_json::json!({
                    "kind": kind, "target": active["body"].clone(),
                    "edge_stable_ids": [edge.to_string()], "radius_nm": 100000,
                    "divisions": 5, "tolerance_nm": 10000
                }),
            );
            assert_eq!(outcome["accepted"], true, "{name}: {outcome:#}");
        }

        let final_hash = runtime.semantic_hash().unwrap();
        let final_json = runtime.document_json().unwrap();
        let restored = PartRuntime::from_document_json(&final_json).unwrap();
        assert_eq!(restored.semantic_hash().unwrap(), final_hash);
        runtime
            .commit_changes_json(
                r#"{"transaction_id":"transaction:suppress-final","changes":[{"kind":"set_feature_suppressed","feature":"feature:chamfer","suppressed":true}]}"#,
            )
            .unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&runtime.active_body_json(0.01).unwrap())
                .unwrap()["feature_id"],
            "feature:fillet"
        );
        runtime.undo().unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&runtime.active_body_json(0.01).unwrap())
                .unwrap()["feature_id"],
            "feature:chamfer"
        );
    }

    #[test]
    fn persisted_step_body_exports_survive_reload_package_and_suppression() {
        let mut runtime = runtime();
        let base_exports = [ExportFormat::Step, ExportFormat::Stl, ExportFormat::Obj]
            .map(|format| runtime.export_text(format).unwrap());
        let settings = crawler_interchange::StepImportSettings {
            tolerance_nanometers: 10_000,
        };
        let source = include_bytes!(
            "../../../fixtures/reference-models/step-roundtrip-cube/samples/cube-brep.step"
        );
        let imported =
            crawler_interchange::import_step_body(source, settings, "body:import:durable").unwrap();
        let source_sha256 = imported.provenance.source_sha256.clone();
        let expected_exports =
            [ExportFormat::Step, ExportFormat::Stl, ExportFormat::Obj].map(|format| {
                String::from_utf8(
                    crawler_interchange::export_body(
                        &imported.body,
                        format,
                        BodyExportSettings {
                            tolerance_nanometers: settings.tolerance_nanometers,
                        },
                    )
                    .unwrap()
                    .bytes,
                )
                .unwrap()
            });
        let feature_id = FeatureId::from("feature:import:durable");
        let feature = Feature {
            id: feature_id.clone(),
            display_name: "Durable STEP".into(),
            component: ComponentId::from(crawler_part_engine::ROOT_COMPONENT_ID),
            operation: OperationReference {
                schema_id: "crawler.operation.import_step".into(),
                schema_version: 1,
            },
            dependencies: vec![],
            inputs: BTreeMap::new(),
            parameters: BTreeMap::new(),
            suppressed: false,
        };
        let result_json = serde_json::json!({
            "kind": "step_import",
            "import_id": "import:durable",
            "provenance": imported.provenance,
            "body": imported.body,
            "render_packet": imported.render_packet,
            "transferred_bytes": 0,
            "kernel_time_ms": 0.0
        })
        .to_string();
        runtime
            .commit_changes_json(
                &serde_json::json!({
                    "transaction_id": "transaction:import:durable",
                    "changes": [
                        { "kind": "create_feature", "feature": feature, "before": null },
                        {
                            "kind": "accept_feature_result",
                            "feature": feature_id,
                            "body": "body:import:durable",
                            "request_json": "{\"kind\":\"import_step\"}",
                            "result_json": result_json
                        }
                    ]
                })
                .to_string(),
            )
            .unwrap();

        let missing_source = runtime.export_portable_package().unwrap_err();
        assert!(
            missing_source.to_string().contains(&source_sha256),
            "{missing_source}"
        );
        assert_eq!(runtime.retain_imported_step_source(source), source_sha256);
        assert_eq!(
            runtime.imported_step_source(&source_sha256),
            Some(source.as_slice())
        );

        for (format, expected) in [ExportFormat::Step, ExportFormat::Stl, ExportFormat::Obj]
            .into_iter()
            .zip(expected_exports.iter())
        {
            assert_eq!(runtime.export_text(format).unwrap(), *expected);
        }

        let restored = PartRuntime::from_document_json(&runtime.document_json().unwrap()).unwrap();
        assert!(restored.export_portable_package().is_err());
        let package_bytes = runtime.export_portable_package().unwrap();
        let package = PortablePackage::from_archive_bytes(&package_bytes).unwrap();
        let source_descriptor = package
            .manifest()
            .payloads
            .get(&format!("source-step-{source_sha256}"))
            .unwrap();
        assert_eq!(source_descriptor.role, PayloadRole::ImportedGeometry);
        assert_eq!(source_descriptor.media_type, PayloadMediaType::Step);
        assert_eq!(source_descriptor.sha256, source_sha256);
        assert_eq!(
            package.payload(&format!("source-step-{source_sha256}")),
            Some(source.as_slice())
        );
        let packaged = PartRuntime::from_portable_package(&package_bytes).unwrap();
        assert_eq!(
            packaged.imported_step_source(&source_sha256),
            Some(source.as_slice())
        );
        assert_eq!(packaged.export_portable_package().unwrap(), package_bytes);
        for (format, expected) in [ExportFormat::Step, ExportFormat::Stl, ExportFormat::Obj]
            .into_iter()
            .zip(expected_exports.iter())
        {
            assert_eq!(restored.export_text(format).unwrap(), *expected);
            assert_eq!(packaged.export_text(format).unwrap(), *expected);
        }

        runtime
            .commit_changes_json(
                r#"{"transaction_id":"transaction:suppress:import","changes":[{"kind":"set_feature_suppressed","feature":"feature:import:durable","suppressed":true}]}"#,
            )
            .unwrap();
        for (format, expected) in [ExportFormat::Step, ExportFormat::Stl, ExportFormat::Obj]
            .into_iter()
            .zip(base_exports.iter())
        {
            assert_eq!(runtime.export_text(format).unwrap(), *expected);
        }
        runtime.undo().unwrap();
        for (format, expected) in [ExportFormat::Step, ExportFormat::Stl, ExportFormat::Obj]
            .into_iter()
            .zip(expected_exports.iter())
        {
            assert_eq!(runtime.export_text(format).unwrap(), *expected);
        }
    }

    #[test]
    fn field_expression_is_exact_and_survives_save_load_and_undo() {
        let mut runtime = runtime();
        let before = runtime.semantic_hash().unwrap();
        let response: serde_json::Value = serde_json::from_str(
            &runtime
                .set_field_expression_json(
                    r#"{
                        "transaction_id":"transaction:expression:height",
                        "feature":"feature:extrude",
                        "field":"height",
                        "source":"Width + 2.5 mm"
                    }"#,
                )
                .unwrap(),
        )
        .unwrap();
        assert_eq!(response["accepted"], true);
        assert_eq!(
            response["parameter"]["evaluated_value"],
            serde_json::json!({ "kind": "length_nanometers", "value": 12_500_000 })
        );
        assert_eq!(runtime.dimensions().unwrap().height_nanometers, 12_500_000);

        let snapshot = runtime.document_json().unwrap();
        let restored = PartRuntime::from_document_json(&snapshot).unwrap();
        assert_eq!(restored.document_json().unwrap(), snapshot);
        let listed: serde_json::Value =
            serde_json::from_str(&restored.parameters_json().unwrap()).unwrap();
        let height = listed["parameters"]
            .as_array()
            .unwrap()
            .iter()
            .find(|parameter| parameter["id"] == "parameter:height")
            .unwrap();
        assert_eq!(height["source"], "Width + 2.5 mm");
        assert_eq!(
            height["evaluated_value"],
            serde_json::json!({ "kind": "length_nanometers", "value": 12_500_000 })
        );

        assert_eq!(runtime.undo().unwrap(), before);
        assert_eq!(runtime.dimensions().unwrap().height_nanometers, 10_000_000);
        assert_ne!(runtime.redo().unwrap(), before);
        assert_eq!(runtime.dimensions().unwrap().height_nanometers, 12_500_000);
    }

    #[test]
    fn rename_keeps_expression_references_structural() {
        let mut runtime = runtime();
        runtime
            .set_field_expression_json(
                r#"{
                    "transaction_id":"transaction:expression:width",
                    "feature":"feature:extrude",
                    "field":"width",
                    "source":"Height * 2"
                }"#,
            )
            .unwrap();
        let expression_before = latest_parameter_expression(
            runtime.engine.document(),
            &ParameterId::from("parameter:width"),
        )
        .unwrap()
        .root
        .clone();
        let response: serde_json::Value = serde_json::from_str(
            &runtime
                .rename_parameter_json(
                    r#"{
                        "transaction_id":"transaction:rename:height",
                        "parameter":"parameter:height",
                        "display_name":"Overall Height"
                    }"#,
                )
                .unwrap(),
        )
        .unwrap();
        assert_eq!(response["accepted"], true);
        assert_eq!(
            latest_parameter_expression(
                runtime.engine.document(),
                &ParameterId::from("parameter:width")
            )
            .unwrap()
            .root,
            expression_before
        );
        assert!(matches!(
            expression_before,
            ParameterExpressionNode::Multiply { value, .. }
                if matches!(value.as_ref(), ParameterExpressionNode::Parameter { id }
                    if id == &ParameterId::from("parameter:height"))
        ));
        let listed: serde_json::Value =
            serde_json::from_str(&runtime.parameters_json().unwrap()).unwrap();
        let width = listed["parameters"]
            .as_array()
            .unwrap()
            .iter()
            .find(|parameter| parameter["id"] == "parameter:width")
            .unwrap();
        assert_eq!(width["source"], "Height * 2");
        assert!(
            width["display_expression"]
                .as_str()
                .unwrap()
                .contains("Overall Height")
        );
        runtime.undo().unwrap();
        assert_eq!(
            runtime.engine.document().parameters[&ParameterId::from("parameter:height")]
                .display_name,
            "Height"
        );
    }

    #[test]
    fn syntax_unit_and_cycle_failures_preserve_hash_and_history() {
        let mut runtime = runtime();
        runtime
            .set_field_expression_json(
                r#"{
                    "transaction_id":"transaction:expression:height",
                    "feature":"feature:extrude",
                    "field":"height",
                    "source":"Width + 1 mm"
                }"#,
            )
            .unwrap();
        let before = runtime.semantic_hash().unwrap();
        let before_json = runtime.document_json().unwrap();
        let history = runtime.engine.history_depths();
        for (source, expected_code) in [
            ("Height +", "unexpected_token"),
            ("45 deg", "invalid_quantity"),
            ("Height", "cycle"),
        ] {
            let response: serde_json::Value = serde_json::from_str(
                &runtime
                    .set_field_expression_json(
                        &serde_json::json!({
                            "transaction_id": format!("transaction:refusal:{expected_code}"),
                            "feature": "feature:extrude",
                            "field": "width",
                            "source": source,
                        })
                        .to_string(),
                    )
                    .unwrap(),
            )
            .unwrap();
            assert_eq!(response["accepted"], false, "{response:#}");
            assert_eq!(response["diagnostic"]["field"], "width");
            assert_eq!(
                response["diagnostic"]["code"], expected_code,
                "{response:#}"
            );
            assert_eq!(response["document_hash"], before);
            assert_eq!(runtime.semantic_hash().unwrap(), before);
            assert_eq!(runtime.document_json().unwrap(), before_json);
            assert_eq!(runtime.engine.history_depths(), history);
        }
        let cycle: serde_json::Value = serde_json::from_str(
            &runtime
                .set_field_expression_json(
                    r#"{
                        "transaction_id":"transaction:refusal:cycle-path",
                        "feature":"feature:extrude",
                        "field":"width",
                        "source":"Height"
                    }"#,
                )
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            cycle["diagnostic"]["cycle"],
            serde_json::json!(["parameter:height", "parameter:width", "parameter:height"])
        );
    }

    #[test]
    fn existing_dimensional_parameter_can_be_promoted_or_reused_by_field() {
        let mut runtime = runtime();
        let before = runtime.semantic_hash().unwrap();
        let response: serde_json::Value = serde_json::from_str(
            &runtime
                .promote_or_reuse_parameter_json(
                    r#"{
                        "transaction_id":"transaction:reuse:height",
                        "feature":"feature:rectangle-sketch",
                        "field":"width",
                        "display_name":"Shared Size"
                    }"#,
                )
                .unwrap(),
        )
        .unwrap();
        assert_eq!(response["accepted"], true);
        assert_eq!(response["parameter"], "parameter:width");
        let document = runtime.engine.document();
        assert_eq!(
            document.features[&FeatureId::from("feature:rectangle-sketch")].parameters["width"],
            ParameterId::from("parameter:width")
        );
        assert_eq!(
            document.features[&FeatureId::from("feature:extrude")].parameters["width"],
            ParameterId::from("parameter:width")
        );
        assert_eq!(
            document.parameters[&ParameterId::from("parameter:width")].display_name,
            "Shared Size"
        );
        assert_eq!(runtime.undo().unwrap(), before);
    }
}
