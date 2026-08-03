/** TypeScript mirror of crawler-document schema version 1. */

type StableId<Kind extends string> = string & { readonly __stableId: Kind };

export type DocumentId = StableId<"document">;
export type ComponentId = StableId<"component">;
export type BodyId = StableId<"body">;
export type SketchId = StableId<"sketch">;
export type FeatureId = StableId<"feature">;
export type ParameterId = StableId<"parameter">;
export type TopologyReferenceId = StableId<"topology_reference">;
export type TransactionId = StableId<"transaction">;

/** JSON integer. Version-1 fixtures require values to be JS safe integers. */
export type JsonInteger = number;

export interface Document {
  schema_version: 1;
  id: DocumentId;
  display_name: string;
  revision: JsonInteger;
  units: DocumentUnits;
  root_component: ComponentId;
  components: Record<string, Component>;
  bodies: Record<string, Body>;
  sketches: Record<string, Sketch>;
  features: Record<string, Feature>;
  parameters: Record<string, Parameter>;
  topology_references: Record<string, TopologyReference>;
  transactions: DocumentTransaction[];
  recompute: RecomputeState;
}

export type LengthUnit = "millimeter" | "centimeter" | "meter" | "inch" | "foot";
export type AngleUnit = "degree" | "radian";

export interface DocumentUnits {
  display_length: LengthUnit;
  display_angle: AngleUnit;
}

export interface Component {
  id: ComponentId;
  display_name: string;
  parent: ComponentId | null;
  child_components: ComponentId[];
  body_order: BodyId[];
  sketch_order: SketchId[];
  feature_order: FeatureId[];
  parameter_order: ParameterId[];
}

export interface Body {
  id: BodyId;
  display_name: string;
  component: ComponentId;
  generated_by: FeatureId;
  visibility: "visible" | "hidden";
}

export interface Sketch {
  id: SketchId;
  display_name: string;
  component: ComponentId;
  support: SketchSupport;
  elements: SketchElement[];
}

export type SketchSupport =
  | { kind: "origin_plane"; plane: "xy" | "xz" | "yz" }
  | { kind: "topology"; reference: TopologyReferenceId };

export type SketchElement =
  | {
      kind: "point";
      id: string;
      x_nanometers: JsonInteger;
      y_nanometers: JsonInteger;
    }
  | {
      kind: "line";
      id: string;
      start_element: string;
      end_element: string;
    };

export interface Feature {
  id: FeatureId;
  display_name: string;
  component: ComponentId;
  operation: OperationReference;
  inputs: Record<string, FeatureInput>;
  parameters: Record<string, ParameterId>;
  suppressed: boolean;
}

export interface OperationReference {
  schema_id: string;
  schema_version: JsonInteger;
}

export type FeatureInput =
  | { kind: "body"; id: BodyId }
  | { kind: "sketch"; id: SketchId }
  | { kind: "feature"; id: FeatureId }
  | { kind: "topology"; id: TopologyReferenceId };

export interface Parameter {
  id: ParameterId;
  display_name: string;
  value: ParameterValue;
}

export type ParameterValue =
  | { kind: "length_nanometers"; value: JsonInteger }
  | { kind: "angle_microdegrees"; value: JsonInteger }
  | { kind: "scalar_millionths"; value: JsonInteger }
  | { kind: "count"; value: JsonInteger }
  | { kind: "boolean"; value: boolean }
  | { kind: "text"; value: string };

export interface TopologyReference {
  id: TopologyReferenceId;
  body: BodyId;
  producer: FeatureId;
  kind: TopologyKind;
  stable_kernel_id: JsonInteger;
  stable_token: string;
  fallback_signature: TopologySignature;
}

export type TopologyKind = "vertex" | "edge" | "face" | "shell" | "solid";

export type TopologySignature =
  | { kind: "vertex"; position_nanometers: [JsonInteger, JsonInteger, JsonInteger] }
  | {
      kind: "edge";
      midpoint_nanometers: [JsonInteger, JsonInteger, JsonInteger];
      length_nanometers: JsonInteger;
    }
  | {
      kind: "face";
      centroid_nanometers: [JsonInteger, JsonInteger, JsonInteger];
      normal_millionths: [JsonInteger, JsonInteger, JsonInteger];
      area_square_nanometers: JsonInteger;
    };

export interface DocumentTransaction {
  id: TransactionId;
  base_revision: JsonInteger;
  result_revision: JsonInteger;
  changes: DocumentChange[];
}

export type DocumentChange =
  | { kind: "rename_entity"; entity: EntityId; display_name: string }
  | { kind: "set_parameter_value"; parameter: ParameterId; value: ParameterValue }
  | { kind: "set_feature_suppressed"; feature: FeatureId; suppressed: boolean }
  | {
      kind: "reorder_feature";
      component: ComponentId;
      feature: FeatureId;
      before: FeatureId | null;
    };

export type EntityId =
  | { kind: "document"; id: DocumentId }
  | { kind: "component"; id: ComponentId }
  | { kind: "body"; id: BodyId }
  | { kind: "sketch"; id: SketchId }
  | { kind: "feature"; id: FeatureId }
  | { kind: "parameter"; id: ParameterId };

export interface RecomputeState {
  accepted_revision: JsonInteger;
  features: Record<string, FeatureRecomputeState>;
}

export type FeatureRecomputeState =
  | { status: "clean"; evaluated_revision: JsonInteger }
  | { status: "dirty"; since_revision: JsonInteger }
  | {
      status: "failed";
      attempted_revision: JsonInteger;
      diagnostic_code: string;
    };

/** Process-local state; intentionally absent from `Document`. */
export interface TransientDocumentState {
  selected_entities: EntityId[];
  hovered_topology: TopologyReferenceId | null;
  active_recompute: ActiveRecompute | null;
  render_cache_keys: Record<string, string>;
}

export interface ActiveRecompute {
  target_revision: JsonInteger;
  completed_features: FeatureId[];
}
