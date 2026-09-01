import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseDocument, serializeDocument } from "../src/index.ts";
import type { FeatureId } from "../src/index.ts";

const fixtureUrl = (name: string) =>
  new URL(`../../../crates/crawler-document/tests/fixtures/${name}`, import.meta.url);

const readFixture = (name: string) => readFile(fixtureUrl(name), "utf8");

const boundedExtrudeDefinition = (mode: "new_body" | "cut") => ({
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
  result: mode === "cut" ? { mode: "cut" } : { mode: "new_body", body: "body:block" },
  ...(mode === "cut"
    ? { participant_bodies: [{ role: "target", body: "body:block" }] }
    : {}),
  required_capabilities: [
    mode === "cut" ? "exact_blind_cut_extrude" : "exact_blind_new_body_extrude",
  ],
});

test("both Rust fixtures deserialize and reserialize canonically", async () => {
  for (const name of ["minimal-document.json", "parametric-block.json"]) {
    const fixture = await readFixture(name);
    assert.equal(serializeDocument(parseDocument(fixture)), fixture, name);
  }
});

test("unknown document schema versions fail closed", async () => {
  const fixture = await readFixture("minimal-document.json");
  const unsupported = fixture.replace('"schema_version":1', '"schema_version":2');
  assert.throws(
    () => parseDocument(unsupported),
    /unsupported crawler document schema version 2/,
  );
});

test("topology reference versions and required ownership fail closed", async () => {
  const fixture = JSON.parse(await readFixture("parametric-block.json"));
  const reference = fixture.topology_references["topology:top-face"];

  delete reference.schema_version;
  assert.throws(
    () => parseDocument(JSON.stringify(fixture)),
    /topology reference topology:top-face schema_version is required/,
  );

  reference.schema_version = 2;
  assert.throws(
    () => parseDocument(JSON.stringify(fixture)),
    /unsupported topology reference schema version 2/,
  );

  reference.schema_version = 1;
  delete reference.component;
  assert.throws(
    () => parseDocument(JSON.stringify(fixture)),
    /topology reference topology:top-face component is required/,
  );
});

test("unknown and mismatched topology reference identities fail closed", async () => {
  const fixture = JSON.parse(await readFixture("parametric-block.json"));
  const reference = fixture.topology_references["topology:top-face"];

  reference.id = "topology:not-the-map-key";
  assert.throws(
    () => parseDocument(JSON.stringify(fixture)),
    /map key topology:top-face does not match embedded id topology:not-the-map-key/,
  );

  reference.id = "topology:top-face";
  reference.body = "body:missing";
  assert.throws(
    () => parseDocument(JSON.stringify(fixture)),
    /uses unknown body body:missing/,
  );

  reference.body = "body:block";
  reference.component = "component:other";
  fixture.components["component:other"] = {
    ...fixture.components["component:root"],
    id: "component:other",
  };
  assert.throws(
    () => parseDocument(JSON.stringify(fixture)),
    /component component:other does not match its body and producer/,
  );
});

test("unknown topology reference fields and invalid kernel ids fail closed", async () => {
  const fixture = JSON.parse(await readFixture("parametric-block.json"));
  const reference = fixture.topology_references["topology:top-face"];

  reference.future_field = true;
  assert.throws(
    () => parseDocument(JSON.stringify(fixture)),
    /contains unknown field future_field/,
  );

  delete reference.future_field;
  reference.stable_kernel_id = "06";
  assert.throws(
    () => parseDocument(JSON.stringify(fixture)),
    /stable_kernel_id must be a canonical u64 decimal string/,
  );

  reference.stable_kernel_id = "18446744073709551616";
  assert.throws(
    () => parseDocument(JSON.stringify(fixture)),
    /stable_kernel_id must be a canonical u64 decimal string/,
  );

  reference.stable_kernel_id = "18446744073709551615";
  assert.doesNotThrow(() => parseDocument(JSON.stringify(fixture)));
});

test("fallback topology signatures require exact Rust-compatible shapes", async () => {
  const fixture = JSON.parse(await readFixture("parametric-block.json"));
  const reference = fixture.topology_references["topology:top-face"];

  reference.fallback_signature = {};
  assert.throws(
    () => parseDocument(JSON.stringify(fixture)),
    /fallback_signature kind is invalid/,
  );

  reference.fallback_signature = {
    kind: "face",
    centroid_nanometers: [0, 0],
    normal_millionths: [0, 0, 1],
    area_square_nanometers: 1,
  };
  assert.throws(
    () => parseDocument(JSON.stringify(fixture)),
    /centroid_nanometers must contain exactly three safe integers/,
  );

  reference.fallback_signature.centroid_nanometers = [0, 0, 0];
  reference.fallback_signature.area_square_nanometers = -1;
  assert.throws(
    () => parseDocument(JSON.stringify(fixture)),
    /area_square_nanometers must be a non-negative safe integer/,
  );

  reference.fallback_signature.area_square_nanometers = 1;
  reference.fallback_signature.future_field = true;
  assert.throws(
    () => parseDocument(JSON.stringify(fixture)),
    /fallback_signature contains unknown field future_field/,
  );

  delete reference.fallback_signature.future_field;
  assert.doesNotThrow(() => serializeDocument(fixture));
});

