import assert from "node:assert/strict";
import test from "node:test";

import {
  AdvancedFeatureBuildError,
  buildAdvancedFeatureEditEnvelope,
  buildAdvancedFeatureEnvelope,
  serializeAdvancedFeatureEnvelope,
  type AdvancedFeatureRuntimeView,
  type BodySnapshot,
} from "../src/advanced-feature-builder.ts";
import type { AdvancedFeatureCommand } from "../src/protocol.ts";

const body = (id: string): BodySnapshot => ({ body_id: id, solid_json: [1, 2, 3], evidence: { deterministic_digest: id } });

function runtimeView() {
  const snapshots = new Map([
    ["body:active", { feature_id: "feature:active", body: body("body:active") }],
    ["body:target", { feature_id: "feature:target", body: body("body:target") }],
    ["body:tool", { feature_id: "feature:tool", body: body("body:tool") }],
  ]);
  let document = JSON.stringify({ id: "document:alpha", revision: 7 });
  const runtime: AdvancedFeatureRuntimeView = {
    documentJson: () => document,
    activeBodyJson: () => JSON.stringify({
      kind: "feature_result",
      feature_id: "feature:active",
      body: body("body:active"),
      render: { packet: { bounds: [0, 0, 0, 40, 28, 12] } },
    }),
    bodySnapshotJson: (bodyId) => {
      const snapshot = snapshots.get(bodyId);
      return snapshot
        ? JSON.stringify({ found: true, ...snapshot })
        : JSON.stringify({ found: false, error: { category: "not_found", field: "body_id", message: `${bodyId} not found`, recovery: "select an existing body" } });
    },
  };
  return { runtime, document: () => document, setDocument: (value: string) => { document = value; } };
}

function command(operationId: AdvancedFeatureCommand["operationId"], extra: Partial<AdvancedFeatureCommand> = {}): AdvancedFeatureCommand {
  return {
    type: "execute-advanced-feature",
    operationId,
    featureId: `feature:test:${operationId}`,
    outputBodyId: `body:test:${operationId}`,
    ...extra,
  };
}

test("revolve derives a valid exact radial request from active bounds", () => {
  const { runtime } = runtimeView();
  const envelope = buildAdvancedFeatureEnvelope(runtime, command("crawler.part.revolve", {
    parameters: { angle: -180_000_000, reverse: true },
    selection: { axis: "z" },
  }));
  assert.equal(envelope.transaction_id, "transaction:8:revolve");
  assert.deepEqual(envelope.feature.dependencies, ["feature:active"]);
  assert.deepEqual(envelope.request.operation, {
    kind: "revolve",
    axis_origin_nm: [20_000_000, 14_000_000, 0],
    axis: "z",
    inner_radius_nm: 7_000_000,
    outer_radius_nm: 14_000_000,
    axial_start_nm: 0,
    axial_end_nm: 12_000_000,
    sweep_microdegrees: 180_000_000,
    divisions: 32,
    tolerance_nm: 10_000,
  });
  assert.deepEqual(Object.keys(envelope.feature.parameters).sort(), [
    "angle", "axial_end", "axial_start", "divisions", "inner_radius", "outer_radius", "reverse", "tolerance",
  ]);
  assert.equal(envelope.parameter_definitions.length, 8);
  assert.deepEqual(
    envelope.parameter_definitions.find((parameter) => parameter.id.endsWith(":outer_radius"))?.value,
    { kind: "length_nanometers", value: 14_000_000 },
  );
});

