import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { InMemoryStorageAdapter } from "../src/adapter.mjs";
import {
  canonicalManifestBytes,
  entrySetsEqual,
  loadPartEntrySet,
  savePartEntrySet,
  saveWorkspacePart,
  semanticDocumentHash,
  StorageProtocolError,
} from "../src/package-codec.mjs";
import {
  BrowserPartStorage,
  journalStorageKey,
} from "../src/recovery.mjs";

const fixturePath = fileURLToPath(
  new URL(
    "../../../crates/crawler-document/tests/fixtures/parametric-block.json",
    import.meta.url,
  ),
);

async function fixture() {
  return JSON.parse(await readFile(fixturePath, "utf8"));
}

function parameterTransaction(document, id, parameter, value) {
  return {
    id,
    base_revision: document.revision,
    result_revision: document.revision + 1,
    changes: [
      {
        kind: "set_parameter_value",
        parameter,
        value: { kind: "length_nanometers", value },
      },
    ],
  };
}

class FailingWriteAdapter {
  constructor(delegate, failAtPut) {
    this.delegate = delegate;
    this.failAtPut = failAtPut;
  }

  transaction(stores, mode, callback) {
    return this.delegate.transaction(stores, mode, async (transaction) => {
      let puts = 0;
      return callback({
        get: transaction.get,
        delete: transaction.delete,
        entries: transaction.entries,
        put: async (...args) => {
          puts += 1;
          if (mode === "readwrite" && puts === this.failAtPut) {
            throw new Error(`injected crash at put ${puts}`);
          }
          return transaction.put(...args);
        },
      });
    });
  }
}

test("canonical part entry sets repeat byte-for-byte and load compatibly", async () => {
  const document = await fixture();
  const first = savePartEntrySet(document, ["document.core"]);
  const second = savePartEntrySet(structuredClone(document), ["document.core"]);
  assert.ok(entrySetsEqual(first, second));

  const { document: loaded, manifest } = loadPartEntrySet(
    first,
    new Set(["document.core"]),
  );
  assert.deepEqual(loaded, document);
  assert.equal(manifest.format_version, 1);
  assert.equal(manifest.document_kind, "part");
  assert.equal(manifest.root_payload, "document");
  assert.match(manifest.payloads.document.path, /^payloads\/sha256\/[0-9a-f]{2}\/[0-9a-f]{62}$/);
  assert.deepEqual([...first.keys()], ["manifest.json", manifest.payloads.document.path]);
  const fixtureBytes = new Uint8Array(await readFile(fixturePath));
  const payloadBytes = first.get(manifest.payloads.document.path);
  assert.deepEqual(payloadBytes, fixtureBytes);
  assert.equal(
    manifest.payloads.document.sha256,
    createHash("sha256").update(payloadBytes).digest("hex"),
  );
});

test("camera selection and panel state never affect semantic package bytes", async () => {
  const document = await fixture();
  const first = saveWorkspacePart(
    {
      document,
      transient: {
        camera: { zoom: 1 },
        selection: ["body:block"],
        panel_layout: "wide",
      },
    },
    ["document.core"],
  );
  const second = saveWorkspacePart(
    {
      document,
      transient: {
        camera: { zoom: 42 },
        selection: [],
        panel_layout: "compact",
      },
    },
    ["document.core"],
  );
  assert.ok(entrySetsEqual(first, second));
});

test("periodic checkpoint plus accepted journal recovers the latest prefix", async () => {
  const initial = await fixture();
  const adapter = new InMemoryStorageAdapter();
  const storage = new BrowserPartStorage(adapter, { checkpointEvery: 2 });
  await storage.initializeRecovery(initial);
  await storage.saveExplicitPart(initial, ["document.core"]);

  let accepted = initial;
  let result = await storage.recordAcceptedTransaction(
    initial.id,
    parameterTransaction(
      accepted,
      "transaction:height-40",
      "parameter:height",
      40_000_000,
    ),
  );
  accepted = result.document;
  result = await storage.recordAcceptedTransaction(
    initial.id,
    parameterTransaction(
      accepted,
      "transaction:width-50",
      "parameter:width",
      50_000_000,
    ),
  );
  assert.equal(result.checkpointed, true);
  accepted = result.document;
  result = await storage.recordAcceptedTransaction(
    initial.id,
    parameterTransaction(
      accepted,
      "transaction:height-60",
      "parameter:height",
      60_000_000,
    ),
  );
  assert.equal(result.checkpointed, false);

  const restarted = new BrowserPartStorage(adapter, { checkpointEvery: 2 });
  const recovered = await restarted.recover(initial.id);
  assert.equal(recovered.checkpointSequence, 2);
  assert.equal(recovered.appliedEntries, 1);
  assert.equal(recovered.document.revision, 4);
  assert.equal(
    recovered.document.parameters["parameter:height"].value.value,
    60_000_000,
  );
  assert.equal(recovered.semanticHash, semanticDocumentHash(result.document));

  // Checkpoints and journals cannot overwrite the user's explicit saved file.
  const explicit = await restarted.readExplicitPart(
    initial.id,
    new Set(["document.core"]),
  );
  assert.equal(explicit.document.revision, initial.revision);
  assert.deepEqual(explicit.document, initial);
});

