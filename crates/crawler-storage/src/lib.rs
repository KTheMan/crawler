//! Canonical part persistence and accepted-transaction recovery.

use crawler_document::{Document, DocumentTransaction};
use crawler_history::{DocumentHistory, semantic_hash};
use crawler_package::{
    DocumentKind, PackageError, PackageFormatVersion, PackageManifest, PayloadDescriptor,
    PayloadMediaType, PayloadRole, PortablePackage,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use thiserror::Error;

const ROOT_PAYLOAD: &str = "document";

/// Save semantic state into a verified deterministic part-package entry set.
pub fn save_part(
    document: &Document,
    required_features: BTreeSet<String>,
) -> Result<PortablePackage, StorageError> {
    let document_bytes = canonical_document_bytes(document)?;
    let descriptor = PayloadDescriptor::from_bytes(
        PayloadRole::SemanticDocument,
        PayloadMediaType::CrawlerDocumentJson,
        &document_bytes,
    );
    let manifest = PackageManifest {
        format_version: PackageFormatVersion::V1,
        package_id: document.id.0.clone(),
        document_kind: DocumentKind::Part,
        document_schema_version: document.schema_version.get(),
        required_features,
        root_payload: ROOT_PAYLOAD.to_owned(),
        payloads: BTreeMap::from([(ROOT_PAYLOAD.to_owned(), descriptor)]),
    };
    Ok(PortablePackage::from_payloads(
        manifest,
        BTreeMap::from([(ROOT_PAYLOAD.to_owned(), document_bytes)]),
    )?)
}

/// Load only after structural, checksum, schema, and required-feature checks.
pub fn load_part(
    package: &PortablePackage,
    supported_features: &BTreeSet<String>,
) -> Result<Document, StorageError> {
    if package.manifest().document_kind != DocumentKind::Part {
        return Err(StorageError::WrongDocumentKind);
    }
    package
        .manifest()
        .ensure_compatible(&BTreeSet::from([1]), supported_features)?;
    let document: Document = serde_json::from_slice(
        package
            .payload(ROOT_PAYLOAD)
            .ok_or(StorageError::MissingDocumentPayload)?,
    )?;
    if package.manifest().package_id != document.id.0 {
        return Err(StorageError::PackageIdentityMismatch);
    }
    Ok(document)
}

pub fn canonical_document_bytes(document: &Document) -> Result<Vec<u8>, StorageError> {
    let mut bytes = serde_json::to_vec(document)?;
    bytes.push(b'\n');
    Ok(bytes)
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RecoveryCheckpoint {
    pub semantic_hash: String,
    pub document_bytes: Vec<u8>,
}

impl RecoveryCheckpoint {
    pub fn from_document(document: &Document) -> Result<Self, StorageError> {
        Ok(Self {
            semantic_hash: semantic_hash(document),
            document_bytes: canonical_document_bytes(document)?,
        })
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RecoveryJournalEntry {
    pub base_hash: String,
    pub result_hash: String,
    pub transaction: DocumentTransaction,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecoveryResult {
    pub document: Document,
    pub applied_entries: usize,
    /// A bad tail is reported and left unapplied; the valid prefix remains usable.
    pub isolated_tail: Option<IsolatedTail>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IsolatedTail {
    pub first_rejected_index: usize,
    pub reason: String,
}

/// Restore a verified checkpoint and the longest valid accepted journal prefix.
pub fn recover(
    checkpoint: &RecoveryCheckpoint,
    entries: &[RecoveryJournalEntry],
) -> Result<RecoveryResult, StorageError> {
    let document: Document = serde_json::from_slice(&checkpoint.document_bytes)?;
    if semantic_hash(&document) != checkpoint.semantic_hash {
        return Err(StorageError::CheckpointHashMismatch);
    }
    let mut history = DocumentHistory::new(document);
    let mut applied_entries = 0;
    let mut isolated_tail = None;

    for (index, entry) in entries.iter().enumerate() {
        let mut apply = || -> Result<(), String> {
            if entry.transaction.base_revision != history.accepted().revision {
                return Err("journal base revision does not match accepted revision".into());
            }
            if entry.base_hash != history.accepted_hash() {
                return Err("journal base hash does not match accepted document".into());
            }
            let event = history
                .commit(
                    entry.transaction.id.clone(),
                    entry.transaction.changes.clone(),
                )
                .map_err(|error| error.to_string())?;
            if event.result_revision != entry.transaction.result_revision {
                return Err("journal result revision is not contiguous".into());
            }
            if event.accepted_hash != entry.result_hash {
                return Err("journal result hash does not match replayed document".into());
            }
            Ok(())
        };
        if let Err(reason) = apply() {
            isolated_tail = Some(IsolatedTail {
                first_rejected_index: index,
                reason,
            });
            break;
        }
        applied_entries += 1;
    }

    Ok(RecoveryResult {
        document: history.accepted().clone(),
        applied_entries,
        isolated_tail,
    })
}

#[derive(Debug, Error)]
pub enum StorageError {
    #[error(transparent)]
    Package(#[from] PackageError),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("package does not contain a part document")]
    WrongDocumentKind,
    #[error("package is missing its semantic document payload")]
    MissingDocumentPayload,
    #[error("package identity does not match the contained document")]
    PackageIdentityMismatch,
    #[error("recovery checkpoint hash does not match its document")]
    CheckpointHashMismatch,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crawler_document::{DocumentChange, ParameterId, ParameterValue, TransactionId};

    fn fixture() -> Document {
        serde_json::from_str(include_str!(
            "../../crawler-document/tests/fixtures/parametric-block.json"
        ))
        .unwrap()
    }

    #[test]
    fn semantic_repeat_saves_have_identical_entry_sets() {
        let document = fixture();
        let first = save_part(&document, BTreeSet::new())
            .unwrap()
            .canonical_entries()
            .unwrap();
        let second = save_part(&document, BTreeSet::new())
            .unwrap()
            .canonical_entries()
            .unwrap();
        assert_eq!(first, second);
        assert_eq!(
            load_part(
                &save_part(&document, BTreeSet::new()).unwrap(),
                &BTreeSet::new()
            )
            .unwrap(),
            document
        );
        assert!(
            first
                .keys()
                .all(|path| !path.contains("camera") && !path.contains("cache"))
        );
    }

    #[test]
    fn recovery_replays_the_valid_accepted_transaction_prefix() {
        let initial = fixture();
        let checkpoint = RecoveryCheckpoint::from_document(&initial).unwrap();
        let mut history = DocumentHistory::new(initial);
        let transaction = DocumentTransaction {
            id: TransactionId::from("transaction:recovered-resize"),
            base_revision: 1,
            result_revision: 2,
            changes: vec![DocumentChange::SetParameterValue {
                parameter: ParameterId::from("parameter:height"),
                value: ParameterValue::LengthNanometers(40_000_000),
            }],
        };
        let base_hash = history.accepted_hash();
        let event = history
            .commit(transaction.id.clone(), transaction.changes.clone())
            .unwrap();
        let entry = RecoveryJournalEntry {
            base_hash,
            result_hash: event.accepted_hash.clone(),
            transaction,
        };
        let result = recover(&checkpoint, &[entry]).unwrap();
        assert_eq!(result.applied_entries, 1);
        assert_eq!(semantic_hash(&result.document), event.accepted_hash);
        assert!(result.isolated_tail.is_none());
    }

    #[test]
    fn corrupt_tail_is_isolated_without_discarding_the_checkpoint() {
        let initial = fixture();
        let checkpoint = RecoveryCheckpoint::from_document(&initial).unwrap();
        let bad = RecoveryJournalEntry {
            base_hash: "corrupt".into(),
            result_hash: "corrupt".into(),
            transaction: DocumentTransaction {
                id: TransactionId::from("transaction:corrupt"),
                base_revision: initial.revision,
                result_revision: initial.revision + 1,
                changes: vec![DocumentChange::SetParameterValue {
                    parameter: ParameterId::from("parameter:height"),
                    value: ParameterValue::LengthNanometers(1),
                }],
            },
        };
        let result = recover(&checkpoint, &[bad]).unwrap();
        assert_eq!(result.document, initial);
        assert_eq!(result.applied_entries, 0);
        assert_eq!(result.isolated_tail.unwrap().first_rejected_index, 0);
    }
}
