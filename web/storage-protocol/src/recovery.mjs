import {
  canonicalDocumentBytes,
  decodeCanonicalDocumentBytes,
  loadPartEntrySet,
  savePartEntrySet,
  semanticDocumentHash,
  StorageProtocolError,
} from "./package-codec.mjs";

const ALL_RECOVERY_STORES = [
  "checkpoints",
  "explicit-files",
  "journals",
  "metadata",
  "quarantine",
];

export class BrowserPartStorage {
  constructor(adapter, { checkpointEvery = 20 } = {}) {
    if (!adapter || typeof adapter.transaction !== "function") {
      throw new TypeError("storage adapter must implement transaction()");
    }
    if (!Number.isSafeInteger(checkpointEvery) || checkpointEvery < 1) {
      throw new TypeError("checkpointEvery must be a positive integer");
    }
    this.adapter = adapter;
    this.checkpointEvery = checkpointEvery;
  }

  async initializeRecovery(document, { semanticHash = semanticDocumentHash(document) } = {}) {
    validateAcceptedDocument(document, document.id, semanticHash);
    const checkpoint = checkpointFromDocument(document, 0);
    const metadata = {
      metadata_version: 1,
      document_id: document.id,
      checkpoint_sequence: 0,
      next_sequence: 1,
      accepted_since_checkpoint: 0,
      last_accepted_hash: checkpoint.semantic_hash,
      last_revision: document.revision,
    };
    await this.adapter.transaction(
      ["checkpoints", "journals", "metadata", "quarantine"],
      "readwrite",
      async (transaction) => {
        if (await transaction.get("metadata", document.id)) {
          throw new StorageProtocolError(
            "RECOVERY_ALREADY_INITIALIZED",
            `recovery already exists for ${document.id}`,
          );
        }
        await transaction.put("checkpoints", document.id, checkpoint);
        await transaction.put(
          "metadata",
          runtimeSnapshotKey(document.id),
          snapshotFromDocument(document, 0, "initialize"),
        );
        await transaction.put("metadata", document.id, metadata);
      },
    );
    return structuredClone(metadata);
  }

  /**
   * Atomically replaces the recovery lineage with an accepted portable document.
   * Explicit user saves live in a different store and are deliberately untouched.
   */
  async adoptRecovery(document, { semanticHash = semanticDocumentHash(document), reason = "adopt" } = {}) {
    validateAcceptedDocument(document, document.id, semanticHash);
    const documentId = document.id;
    const checkpoint = checkpointFromDocument(document, 0);
    const metadata = {
      metadata_version: 1,
      document_id: documentId,
      checkpoint_sequence: 0,
      next_sequence: 1,
      accepted_since_checkpoint: 0,
      last_accepted_hash: semanticHash,
      last_revision: document.revision,
    };
    await this.adapter.transaction(
      ["checkpoints", "journals", "metadata", "quarantine"],
      "readwrite",
      async (transaction) => {
        for (const [key] of await transaction.entries("journals", journalPrefix(documentId))) {
          await transaction.delete("journals", key);
        }
        await transaction.put("checkpoints", documentId, checkpoint);
        await transaction.put(
          "metadata",
          runtimeSnapshotKey(documentId),
          snapshotFromDocument(document, 0, reason),
        );
        await transaction.put("metadata", documentId, metadata);
      },
    );
    return structuredClone(metadata);
  }

  async recordAcceptedTransaction(documentId, transactionRecord) {
    const recovered = await this.recover(documentId);
    const resultDocument = applyAcceptedTransaction(
      recovered.document,
      transactionRecord,
    );
    return this.recordAcceptedState(documentId, resultDocument, {
      semanticHash: semanticDocumentHash(resultDocument),
      action: "forward_transaction",
      transaction: transactionRecord,
    });
  }

