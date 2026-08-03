use crawler_document::{
    ComponentId, Document, Feature, FeatureId, FeatureInput, FeatureRecomputeState,
    OperationReference, TopologyKind, TopologyReference, TopologyReferenceId, TopologySignature,
};
use crawler_topology_repair::{
    CandidateSelection, RepairErrorKind, RepairInspection, UnresolvedCause, apply_rebind,
    apply_undo, canonical_document_hash, draft_explicit_rebind, inspect_topology_repair,
    preview_first_unresolved, summarize_downstream_recovery,
};
use std::collections::BTreeMap;

const FIXTURE: &str = include_str!("../../crawler-document/tests/fixtures/parametric-block.json");

fn repair_document() -> Document {
    let mut document: Document = serde_json::from_str(FIXTURE.trim_end()).unwrap();
    let old = TopologyReferenceId::from("topology:top-face");
    let fillet_id = FeatureId::from("feature:fillet");
    let finish_id = FeatureId::from("feature:finish");
    document.features.insert(
        fillet_id.clone(),
        Feature {
            id: fillet_id.clone(),
            display_name: "Fillet".into(),
            component: ComponentId::from("component:root"),
            operation: OperationReference {
                schema_id: "crawler.operation.fillet".into(),
                schema_version: 1,
            },
            dependencies: vec![FeatureId::from("feature:extrude")],
            inputs: BTreeMap::from([("target".into(), FeatureInput::Topology(old))]),
            parameters: BTreeMap::new(),
            suppressed: false,
        },
    );
    document.features.insert(
        finish_id.clone(),
        Feature {
            id: finish_id.clone(),
            display_name: "Finish".into(),
            component: ComponentId::from("component:root"),
            operation: OperationReference {
                schema_id: "crawler.operation.finish".into(),
                schema_version: 1,
            },
            dependencies: vec![fillet_id.clone()],
            inputs: BTreeMap::new(),
            parameters: BTreeMap::new(),
            suppressed: false,
        },
    );
    document
        .components
        .get_mut(&ComponentId::from("component:root"))
        .unwrap()
        .feature_order
        .extend([fillet_id.clone(), finish_id.clone()]);
    document.recompute.features.insert(
        fillet_id,
        FeatureRecomputeState::Clean {
            evaluated_revision: document.revision,
        },
    );
    document.recompute.features.insert(
        finish_id,
        FeatureRecomputeState::Clean {
            evaluated_revision: document.revision,
        },
    );
    document
}

fn face(id: &str, centroid_x: i64, token: &str, kernel_id: u64) -> TopologyReference {
    TopologyReference {
        id: id.into(),
        body: "body:block".into(),
        producer: "feature:extrude".into(),
        kind: TopologyKind::Face,
        stable_kernel_id: kernel_id,
        stable_token: token.into(),
        fallback_signature: TopologySignature::Face {
            centroid_nanometers: [centroid_x, 10_000_000, 30_000_000],
            normal_millionths: [0, 0, 1_000_000],
            area_square_nanometers: 800_000_000_000_000,
        },
    }
}

#[test]
fn missing_candidate_stops_at_first_unresolved_and_reports_downstream() {
    let document = repair_document();
    let preview = preview_first_unresolved(&document, &[]).unwrap().unwrap();
    assert_eq!(
        preview.unresolved.feature,
        FeatureId::from("feature:fillet")
    );
    assert_eq!(preview.unresolved.input_name, "target");
    assert_eq!(
        preview.unresolved.cause,
        UnresolvedCause::StableIdentityMissing
    );
    assert!(preview.candidates.is_empty());
    assert_eq!(preview.selection, CandidateSelection::NoCandidates);
    assert_eq!(
        preview.downstream_stop.blocked_features,
        vec![
            FeatureId::from("feature:fillet"),
            FeatureId::from("feature:finish")
        ]
    );
}

