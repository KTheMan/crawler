import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createInspectorForm,
  createWorkerCommand,
  defaultParameters,
  parseOperationCatalog,
  parseOperationSchema,
  serializeOperationCatalog,
} from "../src/index.ts";

const fixtureUrl = new URL(
  "../../../contracts/operation-schema/extrude.v1.json",
  import.meta.url,
);
const fixture = () => readFile(fixtureUrl, "utf8");
const catalogUrl = new URL(
  "../../../contracts/operation-schema/catalog.v1.json",
  import.meta.url,
);
const catalogFixture = () => readFile(catalogUrl, "utf8");

test("the Extrude fixture generates both inspector fields and worker parameters", async () => {
  const schema = parseOperationSchema(await fixture());
  const form = createInspectorForm(schema, "feature:extrude-1");
  const parameters = defaultParameters(schema);
  const command = createWorkerCommand(schema, {
    operation_id: form.operation_id,
    schema_id: schema.id,
    schema_version: schema.schema_version,
    inputs: {
      profile: [{ kind: "sketch_profile", entity_id: "sketch:rectangle/profile:outer" }],
    },
    parameters,
    preview_generation: 3,
  });

  assert.deepEqual(
    form.parameter_fields.map(({ key }) => key),
    schema.parameters.map(({ key }) => key),
  );
  assert.deepEqual(Object.keys(command.parameters), schema.parameters.map(({ key }) => key));
  assert.equal(form.parameter_fields.find(({ key }) => key === "distance")?.unit, "length");
  assert.equal(form.parameter_fields.find(({ key }) => key === "extent")?.control, "select");
  assert.equal(command.cancellation, "replace_older_preview");
});

test("unknown operation schema versions fail closed with compatibility context", async () => {
  const unsupported = (await fixture()).replace('"schema_version": 1', '"schema_version": 42');
  assert.throws(
    () => parseOperationSchema(unsupported),
    /unsupported crawler operation schema version 42; supported version is 1/,
  );
});

test("worker commands reject missing schema-defined inputs", async () => {
  const schema = parseOperationSchema(await fixture());
  assert.throws(
    () =>
      createWorkerCommand(schema, {
        operation_id: "feature:extrude-1",
        schema_id: schema.id,
        schema_version: 1,
        inputs: {},
        parameters: defaultParameters(schema),
        preview_generation: 0,
      }),
    /missing required operation input profile/,
  );
});

test("the generated alpha catalog mirrors every typed sketch and feature operation", async () => {
  const source = await catalogFixture();
  const catalog = parseOperationCatalog(source);
  assert.deepEqual(
    catalog.operations.map(({ id }) => id),
    [
      "crawler.sketch.line",
      "crawler.sketch.circle",
      "crawler.sketch.arc",
      "crawler.sketch.rectangle",
      "crawler.sketch.trim",
      "crawler.sketch.construction",
      "crawler.part.extrude",
      "crawler.part.revolve",
      "crawler.part.boolean.union",
      "crawler.part.boolean.cut",
      "crawler.part.boolean.intersect",
      "crawler.part.fillet",
      "crawler.part.chamfer",
      "crawler.part.mirror",
      "crawler.part.transform",
      "crawler.part.pattern.linear",
      "crawler.part.pattern.circular",
      "crawler.part.shell",
    ],
  );
  assert.equal(serializeOperationCatalog(catalog), source);

  const rectangle = catalog.operations.find(({ id }) => id === "crawler.sketch.rectangle")!;
  assert.equal(rectangle.parameters.find(({ key }) => key === "width")?.value_kind, "length_nanometers");
  const trim = catalog.operations.find(({ id }) => id === "crawler.sketch.trim")!;
  assert.deepEqual(trim.input_slots[0]?.allowed_kinds, ["sketch_curve"]);
  const circular = catalog.operations.find(({ id }) => id === "crawler.part.pattern.circular")!;
  assert.equal(circular.parameters.find(({ key }) => key === "count")?.value_kind, "count");
  assert.equal(circular.parameters.find(({ key }) => key === "angle")?.value_kind, "angle_microdegrees");
});

test("Shell availability is derived from the qualified prismatic capability", async () => {
  const catalog = parseOperationCatalog(await catalogFixture());
  const capability = catalog.capabilities.find(({ id }) => id === "part.shell")!;
  const shell = catalog.operations.find(({ id }) => id === "crawler.part.shell")!;
  assert.equal(capability.state, "qualified");
  assert.equal(shell.enablement.state, "enabled");
  assert.equal(shell.enablement.capability, "part.shell");
  assert.equal(shell.enablement.reason, null);
  const faces = shell.input_slots.find(({ key }) => key === "remove_faces")!;
  assert.equal(faces.minimum_count, 1);
  assert.equal(faces.maximum_count, 1);
});

test("the TypeScript mirror validates counts, quantity bounds, and unknown fields", async () => {
  const catalog = parseOperationCatalog(await catalogFixture());
  const fillet = catalog.operations.find(({ id }) => id === "crawler.part.fillet")!;
  const parameters = defaultParameters(fillet);
  parameters.radius = { kind: "length_nanometers", value: 0 };
  assert.throws(
    () =>
      createWorkerCommand(fillet, {
        operation_id: "feature:fillet-1",
        schema_id: fillet.id,
        schema_version: 1,
        inputs: {
          body: [
            { kind: "body", entity_id: "body:1" },
            { kind: "body", entity_id: "body:2" },
          ],
          edges: [{ kind: "edge", entity_id: "edge:1" }],
        },
        parameters,
        preview_generation: 0,
      }),
    /too many selections for operation input body/,
  );

  const inconsistent = JSON.parse(await catalogFixture());
  const inconsistentShell = inconsistent.operations.find(({ id }: { id: string }) => id === "crawler.part.shell");
  inconsistentShell.enablement.state = "disabled";
  inconsistentShell.enablement.reason = "forced mismatch";
  const inconsistentCatalog = JSON.stringify(inconsistent);
  assert.throws(
    () => parseOperationCatalog(inconsistentCatalog),
    /enablement is not derived from capability state/,
  );
});

test("the legacy Extrude fixture gains compatible lifecycle defaults", async () => {
  const extrude = parseOperationSchema(await fixture());
  assert.equal(extrude.enablement.state, "enabled");
  assert.equal(extrude.lifecycle.stage, "alpha");
  assert.equal(extrude.id, "crawler.part.extrude");
});
