import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseDocument, serializeDocument } from "../src/index.ts";
import type { FeatureId } from "../src/index.ts";

const fixtureUrl = (name: string) =>
  new URL(`../../../crates/crawler-document/tests/fixtures/${name}`, import.meta.url);

const readFixture = (name: string) => readFile(fixtureUrl(name), "utf8");

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
