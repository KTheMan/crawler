//! Browser-worker ownership wrapper for the authoritative M1 part engine.

use crawler_document::{
    DocumentChange, DocumentId, EntityId, Feature, FeatureId, Parameter, ParameterExpression,
    ParameterExpressionNode, ParameterId, ParameterValue, TransactionId,
};
use crawler_feature_graph::{
    FeatureGraphCommand, FeatureGraphDocument, FeatureGroupId, FeatureTimingDiagnostic,
    RollbackPosition, RuntimeDiagnostics, apply_transaction as validate_graph_transaction,
    compute_diagnostics_view, direct_relationships,
    prepare_transaction as prepare_graph_transaction, recompute_from_here,
};
use crawler_feature_kernel::{
    AxisAlignedBoundsNm, BodySnapshot, FeatureError, FeatureRequest, FeatureResult,
    GeometryEvidence, execute as execute_feature,
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
use crawler_part_engine::{EngineError, NewPartCommand, ParameterEdit, PartDimensions, PartEngine};
use crawler_quantity::Quantity;
use crawler_render_packet::{RenderPacket, packet_from_solid, reference_cube_packet};
use crawler_sketch::{
    Constraint as SolverConstraint, DeclarativeSolver, DragRequest, Geometry, SketchCommand,
    SketchSolver, SolveState,
};
use crawler_topology_repair::{RepairInspection, draft_explicit_rebind, inspect_topology_repair};
use crawler_versioning::MigrationRegistry;
use monstertruck_modeling::{Point3, Solid, Vector3, builder};
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

    pub fn commit_length(
        &mut self,
        parameter_id: impl Into<ParameterId>,
        value_nanometers: i64,
    ) -> Result<String, EngineError> {
        let outcome = self
            .engine
            .commit(vec![ParameterEdit::length(parameter_id, value_nanometers)])?;
        serde_json::to_string(&serde_json::json!({
            "base_revision": outcome.base_revision,
            "result_revision": outcome.result_revision,
            "before_hash": outcome.before_hash,
            "after_hash": outcome.after_hash,
            "dirty_roots": outcome.plan.dirty_roots.into_iter().map(|id| id.0).collect::<Vec<_>>(),
            "evaluation_order": outcome.plan.evaluation_order.into_iter().map(|id| id.0).collect::<Vec<_>>(),
            "dimensions": dimensions_json(outcome.dimensions),
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
        let started = EvaluationTimer::start();
        let plan = recompute_from_here(&state, &selected, &self.graph_rollback())
            .map_err(|error| EngineError::InvalidDocument(error.to_string()))?;
        let mut snapshots = accepted_body_snapshots(self.engine.document())?;
        if self.base_body_is_active() {
            let base = self.base_body_snapshot()?;
            snapshots.insert(base.body_id.clone(), base);
        }
        let mut changes = Vec::new();
        let mut recomputed = Vec::new();
        for feature in &plan.evaluation_order {
            let Some(stored_request) = latest_kernel_request(self.engine.document(), feature)?
            else {
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

    /// Inspect the first unresolved topology input against caller-observed
    /// kernel topology. Ranking cannot mutate or silently select a candidate.
    pub fn repair_inspection_json(&self, observed_json: &str) -> Result<String, EngineError> {
        let observed: Vec<crawler_document::TopologyReference> =
            serde_json::from_str(observed_json)
                .map_err(|error| EngineError::Serialization(error.to_string()))?;
        let inspection = inspect_topology_repair(self.engine.document(), &observed)
            .map_err(|error| EngineError::InvalidDocument(error.to_string()))?;
        serde_json::to_string(&inspection)
            .map_err(|error| EngineError::Serialization(error.to_string()))
    }

    /// Re-inspect and draft from the explicit candidate ID before committing
    /// the shared rebind change through PartEngine so normal undo/redo applies.
    pub fn explicit_rebind_json(&mut self, request_json: &str) -> Result<String, EngineError> {
        #[derive(serde::Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Request {
            transaction_id: TransactionId,
            selected: crawler_document::TopologyReferenceId,
            observed: Vec<crawler_document::TopologyReference>,
        }
        let request: Request = serde_json::from_str(request_json)
            .map_err(|error| EngineError::Serialization(error.to_string()))?;
        let inspection = inspect_topology_repair(self.engine.document(), &request.observed)
            .map_err(|error| EngineError::InvalidDocument(error.to_string()))?;
        let RepairInspection::EvaluationBlocked { preview } = inspection else {
            return Err(EngineError::InvalidDocument(
                "topology repair is not required".into(),
            ));
        };
        let draft = draft_explicit_rebind(
            &preview,
            request.transaction_id.0.clone(),
            &request.selected,
        )
        .map_err(|error| EngineError::InvalidDocument(error.to_string()))?;
        let change = draft
            .changes
            .first()
            .ok_or_else(|| EngineError::InvalidDocument("repair draft has no change".into()))?;
        let started = EvaluationTimer::start();
        self.engine.commit_changes(
            request.transaction_id,
            vec![DocumentChange::RebindTopology {
                feature: change.feature.clone(),
                input_name: change.input_name.clone(),
                from_reference: change.from_reference.clone(),
                replacement: change.replacement.clone(),
            }],
        )?;
        self.record_evaluation_timing(
            &crawler_topology_repair::summarize_downstream_recovery(
                self.engine.document(),
                &change.feature,
            )
            .map_err(|error| EngineError::InvalidDocument(error.to_string()))?
            .pending_features,
            started.elapsed_microseconds(),
        );
        serde_json::to_string(&serde_json::json!({
            "accepted": true,
            "selected": request.selected,
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
        }
        let request: Request = serde_json::from_str(request_json)
            .map_err(|error| EngineError::Serialization(error.to_string()))?;
        let solved = DeclarativeSolver
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
        let existing =
            self.engine.document().sketches.get(&id).ok_or_else(|| {
                EngineError::InvalidDocument(format!("sketch {} is missing", id.0))
            })?;
        let document_sketch = solved_to_document_sketch(
            existing,
            &solved.sketch,
            request.support.as_ref().unwrap_or(&existing.support),
        );
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
        self.engine.commit_changes(
            request.transaction_id,
            vec![DocumentChange::ApplySketchSolution {
                sketch: document_sketch,
                solve_state,
                degrees_of_freedom: solved.solve.degrees_of_freedom,
                conflicts,
            }],
        )?;
        serde_json::to_string(&serde_json::json!({
            "accepted": true,
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
        let solved = DeclarativeSolver
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
        let drag = DeclarativeSolver
            .constrained_drag(&request.sketch, request.drag)
            .map_err(|error| EngineError::InvalidDocument(error.to_string()))?;
        serde_json::to_string(&serde_json::json!({
            "profile": drag.sketch.profile_report(),
            "drag": drag,
            "document_hash": self.semantic_hash()?,
        }))
        .map_err(|error| EngineError::Serialization(error.to_string()))
    }

    /// Execute a qualified feature-kernel request before atomically recording
    /// its complete request, body snapshot, and provenance result.
    pub fn execute_feature_json(&mut self, envelope_json: &str) -> Result<String, EngineError> {
        #[derive(serde::Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Envelope {
            transaction_id: TransactionId,
            feature: Feature,
            #[serde(default)]
            parameter_definitions: Vec<Parameter>,
            request: FeatureRequest,
        }
        let envelope: Envelope = serde_json::from_str(envelope_json)
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
        let result = match execute_feature(&envelope.request) {
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
            let Some(stored_request) = latest_kernel_request(self.engine.document(), downstream)?
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
        #[derive(serde::Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Envelope {
            transaction_id: TransactionId,
            feature: Feature,
            #[serde(default)]
            parameter_definitions: Vec<Parameter>,
            #[serde(default)]
            before: Option<FeatureId>,
            request: FeatureRequest,
        }
        let envelope: Envelope = serde_json::from_str(envelope_json)
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
        changes.extend([
            DocumentChange::CreateFeature {
                feature: envelope.feature,
                before: envelope.before,
            },
            DocumentChange::AcceptFeatureResult {
                feature: feature_id,
                body: crawler_document::BodyId(result.output.body_id.clone()),
                request_json,
                result_json,
            },
        ]);
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
        let dimensions = self.dimensions()?;
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
                deterministic_digest: format!(
                    "base-extrude:{}x{}x{}",
                    dimensions.width_nanometers,
                    dimensions.height_nanometers,
                    dimensions.distance_nanometers
                ),
            },
        })
    }

    fn active_result(&self) -> Result<Option<ActiveResult>, EngineError> {
        let document = self.engine.document();
        for feature in self.active_feature_order().into_iter().rev() {
            if document
                .features
                .get(&feature)
                .is_none_or(|record| record.suppressed)
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
                        ("feature_result", result.output, None)
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

fn latest_kernel_request(
    document: &crawler_document::Document,
    feature: &FeatureId,
) -> Result<Option<FeatureRequest>, EngineError> {
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

fn solved_to_document_sketch(
    existing: &crawler_document::Sketch,
    solved: &crawler_sketch::Sketch,
    support: &crawler_document::SketchSupport,
) -> crawler_document::Sketch {
    let mut elements = existing.elements.clone();
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
            Geometry::Line(line) => crawler_document::SketchElement::LineSegment {
                id: entity.id.0.clone(),
                start_nanometers: [line.start.x_nm, line.start.y_nm],
                end_nanometers: [line.end.x_nm, line.end.y_nm],
                construction: entity.construction,
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
        };
        elements.retain(|element| stored_element_id(element) != entity.id.0);
        elements.push(replacement);
    }
    let mut constraints = existing.constraints.clone();
    for (id, constraint) in &solved.constraints {
        // Existing constraints retain their semantic form (including shared
        // parameter bindings and legacy point references). Solver DTOs use
        // literal dimensions, so replacing them would silently sever intent.
        if constraints
            .iter()
            .any(|stored| stored_constraint_id(stored) == id.0)
        {
            continue;
        }
        constraints.push(solver_constraint(id.0.clone(), constraint));
    }
    crawler_document::Sketch {
        id: existing.id.clone(),
        display_name: existing.display_name.clone(),
        component: existing.component.clone(),
        support: support.clone(),
        elements,
        constraints,
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
        | Element::ConstructionLine { id, .. }
        | Element::LineSegment { id, .. } => id,
    }
}

fn stored_constraint_id(constraint: &crawler_document::SketchConstraint) -> &str {
    use crawler_document::SketchConstraint as Constraint;
    match constraint {
        Constraint::Coincident { id, .. }
        | Constraint::Horizontal { id, .. }
        | Constraint::Vertical { id, .. }
        | Constraint::DistanceX { id, .. }
        | Constraint::DistanceY { id, .. }
        | Constraint::PointOnOrigin { id, .. }
        | Constraint::Parallel { id, .. }
        | Constraint::Perpendicular { id, .. }
        | Constraint::Tangent { id, .. }
        | Constraint::Equal { id, .. }
        | Constraint::Distance { id, .. }
        | Constraint::Radius { id, .. }
        | Constraint::Angle { id, .. }
        | Constraint::DistanceLiteral { id, .. }
        | Constraint::RadiusLiteral { id, .. }
        | Constraint::AngleLiteral { id, .. } => id,
    }
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
) -> crawler_document::SketchConstraint {
    use crawler_document::SketchConstraint as Stored;
    match constraint {
        SolverConstraint::Coincident { a, b } => Stored::Coincident {
            id,
            first_point: point_key(a),
            second_point: point_key(b),
        },
        SolverConstraint::Horizontal { line } => Stored::Horizontal {
            id,
            line: line.0.clone(),
        },
        SolverConstraint::Vertical { line } => Stored::Vertical {
            id,
            line: line.0.clone(),
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
        SolverConstraint::Tangent { first, second } => Stored::Tangent {
            id,
            first: first.0.clone(),
            second: second.0.clone(),
        },
        SolverConstraint::Equal { first, second } => Stored::Equal {
            id,
            first: first.0.clone(),
            second: second.0.clone(),
        },
        SolverConstraint::Distance { a, b, distance_nm } => Stored::DistanceLiteral {
            id,
            first: point_key(a),
            second: point_key(b),
            distance_nanometers: *distance_nm,
        },
        SolverConstraint::Radius {
            geometry,
            radius_nm,
        } => Stored::RadiusLiteral {
            id,
            geometry: geometry.0.clone(),
            radius_nanometers: *radius_nm,
        },
        SolverConstraint::Angle {
            first,
            second,
            angle_microdegrees,
        } => Stored::AngleLiteral {
            id,
            first: first.0.clone(),
            second: second.0.clone(),
            angle_microdegrees: *angle_microdegrees,
        },
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
        pub fn new(
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
            self.0
                .dimensions()
                .and_then(|value| {
                    serde_json::to_string(&dimensions_json(value))
                        .map_err(|error| EngineError::Serialization(error.to_string()))
                })
                .map_err(js_error)
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

        #[wasm_bindgen(js_name = dragSketchJson)]
        pub fn drag_sketch_json(&self, request_json: String) -> Result<String, JsValue> {
            self.0.drag_sketch_json(&request_json).map_err(js_error)
        }

        #[wasm_bindgen(js_name = executeFeatureJson)]
        pub fn execute_feature_json(&mut self, envelope_json: String) -> Result<String, JsValue> {
            self.0
                .execute_feature_json(&envelope_json)
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
        BodyId, ComponentId, Document, Feature, ModelVisibility, OperationReference,
        ParameterExpression, ParameterExpressionNode, ParameterValue, SketchElement, SketchId,
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
        serde_json::from_str(
            &runtime
                .execute_new_feature_json(
                    &serde_json::json!({
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
                    .to_string(),
                )
                .unwrap(),
        )
        .unwrap()
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
                deterministic_digest: "runtime-test-fixture".into(),
            },
        }
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
        assert_eq!(runtime.semantic_hash().unwrap(), before_recompute);

        let document: crawler_document::Document =
            serde_json::from_str(&runtime.document_json().unwrap()).unwrap();
        let mut candidate = document.topology_references
            [&crawler_document::TopologyReferenceId::from("topology:extrude-top")]
            .clone();
        candidate.id = "topology:repair-candidate".into();
        candidate.stable_kernel_id = 99;
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
        let accepted: serde_json::Value = serde_json::from_str(
            &runtime
                .explicit_rebind_json(
                    &serde_json::json!({
                        "transaction_id": "transaction:history:repair",
                        "selected": candidate.id,
                        "observed": [candidate]
                    })
                    .to_string(),
                )
                .unwrap(),
        )
        .unwrap();
        assert_eq!(accepted["accepted"], true);
        assert_ne!(runtime.semantic_hash().unwrap(), before_repair);
        assert_eq!(runtime.undo().unwrap(), before_repair);

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
                "removed_face_stable_ids": [1],
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
                    "edge_stable_ids": [edge], "radius_nm": 100000,
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