test("corrupt or incompatible journal tail is quarantined after the valid prefix", async () => {
  const initial = await fixture();
  const adapter = new InMemoryStorageAdapter();
  const storage = new BrowserPartStorage(adapter, { checkpointEvery: 100 });
  await storage.initializeRecovery(initial);
  const first = await storage.recordAcceptedTransaction(
    initial.id,
    parameterTransaction(
      initial,
      "transaction:valid",
      "parameter:height",
      40_000_000,
    ),
  );

  await adapter.transaction(["journals"], "readwrite", async (transaction) => {
    await transaction.put("journals", journalStorageKey(initial.id, 2), {
      journal_version: 1,
      sequence: 2,
      base_hash: "0".repeat(64),
      result_hash: "1".repeat(64),
      transaction: parameterTransaction(
        first.document,
        "transaction:corrupt-base",
        "parameter:width",
        50_000_000,
      ),
    });
    await transaction.put("journals", journalStorageKey(initial.id, 3), {
      journal_version: 2,
      sequence: 3,
      base_hash: "2".repeat(64),
      result_hash: "3".repeat(64),
      transaction: parameterTransaction(
        first.document,
        "transaction:incompatible-tail",
        "parameter:width",
        60_000_000,
      ),
    });
  });

  const recovered = await storage.recover(initial.id);
  assert.equal(recovered.appliedEntries, 1);
  assert.equal(recovered.document.revision, 2);
  assert.deepEqual(recovered.isolatedTail, {
    firstRejectedSequence: 2,
    reason: "JOURNAL_BASE_HASH_MISMATCH",
    entryCount: 2,
  });
  const quarantine = await adapter.transaction(
    ["quarantine"],
    "readonly",
    (transaction) => transaction.entries("quarantine", `${initial.id}\u0000`),
  );
  assert.equal(quarantine.length, 2);
});

test("a new worker instance continues from durable accepted state after crash", async () => {
  const initial = await fixture();
  const adapter = new InMemoryStorageAdapter();
  const workerOne = new BrowserPartStorage(adapter, { checkpointEvery: 10 });
  await workerOne.initializeRecovery(initial);
  const first = await workerOne.recordAcceptedTransaction(
    initial.id,
    parameterTransaction(
      initial,
      "transaction:before-worker-crash",
      "parameter:height",
      45_000_000,
    ),
  );

  // workerOne is abandoned without an orderly shutdown.
  const workerTwo = new BrowserPartStorage(adapter, { checkpointEvery: 10 });
  const resumed = await workerTwo.recover(initial.id);
  assert.equal(resumed.semanticHash, first.resultHash);
  const second = await workerTwo.recordAcceptedTransaction(
    initial.id,
    parameterTransaction(
      resumed.document,
      "transaction:after-worker-crash",
      "parameter:width",
      55_000_000,
    ),
  );
  const finalWorker = new BrowserPartStorage(adapter, { checkpointEvery: 10 });
  const final = await finalWorker.recover(initial.id);
  assert.equal(final.semanticHash, second.resultHash);
  assert.equal(final.document.revision, 3);
  assert.equal(
    final.document.parameters["parameter:width"].value.value,
    55_000_000,
  );
});

