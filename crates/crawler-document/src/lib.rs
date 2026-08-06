//! Versioned, persistence-safe contracts for Crawler parametric documents.
//!
//! The types in this crate are deliberately declarative. Geometry, UI state,
//! render data, evaluation machinery, and executable user code belong in other
//! crates. Ordered `Vec` fields describe presentation/evaluation order while
//! typed IDs remain stable when that order or an entity's display name changes.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// The only document schema understood by this crate.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub struct SchemaVersion(u32);

impl SchemaVersion {
    pub const V1: Self = Self(1);

    pub const fn get(self) -> u32 {
        self.0
    }
}

impl Serialize for SchemaVersion {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_u32(self.0)
    }
}

impl<'de> Deserialize<'de> for SchemaVersion {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let version = u32::deserialize(deserializer)?;
        match version {
            1 => Ok(Self::V1),
            unsupported => Err(serde::de::Error::custom(format!(
                "unsupported crawler document schema version {unsupported}"
            ))),
        }
    }
}

macro_rules! stable_id {
    ($name:ident) => {
        #[derive(Clone, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
        #[serde(transparent)]
        pub struct $name(pub String);

        impl From<&str> for $name {
            fn from(value: &str) -> Self {
                Self(value.to_owned())
            }
        }
    };
}

stable_id!(DocumentId);
stable_id!(ComponentId);
stable_id!(OriginPlaneId);
stable_id!(ConstructionPlaneId);
stable_id!(BodyId);
stable_id!(SketchId);
stable_id!(FeatureId);
stable_id!(ParameterId);
stable_id!(TopologyReferenceId);
stable_id!(TransactionId);

