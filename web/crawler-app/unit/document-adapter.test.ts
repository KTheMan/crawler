import assert from "node:assert/strict";
import test from "node:test";

import { adapterFromWorkerSnapshot } from "../src/document-adapter.ts";

test("legacy feature outputs collapse to terminal logical bodies in the browser snapshot", () => {
  const document = {
    schema_version: 1,
    id: "document:legacy-body-chain",
    display_name: "Legacy body chain",
    root_component: "component:root",
    components: {
      "component:root": {
        id: "component:root",
        display_name: "Part",
        child_components: [],
        body_order: ["body:part", "body:fillet", "body:chamfer", "body:independent"],
        sketch_order: [],
        feature_order: ["feature:extrude", "feature:fillet", "feature:chamfer", "feature:import"],
      },
    },
    bodies: {
      "body:part": { id: "body:part", display_name: "Part Body", component: "component:root", generated_by: "feature:extrude", visibility: "visible" },
      "body:fillet": { id: "body:fillet", display_name: "body:fillet", component: "component:root", generated_by: "feature:fillet", visibility: "visible" },
      "body:chamfer": { id: "body:chamfer", display_name: "body:chamfer", component: "component:root", generated_by: "feature:chamfer", visibility: "visible" },
      "body:independent": { id: "body:independent", display_name: "Imported Body", component: "component:root", generated_by: "feature:import", visibility: "visible" },
    },
    features: {
      "feature:extrude": { id: "feature:extrude", display_name: "Extrude", component: "component:root", operation: { schema_id: "crawler.operation.extrude" }, inputs: {}, parameters: {} },
      "feature:fillet": { id: "feature:fillet", display_name: "Fillet", component: "component:root", operation: { schema_id: "crawler.part.fillet" }, inputs: { source: { kind: "body", id: "body:part" } }, parameters: {} },
      "feature:chamfer": { id: "feature:chamfer", display_name: "Chamfer", component: "component:root", operation: { schema_id: "crawler.part.chamfer" }, inputs: { source: { kind: "body", id: "body:fillet" } }, parameters: {} },
      "feature:import": { id: "feature:import", display_name: "Import", component: "component:root", operation: { schema_id: "crawler.operation.import_step" }, inputs: {}, parameters: {} },
    },
  };

  const snapshot = adapterFromWorkerSnapshot(JSON.stringify(document), "legacy-hash", "{}").getSnapshot();
  assert.deepEqual(snapshot.components[0].bodies.map((body) => ({ id: body.id, name: body.name })), [
    { id: "body:chamfer", name: "Part Body" },
    { id: "body:independent", name: "Imported Body" },
  ]);
  assert.deepEqual(snapshot.features.map((feature) => feature.name), ["Origin", "Extrude", "Fillet", "Chamfer", "Import"]);
});

test("construction planes remain selectable durable component entities", () => {
  const document = {
    schema_version: 1,
    id: "document:planes",
    root_component: "component:root",
    components: {
      "component:root": { id: "component:root", body_order: [], sketch_order: [], feature_order: [] },
    },
    origin_planes: {
      "origin-plane:xz": { id: "origin-plane:xz", component: "component:root", plane: "xz" },
    },
    construction_planes: {
      "construction-plane:deck": { schema_version: 1, id: "construction-plane:deck", component: "component:root", definition: { kind: "offset", base_plane: "origin-plane:xz", offset: "parameter:deck" }, suppressed: true },
    },
    parameters: {
      "parameter:deck": { value: { kind: "length_nanometers", value: -12_500_000 } },
    },
  };
  const plane = adapterFromWorkerSnapshot(JSON.stringify(document), "plane-hash", "{}").getSnapshot().components[0].constructionPlanes[0];
  assert.deepEqual(plane, {
    id: "construction-plane:deck",
    name: "Offset XZ plane",
    basePlaneId: "origin-plane:xz",
    offsetParameterId: "parameter:deck",
    offsetNanometers: -12_500_000,
    suppressed: true,
  });
});

test("V2 Extrude inspector parameters override stale legacy direction and half-distance", () => {
  const document = {
    schema_version: 1,
    id: "document:v2-extrude-inspector",
    root_component: "component:root",
    components: {
      "component:root": { id: "component:root", body_order: [], sketch_order: [], feature_order: ["feature:extrude:v2"] },
    },
    features: {
      "feature:extrude:v2": {
        id: "feature:extrude:v2",
        display_name: "Extrude",
        component: "component:root",
        operation: { schema_id: "crawler.operation.extrude" },
        parameters: { distance: "parameter:distance", direction: "parameter:legacy-direction" },
      },
    },
    feature_definitions_v2: {
      "feature:extrude:v2": {
        operation: { kind: "extrude", extent: { kind: "blind", distance: "parameter:distance", direction: "symmetric" } },
        result: { mode: "new_body", body: "body:extrude:v2" },
      },
    },
    parameters: {
      "parameter:distance": { value: { kind: "length_nanometers", value: 4_000_000 } },
      "parameter:legacy-direction": { value: { kind: "text", value: "positive" } },
    },
  };
  const feature = adapterFromWorkerSnapshot(JSON.stringify(document), "v2-hash", "{}").findFeature("feature:extrude:v2");
  assert.deepEqual(feature?.parameters, { distance: 8, direction: "symmetric", result_mode: "new_body" });
});

test("V2 Cut inspector parameters override a stale legacy New Body result mode", () => {
  const document = {
    schema_version: 1,
    id: "document:v2-cut-inspector",
    root_component: "component:root",
    components: {
      "component:root": { id: "component:root", body_order: ["body:target"], sketch_order: [], feature_order: ["feature:extrude:cut"] },
    },
    bodies: {
      "body:target": { id: "body:target", component: "component:root", generated_by: "feature:extrude:cut", visibility: "visible" },
    },
    features: {
      "feature:extrude:cut": {
        id: "feature:extrude:cut",
        display_name: "Extrude Cut",
        component: "component:root",
        operation: { schema_id: "crawler.operation.extrude" },
        parameters: {
          distance: "parameter:distance",
          direction: "parameter:legacy-direction",
          result_mode: "parameter:legacy-result-mode",
        },
      },
    },
    feature_definitions_v2: {
      "feature:extrude:cut": {
        operation: { kind: "extrude", extent: { kind: "blind", distance: "parameter:distance", direction: "negative" } },
        result: { mode: "cut" },
        participant_bodies: [{ role: "target", body: "body:target" }],
      },
    },
    parameters: {
      "parameter:distance": { value: { kind: "length_nanometers", value: 2_000_000 } },
      "parameter:legacy-direction": { value: { kind: "text", value: "positive" } },
      "parameter:legacy-result-mode": { value: { kind: "text", value: "new_body" } },
    },
  };
  const feature = adapterFromWorkerSnapshot(JSON.stringify(document), "cut-hash", "{}").findFeature("feature:extrude:cut");
  assert.deepEqual(feature?.parameters, { distance: 2, direction: "negative", result_mode: "cut", target_body: "body:target" });
});