test("stable feature identity is independent of display name and order", async () => {
  const document = parseDocument(await readFixture("parametric-block.json"));
  const id = "feature:extrude" as FeatureId;
  document.features[id]!.display_name = "Renamed extrusion";
  document.components[document.root_component]!.feature_order.reverse();

  assert.equal(document.features[id]!.id, id);
  assert.equal(document.features[id]!.display_name, "Renamed extrusion");
});

test("canonical serialization sorts map keys instead of preserving input order", async () => {
  const document = parseDocument(await readFixture("parametric-block.json"));
  document.features = Object.fromEntries(Object.entries(document.features).reverse());
  document.parameters = Object.fromEntries(Object.entries(document.parameters).reverse());

  assert.equal(serializeDocument(document), await readFixture("parametric-block.json"));
});

test("bounded Cut Extrude persists one explicit target and retained producer lineage", async () => {
  const fixture = JSON.parse(await readFixture("parametric-block.json"));
  fixture.features["feature:cut"] = {
    ...fixture.features["feature:extrude"],
    id: "feature:cut",
    display_name: "Cut",
  };
  fixture.components["component:root"].feature_order.push("feature:cut");
  fixture.bodies["body:block"].generated_by = "feature:cut";
  fixture.bodies["body:block"].producer_lineage = ["feature:extrude"];
  fixture.feature_definitions_v2 = {
    "feature:cut": boundedExtrudeDefinition("cut"),
  };

  const serialized = serializeDocument(parseDocument(JSON.stringify(fixture)));
  const persisted = JSON.parse(serialized);
  assert.deepEqual(persisted.bodies["body:block"].producer_lineage, ["feature:extrude"]);
  assert.deepEqual(persisted.feature_definitions_v2["feature:cut"], {
    schema_version: 2,
    operation: boundedExtrudeDefinition("cut").operation,
    result: { mode: "cut" },
    participant_bodies: [{ role: "target", body: "body:block" }],
    required_capabilities: ["exact_blind_cut_extrude"],
  });
  assert.equal(serializeDocument(parseDocument(serialized)), serialized);
});

test("result-mode target contracts fail closed in the document protocol", async () => {
  const base = JSON.parse(await readFixture("parametric-block.json"));
  base.features["feature:cut"] = {
    ...base.features["feature:extrude"],
    id: "feature:cut",
    display_name: "Cut",
  };

  const rejects = (definition: Record<string, unknown>, message: RegExp) => {
    const document = structuredClone(base);
    document.feature_definitions_v2 = { "feature:cut": definition };
    assert.throws(() => parseDocument(JSON.stringify(document)), message);
  };

  const missingTarget = boundedExtrudeDefinition("cut");
  delete (missingTarget as { participant_bodies?: unknown }).participant_bodies;
  rejects(missingTarget, /Cut requires exactly one target body/);

  const extraTarget = boundedExtrudeDefinition("cut");
  extraTarget.participant_bodies.push({ role: "target", body: "body:block" });
  rejects(extraTarget, /Cut requires exactly one target body/);

  const newBodyWithTarget = boundedExtrudeDefinition("new_body") as Record<string, unknown>;
  newBodyWithTarget.participant_bodies = [{ role: "target", body: "body:block" }];
  rejects(newBodyWithTarget, /New Body cannot contain participant bodies/);

  const missingBody = boundedExtrudeDefinition("cut");
  missingBody.participant_bodies[0].body = "body:missing";
  rejects(missingBody, /target body body:missing does not exist/);

  const unsupported = boundedExtrudeDefinition("cut") as Record<string, unknown>;
  unsupported.result = { mode: "join" };
  rejects(unsupported, /result mode is invalid/);
});

test("face-supported Cut requires topology owned by the sole target", async () => {
  const base = JSON.parse(await readFixture("parametric-block.json"));
  base.features["feature:cut"] = {
    ...base.features["feature:extrude"],
    id: "feature:cut",
    display_name: "Cut",
  };
  base.feature_definitions_v2 = { "feature:cut": boundedExtrudeDefinition("cut") };
  assert.doesNotThrow(() => parseDocument(JSON.stringify(base)));
  assert.doesNotThrow(() => parseDocument(serializeDocument(parseDocument(JSON.stringify(base)))));

  const wrongOwner = structuredClone(base);
  wrongOwner.bodies["body:other"] = {
    ...wrongOwner.bodies["body:block"],
    id: "body:other",
  };
  wrongOwner.topology_references["topology:top-face"].body = "body:other";
  assert.throws(
    () => parseDocument(JSON.stringify(wrongOwner)),
    /topology-face support is not owned by its Cut target/,
  );

  const wrongProducer = structuredClone(base);
  wrongProducer.topology_references["topology:top-face"].producer = "feature:sketch";
  assert.throws(
    () => parseDocument(JSON.stringify(wrongProducer)),
    /does not match its body and producer/,
  );
});

