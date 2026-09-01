import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { InMemoryStorageAdapter } from "../src/adapter.mjs";
import {
  canonicalDocumentBytes,
  canonicalManifestBytes,
  decodeCanonicalDocumentBytes,
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

function boundedExtrudeDefinition(mode, body = "body:block") {
  return {
    schema_version: 2,
    operation: {
      kind: "extrude",
      profile: { kind: "sketch_region", sketch: "sketch:base", region: "region:base" },
      support:
        mode === "cut"
          ? { kind: "topology_face", reference: "topology:top-face" }
          : { kind: "origin_plane", plane: "origin-plane:xy" },
      extent: { kind: "blind", distance: "parameter:height", direction: "positive" },
      modifiers: "none",
    },
    result: mode === "cut" ? { mode: "cut" } : { mode: "new_body", body },
    ...(mode === "cut" ? { participant_bodies: [{ role: "target", body }] } : {}),
    required_capabilities: [
      mode === "cut" ? "exact_blind_cut_extrude" : "exact_blind_new_body_extrude",
    ],
  };
}

function appendExternalLine(document, overrides = {}) {
  const externalLine = {
    stable_kernel_id: "1",
    body: "body:block",
    end_nanometers: [3, -4],
    start_nanometers: [-1, 2],
    id: "external:edge",
    kind: "external_line",
    ...overrides,
  };
  document.sketches["sketch:base"].elements.push(externalLine);
  return externalLine;
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
  // Git may materialize the single-line JSON fixture with CRLF on Windows;
  // canonical package bytes are deliberately platform-independent LF.
  const fixtureBytes = new TextEncoder().encode(
    (await readFile(fixturePath, "utf8")).replace(/\r\n/g, "\n"),
  );
  const payloadBytes = first.get(manifest.payloads.document.path);
  assert.deepEqual(payloadBytes, fixtureBytes);
  assert.equal(
    manifest.payloads.document.sha256,
    createHash("sha256").update(payloadBytes).digest("hex"),
  );
});

test("invalid topology references cannot enter canonical or persisted package bytes", async () => {
  const overflow = await fixture();
  overflow.topology_references["topology:top-face"].stable_kernel_id =
    "18446744073709551616";
  assert.throws(
    () => canonicalDocumentBytes(overflow),
    (error) =>
      error instanceof StorageProtocolError &&
      error.code === "INVALID_DOCUMENT" &&
      /canonical u64 decimal string/.test(error.message),
  );
  assert.throws(() => savePartEntrySet(overflow), /canonical u64 decimal string/);

  const malformed = await fixture();
  malformed.topology_references["topology:top-face"].fallback_signature = {};
  assert.throws(() => canonicalDocumentBytes(malformed), /fallback_signature kind is invalid/);
  const malformedBytes = new TextEncoder().encode(`${JSON.stringify(malformed)}\n`);
  assert.throws(
    () => decodeCanonicalDocumentBytes(malformedBytes),
    /fallback_signature kind is invalid/,
  );

  const negativeArea = await fixture();
  negativeArea.topology_references[
    "topology:top-face"
  ].fallback_signature.area_square_nanometers = -1;
  assert.throws(
    () => savePartEntrySet(negativeArea),
    /area_square_nanometers must be a non-negative safe integer/,
  );
});

test("external lines preserve canonical u64 boundaries through package roundtrip", async () => {
  for (const stableKernelId of ["0", "18446744073709551615"]) {
    const document = await fixture();
    appendExternalLine(document, { stable_kernel_id: stableKernelId });

    const bytes = canonicalDocumentBytes(document);
    const canonical = new TextDecoder().decode(bytes);
    assert.match(
      canonical,
      new RegExp(
        `\\{"kind":"external_line","id":"external:edge","start_nanometers":\\[-1,2\\],"end_nanometers":\\[3,-4\\],"body":"body:block","stable_kernel_id":"${stableKernelId}"\\}`,
      ),
    );
    assert.deepEqual(decodeCanonicalDocumentBytes(bytes), document);

    const entries = savePartEntrySet(document);
    const loaded = loadPartEntrySet(entries);
    assert.deepEqual(loaded.document, document);
    assert.deepEqual(canonicalDocumentBytes(loaded.document), bytes);
  }
});

