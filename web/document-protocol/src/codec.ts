import type {
  Component,
  Document,
  DocumentChange,
  Feature,
  FeatureDefinitionV2,
  FeatureRecomputeState,
  RegionDefinitionV2,
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

const TOPOLOGY_REFERENCE_FIELDS = new Set([
  "schema_version",
  "id",
  "component",
  "body",
  "producer",
  "kind",
  "stable_kernel_id",
  "stable_token",
  "fallback_signature",
]);
const U64_MAX = 18_446_744_073_709_551_615n;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireString = (
  value: unknown,
  field: string,
  referenceId: string,
): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`topology reference ${referenceId} ${field} is required`);
  }
  return value;
};

const requireExactFields = (
  value: Record<string, unknown>,
  fields: readonly string[],
  context: string,
): void => {
  const expected = new Set(fields);
  const missing = fields.find((field) => !Object.hasOwn(value, field));
  if (missing !== undefined) {
    throw new TypeError(`${context} ${missing} is required`);
  }
  const unknown = Object.keys(value).find((field) => !expected.has(field));
  if (unknown !== undefined) {
    throw new TypeError(`${context} contains unknown field ${unknown}`);
  }
};

const requireCanonicalU64Decimal = (value: unknown, context: string): string => {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9][0-9]*)$/.test(value) ||
    BigInt(value) > U64_MAX
  ) {
    throw new TypeError(`${context} must be a canonical u64 decimal string`);
  }
  return value;
};

const requireI64Pair = (value: unknown, field: string, context: string): void => {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !value.every((coordinate) => Number.isSafeInteger(coordinate))
  ) {
    throw new TypeError(`${context} ${field} must contain exactly two safe integers`);
  }
};

const requireI64Tuple = (value: unknown, field: string, referenceId: string): void => {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every((coordinate) => Number.isSafeInteger(coordinate))
  ) {
    throw new TypeError(
      `topology reference ${referenceId} fallback_signature ${field} must contain exactly three safe integers`,
    );
  }
};

const requireU64Number = (value: unknown, field: string, referenceId: string): void => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(
      `topology reference ${referenceId} fallback_signature ${field} must be a non-negative safe integer`,
    );
  }
};

const validateTopologySignature = (value: unknown, referenceId: string): void => {
  if (!isRecord(value)) {
    throw new TypeError(
      `topology reference ${referenceId} fallback_signature is required`,
    );
  }
  switch (value.kind) {
    case "vertex":
      requireExactFields(
        value,
        ["kind", "position_nanometers"],
        `topology reference ${referenceId} fallback_signature`,
      );
      requireI64Tuple(value.position_nanometers, "position_nanometers", referenceId);
      return;
    case "edge":
      requireExactFields(
        value,
        ["kind", "midpoint_nanometers", "length_nanometers"],
        `topology reference ${referenceId} fallback_signature`,
      );
      requireI64Tuple(value.midpoint_nanometers, "midpoint_nanometers", referenceId);
      requireU64Number(value.length_nanometers, "length_nanometers", referenceId);
      return;
    case "face":
      requireExactFields(
        value,
        [
          "kind",
          "centroid_nanometers",
          "normal_millionths",
          "area_square_nanometers",
        ],
        `topology reference ${referenceId} fallback_signature`,
      );
      requireI64Tuple(value.centroid_nanometers, "centroid_nanometers", referenceId);
      requireI64Tuple(value.normal_millionths, "normal_millionths", referenceId);
      requireU64Number(
        value.area_square_nanometers,
        "area_square_nanometers",
        referenceId,
      );
      return;
    default:
      throw new TypeError(
        `topology reference ${referenceId} fallback_signature kind is invalid`,
      );
  }
};