  /**
   * Commits the exact accepted document and its journal/checkpoint bookkeeping in
   * one IndexedDB transaction. The transaction is optional so undo, redo, import,
   * and other accepted state transitions cannot fall outside durable history.
   */
  async recordAcceptedState(
    documentId,
    acceptedDocument,
    {
      semanticHash = semanticDocumentHash(acceptedDocument),
      action = "accepted_state",
      transaction: transactionRecord = null,
    } = {},
  ) {
    validateAcceptedDocument(acceptedDocument, documentId, semanticHash);
    const recovered = await this.recover(documentId);
    const baseHash = recovered.semanticHash;
    const resultHash = semanticHash;
    const normalizedTransaction = transactionRecord
      ? normalizeTransaction(transactionRecord)
      : null;
    if (normalizedTransaction) {
      if (
        normalizedTransaction.base_revision !== recovered.document.revision ||
        normalizedTransaction.result_revision !== acceptedDocument.revision
      ) {
        throw new StorageProtocolError(
          "NONCONTIGUOUS_TRANSACTION",
          "accepted state transaction revisions do not match its exact documents",
        );
      }
    }

    return this.adapter.transaction(
      ["checkpoints", "journals", "metadata"],
      "readwrite",
      async (transaction) => {
        const metadata = await transaction.get("metadata", documentId);
        requireMetadata(metadata, documentId);
        if (
          metadata.last_accepted_hash !== baseHash ||
          metadata.last_revision !== recovered.document.revision
        ) {
          throw new StorageProtocolError(
            "CONCURRENT_ACCEPTED_STATE",
            "durable accepted state changed before journal append",
          );
        }
        const sequence = metadata.next_sequence;
        const entry = {
          journal_version: 2,
          record_kind: "accepted_state",
          sequence,
          base_hash: baseHash,
          result_hash: resultHash,
          result_revision: acceptedDocument.revision,
          action: normalizeAction(action),
          transaction: normalizedTransaction,
          document_bytes: canonicalDocumentBytes(acceptedDocument),
        };
        await transaction.put(
          "journals",
          journalStorageKey(documentId, sequence),
          entry,
        );
        metadata.next_sequence += 1;
        metadata.accepted_since_checkpoint += 1;
        metadata.last_accepted_hash = resultHash;
        metadata.last_revision = acceptedDocument.revision;

        let checkpointed = false;
        if (metadata.accepted_since_checkpoint >= this.checkpointEvery) {
          await transaction.put(
            "checkpoints",
            documentId,
            checkpointFromDocument(acceptedDocument, sequence),
          );
          const prefix = journalPrefix(documentId);
          for (const [key, journal] of await transaction.entries("journals", prefix)) {
            if (journal.sequence <= sequence) {
              await transaction.delete("journals", key);
            }
          }
          metadata.checkpoint_sequence = sequence;
          metadata.accepted_since_checkpoint = 0;
          checkpointed = true;
        }
        await transaction.put(
          "metadata",
          runtimeSnapshotKey(documentId),
          snapshotFromDocument(acceptedDocument, sequence, entry.action),
        );
        await transaction.put("metadata", documentId, metadata);
        return {
          document: structuredClone(acceptedDocument),
          sequence,
          baseHash,
          resultHash,
          checkpointed,
        };
      },
    );
  }

