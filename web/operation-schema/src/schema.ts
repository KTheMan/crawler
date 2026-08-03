import type {
  InspectorForm,
  InspectorParameterField,
  OperationCatalog,
  OperationInvocation,
  OperationSchema,
  OperationWorkerCommand,
  ParameterValue,
} from "./types.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const selectionKinds = new Set([
  "sketch_entity",
  "sketch_curve",
  "sketch_point",
  "sketch_profile",
  "body",
  "feature",
  "vertex",
  "edge",
  "face",
  "plane",
  "axis",
]);
const valueKinds = new Set([
  "length_nanometers",
  "angle_microdegrees",
  "scalar_millionths",
  "count",
  "boolean",
  "text",
]);
const defaultLifecycle = {
  stage: "alpha",
  supports_preview: true,
  supports_edit: true,
  supports_suppression: true,
} as const;
const defaultEnablement = {
  state: "enabled",
  capability: "legacy.contract",
  reason: null,
} as const;

const requireRecord = (value: unknown, path: string): Record<string, unknown> => {
  if (!isRecord(value)) throw new TypeError(`${path} must be an object`);
  return value;
};

const validateSchemaShape = (value: Record<string, unknown>): OperationSchema => {
  if (value.schema_version !== 1) {
    throw new TypeError(
      `unsupported crawler operation schema version ${String(value.schema_version)}; supported version is 1`,
    );
  }
  if (
    typeof value.id !== "string" ||
    typeof value.label !== "string" ||
    !["sketch", "part_design", "transform", "import_export"].includes(String(value.group)) ||
    !["sketch", "body", "bodies", "transform", "file"].includes(String(value.output_kind)) ||
    !Array.isArray(value.input_slots) ||
    !Array.isArray(value.parameters) ||
    !isRecord(value.preview)
  ) {
    throw new TypeError("crawler operation schema is missing required fields");
  }
  for (const [index, rawSlot] of value.input_slots.entries()) {
    const slot = requireRecord(rawSlot, `input_slots.${index}`);
    if (
      typeof slot.key !== "string" ||
      !Array.isArray(slot.allowed_kinds) ||
      slot.allowed_kinds.length === 0 ||
      slot.allowed_kinds.some((kind) => typeof kind !== "string" || !selectionKinds.has(kind)) ||
      !Number.isInteger(slot.minimum_count) ||
      (slot.maximum_count !== null && !Number.isInteger(slot.maximum_count))
    ) {
      throw new TypeError(`input_slots.${index} has an invalid selection contract`);
    }
    if (
      typeof slot.maximum_count === "number" &&
      slot.maximum_count < (slot.minimum_count as number)
    ) {
      throw new TypeError(`input_slots.${index}.maximum_count is less than minimum_count`);
    }
  }
  const parameterKeys = new Set<string>();
  for (const [index, rawParameter] of value.parameters.entries()) {
    const parameter = requireRecord(rawParameter, `parameters.${index}`);
    const parameterValue = requireRecord(parameter.default, `parameters.${index}.default`);
    if (
      typeof parameter.key !== "string" ||
      parameterKeys.has(parameter.key) ||
      typeof parameter.value_kind !== "string" ||
      !valueKinds.has(parameter.value_kind) ||
      parameterValue.kind !== parameter.value_kind ||
      !Array.isArray(parameter.choices)
    ) {
      throw new TypeError(`parameters.${index} has an invalid quantity contract`);
    }
    parameterKeys.add(parameter.key);
    if (parameter.value_kind === "boolean" && typeof parameterValue.value !== "boolean") {
      throw new TypeError(`parameters.${index}.default must be boolean`);
    }
    if (parameter.value_kind === "text" && typeof parameterValue.value !== "string") {
      throw new TypeError(`parameters.${index}.default must be text`);
    }
    if (
      parameter.value_kind !== "boolean" &&
      parameter.value_kind !== "text" &&
      !Number.isSafeInteger(parameterValue.value)
    ) {
      throw new TypeError(`parameters.${index}.default must be a safe integer quantity`);
    }
    if (isRecord(parameter.bounds) && typeof parameterValue.value === "number") {
      if (
        (typeof parameter.bounds.minimum === "number" &&
          parameterValue.value < parameter.bounds.minimum) ||
        (typeof parameter.bounds.maximum === "number" &&
          parameterValue.value > parameter.bounds.maximum)
      ) {
        throw new TypeError(`parameters.${index}.default is outside its bounds`);
      }
    }
    if (
      parameter.value_kind === "text" &&
      parameter.choices.length > 0 &&
      !parameter.choices.includes(parameterValue.value)
    ) {
      throw new TypeError(`parameters.${index}.default is not an allowed choice`);
    }
  }
  const normalized = {
    ...value,
    lifecycle: value.lifecycle ?? defaultLifecycle,
    enablement: value.enablement ?? defaultEnablement,
  } as unknown as OperationSchema;
  if (
    normalized.preview.strategy !== "none" &&
    normalized.preview.strategy !== "immediate" &&
    normalized.preview.strategy !== "debounced" &&
    normalized.preview.strategy !== "explicit"
  ) {
    throw new TypeError("preview.strategy is invalid");
  }
  if (
    !Number.isInteger(normalized.preview.debounce_milliseconds) ||
    !["not_cancellable", "cooperative", "replace_older_preview"].includes(
      normalized.preview.cancellation,
    )
  ) {
    throw new TypeError("preview lifecycle is invalid");
  }
  if (
    normalized.lifecycle.stage !== "alpha" ||
    typeof normalized.lifecycle.supports_preview !== "boolean" ||
    typeof normalized.lifecycle.supports_edit !== "boolean" ||
    typeof normalized.lifecycle.supports_suppression !== "boolean"
  ) {
    throw new TypeError("operation lifecycle metadata is invalid");
  }
  if (
    (normalized.enablement.state !== "enabled" && normalized.enablement.state !== "disabled") ||
    typeof normalized.enablement.capability !== "string" ||
    (normalized.enablement.reason !== null && typeof normalized.enablement.reason !== "string")
  ) {
    throw new TypeError("operation enablement metadata is invalid");
  }
  if (
    normalized.enablement.state === "disabled" &&
    (!normalized.enablement.reason || normalized.enablement.reason.trim().length === 0)
  ) {
    throw new TypeError("disabled operation requires a product-readable reason");
  }
  return normalized;
};

