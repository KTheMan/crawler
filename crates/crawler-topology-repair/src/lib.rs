//! Fail-closed topology-reference repair for Crawler documents.
//!
//! Candidate ranking is evidence for an explicit user choice, never authority
//! to mutate a document. Accepted repairs are mirrored into the shared durable
//! document transaction journal.

use crawler_document::{
    Document, DocumentChange, DocumentTransaction, FeatureId, FeatureInput, FeatureRecomputeState,
    TopologyKind, TopologyReference, TopologyReferenceId, TopologySignature, TransactionId,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;
use std::fmt::{self, Display, Formatter};

pub const REPAIR_ENVELOPE_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SignatureDistance {
    pub position_delta: u64,
    pub normal_delta: u64,
    pub measure_delta: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RankedCandidate {
    pub rank: u32,
    pub score: SignatureDistance,
    pub candidate: TopologyReference,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UnresolvedCause {
    MissingReferenceDefinition,
    StableIdentityMissing,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UnresolvedTopologyInput {
    pub feature: FeatureId,
    pub input_name: String,
    pub reference: TopologyReferenceId,
    pub cause: UnresolvedCause,
    pub expected: Option<TopologyReference>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub enum CandidateSelection {
    NoCandidates,
    Unique {
        candidate: TopologyReferenceId,
    },
    Ambiguous {
        candidates: Vec<TopologyReferenceId>,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DownstreamStopSummary {
    pub stopped_at: FeatureId,
    /// Includes the feature with the unresolved input and all transitive
    /// dependants, in deterministic evaluation order.
    pub blocked_features: Vec<FeatureId>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RepairPreview {
    pub base_document_hash: String,
    pub base_revision: u64,
    pub unresolved: UnresolvedTopologyInput,
    pub candidates: Vec<RankedCandidate>,
    pub selection: CandidateSelection,
    pub downstream_stop: DownstreamStopSummary,
    /// Always true for an unresolved input. Candidate ranking is advisory and
    /// cannot authorize a document mutation.
    pub explicit_rebind_required: bool,
}

impl RepairPreview {
    /// Creates the explicit transaction DTO for the selected preview row.
    /// Ambiguity never selects a row on the caller's behalf.
    pub fn explicit_rebind(
        &self,
        transaction_id: impl Into<String>,
        selected: &TopologyReferenceId,
    ) -> Result<RepairTransactionEnvelope, RepairError> {
        let replacement = self
            .candidates
            .iter()
            .find(|ranked| &ranked.candidate.id == selected)
            .map(|ranked| ranked.candidate.clone())
            .ok_or_else(|| {
                RepairError::new(
                    RepairErrorKind::ReplacementNotInPreview(selected.clone()),
                    self.base_document_hash.clone(),
                )
            })?;
        let result_revision = self.base_revision.checked_add(1).ok_or_else(|| {
            RepairError::new(
                RepairErrorKind::RevisionOverflow,
                self.base_document_hash.clone(),
            )
        })?;
        Ok(RepairTransactionEnvelope {
            schema_version: REPAIR_ENVELOPE_SCHEMA_VERSION,
            id: transaction_id.into(),
            base_document_hash: self.base_document_hash.clone(),
            base_revision: self.base_revision,
            result_revision,
            changes: vec![RebindTopologyInput {
                feature: self.unresolved.feature.clone(),
                input_name: self.unresolved.input_name.clone(),
                from_reference: self.unresolved.reference.clone(),
                replacement,
            }],
        })
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub enum RepairInspection {
    Ready {
        document_hash: String,
        revision: u64,
    },
    EvaluationBlocked {
        preview: Box<RepairPreview>,
    },
}

/// JSON-ready, read-only inspection of the topology repair boundary.
pub fn inspect_topology_repair(
    document: &Document,
    observed: &[TopologyReference],
) -> Result<RepairInspection, RepairError> {
    Ok(match preview_first_unresolved(document, observed)? {
        Some(preview) => RepairInspection::EvaluationBlocked {
            preview: Box::new(preview),
        },
        None => RepairInspection::Ready {
            document_hash: canonical_document_hash(document),
            revision: document.revision,
        },
    })
}

/// Builds a transaction draft from an explicit candidate ID. This function is
/// deliberately separate from `apply_rebind`; drafting never commits.
pub fn draft_explicit_rebind(
    preview: &RepairPreview,
    transaction_id: impl Into<String>,
    selected: &TopologyReferenceId,
) -> Result<RepairTransactionEnvelope, RepairError> {
    preview.explicit_rebind(transaction_id, selected)
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RebindTopologyInput {
    pub feature: FeatureId,
    pub input_name: String,
    pub from_reference: TopologyReferenceId,
    pub replacement: TopologyReference,
}

/// Typed preview/commit envelope retained for repair-specific diagnostics.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RepairTransactionEnvelope {
    pub schema_version: u32,
    pub id: String,
    pub base_document_hash: String,
    pub base_revision: u64,
    pub result_revision: u64,
    pub changes: Vec<RebindTopologyInput>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RepairUndoRecord {
    pub transaction_id: String,
    pub before_document_hash: String,
    pub after_document_hash: String,
    pub before: Document,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DownstreamRecoverySummary {
    pub resume_from: FeatureId,
    pub dirtied_features: Vec<FeatureId>,
    pub prior_states: BTreeMap<FeatureId, Option<FeatureRecomputeState>>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DownstreamRecoveryReport {
    pub resume_from: FeatureId,
    pub recovered_features: Vec<FeatureId>,
    pub pending_features: Vec<FeatureId>,
    pub failed_features: Vec<FeatureId>,
}

/// Summarizes accepted recompute state without changing the document.
pub fn summarize_downstream_recovery(
    document: &Document,
    resume_from: &FeatureId,
) -> Result<DownstreamRecoveryReport, RepairError> {
    let document_hash = canonical_document_hash(document);
    validate_document(document).map_err(|kind| RepairError::new(kind, document_hash.clone()))?;
    if !document.features.contains_key(resume_from) {
        return Err(RepairError::new(
            RepairErrorKind::MissingFeature(resume_from.clone()),
            document_hash,
        ));
    }
    let mut report = DownstreamRecoveryReport {
        resume_from: resume_from.clone(),
        recovered_features: Vec::new(),
        pending_features: Vec::new(),
        failed_features: Vec::new(),
    };
    for feature in downstream_features(document, resume_from) {
        match document.recompute.features.get(&feature) {
            Some(FeatureRecomputeState::Dirty { .. }) => report.pending_features.push(feature),
            Some(FeatureRecomputeState::Failed { .. }) => report.failed_features.push(feature),
            Some(FeatureRecomputeState::Clean { .. }) | None => {
                report.recovered_features.push(feature);
            }
        }
    }
    Ok(report)
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RepairCommit {
    pub document: Document,
    pub transaction: RepairTransactionEnvelope,
    pub undo: RepairUndoRecord,
    pub recovery: DownstreamRecoverySummary,
}

/// Finds only the first unresolved topology input. Evaluation must remain
/// stopped there until an explicit repair transaction is accepted.
pub fn preview_first_unresolved(
    document: &Document,
    observed: &[TopologyReference],
) -> Result<Option<RepairPreview>, RepairError> {
    let prior_hash = canonical_document_hash(document);
    validate_document(document).map_err(|kind| RepairError::new(kind, prior_hash.clone()))?;

    for feature_id in feature_order(document) {
        let feature = &document.features[&feature_id];
        for (input_name, input) in &feature.inputs {
            let FeatureInput::Topology(reference_id) = input else {
                continue;
            };
            let expected = document.topology_references.get(reference_id).cloned();
            let resolved = expected.as_ref().is_some_and(|expected| {
                observed
                    .iter()
                    .any(|candidate| same_stable_identity(expected, candidate))
            });
            if resolved {
                continue;
            }
            let cause = if expected.is_some() {
                UnresolvedCause::StableIdentityMissing
            } else {
                UnresolvedCause::MissingReferenceDefinition
            };
            let candidates = expected
                .as_ref()
                .map(|expected| rank_candidates(expected, observed))
                .unwrap_or_default();
            let selection = selection(&candidates);
            let blocked_features = downstream_features(document, &feature_id);
            return Ok(Some(RepairPreview {
                base_document_hash: prior_hash,
                base_revision: document.revision,
                unresolved: UnresolvedTopologyInput {
                    feature: feature_id.clone(),
                    input_name: input_name.clone(),
                    reference: reference_id.clone(),
                    cause,
                    expected,
                },
                candidates,
                selection,
                downstream_stop: DownstreamStopSummary {
                    stopped_at: feature_id,
                    blocked_features,
                },
                explicit_rebind_required: true,
            }));
        }
    }
    Ok(None)
}

pub fn apply_rebind(
    document: &Document,
    transaction: &RepairTransactionEnvelope,
) -> Result<RepairCommit, RepairError> {
    let prior_hash = canonical_document_hash(document);
    validate_document(document).map_err(|kind| RepairError::new(kind, prior_hash.clone()))?;
    validate_transaction(document, transaction, &prior_hash)?;

    let change = &transaction.changes[0];
    let old = document
        .topology_references
        .get(&change.from_reference)
        .expect("validated transaction has source reference");
    if old.kind != change.replacement.kind {
        return Err(RepairError::new(
            RepairErrorKind::ReplacementKindMismatch {
                expected: old.kind,
                actual: change.replacement.kind,
            },
            prior_hash,
        ));
    }
    if let Some(existing) = document.topology_references.get(&change.replacement.id)
        && existing != &change.replacement
    {
        return Err(RepairError::new(
            RepairErrorKind::ReplacementIdentityCollision(change.replacement.id.clone()),
            prior_hash,
        ));
    }

    let mut candidate = document.clone();
    candidate
        .topology_references
        .insert(change.replacement.id.clone(), change.replacement.clone());
    let feature = candidate
        .features
        .get_mut(&change.feature)
        .expect("validated transaction has feature");
    feature.inputs.insert(
        change.input_name.clone(),
        FeatureInput::Topology(change.replacement.id.clone()),
    );
    candidate.revision = transaction.result_revision;

    let dirtied_features = downstream_features(&candidate, &change.feature);
    let prior_states = dirtied_features
        .iter()
        .map(|feature| {
            (
                feature.clone(),
                candidate.recompute.features.get(feature).cloned(),
            )
        })
        .collect();
    for feature in &dirtied_features {
        candidate.recompute.features.insert(
            feature.clone(),
            FeatureRecomputeState::Dirty {
                since_revision: transaction.result_revision,
            },
        );
    }
    candidate.transactions.push(DocumentTransaction {
        id: TransactionId(transaction.id.clone()),
        base_revision: transaction.base_revision,
        result_revision: transaction.result_revision,
        changes: vec![DocumentChange::RebindTopology {
            feature: change.feature.clone(),
            input_name: change.input_name.clone(),
            from_reference: change.from_reference.clone(),
            replacement: change.replacement.clone(),
        }],
    });
    validate_document(&candidate).map_err(|kind| RepairError::new(kind, prior_hash.clone()))?;
    let after_hash = canonical_document_hash(&candidate);
    Ok(RepairCommit {
        document: candidate,
        transaction: transaction.clone(),
        undo: RepairUndoRecord {
            transaction_id: transaction.id.clone(),
            before_document_hash: prior_hash,
            after_document_hash: after_hash,
            before: document.clone(),
        },
        recovery: DownstreamRecoverySummary {
            resume_from: change.feature.clone(),
            dirtied_features,
            prior_states,
        },
    })
}

pub fn apply_undo(current: &Document, undo: &RepairUndoRecord) -> Result<Document, RepairError> {
    let current_hash = canonical_document_hash(current);
    if current_hash != undo.after_document_hash {
        return Err(RepairError::new(
            RepairErrorKind::UndoDocumentChanged,
            current_hash,
        ));
    }
    if canonical_document_hash(&undo.before) != undo.before_document_hash {
        return Err(RepairError::new(
            RepairErrorKind::InvalidUndoRecord,
            current_hash,
        ));
    }
    validate_document(&undo.before).map_err(|kind| RepairError::new(kind, current_hash.clone()))?;
    Ok(undo.before.clone())
}

pub fn canonical_document_hash(document: &Document) -> String {
    let bytes = serde_json::to_vec(document).expect("Crawler documents are serializable");
    format!("{:x}", Sha256::digest(bytes))
}

fn validate_transaction(
    document: &Document,
    transaction: &RepairTransactionEnvelope,
    prior_hash: &str,
) -> Result<(), RepairError> {
    let fail = |kind| RepairError::new(kind, prior_hash.to_owned());
    if transaction.schema_version != REPAIR_ENVELOPE_SCHEMA_VERSION
        || transaction.id.is_empty()
        || transaction.changes.len() != 1
    {
        return Err(fail(RepairErrorKind::InvalidTransactionEnvelope));
    }
    if transaction.base_document_hash != prior_hash {
        return Err(fail(RepairErrorKind::BaseDocumentHashMismatch));
    }
    if transaction.base_revision != document.revision {
        return Err(fail(RepairErrorKind::BaseRevisionMismatch));
    }
    let expected_revision = document
        .revision
        .checked_add(1)
        .ok_or_else(|| fail(RepairErrorKind::RevisionOverflow))?;
    if transaction.result_revision != expected_revision {
        return Err(fail(RepairErrorKind::InvalidResultRevision));
    }
    let change = &transaction.changes[0];
    if change.replacement.id.0.is_empty() || change.replacement.id == change.from_reference {
        return Err(fail(RepairErrorKind::InvalidReplacementIdentity));
    }
    let feature = document
        .features
        .get(&change.feature)
        .ok_or_else(|| fail(RepairErrorKind::MissingFeature(change.feature.clone())))?;
    match feature.inputs.get(&change.input_name) {
        Some(FeatureInput::Topology(current)) if current == &change.from_reference => {}
        _ => return Err(fail(RepairErrorKind::StaleTopologyBinding)),
    }
    if !document
        .topology_references
        .contains_key(&change.from_reference)
    {
        return Err(fail(RepairErrorKind::MissingSourceReference(
            change.from_reference.clone(),
        )));
    }
    Ok(())
}

fn validate_document(document: &Document) -> Result<(), RepairErrorKind> {
    if !document.components.contains_key(&document.root_component) {
        return Err(RepairErrorKind::InvalidDocument(
            "root component is missing".into(),
        ));
    }
    for (id, feature) in &document.features {
        if id != &feature.id {
            return Err(RepairErrorKind::InvalidDocument(format!(
                "feature map key {} differs from embedded id {}",
                id.0, feature.id.0
            )));
        }
        for dependency in &feature.dependencies {
            if !document.features.contains_key(dependency) {
                return Err(RepairErrorKind::InvalidDocument(format!(
                    "feature {} has missing dependency {}",
                    id.0, dependency.0
                )));
            }
        }
        // A missing topology definition is intentionally allowed here: it is
        // one of the unresolved states this repair domain must diagnose.
    }
    for (id, reference) in &document.topology_references {
        if id != &reference.id {
            return Err(RepairErrorKind::InvalidDocument(format!(
                "topology map key {} differs from embedded id {}",
                id.0, reference.id.0
            )));
        }
        if !document.bodies.contains_key(&reference.body)
            || !document.features.contains_key(&reference.producer)
        {
            return Err(RepairErrorKind::InvalidDocument(format!(
                "topology reference {} has a missing body or producer",
                id.0
            )));
        }
    }
    Ok(())
}

fn same_stable_identity(expected: &TopologyReference, observed: &TopologyReference) -> bool {
    expected.kind == observed.kind
        && expected.body == observed.body
        && expected.producer == observed.producer
        && (expected.stable_token == observed.stable_token
            || expected.stable_kernel_id == observed.stable_kernel_id)
}

fn rank_candidates(
    expected: &TopologyReference,
    observed: &[TopologyReference],
) -> Vec<RankedCandidate> {
    let mut scored: Vec<_> = observed
        .iter()
        .filter(|candidate| candidate.kind == expected.kind)
        .filter_map(|candidate| {
            signature_distance(&expected.fallback_signature, &candidate.fallback_signature)
                .map(|score| (score, candidate.clone()))
        })
        .collect();
    scored.sort_by(|(left_score, left), (right_score, right)| {
        left_score
            .cmp(right_score)
            .then_with(|| left.id.cmp(&right.id))
    });
    scored
        .into_iter()
        .enumerate()
        .map(|(index, (score, candidate))| RankedCandidate {
            rank: u32::try_from(index + 1).unwrap_or(u32::MAX),
            score,
            candidate,
        })
        .collect()
}

fn selection(candidates: &[RankedCandidate]) -> CandidateSelection {
    let Some(first) = candidates.first() else {
        return CandidateSelection::NoCandidates;
    };
    let tied: Vec<_> = candidates
        .iter()
        .take_while(|candidate| candidate.score == first.score)
        .map(|candidate| candidate.candidate.id.clone())
        .collect();
    if tied.len() == 1 {
        CandidateSelection::Unique {
            candidate: tied[0].clone(),
        }
    } else {
        CandidateSelection::Ambiguous { candidates: tied }
    }
}

fn signature_distance(
    expected: &TopologySignature,
    candidate: &TopologySignature,
) -> Option<SignatureDistance> {
    match (expected, candidate) {
        (
            TopologySignature::Vertex {
                position_nanometers: left,
            },
            TopologySignature::Vertex {
                position_nanometers: right,
            },
        ) => Some(SignatureDistance {
            position_delta: vector_delta(*left, *right),
            normal_delta: 0,
            measure_delta: 0,
        }),
        (
            TopologySignature::Edge {
                midpoint_nanometers: left,
                length_nanometers: left_length,
            },
            TopologySignature::Edge {
                midpoint_nanometers: right,
                length_nanometers: right_length,
            },
        ) => Some(SignatureDistance {
            position_delta: vector_delta(*left, *right),
            normal_delta: 0,
            measure_delta: left_length.abs_diff(*right_length),
        }),
        (
            TopologySignature::Face {
                centroid_nanometers: left,
                normal_millionths: left_normal,
                area_square_nanometers: left_area,
            },
            TopologySignature::Face {
                centroid_nanometers: right,
                normal_millionths: right_normal,
                area_square_nanometers: right_area,
            },
        ) => Some(SignatureDistance {
            position_delta: vector_delta(*left, *right),
            normal_delta: vector_delta(*left_normal, *right_normal),
            measure_delta: left_area.abs_diff(*right_area),
        }),
        _ => None,
    }
}

fn vector_delta(left: [i64; 3], right: [i64; 3]) -> u64 {
    left.into_iter()
        .zip(right)
        .fold(0_u64, |sum, (left, right)| {
            sum.saturating_add(left.abs_diff(right))
        })
}

fn feature_order(document: &Document) -> Vec<FeatureId> {
    let mut ordered = Vec::new();
    let mut seen = BTreeSet::new();
    for component in document.components.values() {
        for feature in &component.feature_order {
            if document.features.contains_key(feature) && seen.insert(feature.clone()) {
                ordered.push(feature.clone());
            }
        }
    }
    for feature in document.features.keys() {
        if seen.insert(feature.clone()) {
            ordered.push(feature.clone());
        }
    }
    ordered
}

fn downstream_features(document: &Document, start: &FeatureId) -> Vec<FeatureId> {
    let mut blocked = BTreeSet::from([start.clone()]);
    loop {
        let before = blocked.len();
        for (id, feature) in &document.features {
            if feature
                .dependencies
                .iter()
                .any(|dependency| blocked.contains(dependency))
            {
                blocked.insert(id.clone());
            }
        }
        if blocked.len() == before {
            break;
        }
    }
    feature_order(document)
        .into_iter()
        .filter(|feature| blocked.contains(feature))
        .collect()
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RepairErrorKind {
    InvalidDocument(String),
    InvalidTransactionEnvelope,
    BaseDocumentHashMismatch,
    BaseRevisionMismatch,
    InvalidResultRevision,
    RevisionOverflow,
    InvalidReplacementIdentity,
    ReplacementNotInPreview(TopologyReferenceId),
    ReplacementKindMismatch {
        expected: TopologyKind,
        actual: TopologyKind,
    },
    ReplacementIdentityCollision(TopologyReferenceId),
    MissingFeature(FeatureId),
    MissingSourceReference(TopologyReferenceId),
    StaleTopologyBinding,
    UndoDocumentChanged,
    InvalidUndoRecord,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RepairError {
    pub kind: RepairErrorKind,
    /// Hash of the caller-owned document at the point the operation failed.
    pub preserved_document_hash: String,
}

impl RepairError {
    fn new(kind: RepairErrorKind, preserved_document_hash: String) -> Self {
        Self {
            kind,
            preserved_document_hash,
        }
    }
}

impl Display for RepairError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "topology repair failed ({:?}); document {} was preserved",
            self.kind, self.preserved_document_hash
        )
    }
}

impl Error for RepairError {}