const validateBodyProducerLineages = (document: Record<string, unknown>): void => {
  if (!isRecord(document.bodies)) {
    throw new TypeError("crawler document bodies must be a JSON object");
  }
  const features = isRecord(document.features) ? document.features : {};
  for (const [bodyId, candidate] of Object.entries(document.bodies)) {
    if (!isRecord(candidate)) continue;
    const lineage = candidate.producer_lineage ?? [];
    if (!Array.isArray(lineage)) {
      throw new TypeError(`body ${bodyId} producer_lineage must be an array`);
    }
    const seen = new Set<string>();
    for (const producerId of lineage) {
      if (
        typeof producerId !== "string" ||
        producerId.length === 0 ||
        producerId === candidate.generated_by ||
        seen.has(producerId)
      ) {
        throw new TypeError(`body ${bodyId} producer_lineage is invalid`);
      }
      seen.add(producerId);
      const producer = features[producerId];
      if (!isRecord(producer)) {
        throw new TypeError(`body ${bodyId} producer_lineage uses unknown feature ${producerId}`);
      }
      if (producer.component !== candidate.component) {
        throw new TypeError(`body ${bodyId} producer_lineage feature ${producerId} is cross-component`);
      }
    }
  }
};

const validateTopologyReferences = (document: Record<string, unknown>): void => {
  if (!isRecord(document.topology_references)) {
    throw new TypeError("crawler document topology_references must be a JSON object");
  }

  const components = isRecord(document.components) ? document.components : {};
  const bodies = isRecord(document.bodies) ? document.bodies : {};
  const features = isRecord(document.features) ? document.features : {};

  for (const [referenceKey, value] of Object.entries(document.topology_references)) {
    if (!isRecord(value)) {
      throw new TypeError(`topology reference ${referenceKey} must be a JSON object`);
    }

    const unknownField = Object.keys(value).find(
      (field) => !TOPOLOGY_REFERENCE_FIELDS.has(field),
    );
    if (unknownField !== undefined) {
      throw new TypeError(
        `topology reference ${referenceKey} contains unknown field ${unknownField}`,
      );
    }
    if (value.schema_version === undefined) {
      throw new TypeError(`topology reference ${referenceKey} schema_version is required`);
    }
    if (value.schema_version !== 1) {
      throw new TypeError(
        `unsupported topology reference schema version ${String(value.schema_version)}`,
      );
    }

    const id = requireString(value.id, "id", referenceKey);
    if (id !== referenceKey) {
      throw new TypeError(
        `topology reference map key ${referenceKey} does not match embedded id ${id}`,
      );
    }
    const component = requireString(value.component, "component", referenceKey);
    const bodyId = requireString(value.body, "body", referenceKey);
    const producerId = requireString(value.producer, "producer", referenceKey);
    requireString(value.stable_token, "stable_token", referenceKey);

    if (!Object.hasOwn(components, component)) {
      throw new TypeError(
        `topology reference ${referenceKey} uses unknown component ${component}`,
      );
    }
    const body = bodies[bodyId];
    if (!isRecord(body)) {
      throw new TypeError(`topology reference ${referenceKey} uses unknown body ${bodyId}`);
    }
    const producer = features[producerId];
    if (!isRecord(producer)) {
      throw new TypeError(
        `topology reference ${referenceKey} uses unknown producer ${producerId}`,
      );
    }
    const lineage = (body.producer_lineage ?? []) as unknown[];
    const producerIsAccepted = body.generated_by === producerId || lineage.includes(producerId);
    if (body.component !== component || producer.component !== component || !producerIsAccepted) {
      throw new TypeError(
        `topology reference ${referenceKey} component ${component} does not match its body and producer`,
      );
    }

    if (
      value.kind !== "vertex" &&
      value.kind !== "edge" &&
      value.kind !== "face" &&
      value.kind !== "shell" &&
      value.kind !== "solid"
    ) {
      throw new TypeError(`topology reference ${referenceKey} kind is invalid`);
    }
    requireCanonicalU64Decimal(
      value.stable_kernel_id,
      `topology reference ${referenceKey} stable_kernel_id`,
    );
    validateTopologySignature(value.fallback_signature, referenceKey);
  }
};

