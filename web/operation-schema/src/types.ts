export type SelectionKind =
  | "sketch_entity"
  | "sketch_curve"
  | "sketch_point"
  | "sketch_profile"
  | "body"
  | "feature"
  | "vertex"
  | "edge"
  | "face"
  | "plane"
  | "axis";

export type ParameterValue =
  | { kind: "length_nanometers"; value: number }
  | { kind: "angle_microdegrees"; value: number }
  | { kind: "scalar_millionths"; value: number }
  | { kind: "count"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "text"; value: string };

export interface OperationSchema {
  schema_version: 1;
  id: string;
  label: string;
  group: "sketch" | "part_design" | "transform" | "import_export";
  output_kind: "sketch" | "body" | "bodies" | "transform" | "file";
  input_slots: InputSlotSchema[];
  parameters: ParameterSchema[];
  preview: PreviewSchema;
  lifecycle: LifecycleSchema;
  enablement: EnablementSchema;
}

export interface OperationCatalog {
  catalog_version: 1;
  capabilities: CapabilitySchema[];
  operations: OperationSchema[];
}

export interface CapabilitySchema {
  id: string;
  state: "qualified" | "unavailable";
  reason: string | null;
}

export interface LifecycleSchema {
  stage: "alpha";
  supports_preview: boolean;
  supports_edit: boolean;
  supports_suppression: boolean;
}

export interface EnablementSchema {
  state: "enabled" | "disabled";
  capability: string;
  reason: string | null;
}

export interface InputSlotSchema {
  key: string;
  label: string;
  allowed_kinds: SelectionKind[];
  minimum_count: number;
  maximum_count: number | null;
}

export interface ParameterSchema {
  key: string;
  label: string;
  value_kind: ParameterValue["kind"];
  default: ParameterValue;
  bounds: { minimum: number | null; maximum: number | null } | null;
  choices: string[];
  advanced_group: string | null;
}

export interface PreviewSchema {
  strategy: "none" | "immediate" | "debounced" | "explicit";
  debounce_milliseconds: number;
  cancellation: "not_cancellable" | "cooperative" | "replace_older_preview";
}

export interface InputSelection {
  kind: SelectionKind;
  entity_id: string;
}

export interface OperationInvocation {
  operation_id: string;
  schema_id: string;
  schema_version: number;
  inputs: Record<string, InputSelection[]>;
  parameters: Record<string, ParameterValue>;
  preview_generation: number;
}

export interface OperationWorkerCommand extends OperationInvocation {
  cancellation: PreviewSchema["cancellation"];
}

export interface InspectorForm {
  operation_id: string;
  label: string;
  input_fields: InspectorInputField[];
  parameter_fields: InspectorParameterField[];
  preview: PreviewSchema;
}

export interface InspectorInputField extends InputSlotSchema {
  control: "selection";
}

export interface InspectorParameterField extends ParameterSchema {
  control: "number" | "checkbox" | "select" | "text";
  unit: "length" | "angle" | "scalar" | null;
}

export type ErrorCode =
  | "operation_disabled"
  | "incompatible_schema"
  | "missing_input"
  | "invalid_input_count"
  | "invalid_input_kind"
  | "unknown_input"
  | "missing_parameter"
  | "invalid_parameter_type"
  | "parameter_out_of_bounds"
  | "invalid_choice"
  | "unknown_parameter";

export interface OperationError {
  code: ErrorCode;
  operation: { schema_id: string; operation_id: string };
  location:
    | { kind: "operation" }
    | { kind: "input"; key: string }
    | { kind: "parameter"; key: string };
  recoverability:
    | "retry_after_edit"
    | "reselect_input"
    | "upgrade_required"
    | "not_recoverable";
  message: string;
  user_actions: Array<{
    kind:
      | "focus_input"
      | "focus_parameter"
      | "upgrade_document"
      | "retry"
      | "view_capability";
    label: string;
    target: string;
  }>;
}
