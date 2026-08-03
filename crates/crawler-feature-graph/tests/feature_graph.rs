use crawler_document::{
    ComponentId, Document, Feature, FeatureId, FeatureInput, FeatureRecomputeState,
    OperationReference,
};
use crawler_feature_graph::{
    ComputeCostCue, FeatureGraphCommand, FeatureGraphDocument, FeatureGraphError, FeatureGroupId,
    FeatureTimingDiagnostic, RollbackPosition, RuntimeDiagnostics, RuntimeFeatureState,
    TimelineState, apply_transaction, apply_undo, compute_diagnostics_view, direct_relationships,
    first_broken_feature, inspect_feature_services, prepare_transaction, project_timeline,
    recompute_from_here,
};
use std::collections::BTreeMap;

const FIXTURE: &str = include_str!("../../crawler-document/tests/fixtures/parametric-block.json");
const REFERENCE_PART: &str =
    include_str!("../../../fixtures/reference-models/cc0-mounting-bracket/document.json");

fn feature(id: &str, name: &str, dependencies: &[&str]) -> Feature {
    Feature {
        id: id.into(),
        display_name: name.into(),
        component: "component:root".into(),
        operation: OperationReference {
            schema_id: format!("crawler.operation.{name}"),
            schema_version: 1,
        },
        dependencies: dependencies.iter().map(|id| (*id).into()).collect(),
        inputs: BTreeMap::new(),
        parameters: BTreeMap::new(),
        suppressed: false,
    }
}

fn graph() -> FeatureGraphDocument {
    let mut document: Document = serde_json::from_str(FIXTURE.trim_end()).unwrap();
    let mut fillet = feature("feature:fillet", "fillet", &["feature:extrude"]);
    fillet.inputs.insert(
        "face".into(),
        FeatureInput::Topology("topology:top-face".into()),
    );
    let chamfer = feature("feature:chamfer", "chamfer", &["feature:fillet"]);
    let leaf = feature("feature:leaf", "leaf", &["feature:chamfer"]);
    let independent = feature("feature:independent", "datum", &[]);
    for added in [fillet, chamfer, leaf, independent] {
        let id = added.id.clone();
        document.features.insert(id.clone(), added);
        document
            .components
            .get_mut(&ComponentId::from("component:root"))
            .unwrap()
            .feature_order
            .push(id.clone());
        document.recompute.features.insert(
            id,
            FeatureRecomputeState::Clean {
                evaluated_revision: document.revision,
            },
        );
    }
    FeatureGraphDocument::new(document).unwrap()
}

fn commit(
    state: &FeatureGraphDocument,
    id: &str,
    command: FeatureGraphCommand,
) -> crawler_feature_graph::FeatureGraphCommit {
    let transaction = prepare_transaction(state, id, command).unwrap();
    apply_transaction(state, &transaction).unwrap()
}