const validateExternalLines = (document: Record<string, unknown>): void => {
  if (!isRecord(document.sketches)) {
    throw new TypeError("crawler document sketches must be a JSON object");
  }

  for (const [sketchKey, sketch] of Object.entries(document.sketches)) {
    if (!isRecord(sketch) || !Array.isArray(sketch.elements)) {
      continue;
    }
    for (const [index, element] of sketch.elements.entries()) {
      if (!isRecord(element)) {
        continue;
      }
      if (!Object.hasOwn(element, "kind")) {
        throw new TypeError(`sketch ${sketchKey} element ${index} kind is required`);
      }
      if (element.kind !== "external_line") continue;
      const context = `sketch ${sketchKey} external_line element ${index}`;
      requireExactFields(
        element,
        [
          "kind",
          "id",
          "start_nanometers",
          "end_nanometers",
          "body",
          "stable_kernel_id",
        ],
        context,
      );
      if (typeof element.id !== "string" || element.id.length === 0) {
        throw new TypeError(`${context} id is required`);
      }
      requireI64Pair(element.start_nanometers, "start_nanometers", context);
      requireI64Pair(element.end_nanometers, "end_nanometers", context);
      if (typeof element.body !== "string" || element.body.length === 0) {
        throw new TypeError(`${context} body is required`);
      }
      requireCanonicalU64Decimal(
        element.stable_kernel_id,
        `${context} stable_kernel_id`,
      );
    }
  }
};

