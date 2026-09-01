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

test("fillet and chamfer preserve u64 topology identities as canonical JSON strings", () => {
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
    assert.match(json, new RegExp(`"edge_stable_ids":\\["${stableId}"\\]`));
    assert.equal(envelope.request.operation.radius_nm, value);
  }
});

test("advanced topology selections reject noncanonical, zero, and out-of-range u64 text", () => {
  const { runtime } = runtimeView();
  for (const stableId of ["", "00", "01", "+1", "-1", " 1", "1 ", "1.0", "abc", "0", "18446744073709551616"]) {
    assert.throws(
      () => buildAdvancedFeatureEnvelope(runtime, command("crawler.part.fillet", {
        selection: { edgeStableIds: [stableId] },
      })),
      (error: unknown) => error instanceof AdvancedFeatureBuildError
        && error.detail.category === "invalid_input"
        && error.detail.field === "selection.edgeStableIds[0]",
      stableId,
    );
  }
});

test("advanced topology selection arrays retain canonical u64 strings before serialization", () => {
  const { runtime } = runtimeView();
  const maximum = "18446744073709551615";
  const fillet = buildAdvancedFeatureEnvelope(runtime, command("crawler.part.fillet", {
    selection: { edgeStableIds: [maximum] },
  }));
  const draft = buildAdvancedFeatureEnvelope(runtime, command("crawler.part.draft", {
    selection: { draftFaceStableIds: [maximum] },
  }));
  const shell = buildAdvancedFeatureEnvelope(runtime, command("crawler.part.shell", {
    selection: { removedFaceStableIds: [maximum] },
  }));
  assert.deepEqual(fillet.request.operation.edge_stable_ids, [maximum]);
  assert.deepEqual(draft.request.operation.face_stable_ids, [maximum]);
  assert.deepEqual(shell.request.operation.removed_face_stable_ids, [maximum]);
});

test("advanced feature edits fail closed on numeric or noncanonical stored topology identities", () => {
  for (const [operationId, operation, parameters] of [
    ["crawler.part.draft", { kind: "draft", target: body("body:target"), face_stable_ids: [42], pull_direction: "z", neutral_plane_origin_nm: [0, 0, 0], angle_microdegrees: 1_000_000, tolerance_nm: 10_000 }, { angle: 1_000_000, reverse: false }],
    ["crawler.part.fillet", { kind: "fillet", target: body("body:target"), edge_stable_ids: ["01"], radius_nm: 10, divisions: 5, tolerance_nm: 10_000 }, { radius: 10, divisions: 5, tolerance: 10_000 }],
    ["crawler.part.chamfer", { kind: "chamfer", target: body("body:target"), edge_stable_ids: [42], radius_nm: 10, divisions: 5, tolerance_nm: 10_000 }, { distance: 10, divisions: 5, tolerance: 10_000 }],
    ["crawler.part.shell", { kind: "shell", target: body("body:target"), removed_face_stable_ids: [42], wall_thickness_nm: 10, tolerance_nm: 10_000 }, { thickness: 10, tolerance: 10_000 }],
  ] as const) {
    const accepted = acceptedOperation(operationId, operation, parameters);
    assert.throws(
      () => buildAdvancedFeatureEditEnvelope(accepted.view.runtime, command(operationId, {
        type: "edit-advanced-feature",
        featureId: accepted.featureId,
      })),
      (error: unknown) => error instanceof AdvancedFeatureBuildError
        && error.detail.category === "invalid_input"
        && error.detail.field?.startsWith("operation.") === true,
      operationId,
    );
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
    // A stale caller may still send the parameter removed from the catalog;
    // it must not affect the durable request or parameter bindings.
    parameters: { count: 3, spacing: 5_000_000, symmetric: true },
    selection: { axis: "y", directionSign: -1 },
  }));
  assert.deepEqual(linear.request.operation.step_nm, [0, -5_000_000, 0]);
  assert.equal((linear.request.operation.instance_body_ids as string[]).length, 3);
  assert.equal("symmetric" in linear.feature.parameters, false);

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
  assert.match(serializeAdvancedFeatureEnvelope(envelope), /"removed_face_stable_ids":\["42"\]/);
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