/// Semantic state persisted in a Crawler document.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Document {
    pub schema_version: SchemaVersion,
    pub id: DocumentId,
    pub display_name: String,
    pub revision: u64,
    pub units: DocumentUnits,
    pub root_component: ComponentId,
    /// Stable, addressable construction geometry. Older schema-v1 documents
    /// omitted this map; an empty map preserves their canonical bytes.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub origin_planes: BTreeMap<OriginPlaneId, OriginPlaneDefinition>,
    pub components: BTreeMap<ComponentId, Component>,
    pub bodies: BTreeMap<BodyId, Body>,
    pub sketches: BTreeMap<SketchId, Sketch>,
    pub features: BTreeMap<FeatureId, Feature>,
    pub parameters: BTreeMap<ParameterId, Parameter>,
    pub topology_references: BTreeMap<TopologyReferenceId, TopologyReference>,
    pub transactions: Vec<DocumentTransaction>,
    pub recompute: RecomputeState,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LengthUnit {
    Millimeter,
    Centimeter,
    Meter,
    Inch,
    Foot,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AngleUnit {
    Degree,
    Radian,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DocumentUnits {
    /// Display preference only. Stored dimensional values use fixed base units.
    pub display_length: LengthUnit,
    pub display_angle: AngleUnit,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Component {
    pub id: ComponentId,
    pub display_name: String,
    pub parent: Option<ComponentId>,
    /// Storage/order is explicit and is not encoded into an entity ID.
    pub child_components: Vec<ComponentId>,
    pub body_order: Vec<BodyId>,
    pub sketch_order: Vec<SketchId>,
    pub feature_order: Vec<FeatureId>,
    pub parameter_order: Vec<ParameterId>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct OriginPlaneDefinition {
    pub id: OriginPlaneId,
    pub component: ComponentId,
    pub plane: OriginPlane,
    pub normal_millionths: [i64; 3],
    pub x_axis_millionths: [i64; 3],
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Body {
    pub id: BodyId,
    pub display_name: String,
    pub component: ComponentId,
    pub generated_by: FeatureId,
    pub visibility: ModelVisibility,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelVisibility {
    Visible,
    Hidden,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Sketch {
    pub id: SketchId,
    pub display_name: String,
    pub component: ComponentId,
    pub support: SketchSupport,
    pub elements: Vec<SketchElement>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub constraints: Vec<SketchConstraint>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub dimension_positions: BTreeMap<String, [i64; 2]>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub recipes: BTreeMap<String, SketchRecipe>,
    /// Canonical crawler-sketch operation records are retained verbatim so
    /// new associative modifiers can round-trip without duplicating their
    /// geometric contract in the document crate.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub operations: BTreeMap<String, serde_json::Value>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum SketchRecipe {
    Polygon {
        #[serde(default, skip_serializing_if = "String::is_empty")]
        mode: String,
        center_nanometers: [i64; 2],
        radius_nanometers: i64,
        sides: u32,
        orientation_microdegrees: i64,
        geometry: Vec<String>,
    },
    Slot {
        #[serde(default, skip_serializing_if = "String::is_empty")]
        mode: String,
        first_nanometers: [i64; 2],
        second_nanometers: [i64; 2],
        #[serde(default, skip_serializing_if = "Option::is_none")]
        center_arc_nanometers: Option<[i64; 2]>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        through_nanometers: Option<[i64; 2]>,
        radius_nanometers: i64,
        geometry: Vec<String>,
    },
    Text {
        text: String,
        origin_nanometers: [i64; 2],
        height_nanometers: i64,
        rotation_microdegrees: i64,
        tracking_millionths: i64,
        horizontal_alignment: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        path: Option<String>,
        #[serde(default)]
        path_start_millionths: u32,
        #[serde(default)]
        reversed: bool,
        geometry: Vec<String>,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SketchSupport {
    OriginPlane {
        plane: OriginPlane,
    },
    OriginPlaneReference {
        plane: OriginPlaneId,
    },
    Topology {
        reference: TopologyReferenceId,
    },
    /// Stable reference reserved for document-owned construction plane
    /// definitions (offset, angled, tangent, and future datum forms). The
    /// referenced definition is resolved by the modeling/kernel layer rather
    /// than by the strictly two-dimensional sketch solver.
    ConstructionPlaneReference {
        plane: ConstructionPlaneId,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OriginPlane {
    Xy,
    Xz,
    Yz,
}

/// Declarative sketch data. Element IDs are stable within the owning sketch.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SketchElement {
    Point {
        id: String,
        x_nanometers: i64,
        y_nanometers: i64,
    },
    Line {
        id: String,
        start_element: String,
        end_element: String,
    },
    Circle {
        id: String,
        center_nanometers: [i64; 2],
        radius_nanometers: i64,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        construction: bool,
    },
    Arc {
        id: String,
        center_nanometers: [i64; 2],
        start_nanometers: [i64; 2],
        end_nanometers: [i64; 2],
        clockwise: bool,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        construction: bool,
    },
    Rectangle {
        id: String,
        min_nanometers: [i64; 2],
        max_nanometers: [i64; 2],
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        construction: bool,
    },
    ControlPointSpline {
        id: String,
        degree: u8,
        control_points_nanometers: Vec<[i64; 2]>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        knots_millionths: Vec<u32>,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        construction: bool,
    },
    FitPointSpline {
        id: String,
        fit_points_nanometers: Vec<[i64; 2]>,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        construction: bool,
    },
    Ellipse {
        id: String,
        center_nanometers: [i64; 2],
        major_nanometers: [i64; 2],
        minor_nanometers: [i64; 2],
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        construction: bool,
    },
    EllipticalArc {
        id: String,
        center_nanometers: [i64; 2],
        major_nanometers: [i64; 2],
        minor_nanometers: [i64; 2],
        start_nanometers: [i64; 2],
        end_nanometers: [i64; 2],
        clockwise: bool,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        construction: bool,
    },
    Conic {
        id: String,
        start_nanometers: [i64; 2],
        control_nanometers: [i64; 2],
        end_nanometers: [i64; 2],
        weight_millionths: i64,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        construction: bool,
    },
    SketchPoint {
        id: String,
        position_nanometers: [i64; 2],
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        construction: bool,
    },
    ConstructionLine {
        id: String,
        start_nanometers: [i64; 2],
        end_nanometers: [i64; 2],
    },
    LineSegment {
        id: String,
        start_nanometers: [i64; 2],
        end_nanometers: [i64; 2],
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        construction: bool,
    },
    ExternalLine {
        id: String,
        start_nanometers: [i64; 2],
        end_nanometers: [i64; 2],
        body: BodyId,
        #[serde(with = "decimal_u64")]
        stable_kernel_id: u64,
    },
}

/// Exact declarative sketch intent. Constraint IDs and element IDs are stable
/// within the owning sketch; dimensional constraints reference shared document
/// parameters rather than copying numeric values.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SketchConstraint {
    Suppressed {
        id: String,
        constraint: Box<SketchConstraint>,
    },
    Coincident {
        id: String,
        first_point: String,
        second_point: String,
    },
    Horizontal {
        id: String,
        line: String,
    },
    Vertical {
        id: String,
        line: String,
    },
    HorizontalPoints {
        id: String,
        first_point: String,
        second_point: String,
    },
    VerticalPoints {
        id: String,
        first_point: String,
        second_point: String,
    },
    Collinear {
        id: String,
        point: String,
        line: String,
    },
    Symmetry {
        id: String,
        first_point: String,
        second_point: String,
        axis: String,
    },
    CurvatureContinuous {
        id: String,
        first: String,
        second: String,
    },
    DistanceX {
        id: String,
        start_point: String,
        end_point: String,
        parameter: ParameterId,
    },
    DistanceY {
        id: String,
        start_point: String,
        end_point: String,
        parameter: ParameterId,
    },
    PointOnOrigin {
        id: String,
        point: String,
    },
    Fixed {
        id: String,
        point: String,
    },
    FixedGeometry {
        id: String,
        geometry: String,
    },
    Midpoint {
        id: String,
        point: String,
        line: String,
    },
    Concentric {
        id: String,
        first: String,
        second: String,
    },
    PointOnObject {
        id: String,
        point: String,
        geometry: String,
    },
    Parallel {
        id: String,
        first: String,
        second: String,
    },
    Perpendicular {
        id: String,
        first: String,
        second: String,
    },
    Tangent {
        id: String,
        first: String,
        second: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        first_parameter_millionths: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        second_parameter_millionths: Option<u32>,
    },
    Equal {
        id: String,
        first: String,
        second: String,
    },
    Distance {
        id: String,
        first: String,
        second: String,
        parameter: ParameterId,
    },
    PointLineDistance {
        id: String,
        point: String,
        line: String,
        parameter: ParameterId,
    },
    LineDistance {
        id: String,
        first: String,
        second: String,
        parameter: ParameterId,
    },
    OffsetDistance {
        id: String,
        source: String,
        offset: String,
        source_start_millionths: u32,
        source_end_millionths: u32,
        parameter: ParameterId,
    },
    Radius {
        id: String,
        geometry: String,
        parameter: ParameterId,
    },
    Diameter {
        id: String,
        geometry: String,
        parameter: ParameterId,
    },
    EllipseRadius {
        id: String,
        geometry: String,
        axis: String,
        parameter: ParameterId,
    },
    Angle {
        id: String,
        first: String,
        second: String,
        parameter: ParameterId,
    },
    AngleToAxis {
        id: String,
        line: String,
        axis: String,
        parameter: ParameterId,
    },
    DistanceLiteral {
        id: String,
        first: String,
        second: String,
        distance_nanometers: i64,
    },
    DistanceXLiteral {
        id: String,
        first: String,
        second: String,
        distance_nanometers: i64,
    },
    DistanceYLiteral {
        id: String,
        first: String,
        second: String,
        distance_nanometers: i64,
    },
    PointLineDistanceLiteral {
        id: String,
        point: String,
        line: String,
        distance_nanometers: i64,
    },
    LineDistanceLiteral {
        id: String,
        first: String,
        second: String,
        distance_nanometers: i64,
    },
    OffsetDistanceLiteral {
        id: String,
        source: String,
        offset: String,
        source_start_millionths: u32,
        source_end_millionths: u32,
        distance_nanometers: i64,
    },
    RadiusLiteral {
        id: String,
        geometry: String,
        radius_nanometers: i64,
    },
    DiameterLiteral {
        id: String,
        geometry: String,
        diameter_nanometers: i64,
    },
    EllipseRadiusLiteral {
        id: String,
        geometry: String,
        axis: String,
        radius_nanometers: i64,
    },
    AngleLiteral {
        id: String,
        first: String,
        second: String,
        angle_microdegrees: i64,
    },
    AngleToAxisLiteral {
        id: String,
        line: String,
        axis: String,
        angle_microdegrees: i64,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Feature {
    pub id: FeatureId,
    pub display_name: String,
    pub component: ComponentId,
    pub operation: OperationReference,
    /// Explicit graph edges evaluated before this feature.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub dependencies: Vec<FeatureId>,
    pub inputs: BTreeMap<String, FeatureInput>,
    pub parameters: BTreeMap<String, ParameterId>,
    pub suppressed: bool,
}

/// A declarative reference to a separately defined operation schema.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct OperationReference {
    pub schema_id: String,
    pub schema_version: u32,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", content = "id", rename_all = "snake_case")]
pub enum FeatureInput {
    Body(BodyId),
    Sketch(SketchId),
    Feature(FeatureId),
    Topology(TopologyReferenceId),
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Parameter {
    pub id: ParameterId,
    pub display_name: String,
    pub value: ParameterValue,
}

/// Exact, language-neutral values; no source text is executable.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum ParameterValue {
    LengthNanometers(i64),
    AngleMicrodegrees(i64),
    ScalarMillionths(i64),
    Count(u64),
    Boolean(bool),
    Text(String),
}

/// Stored expression text plus a structural, rename-safe expression tree.
/// Literal nodes use the same exact base-unit values as ordinary parameters.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ParameterExpression {
    pub source: String,
    pub root: ParameterExpressionNode,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ParameterExpressionNode {
    Literal { value: ParameterValue },
    Parameter { id: ParameterId },
    Add { left: Box<Self>, right: Box<Self> },
    Subtract { left: Box<Self>, right: Box<Self> },
    Multiply { value: Box<Self>, scalar: Box<Self> },
    Divide { value: Box<Self>, scalar: Box<Self> },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TopologyReference {
    pub id: TopologyReferenceId,
    pub body: BodyId,
    pub producer: FeatureId,
    pub kind: TopologyKind,
    /// Kernel-assigned identity persisted across serialization, never an array index.
    #[serde(with = "decimal_u64")]
    pub stable_kernel_id: u64,
    /// Semantic identity assigned by the feature's topology-naming policy.
    pub stable_token: String,
    /// Deterministic geometric evidence used only to diagnose and repair a missing identity.
    pub fallback_signature: TopologySignature,
}

/// JSON has no lossless unsigned 64-bit numeric representation in JavaScript.
/// Emit kernel identities as decimal strings while continuing to accept legacy
/// numeric documents whose values were already in range.
mod decimal_u64 {
    use serde::{Deserialize, Deserializer, Serializer};

    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Repr {
        Decimal(String),
        Legacy(u64),
    }

    pub fn serialize<S>(value: &u64, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&value.to_string())
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<u64, D::Error>
    where
        D: Deserializer<'de>,
    {
        match Repr::deserialize(deserializer)? {
            Repr::Decimal(value) => value.parse().map_err(serde::de::Error::custom),
            Repr::Legacy(value) => Ok(value),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TopologyKind {
    Vertex,
    Edge,
    Face,
    Shell,
    Solid,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TopologySignature {
    Vertex {
        position_nanometers: [i64; 3],
    },
    Edge {
        midpoint_nanometers: [i64; 3],
        length_nanometers: u64,
    },
    Face {
        centroid_nanometers: [i64; 3],
        normal_millionths: [i64; 3],
        area_square_nanometers: u64,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DocumentTransaction {
    pub id: TransactionId,
    pub base_revision: u64,
    pub result_revision: u64,
    /// Changes are applied atomically in this order.
    pub changes: Vec<DocumentChange>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DocumentChange {
    CreatePart {
        component: ComponentId,
        sketch: SketchId,
        feature: FeatureId,
        body: BodyId,
    },
    CreateParameter {
        component: ComponentId,
        parameter: Parameter,
    },
    RenameEntity {
        entity: EntityId,
        display_name: String,
    },
    SetParameterValue {
        parameter: ParameterId,
        value: ParameterValue,
    },
    SetFeatureSuppressed {
        feature: FeatureId,
        suppressed: bool,
    },
    ReorderFeature {
        component: ComponentId,
        feature: FeatureId,
        before: Option<FeatureId>,
    },
    UpsertSketch {
        sketch: Sketch,
    },
    ApplySketchSolution {
        sketch: Sketch,
        solve_state: String,
        degrees_of_freedom: u32,
        conflicts: Vec<String>,
    },
    CreateFeature {
        feature: Feature,
        before: Option<FeatureId>,
    },
    EditFeature {
        feature: Feature,
    },
    DeleteFeature {
        component: ComponentId,
        feature: FeatureId,
    },
    GroupFeatures {
        group_id: String,
        display_name: String,
        features: Vec<FeatureId>,
    },
    SetBodyVisibility {
        body: BodyId,
        visibility: ModelVisibility,
    },
    UpsertTopologyReference {
        reference: TopologyReference,
    },
    SetParameterExpression {
        parameter: ParameterId,
        expression: ParameterExpression,
        evaluated_value: ParameterValue,
    },
    RebindTopology {
        feature: FeatureId,
        input_name: String,
        from_reference: TopologyReferenceId,
        replacement: TopologyReference,
    },
    AcceptFeatureResult {
        feature: FeatureId,
        body: BodyId,
        request_json: String,
        result_json: String,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", content = "id", rename_all = "snake_case")]
pub enum EntityId {
    Document(DocumentId),
    Component(ComponentId),
    Body(BodyId),
    Sketch(SketchId),
    Feature(FeatureId),
    Parameter(ParameterId),
}

/// Durable recompute facts associated with the accepted document revision.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RecomputeState {
    pub accepted_revision: u64,
    pub features: BTreeMap<FeatureId, FeatureRecomputeState>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum FeatureRecomputeState {
    Clean {
        evaluated_revision: u64,
    },
    Dirty {
        since_revision: u64,
    },
    Failed {
        attempted_revision: u64,
        diagnostic_code: String,
    },
}

/// Process-local state. This type intentionally has no serialization traits.
#[derive(Debug, Default)]
pub struct TransientDocumentState {
    pub selected_entities: Vec<EntityId>,
    pub hovered_topology: Option<TopologyReferenceId>,
    pub active_recompute: Option<ActiveRecompute>,
    pub render_cache_keys: BTreeMap<BodyId, String>,
}

/// In-flight evaluation details that must never enter semantic saves.
#[derive(Debug)]
pub struct ActiveRecompute {
    pub target_revision: u64,
    pub completed_features: Vec<FeatureId>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unsupported_schema_versions_fail_closed() {
        let fixture = include_str!("../tests/fixtures/minimal-document.json");
        let unsupported = fixture.replacen("\"schema_version\":1", "\"schema_version\":2", 1);
        let error = serde_json::from_str::<Document>(&unsupported).unwrap_err();
        assert!(
            error
                .to_string()
                .contains("unsupported crawler document schema version 2")
        );
    }

    #[test]
    fn identity_is_independent_of_name_and_feature_order() {
        let fixture = include_str!("../tests/fixtures/parametric-block.json");
        let mut document: Document = serde_json::from_str(fixture.trim_end()).unwrap();
        let id = FeatureId::from("feature:extrude");
        let feature = document.features.get_mut(&id).unwrap();
        feature.display_name = "Renamed extrusion".into();
        document
            .components
            .get_mut(&ComponentId::from("component:root"))
            .unwrap()
            .feature_order
            .reverse();
        assert!(document.features.contains_key(&id));
        assert_eq!(document.features[&id].id, id);
    }

    #[test]
    fn construction_plane_sketch_support_is_a_stable_reference_contract() {
        let support = SketchSupport::ConstructionPlaneReference {
            plane: ConstructionPlaneId::from("construction-plane:offset-1"),
        };
        let json = serde_json::to_string(&support).unwrap();
        assert_eq!(
            json,
            r#"{"kind":"construction_plane_reference","plane":"construction-plane:offset-1"}"#
        );
        assert_eq!(
            serde_json::from_str::<SketchSupport>(&json).unwrap(),
            support
        );
    }

    #[test]
    fn topology_kernel_ids_cross_json_as_lossless_decimal_u64_strings() {
        let reference = TopologyReference {
            id: TopologyReferenceId::from("topology:max-face"),
            body: BodyId::from("body:max-face"),
            producer: FeatureId::from("feature:max-face"),
            kind: TopologyKind::Face,
            stable_kernel_id: u64::MAX - 1,
            stable_token: "face:max".into(),
            fallback_signature: TopologySignature::Face {
                centroid_nanometers: [0, 0, 0],
                normal_millionths: [0, 0, 1_000_000],
                area_square_nanometers: 1,
            },
        };
        let json = serde_json::to_string(&reference).unwrap();
        assert!(json.contains(r#""stable_kernel_id":"18446744073709551614""#));
        assert_eq!(
            serde_json::from_str::<TopologyReference>(&json).unwrap(),
            reference
        );

        let legacy = json.replace(
            r#""stable_kernel_id":"18446744073709551614""#,
            r#""stable_kernel_id":42"#,
        );
        assert_eq!(
            serde_json::from_str::<TopologyReference>(&legacy)
                .unwrap()
                .stable_kernel_id,
            42
        );
    }
}
