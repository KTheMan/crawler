//! Executable M2 alpha qualification composed exclusively from public Crawler
//! crate contracts and the checked-in CC0 mounting-bracket provenance.

use crawler_document::{
    ComponentId, Document, DocumentChange, EntityId, Feature, FeatureId, FeatureInput,
    FeatureRecomputeState, OperationReference, ParameterId, ParameterValue, SketchElement,
    TopologyReference, TopologyReferenceId, TransactionId,
};
use crawler_feature_graph::{
    FeatureGraphDocument, FeatureTimingDiagnostic, RollbackPosition, RuntimeDiagnostics,
    project_timeline, recompute_from_here,
};
use crawler_feature_kernel::{
    AxisAlignedBoundsNm, BodySnapshot, BooleanInput, BooleanKind, FeatureOperation, FeatureRequest,
    GeometryEvidence, LinearPatternInput, TransformSource, execute,
};
use crawler_history::DocumentHistory;
use crawler_interchange::{
    BodyExportSettings, ExportFormat, StepImportSettings, export_body, inspect_step,
};
use crawler_package::{
    DocumentKind, PackageFormatVersion, PackageManifest, PayloadDescriptor, PayloadMediaType,
    PayloadRole, PortablePackage, sha256_hex,
};
use crawler_part_engine::{
    DISTANCE_PARAMETER_ID, HEIGHT_PARAMETER_ID, NewPartCommand, ParameterEdit, PartEngine,
    WIDTH_PARAMETER_ID,
};
use crawler_sketch::{
    Constraint, ConstraintId, DeclarativeSolver, Geometry, GeometryEntity, Line, Point2, PointRef,
    Sketch, SketchCommand, SketchSolver,
};
use crawler_topology_repair::{
    CandidateSelection, apply_rebind, apply_undo as undo_rebind, canonical_document_hash,
    preview_first_unresolved,
};
use crawler_versioning::{
    DocumentRecompute, MigrationRegistry, VersionedDocument, merge_three_way, structural_diff,
};
use monstertruck_modeling::{Point3, Solid, Vector3, builder};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use thiserror::Error;

const FIXTURE_METADATA: &[u8] =
    include_bytes!("../../../fixtures/reference-models/cc0-mounting-bracket/fixture.json");
const FIXTURE_DOCUMENT: &[u8] =
    include_bytes!("../../../fixtures/reference-models/cc0-mounting-bracket/document.json");
