use crawler_document::{
    Document, DocumentChange, FeatureId, FeatureInput, FeatureRecomputeState, Parameter,
    ParameterId, ParameterValue, SketchId, TopologyReferenceId, TopologySignature, TransactionId,
};
use crawler_history::DocumentHistory;
use crawler_versioning::{
    ChangeKind, ConflictKind, DocumentRecompute, GeometryPayloadEvidence, MergeError,
    MigrationError, MigrationRegistry, ProvenanceRecord, VersionedDocument, merge_three_way,
    structural_diff,
};
use std::collections::BTreeSet;

fn base_document() -> Document {
    serde_json::from_str(include_str!(
        "../../crawler-document/tests/fixtures/parametric-block.json"
    ))
    .unwrap()
}

fn versioned() -> VersionedDocument {
    let mut document = VersionedDocument::new(base_document());
    document.required_features.insert("document.core".into());
    document.geometry_payloads.insert(
        "body:block".into(),
        GeometryPayloadEvidence {
            media_type: "model/step".into(),
            content_hash: "a".repeat(64),
        },
    );
    document.provenance.insert(
        "body:block".into(),
        ProvenanceRecord {
            source_document: "document:source".into(),
            source_revision: 1,
            source_content_hash: "b".repeat(64),
        },
    );
    document
}

fn commit_branch(
    base: &VersionedDocument,
    id: &str,
    changes: Vec<DocumentChange>,
) -> VersionedDocument {
    let mut history = DocumentHistory::new(base.document.clone());
    history.commit(TransactionId::from(id), changes).unwrap();
    VersionedDocument {
        document: history.accepted().clone(),
        required_features: base.required_features.clone(),
        geometry_payloads: base.geometry_payloads.clone(),
        provenance: base.provenance.clone(),
    }
}

struct FixtureRecompute;

impl DocumentRecompute for FixtureRecompute {
    fn validate_and_recompute(&self, mut document: Document) -> Result<Document, String> {
        let length = |id: &str| match document.parameters[&ParameterId::from(id)].value {
            ParameterValue::LengthNanometers(value) if value > 0 => Ok(value),
            _ => Err(format!("invalid length parameter {id}")),
        };
        let width = length("parameter:width")?;
        let depth = length("parameter:depth")?;
        let height = length("parameter:height")?;
        let reference = document
            .topology_references
            .get_mut(&TopologyReferenceId::from("topology:top-face"))
            .ok_or_else(|| "top face reference is missing".to_owned())?;
        reference.fallback_signature = TopologySignature::Face {
            centroid_nanometers: [width / 2, depth / 2, height],
            normal_millionths: [0, 0, 1_000_000],
            area_square_nanometers: (width as u64)
                .checked_mul(depth as u64)
                .ok_or_else(|| "area overflow".to_owned())?,
        };
        document.recompute.accepted_revision = document.revision;
        for feature in document.features.keys() {
            document.recompute.features.insert(
                feature.clone(),
                FeatureRecomputeState::Clean {
                    evaluated_revision: document.revision,
                },
            );
        }
        Ok(document)
    }
}