test("external line kernel identities fail closed on every noncanonical u64 encoding", async () => {
  for (const invalid of [
    1,
    "+1",
    "01",
    "-1",
    " 1",
    "1 ",
    "18446744073709551616",
    "",
    null,
  ]) {
    const document = await fixture();
    appendExternalLine(document, { stable_kernel_id: invalid });
    assert.throws(
      () => canonicalDocumentBytes(document),
      /external_line element 1 stable_kernel_id must be a canonical u64 decimal string/,
      String(invalid),
    );
    assert.throws(
      () => decodeCanonicalDocumentBytes(
        new TextEncoder().encode(`${JSON.stringify(document)}\n`),
      ),
      /external_line element 1 stable_kernel_id must be a canonical u64 decimal string/,
      String(invalid),
    );
  }
});

test("external lines require their exact Rust shape and valid coordinate/body values", async () => {
  const fields = [
    "kind",
    "id",
    "start_nanometers",
    "end_nanometers",
    "body",
    "stable_kernel_id",
  ];
  for (const missing of fields) {
    const document = await fixture();
    const externalLine = appendExternalLine(document);
    delete externalLine[missing];
    assert.throws(
      () => savePartEntrySet(document),
      missing === "kind"
        ? /element 1 kind is required/
        : new RegExp(`external_line element 1 ${missing} is required`),
      `missing ${missing}`,
    );
  }

  const unknownDocument = await fixture();
  appendExternalLine(unknownDocument, { future_field: true });
  assert.throws(
    () => canonicalDocumentBytes(unknownDocument),
    /external_line element 1 contains unknown field future_field/,
  );

  for (const [field, invalid] of [
    ["start_nanometers", [0]],
    ["start_nanometers", [0, 1, 2]],
    ["start_nanometers", [0, "1"]],
    ["start_nanometers", [0, Number.MAX_SAFE_INTEGER + 1]],
    ["end_nanometers", null],
    ["end_nanometers", [0, 1.5]],
  ]) {
    const document = await fixture();
    appendExternalLine(document, { [field]: invalid });
    assert.throws(
      () => savePartEntrySet(document),
      new RegExp(`${field} must contain exactly two safe integers`),
      `${field}: ${JSON.stringify(invalid)}`,
    );
  }

  for (const body of ["", 1, null, {}, []]) {
    const document = await fixture();
    appendExternalLine(document, { body });
    assert.throws(
      () => savePartEntrySet(document),
      /external_line element 1 body is required/,
      `body: ${JSON.stringify(body)}`,
    );
  }
});

test("topology references canonicalize Rust field order and accept u64 max", async () => {
  const document = await fixture();
  const reference = document.topology_references["topology:top-face"];
  reference.stable_kernel_id = "18446744073709551615";
  document.topology_references["topology:top-face"] = {
    fallback_signature: {
      area_square_nanometers: 1,
      normal_millionths: [0, 0, 1],
      centroid_nanometers: [0, 0, 0],
      kind: "face",
    },
    stable_token: reference.stable_token,
    stable_kernel_id: reference.stable_kernel_id,
    kind: reference.kind,
    producer: reference.producer,
    body: reference.body,
    component: reference.component,
    id: reference.id,
    schema_version: reference.schema_version,
  };

  const canonical = new TextDecoder().decode(canonicalDocumentBytes(document));
  assert.match(
    canonical,
    /"topology:top-face":\{"schema_version":1,"id":"topology:top-face","component":"component:root","body":"body:block","producer":"feature:extrude","kind":"face","stable_kernel_id":"18446744073709551615","stable_token":"extrude:end-positive","fallback_signature":\{"kind":"face","centroid_nanometers":\[0,0,0\],"normal_millionths":\[0,0,1\],"area_square_nanometers":1\}\}/,
  );
});