  async recover(documentId) {
    return this.adapter.transaction(
      ALL_RECOVERY_STORES,
      "readwrite",
      async (transaction) => {
        const checkpoint = await transaction.get("checkpoints", documentId);
        const metadata = await transaction.get("metadata", documentId);
        const snapshot = await transaction.get(
          "metadata",
          runtimeSnapshotKey(documentId),
        );
        const explicitSaveAvailable =
          (await transaction.get("explicit-files", documentId)) !== undefined;
        requireMetadata(metadata, documentId);
        if (!checkpoint || checkpoint.checkpoint_version !== 1) {
          throw new StorageProtocolError(
            "INCOMPATIBLE_CHECKPOINT",
            "recovery checkpoint is missing or has an unsupported version",
          );
        }
        let document;
        try {
          document = decodeCanonicalDocumentBytes(checkpoint.document_bytes);
        } catch (error) {
          throw new StorageProtocolError(
            "CORRUPT_CHECKPOINT",
            `checkpoint document cannot be decoded: ${error.message}`,
          );
        }
        if (
          checkpoint.document_id !== documentId ||
          checkpoint.sequence !== metadata.checkpoint_sequence ||
          semanticDocumentHash(document) !== checkpoint.semantic_hash
        ) {
          throw new StorageProtocolError(
            "CORRUPT_CHECKPOINT",
            "checkpoint identity, sequence, or semantic hash differs",
          );
        }

        const journals = await transaction.entries("journals", journalPrefix(documentId));
        let appliedEntries = 0;
        let expectedSequence = checkpoint.sequence + 1;
        let isolatedTail = null;
        let lastAction = checkpoint.sequence === 0 ? "initialize" : "checkpoint";

        for (let index = 0; index < journals.length; index += 1) {
          const [, entry] = journals[index];
          try {
            validateJournalEntry(entry, expectedSequence, document);
            const candidate = journalResultDocument(document, entry);
            if (semanticDocumentHash(candidate) !== entry.result_hash) {
              throw new StorageProtocolError(
                "JOURNAL_RESULT_HASH_MISMATCH",
                "journal result hash differs from replay",
              );
            }
            document = candidate;
            lastAction = entry.action ?? "forward_transaction";
            appliedEntries += 1;
            expectedSequence += 1;
          } catch (error) {
            const rejected = journals.slice(index);
            isolatedTail = {
              firstRejectedSequence: entry?.sequence ?? expectedSequence,
              reason: error.code ?? "INVALID_JOURNAL_ENTRY",
              entryCount: rejected.length,
            };
            for (const [key, value] of rejected) {
              await transaction.put("quarantine", key, {
                isolated_version: 1,
                reason: isolatedTail.reason,
                entry: value,
              });
              await transaction.delete("journals", key);
            }
            metadata.next_sequence = expectedSequence;
            metadata.accepted_since_checkpoint = appliedEntries;
            metadata.last_accepted_hash = semanticDocumentHash(document);
            metadata.last_revision = document.revision;
            await transaction.put("metadata", documentId, metadata);
            break;
          }
        }

        const acceptedSequence = expectedSequence - 1;
        const actualHash = semanticDocumentHash(document);
        let source = appliedEntries > 0 ? "journal" : "checkpoint";
        let snapshotStatus = "missing";
        if (snapshot !== undefined) {
          try {
            const exactSnapshot = validateSnapshot(
              snapshot,
              documentId,
              acceptedSequence,
              actualHash,
              document.revision,
            );
            document = exactSnapshot.document;
            source = "snapshot";
            snapshotStatus = "validated";
            lastAction = exactSnapshot.action;
          } catch (error) {
            snapshotStatus = "quarantined";
            await transaction.put("quarantine", runtimeSnapshotKey(documentId), {
              isolated_version: 1,
              reason: error.code ?? "INVALID_RUNTIME_SNAPSHOT",
              entry: snapshot,
            });
            await transaction.delete("metadata", runtimeSnapshotKey(documentId));
          }
        }

        if (
          metadata.last_accepted_hash !== actualHash ||
          metadata.last_revision !== document.revision ||
          metadata.next_sequence !== acceptedSequence + 1
        ) {
          if (!isolatedTail) {
            throw new StorageProtocolError(
              "RECOVERY_METADATA_MISMATCH",
              "metadata differs from checkpoint plus accepted journal",
            );
          }
        }
        return {
          document,
          semanticHash: semanticDocumentHash(document),
          checkpointSequence: checkpoint.sequence,
          acceptedSequence,
          appliedEntries,
          isolatedTail,
          source,
          provenance: {
            source,
            action: lastAction,
            snapshotStatus,
            checkpointSequence: checkpoint.sequence,
            acceptedSequence,
            appliedEntries,
          },
          choices: [
            {
              kind: "restore_accepted",
              source,
              sequence: acceptedSequence,
              revision: document.revision,
              semanticHash: semanticDocumentHash(document),
            },
            {
              kind: "open_explicit_save",
              available: explicitSaveAvailable,
            },
          ],
        };
      },
    );
  }