test("editing preserves durable feature, body, input, and parameter identities", () => {
  const view = runtimeView();
  const created = buildAdvancedFeatureEnvelope(view.runtime, command("crawler.part.revolve", {
    featureId: "feature:editable",
    outputBodyId: "body:editable",
    parameters: { outer_radius: 8_000_000, angle: 180_000_000 },
  }));
  view.setDocument(JSON.stringify({
    id: "document:alpha",
    revision: 8,
    features: { "feature:editable": created.feature },
    transactions: [{ changes: [{
      kind: "accept_feature_result",
      feature: "feature:editable",
      request_json: JSON.stringify(created.request),
    }] }],
  }));
  const edited = buildAdvancedFeatureEditEnvelope(view.runtime, command("crawler.part.revolve", {
    type: "edit-advanced-feature",
    featureId: "feature:editable",
    outputBodyId: "body:editable",
    parameters: { outer_radius: 12_000_000, angle: 270_000_000 },
  }));
  assert.equal(edited.feature.id, "feature:editable");
  assert.equal(edited.request.output_body_id, "body:editable");
  assert.equal(edited.request.operation.outer_radius_nm, 12_000_000);
  assert.equal(edited.request.operation.sweep_microdegrees, 270_000_000);
  assert.deepEqual(edited.request.operation.axis_origin_nm, created.request.operation.axis_origin_nm);
  assert.deepEqual(edited.feature.inputs, created.feature.inputs);
  assert.deepEqual(edited.feature.parameters, created.feature.parameters);
  assert.equal("before" in edited, false);
  assert.doesNotMatch(serializeAdvancedFeatureEnvelope(edited), /"before"/);
  assert.equal(
    edited.parameter_definitions.find((parameter) => parameter.id.endsWith(":outer_radius"))?.value.value,
    12_000_000,
  );
});

for (const [operationId, kind] of [
  ["crawler.part.boolean.union", "union"],
  ["crawler.part.boolean.cut", "cut"],
  ["crawler.part.boolean.intersect", "intersect"],
] as const) {
  test(`${operationId} resolves explicit durable target and tool snapshots`, () => {
    const { runtime } = runtimeView();
    const envelope = buildAdvancedFeatureEnvelope(runtime, command(operationId, {
      parameters: { tolerance: 50_000 },
      selection: { targetBodyId: "body:target", toolBodyIds: ["body:tool"] },
    }));
    assert.equal(envelope.request.operation.kind, "boolean");
    assert.equal(envelope.request.operation.operation, kind);
    assert.deepEqual(envelope.feature.dependencies, ["feature:target", "feature:tool"]);
    assert.deepEqual((envelope.request.operation.tools as BodySnapshot[]).map((tool) => tool.body_id), ["body:tool"]);
  });
}

test("fillet and chamfer preserve u64 topology identities in serialized JSON", () => {
  const { runtime } = runtimeView();
  const stableId = "18446744073709551614";
  for (const [operationId, parameter, value] of [
    ["crawler.part.fillet", "radius", 125_000],
    ["crawler.part.chamfer", "distance", 250_000],
  ] as const) {
    const envelope = buildAdvancedFeatureEnvelope(runtime, command(operationId, {
      parameters: { [parameter]: value },
      selection: { edgeStableIds: [stableId] },
    }));
    const json = serializeAdvancedFeatureEnvelope(envelope);
    assert.match(json, new RegExp(`"edge_stable_ids":\\[${stableId}\\]`));
    assert.doesNotMatch(json, /__crawler_exact_u64__/);
    assert.equal(envelope.request.operation.radius_nm, value);
  }
});

test("mirror and both pattern forms encode body or feature-sequence semantics", () => {
  const { runtime } = runtimeView();
  const mirror = buildAdvancedFeatureEnvelope(runtime, command("crawler.part.mirror", {
    selection: { axis: "x", originNanometers: [5, 6, 7], orderedFeatureIds: ["feature:active"] },
  }));
  assert.deepEqual(mirror.request.operation.source, {
    semantics: "feature_sequence",
    ordered_feature_ids: ["feature:active"],
    resolved_body: body("body:active"),
  });
  assert.equal(mirror.request.operation.plane_normal, "x");

  const linear = buildAdvancedFeatureEnvelope(runtime, command("crawler.part.pattern.linear", {
    parameters: { count: 3, spacing: 5_000_000, symmetric: false },
    selection: { axis: "y", directionSign: -1 },
  }));
  assert.deepEqual(linear.request.operation.step_nm, [0, -5_000_000, 0]);
  assert.equal((linear.request.operation.instance_body_ids as string[]).length, 3);

  const circular = buildAdvancedFeatureEnvelope(runtime, command("crawler.part.pattern.circular", {
    parameters: { count: 4, angle: 360_000_000 },
    selection: { axis: "z" },
  }));
  assert.equal(circular.request.operation.step_microdegrees, 90_000_000);
  assert.equal((circular.request.operation.instance_body_ids as string[]).length, 4);
});