#[test]
fn structural_diff_is_stable_cad_aware_and_human_readable() {
    let base = versioned();
    let mut target = base.clone();
    target.document.display_name = "Reviewed Block".into();
    let height = target
        .document
        .parameters
        .get_mut(&ParameterId::from("parameter:height"))
        .unwrap();
    height.display_name = "Overall Height".into();
    height.value = ParameterValue::LengthNanometers(35_000_000);
    target.document.parameters.insert(
        ParameterId::from("parameter:review-note"),
        Parameter {
            id: ParameterId::from("parameter:review-note"),
            display_name: "Review Note".into(),
            value: ParameterValue::Text("approved".into()),
        },
    );
    target
        .document
        .bodies
        .remove(&crawler_document::BodyId::from("body:block"));
    let extrude = target
        .document
        .features
        .get_mut(&FeatureId::from("feature:extrude"))
        .unwrap();
    extrude.suppressed = true;
    extrude.inputs.insert(
        "profile".into(),
        FeatureInput::Sketch("sketch:alternate".into()),
    );
    target
        .document
        .topology_references
        .get_mut(&TopologyReferenceId::from("topology:top-face"))
        .unwrap()
        .stable_token = "extrude:end-reviewed".into();
    target
        .geometry_payloads
        .get_mut("body:block")
        .unwrap()
        .content_hash = "c".repeat(64);

    let diff = structural_diff(&base, &target);
    let kinds: BTreeSet<_> = diff.changes.iter().map(|change| change.kind).collect();
    for expected in [
        ChangeKind::Added,
        ChangeKind::Removed,
        ChangeKind::Renamed,
        ChangeKind::ParameterChanged,
        ChangeKind::FeatureEdited,
        ChangeKind::ReferenceChanged,
        ChangeKind::GeometryPayloadChanged,
    ] {
        assert!(kinds.contains(&expected), "missing {expected:?}");
    }
    let structured = serde_json::to_string(&diff).unwrap();
    assert!(structured.contains("body:block"));
    assert!(structured.contains(&"c".repeat(64)));
    let readable = diff.to_string();
    assert!(readable.contains("ParameterChanged parameter parameter:height"));
    assert!(readable.contains("content"));

    // Rebuilding map storage in reverse insertion order still lands in BTreeMap
    // semantic-ID order and therefore produces no change.
    let mut reordered = base.clone();
    reordered.document.features = base
        .document
        .features
        .iter()
        .rev()
        .map(|(id, feature)| (id.clone(), feature.clone()))
        .collect();
    assert!(structural_diff(&base, &reordered).is_empty());
}

#[test]
fn independent_parameter_and_feature_edits_merge_then_recompute() {
    let base = versioned();
    let left = commit_branch(
        &base,
        "transaction:left-width",
        vec![DocumentChange::SetParameterValue {
            parameter: ParameterId::from("parameter:width"),
            value: ParameterValue::LengthNanometers(50_000_000),
        }],
    );
    let right = commit_branch(
        &base,
        "transaction:right-suppress",
        vec![DocumentChange::SetFeatureSuppressed {
            feature: FeatureId::from("feature:extrude"),
            suppressed: true,
        }],
    );

    let first = merge_three_way(&base, &left, &right, &FixtureRecompute).unwrap();
    let second = merge_three_way(&base, &left, &right, &FixtureRecompute).unwrap();
    assert_eq!(first.merged.semantic_hash(), second.merged.semantic_hash());
    assert_eq!(
        first.merged.document.parameters[&ParameterId::from("parameter:width")].value,
        ParameterValue::LengthNanometers(50_000_000)
    );
    assert!(first.merged.document.features[&FeatureId::from("feature:extrude")].suppressed);
    assert_eq!(first.merged.document.revision, 3);
    assert_eq!(
        first
            .report
            .history_order
            .iter()
            .map(|id| id.0.as_str())
            .collect::<Vec<_>>(),
        vec!["transaction:left-width", "transaction:right-suppress"]
    );
    assert!(
        first
            .merged
            .document
            .recompute
            .features
            .values()
            .all(|state| {
                state
                    == &FeatureRecomputeState::Clean {
                        evaluated_revision: 3,
                    }
            })
    );
}

#[test]
fn overlapping_parameter_and_delete_vs_edit_fail_closed() {
    let base = versioned();
    let left = commit_branch(
        &base,
        "transaction:left-height",
        vec![DocumentChange::SetParameterValue {
            parameter: ParameterId::from("parameter:height"),
            value: ParameterValue::LengthNanometers(40_000_000),
        }],
    );
    let right = commit_branch(
        &base,
        "transaction:right-height",
        vec![DocumentChange::SetParameterValue {
            parameter: ParameterId::from("parameter:height"),
            value: ParameterValue::LengthNanometers(45_000_000),
        }],
    );
    let MergeError::Conflicts(conflicts) =
        merge_three_way(&base, &left, &right, &FixtureRecompute).unwrap_err()
    else {
        panic!("expected conflicts")
    };
    assert!(conflicts.iter().any(|conflict| {
        conflict.kind == ConflictKind::ParameterEdit && conflict.semantic_id == "parameter:height"
    }));

    let mut deleted = base.clone();
    deleted
        .document
        .features
        .remove(&FeatureId::from("feature:extrude"));
    let edited = commit_branch(
        &base,
        "transaction:edit-extrude",
        vec![DocumentChange::SetFeatureSuppressed {
            feature: FeatureId::from("feature:extrude"),
            suppressed: true,
        }],
    );
    let MergeError::Conflicts(conflicts) =
        merge_three_way(&base, &deleted, &edited, &FixtureRecompute).unwrap_err()
    else {
        panic!("expected conflicts")
    };
    assert!(conflicts.iter().any(|conflict| {
        conflict.kind == ConflictKind::DeleteVsEdit && conflict.semantic_id == "feature:extrude"
    }));
}

