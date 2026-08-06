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
