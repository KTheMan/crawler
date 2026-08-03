// The storage protocol is a shared browser module with executable contract tests.
// @ts-ignore JavaScript module declarations are owned by web/storage-protocol.
import { IndexedDbStorageAdapter } from "../../storage-protocol/src/adapter.mjs";
// @ts-ignore JavaScript module declarations are owned by web/storage-protocol.
import { OpfsStorageAdapter } from "../../storage-protocol/src/opfs-adapter.mjs";
// @ts-ignore JavaScript module declarations are owned by web/storage-protocol.
import { BrowserPartStorage } from "../../storage-protocol/src/recovery.mjs";

import type { AcceptedTransaction } from "./protocol";

export type AcceptedStateAction =
  | "forward_transaction"
  | "undo"
  | "redo"
  | "open"
  | "new_document"
  | "accepted_state";

export interface RecoveryProvenance {
  source: "snapshot" | "journal" | "checkpoint";
  action: string;
  snapshotStatus: "validated" | "missing" | "quarantined";
  checkpointSequence: number;
  acceptedSequence: number;
  appliedEntries: number;
}

export interface RecoveryChoice {
  kind: "restore_accepted" | "open_explicit_save";
  source?: "snapshot" | "journal" | "checkpoint";
  sequence?: number;
  revision?: number;
  semanticHash?: string;
  available?: boolean;
}

type StorageTransactionAdapter = {
  transaction(
    stores: string[],
    mode: "readonly" | "readwrite",
    callback: (transaction: {
      get(store: string, key: string): Promise<unknown>;
      put(store: string, key: string, value: unknown): Promise<void>;
      delete(store: string, key: string): Promise<void>;
      entries(store: string, prefix?: string): Promise<[string, unknown][]>;
    }) => Promise<unknown>,
  ): Promise<unknown>;
};

const STORAGE_NAME = "crawler-part-design-alpha";
const STORAGE_VERSION = 1;
const RECOVERY_STORES = ["checkpoints", "explicit-files", "journals", "metadata", "quarantine"];

export interface PreferredStorageResult {
  adapter: StorageTransactionAdapter;
  backend: "opfs" | "indexeddb";
  migratedFromIndexedDb: boolean;
}

/** Prefer OPFS, migrating an existing IndexedDB lineage once, and fail safely
 * back to IndexedDB when OPFS is unavailable or cannot be opened. */
export async function openPreferredStorageAdapter(options: {
  openOpfs?: () => Promise<StorageTransactionAdapter>;
  openIndexedDb?: () => Promise<StorageTransactionAdapter>;
} = {}): Promise<PreferredStorageResult> {
  const openIndexedDb = options.openIndexedDb ?? (() => IndexedDbStorageAdapter.open(STORAGE_NAME, STORAGE_VERSION));
  const openOpfs = options.openOpfs ?? (() => OpfsStorageAdapter.open(STORAGE_NAME, STORAGE_VERSION));
  let opfs: StorageTransactionAdapter;
  try {
    opfs = await openOpfs();
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "OPFS_CORRUPT_SNAPSHOT" || code === "OPFS_INCOMPATIBLE_SNAPSHOT") throw error;
    return { adapter: await openIndexedDb(), backend: "indexeddb", migratedFromIndexedDb: false };
  }

  if (!(await adapterIsEmpty(opfs))) {
    return { adapter: opfs, backend: "opfs", migratedFromIndexedDb: false };
  }

  // Existing alpha installations used IndexedDB. Copy its complete recovery
  // lineage into the single atomic OPFS snapshot before OPFS becomes primary.
  let indexedDb: StorageTransactionAdapter;
  let snapshot: [string, [string, unknown][]][];
  try {
    indexedDb = await openIndexedDb();
    snapshot = await readAdapterSnapshot(indexedDb);
  } catch {
    // A new installation can use OPFS even when IndexedDB is unavailable.
    return { adapter: opfs, backend: "opfs", migratedFromIndexedDb: false };
  }
  if (snapshot.some(([, entries]) => entries.length > 0)) {
    try {
      const migrated = await opfs.transaction(RECOVERY_STORES, "readwrite", async (transaction) => {
        // Recheck while holding the OPFS transaction lock: another tab may have
        // initialized the preferred backend after the earlier empty probe.
        for (const store of RECOVERY_STORES) {
          if ((await transaction.entries(store)).length > 0) return false;
        }
        for (const [store, entries] of snapshot) {
          for (const [key, value] of entries) await transaction.put(store, key, value);
        }
        return true;
      });
      return { adapter: opfs, backend: "opfs", migratedFromIndexedDb: migrated === true };
    } catch {
      // A failed migration must continue using the intact legacy lineage. Never
      // select an empty or partially written preferred backend.
      return { adapter: indexedDb, backend: "indexeddb", migratedFromIndexedDb: false };
    }
  }
  return { adapter: opfs, backend: "opfs", migratedFromIndexedDb: false };
}