  /** Only this explicit action writes the explicit-files store. */
  async saveExplicitPart(document, requiredFeatures = []) {
    const entries = savePartEntrySet(document, requiredFeatures);
    const stored = [...entries].map(([path, bytes]) => [path, new Uint8Array(bytes)]);
    await this.adapter.transaction(
      ["explicit-files"],
      "readwrite",
      (transaction) => transaction.put("explicit-files", document.id, stored),
    );
    return entries;
  }

  async readExplicitPart(documentId, supportedFeatures = new Set()) {
    const stored = await this.adapter.transaction(
      ["explicit-files"],
      "readonly",
      (transaction) => transaction.get("explicit-files", documentId),
    );
    if (!stored) {
      return null;
    }
    return loadPartEntrySet(new Map(stored), supportedFeatures);
  }
}

export function applyAcceptedTransaction(baseDocument, transaction) {
  const normalized = normalizeTransaction(transaction);
  if (normalized.changes.length === 0) {
    throw new StorageProtocolError("EMPTY_TRANSACTION", "journal transaction is empty");
  }
  if (
    normalized.base_revision !== baseDocument.revision ||
    normalized.result_revision !== baseDocument.revision + 1
  ) {
    throw new StorageProtocolError(
      "NONCONTIGUOUS_TRANSACTION",
      "transaction revisions are not contiguous",
    );
  }
  const document = structuredClone(baseDocument);
  const dirty = new Set();
  for (const change of normalized.changes) {
    applyChange(document, change, dirty);
  }
  document.revision = normalized.result_revision;
  document.recompute.accepted_revision = document.revision;
  for (const feature of [...dirty].sort()) {
    document.recompute.features[feature] = {
      status: "dirty",
      since_revision: document.revision,
    };
  }
  document.transactions.push(normalized);
  return document;
}

export function journalStorageKey(documentId, sequence) {
  return `${journalPrefix(documentId)}${String(sequence).padStart(16, "0")}`;
}

function journalPrefix(documentId) {
  return `${documentId}\u0000`;
}

function checkpointFromDocument(document, sequence) {
  return {
    checkpoint_version: 1,
    document_id: document.id,
    sequence,
    semantic_hash: semanticDocumentHash(document),
    document_bytes: canonicalDocumentBytes(document),
  };
}

function snapshotFromDocument(document, sequence, action) {
  return {
    snapshot_version: 1,
    document_id: document.id,
    sequence,
    semantic_hash: semanticDocumentHash(document),
    revision: document.revision,
    action: normalizeAction(action),
    document_bytes: canonicalDocumentBytes(document),
  };
}

function runtimeSnapshotKey(documentId) {
  return `${documentId}\u0000runtime-snapshot`;
}

function validateAcceptedDocument(document, documentId, expectedHash) {
  if (!document || typeof document !== "object" || document.id !== documentId) {
    throw new StorageProtocolError(
      "ACCEPTED_DOCUMENT_IDENTITY_MISMATCH",
      "accepted document identity differs from recovery identity",
    );
  }
  const actualHash = semanticDocumentHash(document);
  if (actualHash !== expectedHash) {
    throw new StorageProtocolError(
      "ACCEPTED_DOCUMENT_HASH_MISMATCH",
      "accepted document semantic hash differs from the supplied hash",
      { expectedHash, actualHash },
    );
  }
  if (!Number.isSafeInteger(document.revision) || document.revision < 0) {
    throw new StorageProtocolError(
      "INVALID_ACCEPTED_REVISION",
      "accepted document revision must be a non-negative integer",
    );
  }
}