function acceptedOperation(
  operationId: AdvancedFeatureCommand["operationId"],
  operation: Record<string, unknown>,
  parameterValues: Record<string, number | boolean | string>,
) {
  const view = runtimeView();
  const featureId = `feature:accepted:${operationId}`;
  const outputBodyId = `body:accepted:${operationId}`;
  const parameters = Object.fromEntries(Object.keys(parameterValues).map((key) => [key, `parameter:accepted:${key}`]));
  const feature = {
    id: featureId,
    display_name: "Accepted feature",
    component: "component:root",
    operation: { schema_id: operationId, schema_version: 1 },
    dependencies: ["feature:geometry-source"],
    inputs: { source: { kind: "body", id: "body:geometry-source" } },
    parameters,
    suppressed: false,
  };
  view.setDocument(JSON.stringify({
    id: "document:alpha",
    revision: 21,
    features: { [featureId]: feature },
    parameters: Object.fromEntries(Object.entries(parameterValues).map(([key, value]) => [parameters[key], {
      id: parameters[key],
      display_name: key,
      value: { kind: typeof value === "boolean" ? "boolean" : key === "angle" ? "angle_microdegrees" : "length_nanometers", value },
    }])),
    transactions: [{ changes: [{
      kind: "accept_feature_result",
      feature: featureId,
      request_json: JSON.stringify({
        schema_version: 1,
        document_id: "document:alpha",
        feature_id: featureId,
        output_body_id: outputBodyId,
        operation,
      }),
    }] }],
  }));
  return { view, featureId, outputBodyId, feature };
}

test("profile revolve edits exact sweep and reverse axis while preserving profile geometry and identities", () => {
  const profile = [[2_000_000, 0, 0], [4_000_000, 0, 0], [4_000_000, 0, 5_000_000], [2_000_000, 0, 5_000_000]];
  const accepted = acceptedOperation("crawler.part.revolve", {
    kind: "profile_revolve",
    profile_nm: profile,
    axis_origin_nm: [0, 0, 0],
    axis_direction_nm: [0, 0, 1_000_000],
    sweep_microdegrees: 180_000_000,
    divisions: 32,
    tolerance_nm: 10_000,
  }, { angle: 180_000_000, reverse: false });
  const edited = buildAdvancedFeatureEditEnvelope(accepted.view.runtime, command("crawler.part.revolve", {
    type: "edit-advanced-feature",
    featureId: accepted.featureId,
    outputBodyId: "body:ignored-by-edit",
    parameters: { angle: 270_000_000, reverse: true },
  }));
  assert.equal(edited.request.feature_id, accepted.featureId);
  assert.equal(edited.request.output_body_id, accepted.outputBodyId);
  assert.equal(edited.request.operation.sweep_microdegrees, 270_000_000);
  assert.deepEqual(edited.request.operation.axis_direction_nm, [0, 0, -1_000_000]);
  assert.deepEqual(edited.request.operation.profile_nm, profile);
  assert.deepEqual(edited.request.operation.axis_origin_nm, [0, 0, 0]);
  assert.deepEqual(edited.feature.inputs, accepted.feature.inputs);
  assert.deepEqual(edited.feature.parameters, accepted.feature.parameters);
});

test("an already-reversed profile revolve does not flip its persisted axis again", () => {
  const accepted = acceptedOperation("crawler.part.revolve", {
    kind: "profile_revolve",
    profile_nm: [[1, 0, 0], [2, 0, 0], [2, 0, 2], [1, 0, 2]],
    axis_origin_nm: [0, 0, 0],
    axis_direction_nm: [0, -5_000_000, 0],
    sweep_microdegrees: 90_000_000,
    divisions: 16,
    tolerance_nm: 10_000,
  }, { angle: 90_000_000, reverse: true });
  const edited = buildAdvancedFeatureEditEnvelope(accepted.view.runtime, command("crawler.part.revolve", {
    type: "edit-advanced-feature",
    featureId: accepted.featureId,
    parameters: { angle: 120_000_000, reverse: true },
  }));
  assert.deepEqual(edited.request.operation.axis_direction_nm, [0, -5_000_000, 0]);
});

test("extrude cut distance edit rescales the exact persisted direction without replacing target or profile", () => {
  const target = body("body:cut-target");
  const profiles = [[[0, 0, 0], [2_000_000, 0, 0], [2_000_000, 1_000_000, 0], [0, 1_000_000, 0]]];
  const accepted = acceptedOperation("crawler.part.extrude.cut", {
    kind: "extrude_cut",
    target,
    profiles_nm: profiles,
    direction_nm: [3_000_000, 4_000_000, 0],
    tolerance_nm: 10_000,
  }, { distance: 5_000_000 });
  const edited = buildAdvancedFeatureEditEnvelope(accepted.view.runtime, command("crawler.part.extrude.cut", {
    type: "edit-advanced-feature",
    featureId: accepted.featureId,
    parameters: { distance: 10_000_000 },
  }));
  assert.deepEqual(edited.request.operation.direction_nm, [6_000_000, 8_000_000, 0]);
  assert.deepEqual(edited.request.operation.target, target);
  assert.deepEqual(edited.request.operation.profiles_nm, profiles);
  assert.deepEqual(edited.feature.parameters, accepted.feature.parameters);
});

