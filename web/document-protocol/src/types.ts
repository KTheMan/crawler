/** TypeScript mirror of crawler-document schema version 1. */

type StableId<Kind extends string> = string & { readonly __stableId: Kind };

export type DocumentId = StableId<"document">;
export type ComponentId = StableId<"component">;
export type BodyId = StableId<"body">;
export type SketchId = StableId<"sketch">;
export type FeatureId = StableId<"feature">;
export type RegionReferenceId = StableId<"region_reference">;
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
  region_definitions_v2?: Record<string, RegionDefinitionV2>;
  features: Record<string, Feature>;
  feature_definitions_v2?: Record<string, FeatureDefinitionV2>;
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
  producer_lineage?: FeatureId[];
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
    }
  | {
      kind: "external_line";
      id: string;
      start_nanometers: [JsonInteger, JsonInteger];
      end_nanometers: [JsonInteger, JsonInteger];
      body: BodyId;
      /** Decimal u64; JSON numbers cannot represent every kernel identity. */
      stable_kernel_id: string;
    }
  | {
      kind: "control_point_spline";
      id: string;
      degree: JsonInteger;
      control_points_nanometers: [JsonInteger, JsonInteger][];
      construction?: boolean;
    }
  | {
      kind: "fit_point_spline";
      id: string;
      fit_points_nanometers: [JsonInteger, JsonInteger][];
      construction?: boolean;
    }
  | {
      kind: "ellipse";
      id: string;
      center_nanometers: [JsonInteger, JsonInteger];
      major_nanometers: [JsonInteger, JsonInteger];
      minor_nanometers: [JsonInteger, JsonInteger];
      construction?: boolean;
    }
  | {
      kind: "elliptical_arc";
      id: string;
      center_nanometers: [JsonInteger, JsonInteger];
      major_nanometers: [JsonInteger, JsonInteger];
      minor_nanometers: [JsonInteger, JsonInteger];
      start_nanometers: [JsonInteger, JsonInteger];
      end_nanometers: [JsonInteger, JsonInteger];
      clockwise: boolean;
      construction?: boolean;
    }
  | {
      kind: "conic";
      id: string;
      start_nanometers: [JsonInteger, JsonInteger];
      control_nanometers: [JsonInteger, JsonInteger];
      end_nanometers: [JsonInteger, JsonInteger];
      weight_millionths: JsonInteger;
      construction?: boolean;
    }
  | {
      kind: "sketch_point";
      id: string;
      position_nanometers: [JsonInteger, JsonInteger];
      construction?: boolean;
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

export interface RegionDefinitionV2 {
  id: RegionReferenceId;
  sketch: SketchId;
  outer_geometry_ids: string[];
  hole_geometry_ids?: string[][];
}

export interface FeatureDefinitionV2 {
  schema_version: 2;
  operation: FeatureOperationV2;
  result: FeatureResultV2;
  participant_bodies?: ParticipantBodyReferenceV2[];
  required_capabilities: RequiredFeatureCapabilityV2[];
}

export type FeatureOperationV2 = {
  kind: "extrude";
  profile: { kind: "sketch_region"; sketch: SketchId; region: RegionReferenceId };
  support:
    | { kind: "origin_plane"; plane: string }
    | { kind: "construction_plane"; plane: string }
    | { kind: "topology_face"; reference: TopologyReferenceId };
  extent: {
    kind: "blind";
    distance: ParameterId;
    direction: "positive" | "negative" | "symmetric";
  };
  modifiers: "none";
};

export type FeatureResultV2 =
  | { mode: "new_body"; body: BodyId }
  | { mode: "cut" };

export interface ParticipantBodyReferenceV2 {
  role: "target";
  body: BodyId;
}

export type RequiredFeatureCapabilityV2 =
  | "exact_blind_new_body_extrude"
  | "exact_blind_cut_extrude";

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
  schema_version: 1;
  id: TopologyReferenceId;
  component: ComponentId;
  body: BodyId;
  producer: FeatureId;
  kind: TopologyKind;
  /** Decimal u64; JSON numbers cannot represent every kernel identity. */
  stable_kernel_id: string;
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