/** Parse the shared operation contract. Unsupported versions fail closed. */
export function parseOperationSchema(json: string): OperationSchema {
  const value: unknown = JSON.parse(json);
  if (!isRecord(value)) throw new TypeError("crawler operation schema must be a JSON object");
  return validateSchemaShape(value);
}

/** Parse and cross-check the generated alpha catalog mirror. */
export function parseOperationCatalog(json: string): OperationCatalog {
  const value = requireRecord(JSON.parse(json), "crawler operation catalog");
  if (value.catalog_version !== 1) {
    throw new TypeError(`unsupported crawler operation catalog version ${String(value.catalog_version)}`);
  }
  if (!Array.isArray(value.capabilities) || !Array.isArray(value.operations)) {
    throw new TypeError("crawler operation catalog is missing required fields");
  }
  const capabilities = new Map<string, { state: string; reason: unknown }>();
  for (const [index, rawCapability] of value.capabilities.entries()) {
    const capability = requireRecord(rawCapability, `capabilities.${index}`);
    if (
      typeof capability.id !== "string" ||
      capabilities.has(capability.id) ||
      (capability.state !== "qualified" && capability.state !== "unavailable") ||
      (capability.reason !== null && typeof capability.reason !== "string")
    ) {
      throw new TypeError(`capabilities.${index} has an invalid capability state`);
    }
    if (
      (capability.state === "unavailable" &&
        (typeof capability.reason !== "string" || capability.reason.trim().length === 0)) ||
      (capability.state === "qualified" && capability.reason !== null)
    ) {
      throw new TypeError(`capabilities.${index} reason does not match its state`);
    }
    capabilities.set(capability.id, capability as { state: string; reason: unknown });
  }
  const operations = value.operations.map((operation, index) =>
    validateSchemaShape(requireRecord(operation, `operations.${index}`)),
  );
  const ids = new Set<string>();
  for (const operation of operations) {
    if (ids.has(operation.id)) throw new TypeError(`duplicate operation id ${operation.id}`);
    ids.add(operation.id);
    const capability = capabilities.get(operation.enablement.capability);
    if (!capability) throw new TypeError(`unknown operation capability ${operation.enablement.capability}`);
    const expectedState = capability.state === "qualified" ? "enabled" : "disabled";
    if (
      operation.enablement.state !== expectedState ||
      operation.enablement.reason !== capability.reason
    ) {
      throw new TypeError(`operation ${operation.id} enablement is not derived from capability state`);
    }
  }
  return { ...value, operations } as unknown as OperationCatalog;
}

