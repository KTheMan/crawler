//! Deterministic structural diff, three-way merge, and schema migration.

mod diff;
mod merge;
mod migration;

pub use diff::{ChangeKind, SemanticAddress, StructuralChange, StructuralDiff, structural_diff};
pub use merge::{
    ConflictKind, DocumentRecompute, MergeConflict, MergeError, MergeReport, MergeResult,
    merge_three_way,
};
pub use migration::{MigrationError, MigrationOutcome, MigrationRegistry, MigrationStepDescriptor};

use crawler_document::Document;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GeometryPayloadEvidence {
    pub media_type: String,
    pub content_hash: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ProvenanceRecord {
    pub source_document: String,
    pub source_revision: u64,
    pub source_content_hash: String,
}

/// Authoritative semantic document plus versioning-only sidecar evidence.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct VersionedDocument {
    pub document: Document,
    pub required_features: BTreeSet<String>,
    /// Stable owning semantic entity ID -> immutable geometry payload evidence.
    pub geometry_payloads: BTreeMap<String, GeometryPayloadEvidence>,
    /// Stable owning semantic entity ID -> source provenance.
    pub provenance: BTreeMap<String, ProvenanceRecord>,
}

impl VersionedDocument {
    pub fn new(document: Document) -> Self {
        Self {
            document,
            required_features: BTreeSet::new(),
            geometry_payloads: BTreeMap::new(),
            provenance: BTreeMap::new(),
        }
    }

    pub fn semantic_hash(&self) -> String {
        let bytes = serde_json::to_vec(self).expect("versioned documents are serializable");
        format!("{:x}", Sha256::digest(bytes))
    }
}
