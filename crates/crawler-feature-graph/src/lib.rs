//! Deterministic feature-timeline projection and atomic edit contracts.
//!
//! Rollback position and runtime diagnostics are intentionally process-local.
//! Persistent edits use a sidecar envelope; operations representable by the
//! shared document schema are additionally mirrored into `DocumentChange`.

use crawler_document::{
    ComponentId, Document, DocumentChange, DocumentTransaction, EntityId, Feature, FeatureId,
    FeatureInput, FeatureRecomputeState, TransactionId,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;
use std::fmt::{self, Display, Formatter};

pub const FEATURE_GRAPH_ENVELOPE_VERSION: u32 = 1;

#[derive(Clone, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct FeatureGroupId(pub String);

impl From<&str> for FeatureGroupId {
    fn from(value: &str) -> Self {
        Self(value.to_owned())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FeatureGroup {
    pub id: FeatureGroupId,
    pub display_name: String,
    pub features: Vec<FeatureId>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FeatureGraphDocument {
    pub document: Document,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub groups: BTreeMap<FeatureGroupId, FeatureGroup>,
}

impl FeatureGraphDocument {
    pub fn new(document: Document) -> Result<Self, FeatureGraphError> {
        let groups = durable_groups(&document);
        let state = Self { document, groups };
        validate_state(&state)?;
        Ok(state)
    }

    pub fn canonical_hash(&self) -> String {
        let bytes = serde_json::to_vec(self).expect("feature graph documents are serializable");
        format!("{:x}", Sha256::digest(bytes))
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TimelineState {
    Clean,
    Dirty,
    Computing,
    Warning,
    Failed,
    Suppressed,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub enum RuntimeFeatureState {
    Computing,
    Warning { diagnostic_code: String },
}

/// Runtime-only timing evidence. This type intentionally has no serialization
/// implementation and is not a field of `FeatureGraphDocument`.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeatureTimingDiagnostic {
    pub elapsed_microseconds: u64,
    pub evaluation_sequence: u64,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct RuntimeDiagnostics {
    pub states: BTreeMap<FeatureId, RuntimeFeatureState>,
    pub timings: BTreeMap<FeatureId, FeatureTimingDiagnostic>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "position", content = "feature", rename_all = "snake_case")]
pub enum RollbackPosition {
    BeforeFirst,
    After(FeatureId),
    End,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TimelineItem {
    pub feature: FeatureId,
    pub operation_type: String,
    pub display_name: String,
    pub state: TimelineState,
    pub diagnostic_code: Option<String>,
    pub after_rollback: bool,
    pub group: Option<FeatureGroupId>,
}

pub fn project_timeline(
    state: &FeatureGraphDocument,
    rollback: &RollbackPosition,
    runtime: &RuntimeDiagnostics,
) -> Result<Vec<TimelineItem>, FeatureGraphError> {
    validate_state(state)?;
    let order = feature_order(&state.document);
    let active = active_features(&order, rollback)?;
    let groups = group_membership(state);
    Ok(order
        .into_iter()
        .map(|id| {
            let feature = &state.document.features[&id];
            let after_rollback = !active.contains(&id);
            let (timeline_state, diagnostic_code) = projected_state(state, &id, runtime);
            TimelineItem {
                feature: id.clone(),
                operation_type: feature.operation.schema_id.clone(),
                display_name: feature.display_name.clone(),
                state: timeline_state,
                diagnostic_code,
                after_rollback,
                group: groups.get(&id).cloned(),
            }
        })
        .collect())
}

pub fn first_broken_feature(
    state: &FeatureGraphDocument,
    rollback: &RollbackPosition,
    runtime: &RuntimeDiagnostics,
) -> Result<Option<TimelineItem>, FeatureGraphError> {
    Ok(project_timeline(state, rollback, runtime)?
        .into_iter()
        .find(|item| {
            !item.after_rollback
                && matches!(item.state, TimelineState::Warning | TimelineState::Failed)
        }))
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RelationshipHighlight {
    pub selected: FeatureId,
    pub direct_inputs: Vec<FeatureId>,
    pub direct_consumers: Vec<FeatureId>,
}

pub fn direct_relationships(
    state: &FeatureGraphDocument,
    selected: &FeatureId,
) -> Result<RelationshipHighlight, FeatureGraphError> {
    validate_state(state)?;
    if !state.document.features.contains_key(selected) {
        return Err(FeatureGraphError::MissingFeature(selected.clone()));
    }
    let order = feature_order(&state.document);
    let inputs = direct_inputs(&state.document, selected);
    let consumers: BTreeSet<_> = state
        .document
        .features
        .keys()
        .filter(|candidate| direct_inputs(&state.document, candidate).contains(selected))
        .cloned()
        .collect();
    Ok(RelationshipHighlight {
        selected: selected.clone(),
        direct_inputs: order
            .iter()
            .filter(|feature| inputs.contains(*feature))
            .cloned()
            .collect(),
        direct_consumers: order
            .into_iter()
            .filter(|feature| consumers.contains(feature))
            .collect(),
    })
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RecomputePlan {
    pub requested_from: FeatureId,
    pub required_inputs: Vec<FeatureId>,
    pub evaluation_order: Vec<FeatureId>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ComputeCostCue {
    WithinFrame,
    Interactive,
    Expensive,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FeatureComputeDiagnostic {
    pub feature: FeatureId,
    pub elapsed_microseconds: u64,
    pub evaluation_sequence: u64,
    /// Integer share of the measured total in parts per million. Keeping this
    /// integral makes serialization deterministic across targets.
    pub cost_share_ppm: u32,
    pub cost_cue: ComputeCostCue,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ComputeDiagnosticsView {
    pub total_elapsed_microseconds: u64,
    pub features: Vec<FeatureComputeDiagnostic>,
}

/// Projects process-local timings into a stable JSON DTO. The result is never
/// attached to `FeatureGraphDocument`, so timings remain nonsemantic.
pub fn compute_diagnostics_view(
    state: &FeatureGraphDocument,
    runtime: &RuntimeDiagnostics,
) -> Result<ComputeDiagnosticsView, FeatureGraphError> {
    validate_state(state)?;
    let total_elapsed_microseconds = runtime.timings.values().fold(0_u64, |total, timing| {
        total.saturating_add(timing.elapsed_microseconds)
    });
    let features = feature_order(&state.document)
        .into_iter()
        .filter_map(|feature| {
            let timing = runtime.timings.get(&feature)?;
            let share = if total_elapsed_microseconds == 0 {
                0
            } else {
                (u128::from(timing.elapsed_microseconds) * 1_000_000
                    / u128::from(total_elapsed_microseconds))
                .min(u128::from(u32::MAX)) as u32
            };
            let cost_cue = match timing.elapsed_microseconds {
                0..=16_667 => ComputeCostCue::WithinFrame,
                16_668..=100_000 => ComputeCostCue::Interactive,
                _ => ComputeCostCue::Expensive,
            };
            Some(FeatureComputeDiagnostic {
                feature,
                elapsed_microseconds: timing.elapsed_microseconds,
                evaluation_sequence: timing.evaluation_sequence,
                cost_share_ppm: share,
                cost_cue,
            })
        })
        .collect();
    Ok(ComputeDiagnosticsView {
        total_elapsed_microseconds,
        features,
    })
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FeatureServiceView {
    pub timeline: Vec<TimelineItem>,
    pub relationships: RelationshipHighlight,
    pub diagnostics: ComputeDiagnosticsView,
}

/// Read-only JSON-ready response for timeline dependency and cost cues.
pub fn inspect_feature_services(
    state: &FeatureGraphDocument,
    selected: &FeatureId,
    rollback: &RollbackPosition,
    runtime: &RuntimeDiagnostics,
) -> Result<FeatureServiceView, FeatureGraphError> {
    Ok(FeatureServiceView {
        timeline: project_timeline(state, rollback, runtime)?,
        relationships: direct_relationships(state, selected)?,
        diagnostics: compute_diagnostics_view(state, runtime)?,
    })
}

pub fn recompute_from_here(
    state: &FeatureGraphDocument,
    requested_from: &FeatureId,
    rollback: &RollbackPosition,
) -> Result<RecomputePlan, FeatureGraphError> {
    validate_state(state)?;
    let order = feature_order(&state.document);
    let active = active_features(&order, rollback)?;
    if !state.document.features.contains_key(requested_from) {
        return Err(FeatureGraphError::MissingFeature(requested_from.clone()));
    }
    if !active.contains(requested_from) {
        return Err(FeatureGraphError::AfterRollback(requested_from.clone()));
    }
    let required = transitive_inputs(&state.document, requested_from);
    if let Some(blocked) = required.iter().find(|feature| !active.contains(*feature)) {
        return Err(FeatureGraphError::DependencyAfterRollback(blocked.clone()));
    }
    let downstream = transitive_consumers(&state.document, requested_from);
    Ok(RecomputePlan {
        requested_from: requested_from.clone(),
        required_inputs: order
            .iter()
            .filter(|feature| required.contains(*feature))
            .cloned()
            .collect(),
        evaluation_order: order
            .into_iter()
            .filter(|feature| {
                active.contains(feature)
                    && (feature == requested_from || downstream.contains(feature))
                    && !state.document.features[feature].suppressed
            })
            .collect(),
    })
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum FeatureGraphCommand {
    Create {
        feature: Feature,
        before: Option<FeatureId>,
    },
    Edit {
        feature: Feature,
    },
    Rename {
        feature: FeatureId,
        display_name: String,
    },
    Suppress {
        feature: FeatureId,
    },
    Unsuppress {
        feature: FeatureId,
    },
    Delete {
        feature: FeatureId,
    },
    Group {
        group: FeatureGroupId,
        display_name: String,
        features: Vec<FeatureId>,
    },
    Reorder {
        feature: FeatureId,
        before: Option<FeatureId>,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FeatureGraphTransaction {
    pub schema_version: u32,
    pub id: String,
    pub base_state_hash: String,
    pub base_revision: u64,
    pub result_revision: u64,
    pub command: FeatureGraphCommand,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FeatureGraphUndoRecord {
    pub transaction_id: String,
    pub before_hash: String,
    pub after_hash: String,
    pub before: FeatureGraphDocument,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FeatureGraphCommit {
    pub transaction: FeatureGraphTransaction,
    pub after: FeatureGraphDocument,
    pub undo: FeatureGraphUndoRecord,
}

pub fn prepare_transaction(
    state: &FeatureGraphDocument,
    transaction_id: impl Into<String>,
    command: FeatureGraphCommand,
) -> Result<FeatureGraphTransaction, FeatureGraphError> {
    validate_state(state)?;
    let result_revision = state
        .document
        .revision
        .checked_add(1)
        .ok_or(FeatureGraphError::RevisionOverflow)?;
    Ok(FeatureGraphTransaction {
        schema_version: FEATURE_GRAPH_ENVELOPE_VERSION,
        id: transaction_id.into(),
        base_state_hash: state.canonical_hash(),
        base_revision: state.document.revision,
        result_revision,
        command,
    })
}

pub fn apply_transaction(
    state: &FeatureGraphDocument,
    transaction: &FeatureGraphTransaction,
) -> Result<FeatureGraphCommit, FeatureGraphError> {
    validate_state(state)?;
    validate_envelope(state, transaction)?;
    let before_hash = state.canonical_hash();
    let mut candidate = state.clone();
    let shared_change = apply_command(&mut candidate, &transaction.command)?;
    candidate.document.revision = transaction.result_revision;
    candidate.document.transactions.push(DocumentTransaction {
        id: TransactionId(transaction.id.clone()),
        base_revision: transaction.base_revision,
        result_revision: transaction.result_revision,
        changes: vec![shared_change],
    });
    validate_state(&candidate)?;
    let after_hash = candidate.canonical_hash();
    Ok(FeatureGraphCommit {
        transaction: transaction.clone(),
        after: candidate,
        undo: FeatureGraphUndoRecord {
            transaction_id: transaction.id.clone(),
            before_hash,
            after_hash,
            before: state.clone(),
        },
    })
}

pub fn apply_undo(
    current: &FeatureGraphDocument,
    undo: &FeatureGraphUndoRecord,
) -> Result<FeatureGraphDocument, FeatureGraphError> {
    if current.canonical_hash() != undo.after_hash {
        return Err(FeatureGraphError::UndoStateChanged);
    }
    if undo.before.canonical_hash() != undo.before_hash {
        return Err(FeatureGraphError::InvalidUndoRecord);
    }
    validate_state(&undo.before)?;
    Ok(undo.before.clone())
}

fn validate_envelope(
    state: &FeatureGraphDocument,
    transaction: &FeatureGraphTransaction,
) -> Result<(), FeatureGraphError> {
    if transaction.schema_version != FEATURE_GRAPH_ENVELOPE_VERSION || transaction.id.is_empty() {
        return Err(FeatureGraphError::InvalidTransaction);
    }
    if transaction.base_state_hash != state.canonical_hash() {
        return Err(FeatureGraphError::BaseHashMismatch);
    }
    if transaction.base_revision != state.document.revision {
        return Err(FeatureGraphError::BaseRevisionMismatch);
    }
    let expected = state
        .document
        .revision
        .checked_add(1)
        .ok_or(FeatureGraphError::RevisionOverflow)?;
    if transaction.result_revision != expected {
        return Err(FeatureGraphError::InvalidResultRevision);
    }
    Ok(())
}

fn apply_command(
    state: &mut FeatureGraphDocument,
    command: &FeatureGraphCommand,
) -> Result<DocumentChange, FeatureGraphError> {
    match command {
        FeatureGraphCommand::Create { feature, before } => {
            create_feature(state, feature, before.as_ref())?;
            Ok(DocumentChange::CreateFeature {
                feature: feature.clone(),
                before: before.clone(),
            })
        }
        FeatureGraphCommand::Edit { feature } => {
            edit_feature(state, feature)?;
            Ok(DocumentChange::EditFeature {
                feature: feature.clone(),
            })
        }
        FeatureGraphCommand::Rename {
            feature,
            display_name,
        } => {
            if display_name.trim().is_empty() {
                return Err(FeatureGraphError::EmptyName);
            }
            state
                .document
                .features
                .get_mut(feature)
                .ok_or_else(|| FeatureGraphError::MissingFeature(feature.clone()))?
                .display_name = display_name.clone();
            Ok(DocumentChange::RenameEntity {
                entity: EntityId::Feature(feature.clone()),
                display_name: display_name.clone(),
            })
        }
        FeatureGraphCommand::Suppress { feature } => {
            set_suppressed(state, feature, true)?;
            Ok(DocumentChange::SetFeatureSuppressed {
                feature: feature.clone(),
                suppressed: true,
            })
        }
        FeatureGraphCommand::Unsuppress { feature } => {
            set_suppressed(state, feature, false)?;
            Ok(DocumentChange::SetFeatureSuppressed {
                feature: feature.clone(),
                suppressed: false,
            })
        }
        FeatureGraphCommand::Delete { feature } => {
            let component = state
                .document
                .features
                .get(feature)
                .ok_or_else(|| FeatureGraphError::MissingFeature(feature.clone()))?
                .component
                .clone();
            delete_feature(state, feature)?;
            Ok(DocumentChange::DeleteFeature {
                component,
                feature: feature.clone(),
            })
        }
        FeatureGraphCommand::Group {
            group,
            display_name,
            features,
        } => {
            group_features(state, group, display_name, features)?;
            Ok(DocumentChange::GroupFeatures {
                group_id: group.0.clone(),
                display_name: display_name.clone(),
                features: state.groups[group].features.clone(),
            })
        }
        FeatureGraphCommand::Reorder { feature, before } => {
            let component = reorder_feature(state, feature, before.as_ref())?;
            dirty_downstream(state, feature);
            Ok(DocumentChange::ReorderFeature {
                component,
                feature: feature.clone(),
                before: before.clone(),
            })
        }
    }
}

fn create_feature(
    state: &mut FeatureGraphDocument,
    feature: &Feature,
    before: Option<&FeatureId>,
) -> Result<(), FeatureGraphError> {
    if feature.id.0.is_empty() || state.document.features.contains_key(&feature.id) {
        return Err(FeatureGraphError::InvalidFeatureCreate(feature.id.clone()));
    }
    let component = state
        .document
        .components
        .get_mut(&feature.component)
        .ok_or_else(|| FeatureGraphError::MissingComponent(feature.component.clone()))?;
    let index = before
        .map(|id| {
            component
                .feature_order
                .iter()
                .position(|candidate| candidate == id)
                .ok_or_else(|| FeatureGraphError::MissingFeature(id.clone()))
        })
        .transpose()?
        .unwrap_or(component.feature_order.len());
    component.feature_order.insert(index, feature.id.clone());
    state
        .document
        .features
        .insert(feature.id.clone(), feature.clone());
    dirty_downstream(state, &feature.id);
    Ok(())
}

fn edit_feature(
    state: &mut FeatureGraphDocument,
    feature: &Feature,
) -> Result<(), FeatureGraphError> {
    let existing = state
        .document
        .features
        .get(&feature.id)
        .ok_or_else(|| FeatureGraphError::MissingFeature(feature.id.clone()))?;
    if existing.component != feature.component {
        return Err(FeatureGraphError::CrossComponentEdit);
    }
    state
        .document
        .features
        .insert(feature.id.clone(), feature.clone());
    dirty_downstream(state, &feature.id);
    Ok(())
}

fn durable_groups(document: &Document) -> BTreeMap<FeatureGroupId, FeatureGroup> {
    let mut groups = BTreeMap::new();
    for transaction in &document.transactions {
        for change in &transaction.changes {
            match change {
                DocumentChange::GroupFeatures {
                    group_id,
                    display_name,
                    features,
                } => {
                    let id = FeatureGroupId(group_id.clone());
                    groups.insert(
                        id.clone(),
                        FeatureGroup {
                            id,
                            display_name: display_name.clone(),
                            features: features.clone(),
                        },
                    );
                }
                DocumentChange::DeleteFeature { feature, .. } => {
                    for group in groups.values_mut() {
                        group.features.retain(|member| member != feature);
                    }
                    groups.retain(|_, group| !group.features.is_empty());
                }
                _ => {}
            }
        }
    }
    groups
}

fn set_suppressed(
    state: &mut FeatureGraphDocument,
    feature: &FeatureId,
    suppressed: bool,
) -> Result<(), FeatureGraphError> {
    state
        .document
        .features
        .get_mut(feature)
        .ok_or_else(|| FeatureGraphError::MissingFeature(feature.clone()))?
        .suppressed = suppressed;
    dirty_downstream(state, feature);
    Ok(())
}

fn delete_feature(
    state: &mut FeatureGraphDocument,
    feature: &FeatureId,
) -> Result<(), FeatureGraphError> {
    if !state.document.features.contains_key(feature) {
        return Err(FeatureGraphError::MissingFeature(feature.clone()));
    }
    if let Some(consumer) = feature_order(&state.document)
        .into_iter()
        .find(|candidate| direct_inputs(&state.document, candidate).contains(feature))
    {
        return Err(FeatureGraphError::DeleteBlocked {
            feature: feature.clone(),
            blocker: consumer,
        });
    }
    if let Some((body, _)) = state
        .document
        .bodies
        .iter()
        .find(|(_, body)| &body.generated_by == feature)
    {
        return Err(FeatureGraphError::GeneratedBodyBlocksDelete {
            feature: feature.clone(),
            body: body.0.clone(),
        });
    }
    state.document.features.remove(feature);
    state.document.recompute.features.remove(feature);
    for component in state.document.components.values_mut() {
        component.feature_order.retain(|id| id != feature);
    }
    for group in state.groups.values_mut() {
        group.features.retain(|id| id != feature);
    }
    state.groups.retain(|_, group| !group.features.is_empty());
    state
        .document
        .topology_references
        .retain(|_, reference| &reference.producer != feature);
    Ok(())
}

fn group_features(
    state: &mut FeatureGraphDocument,
    group_id: &FeatureGroupId,
    display_name: &str,
    features: &[FeatureId],
) -> Result<(), FeatureGraphError> {
    if group_id.0.is_empty() || display_name.trim().is_empty() || features.is_empty() {
        return Err(FeatureGraphError::InvalidGroup);
    }
    if state.groups.contains_key(group_id) {
        return Err(FeatureGraphError::DuplicateGroup(group_id.clone()));
    }
    let selected: BTreeSet<_> = features.iter().cloned().collect();
    if selected.len() != features.len() {
        return Err(FeatureGraphError::InvalidGroup);
    }
    let mut component = None;
    for feature in &selected {
        let stored = state
            .document
            .features
            .get(feature)
            .ok_or_else(|| FeatureGraphError::MissingFeature(feature.clone()))?;
        if component
            .replace(stored.component.clone())
            .is_some_and(|prior| prior != stored.component)
        {
            return Err(FeatureGraphError::CrossComponentGroup);
        }
        if state
            .groups
            .values()
            .any(|group| group.features.contains(feature))
        {
            return Err(FeatureGraphError::FeatureAlreadyGrouped(feature.clone()));
        }
    }
    let order = feature_order(&state.document);
    state.groups.insert(
        group_id.clone(),
        FeatureGroup {
            id: group_id.clone(),
            display_name: display_name.to_owned(),
            features: order
                .into_iter()
                .filter(|feature| selected.contains(feature))
                .collect(),
        },
    );
    Ok(())
}

fn reorder_feature(
    state: &mut FeatureGraphDocument,
    feature: &FeatureId,
    before: Option<&FeatureId>,
) -> Result<ComponentId, FeatureGraphError> {
    let component_id = state
        .document
        .features
        .get(feature)
        .ok_or_else(|| FeatureGraphError::MissingFeature(feature.clone()))?
        .component
        .clone();
    if let Some(before) = before {
        let before_feature = state
            .document
            .features
            .get(before)
            .ok_or_else(|| FeatureGraphError::MissingFeature(before.clone()))?;
        if before_feature.component != component_id {
            return Err(FeatureGraphError::CrossComponentReorder);
        }
    }
    let component = state
        .document
        .components
        .get_mut(&component_id)
        .ok_or_else(|| FeatureGraphError::MissingComponent(component_id.clone()))?;
    let mut proposed = component.feature_order.clone();
    proposed.retain(|id| id != feature);
    let index = before
        .map(|before| {
            proposed
                .iter()
                .position(|id| id == before)
                .expect("validated before feature belongs to component")
        })
        .unwrap_or(proposed.len());
    proposed.insert(index, feature.clone());
    let positions: BTreeMap<_, _> = proposed
        .iter()
        .enumerate()
        .map(|(index, id)| (id.clone(), index))
        .collect();
    for id in &proposed {
        for dependency in direct_inputs(&state.document, id) {
            if let Some(dependency_position) = positions.get(&dependency)
                && dependency_position >= &positions[id]
            {
                return Err(FeatureGraphError::ReorderBlocked {
                    feature: feature.clone(),
                    blocker: if id == feature {
                        dependency
                    } else {
                        id.clone()
                    },
                });
            }
        }
    }
    state
        .document
        .components
        .get_mut(&component_id)
        .expect("component was validated")
        .feature_order = proposed;
    Ok(component_id)
}

fn dirty_downstream(state: &mut FeatureGraphDocument, feature: &FeatureId) {
    let revision = state.document.revision.saturating_add(1);
    let mut dirty = transitive_consumers(&state.document, feature);
    dirty.insert(feature.clone());
    for id in dirty {
        state.document.recompute.features.insert(
            id,
            FeatureRecomputeState::Dirty {
                since_revision: revision,
            },
        );
    }
}

fn projected_state(
    state: &FeatureGraphDocument,
    feature: &FeatureId,
    runtime: &RuntimeDiagnostics,
) -> (TimelineState, Option<String>) {
    if state.document.features[feature].suppressed {
        return (TimelineState::Suppressed, None);
    }
    if let Some(runtime) = runtime.states.get(feature) {
        return match runtime {
            RuntimeFeatureState::Computing => (TimelineState::Computing, None),
            RuntimeFeatureState::Warning { diagnostic_code } => {
                (TimelineState::Warning, Some(diagnostic_code.clone()))
            }
        };
    }
    match state.document.recompute.features.get(feature) {
        Some(FeatureRecomputeState::Clean { .. }) | None => (TimelineState::Clean, None),
        Some(FeatureRecomputeState::Dirty { .. }) => (TimelineState::Dirty, None),
        Some(FeatureRecomputeState::Failed {
            diagnostic_code, ..
        }) => (TimelineState::Failed, Some(diagnostic_code.clone())),
    }
}

fn active_features(
    order: &[FeatureId],
    rollback: &RollbackPosition,
) -> Result<BTreeSet<FeatureId>, FeatureGraphError> {
    match rollback {
        RollbackPosition::BeforeFirst => Ok(BTreeSet::new()),
        RollbackPosition::End => Ok(order.iter().cloned().collect()),
        RollbackPosition::After(feature) => {
            let index = order
                .iter()
                .position(|id| id == feature)
                .ok_or_else(|| FeatureGraphError::InvalidRollback(feature.clone()))?;
            Ok(order[..=index].iter().cloned().collect())
        }
    }
}

fn feature_order(document: &Document) -> Vec<FeatureId> {
    let mut order = Vec::new();
    let mut seen = BTreeSet::new();
    for component in document.components.values() {
        for feature in &component.feature_order {
            if document.features.contains_key(feature) && seen.insert(feature.clone()) {
                order.push(feature.clone());
            }
        }
    }
    for feature in document.features.keys() {
        if seen.insert(feature.clone()) {
            order.push(feature.clone());
        }
    }
    order
}

fn direct_inputs(document: &Document, feature: &FeatureId) -> BTreeSet<FeatureId> {
    let Some(feature) = document.features.get(feature) else {
        return BTreeSet::new();
    };
    let mut inputs: BTreeSet<_> = feature.dependencies.iter().cloned().collect();
    for input in feature.inputs.values() {
        match input {
            FeatureInput::Feature(feature) => {
                inputs.insert(feature.clone());
            }
            FeatureInput::Topology(reference) => {
                if let Some(reference) = document.topology_references.get(reference) {
                    inputs.insert(reference.producer.clone());
                }
            }
            // A body ID identifies the persistent semantic container edited by
            // successive features. Its `generated_by` field names the current
            // accepted final producer, not necessarily the historical producer
            // visible at this feature's timeline position. Explicit feature
            // dependencies carry that ordering without manufacturing a
            // backwards edge from an early feature to the final producer.
            FeatureInput::Body(_) => {}
            FeatureInput::Sketch(_) => {}
        }
    }
    inputs
}

fn transitive_inputs(document: &Document, start: &FeatureId) -> BTreeSet<FeatureId> {
    let mut result = BTreeSet::new();
    let mut pending: Vec<_> = direct_inputs(document, start).into_iter().collect();
    while let Some(feature) = pending.pop() {
        if result.insert(feature.clone()) {
            pending.extend(direct_inputs(document, &feature));
        }
    }
    result
}

fn transitive_consumers(document: &Document, start: &FeatureId) -> BTreeSet<FeatureId> {
    let mut result = BTreeSet::new();
    loop {
        let before = result.len();
        for candidate in document.features.keys() {
            let inputs = direct_inputs(document, candidate);
            if inputs.contains(start) || inputs.iter().any(|input| result.contains(input)) {
                result.insert(candidate.clone());
            }
        }
        if result.len() == before {
            break;
        }
    }
    result.remove(start);
    result
}

fn group_membership(state: &FeatureGraphDocument) -> BTreeMap<FeatureId, FeatureGroupId> {
    state
        .groups
        .iter()
        .flat_map(|(group, value)| {
            value
                .features
                .iter()
                .map(move |feature| (feature.clone(), group.clone()))
        })
        .collect()
}

fn validate_state(state: &FeatureGraphDocument) -> Result<(), FeatureGraphError> {
    if !state
        .document
        .components
        .contains_key(&state.document.root_component)
    {
        return Err(FeatureGraphError::MissingComponent(
            state.document.root_component.clone(),
        ));
    }
    let mut ordered = BTreeSet::new();
    for (component_id, component) in &state.document.components {
        for feature in &component.feature_order {
            let stored = state
                .document
                .features
                .get(feature)
                .ok_or_else(|| FeatureGraphError::MissingFeature(feature.clone()))?;
            if &stored.component != component_id || !ordered.insert(feature.clone()) {
                return Err(FeatureGraphError::InvalidFeatureOrder);
            }
        }
    }
    if ordered.len() != state.document.features.len() {
        return Err(FeatureGraphError::InvalidFeatureOrder);
    }
    let positions: BTreeMap<_, _> = feature_order(&state.document)
        .into_iter()
        .enumerate()
        .map(|(index, feature)| (feature, index))
        .collect();
    for (id, feature) in &state.document.features {
        if id != &feature.id {
            return Err(FeatureGraphError::FeatureIdentityMismatch(id.clone()));
        }
        for input in direct_inputs(&state.document, id) {
            if !state.document.features.contains_key(&input) {
                return Err(FeatureGraphError::MissingFeature(input));
            }
            if positions[&input] >= positions[id] {
                return Err(FeatureGraphError::DependencyOrderInvalid {
                    feature: id.clone(),
                    dependency: input,
                });
            }
        }
    }
    let mut grouped = BTreeSet::new();
    for (id, group) in &state.groups {
        if id != &group.id || id.0.is_empty() || group.features.is_empty() {
            return Err(FeatureGraphError::InvalidGroup);
        }
        for feature in &group.features {
            if !state.document.features.contains_key(feature) || !grouped.insert(feature.clone()) {
                return Err(FeatureGraphError::InvalidGroup);
            }
        }
    }
    Ok(())
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum FeatureGraphError {
    MissingFeature(FeatureId),
    MissingComponent(ComponentId),
    FeatureIdentityMismatch(FeatureId),
    InvalidFeatureOrder,
    DependencyOrderInvalid {
        feature: FeatureId,
        dependency: FeatureId,
    },
    ReorderBlocked {
        feature: FeatureId,
        blocker: FeatureId,
    },
    DeleteBlocked {
        feature: FeatureId,
        blocker: FeatureId,
    },
    GeneratedBodyBlocksDelete {
        feature: FeatureId,
        body: String,
    },
    InvalidRollback(FeatureId),
    AfterRollback(FeatureId),
    DependencyAfterRollback(FeatureId),
    CrossComponentReorder,
    CrossComponentGroup,
    DuplicateGroup(FeatureGroupId),
    FeatureAlreadyGrouped(FeatureId),
    InvalidGroup,
    EmptyName,
    InvalidTransaction,
    BaseHashMismatch,
    BaseRevisionMismatch,
    InvalidResultRevision,
    RevisionOverflow,
    UndoStateChanged,
    InvalidUndoRecord,
    InvalidFeatureCreate(FeatureId),
    CrossComponentEdit,
}

impl Display for FeatureGraphError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        write!(formatter, "feature graph operation failed: {self:?}")
    }
}

impl Error for FeatureGraphError {}