#[test]
fn absent_reference_definition_is_a_repair_diagnostic_not_a_parse_failure() {
    let mut document = repair_document();
    document
        .topology_references
        .remove(&TopologyReferenceId::from("topology:top-face"));
    let preview = preview_first_unresolved(&document, &[]).unwrap().unwrap();
    assert_eq!(
        preview.unresolved.cause,
        UnresolvedCause::MissingReferenceDefinition
    );
    assert_eq!(preview.selection, CandidateSelection::NoCandidates);
}

#[test]
fn ambiguous_geometric_ranking_is_deterministic_and_never_auto_selects() {
    let document = repair_document();
    let a = face("topology:candidate-a", 20_000_001, "new:a", 101);
    let b = face("topology:candidate-b", 20_000_001, "new:b", 102);
    let far = face("topology:candidate-far", 21_000_000, "new:far", 103);
    let first = preview_first_unresolved(&document, &[far.clone(), b.clone(), a.clone()])
        .unwrap()
        .unwrap();
    let second = preview_first_unresolved(&document, &[a, far, b])
        .unwrap()
        .unwrap();
    assert_eq!(first.candidates, second.candidates);
    assert_eq!(
        first
            .candidates
            .iter()
            .map(|ranked| ranked.candidate.id.clone())
            .collect::<Vec<_>>(),
        vec![
            TopologyReferenceId::from("topology:candidate-a"),
            TopologyReferenceId::from("topology:candidate-b"),
            TopologyReferenceId::from("topology:candidate-far"),
        ]
    );
    assert_eq!(
        first.selection,
        CandidateSelection::Ambiguous {
            candidates: vec![
                TopologyReferenceId::from("topology:candidate-a"),
                TopologyReferenceId::from("topology:candidate-b"),
            ]
        }
    );
    assert_eq!(canonical_document_hash(&document), first.base_document_hash);
}

#[test]
fn commit_requires_explicit_choice_and_dirties_recovery_chain() {
    let document = repair_document();
    let replacement = face("topology:replacement", 20_000_002, "new:top", 200);
    let preview = preview_first_unresolved(&document, std::slice::from_ref(&replacement))
        .unwrap()
        .unwrap();
    assert_eq!(
        preview.selection,
        CandidateSelection::Unique {
            candidate: replacement.id.clone()
        }
    );
    // Preview and DTO construction are read-only; only apply_rebind commits.
    let before_hash = canonical_document_hash(&document);
    let transaction = preview
        .explicit_rebind("repair:1", &replacement.id)
        .unwrap();
    assert_eq!(canonical_document_hash(&document), before_hash);

    let commit = apply_rebind(&document, &transaction).unwrap();
    assert_eq!(commit.document.revision, document.revision + 1);
    assert_eq!(
        commit.document.features[&FeatureId::from("feature:fillet")].inputs["target"],
        FeatureInput::Topology(replacement.id.clone())
    );
    assert_eq!(
        commit.recovery.dirtied_features,
        vec![
            FeatureId::from("feature:fillet"),
            FeatureId::from("feature:finish")
        ]
    );
    for id in &commit.recovery.dirtied_features {
        assert_eq!(
            commit.document.recompute.features[id],
            FeatureRecomputeState::Dirty {
                since_revision: document.revision + 1
            }
        );
    }
    assert_eq!(
        commit.document.recompute.accepted_revision,
        document.revision
    );
}

#[test]
fn stale_or_tampered_commit_fails_closed_and_preserves_prior_hash() {
    let document = repair_document();
    let replacement = face("topology:replacement", 20_000_002, "new:top", 200);
    let preview = preview_first_unresolved(&document, std::slice::from_ref(&replacement))
        .unwrap()
        .unwrap();
    let mut transaction = preview
        .explicit_rebind("repair:bad", &replacement.id)
        .unwrap();
    transaction.base_document_hash = "tampered".into();
    let before = canonical_document_hash(&document);
    let error = apply_rebind(&document, &transaction).unwrap_err();
    assert_eq!(error.kind, RepairErrorKind::BaseDocumentHashMismatch);
    assert_eq!(error.preserved_document_hash, before);
    assert_eq!(canonical_document_hash(&document), before);
}