test("revolve cut edit preserves target and profile while applying angle and reverse to the exact axis", () => {
  const target = body("body:revolve-cut-target");
  const profile = [[1, 0, 0], [3, 0, 0], [3, 0, 4], [1, 0, 4]];
  const accepted = acceptedOperation("crawler.part.revolve.cut", {
    kind: "revolve_cut",
    target,
    profile_nm: profile,
    axis_origin_nm: [5, 6, 7],
    axis_direction_nm: [0, 2_000_000, 0],
    sweep_microdegrees: 90_000_000,
    divisions: 24,
    tolerance_nm: 10_000,
  }, { angle: 90_000_000, reverse: false });
  const edited = buildAdvancedFeatureEditEnvelope(accepted.view.runtime, command("crawler.part.revolve.cut", {
    type: "edit-advanced-feature",
    featureId: accepted.featureId,
    parameters: { angle: 45_000_000, reverse: true },
  }));
  assert.equal(edited.request.operation.sweep_microdegrees, 45_000_000);
  assert.deepEqual(edited.request.operation.axis_direction_nm, [0, -2_000_000, 0]);
  assert.deepEqual(edited.request.operation.axis_origin_nm, [5, 6, 7]);
  assert.deepEqual(edited.request.operation.profile_nm, profile);
  assert.deepEqual(edited.request.operation.target, target);
});

test("loft and sweep edits preserve all ordered geometry sources exactly", () => {
  const cases: Array<[AdvancedFeatureCommand["operationId"], Record<string, unknown>]> = [
    ["crawler.part.loft", { kind: "loft", profiles_nm: [[[0, 0, 0]], [[0, 0, 8]]], tolerance_nm: 10_000 }],
    ["crawler.part.sweep", { kind: "sweep", profile_nm: [[0, 0, 0], [1, 0, 0]], path_nm: [[0, 0, 0], [0, 5, 0], [0, 5, 9]], tolerance_nm: 10_000 }],
  ];
  for (const [operationId, operation] of cases) {
    const accepted = acceptedOperation(operationId, operation, {});
    const edited = buildAdvancedFeatureEditEnvelope(accepted.view.runtime, command(operationId, {
      type: "edit-advanced-feature",
      featureId: accepted.featureId,
    }));
    assert.deepEqual(edited.request.operation, operation);
    assert.deepEqual(edited.feature.inputs, accepted.feature.inputs);
    assert.deepEqual(edited.feature.parameters, {});
    assert.deepEqual(edited.parameter_definitions, []);
  }
});

test("Draft creation and edit use exact selected faces, target, pull axis, neutral plane, angle, and reverse", () => {
  const { runtime } = runtimeView();
  const created = buildAdvancedFeatureEnvelope(runtime, command("crawler.part.draft", {
    featureId: "feature:draft",
    outputBodyId: "body:draft",
    parameters: { angle: 3_000_000, reverse: true },
    selection: {
      targetBodyId: "body:target",
      draftFaceStableIds: ["42", "18446744073709551614"],
      axis: "y",
      neutralPlaneOriginNanometers: [10, 20, 30],
    },
  }));
  assert.deepEqual(created.feature.dependencies, ["feature:target"]);
  assert.deepEqual(created.request.operation.target, body("body:target"));
  assert.equal(created.request.operation.pull_direction, "y");
  assert.deepEqual(created.request.operation.neutral_plane_origin_nm, [10, 20, 30]);
  assert.equal(created.request.operation.angle_microdegrees, -3_000_000);
  assert.match(serializeAdvancedFeatureEnvelope(created), /"face_stable_ids":\["42","18446744073709551614"\]/);

  const accepted = acceptedOperation("crawler.part.draft", created.request.operation, {
    angle: 3_000_000,
    reverse: true,
  });
  const edited = buildAdvancedFeatureEditEnvelope(accepted.view.runtime, command("crawler.part.draft", {
    type: "edit-advanced-feature",
    featureId: accepted.featureId,
    parameters: { angle: 7_500_000, reverse: false },
  }));
  assert.equal(edited.request.operation.angle_microdegrees, 7_500_000);
  assert.deepEqual(edited.request.operation.target, created.request.operation.target);
  assert.match(serializeAdvancedFeatureEnvelope(edited), /"face_stable_ids":\["42","18446744073709551614"\]/);
  assert.equal(edited.request.operation.pull_direction, "y");
  assert.deepEqual(edited.request.operation.neutral_plane_origin_nm, [10, 20, 30]);
  assert.deepEqual(edited.feature.parameters, accepted.feature.parameters);
});