#[test]
fn topology_and_provenance_overlap_report_typed_conflicts() {
    let base = versioned();
    let mut left = base.clone();
    let mut right = base.clone();
    left.document
        .topology_references
        .get_mut(&TopologyReferenceId::from("topology:top-face"))
        .unwrap()
        .stable_token = "left-token".into();
    right
        .document
        .topology_references
        .get_mut(&TopologyReferenceId::from("topology:top-face"))
        .unwrap()
        .stable_token = "right-token".into();
    left.document
        .features
        .get_mut(&FeatureId::from("feature:extrude"))
        .unwrap()
        .inputs
        .insert(
            "profile".into(),
            FeatureInput::Sketch(SketchId::from("sketch:left-profile")),
        );
    right
        .document
        .features
        .get_mut(&FeatureId::from("feature:extrude"))
        .unwrap()
        .inputs
        .insert(
            "profile".into(),
            FeatureInput::Sketch(SketchId::from("sketch:right-profile")),
        );
    left.provenance
        .get_mut("body:block")
        .unwrap()
        .source_revision = 2;
    right
        .provenance
        .get_mut("body:block")
        .unwrap()
        .source_revision = 3;
    left.geometry_payloads
        .get_mut("body:block")
        .unwrap()
        .content_hash = "c".repeat(64);
    right
        .geometry_payloads
        .get_mut("body:block")
        .unwrap()
        .content_hash = "d".repeat(64);

    let MergeError::Conflicts(conflicts) =
        merge_three_way(&base, &left, &right, &FixtureRecompute).unwrap_err()
    else {
        panic!("expected conflicts")
    };
    assert!(
        conflicts
            .iter()
            .any(|conflict| conflict.kind == ConflictKind::TopologyReferenceEdit)
    );
    assert!(
        conflicts
            .iter()
            .any(|conflict| conflict.kind == ConflictKind::Provenance)
    );
    assert!(
        conflicts
            .iter()
            .any(|conflict| conflict.kind == ConflictKind::FeatureEdit)
    );
    assert!(
        conflicts
            .iter()
            .any(|conflict| conflict.kind == ConflictKind::GeometryPayload)
    );
}

#[test]
fn migration_registry_is_deterministic_idempotent_and_preserves_original() {
    let registry = MigrationRegistry::default();
    assert_eq!(registry.descriptors().len(), 1);
    let input = include_bytes!("fixtures/legacy-v0.json");
    let expected = include_bytes!("fixtures/legacy-v1.json");
    let supported = BTreeSet::from(["document.core".to_owned()]);
    let required = supported.clone();
    let first = registry.migrate(input, &required, &supported, 1).unwrap();
    assert_eq!(first.original_bytes, input);
    assert_eq!(first.migrated_bytes, expected);
    assert_eq!(first.applied_steps, registry.descriptors());

    let second = registry
        .migrate(&first.migrated_bytes, &required, &supported, 1)
        .unwrap();
    assert!(second.applied_steps.is_empty());
    assert_eq!(second.migrated_bytes, first.migrated_bytes);
    assert_eq!(second.document.transactions, first.document.transactions);
}

#[test]
fn migration_refuses_unknown_features_before_interpreting_input() {
    let registry = MigrationRegistry::default();
    let required = BTreeSet::from(["future.boolean.history-v2".to_owned()]);
    let error = registry
        .migrate(b"not json", &required, &BTreeSet::new(), 1)
        .unwrap_err();
    assert!(matches!(
        error,
        MigrationError::UnsupportedRequiredFeature(feature)
            if feature == "future.boolean.history-v2"
    ));
}