function normalizeAction(action) {
  if (typeof action !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(action)) {
    throw new StorageProtocolError(
      "INVALID_ACCEPTED_ACTION",
      "accepted state action must be a portable lowercase token",
    );
  }
  return action;
}

function validateSnapshot(
  snapshot,
  documentId,
  sequence,
  semanticHash,
  revision,
) {
  // Version 0 stored a structured-cloned document before journal append. It is
  // safe to migrate only when its exact semantics agree with the replayed chain.
  if (
    snapshot &&
    snapshot.snapshot_version === undefined &&
    snapshot.document &&
    typeof snapshot.semanticHash === "string"
  ) {
    const actualHash = semanticDocumentHash(snapshot.document);
    if (
      snapshot.document.id === documentId &&
      snapshot.document.revision === revision &&
      snapshot.semanticHash === semanticHash &&
      actualHash === semanticHash
    ) {
      return {
        document: structuredClone(snapshot.document),
        action: "legacy_snapshot",
      };
    }
    throw new StorageProtocolError(
      "RUNTIME_SNAPSHOT_MISMATCH",
      "legacy runtime snapshot differs from checkpoint plus accepted journal",
    );
  }
  if (!snapshot || snapshot.snapshot_version !== 1) {
    throw new StorageProtocolError(
      "INCOMPATIBLE_RUNTIME_SNAPSHOT",
      "runtime snapshot version is unsupported",
    );
  }
  const document = decodeCanonicalDocumentBytes(snapshot.document_bytes);
  const actualHash = semanticDocumentHash(document);
  if (
    snapshot.document_id !== documentId ||
    document.id !== documentId ||
    snapshot.sequence !== sequence ||
    snapshot.semantic_hash !== semanticHash ||
    actualHash !== semanticHash ||
    snapshot.revision !== revision ||
    document.revision !== revision
  ) {
    throw new StorageProtocolError(
      "RUNTIME_SNAPSHOT_MISMATCH",
      "runtime snapshot differs from checkpoint plus accepted journal",
    );
  }
  normalizeAction(snapshot.action);
  return { document, action: snapshot.action };
}

function journalResultDocument(baseDocument, entry) {
  if (entry.journal_version === 1) {
    return applyAcceptedTransaction(baseDocument, entry.transaction);
  }
  const candidate = decodeCanonicalDocumentBytes(entry.document_bytes);
  if (
    candidate.id !== baseDocument.id ||
    candidate.revision !== entry.result_revision
  ) {
    throw new StorageProtocolError(
      "JOURNAL_ACCEPTED_STATE_MISMATCH",
      "accepted-state journal identity or revision differs",
    );
  }
  if (entry.transaction !== null) {
    const provenance = normalizeTransaction(entry.transaction);
    if (
      provenance.base_revision !== baseDocument.revision ||
      provenance.result_revision !== candidate.revision
    ) {
      throw new StorageProtocolError(
        "JOURNAL_TRANSACTION_PROVENANCE_MISMATCH",
        "accepted-state transaction revisions differ from the exact state",
      );
    }
  }
  return candidate;
}

function validateJournalEntry(entry, expectedSequence, document) {
  if (!entry || (entry.journal_version !== 1 && entry.journal_version !== 2)) {
    throw new StorageProtocolError(
      "INCOMPATIBLE_JOURNAL_VERSION",
      "journal version is unsupported",
    );
  }
  if (entry.sequence !== expectedSequence) {
    throw new StorageProtocolError(
      "NONCONTIGUOUS_JOURNAL_SEQUENCE",
      "journal sequence is not contiguous",
    );
  }
  if (entry.base_hash !== semanticDocumentHash(document)) {
    throw new StorageProtocolError(
      "JOURNAL_BASE_HASH_MISMATCH",
      "journal base hash differs from accepted document",
    );
  }
  if (entry.journal_version === 2) {
    if (
      entry.record_kind !== "accepted_state" ||
      !Number.isSafeInteger(entry.result_revision) ||
      !(entry.document_bytes instanceof Uint8Array)
    ) {
      throw new StorageProtocolError(
        "INVALID_ACCEPTED_STATE_JOURNAL",
        "accepted-state journal fields are invalid",
      );
    }
    normalizeAction(entry.action);
    if (entry.transaction !== null) {
      normalizeTransaction(entry.transaction);
    }
  }
}