test("V2 region and feature-definition maps retain Rust document order and lexical keys", async () => {
  const document = await fixture();
  document.region_definitions_v2 = {
    "region:z": { id: "region:z", sketch: "sketch:1", outer_geometry_ids: ["line:z"], hole_geometry_ids: [] },
    "region:a": { id: "region:a", sketch: "sketch:1", outer_geometry_ids: ["line:a"], hole_geometry_ids: [] },
  };
  document.features["feature:z"] = { ...document.features["feature:extrude"], id: "feature:z" };
  document.features["feature:a"] = { ...document.features["feature:extrude"], id: "feature:a" };
  document.feature_definitions_v2 = {
    "feature:z": boundedExtrudeDefinition("new_body", "body:z"),
    "feature:a": boundedExtrudeDefinition("new_body", "body:a"),
  };
  const canonical = new TextDecoder().decode(canonicalDocumentBytes(document));
  const topLevelKeys = Object.keys(JSON.parse(canonical));
  const orderedFields = [
    "sketches",
    "region_definitions_v2",
    "features",
    "feature_definitions_v2",
    "parameters",
  ];
  assert.deepEqual(
    topLevelKeys.filter((field) => orderedFields.includes(field)),
    orderedFields,
  );
  assert.ok(canonical.indexOf('"region:a"') < canonical.indexOf('"region:z"'));
  assert.ok(canonical.indexOf('"feature:a"') < canonical.indexOf('"feature:z"'));
  assert.equal(semanticDocumentHash(document), createHash("sha256").update(canonicalDocumentBytes(document)).digest("hex"));
});

test("Cut result mode and exact target survive canonical package save/load", async () => {
  const document = await fixture();
  document.features["feature:cut"] = {
    ...document.features["feature:extrude"],
    id: "feature:cut",
    display_name: "Cut",
  };
  document.components["component:root"].feature_order.push("feature:cut");
  document.bodies["body:block"].generated_by = "feature:cut";
  document.bodies["body:block"].producer_lineage = ["feature:extrude"];
  document.feature_definitions_v2 = {
    "feature:cut": boundedExtrudeDefinition("cut"),
  };

  const loaded = loadPartEntrySet(savePartEntrySet(document)).document;
  assert.deepEqual(loaded.bodies["body:block"].producer_lineage, ["feature:extrude"]);
  assert.deepEqual(
    loaded.feature_definitions_v2["feature:cut"].participant_bodies,
    [{ role: "target", body: "body:block" }],
  );
  assert.deepEqual(loaded.feature_definitions_v2["feature:cut"].result, { mode: "cut" });
});

test("storage rejects missing, extra, inferred, and unsupported result targets", async () => {
  const base = await fixture();
  base.features["feature:cut"] = {
    ...base.features["feature:extrude"],
    id: "feature:cut",
    display_name: "Cut",
  };

  const rejects = (definition, message) => {
    const document = structuredClone(base);
    document.feature_definitions_v2 = { "feature:cut": definition };
    assert.throws(() => savePartEntrySet(document), message);
  };

  const missing = boundedExtrudeDefinition("cut");
  delete missing.participant_bodies;
  rejects(missing, /Cut requires exactly one target body/);

  const extra = boundedExtrudeDefinition("cut");
  extra.participant_bodies.push({ role: "target", body: "body:block" });
  rejects(extra, /Cut requires exactly one target body/);

  const inferred = boundedExtrudeDefinition("new_body");
  inferred.participant_bodies = [{ role: "target", body: "body:block" }];
  rejects(inferred, /New Body cannot contain participant bodies/);

  const absent = boundedExtrudeDefinition("cut", "body:missing");
  rejects(absent, /target body body:missing does not exist/);

  const unsupported = boundedExtrudeDefinition("cut");
  unsupported.result = { mode: "intersect" };
  rejects(unsupported, /result mode is invalid/);
});