test("exact accepted-state records make undo and redo durable without a forward transaction", async () => {
  const initial = await fixture();
  const adapter = new InMemoryStorageAdapter();
  const storage = new BrowserPartStorage(adapter, { checkpointEvery: 10 });
  await storage.initializeRecovery(initial);
  const changed = (await storage.recordAcceptedTransaction(
    initial.id,
    parameterTransaction(
      initial,
      "transaction:before-undo",
      "parameter:height",
      45_000_000,
    ),
  )).document;

  await storage.recordAcceptedState(initial.id, initial, {
    semanticHash: semanticDocumentHash(initial),
    action: "undo",
  });
  let recovered = await storage.recover(initial.id);
  assert.deepEqual(recovered.document, initial);
  assert.equal(recovered.acceptedSequence, 2);
  assert.equal(recovered.source, "snapshot");
  assert.equal(recovered.provenance.action, "undo");
  assert.deepEqual(recovered.choices[0], {
    kind: "restore_accepted",
    source: "snapshot",
    sequence: 2,
    revision: initial.revision,
    semanticHash: semanticDocumentHash(initial),
  });

  await storage.recordAcceptedState(initial.id, changed, {
    semanticHash: semanticDocumentHash(changed),
    action: "redo",
  });
  recovered = await storage.recover(initial.id);
  assert.deepEqual(recovered.document, changed);
  assert.equal(recovered.provenance.action, "redo");
  assert.equal(recovered.acceptedSequence, 3);
});

test("exact accepted state remains authoritative when derived output is not encoded in the transaction", async () => {
  const initial = await fixture();
  const adapter = new InMemoryStorageAdapter();
  const storage = new BrowserPartStorage(adapter, { checkpointEvery: 10 });
  await storage.initializeRecovery(initial);
  const transaction = parameterTransaction(
    initial,
    "transaction:worker-derived-output",
    "parameter:height",
    47_000_000,
  );
  const accepted = structuredClone(initial);
  accepted.parameters["parameter:height"].value.value = 47_000_000;
  accepted.revision = transaction.result_revision;
  accepted.recompute.accepted_revision = transaction.result_revision;
  accepted.recompute.features["feature:extrude-block"] = {
    status: "clean",
    revision: transaction.result_revision,
    kernel_evidence: "exact-worker-output",
  };
  accepted.transactions.push(transaction);

  await storage.recordAcceptedState(initial.id, accepted, {
    semanticHash: semanticDocumentHash(accepted),
    action: "forward_transaction",
    transaction,
  });
  const recovered = await storage.recover(initial.id);
  assert.deepEqual(recovered.document, accepted);
  assert.equal(
    recovered.document.recompute.features["feature:extrude-block"].kernel_evidence,
    "exact-worker-output",
  );
});

test("a crash between any accepted-state store write commits none of them", async () => {
  for (const failAtPut of [1, 2, 3]) {
    const initial = await fixture();
    const durableAdapter = new InMemoryStorageAdapter();
    const initialized = new BrowserPartStorage(durableAdapter, {
      checkpointEvery: 100,
    });
    await initialized.initializeRecovery(initial);
    const candidate = structuredClone(initial);
    candidate.display_name = `candidate-${failAtPut}`;

    const crashing = new BrowserPartStorage(
      new FailingWriteAdapter(durableAdapter, failAtPut),
      { checkpointEvery: 100 },
    );
    await assert.rejects(
      crashing.recordAcceptedState(initial.id, candidate, {
        semanticHash: semanticDocumentHash(candidate),
        action: "accepted_state",
      }),
      /injected crash/,
    );

    const recovered = await initialized.recover(initial.id);
    assert.deepEqual(recovered.document, initial, `put ${failAtPut} rolled back`);
    assert.equal(recovered.acceptedSequence, 0);
    assert.equal(recovered.provenance.snapshotStatus, "validated");
    const journals = await durableAdapter.transaction(
      ["journals"],
      "readonly",
      (transaction) => transaction.entries("journals", `${initial.id}\u0000`),
    );
    assert.equal(journals.length, 0);
  }
});