#[test]
fn timeline_projects_all_states_and_attributes_first_break_deterministically() {
    let mut state = graph();
    state.document.recompute.features.insert(
        "feature:extrude".into(),
        FeatureRecomputeState::Dirty {
            since_revision: state.document.revision,
        },
    );
    state.document.recompute.features.insert(
        "feature:leaf".into(),
        FeatureRecomputeState::Failed {
            attempted_revision: state.document.revision,
            diagnostic_code: "leaf_failed".into(),
        },
    );
    state
        .document
        .features
        .get_mut(&FeatureId::from("feature:independent"))
        .unwrap()
        .suppressed = true;
    let runtime = RuntimeDiagnostics {
        states: BTreeMap::from([
            (
                FeatureId::from("feature:fillet"),
                RuntimeFeatureState::Computing,
            ),
            (
                FeatureId::from("feature:chamfer"),
                RuntimeFeatureState::Warning {
                    diagnostic_code: "small_edge".into(),
                },
            ),
        ]),
        timings: BTreeMap::new(),
    };
    let timeline = project_timeline(&state, &RollbackPosition::End, &runtime).unwrap();
    let state_of = |id: &str| {
        timeline
            .iter()
            .find(|item| item.feature == FeatureId::from(id))
            .unwrap()
            .state
    };
    assert_eq!(state_of("feature:sketch"), TimelineState::Clean);
    assert_eq!(state_of("feature:extrude"), TimelineState::Dirty);
    assert_eq!(state_of("feature:fillet"), TimelineState::Computing);
    assert_eq!(state_of("feature:chamfer"), TimelineState::Warning);
    assert_eq!(state_of("feature:leaf"), TimelineState::Failed);
    assert_eq!(state_of("feature:independent"), TimelineState::Suppressed);
    let first = first_broken_feature(&state, &RollbackPosition::End, &runtime)
        .unwrap()
        .unwrap();
    assert_eq!(first.feature, FeatureId::from("feature:chamfer"));
    assert_eq!(first.diagnostic_code.as_deref(), Some("small_edge"));
}

#[test]
fn rollback_is_separate_from_undo_and_never_deletes_features() {
    let state = graph();
    let before_hash = state.canonical_hash();
    let rollback = RollbackPosition::After("feature:extrude".into());
    let timeline = project_timeline(&state, &rollback, &RuntimeDiagnostics::default()).unwrap();
    assert!(
        timeline
            .iter()
            .find(|item| item.feature == FeatureId::from("feature:fillet"))
            .unwrap()
            .after_rollback
    );
    assert_eq!(state.document.features.len(), 6);
    assert_eq!(state.canonical_hash(), before_hash);

    let rename = commit(
        &state,
        "graph:rename",
        FeatureGraphCommand::Rename {
            feature: "feature:fillet".into(),
            display_name: "Rounded edges".into(),
        },
    );
    let restored = apply_undo(&rename.after, &rename.undo).unwrap();
    assert_eq!(restored, state);
}

#[test]
fn dependency_unsafe_reorder_is_blocked_with_named_feature_and_is_atomic() {
    let state = graph();
    let transaction = prepare_transaction(
        &state,
        "graph:bad-order",
        FeatureGraphCommand::Reorder {
            feature: "feature:fillet".into(),
            before: Some("feature:extrude".into()),
        },
    )
    .unwrap();
    let before_hash = state.canonical_hash();
    let error = apply_transaction(&state, &transaction).unwrap_err();
    assert_eq!(
        error,
        FeatureGraphError::ReorderBlocked {
            feature: "feature:fillet".into(),
            blocker: "feature:extrude".into(),
        }
    );
    assert_eq!(state.canonical_hash(), before_hash);

    let safe = commit(
        &state,
        "graph:safe-order",
        FeatureGraphCommand::Reorder {
            feature: "feature:independent".into(),
            before: Some("feature:extrude".into()),
        },
    );
    let order = &safe.after.document.components[&ComponentId::from("component:root")].feature_order;
    assert!(
        order
            .iter()
            .position(|id| id == &FeatureId::from("feature:independent"))
            < order
                .iter()
                .position(|id| id == &FeatureId::from("feature:extrude"))
    );
}

#[test]
fn direct_highlighting_and_recompute_plan_respect_dependencies_and_rollback() {
    let state = graph();
    let fillet = direct_relationships(&state, &FeatureId::from("feature:fillet")).unwrap();
    assert_eq!(
        fillet.direct_inputs,
        vec![FeatureId::from("feature:extrude")]
    );
    assert_eq!(
        fillet.direct_consumers,
        vec![FeatureId::from("feature:chamfer")]
    );

    let plan = recompute_from_here(
        &state,
        &FeatureId::from("feature:fillet"),
        &RollbackPosition::After("feature:chamfer".into()),
    )
    .unwrap();
    assert_eq!(
        plan.required_inputs,
        vec![FeatureId::from("feature:extrude")]
    );
    assert_eq!(
        plan.evaluation_order,
        vec![
            FeatureId::from("feature:fillet"),
            FeatureId::from("feature:chamfer")
        ]
    );
    assert_eq!(
        recompute_from_here(
            &state,
            &FeatureId::from("feature:fillet"),
            &RollbackPosition::After("feature:extrude".into())
        )
        .unwrap_err(),
        FeatureGraphError::AfterRollback("feature:fillet".into())
    );
}