/** Serialize in the same stable order and formatting as the Rust generator. */
export function serializeOperationCatalog(catalog: OperationCatalog): string {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

const fieldPresentation = (
  parameter: OperationSchema["parameters"][number],
): Pick<InspectorParameterField, "control" | "unit"> => {
  if (parameter.choices.length > 0) return { control: "select", unit: null };
  switch (parameter.value_kind) {
    case "boolean":
      return { control: "checkbox", unit: null };
    case "text":
      return { control: "text", unit: null };
    case "length_nanometers":
      return { control: "number", unit: "length" };
    case "angle_microdegrees":
      return { control: "number", unit: "angle" };
    case "scalar_millionths":
      return { control: "number", unit: "scalar" };
    case "count":
      return { control: "number", unit: null };
  }
};

/** Generate an inspector model directly from the operation schema. */
export function createInspectorForm(schema: OperationSchema, operationId: string): InspectorForm {
  return {
    operation_id: operationId,
    label: schema.label,
    input_fields: schema.input_slots.map((slot) => ({ ...slot, control: "selection" })),
    parameter_fields: schema.parameters.map((parameter) => ({
      ...parameter,
      ...fieldPresentation(parameter),
    })),
    preview: { ...schema.preview },
  };
}

export function defaultParameters(schema: OperationSchema): Record<string, ParameterValue> {
  return Object.fromEntries(
    schema.parameters.map((parameter) => [parameter.key, structuredClone(parameter.default)]),
  );
}

/** Create the versioned worker payload from the same definition used by the inspector. */
export function createWorkerCommand(
  schema: OperationSchema,
  invocation: OperationInvocation,
): OperationWorkerCommand {
  if (invocation.schema_id !== schema.id || invocation.schema_version !== schema.schema_version) {
    throw new TypeError(
      `unsupported operation invocation ${invocation.schema_id}@${invocation.schema_version}`,
    );
  }
  if (schema.enablement.state === "disabled") {
    throw new TypeError(schema.enablement.reason ?? `operation ${schema.id} is disabled`);
  }
  for (const key of Object.keys(invocation.inputs)) {
    if (!schema.input_slots.some((slot) => slot.key === key)) {
      throw new TypeError(`unknown operation input ${key}`);
    }
  }
  for (const slot of schema.input_slots) {
    const selections = invocation.inputs[slot.key] ?? [];
    if (selections.length < slot.minimum_count) {
      throw new TypeError(`missing required operation input ${slot.key}`);
    }
    if (slot.maximum_count !== null && selections.length > slot.maximum_count) {
      throw new TypeError(`too many selections for operation input ${slot.key}`);
    }
    if (selections.some((selection) => !slot.allowed_kinds.includes(selection.kind))) {
      throw new TypeError(`invalid selection kind for operation input ${slot.key}`);
    }
  }
  for (const key of Object.keys(invocation.parameters)) {
    if (!schema.parameters.some((parameter) => parameter.key === key)) {
      throw new TypeError(`unknown operation parameter ${key}`);
    }
  }
  for (const parameter of schema.parameters) {
    const value = invocation.parameters[parameter.key];
    if (!value) throw new TypeError(`missing required operation parameter ${parameter.key}`);
    if (value.kind !== parameter.value_kind) {
      throw new TypeError(`invalid type for operation parameter ${parameter.key}`);
    }
    if (typeof value.value === "number" && parameter.bounds) {
      if (
        (parameter.bounds.minimum !== null && value.value < parameter.bounds.minimum) ||
        (parameter.bounds.maximum !== null && value.value > parameter.bounds.maximum)
      ) {
        throw new TypeError(`operation parameter ${parameter.key} is outside its bounds`);
      }
    }
    if (value.kind === "text" && parameter.choices.length > 0 && !parameter.choices.includes(value.value)) {
      throw new TypeError(`operation parameter ${parameter.key} is not an allowed choice`);
    }
  }
  return { ...invocation, cancellation: schema.preview.cancellation };
}
