import type {
  Component,
  Document,
  DocumentChange,
  Feature,
  FeatureRecomputeState,
  Sketch,
  SketchElement,
  SketchSupport,
  TopologySignature,
} from "./types.ts";

const sortedRecord = <T, U>(
  record: Readonly<Record<string, T>>,
  map: (value: T) => U,
): Record<string, U> =>
  Object.fromEntries(Object.keys(record).sort().map((key) => [key, map(record[key]!) ]));

const orderedComponent = (value: Component) => ({
  id: value.id,
  display_name: value.display_name,
  parent: value.parent,
  child_components: value.child_components,
  body_order: value.body_order,
  sketch_order: value.sketch_order,
  feature_order: value.feature_order,
  parameter_order: value.parameter_order,
});

const orderedSketchSupport = (value: SketchSupport) =>
  value.kind === "origin_plane"
    ? { kind: value.kind, plane: value.plane }
    : { kind: value.kind, reference: value.reference };

const orderedSketchElement = (value: SketchElement) =>
  value.kind === "point"
    ? {
        kind: value.kind,
        id: value.id,
        x_nanometers: value.x_nanometers,
        y_nanometers: value.y_nanometers,
      }
    : {
        kind: value.kind,
        id: value.id,
        start_element: value.start_element,
        end_element: value.end_element,
      };

const orderedSketch = (value: Sketch) => ({
  id: value.id,
  display_name: value.display_name,
  component: value.component,
  support: orderedSketchSupport(value.support),
  elements: value.elements.map(orderedSketchElement),
});

const orderedFeature = (value: Feature) => ({
  id: value.id,
  display_name: value.display_name,
  component: value.component,
  operation: {
    schema_id: value.operation.schema_id,
    schema_version: value.operation.schema_version,
  },
  inputs: sortedRecord(value.inputs, (input) => ({ kind: input.kind, id: input.id })),
  parameters: sortedRecord(value.parameters, (parameter) => parameter),
  suppressed: value.suppressed,
});

const orderedSignature = (value: TopologySignature) => {
  switch (value.kind) {
    case "vertex":
      return { kind: value.kind, position_nanometers: value.position_nanometers };
    case "edge":
      return {
        kind: value.kind,
        midpoint_nanometers: value.midpoint_nanometers,
        length_nanometers: value.length_nanometers,
      };
    case "face":
      return {
        kind: value.kind,
        centroid_nanometers: value.centroid_nanometers,
        normal_millionths: value.normal_millionths,
        area_square_nanometers: value.area_square_nanometers,
      };
  }
};

const orderedChange = (value: DocumentChange) => {
  switch (value.kind) {
    case "rename_entity":
      return {
        kind: value.kind,
        entity: { kind: value.entity.kind, id: value.entity.id },
        display_name: value.display_name,
      };
    case "set_parameter_value":
      return { kind: value.kind, parameter: value.parameter, value: value.value };
    case "set_feature_suppressed":
      return { kind: value.kind, feature: value.feature, suppressed: value.suppressed };
    case "reorder_feature":
      return {
        kind: value.kind,
        component: value.component,
        feature: value.feature,
        before: value.before,
      };
  }
};

const orderedFeatureState = (value: FeatureRecomputeState) => {
  switch (value.status) {
    case "clean":
      return { status: value.status, evaluated_revision: value.evaluated_revision };
    case "dirty":
      return { status: value.status, since_revision: value.since_revision };
    case "failed":
      return {
        status: value.status,
        attempted_revision: value.attempted_revision,
        diagnostic_code: value.diagnostic_code,
      };
  }
};

/** Parse the versioned wire contract. Unknown versions fail closed. */
export function parseDocument(json: string): Document {
  const value: unknown = JSON.parse(json);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("crawler document must be a JSON object");
  }
  const candidate = value as { schema_version?: unknown };
  if (candidate.schema_version !== 1) {
    throw new TypeError(
      `unsupported crawler document schema version ${String(candidate.schema_version)}`,
    );
  }
  return value as Document;
}

/** Serialize with Rust struct order and lexical ordering for every Rust BTreeMap. */
export function serializeDocument(value: Document): string {
  const ordered = {
    schema_version: value.schema_version,
    id: value.id,
    display_name: value.display_name,
    revision: value.revision,
    units: {
      display_length: value.units.display_length,
      display_angle: value.units.display_angle,
    },
    root_component: value.root_component,
    components: sortedRecord(value.components, orderedComponent),
    bodies: sortedRecord(value.bodies, (body) => ({
      id: body.id,
      display_name: body.display_name,
      component: body.component,
      generated_by: body.generated_by,
      visibility: body.visibility,
    })),
    sketches: sortedRecord(value.sketches, orderedSketch),
    features: sortedRecord(value.features, orderedFeature),
    parameters: sortedRecord(value.parameters, (parameter) => ({
      id: parameter.id,
      display_name: parameter.display_name,
      value: { kind: parameter.value.kind, value: parameter.value.value },
    })),
    topology_references: sortedRecord(value.topology_references, (reference) => ({
      id: reference.id,
      body: reference.body,
      producer: reference.producer,
      kind: reference.kind,
      stable_kernel_id: reference.stable_kernel_id,
      stable_token: reference.stable_token,
      fallback_signature: orderedSignature(reference.fallback_signature),
    })),
    transactions: value.transactions.map((transaction) => ({
      id: transaction.id,
      base_revision: transaction.base_revision,
      result_revision: transaction.result_revision,
      changes: transaction.changes.map(orderedChange),
    })),
    recompute: {
      accepted_revision: value.recompute.accepted_revision,
      features: sortedRecord(value.recompute.features, orderedFeatureState),
    },
  };
  return `${JSON.stringify(ordered)}\n`;
}
