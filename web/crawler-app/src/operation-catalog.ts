import catalogSource from "../../../contracts/operation-schema/catalog.v1.json?raw";

export type OperationValueKind =
  | "length_nanometers"
  | "angle_microdegrees"
  | "scalar_millionths"
  | "count"
  | "boolean"
  | "text";

export interface OperationParameter {
  key: string;
  label: string;
  value_kind: OperationValueKind;
  default: { kind: OperationValueKind; value: number | boolean | string };
  bounds: { minimum: number; maximum: number } | null;
  choices: string[];
  advanced_group: string | null;
}

export interface OperationInputSlot {
  key: string;
  label: string;
  allowed_kinds: string[];
  minimum_count: number;
  maximum_count: number | null;
}

export interface AlphaOperation {
  schema_version: number;
  id: string;
  label: string;
  group: "sketch" | "part_design" | "transform";
  output_kind: string;
  input_slots: OperationInputSlot[];
  parameters: OperationParameter[];
  preview: {
    strategy: string;
    debounce_milliseconds: number;
    cancellation: string;
  };
  lifecycle: {
    stage: string;
    supports_preview: boolean;
    supports_edit: boolean;
    supports_suppression: boolean;
  };
  enablement: {
    state: "enabled" | "disabled";
    capability: string;
    reason: string | null;
  };
}

interface AlphaOperationCatalog {
  catalog_version: number;
  operations: AlphaOperation[];
}

export const operationCatalog = JSON.parse(catalogSource) as AlphaOperationCatalog;
export const alphaOperations = operationCatalog.operations as readonly AlphaOperation[];

export function operationById(id: string): AlphaOperation {
  const operation = alphaOperations.find((candidate) => candidate.id === id);
  if (!operation) throw new Error(`operation catalog is missing ${id}`);
  return operation;
}

export function parameterByKey(operation: AlphaOperation, key: string): OperationParameter {
  const parameter = operation.parameters.find((candidate) => candidate.key === key);
  if (!parameter) throw new Error(`${operation.id} is missing parameter ${key}`);
  return parameter;
}

export function operationForFeatureType(type: string): AlphaOperation | undefined {
  if (type === "sketch") return operationById("crawler.sketch.rectangle");
  if (type === "pad" || type === "extrude") return operationById("crawler.part.extrude");
  const normalized = type.replaceAll("_", ".").replace(/^boolean\./, "boolean.");
  return alphaOperations.find((operation) => operation.id === `crawler.part.${normalized}`);
}

export function valueKindLabel(kind: OperationValueKind): string {
  return {
    length_nanometers: "Length · mm",
    angle_microdegrees: "Angle · degrees",
    scalar_millionths: "Scalar · 0–1",
    count: "Whole number",
    boolean: "Boolean",
    text: "Choice",
  }[kind];
}

export function displayDefault(parameter: OperationParameter): string {
  const value = parameter.default.value;
  if (typeof value !== "number") return typeof value === "boolean" ? (value ? "Yes" : "No") : value;
  if (parameter.value_kind === "length_nanometers") return `${value / 1_000_000} mm`;
  if (parameter.value_kind === "angle_microdegrees") return `${value / 1_000_000}°`;
  if (parameter.value_kind === "scalar_millionths") return String(value / 1_000_000);
  return String(value);
}

export function selectionCountLabel(slot: OperationInputSlot): string {
  if (slot.maximum_count === null) return slot.minimum_count === 0 ? "optional, any count" : `${slot.minimum_count}+ required`;
  if (slot.minimum_count === slot.maximum_count) return `${slot.minimum_count} required`;
  return `${slot.minimum_count}–${slot.maximum_count} required`;
}

export function lifecycleLabel(operation: AlphaOperation): string {
  const traits = [
    operation.lifecycle.supports_preview && "Preview",
    operation.lifecycle.supports_edit && "Editable",
    operation.lifecycle.supports_suppression && "Suppressible",
  ].filter(Boolean);
  return [operation.lifecycle.stage, ...traits].join(" · ");
}
