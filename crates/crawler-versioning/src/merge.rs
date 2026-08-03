use crate::{StructuralDiff, VersionedDocument, structural_diff};
use crawler_document::{Document, DocumentTransaction, FeatureRecomputeState, TransactionId};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;
use std::fmt::{self, Display, Formatter};

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConflictKind {
    DocumentField,
    EntityEdit,
    ParameterEdit,
    FeatureEdit,
    TopologyReferenceEdit,
    GeometryPayload,
    Provenance,
    RequiredFeatures,
    History,
    DeleteVsEdit,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MergeConflict {
    pub kind: ConflictKind,
    pub semantic_id: String,
    pub field: String,
    pub base: Value,
    pub left: Value,
    pub right: Value,
}

pub trait DocumentRecompute {
    /// Validate and recompute the merged candidate. Returning an error prevents
    /// publication of any merged document.
    fn validate_and_recompute(&self, candidate: Document) -> Result<Document, String>;
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MergeReport {
    pub left_changes: StructuralDiff,
    pub right_changes: StructuralDiff,
    /// Deterministic lexicographic transaction-ID order used for independent
    /// branch suffixes. This makes history reconciliation explicit.
    pub history_order: Vec<TransactionId>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MergeResult {
    pub merged: VersionedDocument,
    pub report: MergeReport,
}

#[derive(Clone, Debug, PartialEq)]
pub enum MergeError {
    Conflicts(Vec<MergeConflict>),
    RecomputeFailed(String),
    RecomputeNotAccepted(String),
    InvalidMergedDocument(String),
}

impl Display for MergeError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        match self {
            Self::Conflicts(conflicts) => {
                write!(formatter, "merge has {} conflict(s)", conflicts.len())
            }
            Self::RecomputeFailed(message) => {
                write!(formatter, "merged recompute failed: {message}")
            }
            Self::RecomputeNotAccepted(message) => {
                write!(formatter, "merged recompute was not accepted: {message}")
            }
            Self::InvalidMergedDocument(message) => {
                write!(formatter, "merged document is invalid: {message}")
            }
        }
    }
}

impl Error for MergeError {}

pub fn merge_three_way(
    base: &VersionedDocument,
    left: &VersionedDocument,
    right: &VersionedDocument,
    recompute: &impl DocumentRecompute,
) -> Result<MergeResult, MergeError> {
    let left_changes = structural_diff(base, left);
    let right_changes = structural_diff(base, right);
    let mut conflicts = Vec::new();

    require_same_identity(base, left, right, &mut conflicts);
    let mut merged = base.clone();
    merged.document.display_name = merge_scalar(
        &base.document.display_name,
        &left.document.display_name,
        &right.document.display_name,
        ConflictKind::DocumentField,
        &base.document.id.0,
        "display_name",
        &mut conflicts,
    );
    merged.document.units = merge_scalar(
        &base.document.units,
        &left.document.units,
        &right.document.units,
        ConflictKind::DocumentField,
        &base.document.id.0,
        "units",
        &mut conflicts,
    );
    merged.required_features = merge_scalar(
        &base.required_features,
        &left.required_features,
        &right.required_features,
        ConflictKind::RequiredFeatures,
        &base.document.id.0,
        "required_features",
        &mut conflicts,
    );

    merged.document.origin_planes = merge_map(
        &base.document.origin_planes,
        &left.document.origin_planes,
        &right.document.origin_planes,
        ConflictKind::EntityEdit,
        "origin_planes",
        |id| id.0.clone(),
        &mut conflicts,
    );
    merged.document.components = merge_map(
        &base.document.components,
        &left.document.components,
        &right.document.components,
        ConflictKind::EntityEdit,
        "components",
        |id| id.0.clone(),
        &mut conflicts,
    );
    merged.document.bodies = merge_map(
        &base.document.bodies,
        &left.document.bodies,
        &right.document.bodies,
        ConflictKind::EntityEdit,
        "bodies",
        |id| id.0.clone(),
        &mut conflicts,
    );
    merged.document.sketches = merge_map(
        &base.document.sketches,
        &left.document.sketches,
        &right.document.sketches,
        ConflictKind::EntityEdit,
        "sketches",
        |id| id.0.clone(),
        &mut conflicts,
    );
    merged.document.features = merge_map(
        &base.document.features,
        &left.document.features,
        &right.document.features,
        ConflictKind::FeatureEdit,
        "features",
        |id| id.0.clone(),
        &mut conflicts,
    );
    merged.document.parameters = merge_map(
        &base.document.parameters,
        &left.document.parameters,
        &right.document.parameters,
        ConflictKind::ParameterEdit,
        "parameters",
        |id| id.0.clone(),
        &mut conflicts,
    );
    merged.document.topology_references = merge_map(
        &base.document.topology_references,
        &left.document.topology_references,
        &right.document.topology_references,
        ConflictKind::TopologyReferenceEdit,
        "topology_references",
        |id| id.0.clone(),
        &mut conflicts,
    );
    merged.geometry_payloads = merge_map(
        &base.geometry_payloads,
        &left.geometry_payloads,
        &right.geometry_payloads,
        ConflictKind::GeometryPayload,
        "geometry_payloads",
        Clone::clone,
        &mut conflicts,
    );
    merged.provenance = merge_map(
        &base.provenance,
        &left.provenance,
        &right.provenance,
        ConflictKind::Provenance,
        "provenance",
        Clone::clone,
        &mut conflicts,
    );

    let history = merge_history(
        &base.document,
        &left.document,
        &right.document,
        &mut conflicts,
    );
    if !conflicts.is_empty() {
        conflicts.sort_by(|left, right| {
            (left.kind, &left.semantic_id, &left.field).cmp(&(
                right.kind,
                &right.semantic_id,
                &right.field,
            ))
        });
        return Err(MergeError::Conflicts(conflicts));
    }

    let history_order = history
        .transactions
        .iter()
        .skip(base.document.transactions.len())
        .map(|transaction| transaction.id.clone())
        .collect();
    merged.document.transactions = history.transactions;
    merged.document.revision = history.result_revision;
    merged.document.recompute.accepted_revision = history.result_revision;
    for feature in merged.document.features.keys() {
        merged.document.recompute.features.insert(
            feature.clone(),
            FeatureRecomputeState::Dirty {
                since_revision: history.result_revision,
            },
        );
    }
    validate_document_contract(&merged.document)?;
    let recomputed = recompute
        .validate_and_recompute(merged.document.clone())
        .map_err(MergeError::RecomputeFailed)?;
    validate_accepted_recompute(&merged.document, &recomputed)?;
    merged.document = recomputed;
    Ok(MergeResult {
        merged,
        report: MergeReport {
            left_changes,
            right_changes,
            history_order,
        },
    })
}

struct MergedHistory {
    transactions: Vec<DocumentTransaction>,
    result_revision: u64,
}

fn merge_history(
    base: &Document,
    left: &Document,
    right: &Document,
    conflicts: &mut Vec<MergeConflict>,
) -> MergedHistory {
    let base_len = base.transactions.len();
    if left.transactions.get(..base_len) != Some(base.transactions.as_slice())
        || right.transactions.get(..base_len) != Some(base.transactions.as_slice())
    {
        conflicts.push(conflict(
            ConflictKind::History,
            &base.id.0,
            "transactions.base_prefix",
            &base.transactions,
            &left.transactions,
            &right.transactions,
        ));
        return MergedHistory {
            transactions: base.transactions.clone(),
            result_revision: base.revision,
        };
    }
    let mut suffixes: BTreeMap<TransactionId, DocumentTransaction> = BTreeMap::new();
    for transaction in left.transactions[base_len..]
        .iter()
        .chain(&right.transactions[base_len..])
    {
        if let Some(existing) = suffixes.get(&transaction.id) {
            if existing != transaction {
                conflicts.push(conflict(
                    ConflictKind::History,
                    &transaction.id.0,
                    "transaction",
                    &Value::Null,
                    existing,
                    transaction,
                ));
            }
        } else {
            suffixes.insert(transaction.id.clone(), transaction.clone());
        }
    }
    let mut transactions = base.transactions.clone();
    let mut revision = base.revision;
    for (_, mut transaction) in suffixes {
        let Some(result_revision) = revision.checked_add(1) else {
            conflicts.push(conflict(
                ConflictKind::History,
                &base.id.0,
                "revision_overflow",
                &revision,
                &left.revision,
                &right.revision,
            ));
            break;
        };
        transaction.base_revision = revision;
        transaction.result_revision = result_revision;
        revision = result_revision;
        transactions.push(transaction);
    }
    MergedHistory {
        transactions,
        result_revision: revision,
    }
}

fn require_same_identity(
    base: &VersionedDocument,
    left: &VersionedDocument,
    right: &VersionedDocument,
    conflicts: &mut Vec<MergeConflict>,
) {
    if base.document.id != left.document.id || base.document.id != right.document.id {
        conflicts.push(conflict(
            ConflictKind::DocumentField,
            &base.document.id.0,
            "id",
            &base.document.id,
            &left.document.id,
            &right.document.id,
        ));
    }
    if base.document.schema_version != left.document.schema_version
        || base.document.schema_version != right.document.schema_version
    {
        conflicts.push(conflict(
            ConflictKind::DocumentField,
            &base.document.id.0,
            "schema_version",
            &base.document.schema_version,
            &left.document.schema_version,
            &right.document.schema_version,
        ));
    }
    if base.document.root_component != left.document.root_component
        || base.document.root_component != right.document.root_component
    {
        conflicts.push(conflict(
            ConflictKind::DocumentField,
            &base.document.id.0,
            "root_component",
            &base.document.root_component,
            &left.document.root_component,
            &right.document.root_component,
        ));
    }
}

fn merge_scalar<T: Clone + PartialEq + Serialize>(
    base: &T,
    left: &T,
    right: &T,
    kind: ConflictKind,
    semantic_id: &str,
    field: &str,
    conflicts: &mut Vec<MergeConflict>,
) -> T {
    if left == right {
        return left.clone();
    }
    if left == base {
        return right.clone();
    }
    if right == base {
        return left.clone();
    }
    conflicts.push(conflict(kind, semantic_id, field, base, left, right));
    base.clone()
}

fn merge_map<K, V, F>(
    base: &BTreeMap<K, V>,
    left: &BTreeMap<K, V>,
    right: &BTreeMap<K, V>,
    kind: ConflictKind,
    field: &str,
    key_text: F,
    conflicts: &mut Vec<MergeConflict>,
) -> BTreeMap<K, V>
where
    K: Clone + Ord,
    V: Clone + PartialEq + Serialize,
    F: Fn(&K) -> String,
{
    let keys: BTreeSet<_> = base.keys().chain(left.keys()).chain(right.keys()).collect();
    let mut merged = BTreeMap::new();
    for key in keys {
        let base_value = base.get(key);
        let left_value = left.get(key);
        let right_value = right.get(key);
        let selected = if left_value == right_value {
            left_value.cloned()
        } else if left_value == base_value {
            right_value.cloned()
        } else if right_value == base_value {
            left_value.cloned()
        } else {
            let conflict_kind =
                if base_value.is_some() && (left_value.is_none() || right_value.is_none()) {
                    ConflictKind::DeleteVsEdit
                } else {
                    kind
                };
            conflicts.push(MergeConflict {
                kind: conflict_kind,
                semantic_id: key_text(key),
                field: field.into(),
                base: option_value(base_value),
                left: option_value(left_value),
                right: option_value(right_value),
            });
            base_value.cloned()
        };
        if let Some(value) = selected {
            merged.insert(key.clone(), value);
        }
    }
    merged
}

fn validate_document_contract(document: &Document) -> Result<(), MergeError> {
    if !document.components.contains_key(&document.root_component) {
        return Err(MergeError::InvalidMergedDocument(
            "root component is missing".into(),
        ));
    }
    for (feature_id, feature) in &document.features {
        if !document.components.contains_key(&feature.component) {
            return Err(MergeError::InvalidMergedDocument(format!(
                "feature {} has a missing component",
                feature_id.0
            )));
        }
        for parameter in feature.parameters.values() {
            if !document.parameters.contains_key(parameter) {
                return Err(MergeError::InvalidMergedDocument(format!(
                    "feature {} has missing parameter {}",
                    feature_id.0, parameter.0
                )));
            }
        }
        for dependency in &feature.dependencies {
            if !document.features.contains_key(dependency) {
                return Err(MergeError::InvalidMergedDocument(format!(
                    "feature {} has missing dependency {}",
                    feature_id.0, dependency.0
                )));
            }
        }
    }
    Ok(())
}

fn validate_accepted_recompute(candidate: &Document, result: &Document) -> Result<(), MergeError> {
    if result.schema_version != candidate.schema_version
        || result.id != candidate.id
        || result.display_name != candidate.display_name
        || result.revision != candidate.revision
        || result.units != candidate.units
        || result.root_component != candidate.root_component
        || result.origin_planes != candidate.origin_planes
        || result.components != candidate.components
        || result.bodies != candidate.bodies
        || result.sketches != candidate.sketches
        || result.features != candidate.features
        || result.parameters != candidate.parameters
        || result.transactions != candidate.transactions
        || result.recompute.accepted_revision != result.revision
    {
        return Err(MergeError::RecomputeNotAccepted(
            "recompute changed design intent or did not accept the merged revision".into(),
        ));
    }
    for feature in result.features.keys() {
        if result.recompute.features.get(feature)
            != Some(&FeatureRecomputeState::Clean {
                evaluated_revision: result.revision,
            })
        {
            return Err(MergeError::RecomputeNotAccepted(format!(
                "feature {} is not clean at merged revision",
                feature.0
            )));
        }
    }
    validate_document_contract(result)
}

fn conflict<B: Serialize, L: Serialize, R: Serialize>(
    kind: ConflictKind,
    semantic_id: &str,
    field: &str,
    base: &B,
    left: &L,
    right: &R,
) -> MergeConflict {
    MergeConflict {
        kind,
        semantic_id: semantic_id.into(),
        field: field.into(),
        base: serde_json::to_value(base).expect("conflict value serializes"),
        left: serde_json::to_value(left).expect("conflict value serializes"),
        right: serde_json::to_value(right).expect("conflict value serializes"),
    }
}

fn option_value<T: Serialize>(value: Option<&T>) -> Value {
    value
        .map(|value| serde_json::to_value(value).expect("conflict value serializes"))
        .unwrap_or(Value::Null)
}