test("transform encodes one explicit body translation with exact signed offsets", () => {
  const view = runtimeView();
  const envelope = buildAdvancedFeatureEnvelope(view.runtime, command("crawler.part.transform", {
    featureId: "feature:translate",
    outputBodyId: "body:translate",
    parameters: { x: -2_000_000, y: 3_000_000, z: 500_000 },
    selection: { sourceBodyId: "body:active" },
  }));
  assert.deepEqual(envelope.request.operation, {
    kind: "transform",
    source: { semantics: "body", body: body("body:active") },
    translation_nm: [-2_000_000, 3_000_000, 500_000],
    tolerance_nm: 10_000,
  });
  assert.deepEqual(envelope.feature.dependencies, ["feature:active"]);
  assert.deepEqual(Object.keys(envelope.feature.parameters).sort(), ["tolerance", "x", "y", "z"]);
  view.setDocument(JSON.stringify({
    id: "document:alpha",
    revision: 8,
    features: { "feature:translate": envelope.feature },
    transactions: [{ changes: [{
      kind: "accept_feature_result",
      feature: "feature:translate",
      request_json: JSON.stringify(envelope.request),
    }] }],
  }));
  const edited = buildAdvancedFeatureEditEnvelope(view.runtime, command("crawler.part.transform", {
    type: "edit-advanced-feature",
    featureId: "feature:translate",
    outputBodyId: "body:translate",
    parameters: { x: 4_000_000, y: -1_000_000, z: 2_000_000 },
  }));
  assert.equal(edited.feature.id, "feature:translate");
  assert.equal(edited.request.output_body_id, "body:translate");
  assert.deepEqual(edited.request.operation.translation_nm, [4_000_000, -1_000_000, 2_000_000]);
  assert.deepEqual(edited.request.operation.source, envelope.request.operation.source);
  assert.deepEqual(edited.feature.parameters, envelope.feature.parameters);
  assert.throws(
    () => buildAdvancedFeatureEnvelope(view.runtime, command("crawler.part.transform", {
      parameters: { x: 0, y: 0, z: 0 },
    })),
    (error: unknown) => error instanceof AdvancedFeatureBuildError
      && error.detail.category === "invalid_input",
  );
  assert.throws(
    () => buildAdvancedFeatureEnvelope(view.runtime, command("crawler.part.transform", {
      parameters: { x: 1, y: 0, z: 0 },
      selection: { orderedFeatureIds: ["feature:active"] },
    })),
    (error: unknown) => error instanceof AdvancedFeatureBuildError
      && error.detail.category === "unsupported"
      && error.detail.field === "selection.orderedFeatureIds",
  );
});

test("shell builds a qualified exact prismatic request from one stable face", () => {
  const { runtime } = runtimeView();
  const envelope = buildAdvancedFeatureEnvelope(runtime, command("crawler.part.shell", {
    parameters: { thickness: 500_000 },
    selection: { removedFaceStableIds: ["42"] },
  }));
  assert.equal(envelope.request.operation.kind, "shell");
  assert.match(serializeAdvancedFeatureEnvelope(envelope), /"removed_face_stable_ids":\[42\]/);
});

test("invalid selections return structured recovery without mutating the runtime view", () => {
  const view = runtimeView();
  const before = view.document();
  assert.throws(
    () => buildAdvancedFeatureEnvelope(view.runtime, command("crawler.part.boolean.union")),
    (error: unknown) => error instanceof AdvancedFeatureBuildError
      && error.detail.category === "invalid_input"
      && error.detail.field === "selection.toolBodyIds"
      && error.detail.recovery.length > 0,
  );
  assert.equal(view.document(), before);
});

test("suppressed or missing body lookup failures remain structured", () => {
  const { runtime } = runtimeView();
  assert.throws(
    () => buildAdvancedFeatureEnvelope(runtime, command("crawler.part.fillet", {
      selection: { sourceBodyId: "body:suppressed", edgeStableIds: ["12"] },
    })),
    (error: unknown) => error instanceof AdvancedFeatureBuildError
      && error.detail.category === "not_found"
      && error.detail.field === "body_id",
  );
});