function normalizeTransaction(transaction) {
  if (!transaction || typeof transaction !== "object") {
    throw new StorageProtocolError("INVALID_TRANSACTION", "transaction must be an object");
  }
  if (
    typeof transaction.id !== "string" ||
    !Number.isSafeInteger(transaction.base_revision) ||
    !Number.isSafeInteger(transaction.result_revision) ||
    !Array.isArray(transaction.changes)
  ) {
    throw new StorageProtocolError("INVALID_TRANSACTION", "transaction fields are invalid");
  }
  return {
    id: transaction.id,
    base_revision: transaction.base_revision,
    result_revision: transaction.result_revision,
    changes: structuredClone(transaction.changes),
  };
}

function applyChange(document, change, dirty) {
  switch (change?.kind) {
    case "set_parameter_value": {
      const parameter = document.parameters[change.parameter];
      if (!parameter) {
        throw new StorageProtocolError("MISSING_ENTITY", `missing ${change.parameter}`);
      }
      if (parameter.value.kind !== change.value?.kind) {
        throw new StorageProtocolError(
          "INCOMPATIBLE_PARAMETER_TYPE",
          `parameter type differs for ${change.parameter}`,
        );
      }
      parameter.value = structuredClone(change.value);
      for (const [featureId, feature] of Object.entries(document.features)) {
        if (Object.values(feature.parameters).includes(change.parameter)) {
          dirty.add(featureId);
        }
      }
      return;
    }
    case "set_feature_suppressed": {
      const feature = document.features[change.feature];
      if (!feature) {
        throw new StorageProtocolError("MISSING_ENTITY", `missing ${change.feature}`);
      }
      feature.suppressed = Boolean(change.suppressed);
      dirty.add(change.feature);
      return;
    }
    case "rename_entity":
      renameEntity(document, change.entity, change.display_name);
      return;
    case "reorder_feature": {
      const component = document.components[change.component];
      if (!component || !document.features[change.feature]) {
        throw new StorageProtocolError("MISSING_ENTITY", "reorder entity is missing");
      }
      const order = component.feature_order.filter((id) => id !== change.feature);
      const index =
        change.before === null ? order.length : order.indexOf(change.before);
      if (index < 0) {
        throw new StorageProtocolError("MISSING_ENTITY", `missing ${change.before}`);
      }
      order.splice(index, 0, change.feature);
      component.feature_order = order;
      dirty.add(change.feature);
      return;
    }
    default:
      throw new StorageProtocolError(
        "INCOMPATIBLE_JOURNAL_CHANGE",
        `unsupported declarative change ${change?.kind}`,
      );
  }
}

function renameEntity(document, entity, displayName) {
  if (!displayName?.trim() || !entity?.kind || !entity.id) {
    throw new StorageProtocolError("INVALID_RENAME", "rename fields are invalid");
  }
  if (entity.kind === "document" && entity.id === document.id) {
    document.display_name = displayName;
    return;
  }
  const collections = {
    component: "components",
    body: "bodies",
    sketch: "sketches",
    feature: "features",
    parameter: "parameters",
  };
  const collection = document[collections[entity.kind]];
  if (!collection?.[entity.id]) {
    throw new StorageProtocolError("MISSING_ENTITY", `missing ${entity.id}`);
  }
  collection[entity.id].display_name = displayName;
}

function requireMetadata(metadata, documentId) {
  if (
    !metadata ||
    metadata.metadata_version !== 1 ||
    metadata.document_id !== documentId
  ) {
    throw new StorageProtocolError(
      "RECOVERY_NOT_INITIALIZED",
      `recovery metadata is missing for ${documentId}`,
    );
  }
}