async function adapterIsEmpty(adapter: StorageTransactionAdapter): Promise<boolean> {
  const snapshot = await readAdapterSnapshot(adapter);
  return snapshot.every(([, entries]) => entries.length === 0);
}

async function readAdapterSnapshot(adapter: StorageTransactionAdapter): Promise<[string, [string, unknown][]][]> {
  return adapter.transaction(RECOVERY_STORES, "readonly", async (transaction) => {
    const snapshot: [string, [string, unknown][]][] = [];
    for (const store of RECOVERY_STORES) snapshot.push([store, await transaction.entries(store)]);
    return snapshot;
  }) as Promise<[string, [string, unknown][]][]>;
}

export class AppStorage {
  private readonly storage: InstanceType<typeof BrowserPartStorage>;
  private readonly adapter: StorageTransactionAdapter;

  private constructor(storage: InstanceType<typeof BrowserPartStorage>, adapter: StorageTransactionAdapter) {
    this.storage = storage;
    this.adapter = adapter;
  }

  static async open(): Promise<AppStorage> {
    const { adapter } = await openPreferredStorageAdapter();
    return new AppStorage(new BrowserPartStorage(adapter, { checkpointEvery: 20 }), adapter);
  }

  async initializeOrRecover(document: unknown, semanticHash: string): Promise<
    | { status: "initialized" }
    | {
        status: "recovered";
        document: unknown;
        semanticHash: string;
        provenance: RecoveryProvenance;
        choices: RecoveryChoice[];
      }
  > {
    const candidate = document as { id: string };
    try {
      const recovered = await this.storage.recover(candidate.id);
      return {
        status: "recovered",
        document: recovered.document,
        semanticHash: recovered.semanticHash,
        provenance: recovered.provenance,
        choices: recovered.choices,
      };
    } catch (error) {
      if ((error as { code?: string }).code !== "RECOVERY_NOT_INITIALIZED") throw error;
      await this.storage.initializeRecovery(document, { semanticHash });
      return { status: "initialized" };
    }
  }

  async recordAccepted(documentId: string, transaction: AcceptedTransaction, acceptedDocument: unknown, semanticHash: string): Promise<void> {
    await this.storage.recordAcceptedState(documentId, acceptedDocument, {
      semanticHash,
      action: "forward_transaction",
      transaction,
    });
  }

  async recordAcceptedState(
    documentId: string,
    acceptedDocument: unknown,
    semanticHash: string,
    action: AcceptedStateAction,
  ): Promise<void> {
    await this.storage.recordAcceptedState(documentId, acceptedDocument, {
      semanticHash,
      action,
    });
  }

  async explicitSave(document: unknown): Promise<void> {
    await this.storage.saveExplicitPart(document);
  }

  async hasExplicitSave(documentId: string): Promise<boolean> {
    return (await this.storage.readExplicitPart(documentId)) !== null;
  }

  async retainImportedStepSource(sourceSha256: string, source: Uint8Array): Promise<void> {
    if (!/^[0-9a-f]{64}$/.test(sourceSha256)) throw new TypeError("STEP source digest must be lowercase SHA-256");
    await this.adapter.transaction(["explicit-files"], "readwrite", (transaction) =>
      transaction.put("explicit-files", `payload:imported-step:${sourceSha256}`, new Uint8Array(source)),
    );
  }

  async importedStepSource(sourceSha256: string): Promise<Uint8Array | undefined> {
    const stored = await this.adapter.transaction(["explicit-files"], "readonly", (transaction) =>
      transaction.get("explicit-files", `payload:imported-step:${sourceSha256}`),
    );
    if (stored === undefined) return undefined;
    if (!(stored instanceof Uint8Array)) throw new TypeError(`stored STEP source ${sourceSha256} is not binary data`);
    return new Uint8Array(stored);
  }

  async adoptPortableDocument(
    document: unknown,
    semanticHash: string,
    action: "open" | "new_document" = "open",
  ): Promise<void> {
    const candidate = document as { id: string };
    await this.storage.adoptRecovery(document, {
      semanticHash,
      reason: action,
    });
  }
}