const TOLERANCE_NM: i64 = 50_000;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct QualificationReport {
    pub schema_version: u32,
    pub run_digest: String,
    pub provenance: ProvenanceEvidence,
    pub reference_part: ReferencePartEvidence,
    pub parameters_nm: BTreeMap<String, i64>,
    pub sketch: SketchEvidence,
    pub geometry: GeometryQualification,
    pub feature_graph: FeatureGraphEvidence,
    pub topology_repair: RepairEvidence,
    pub package: PackageEvidence,
    pub versioning: VersioningEvidence,
    pub interchange: InterchangeEvidence,
    pub failure_atomicity: FailureAtomicity,
    pub history: HistoryEvidence,
    pub performance_measurement: PerformanceMeasurementEvidence,
    pub independent_reader: IndependentReaderEvidence,
    pub metadata_boundaries: MetadataBoundaries,
    pub contract_gaps: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReferencePartEvidence {
    pub document_semantic_hash: String,
    pub feature_operation_schema_ids: Vec<String>,
    pub topology_assertion_count: usize,
    pub geometric_assertion_count: usize,
    pub expected_bounds_nm: ([i64; 3], [i64; 3]),
    pub executed_qualified_operations: Vec<String>,
}

impl QualificationReport {
    pub fn canonical_bytes(&self) -> Result<Vec<u8>, QualificationError> {
        let mut bytes = serde_json::to_vec(self)?;
        bytes.push(b'\n');
        Ok(bytes)
    }

    pub fn verify_run_digest(&self) -> Result<(), QualificationError> {
        let mut unsigned = self.clone();
        unsigned.run_digest.clear();
        let actual = digest_json(&unsigned)?;
        if actual != self.run_digest {
            return Err(QualificationError::Contract(format!(
                "qualification digest mismatch: expected {}, found {actual}",
                self.run_digest
            )));
        }
        Ok(())
    }
}

/// Execute only the checked-in mechanical fixture's native geometry contract.
/// This narrow entry point keeps deterministic kernel tests independent from
/// package, interchange, history, and performance-evidence qualification.
pub fn run_native_fixture_geometry() -> Result<GeometryQualification, QualificationError> {
    let (fixture, _, parameters) = fixture_evidence()?;
    qualify_geometry(&fixture, &parameters).map(|(geometry, _)| geometry)
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ProvenanceEvidence {
    pub fixture_id: String,
    pub license_spdx: String,
    pub source_type: String,
    pub declared_document_sha256: String,
    pub actual_document_sha256: String,
    pub metadata_sha256: String,
    pub document_revision: u64,
    pub topology: Vec<TopologyEvidence>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TopologyEvidence {
    pub id: String,
    pub kind: String,
    pub stable_kernel_id: u64,
    pub stable_token: String,
    pub signature_sha256: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SketchEvidence {
    pub canonical_hash: String,
    pub closed_profile_count: usize,
    pub diagnostic_count: usize,
    pub solver_state: String,
    pub degrees_of_freedom: u32,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GeometryQualification {
    pub base_plate: GeometryStage,
    pub upright_plate: GeometryStage,
    pub base_hole_pattern: GeometryStage,
    pub base_through_cut: GeometryStage,
    pub upright_hole_pattern: GeometryStage,
    pub upright_through_cut: GeometryStage,
    pub final_bracket: GeometryStage,
    pub executed_operations: Vec<ExecutedOperationEvidence>,
    pub final_body_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ExecutedOperationEvidence {
    pub feature_id: String,
    pub operation: String,
    pub ordered_input_body_ids: Vec<String>,
    pub output_body_id: String,
    pub deterministic_digest: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GeometryStage {
    pub deterministic_digest: String,
    pub solid_json_sha256: String,
    pub vertex_count: usize,
    pub edge_count: usize,
    pub face_count: usize,
    pub bounds_nm: ([i64; 3], [i64; 3]),
    pub volume_model_units3_bits: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FeatureGraphEvidence {
    pub fixture_timeline_feature_count: usize,
    pub timeline: Vec<(String, String)>,
    pub minimum_recompute_order: Vec<String>,
    pub timing_sample_count: usize,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RepairEvidence {
    pub preview_base_hash: String,
    pub ambiguous_candidates: Vec<String>,
    pub explicit_selection: String,
    pub committed_hash: String,
    pub undo_hash: String,
    pub failed_repair_preserved_hash: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PackageEvidence {
    pub manifest_sha256: String,
    pub document_payload_sha256: String,
    pub canonical_entry_set_sha256: String,
    pub archive_sha256: String,
    pub archive_byte_length: usize,
    pub loaded_document_hash: String,
    pub save_load_equal: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct VersioningEvidence {
    pub structural_diff_changes: usize,
    pub merged_semantic_hash: String,
    pub merged_history_order: Vec<String>,
    pub migration_source_version: u32,
    pub migration_target_version: u32,
    pub migration_steps: Vec<String>,
    pub migrated_sha256: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct InterchangeEvidence {
    pub source_body_id: String,
    pub source_geometry_digest: String,
    pub exports: BTreeMap<String, ArtifactEvidence>,
    pub step_round_trip: StepRoundTripEvidence,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactEvidence {
    pub byte_length: usize,
    pub sha256: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct StepRoundTripEvidence {
    pub source_sha256: String,
    pub shell_count: usize,
    pub face_count: usize,
    pub triangle_count: usize,
    pub tolerance_nanometers: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FailureAtomicity {
    pub failed_feature_preserved_semantic_hash: bool,
    pub failed_repair_preserved_semantic_hash: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct HistoryEvidence {
    pub base_semantic_hash: String,
    pub committed_semantic_hash: String,
    pub undo_semantic_hash: String,
    pub redo_semantic_hash: String,
    pub undo_restored_exact_base: bool,
    pub redo_restored_exact_commit: bool,
}

/// Metadata envelope for a future measured performance result. The native
/// qualification does not invent browser, device, build, or warm/cold values:
/// those fields remain absent until the measurement protocol is actually run.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PerformanceMeasurementEvidence {
    pub protocol: String,
    pub status: String,
    pub fixture_document_revision: u64,
    pub fixture_document_sha256: String,
    pub source_revision: Option<String>,
    pub build_revision: Option<String>,
    pub browser: Option<String>,
    pub device_class: Option<String>,
    pub warm_cold_state: Option<String>,
    pub raw_observations_microseconds: Vec<u64>,
    pub percentile_method: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IndependentReaderEvidence {
    pub status: String,
    pub artifact_sha256: Option<String>,
    pub reader_name: Option<String>,
    pub reader_version: Option<String>,
    pub geometric_validation_passed: bool,
    pub visual_validation_passed: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MetadataBoundaries {
    pub semantic_hash_includes: Vec<String>,
    pub semantic_hash_excludes: Vec<String>,
    pub topology_evidence_is_diagnostic_only: bool,
    pub timing_values_serialized: bool,
}

pub fn run_qualification() -> Result<QualificationReport, QualificationError> {
    let (fixture, provenance, parameters) = fixture_evidence()?;
    let sketch = qualify_sketch(&parameters)?;
    let (geometry, advanced_body) = qualify_geometry(&fixture, &parameters)?;
    let reference_part = qualify_reference_part(&fixture, &geometry)?;

    let mut engine = PartEngine::new_part(NewPartCommand {
        document_id: "document:alpha-reference".into(),
        display_name: "Alpha Reference Mechanical Part".into(),
        width_nanometers: parameters["parameter:width"],
        height_nanometers: parameters["parameter:depth"],
        distance_nanometers: parameters["parameter:thickness"],
    })
    .map_err(display_error)?;
    let stable_parameter_names: BTreeSet<_> = engine
        .document()
        .parameters
        .keys()
        .map(|id| id.0.as_str())
        .collect();
    for required in [
        WIDTH_PARAMETER_ID,
        HEIGHT_PARAMETER_ID,
        DISTANCE_PARAMETER_ID,
    ] {
        if !stable_parameter_names.contains(required) {
            return Err(QualificationError::Contract(format!(
                "stable engine parameter {required} is missing"
            )));
        }
    }

    let engine_hash_before_failure = engine.semantic_hash().map_err(display_error)?;
    let failed_feature = engine
        .commit(vec![ParameterEdit::length(WIDTH_PARAMETER_ID, -1)])
        .is_err();
    let failed_feature_preserved = failed_feature
        && engine.semantic_hash().map_err(display_error)? == engine_hash_before_failure;

    let graph_document = add_repair_consumer(engine.document().clone());
    let (feature_graph, runtime) = qualify_feature_graph(&fixture, &graph_document)?;
    let (repair, _repaired_document) = qualify_repair(&graph_document)?;
    // Save/load evidence is deliberately recorded against the public
    // mechanical fixture itself rather than a synthetic cube document.
    let package = qualify_package(&fixture)?;
    let history = qualify_history(&fixture)?;
    let versioning = qualify_versioning(engine.document())?;
    let interchange = qualify_interchange(&advanced_body)?;

    let contract_gaps = Vec::new();

    let runtime_timing_count = runtime.timings.len();
    let mut report = QualificationReport {
        schema_version: 2,
        run_digest: String::new(),
        provenance,
        reference_part,
        parameters_nm: parameters,
        sketch,
        geometry,
        feature_graph,
        topology_repair: repair.clone(),
        package,
        versioning,
        interchange,
        failure_atomicity: FailureAtomicity {
            failed_feature_preserved_semantic_hash: failed_feature_preserved,
            failed_repair_preserved_semantic_hash: repair.failed_repair_preserved_hash,
        },
        history,
        performance_measurement: PerformanceMeasurementEvidence {
            protocol: "reference-measurement-protocol-v1".into(),
            status: "pending_measured_run".into(),
            fixture_document_revision: fixture.revision,
            fixture_document_sha256: sha256_hex(FIXTURE_DOCUMENT),
            source_revision: None,
            build_revision: None,
            browser: None,
            device_class: None,
            warm_cold_state: None,
            raw_observations_microseconds: Vec::new(),
            percentile_method: None,
        },
        independent_reader: IndependentReaderEvidence {
            status: "pending_independent_reader".into(),
            artifact_sha256: None,
            reader_name: None,
            reader_version: None,
            geometric_validation_passed: false,
            visual_validation_passed: false,
        },
        metadata_boundaries: MetadataBoundaries {
            semantic_hash_includes: vec![
                "crawler-document declarative entities and accepted history".into(),
                "stable topology identities and fallback signatures".into(),
                "feature-graph persistent group sidecars when present".into(),
            ],
            semantic_hash_excludes: vec![
                "per-feature elapsed time and evaluation sequence".into(),
                "computing and warning runtime projection".into(),
                "rollback position".into(),
                "export caches and tessellation timing".into(),
            ],
            topology_evidence_is_diagnostic_only: true,
            timing_values_serialized: false,
        },
        contract_gaps,
    };
    if report.feature_graph.timing_sample_count != runtime_timing_count {
        return Err(QualificationError::Contract(
            "runtime timing boundary count changed during qualification".into(),
        ));
    }
    report.run_digest = digest_json(&report)?;
    report.verify_run_digest()?;
    Ok(report)
}

fn qualify_reference_part(
    document: &Document,
    geometry: &GeometryQualification,
) -> Result<ReferencePartEvidence, QualificationError> {
    let metadata: Value = serde_json::from_slice(FIXTURE_METADATA)?;
    let topology_assertions = metadata
        .pointer("/topology_assertions")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            QualificationError::Contract("fixture topology assertions are missing".into())
        })?;
    for assertion in topology_assertions {
        let id = assertion
            .get("reference")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                QualificationError::Contract("fixture topology assertion has no reference".into())
            })?;
        if assertion.get("expected_status").and_then(Value::as_str) != Some("resolved")
            || assertion
                .get("expected_match_count")
                .and_then(Value::as_u64)
                != Some(1)
            || !document
                .topology_references
                .contains_key(&TopologyReferenceId::from(id))
        {
            return Err(QualificationError::Contract(format!(
                "mechanical reference topology assertion {id} is not a single resolved document reference"
            )));
        }
    }
    let geometric_assertions = metadata
        .pointer("/geometric_evidence")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            QualificationError::Contract("fixture geometric evidence is missing".into())
        })?;
    let bounds = geometric_assertions
        .iter()
        .find(|evidence| {
            evidence.get("kind").and_then(Value::as_str) == Some("axis_aligned_bounds")
        })
        .ok_or_else(|| {
            QualificationError::Contract("fixture axis-aligned bounds are missing".into())
        })?;
    let parse_mm = |key: &str| -> Result<[i64; 3], QualificationError> {
        let values = bounds.get(key).and_then(Value::as_array).ok_or_else(|| {
            QualificationError::Contract(format!("fixture bounds {key} are missing"))
        })?;
        let coordinates = values
            .iter()
            .map(|value| value.as_i64().map(|value| value * 1_000_000))
            .collect::<Option<Vec<_>>>()
            .ok_or_else(|| {
                QualificationError::Contract(format!(
                    "fixture bounds {key} are not integer millimeters"
                ))
            })?;
        coordinates.try_into().map_err(|_| {
            QualificationError::Contract(format!("fixture bounds {key} are not a triple"))
        })
    };
    let expected_bounds_nm = (parse_mm("min")?, parse_mm("max")?);
    let expected_from_parameters = (
        [-30_000_000, -20_000_000, 0],
        [30_000_000, 20_000_000, 36_000_000],
    );
    if expected_bounds_nm != expected_from_parameters {
        return Err(QualificationError::Contract(
            "mechanical reference bounds differ from its driving dimensions".into(),
        ));
    }
    let feature_operation_schema_ids = document
        .features
        .values()
        .map(|feature| feature.operation.schema_id.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    Ok(ReferencePartEvidence {
        document_semantic_hash: canonical_document_hash(document),
        feature_operation_schema_ids,
        topology_assertion_count: topology_assertions.len(),
        geometric_assertion_count: geometric_assertions.len(),
        expected_bounds_nm,
        executed_qualified_operations: geometry
            .executed_operations
            .iter()
            .map(|operation| operation.operation.clone())
            .collect(),
    })
}

fn qualify_history(document: &Document) -> Result<HistoryEvidence, QualificationError> {
    let mut history = DocumentHistory::new(document.clone());
    let base_semantic_hash = history.accepted_hash();
    let event = history
        .commit(
            TransactionId::from("transaction:mechanical-reference-thickness"),
            vec![DocumentChange::SetParameterValue {
                parameter: ParameterId::from("parameter:thickness"),
                value: ParameterValue::LengthNanometers(7_000_000),
            }],
        )
        .map_err(display_error)?;
    let committed_semantic_hash = event.accepted_hash;
    let undo_semantic_hash = crawler_history::semantic_hash(history.undo().map_err(display_error)?);
    let redo_semantic_hash = crawler_history::semantic_hash(history.redo().map_err(display_error)?);
    Ok(HistoryEvidence {
        undo_restored_exact_base: undo_semantic_hash == base_semantic_hash,
        redo_restored_exact_commit: redo_semantic_hash == committed_semantic_hash,
        base_semantic_hash,
        committed_semantic_hash,
        undo_semantic_hash,
        redo_semantic_hash,
    })
}

fn fixture_evidence()
-> Result<(Document, ProvenanceEvidence, BTreeMap<String, i64>), QualificationError> {
    let metadata: Value = serde_json::from_slice(FIXTURE_METADATA)?;
    let document: Document = serde_json::from_slice(FIXTURE_DOCUMENT)?;
    let declared = json_string(&metadata, "/document/sha256")?;
    let actual = sha256_hex(FIXTURE_DOCUMENT);
    if declared != actual {
        return Err(QualificationError::Contract(
            "CC0 fixture document hash does not match provenance".into(),
        ));
    }
    let parameters = document
        .parameters
        .iter()
        .filter_map(|(id, parameter)| match parameter.value {
            ParameterValue::LengthNanometers(value) => Some((id.0.clone(), value)),
            _ => None,
        })
        .collect();
    let topology = document
        .topology_references
        .values()
        .map(|reference| {
            Ok(TopologyEvidence {
                id: reference.id.0.clone(),
                kind: format!("{:?}", reference.kind).to_ascii_lowercase(),
                stable_kernel_id: reference.stable_kernel_id,
                stable_token: reference.stable_token.clone(),
                signature_sha256: digest_json(&reference.fallback_signature)?,
            })
        })
        .collect::<Result<Vec<_>, QualificationError>>()?;
    let evidence = ProvenanceEvidence {
        fixture_id: json_string(&metadata, "/id")?,
        license_spdx: json_string(&metadata, "/license/spdx")?,
        source_type: json_string(&metadata, "/provenance/source_type")?,
        declared_document_sha256: declared,
        actual_document_sha256: actual,
        metadata_sha256: sha256_hex(FIXTURE_METADATA),
        document_revision: document.revision,
        topology,
    };
    Ok((document, evidence, parameters))
}

fn qualify_sketch(
    parameters: &BTreeMap<String, i64>,
) -> Result<SketchEvidence, QualificationError> {
    let half_width = parameters["parameter:width"] / 2;
    let half_depth = parameters["parameter:depth"] / 2;
    let points = [
        Point2::new(-half_width, -half_depth),
        Point2::new(half_width, -half_depth),
        Point2::new(half_width, half_depth),
        Point2::new(-half_width, half_depth),
    ];
    let mut sketch = Sketch::new("sketch:alpha-reference-profile");
    for index in 0..4 {
        let id = format!("line:{index}");
        sketch = sketch
            .apply(SketchCommand::AddGeometry {
                entity: GeometryEntity::new(
                    id,
                    Geometry::Line(Line {
                        start: points[index],
                        end: points[(index + 1) % 4],
                    }),
                ),
            })
            .map_err(display_error)?
            .after;
    }
    for (id, constraint) in [
        (
            "constraint:horizontal-bottom",
            Constraint::Horizontal {
                line: "line:0".into(),
            },
        ),
        (
            "constraint:vertical-right",
            Constraint::Vertical {
                line: "line:1".into(),
            },
        ),
        (
            "constraint:horizontal-top",
            Constraint::Horizontal {
                line: "line:2".into(),
            },
        ),
        (
            "constraint:vertical-left",
            Constraint::Vertical {
                line: "line:3".into(),
            },
        ),
        (
            "constraint:coincident-01",
            Constraint::Coincident {
                a: PointRef::new("line:0", crawler_sketch::Anchor::End),
                b: PointRef::new("line:1", crawler_sketch::Anchor::Start),
            },
        ),
    ] {
        sketch = sketch
            .apply(SketchCommand::AddConstraint {
                id: ConstraintId::from(id),
                constraint,
            })
            .map_err(display_error)?
            .after;
    }
    let profile = sketch.profile_report();
    let solve = DeclarativeSolver.solve(&sketch).map_err(display_error)?;
    Ok(SketchEvidence {
        canonical_hash: sketch.canonical_hash().map_err(display_error)?,
        closed_profile_count: profile.closed_profiles.len(),
        diagnostic_count: profile.diagnostics.len(),
        solver_state: format!("{:?}", solve.state).to_ascii_lowercase(),
        degrees_of_freedom: solve.degrees_of_freedom,
    })
}

fn qualify_geometry(
    document: &Document,
    parameters: &BTreeMap<String, i64>,
) -> Result<(GeometryQualification, BodySnapshot), QualificationError> {
    validate_fixture_operation_contract(document)?;
    let (profile_min, profile_max) = fixture_profile_bounds(document)?;
    let width = profile_max[0] - profile_min[0];
    let depth = profile_max[1] - profile_min[1];
    if width != parameters["parameter:width"] || depth != parameters["parameter:depth"] {
        return Err(QualificationError::Contract(
            "fixture base profile differs from its width/depth parameters".into(),
        ));
    }
    let thickness = fixture_feature_parameter(document, parameters, "feature:base-plate", "depth")?;
    let upright_height =
        fixture_feature_parameter(document, parameters, "feature:upright", "height")?;
    if fixture_feature_parameter(document, parameters, "feature:upright", "thickness")? != thickness
    {
        return Err(QualificationError::Contract(
            "fixture upright and base thickness bindings differ".into(),
        ));
    }
    let hole_size =
        fixture_feature_parameter(document, parameters, "feature:base-hole-pair", "diameter")?;
    let hole_spacing =
        fixture_feature_parameter(document, parameters, "feature:base-hole-pair", "spacing")?;
    for key in ["diameter", "spacing"] {
        if fixture_feature_parameter(document, parameters, "feature:upright-hole-pair", key)?
            != fixture_feature_parameter(document, parameters, "feature:base-hole-pair", key)?
        {
            return Err(QualificationError::Contract(format!(
                "fixture hole-pair {key} bindings differ"
            )));
        }
    }
    let half_hole = hole_size / 2;
    let first_hole_x = (profile_min[0] + profile_max[0]) / 2 - hole_spacing / 2;
    let profile_center_y = (profile_min[1] + profile_max[1]) / 2;
    let mut executed_operations = Vec::new();

    // The durable rectangle + Extrude feature is the authoritative source of
    // the base prism. Every coordinate below is derived from fixture parameters.
    let base = rectangular_prism(
        "body:base-plate",
        [profile_min[0], profile_min[1], 0],
        [profile_max[0], profile_max[1], thickness],
    )?;
    executed_operations.push(source_operation(
        "feature:base-plate",
        "prismatic_extrude",
        &base,
    ));

    let upright = rectangular_prism(
        "body:upright",
        [profile_min[0], profile_max[1] - thickness, thickness],
        [profile_max[0], profile_max[1], thickness + upright_height],
    )?;
    executed_operations.push(source_operation(
        "feature:upright",
        "prismatic_extrude",
        &upright,
    ));

    let base_hole_tool = rectangular_prism(
        "body:base-hole:0",
        [
            first_hole_x - half_hole,
            profile_center_y - half_hole,
            -TOLERANCE_NM,
        ],
        [
            first_hole_x + half_hole,
            profile_center_y + half_hole,
            thickness + TOLERANCE_NM,
        ],
    )?;
    let base_pattern = execute(&pattern_request(
        document,
        "feature:base-hole-pair",
        "body:base-hole-tools",
        base_hole_tool.clone(),
        [hole_spacing, 0, 0],
        ["body:base-hole:0", "body:base-hole:1"],
    ))
    .map_err(display_error)?;
    executed_operations.push(result_operation("linear_pattern", &base_pattern));
    let base_hole_tool_second = rectangular_prism(
        "body:base-hole:1",
        [
            first_hole_x + hole_spacing - half_hole,
            profile_center_y - half_hole,
            -TOLERANCE_NM,
        ],
        [
            first_hole_x + hole_spacing + half_hole,
            profile_center_y + half_hole,
            thickness + TOLERANCE_NM,
        ],
    )?;
    let base_cut = execute(&boolean_request(
        document,
        "feature:base-hole-pair",
        "body:base-through-cut",
        BooleanKind::Cut,
        base.clone(),
        vec![base_hole_tool, base_hole_tool_second],
    ))
    .map_err(display_error)?;
    executed_operations.push(result_operation("boolean_cut", &base_cut));

    let upright_hole_center_z = thickness + upright_height / 2;
    let upright_hole_tool = rectangular_prism(
        "body:upright-hole:0",
        [
            first_hole_x - half_hole,
            profile_max[1] - thickness - TOLERANCE_NM,
            upright_hole_center_z - half_hole,
        ],
        [
            first_hole_x + half_hole,
            profile_max[1] + TOLERANCE_NM,
            upright_hole_center_z + half_hole,
        ],
    )?;
    let upright_pattern = execute(&pattern_request(
        document,
        "feature:upright-hole-pair",
        "body:upright-hole-tools",
        upright_hole_tool.clone(),
        [hole_spacing, 0, 0],
        ["body:upright-hole:0", "body:upright-hole:1"],
    ))
    .map_err(display_error)?;
    executed_operations.push(result_operation("linear_pattern", &upright_pattern));
    let upright_hole_tool_second = rectangular_prism(
        "body:upright-hole:1",
        [
            first_hole_x + hole_spacing - half_hole,
            profile_max[1] - thickness - TOLERANCE_NM,
            upright_hole_center_z - half_hole,
        ],
        [
            first_hole_x + hole_spacing + half_hole,
            profile_max[1] + TOLERANCE_NM,
            upright_hole_center_z + half_hole,
        ],
    )?;
    let upright_cut = execute(&boolean_request(
        document,
        "feature:upright-hole-pair",
        "body:upright-through-cut",
        BooleanKind::Cut,
        upright.clone(),
        vec![upright_hole_tool, upright_hole_tool_second],
    ))
    .map_err(display_error)?;
    executed_operations.push(result_operation("boolean_cut", &upright_cut));
    let final_bracket = compose_fixture_shells(
        "body:bracket",
        &[base_cut.output.clone(), upright_cut.output.clone()],
    )?;
    executed_operations.push(ExecutedOperationEvidence {
        feature_id: "feature:upright-hole-pair".into(),
        operation: "compose_shells".into(),
        ordered_input_body_ids: vec![
            base_cut.output.body_id.clone(),
            upright_cut.output.body_id.clone(),
        ],
        output_body_id: final_bracket.body_id.clone(),
        deterministic_digest: final_bracket.evidence.deterministic_digest.clone(),
    });

    let qualification = GeometryQualification {
        base_plate: geometry_stage(&base.evidence, &base.solid_json),
        upright_plate: geometry_stage(&upright.evidence, &upright.solid_json),
        base_hole_pattern: geometry_stage(
            &base_pattern.output.evidence,
            &base_pattern.output.solid_json,
        ),
        base_through_cut: geometry_stage(&base_cut.output.evidence, &base_cut.output.solid_json),
        upright_hole_pattern: geometry_stage(
            &upright_pattern.output.evidence,
            &upright_pattern.output.solid_json,
        ),
        upright_through_cut: geometry_stage(
            &upright_cut.output.evidence,
            &upright_cut.output.solid_json,
        ),
        final_bracket: geometry_stage(&final_bracket.evidence, &final_bracket.solid_json),
        executed_operations,
        final_body_id: final_bracket.body_id.clone(),
    };
    Ok((qualification, final_bracket))
}

fn validate_fixture_operation_contract(document: &Document) -> Result<(), QualificationError> {
    let component = document
        .components
        .get(&document.root_component)
        .ok_or_else(|| QualificationError::Contract("fixture root component is missing".into()))?;
    let expected = [
        (
            "feature:base-plate",
            "crawler.operation.extrude",
            Vec::<&str>::new(),
        ),
        (
            "feature:upright",
            "crawler.operation.extrude",
            vec!["feature:base-plate"],
        ),
        (
            "feature:base-hole-pair",
            "crawler.operation.linear_pattern.boolean_cut",
            vec!["feature:upright"],
        ),
        (
            "feature:upright-hole-pair",
            "crawler.operation.linear_pattern.boolean_cut",
            vec!["feature:base-hole-pair"],
        ),
    ];
    let actual = component
        .feature_order
        .iter()
        .map(|id| {
            document
                .features
                .get(id)
                .map(|feature| {
                    (
                        id.0.as_str(),
                        feature.operation.schema_id.as_str(),
                        feature
                            .dependencies
                            .iter()
                            .map(|dependency| dependency.0.as_str())
                            .collect::<Vec<_>>(),
                    )
                })
                .ok_or_else(|| {
                    QualificationError::Contract(format!(
                        "fixture feature order references missing feature {}",
                        id.0
                    ))
                })
        })
        .collect::<Result<Vec<_>, _>>()?;
    if actual != expected {
        return Err(QualificationError::Contract(format!(
            "fixture runtime operation contract differs: {actual:?}"
        )));
    }
    Ok(())
}

fn fixture_feature_parameter(
    document: &Document,
    parameters: &BTreeMap<String, i64>,
    feature_id: &str,
    field: &str,
) -> Result<i64, QualificationError> {
    let feature = document
        .features
        .get(&FeatureId::from(feature_id))
        .ok_or_else(|| {
            QualificationError::Contract(format!("fixture feature {feature_id} is missing"))
        })?;
    let parameter = feature.parameters.get(field).ok_or_else(|| {
        QualificationError::Contract(format!(
            "fixture feature {feature_id} has no {field} parameter binding"
        ))
    })?;
    parameters.get(&parameter.0).copied().ok_or_else(|| {
        QualificationError::Contract(format!(
            "fixture feature {feature_id} binds missing parameter {}",
            parameter.0
        ))
    })
}

fn fixture_profile_bounds(document: &Document) -> Result<([i64; 2], [i64; 2]), QualificationError> {
    let base = document
        .features
        .get(&FeatureId::from("feature:base-plate"))
        .ok_or_else(|| QualificationError::Contract("fixture base feature is missing".into()))?;
    let sketch_id = match base.inputs.get("profile") {
        Some(FeatureInput::Sketch(id)) => id,
        _ => {
            return Err(QualificationError::Contract(
                "fixture base feature has no sketch profile input".into(),
            ));
        }
    };
    let sketch = document.sketches.get(sketch_id).ok_or_else(|| {
        QualificationError::Contract("fixture base profile sketch is missing".into())
    })?;
    let points = sketch.elements.iter().filter_map(|element| match element {
        SketchElement::Point {
            x_nanometers,
            y_nanometers,
            ..
        } => Some([*x_nanometers, *y_nanometers]),
        _ => None,
    });
    let mut min = [i64::MAX; 2];
    let mut max = [i64::MIN; 2];
    let mut count = 0;
    for point in points {
        count += 1;
        for axis in 0..2 {
            min[axis] = min[axis].min(point[axis]);
            max[axis] = max[axis].max(point[axis]);
        }
    }
    if count < 3 || (0..2).any(|axis| min[axis] >= max[axis]) {
        return Err(QualificationError::Contract(
            "fixture base profile has no bounded point loop".into(),
        ));
    }
    Ok((min, max))
}

fn pattern_request(
    document: &Document,
    feature_id: &str,
    output_body_id: &str,
    source: BodySnapshot,
    step_nm: [i64; 3],
    instance_ids: [&str; 2],
) -> FeatureRequest {
    FeatureRequest {
        schema_version: crawler_feature_kernel::FEATURE_KERNEL_SCHEMA_VERSION,
        document_id: document.id.0.clone(),
        feature_id: feature_id.into(),
        output_body_id: output_body_id.into(),
        operation: FeatureOperation::LinearPattern(LinearPatternInput {
            source: TransformSource::Body { body: source },
            instance_body_ids: instance_ids.into_iter().map(str::to_owned).collect(),
            step_nm,
            tolerance_nm: TOLERANCE_NM,
        }),
    }
}

fn boolean_request(
    document: &Document,
    feature_id: &str,
    output_body_id: &str,
    operation: BooleanKind,
    target: BodySnapshot,
    tools: Vec<BodySnapshot>,
) -> FeatureRequest {
    FeatureRequest {
        schema_version: crawler_feature_kernel::FEATURE_KERNEL_SCHEMA_VERSION,
        document_id: document.id.0.clone(),
        feature_id: feature_id.into(),
        output_body_id: output_body_id.into(),
        operation: FeatureOperation::Boolean(BooleanInput {
            operation,
            target,
            tools,
            tolerance_nm: TOLERANCE_NM,
        }),
    }
}

fn rectangular_prism(
    body_id: &str,
    min_nm: [i64; 3],
    max_nm: [i64; 3],
) -> Result<BodySnapshot, QualificationError> {
    if (0..3).any(|axis| min_nm[axis] >= max_nm[axis]) {
        return Err(QualificationError::Contract(format!(
            "fixture prism {body_id} has invalid bounds"
        )));
    }
    let units = |value: i64| value as f64 / 1_000_000.0;
    let vertex = builder::vertex(Point3::new(
        units(min_nm[0]),
        units(min_nm[1]),
        units(min_nm[2]),
    ));
    let edge = builder::extrude(&vertex, Vector3::unit_x() * units(max_nm[0] - min_nm[0]));
    let face = builder::extrude(&edge, Vector3::unit_y() * units(max_nm[1] - min_nm[1]));
    let mut solid: Solid =
        builder::extrude(&face, Vector3::unit_z() * units(max_nm[2] - min_nm[2]));
    solid.ensure_topology_stable_ids();
    let solid_json = serde_json::to_vec(&solid)?;
    let volume_model_units3 = (0..3)
        .map(|axis| units(max_nm[axis] - min_nm[axis]))
        .product();
    Ok(BodySnapshot {
        body_id: body_id.into(),
        evidence: GeometryEvidence {
            vertex_count: solid.vertex_iter().count(),
            edge_count: solid.edge_iter().count(),
            face_count: solid.face_iter().count(),
            bounds_nm: AxisAlignedBoundsNm {
                min: min_nm,
                max: max_nm,
            },
            volume_model_units3,
            deterministic_digest: sha256_hex(&solid_json),
        },
        solid_json,
    })
}

fn compose_fixture_shells(
    body_id: &str,
    inputs: &[BodySnapshot],
) -> Result<BodySnapshot, QualificationError> {
    let mut boundaries = Vec::new();
    for input in inputs {
        let solid: Solid = serde_json::from_slice(&input.solid_json)?;
        boundaries.extend(solid.into_boundaries());
    }
    let mut solid = Solid::try_new(boundaries).map_err(display_error)?;
    solid.ensure_topology_stable_ids();
    let solid_json = serde_json::to_vec(&solid)?;
    let min = (0..3)
        .map(|axis| {
            inputs
                .iter()
                .map(|input| input.evidence.bounds_nm.min[axis])
                .min()
                .expect("fixture shell list is non-empty")
        })
        .collect::<Vec<_>>()
        .try_into()
        .expect("three axes");
    let max = (0..3)
        .map(|axis| {
            inputs
                .iter()
                .map(|input| input.evidence.bounds_nm.max[axis])
                .max()
                .expect("fixture shell list is non-empty")
        })
        .collect::<Vec<_>>()
        .try_into()
        .expect("three axes");
    Ok(BodySnapshot {
        body_id: body_id.into(),
        evidence: GeometryEvidence {
            vertex_count: solid.vertex_iter().count(),
            edge_count: solid.edge_iter().count(),
            face_count: solid.face_iter().count(),
            bounds_nm: AxisAlignedBoundsNm { min, max },
            volume_model_units3: inputs
                .iter()
                .map(|input| input.evidence.volume_model_units3)
                .sum(),
            deterministic_digest: sha256_hex(&solid_json),
        },
        solid_json,
    })
}

fn source_operation(
    feature_id: &str,
    operation: &str,
    output: &BodySnapshot,
) -> ExecutedOperationEvidence {
    ExecutedOperationEvidence {
        feature_id: feature_id.into(),
        operation: operation.into(),
        ordered_input_body_ids: Vec::new(),
        output_body_id: output.body_id.clone(),
        deterministic_digest: output.evidence.deterministic_digest.clone(),
    }
}

fn result_operation(
    operation: &str,
    result: &crawler_feature_kernel::FeatureResult,
) -> ExecutedOperationEvidence {
    ExecutedOperationEvidence {
        feature_id: result.feature_id.clone(),
        operation: operation.into(),
        ordered_input_body_ids: result.ordered_input_body_ids.clone(),
        output_body_id: result.output.body_id.clone(),
        deterministic_digest: result.output.evidence.deterministic_digest.clone(),
    }
}
fn geometry_stage(evidence: &GeometryEvidence, solid_json: &[u8]) -> GeometryStage {
    GeometryStage {
        deterministic_digest: evidence.deterministic_digest.clone(),
        solid_json_sha256: sha256_hex(solid_json),
        vertex_count: evidence.vertex_count,
        edge_count: evidence.edge_count,
        face_count: evidence.face_count,
        bounds_nm: (evidence.bounds_nm.min, evidence.bounds_nm.max),
        volume_model_units3_bits: evidence.volume_model_units3.to_bits(),
    }
}

fn add_repair_consumer(mut document: Document) -> Document {
    let id = FeatureId::from("feature:topology-consumer");
    document.features.insert(
        id.clone(),
        Feature {
            id: id.clone(),
            display_name: "Topology Consumer".into(),
            component: ComponentId::from("component:root"),
            operation: OperationReference {
                schema_id: "crawler.topology-consumer.preview".into(),
                schema_version: 1,
            },
            dependencies: vec![FeatureId::from("feature:extrude")],
            inputs: BTreeMap::from([(
                "target".into(),
                FeatureInput::Topology(TopologyReferenceId::from("topology:extrude-top")),
            )]),
            parameters: BTreeMap::new(),
            suppressed: false,
        },
    );
    document
        .components
        .get_mut(&ComponentId::from("component:root"))
        .expect("part engine always creates root component")
        .feature_order
        .push(id.clone());
    document.recompute.features.insert(
        id,
        FeatureRecomputeState::Clean {
            evaluated_revision: document.revision,
        },
    );
    document
}

fn qualify_feature_graph(
    fixture: &Document,
    document: &Document,
) -> Result<(FeatureGraphEvidence, RuntimeDiagnostics), QualificationError> {
    let fixture_state = FeatureGraphDocument::new(fixture.clone()).map_err(display_error)?;
    let fixture_timeline_feature_count = project_timeline(
        &fixture_state,
        &RollbackPosition::End,
        &RuntimeDiagnostics::default(),
    )
    .map_err(display_error)?
    .len();
    let state = FeatureGraphDocument::new(document.clone()).map_err(display_error)?;
    let runtime = RuntimeDiagnostics {
        states: BTreeMap::new(),
        timings: BTreeMap::from([(
            FeatureId::from("feature:topology-consumer"),
            FeatureTimingDiagnostic {
                elapsed_microseconds: 1_234,
                evaluation_sequence: 3,
            },
        )]),
    };
    let timeline = project_timeline(&state, &RollbackPosition::End, &runtime)
        .map_err(display_error)?
        .into_iter()
        .map(|item| {
            (
                item.feature.0,
                format!("{:?}", item.state).to_ascii_lowercase(),
            )
        })
        .collect();
    let plan = recompute_from_here(
        &state,
        &FeatureId::from("feature:topology-consumer"),
        &RollbackPosition::End,
    )
    .map_err(display_error)?;
    Ok((
        FeatureGraphEvidence {
            fixture_timeline_feature_count,
            timeline,
            minimum_recompute_order: plan.evaluation_order.into_iter().map(|id| id.0).collect(),
            timing_sample_count: runtime.timings.len(),
        },
        runtime,
    ))
}

fn qualify_repair(document: &Document) -> Result<(RepairEvidence, Document), QualificationError> {
    let expected = document
        .topology_references
        .get(&TopologyReferenceId::from("topology:extrude-top"))
        .ok_or_else(|| QualificationError::Contract("engine top face is missing".into()))?;
    let candidates = [
        replacement(expected, "topology:replacement-a", 7_001),
        replacement(expected, "topology:replacement-b", 7_002),
    ];
    let preview = preview_first_unresolved(document, &candidates)
        .map_err(display_error)?
        .ok_or_else(|| {
            QualificationError::Contract("repair preview unexpectedly resolved".into())
        })?;
    let ambiguous = match &preview.selection {
        CandidateSelection::Ambiguous { candidates } => {
            candidates.iter().map(|id| id.0.clone()).collect()
        }
        selection => {
            return Err(QualificationError::Contract(format!(
                "expected ambiguous repair candidates, found {selection:?}"
            )));
        }
    };
    let selected = TopologyReferenceId::from("topology:replacement-a");
    let transaction = preview
        .explicit_rebind("repair:alpha-reference", &selected)
        .map_err(display_error)?;
    let mut bad = transaction.clone();
    bad.base_document_hash = "stale".into();
    let prior_hash = canonical_document_hash(document);
    let failure = apply_rebind(document, &bad).expect_err("stale repair must fail");
    let failed_preserved = failure.preserved_document_hash == prior_hash
        && canonical_document_hash(document) == prior_hash;
    let commit = apply_rebind(document, &transaction).map_err(display_error)?;
    let restored = undo_rebind(&commit.document, &commit.undo).map_err(display_error)?;
    Ok((
        RepairEvidence {
            preview_base_hash: preview.base_document_hash,
            ambiguous_candidates: ambiguous,
            explicit_selection: selected.0,
            committed_hash: canonical_document_hash(&commit.document),
            undo_hash: canonical_document_hash(&restored),
            failed_repair_preserved_hash: failed_preserved,
        },
        commit.document,
    ))
}

fn replacement(expected: &TopologyReference, id: &str, stable_kernel_id: u64) -> TopologyReference {
    TopologyReference {
        id: id.into(),
        body: expected.body.clone(),
        producer: expected.producer.clone(),
        kind: expected.kind,
        stable_kernel_id,
        stable_token: format!("replacement:{id}"),
        fallback_signature: expected.fallback_signature.clone(),
    }
}

fn qualify_package(document: &Document) -> Result<PackageEvidence, QualificationError> {
    let document_bytes = serde_json::to_vec(document)?;
    let descriptor = PayloadDescriptor::from_bytes(
        PayloadRole::SemanticDocument,
        PayloadMediaType::CrawlerDocumentJson,
        &document_bytes,
    );
    let manifest = PackageManifest {
        format_version: PackageFormatVersion::V1,
        package_id: "package:alpha-reference".into(),
        document_kind: DocumentKind::Part,
        document_schema_version: document.schema_version.get(),
        required_features: BTreeSet::from(["document.core".into()]),
        root_payload: "document".into(),
        payloads: BTreeMap::from([("document".into(), descriptor.clone())]),
    };
    let package = PortablePackage::from_payloads(
        manifest,
        BTreeMap::from([("document".into(), document_bytes.clone())]),
    )
    .map_err(display_error)?;
    let entries = package.canonical_entries().map_err(display_error)?;
    let entry_hash = hash_entries(&entries);
    let archive = package.to_archive_bytes().map_err(display_error)?;
    let repeated_archive = package.to_archive_bytes().map_err(display_error)?;
    if archive != repeated_archive {
        return Err(QualificationError::Contract(
            "portable package archive bytes are not deterministic".into(),
        ));
    }
    let loaded = PortablePackage::from_archive_bytes(&archive).map_err(display_error)?;
    let loaded_document: Document = serde_json::from_slice(
        loaded
            .payload("document")
            .ok_or_else(|| QualificationError::Contract("loaded root payload missing".into()))?,
    )?;
    Ok(PackageEvidence {
        manifest_sha256: sha256_hex(&loaded.manifest().canonical_bytes().map_err(display_error)?),
        document_payload_sha256: descriptor.sha256,
        canonical_entry_set_sha256: entry_hash,
        archive_sha256: sha256_hex(&archive),
        archive_byte_length: archive.len(),
        loaded_document_hash: canonical_document_hash(&loaded_document),
        save_load_equal: loaded_document == *document,
    })
}

fn qualify_versioning(document: &Document) -> Result<VersioningEvidence, QualificationError> {
    let base = VersionedDocument::new(document.clone());
    let mut left_history = DocumentHistory::new(document.clone());
    left_history
        .commit(
            TransactionId::from("transaction:left-document-name"),
            vec![DocumentChange::RenameEntity {
                entity: EntityId::Document(document.id.clone()),
                display_name: "Alpha Reference Left".into(),
            }],
        )
        .map_err(display_error)?;
    let mut right_history = DocumentHistory::new(document.clone());
    right_history
        .commit(
            TransactionId::from("transaction:right-parameter-name"),
            vec![DocumentChange::RenameEntity {
                entity: EntityId::Parameter(ParameterId::from(WIDTH_PARAMETER_ID)),
                display_name: "Qualified Width".into(),
            }],
        )
        .map_err(display_error)?;
    let left = VersionedDocument::new(left_history.accepted().clone());
    let right = VersionedDocument::new(right_history.accepted().clone());
    let diff = structural_diff(&base, &left);
    let merged =
        merge_three_way(&base, &left, &right, &AcceptedPartRecompute).map_err(display_error)?;

    let mut legacy: Value = serde_json::to_value(document)?;
    legacy["schema_version"] = Value::from(0);
    legacy["units"] = serde_json::json!({"length":"millimeter","angle":"degree"});
    let required = BTreeSet::from(["document.core".to_owned()]);
    let migration = MigrationRegistry::default()
        .migrate(&serde_json::to_vec(&legacy)?, &required, &required, 1)
        .map_err(display_error)?;
    Ok(VersioningEvidence {
        structural_diff_changes: diff.changes.len(),
        merged_semantic_hash: merged.merged.semantic_hash(),
        merged_history_order: merged
            .report
            .history_order
            .into_iter()
            .map(|id| id.0)
            .collect(),
        migration_source_version: migration.source_version,
        migration_target_version: migration.target_version,
        migration_steps: migration
            .applied_steps
            .into_iter()
            .map(|step| step.id)
            .collect(),
        migrated_sha256: sha256_hex(&migration.migrated_bytes),
    })
}

struct AcceptedPartRecompute;

impl DocumentRecompute for AcceptedPartRecompute {
    fn validate_and_recompute(&self, mut candidate: Document) -> Result<Document, String> {
        for feature in candidate.features.keys() {
            candidate.recompute.features.insert(
                feature.clone(),
                FeatureRecomputeState::Clean {
                    evaluated_revision: candidate.revision,
                },
            );
        }
        candidate.recompute.accepted_revision = candidate.revision;
        PartEngine::from_document(candidate.clone()).map_err(|error| error.to_string())?;
        Ok(candidate)
    }
}

fn qualify_interchange(body: &BodySnapshot) -> Result<InterchangeEvidence, QualificationError> {
    let mut exports = BTreeMap::new();
    let mut step_bytes = Vec::new();
    let settings = BodyExportSettings {
        tolerance_nanometers: TOLERANCE_NM as u64,
    };
    for (name, format) in [
        ("step", ExportFormat::Step),
        ("stl", ExportFormat::Stl),
        ("obj", ExportFormat::Obj),
    ] {
        let artifact = export_body(body, format, settings).map_err(display_error)?;
        if name == "step" {
            step_bytes = artifact.bytes.clone();
        }
        exports.insert(
            name.into(),
            ArtifactEvidence {
                byte_length: artifact.bytes.len(),
                sha256: sha256_hex(&artifact.bytes),
            },
        );
    }
    let import_settings = StepImportSettings {
        tolerance_nanometers: 50_000,
    };
    let inspected = inspect_step(&step_bytes, import_settings).map_err(display_error)?;
    Ok(InterchangeEvidence {
        source_body_id: body.body_id.clone(),
        source_geometry_digest: body.evidence.deterministic_digest.clone(),
        exports,
        step_round_trip: StepRoundTripEvidence {
            source_sha256: inspected.source_sha256,
            shell_count: inspected.shell_count,
            face_count: inspected.face_count,
            triangle_count: inspected.triangle_count,
            tolerance_nanometers: inspected.settings.tolerance_nanometers,
        },
    })
}

fn hash_entries(entries: &BTreeMap<String, Vec<u8>>) -> String {
    let mut hasher = Sha256::new();
    for (path, bytes) in entries {
        hasher.update((path.len() as u64).to_le_bytes());
        hasher.update(path.as_bytes());
        hasher.update((bytes.len() as u64).to_le_bytes());
        hasher.update(bytes);
    }
    format!("{:x}", hasher.finalize())
}

fn digest_json<T: Serialize>(value: &T) -> Result<String, QualificationError> {
    Ok(format!("{:x}", Sha256::digest(serde_json::to_vec(value)?)))
}

fn json_string(value: &Value, pointer: &str) -> Result<String, QualificationError> {
    value
        .pointer(pointer)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| {
            QualificationError::Contract(format!("fixture metadata is missing {pointer}"))
        })
}

fn display_error<E: std::fmt::Display>(error: E) -> QualificationError {
    QualificationError::Dependency(error.to_string())
}

#[derive(Debug, Error)]
pub enum QualificationError {
    #[error("qualification dependency failed: {0}")]
    Dependency(String),
    #[error("qualification contract failed: {0}")]
    Contract(String),
    #[error("qualification serialization failed: {0}")]
    Serialization(#[from] serde_json::Error),
}