test("producer lineage validates without any topology references", async () => {
  const base = JSON.parse(await readFixture("parametric-block.json"));
  base.topology_references = {};
  base.features["feature:cut"] = {
    ...base.features["feature:extrude"],
    id: "feature:cut",
    display_name: "Cut",
  };
  base.bodies["body:block"].generated_by = "feature:cut";
  base.bodies["body:block"].producer_lineage = ["feature:extrude"];
  const reopened = parseDocument(serializeDocument(parseDocument(JSON.stringify(base))));
  assert.deepEqual(reopened.bodies["body:block"].producer_lineage, ["feature:extrude"]);

  const rejects = (lineage: unknown, message: RegExp, mutate?: (document: any) => void) => {
    const document = structuredClone(base);
    document.bodies["body:block"].producer_lineage = lineage;
    mutate?.(document);
    assert.throws(() => parseDocument(JSON.stringify(document)), message);
  };

  rejects(["feature:missing"], /uses unknown feature feature:missing/);
  rejects(["feature:extrude", "feature:extrude"], /producer_lineage is invalid/);
  rejects(["feature:cut"], /producer_lineage is invalid/);
  rejects("feature:extrude", /producer_lineage must be an array/);
  rejects(["feature:extrude"], /feature feature:extrude is cross-component/, (document) => {
    document.features["feature:extrude"].component = "component:other";
  });
});

test("external lines preserve canonical u64 boundary identities", async () => {
  for (const stableKernelId of ["0", "18446744073709551615"]) {
    const fixture = JSON.parse(await readFixture("parametric-block.json"));
    fixture.sketches["sketch:base"].elements.push({
      kind: "external_line",
      id: "external:edge",
      start_nanometers: [-1, 2],
      end_nanometers: [3, -4],
      body: "body:block",
      stable_kernel_id: stableKernelId,
    });

    const serialized = serializeDocument(parseDocument(JSON.stringify(fixture)));
    const external = JSON.parse(serialized).sketches["sketch:base"].elements.at(-1);
    assert.deepEqual(external, {
      kind: "external_line",
      id: "external:edge",
      start_nanometers: [-1, 2],
      end_nanometers: [3, -4],
      body: "body:block",
      stable_kernel_id: stableKernelId,
    });
  }
});

test("external line kernel identities reject noncanonical u64 encodings", async () => {
  const fixture = JSON.parse(await readFixture("parametric-block.json"));
  const external: Record<string, unknown> = {
    kind: "external_line",
    id: "external:edge",
    start_nanometers: [0, 0],
    end_nanometers: [1, 1],
    body: "body:block",
    stable_kernel_id: "1",
  };
  fixture.sketches["sketch:base"].elements.push(external);

  for (const invalid of [
    1,
    "+1",
    "01",
    "-1",
    " 1",
    "1 ",
    "18446744073709551616",
  ]) {
    external.stable_kernel_id = invalid;
    assert.throws(
      () => parseDocument(JSON.stringify(fixture)),
      /external_line element 1 stable_kernel_id must be a canonical u64 decimal string/,
      String(invalid),
    );
  }
});

test("external lines require exact Rust-compatible shapes and safe coordinate pairs", async () => {
  const fixture = JSON.parse(await readFixture("parametric-block.json"));
  const external: Record<string, unknown> = {
    kind: "external_line",
    id: "external:edge",
    start_nanometers: [0, 0],
    end_nanometers: [1, 1],
    body: "body:block",
    stable_kernel_id: "1",
  };
  fixture.sketches["sketch:base"].elements.push(external);

  external.future_field = true;
  assert.throws(
    () => parseDocument(JSON.stringify(fixture)),
    /external_line element 1 contains unknown field future_field/,
  );

  delete external.future_field;
  delete external.stable_kernel_id;
  assert.throws(
    () => parseDocument(JSON.stringify(fixture)),
    /external_line element 1 stable_kernel_id is required/,
  );

  external.stable_kernel_id = "1";
  delete external.body;
  assert.throws(
    () => parseDocument(JSON.stringify(fixture)),
    /external_line element 1 body is required/,
  );

  external.body = "body:block";
  external.start_nanometers = [0];
  assert.throws(
    () => parseDocument(JSON.stringify(fixture)),
    /start_nanometers must contain exactly two safe integers/,
  );

  external.start_nanometers = [0, Number.MAX_SAFE_INTEGER + 1];
  assert.throws(
    () => serializeDocument(fixture),
    /start_nanometers must contain exactly two safe integers/,
  );

  external.start_nanometers = [0, 0];
  delete external.kind;
  assert.throws(
    () => parseDocument(JSON.stringify(fixture)),
    /sketch sketch:base element 1 kind is required/,
  );
});