#[test]
fn suppress_unsuppress_group_and_delete_are_atomic_durable_commands() {
    let state = graph();
    let suppressed = commit(
        &state,
        "graph:suppress",
        FeatureGraphCommand::Suppress {
            feature: "feature:fillet".into(),
        },
    );
    assert!(suppressed.after.document.features[&FeatureId::from("feature:fillet")].suppressed);
    assert!(matches!(
        suppressed.after.document.recompute.features[&FeatureId::from("feature:leaf")],
        FeatureRecomputeState::Dirty { .. }
    ));
    let unsuppressed = commit(
        &suppressed.after,
        "graph:unsuppress",
        FeatureGraphCommand::Unsuppress {
            feature: "feature:fillet".into(),
        },
    );
    assert!(!unsuppressed.after.document.features[&FeatureId::from("feature:fillet")].suppressed);

    let grouped = commit(
        &unsuppressed.after,
        "graph:group",
        FeatureGraphCommand::Group {
            group: FeatureGroupId::from("group:finishing"),
            display_name: "Finishing".into(),
            features: vec!["feature:chamfer".into(), "feature:fillet".into()],
        },
    );
    assert_eq!(
        grouped.after.groups[&FeatureGroupId::from("group:finishing")].features,
        vec![
            FeatureId::from("feature:fillet"),
            FeatureId::from("feature:chamfer")
        ]
    );
    assert_eq!(
        grouped.after.document.transactions.len(),
        unsuppressed.after.document.transactions.len() + 1
    );
    let restored = FeatureGraphDocument::new(grouped.after.document.clone()).unwrap();
    assert_eq!(restored.groups, grouped.after.groups);

    let deleted = commit(
        &grouped.after,
        "graph:delete",
        FeatureGraphCommand::Delete {
            feature: "feature:independent".into(),
        },
    );
    assert!(
        !deleted
            .after
            .document
            .features
            .contains_key(&FeatureId::from("feature:independent"))
    );
    let bytes = serde_json::to_vec(&deleted.transaction).unwrap();
    assert_eq!(
        serde_json::from_slice::<crawler_feature_graph::FeatureGraphTransaction>(&bytes).unwrap(),
        deleted.transaction
    );
}

#[test]
fn delete_with_consumer_is_blocked_without_partial_mutation() {
    let state = graph();
    let transaction = prepare_transaction(
        &state,
        "graph:delete-blocked",
        FeatureGraphCommand::Delete {
            feature: "feature:fillet".into(),
        },
    )
    .unwrap();
    let error = apply_transaction(&state, &transaction).unwrap_err();
    assert_eq!(
        error,
        FeatureGraphError::DeleteBlocked {
            feature: "feature:fillet".into(),
            blocker: "feature:chamfer".into(),
        }
    );
}

#[test]
fn timing_diagnostics_are_excluded_from_semantic_serialization() {
    let state = graph();
    let runtime = RuntimeDiagnostics {
        states: BTreeMap::new(),
        timings: BTreeMap::from([(
            FeatureId::from("feature:fillet"),
            FeatureTimingDiagnostic {
                elapsed_microseconds: 987_654,
                evaluation_sequence: 42,
            },
        )]),
    };
    let semantic = serde_json::to_string(&state).unwrap();
    assert!(!semantic.contains("elapsed_microseconds"));
    assert!(!semantic.contains("987654"));
    assert_eq!(runtime.timings.len(), 1);
}