#[test]
fn undo_and_repair_envelope_survive_save_reload() {
    let document = repair_document();
    let replacement = face("topology:replacement", 20_000_002, "new:top", 200);
    let preview = preview_first_unresolved(&document, std::slice::from_ref(&replacement))
        .unwrap()
        .unwrap();
    let transaction = preview
        .explicit_rebind("repair:persist", &replacement.id)
        .unwrap();
    let transaction_bytes = serde_json::to_vec(&transaction).unwrap();
    let reloaded_transaction = serde_json::from_slice(&transaction_bytes).unwrap();
    assert_eq!(transaction, reloaded_transaction);

    let commit = apply_rebind(&document, &reloaded_transaction).unwrap();
    let undo_bytes = serde_json::to_vec(&commit.undo).unwrap();
    let reloaded_undo = serde_json::from_slice(&undo_bytes).unwrap();
    assert_eq!(commit.undo, reloaded_undo);
    let restored = apply_undo(&commit.document, &reloaded_undo).unwrap();
    assert_eq!(restored, document);
    assert_eq!(
        canonical_document_hash(&restored),
        preview.base_document_hash
    );
}

#[test]
fn exact_stable_identity_allows_downstream_evaluation_to_continue() {
    let document = repair_document();
    let still_resolved = face(
        "topology:new-runtime-id",
        20_000_000,
        "extrude:end-positive",
        999,
    );
    assert!(
        preview_first_unresolved(&document, &[still_resolved])
            .unwrap()
            .is_none()
    );
}

#[test]
fn repair_service_preview_is_json_ready_and_never_mutates_or_commits() {
    let document = repair_document();
    let before = canonical_document_hash(&document);
    let transaction_count = document.transactions.len();
    let replacement = face("topology:replacement", 20_000_002, "new:top", 200);
    let inspection =
        inspect_topology_repair(&document, std::slice::from_ref(&replacement)).unwrap();
    let RepairInspection::EvaluationBlocked { preview } = inspection else {
        panic!("unresolved topology must block evaluation");
    };
    assert!(preview.explicit_rebind_required);
    assert_eq!(canonical_document_hash(&document), before);

    let json = serde_json::to_string(&RepairInspection::EvaluationBlocked {
        preview: preview.clone(),
    })
    .unwrap();
    assert!(json.starts_with("{\"status\":\"evaluation_blocked\",\"preview\":"));
    assert!(json.contains("\"rank\":1"));

    let draft = draft_explicit_rebind(&preview, "repair:draft", &replacement.id).unwrap();
    assert_eq!(draft.changes.len(), 1);
    assert_eq!(canonical_document_hash(&document), before);
    assert_eq!(document.transactions.len(), transaction_count);
}

#[test]
fn recovery_report_separates_recovered_pending_and_failed_in_feature_order() {
    let mut document = repair_document();
    document.recompute.features.insert(
        "feature:fillet".into(),
        FeatureRecomputeState::Clean {
            evaluated_revision: document.revision,
        },
    );
    document.recompute.features.insert(
        "feature:finish".into(),
        FeatureRecomputeState::Failed {
            attempted_revision: document.revision,
            diagnostic_code: "finish_failed".into(),
        },
    );
    let report =
        summarize_downstream_recovery(&document, &FeatureId::from("feature:fillet")).unwrap();
    assert_eq!(
        report.recovered_features,
        vec![FeatureId::from("feature:fillet")]
    );
    assert!(report.pending_features.is_empty());
    assert_eq!(
        report.failed_features,
        vec![FeatureId::from("feature:finish")]
    );
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&serde_json::to_string(&report).unwrap())
            .unwrap()["resume_from"],
        "feature:fillet"
    );
}