const requireNonemptyId = (value: unknown, context: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${context} is required`);
  }
  return value;
};

const validateFeatureDefinitionsV2 = (document: Record<string, unknown>): void => {
  const definitions = document.feature_definitions_v2;
  if (definitions === undefined) return;
  if (!isRecord(definitions)) {
    throw new TypeError("crawler document feature_definitions_v2 must be a JSON object");
  }
  const features = isRecord(document.features) ? document.features : {};
  const bodies = isRecord(document.bodies) ? document.bodies : {};
  for (const [featureId, candidate] of Object.entries(definitions)) {
    if (!isRecord(candidate)) {
      throw new TypeError(`feature definition ${featureId} must be a JSON object`);
    }
    const requiredFields = ["schema_version", "operation", "result", "required_capabilities"];
    const allowedFields = new Set([...requiredFields, "participant_bodies"]);
    const missing = requiredFields.find((field) => !Object.hasOwn(candidate, field));
    if (missing !== undefined) {
      throw new TypeError(`feature definition ${featureId} ${missing} is required`);
    }
    const unknown = Object.keys(candidate).find((field) => !allowedFields.has(field));
    if (unknown !== undefined) {
      throw new TypeError(`feature definition ${featureId} contains unknown field ${unknown}`);
    }
    if (candidate.schema_version !== 2) {
      throw new TypeError(
        `unsupported crawler feature-definition schema version ${String(candidate.schema_version)}`,
      );
    }
    const feature = features[featureId];
    if (!isRecord(feature)) {
      throw new TypeError(`feature definition ${featureId} has no semantic feature`);
    }
    if (!isRecord(candidate.operation)) {
      throw new TypeError(`feature definition ${featureId} operation is required`);
    }
    requireExactFields(
      candidate.operation,
      ["kind", "profile", "support", "extent", "modifiers"],
      `feature definition ${featureId} operation`,
    );
    if (candidate.operation.kind !== "extrude" || candidate.operation.modifiers !== "none") {
      throw new TypeError(`feature definition ${featureId} operation is not a bounded Extrude`);
    }
    if (!isRecord(candidate.operation.profile)) {
      throw new TypeError(`feature definition ${featureId} profile is required`);
    }
    requireExactFields(
      candidate.operation.profile,
      ["kind", "sketch", "region"],
      `feature definition ${featureId} profile`,
    );
    if (candidate.operation.profile.kind !== "sketch_region") {
      throw new TypeError(`feature definition ${featureId} profile kind is invalid`);
    }
    requireNonemptyId(candidate.operation.profile.sketch, `feature definition ${featureId} sketch`);
    requireNonemptyId(candidate.operation.profile.region, `feature definition ${featureId} region`);
    if (!isRecord(candidate.operation.support)) {
      throw new TypeError(`feature definition ${featureId} support is required`);
    }
    const supportField = candidate.operation.support.kind === "topology_face" ? "reference" : "plane";
    requireExactFields(
      candidate.operation.support,
      ["kind", supportField],
      `feature definition ${featureId} support`,
    );
    if (!["origin_plane", "construction_plane", "topology_face"].includes(String(candidate.operation.support.kind))) {
      throw new TypeError(`feature definition ${featureId} support kind is invalid`);
    }
    requireNonemptyId(candidate.operation.support[supportField], `feature definition ${featureId} support ${supportField}`);
    if (!isRecord(candidate.operation.extent)) {
      throw new TypeError(`feature definition ${featureId} extent is required`);
    }
    requireExactFields(
      candidate.operation.extent,
      ["kind", "distance", "direction"],
      `feature definition ${featureId} extent`,
    );
    if (
      candidate.operation.extent.kind !== "blind" ||
      !["positive", "negative", "symmetric"].includes(String(candidate.operation.extent.direction))
    ) {
      throw new TypeError(`feature definition ${featureId} Blind extent is invalid`);
    }
    requireNonemptyId(candidate.operation.extent.distance, `feature definition ${featureId} distance`);

    if (!isRecord(candidate.result)) {
      throw new TypeError(`feature definition ${featureId} result is required`);
    }
    if (!Array.isArray(candidate.required_capabilities)) {
      throw new TypeError(`feature definition ${featureId} required_capabilities must be an array`);
    }
    const participants = candidate.participant_bodies ?? [];
    if (!Array.isArray(participants)) {
      throw new TypeError(`feature definition ${featureId} participant_bodies must be an array`);
    }
    if (candidate.result.mode === "new_body") {
      requireExactFields(candidate.result, ["mode", "body"], `feature definition ${featureId} result`);
      const output = requireNonemptyId(candidate.result.body, `feature definition ${featureId} result body`);
      if (participants.length !== 0) {
        throw new TypeError(`feature definition ${featureId} New Body cannot contain participant bodies`);
      }
      if (
        candidate.required_capabilities.length !== 1 ||
        candidate.required_capabilities[0] !== "exact_blind_new_body_extrude"
      ) {
        throw new TypeError(`feature definition ${featureId} New Body capability is invalid`);
      }
      const body = bodies[output];
      if (isRecord(body) && body.component !== feature.component) {
        throw new TypeError(`feature definition ${featureId} result body is cross-component`);
      }
    } else if (candidate.result.mode === "cut") {
      requireExactFields(candidate.result, ["mode"], `feature definition ${featureId} result`);
      if (participants.length !== 1 || !isRecord(participants[0])) {
        throw new TypeError(`feature definition ${featureId} Cut requires exactly one target body`);
      }
      requireExactFields(participants[0], ["role", "body"], `feature definition ${featureId} target`);
      const target = requireNonemptyId(participants[0].body, `feature definition ${featureId} target body`);
      if (participants[0].role !== "target") {
        throw new TypeError(`feature definition ${featureId} Cut participant role is invalid`);
      }
      const body = bodies[target];
      if (!isRecord(body)) {
        throw new TypeError(`feature definition ${featureId} target body ${target} does not exist`);
      }
      if (body.component !== feature.component) {
        throw new TypeError(`feature definition ${featureId} target body is cross-component`);
      }
      if (candidate.operation.support.kind === "topology_face") {
        const references = isRecord(document.topology_references)
          ? document.topology_references
          : {};
        const topology = references[candidate.operation.support.reference as string];
        if (!isRecord(topology)) {
          throw new TypeError(`feature definition ${featureId} topology-face support is missing`);
        }
        const producer = features[topology.producer as string];
        const lineage = Array.isArray(body.producer_lineage) ? body.producer_lineage : [];
        if (
          topology.kind !== "face" ||
          topology.body !== target ||
          topology.component !== feature.component ||
          !isRecord(producer) ||
          producer.component !== feature.component ||
          (body.generated_by !== topology.producer && !lineage.includes(topology.producer))
        ) {
          throw new TypeError(
            `feature definition ${featureId} topology-face support is not owned by its Cut target`,
          );
        }
      }
      if (
        candidate.required_capabilities.length !== 1 ||
        candidate.required_capabilities[0] !== "exact_blind_cut_extrude"
      ) {
        throw new TypeError(`feature definition ${featureId} Cut capability is invalid`);
      }
    } else {
      throw new TypeError(`feature definition ${featureId} result mode is invalid`);
    }
  }
};

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

const orderedSketchElement = (value: SketchElement) => {
  switch (value.kind) {
    case "point":
      return {
        kind: value.kind,
        id: value.id,
        x_nanometers: value.x_nanometers,
        y_nanometers: value.y_nanometers,
      };
    case "line":
      return {
        kind: value.kind,
        id: value.id,
        start_element: value.start_element,
        end_element: value.end_element,
      };
    case "external_line":
      return {
        kind: value.kind,
        id: value.id,
        start_nanometers: value.start_nanometers,
        end_nanometers: value.end_nanometers,
        body: value.body,
        stable_kernel_id: value.stable_kernel_id,
      };
    default:
      return value;
  }
};

const orderedSketch = (value: Sketch) => ({
  id: value.id,
  display_name: value.display_name,
  component: value.component,
  support: orderedSketchSupport(value.support),
  elements: value.elements.map(orderedSketchElement),
});

const orderedRegionDefinitionV2 = (value: RegionDefinitionV2) => ({
  id: value.id,
  sketch: value.sketch,
  outer_geometry_ids: value.outer_geometry_ids,
  ...(value.hole_geometry_ids?.length ? { hole_geometry_ids: value.hole_geometry_ids } : {}),
});

const orderedFeatureDefinitionV2 = (value: FeatureDefinitionV2) => ({
  schema_version: value.schema_version,
  operation: {
    kind: value.operation.kind,
    profile: {
      kind: value.operation.profile.kind,
      sketch: value.operation.profile.sketch,
      region: value.operation.profile.region,
    },
    support:
      value.operation.support.kind === "topology_face"
        ? { kind: value.operation.support.kind, reference: value.operation.support.reference }
        : { kind: value.operation.support.kind, plane: value.operation.support.plane },
    extent: {
      kind: value.operation.extent.kind,
      distance: value.operation.extent.distance,
      direction: value.operation.extent.direction,
    },
    modifiers: value.operation.modifiers,
  },
  result:
    value.result.mode === "new_body"
      ? { mode: value.result.mode, body: value.result.body }
      : { mode: value.result.mode },
  ...(value.participant_bodies?.length
    ? {
        participant_bodies: value.participant_bodies.map((participant) => ({
          role: participant.role,
          body: participant.body,
        })),
      }
    : {}),
  required_capabilities: value.required_capabilities,
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
  validateBodyProducerLineages(value as Record<string, unknown>);
  validateTopologyReferences(value as Record<string, unknown>);
  validateExternalLines(value as Record<string, unknown>);
  validateFeatureDefinitionsV2(value as Record<string, unknown>);
  return value as Document;
}

/** Serialize with Rust struct order and lexical ordering for every Rust BTreeMap. */
export function serializeDocument(value: Document): string {
  validateBodyProducerLineages(value as unknown as Record<string, unknown>);
  validateTopologyReferences(value as unknown as Record<string, unknown>);
  validateExternalLines(value as unknown as Record<string, unknown>);
  validateFeatureDefinitionsV2(value as unknown as Record<string, unknown>);
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
      ...(body.producer_lineage?.length ? { producer_lineage: body.producer_lineage } : {}),
      visibility: body.visibility,
    })),
    sketches: sortedRecord(value.sketches, orderedSketch),
    ...(value.region_definitions_v2 && Object.keys(value.region_definitions_v2).length
      ? { region_definitions_v2: sortedRecord(value.region_definitions_v2, orderedRegionDefinitionV2) }
      : {}),
    features: sortedRecord(value.features, orderedFeature),
    ...(value.feature_definitions_v2 && Object.keys(value.feature_definitions_v2).length
      ? {
          feature_definitions_v2: sortedRecord(
            value.feature_definitions_v2,
            orderedFeatureDefinitionV2,
          ),
        }
      : {}),
    parameters: sortedRecord(value.parameters, (parameter) => ({
      id: parameter.id,
      display_name: parameter.display_name,
      value: { kind: parameter.value.kind, value: parameter.value.value },
    })),
    topology_references: sortedRecord(value.topology_references, (reference) => ({
      schema_version: reference.schema_version,
      id: reference.id,
      component: reference.component,
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