#[test]
fn dependency_and_timing_service_is_stable_json_and_nonsemantic() {
    let state = graph();
    let semantic_hash = state.canonical_hash();
    let runtime = RuntimeDiagnostics {
        states: BTreeMap::new(),
        // BTreeMap insertion order cannot influence the timeline-ordered DTO.
        timings: BTreeMap::from([
            (
                FeatureId::from("feature:fillet"),
                FeatureTimingDiagnostic {
                    elapsed_microseconds: 30_000,
                    evaluation_sequence: 8,
                },
            ),
            (
                FeatureId::from("feature:extrude"),
                FeatureTimingDiagnostic {
                    elapsed_microseconds: 10_000,
                    evaluation_sequence: 7,
                },
            ),
        ]),
    };
    let view = inspect_feature_services(
        &state,
        &FeatureId::from("feature:fillet"),
        &RollbackPosition::After("feature:chamfer".into()),
        &runtime,
    )
    .unwrap();
    assert_eq!(
        view.relationships.direct_inputs,
        vec![FeatureId::from("feature:extrude")]
    );
    assert_eq!(
        view.relationships.direct_consumers,
        vec![FeatureId::from("feature:chamfer")]
    );
    assert_eq!(view.diagnostics.total_elapsed_microseconds, 40_000);
    assert_eq!(
        view.diagnostics
            .features
            .iter()
            .map(|item| (item.feature.clone(), item.cost_share_ppm, item.cost_cue))
            .collect::<Vec<_>>(),
        vec![
            (
                FeatureId::from("feature:extrude"),
                250_000,
                ComputeCostCue::WithinFrame,
            ),
            (
                FeatureId::from("feature:fillet"),
                750_000,
                ComputeCostCue::Interactive,
            ),
        ]
    );
    let first = serde_json::to_string(&view).unwrap();
    let second = serde_json::to_string(
        &inspect_feature_services(
            &state,
            &FeatureId::from("feature:fillet"),
            &RollbackPosition::After("feature:chamfer".into()),
            &runtime,
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(first, second);
    assert!(first.contains("\"cost_share_ppm\":250000"));
    assert_eq!(state.canonical_hash(), semantic_hash);
}

#[test]
fn zero_total_timing_serializes_without_division_or_nondeterminism() {
    let state = graph();
    let runtime = RuntimeDiagnostics {
        states: BTreeMap::new(),
        timings: BTreeMap::from([(
            FeatureId::from("feature:extrude"),
            FeatureTimingDiagnostic {
                elapsed_microseconds: 0,
                evaluation_sequence: 1,
            },
        )]),
    };
    let view = compute_diagnostics_view(&state, &runtime).unwrap();
    assert_eq!(view.features[0].cost_share_ppm, 0);
    assert_eq!(
        serde_json::to_string(&view).unwrap(),
        "{\"total_elapsed_microseconds\":0,\"features\":[{\"feature\":\"feature:extrude\",\"elapsed_microseconds\":0,\"evaluation_sequence\":1,\"cost_share_ppm\":0,\"cost_cue\":\"within_frame\"}]}"
    );
}

#[test]
fn persistent_body_inputs_do_not_create_backwards_edges_to_the_final_producer() {
    let document: Document = serde_json::from_str(REFERENCE_PART).unwrap();
    let state = FeatureGraphDocument::new(document).unwrap();
    let order = &state.document.components[&ComponentId::from("component:root")].feature_order;
    assert_eq!(order.first(), Some(&FeatureId::from("feature:base-plate")));
    assert_eq!(
        order.last(),
        Some(&FeatureId::from("feature:upright-hole-pair"))
    );

    let cut = direct_relationships(&state, &FeatureId::from("feature:base-hole-pair")).unwrap();
    assert_eq!(cut.direct_inputs, vec![FeatureId::from("feature:upright")]);
}