test("storage rejects face-supported Cut topology owned by another body or producer", async () => {
  const base = await fixture();
  base.features["feature:cut"] = {
    ...base.features["feature:extrude"],
    id: "feature:cut",
    display_name: "Cut",
  };
  base.feature_definitions_v2 = { "feature:cut": boundedExtrudeDefinition("cut") };
  assert.doesNotThrow(() => loadPartEntrySet(savePartEntrySet(base)));

  const wrongOwner = structuredClone(base);
  wrongOwner.bodies["body:other"] = {
    ...wrongOwner.bodies["body:block"],
    id: "body:other",
  };
  wrongOwner.topology_references["topology:top-face"].body = "body:other";
  assert.throws(
    () => savePartEntrySet(wrongOwner),
    /topology-face support is not owned by its Cut target/,
  );

  const wrongProducer = structuredClone(base);
  wrongProducer.topology_references["topology:top-face"].producer = "feature:sketch";
  assert.throws(
    () => savePartEntrySet(wrongProducer),
    /does not match its body and producer/,
  );
});

test("storage validates retained producer lineage with no topology references", async () => {
  const base = await fixture();
  base.topology_references = {};
  base.features["feature:cut"] = {
    ...base.features["feature:extrude"],
    id: "feature:cut",
    display_name: "Cut",
  };
  base.bodies["body:block"].generated_by = "feature:cut";
  base.bodies["body:block"].producer_lineage = ["feature:extrude"];
  assert.deepEqual(
    loadPartEntrySet(savePartEntrySet(base)).document.bodies["body:block"].producer_lineage,
    ["feature:extrude"],
  );

  const rejects = (lineage, message, mutate) => {
    const document = structuredClone(base);
    document.bodies["body:block"].producer_lineage = lineage;
    mutate?.(document);
    assert.throws(() => savePartEntrySet(document), message);
  };
  rejects(["feature:missing"], /uses unknown feature feature:missing/);
  rejects(["feature:extrude", "feature:extrude"], /producer_lineage is invalid/);
  rejects(["feature:cut"], /producer_lineage is invalid/);
  rejects("feature:extrude", /producer_lineage must be an array/);
  rejects(["feature:extrude"], /feature feature:extrude is cross-component/, (document) => {
    document.features["feature:extrude"].component = "component:other";
  });
});

test("construction planes match Rust field order, lexical map order, and explicit component order", async () => {
  const first = await fixture();
  first.construction_planes = {
    "construction-plane:z": {
      suppressed: false,
      definition: { offset: "parameter:height", base_plane: "origin-plane:xy", kind: "offset" },
      component: "component:root",
      id: "construction-plane:z",
      schema_version: 1,
    },
    "construction-plane:a": {
      id: "construction-plane:a",
      schema_version: 1,
      component: "component:root",
      suppressed: false,
      definition: { kind: "offset", offset: "parameter:width", base_plane: "origin-plane:xy" },
    },
  };
  first.components["component:root"].construction_plane_order = ["construction-plane:z", "construction-plane:a"];
  const second = structuredClone(first);
  second.construction_planes = {
    "construction-plane:a": {
      definition: { base_plane: "origin-plane:xy", kind: "offset", offset: "parameter:width" },
      suppressed: false,
      schema_version: 1,
      component: "component:root",
      id: "construction-plane:a",
    },
    "construction-plane:z": {
      schema_version: 1,
      id: "construction-plane:z",
      component: "component:root",
      definition: { kind: "offset", base_plane: "origin-plane:xy", offset: "parameter:height" },
      suppressed: false,
    },
  };

  const firstBytes = canonicalDocumentBytes(first);
  const secondBytes = canonicalDocumentBytes(second);
  assert.deepEqual(firstBytes, secondBytes);
  assert.equal(semanticDocumentHash(first), semanticDocumentHash(second));
  const canonical = new TextDecoder().decode(firstBytes);
  assert.ok(canonical.indexOf('"origin_planes"') < canonical.indexOf('"construction_planes"'));
  assert.ok(canonical.indexOf('"construction_planes"') < canonical.indexOf('"components"'));
  assert.ok(canonical.indexOf('"construction-plane:a"') < canonical.indexOf('"construction-plane:z"'));
  assert.match(canonical, /"construction-plane:a":\{"schema_version":1,"id":"construction-plane:a","component":"component:root","definition":\{"kind":"offset","base_plane":"origin-plane:xy","offset":"parameter:width"\},"suppressed":false\}/);
  assert.deepEqual(JSON.parse(canonical).components["component:root"].construction_plane_order, ["construction-plane:z", "construction-plane:a"]);
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