test("checkpoint-boundary write failure rolls back checkpoint, journal, snapshot, and metadata", async () => {
  const initial = await fixture();
  for (const failAtPut of [2, 3, 4]) {
    const durableAdapter = new InMemoryStorageAdapter();
    const initialized = new BrowserPartStorage(durableAdapter, {
      checkpointEvery: 1,
    });
    await initialized.initializeRecovery(initial);
    const candidate = structuredClone(initial);
    candidate.display_name = `checkpoint-candidate-${failAtPut}`;
    const crashing = new BrowserPartStorage(
      new FailingWriteAdapter(durableAdapter, failAtPut),
      { checkpointEvery: 1 },
    );
    await assert.rejects(
      crashing.recordAcceptedState(initial.id, candidate, {
        semanticHash: semanticDocumentHash(candidate),
        action: "accepted_state",
      }),
      /injected crash/,
    );
    const recovered = await initialized.recover(initial.id);
    assert.deepEqual(recovered.document, initial);
    assert.equal(recovered.checkpointSequence, 0);
    assert.equal(recovered.acceptedSequence, 0);
  }
});

test("an inconsistent exact snapshot is quarantined before journal recovery is chosen", async () => {
  const initial = await fixture();
  const adapter = new InMemoryStorageAdapter();
  const storage = new BrowserPartStorage(adapter, { checkpointEvery: 100 });
  await storage.initializeRecovery(initial);
  const accepted = await storage.recordAcceptedTransaction(
    initial.id,
    parameterTransaction(
      initial,
      "transaction:valid-exact-state",
      "parameter:height",
      48_000_000,
    ),
  );
  const snapshotKey = `${initial.id}\u0000runtime-snapshot`;
  await adapter.transaction(["metadata"], "readwrite", async (transaction) => {
    const snapshot = await transaction.get("metadata", snapshotKey);
    snapshot.sequence = 99;
    await transaction.put("metadata", snapshotKey, snapshot);
  });

  const recovered = await storage.recover(initial.id);
  assert.deepEqual(recovered.document, accepted.document);
  assert.equal(recovered.source, "journal");
  assert.equal(recovered.provenance.snapshotStatus, "quarantined");
  const quarantined = await adapter.transaction(
    ["quarantine"],
    "readonly",
    (transaction) => transaction.get("quarantine", snapshotKey),
  );
  assert.equal(quarantined.reason, "RUNTIME_SNAPSHOT_MISMATCH");
});

test("a consistent pre-versioned exact snapshot is migrated as validated recovery state", async () => {
  const initial = await fixture();
  const adapter = new InMemoryStorageAdapter();
  const storage = new BrowserPartStorage(adapter, { checkpointEvery: 100 });
  await storage.initializeRecovery(initial);
  const accepted = await storage.recordAcceptedTransaction(
    initial.id,
    parameterTransaction(
      initial,
      "transaction:legacy-snapshot",
      "parameter:height",
      49_000_000,
    ),
  );
  const snapshotKey = `${initial.id}\u0000runtime-snapshot`;
  await adapter.transaction(["metadata"], "readwrite", (transaction) =>
    transaction.put("metadata", snapshotKey, {
      document: accepted.document,
      semanticHash: accepted.resultHash,
    }),
  );

  const recovered = await storage.recover(initial.id);
  assert.deepEqual(recovered.document, accepted.document);
  assert.equal(recovered.source, "snapshot");
  assert.equal(recovered.provenance.action, "legacy_snapshot");
  assert.equal(recovered.provenance.snapshotStatus, "validated");
});

test("unknown required features fail before payload interpretation", async () => {
  const document = await fixture();
  const entries = savePartEntrySet(document, [
    "document.core",
    "future.boolean.history-v2",
  ]);
  const payloadPath = [...entries.keys()].find((path) => path !== "manifest.json");
  entries.set(payloadPath, new TextEncoder().encode("corrupt payload"));
  assert.throws(
    () => loadPartEntrySet(entries, new Set(["document.core"])),
    (error) =>
      error instanceof StorageProtocolError &&
      error.code === "UNSUPPORTED_REQUIRED_FEATURE" &&
      error.details.feature === "future.boolean.history-v2",
  );

  const executable = savePartEntrySet(document, ["document.core"]);
  const manifest = JSON.parse(new TextDecoder().decode(executable.get("manifest.json")));
  manifest.payloads.document.media_type = "application/javascript";
  executable.set("manifest.json", canonicalManifestBytes(manifest));
  assert.throws(
    () => loadPartEntrySet(executable, new Set(["document.core"])),
    (error) =>
      error instanceof StorageProtocolError &&
      error.code === "EXECUTABLE_OR_UNKNOWN_PAYLOAD",
  );
});
