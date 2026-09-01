//! Versioned, persistence-safe contracts for Crawler parametric documents.
//!
//! The types in this crate are deliberately declarative. Geometry, UI state,
//! render data, evaluation machinery, and executable user code belong in other
//! crates. Ordered `Vec` fields describe presentation/evaluation order while
//! typed IDs remain stable when that order or an entity's display name changes.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fmt::{self, Display, Formatter};

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
stable_id!(RegionReferenceId);
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
    /// Stable, component-owned datum planes. Their exact definitions retain
    /// typed references rather than a captured world-space frame so edits to
    /// the base plane or offset parameter recompute associatively.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub construction_planes: BTreeMap<ConstructionPlaneId, ConstructionPlaneDefinitionV1>,
    pub components: BTreeMap<ComponentId, Component>,
    pub bodies: BTreeMap<BodyId, Body>,
    pub sketches: BTreeMap<SketchId, Sketch>,
    /// Stable material regions derived from sketch geometry. Boundary IDs are
    /// stored in traversal order so feature recompute never has to infer a
    /// profile from whichever closed loops happen to exist later.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub region_definitions_v2: BTreeMap<RegionReferenceId, RegionDefinitionV2>,
    pub features: BTreeMap<FeatureId, Feature>,
    /// Complete executable definitions for features that have adopted the V2
    /// contract. The legacy `features` map remains the stable timeline and
    /// compatibility representation; when a key is present here, this typed
    /// definition is the authoritative operation intent for recompute.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub feature_definitions_v2: BTreeMap<FeatureId, FeatureDefinitionV2>,
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
    /// Presentation/evaluation order for component-owned construction planes.
    /// Optional in schema-v1 documents so existing canonical files remain
    /// byte-for-byte stable.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub construction_plane_order: Vec<ConstructionPlaneId>,
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

/// The only construction-plane definition schema understood by this release.
/// It is versioned independently from the enclosing document schema so future
/// datum forms can fail closed without invalidating unrelated legacy content.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub struct ConstructionPlaneDefinitionVersion(u32);

impl ConstructionPlaneDefinitionVersion {
    pub const V1: Self = Self(1);

    pub const fn get(self) -> u32 {
        self.0
    }
}

impl Serialize for ConstructionPlaneDefinitionVersion {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_u32(self.0)
    }
}

impl<'de> Deserialize<'de> for ConstructionPlaneDefinitionVersion {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let version = u32::deserialize(deserializer)?;
        match version {
            1 => Ok(Self::V1),
            unsupported => Err(serde::de::Error::custom(format!(
                "unsupported crawler construction-plane definition schema version {unsupported}"
            ))),
        }
    }
}

/// Complete durable intent for one component-owned construction plane.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ConstructionPlaneDefinitionV1 {
    pub schema_version: ConstructionPlaneDefinitionVersion,
    pub id: ConstructionPlaneId,
    pub component: ComponentId,
    pub definition: ConstructionPlaneGeometryV1,
    pub suppressed: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ConstructionPlaneGeometryV1 {
    Offset {
        base_plane: OriginPlaneId,
        offset: ParameterId,
    },
}

impl ConstructionPlaneDefinitionV1 {
    pub fn offset(
        id: ConstructionPlaneId,
        component: ComponentId,
        base_plane: OriginPlaneId,
        offset: ParameterId,
    ) -> Self {
        Self {
            schema_version: ConstructionPlaneDefinitionVersion::V1,
            id,
            component,
            definition: ConstructionPlaneGeometryV1::Offset { base_plane, offset },
            suppressed: false,
        }
    }

    /// Visit executable dependencies in deterministic evaluation order.
    pub fn visit_references(
        &self,
        mut visit: impl FnMut(ConstructionPlaneDefinitionReference<'_>),
    ) {
        match &self.definition {
            ConstructionPlaneGeometryV1::Offset { base_plane, offset } => {
                visit(ConstructionPlaneDefinitionReference::OriginPlane(
                    base_plane,
                ));
                visit(ConstructionPlaneDefinitionReference::Parameter(offset));
            }
        }
    }

    pub fn visit_references_mut(
        &mut self,
        mut visit: impl FnMut(ConstructionPlaneDefinitionReferenceMut<'_>),
    ) {
        match &mut self.definition {
            ConstructionPlaneGeometryV1::Offset { base_plane, offset } => {
                visit(ConstructionPlaneDefinitionReferenceMut::OriginPlane(
                    base_plane,
                ));
                visit(ConstructionPlaneDefinitionReferenceMut::Parameter(offset));
            }
        }
    }

    pub fn references(&self) -> Vec<OwnedConstructionPlaneDefinitionReference> {
        let mut references = Vec::new();
        self.visit_references(|reference| references.push(reference.to_owned()));
        references
    }

    pub fn canonical_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ConstructionPlaneDefinitionReference<'a> {
    OriginPlane(&'a OriginPlaneId),
    Parameter(&'a ParameterId),
}

impl ConstructionPlaneDefinitionReference<'_> {
    pub fn to_owned(self) -> OwnedConstructionPlaneDefinitionReference {
        match self {
            Self::OriginPlane(id) => {
                OwnedConstructionPlaneDefinitionReference::OriginPlane(id.clone())
            }
            Self::Parameter(id) => OwnedConstructionPlaneDefinitionReference::Parameter(id.clone()),
        }
    }
}

#[derive(Debug)]
pub enum ConstructionPlaneDefinitionReferenceMut<'a> {
    OriginPlane(&'a mut OriginPlaneId),
    Parameter(&'a mut ParameterId),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OwnedConstructionPlaneDefinitionReference {
    OriginPlane(OriginPlaneId),
    Parameter(ParameterId),
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Body {
    pub id: BodyId,
    pub display_name: String,
    pub component: ComponentId,
    pub generated_by: FeatureId,
    /// Prior accepted producers retained by same-body modifiers. The current
    /// final producer remains `generated_by`; exact historical face ownership
    /// is valid only when its producer is current or appears in this lineage.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub producer_lineage: Vec<FeatureId>,
    pub visibility: ModelVisibility,
}

impl Body {
    pub fn accepts_producer(&self, producer: &FeatureId) -> bool {
        &self.generated_by == producer || self.producer_lineage.contains(producer)
    }

    pub fn accept_retained_result(&mut self, producer: FeatureId) {
        if self.generated_by == producer {
            return;
        }
        if !self.producer_lineage.contains(&self.generated_by) {
            self.producer_lineage.push(self.generated_by.clone());
        }
        self.generated_by = producer;
    }
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

/// The only durable feature-definition schema understood by this release.
///
/// This is intentionally independent from the enclosing document schema: V1
/// documents can preserve legacy features while adopting individual typed V2
/// feature definitions. Newer definition versions fail during deserialization
/// rather than being interpreted with narrower semantics.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub struct FeatureDefinitionVersion(u32);

impl FeatureDefinitionVersion {
    pub const V2: Self = Self(2);

    pub const fn get(self) -> u32 {
        self.0
    }
}

impl Serialize for FeatureDefinitionVersion {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_u32(self.0)
    }
}

impl<'de> Deserialize<'de> for FeatureDefinitionVersion {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let version = u32::deserialize(deserializer)?;
        match version {
            2 => Ok(Self::V2),
            unsupported => Err(serde::de::Error::custom(format!(
                "unsupported crawler feature-definition schema version {unsupported}"
            ))),
        }
    }
}

/// Complete operation intent needed to execute a modern durable feature.
/// Struct field order and all reference-list orders are part of the canonical
/// JSON contract; maps are deliberately avoided here.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct FeatureDefinitionV2 {
    pub schema_version: FeatureDefinitionVersion,
    pub operation: FeatureOperationV2,
    pub result: FeatureResultV2,
    /// Ordered bodies participating in an operation. Exact New Body Extrude
    /// has no participants, but the collection is durable now so later result
    /// modes never need `target_2`-style input keys.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub participant_bodies: Vec<ParticipantBodyReferenceV2>,
    /// Every capability required to interpret this definition. Unknown values
    /// fail closed through serde's enum decoding.
    pub required_capabilities: Vec<RequiredFeatureCapabilityV2>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FeatureDefinitionV2Wire {
    schema_version: FeatureDefinitionVersion,
    operation: FeatureOperationV2,
    result: FeatureResultV2,
    #[serde(default)]
    participant_bodies: Vec<ParticipantBodyReferenceV2>,
    required_capabilities: Vec<RequiredFeatureCapabilityV2>,
}

impl<'de> Deserialize<'de> for FeatureDefinitionV2 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = FeatureDefinitionV2Wire::deserialize(deserializer)?;
        let definition = Self {
            schema_version: wire.schema_version,
            operation: wire.operation,
            result: wire.result,
            participant_bodies: wire.participant_bodies,
            required_capabilities: wire.required_capabilities,
        };
        definition
            .validate_contract()
            .map_err(serde::de::Error::custom)?;
        Ok(definition)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum FeatureDefinitionContractError {
    NewBodyHasParticipants,
    CutRequiresExactlyOneTarget,
    CutTargetIdentityEmpty,
    MissingRequiredCapability(&'static str),
}

impl Display for FeatureDefinitionContractError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        match self {
            Self::NewBodyHasParticipants => {
                formatter.write_str("New Body result mode cannot contain participant bodies")
            }
            Self::CutRequiresExactlyOneTarget => {
                formatter.write_str("Cut result mode requires exactly one explicit target body")
            }
            Self::CutTargetIdentityEmpty => {
                formatter.write_str("Cut target body identity must not be empty")
            }
            Self::MissingRequiredCapability(capability) => {
                write!(
                    formatter,
                    "result mode is missing its required capability {capability}"
                )
            }
        }
    }
}

impl std::error::Error for FeatureDefinitionContractError {}

/// Durable identity and ordered sketch-boundary membership for one material
/// region. Geometry IDs remain strings because sketch geometry is stored in a
/// language-neutral payload rather than as document-layer entity types.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RegionDefinitionV2 {
    pub id: RegionReferenceId,
    pub sketch: SketchId,
    pub outer_geometry_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hole_geometry_ids: Vec<Vec<String>>,
}

impl FeatureDefinitionV2 {
    /// Build the one executable V2 operation committed for the Sprint 1
    /// candidate. Keeping construction behind a typed constructor prevents a
    /// caller from forgetting the required capability marker.
    pub fn exact_blind_new_body_extrude(
        profile: ProfileReferenceV2,
        support: PlanarSupportReferenceV2,
        distance: ParameterId,
        output_body: BodyId,
    ) -> Self {
        Self::exact_blind_new_body_extrude_with_direction(
            profile,
            support,
            distance,
            ExtrudeDirectionV2::Positive,
            output_body,
        )
    }

    /// Build an exact blind New Body Extrude with an explicit durable
    /// direction mode. For `Symmetric`, `distance` is the half-length on each
    /// side of the sketch plane, not the total prism length.
    pub fn exact_blind_new_body_extrude_with_direction(
        profile: ProfileReferenceV2,
        support: PlanarSupportReferenceV2,
        distance: ParameterId,
        direction: ExtrudeDirectionV2,
        output_body: BodyId,
    ) -> Self {
        Self {
            schema_version: FeatureDefinitionVersion::V2,
            operation: FeatureOperationV2::Extrude {
                profile,
                support,
                extent: ExtrudeExtentV2::Blind {
                    distance,
                    direction,
                },
                modifiers: ExtrudeModifiersV2::None,
            },
            result: FeatureResultV2::NewBody { body: output_body },
            participant_bodies: Vec::new(),
            required_capabilities: vec![RequiredFeatureCapabilityV2::ExactBlindNewBodyExtrude],
        }
    }

    /// Build a bounded exact Blind Cut Extrude. The retained target is an
    /// explicit ordered participant rather than an inferred visible body.
    pub fn exact_blind_cut_extrude(
        profile: ProfileReferenceV2,
        support: PlanarSupportReferenceV2,
        distance: ParameterId,
        target_body: BodyId,
    ) -> Self {
        Self::exact_blind_cut_extrude_with_direction(
            profile,
            support,
            distance,
            ExtrudeDirectionV2::Positive,
            target_body,
        )
    }

    /// Build a bounded exact Blind Cut Extrude with an explicit durable
    /// direction and exactly one explicit target body.
    pub fn exact_blind_cut_extrude_with_direction(
        profile: ProfileReferenceV2,
        support: PlanarSupportReferenceV2,
        distance: ParameterId,
        direction: ExtrudeDirectionV2,
        target_body: BodyId,
    ) -> Self {
        Self {
            schema_version: FeatureDefinitionVersion::V2,
            operation: FeatureOperationV2::Extrude {
                profile,
                support,
                extent: ExtrudeExtentV2::Blind {
                    distance,
                    direction,
                },
                modifiers: ExtrudeModifiersV2::None,
            },
            result: FeatureResultV2::Cut,
            participant_bodies: vec![ParticipantBodyReferenceV2 {
                role: ParticipantBodyRoleV2::Target,
                body: target_body,
            }],
            required_capabilities: vec![RequiredFeatureCapabilityV2::ExactBlindCutExtrude],
        }
    }

    /// Validate cross-field result-mode invariants before a definition enters
    /// durable history or a feature graph. Serde invokes the same gate.
    pub fn validate_contract(&self) -> Result<(), FeatureDefinitionContractError> {
        match &self.result {
            FeatureResultV2::NewBody { .. } => {
                if !self.participant_bodies.is_empty() {
                    return Err(FeatureDefinitionContractError::NewBodyHasParticipants);
                }
                if self.required_capabilities
                    != [RequiredFeatureCapabilityV2::ExactBlindNewBodyExtrude]
                {
                    return Err(FeatureDefinitionContractError::MissingRequiredCapability(
                        "exact_blind_new_body_extrude",
                    ));
                }
            }
            FeatureResultV2::Cut => {
                if self.participant_bodies.len() != 1
                    || self.participant_bodies[0].role != ParticipantBodyRoleV2::Target
                {
                    return Err(FeatureDefinitionContractError::CutRequiresExactlyOneTarget);
                }
                if self.participant_bodies[0].body.0.is_empty() {
                    return Err(FeatureDefinitionContractError::CutTargetIdentityEmpty);
                }
                if self.required_capabilities != [RequiredFeatureCapabilityV2::ExactBlindCutExtrude]
                {
                    return Err(FeatureDefinitionContractError::MissingRequiredCapability(
                        "exact_blind_cut_extrude",
                    ));
                }
            }
        }
        Ok(())
    }

    /// Visit every durable reference in deterministic execution order.
    /// Scalar operation references are followed by the ordered result/body
    /// collections. Consumers do not need operation-specific string keys.
    pub fn visit_references(&self, mut visit: impl FnMut(FeatureDefinitionReference<'_>)) {
        match &self.operation {
            FeatureOperationV2::Extrude {
                profile,
                support,
                extent,
                ..
            } => {
                match profile {
                    ProfileReferenceV2::SketchRegion { sketch, region } => {
                        visit(FeatureDefinitionReference::Sketch(sketch));
                        visit(FeatureDefinitionReference::Region(region));
                    }
                }
                match support {
                    PlanarSupportReferenceV2::OriginPlane { plane } => {
                        visit(FeatureDefinitionReference::OriginPlane(plane));
                    }
                    PlanarSupportReferenceV2::ConstructionPlane { plane } => {
                        visit(FeatureDefinitionReference::ConstructionPlane(plane));
                    }
                    PlanarSupportReferenceV2::TopologyFace { reference } => {
                        visit(FeatureDefinitionReference::Topology(reference));
                    }
                }
                match extent {
                    ExtrudeExtentV2::Blind { distance, .. } => {
                        visit(FeatureDefinitionReference::Parameter(distance));
                    }
                }
            }
        }
        match &self.result {
            FeatureResultV2::NewBody { body } => {
                visit(FeatureDefinitionReference::Body(body));
            }
            FeatureResultV2::Cut => {}
        }
        for participant in &self.participant_bodies {
            visit(FeatureDefinitionReference::Body(&participant.body));
        }
    }

    /// Mutable counterpart used by reference repair. Ordered collections are
    /// traversed in-place and retain their caller-owned ordering.
    pub fn visit_references_mut(
        &mut self,
        mut visit: impl FnMut(FeatureDefinitionReferenceMut<'_>),
    ) {
        match &mut self.operation {
            FeatureOperationV2::Extrude {
                profile,
                support,
                extent,
                ..
            } => {
                match profile {
                    ProfileReferenceV2::SketchRegion { sketch, region } => {
                        visit(FeatureDefinitionReferenceMut::Sketch(sketch));
                        visit(FeatureDefinitionReferenceMut::Region(region));
                    }
                }
                match support {
                    PlanarSupportReferenceV2::OriginPlane { plane } => {
                        visit(FeatureDefinitionReferenceMut::OriginPlane(plane));
                    }
                    PlanarSupportReferenceV2::ConstructionPlane { plane } => {
                        visit(FeatureDefinitionReferenceMut::ConstructionPlane(plane));
                    }
                    PlanarSupportReferenceV2::TopologyFace { reference } => {
                        visit(FeatureDefinitionReferenceMut::Topology(reference));
                    }
                }
                match extent {
                    ExtrudeExtentV2::Blind { distance, .. } => {
                        visit(FeatureDefinitionReferenceMut::Parameter(distance));
                    }
                }
            }
        }
        match &mut self.result {
            FeatureResultV2::NewBody { body } => {
                visit(FeatureDefinitionReferenceMut::Body(body));
            }
            FeatureResultV2::Cut => {}
        }
        for participant in &mut self.participant_bodies {
            visit(FeatureDefinitionReferenceMut::Body(&mut participant.body));
        }
    }

    pub fn references(&self) -> Vec<OwnedFeatureDefinitionReference> {
        let mut references = Vec::new();
        self.visit_references(|reference| references.push(reference.to_owned()));
        references
    }

    /// Serde emits this map-free schema deterministically and preserves Vec
    /// order, making this the canonical byte representation used for hashes.
    pub fn canonical_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum FeatureOperationV2 {
    Extrude {
        profile: ProfileReferenceV2,
        support: PlanarSupportReferenceV2,
        extent: ExtrudeExtentV2,
        modifiers: ExtrudeModifiersV2,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ProfileReferenceV2 {
    SketchRegion {
        sketch: SketchId,
        region: RegionReferenceId,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum PlanarSupportReferenceV2 {
    OriginPlane { plane: OriginPlaneId },
    ConstructionPlane { plane: ConstructionPlaneId },
    TopologyFace { reference: TopologyReferenceId },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ExtrudeExtentV2 {
    Blind {
        distance: ParameterId,
        direction: ExtrudeDirectionV2,
    },
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ExtrudeDirectionV2 {
    #[default]
    Positive,
    Negative,
    Symmetric,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ExtrudeModifiersV2 {
    None,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "mode", rename_all = "snake_case", deny_unknown_fields)]
pub enum FeatureResultV2 {
    NewBody { body: BodyId },
    Cut,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ParticipantBodyReferenceV2 {
    pub role: ParticipantBodyRoleV2,
    pub body: BodyId,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ParticipantBodyRoleV2 {
    Target,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RequiredFeatureCapabilityV2 {
    ExactBlindNewBodyExtrude,
    ExactBlindCutExtrude,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FeatureDefinitionReference<'a> {
    Body(&'a BodyId),
    Sketch(&'a SketchId),
    Region(&'a RegionReferenceId),
    OriginPlane(&'a OriginPlaneId),
    ConstructionPlane(&'a ConstructionPlaneId),
    Topology(&'a TopologyReferenceId),
    Parameter(&'a ParameterId),
}

impl FeatureDefinitionReference<'_> {
    pub fn to_owned(self) -> OwnedFeatureDefinitionReference {
        match self {
            Self::Body(id) => OwnedFeatureDefinitionReference::Body(id.clone()),
            Self::Sketch(id) => OwnedFeatureDefinitionReference::Sketch(id.clone()),
            Self::Region(id) => OwnedFeatureDefinitionReference::Region(id.clone()),
            Self::OriginPlane(id) => OwnedFeatureDefinitionReference::OriginPlane(id.clone()),
            Self::ConstructionPlane(id) => {
                OwnedFeatureDefinitionReference::ConstructionPlane(id.clone())
            }
            Self::Topology(id) => OwnedFeatureDefinitionReference::Topology(id.clone()),
            Self::Parameter(id) => OwnedFeatureDefinitionReference::Parameter(id.clone()),
        }
    }
}

#[derive(Debug)]
pub enum FeatureDefinitionReferenceMut<'a> {
    Body(&'a mut BodyId),
    Sketch(&'a mut SketchId),
    Region(&'a mut RegionReferenceId),
    OriginPlane(&'a mut OriginPlaneId),
    ConstructionPlane(&'a mut ConstructionPlaneId),
    Topology(&'a mut TopologyReferenceId),
    Parameter(&'a mut ParameterId),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OwnedFeatureDefinitionReference {
    Body(BodyId),
    Sketch(SketchId),
    Region(RegionReferenceId),
    OriginPlane(OriginPlaneId),
    ConstructionPlane(ConstructionPlaneId),
    Topology(TopologyReferenceId),
    Parameter(ParameterId),
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

/// The only durable topology-reference schema understood by this release.
///
/// Topology references are versioned independently from the enclosing document
/// because their identity and ownership rules form a persistence boundary of
/// their own. Unknown versions fail closed during deserialization.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub struct TopologyReferenceVersion(u32);

impl TopologyReferenceVersion {
    pub const V1: Self = Self(1);

    pub const fn get(self) -> u32 {
        self.0
    }
}

impl Serialize for TopologyReferenceVersion {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_u32(self.0)
    }
}

impl<'de> Deserialize<'de> for TopologyReferenceVersion {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let version = u32::deserialize(deserializer)?;
        match version {
            1 => Ok(Self::V1),
            unsupported => Err(serde::de::Error::custom(format!(
                "unsupported topology reference schema version {unsupported}"
            ))),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TopologyReference {
    pub schema_version: TopologyReferenceVersion,
    pub id: TopologyReferenceId,
    /// Component ownership is persisted explicitly and must agree with both
    /// the referenced body and producer feature; callers must not infer it.
    pub component: ComponentId,
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
/// Kernel identities therefore cross every persistence boundary as canonical
/// decimal strings. Numeric values and non-canonical strings fail closed.
mod decimal_u64 {
    use serde::{Deserialize, Deserializer, Serializer};

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
        let value = String::deserialize(deserializer)?;
        let bytes = value.as_bytes();
        if bytes.is_empty()
            || (bytes.len() > 1 && bytes[0] == b'0')
            || !bytes.iter().all(u8::is_ascii_digit)
        {
            return Err(serde::de::Error::custom(
                "expected a canonical u64 decimal string",
            ));
        }
        value
            .parse::<u64>()
            .map_err(|_| serde::de::Error::custom("expected a canonical u64 decimal string"))
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
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
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
    /// Persist complete executable intent for an existing feature. Creation
    /// and this change may be committed together in one atomic transaction.
    UpsertFeatureDefinitionV2 {
        feature: FeatureId,
        definition: FeatureDefinitionV2,
    },
    /// Create or replace a stable sketch-region definition. This change may
    /// be committed atomically with its consuming feature definition.
    UpsertRegionDefinitionV2 {
        region: RegionReferenceId,
        definition: RegionDefinitionV2,
    },
    /// Create or replace a stable construction-plane definition. A caller can
    /// place this after `CreateParameter` in the same transaction so the
    /// parameter and its consuming datum become visible atomically.
    UpsertConstructionPlaneDefinitionV1 {
        plane: ConstructionPlaneId,
        definition: ConstructionPlaneDefinitionV1,
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
    ConstructionPlane(ConstructionPlaneId),
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

    fn exact_extrude_definition() -> FeatureDefinitionV2 {
        FeatureDefinitionV2::exact_blind_new_body_extrude(
            ProfileReferenceV2::SketchRegion {
                sketch: SketchId::from("sketch:profile"),
                region: RegionReferenceId::from("region:outer-with-hole"),
            },
            PlanarSupportReferenceV2::OriginPlane {
                plane: OriginPlaneId::from("origin-plane:xy"),
            },
            ParameterId::from("parameter:distance"),
            BodyId::from("body:extrude"),
        )
    }

    fn exact_cut_definition() -> FeatureDefinitionV2 {
        FeatureDefinitionV2::exact_blind_cut_extrude(
            ProfileReferenceV2::SketchRegion {
                sketch: SketchId::from("sketch:profile"),
                region: RegionReferenceId::from("region:outer-with-hole"),
            },
            PlanarSupportReferenceV2::OriginPlane {
                plane: OriginPlaneId::from("origin-plane:xy"),
            },
            ParameterId::from("parameter:distance"),
            BodyId::from("body:target"),
        )
    }

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
    fn legacy_documents_round_trip_without_a_v2_definition_field() {
        let fixture = include_str!("../tests/fixtures/minimal-document.json").trim_end();
        let document: Document = serde_json::from_str(fixture).unwrap();
        assert!(document.construction_planes.is_empty());
        assert!(document.region_definitions_v2.is_empty());
        assert!(document.feature_definitions_v2.is_empty());
        assert_eq!(serde_json::to_string(&document).unwrap(), fixture);
        assert!(
            document
                .bodies
                .values()
                .all(|body| body.producer_lineage.is_empty())
        );
    }

    #[test]
    fn retained_body_producer_lineage_is_ordered_deduplicated_and_omitted_when_empty() {
        let fixture = include_str!("../tests/fixtures/parametric-block.json").trim_end();
        let mut document: Document = serde_json::from_str(fixture).unwrap();
        let body = document
            .bodies
            .get_mut(&BodyId::from("body:block"))
            .unwrap();
        assert!(body.producer_lineage.is_empty());
        body.accept_retained_result(FeatureId::from("feature:cut-1"));
        body.accept_retained_result(FeatureId::from("feature:cut-1"));
        body.accept_retained_result(FeatureId::from("feature:cut-2"));
        assert_eq!(
            body.producer_lineage,
            [
                FeatureId::from("feature:extrude"),
                FeatureId::from("feature:cut-1")
            ]
        );
        assert_eq!(body.generated_by, FeatureId::from("feature:cut-2"));
        assert!(body.accepts_producer(&FeatureId::from("feature:extrude")));
        assert!(!body.accepts_producer(&FeatureId::from("feature:wrong")));
        let json = serde_json::to_string(&document).unwrap();
        assert!(json.contains(
            r#""generated_by":"feature:cut-2","producer_lineage":["feature:extrude","feature:cut-1"],"visibility""#
        ));
    }

    #[test]
    fn offset_construction_plane_has_canonical_typed_references() {
        let definition = ConstructionPlaneDefinitionV1::offset(
            ConstructionPlaneId::from("construction-plane:offset-1"),
            ComponentId::from("component:root"),
            OriginPlaneId::from("origin-plane:xy"),
            ParameterId::from("parameter:offset-1"),
        );
        let json = definition.canonical_json().unwrap();
        assert_eq!(
            json,
            r#"{"schema_version":1,"id":"construction-plane:offset-1","component":"component:root","definition":{"kind":"offset","base_plane":"origin-plane:xy","offset":"parameter:offset-1"},"suppressed":false}"#
        );
        assert_eq!(
            serde_json::from_str::<ConstructionPlaneDefinitionV1>(&json).unwrap(),
            definition
        );
        assert_eq!(
            definition.references(),
            vec![
                OwnedConstructionPlaneDefinitionReference::OriginPlane(OriginPlaneId::from(
                    "origin-plane:xy"
                )),
                OwnedConstructionPlaneDefinitionReference::Parameter(ParameterId::from(
                    "parameter:offset-1"
                )),
            ]
        );
    }

    #[test]
    fn construction_plane_reference_repair_is_typed_and_ordered() {
        let mut definition = ConstructionPlaneDefinitionV1::offset(
            ConstructionPlaneId::from("construction-plane:offset-1"),
            ComponentId::from("component:root"),
            OriginPlaneId::from("origin-plane:xy"),
            ParameterId::from("parameter:offset-1"),
        );
        definition.visit_references_mut(|reference| match reference {
            ConstructionPlaneDefinitionReferenceMut::OriginPlane(base) => {
                *base = OriginPlaneId::from("origin-plane:xz")
            }
            ConstructionPlaneDefinitionReferenceMut::Parameter(offset) => {
                *offset = ParameterId::from("parameter:offset-2")
            }
        });
        assert_eq!(
            definition.references(),
            vec![
                OwnedConstructionPlaneDefinitionReference::OriginPlane(OriginPlaneId::from(
                    "origin-plane:xz"
                )),
                OwnedConstructionPlaneDefinitionReference::Parameter(ParameterId::from(
                    "parameter:offset-2"
                )),
            ]
        );
    }

    #[test]
    fn construction_plane_versions_and_unknown_fields_fail_closed() {
        let json = ConstructionPlaneDefinitionV1::offset(
            ConstructionPlaneId::from("construction-plane:offset-1"),
            ComponentId::from("component:root"),
            OriginPlaneId::from("origin-plane:xy"),
            ParameterId::from("parameter:offset-1"),
        )
        .canonical_json()
        .unwrap();
        let unsupported = json.replacen("\"schema_version\":1", "\"schema_version\":2", 1);
        assert!(
            serde_json::from_str::<ConstructionPlaneDefinitionV1>(&unsupported)
                .unwrap_err()
                .to_string()
                .contains("unsupported crawler construction-plane definition schema version 2")
        );
        let unknown = json.replacen(
            "\"suppressed\":false",
            "\"suppressed\":false,\"extra\":0",
            1,
        );
        assert!(serde_json::from_str::<ConstructionPlaneDefinitionV1>(&unknown).is_err());
    }

    #[test]
    fn construction_plane_upsert_change_is_atomic_transaction_payload() {
        let definition = ConstructionPlaneDefinitionV1::offset(
            ConstructionPlaneId::from("construction-plane:offset-1"),
            ComponentId::from("component:root"),
            OriginPlaneId::from("origin-plane:xy"),
            ParameterId::from("parameter:offset-1"),
        );
        let transaction = DocumentTransaction {
            id: TransactionId::from("transaction:create-offset-plane"),
            base_revision: 7,
            result_revision: 8,
            changes: vec![
                DocumentChange::CreateParameter {
                    component: ComponentId::from("component:root"),
                    parameter: Parameter {
                        id: ParameterId::from("parameter:offset-1"),
                        display_name: "Offset".into(),
                        value: ParameterValue::LengthNanometers(-5_000_000),
                    },
                },
                DocumentChange::UpsertConstructionPlaneDefinitionV1 {
                    plane: ConstructionPlaneId::from("construction-plane:offset-1"),
                    definition: definition.clone(),
                },
            ],
        };
        let json = serde_json::to_string(&transaction).unwrap();
        assert!(json.contains("\"kind\":\"upsert_construction_plane_definition_v1\""));
        assert_eq!(
            serde_json::from_str::<DocumentTransaction>(&json).unwrap(),
            transaction
        );
        assert!(!definition.suppressed);
    }

    #[test]
    fn region_definition_preserves_ordered_outer_and_hole_boundaries() {
        let definition = RegionDefinitionV2 {
            id: RegionReferenceId::from("region:plate"),
            sketch: SketchId::from("sketch:plate"),
            outer_geometry_ids: vec!["line:a".into(), "arc:b".into(), "line:c".into()],
            hole_geometry_ids: vec![
                vec!["circle:hole-a".into()],
                vec!["arc:h1".into(), "line:h2".into()],
            ],
        };
        let json = serde_json::to_string(&definition).unwrap();
        assert_eq!(
            json,
            r#"{"id":"region:plate","sketch":"sketch:plate","outer_geometry_ids":["line:a","arc:b","line:c"],"hole_geometry_ids":[["circle:hole-a"],["arc:h1","line:h2"]]}"#
        );
        assert_eq!(
            serde_json::from_str::<RegionDefinitionV2>(&json).unwrap(),
            definition
        );
    }

    #[test]
    fn exact_blind_new_body_extrude_has_canonical_ordered_json() {
        let definition = exact_extrude_definition();
        let expected =
            include_str!("../tests/fixtures/feature-definition-v2-extrude.json").trim_end();
        assert_eq!(definition.canonical_json().unwrap(), expected);
        assert_eq!(
            serde_json::from_str::<FeatureDefinitionV2>(expected).unwrap(),
            definition
        );
    }

    #[test]
    fn exact_blind_cut_extrude_has_one_canonical_explicit_target() {
        let definition = exact_cut_definition();
        let expected =
            include_str!("../tests/fixtures/feature-definition-v2-extrude-cut.json").trim_end();
        assert_eq!(definition.canonical_json().unwrap(), expected);
        assert_eq!(
            serde_json::from_str::<FeatureDefinitionV2>(expected).unwrap(),
            definition
        );
        assert_eq!(
            definition.references().last(),
            Some(&OwnedFeatureDefinitionReference::Body(BodyId::from(
                "body:target"
            )))
        );
    }

    #[test]
    fn result_mode_target_contracts_fail_closed_during_deserialization() {
        let new_body = exact_extrude_definition().canonical_json().unwrap();
        let new_body_with_target = new_body.replacen(
            r#""required_capabilities""#,
            r#""participant_bodies":[{"role":"target","body":"body:target"}],"required_capabilities""#,
            1,
        );
        assert!(
            serde_json::from_str::<FeatureDefinitionV2>(&new_body_with_target)
                .unwrap_err()
                .to_string()
                .contains("New Body result mode cannot contain participant bodies")
        );

        let cut = exact_cut_definition().canonical_json().unwrap();
        for invalid in [
            cut.replace(
                r#","participant_bodies":[{"role":"target","body":"body:target"}]"#,
                "",
            ),
            cut.replace(
                r#""participant_bodies":[{"role":"target","body":"body:target"}]"#,
                r#""participant_bodies":[]"#,
            ),
            cut.replace("exact_blind_cut_extrude", "exact_blind_new_body_extrude"),
        ] {
            assert!(serde_json::from_str::<FeatureDefinitionV2>(&invalid).is_err());
        }
    }

    #[test]
    fn blind_extrude_direction_modes_round_trip_with_stable_tokens() {
        for (direction, token) in [
            (ExtrudeDirectionV2::Positive, "positive"),
            (ExtrudeDirectionV2::Negative, "negative"),
            (ExtrudeDirectionV2::Symmetric, "symmetric"),
        ] {
            let mut definition = exact_extrude_definition();
            let FeatureOperationV2::Extrude {
                extent:
                    ExtrudeExtentV2::Blind {
                        direction: stored, ..
                    },
                ..
            } = &mut definition.operation;
            *stored = direction;
            let json = definition.canonical_json().unwrap();
            assert!(json.contains(&format!(r#""direction":"{token}""#)));
            assert_eq!(
                serde_json::from_str::<FeatureDefinitionV2>(&json).unwrap(),
                definition
            );
        }
    }

    #[test]
    fn feature_definition_unknown_contract_values_fail_closed() {
        let canonical = exact_extrude_definition().canonical_json().unwrap();
        for (from, to, message) in [
            (
                r#""schema_version":2"#,
                r#""schema_version":3"#,
                "schema version 3",
            ),
            (
                r#""kind":"extrude""#,
                r#""kind":"loft""#,
                "unknown variant `loft`",
            ),
            (
                r#""direction":"positive""#,
                r#""direction":"sideways""#,
                "unknown variant `sideways`",
            ),
            (
                r#""exact_blind_new_body_extrude""#,
                r#""unqualified_boolean""#,
                "unknown variant `unqualified_boolean`",
            ),
        ] {
            let invalid = canonical.replacen(from, to, 1);
            let error = serde_json::from_str::<FeatureDefinitionV2>(&invalid).unwrap_err();
            assert!(
                error.to_string().contains(message),
                "expected {message:?} in {error}"
            );
        }
    }

    #[test]
    fn traversal_and_repair_cover_scalar_and_ordered_references() {
        let mut definition = exact_extrude_definition();
        definition.participant_bodies = vec![
            ParticipantBodyReferenceV2 {
                role: ParticipantBodyRoleV2::Target,
                body: BodyId::from("body:target-a"),
            },
            ParticipantBodyReferenceV2 {
                role: ParticipantBodyRoleV2::Target,
                body: BodyId::from("body:target-b"),
            },
        ];

        assert_eq!(
            definition.references(),
            vec![
                OwnedFeatureDefinitionReference::Sketch(SketchId::from("sketch:profile")),
                OwnedFeatureDefinitionReference::Region(RegionReferenceId::from(
                    "region:outer-with-hole",
                )),
                OwnedFeatureDefinitionReference::OriginPlane(OriginPlaneId::from(
                    "origin-plane:xy",
                )),
                OwnedFeatureDefinitionReference::Parameter(
                    ParameterId::from("parameter:distance",)
                ),
                OwnedFeatureDefinitionReference::Body(BodyId::from("body:extrude")),
                OwnedFeatureDefinitionReference::Body(BodyId::from("body:target-a")),
                OwnedFeatureDefinitionReference::Body(BodyId::from("body:target-b")),
            ]
        );

        definition.visit_references_mut(|reference| {
            if let FeatureDefinitionReferenceMut::Body(body) = reference
                && body.0 == "body:target-b"
            {
                *body = BodyId::from("body:target-repaired");
            }
        });
        assert_eq!(
            definition.participant_bodies[1].body,
            BodyId::from("body:target-repaired")
        );
    }

    #[test]
    fn topology_face_planar_support_is_canonical_and_repair_visitable() {
        let mut definition = exact_extrude_definition();
        let FeatureOperationV2::Extrude { support, .. } = &mut definition.operation;
        *support = PlanarSupportReferenceV2::TopologyFace {
            reference: TopologyReferenceId::from("topology:face-18446744073709551615"),
        };
        let json = definition.canonical_json().unwrap();
        assert_eq!(
            json,
            include_str!("../tests/fixtures/feature-definition-v2-extrude-topology-face.json")
                .trim_end()
        );
        assert_eq!(
            serde_json::from_str::<FeatureDefinitionV2>(&json).unwrap(),
            definition
        );
        assert!(
            definition
                .references()
                .contains(&OwnedFeatureDefinitionReference::Topology(
                    TopologyReferenceId::from("topology:face-18446744073709551615")
                ))
        );
        definition.visit_references_mut(|reference| {
            if let FeatureDefinitionReferenceMut::Topology(reference) = reference {
                *reference = TopologyReferenceId::from("topology:face-rebound");
            }
        });
        assert!(
            definition
                .references()
                .contains(&OwnedFeatureDefinitionReference::Topology(
                    TopologyReferenceId::from("topology:face-rebound")
                ))
        );
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

    fn topology_reference(stable_kernel_id: u64) -> TopologyReference {
        TopologyReference {
            schema_version: TopologyReferenceVersion::V1,
            id: TopologyReferenceId::from("topology:max-face"),
            component: ComponentId::from("component:root"),
            body: BodyId::from("body:max-face"),
            producer: FeatureId::from("feature:max-face"),
            kind: TopologyKind::Face,
            stable_kernel_id,
            stable_token: "face:max".into(),
            fallback_signature: TopologySignature::Face {
                centroid_nanometers: [0, 0, 0],
                normal_millionths: [0, 0, 1_000_000],
                area_square_nanometers: 1,
            },
        }
    }

    fn topology_reference_json(
        stable_kernel_id: serde_json::Value,
        fallback_signature: serde_json::Value,
    ) -> serde_json::Value {
        serde_json::json!({
            "schema_version": 1,
            "id": "topology:test",
            "component": "component:root",
            "body": "body:test",
            "producer": "feature:test",
            "kind": "face",
            "stable_kernel_id": stable_kernel_id,
            "stable_token": "face:test",
            "fallback_signature": fallback_signature,
        })
    }

    #[test]
    fn topology_kernel_ids_round_trip_as_canonical_decimal_u64_strings() {
        for stable_kernel_id in [0, u64::MAX] {
            let reference = topology_reference(stable_kernel_id);
            let json = serde_json::to_string(&reference).unwrap();
            assert!(json.contains(&format!(r#""stable_kernel_id":"{stable_kernel_id}""#)));
            assert_eq!(
                serde_json::from_str::<TopologyReference>(&json).unwrap(),
                reference
            );
        }
    }

    #[test]
    fn topology_kernel_ids_reject_noncanonical_or_out_of_range_values() {
        let signature = serde_json::json!({
            "kind": "face",
            "centroid_nanometers": [0, 0, 0],
            "normal_millionths": [0, 0, 1_000_000],
            "area_square_nanometers": 1,
        });

        for invalid in [
            serde_json::json!(0),
            serde_json::json!("18446744073709551616"),
            serde_json::json!("01"),
            serde_json::json!("+1"),
            serde_json::json!("-1"),
            serde_json::json!(""),
            serde_json::json!(" 1"),
            serde_json::json!("1 "),
        ] {
            let value = topology_reference_json(invalid.clone(), signature.clone());
            assert!(
                serde_json::from_value::<TopologyReference>(value).is_err(),
                "accepted invalid stable_kernel_id {invalid}"
            );
        }
    }

    #[test]
    fn topology_signatures_reject_extra_missing_and_malformed_variant_fields() {
        let cases = [
            (
                serde_json::json!({
                    "kind": "vertex",
                    "position_nanometers": [0, 0, 0],
                }),
                "position_nanometers",
                "position_nanometers",
                serde_json::json!([0, 0]),
            ),
            (
                serde_json::json!({
                    "kind": "edge",
                    "midpoint_nanometers": [0, 0, 0],
                    "length_nanometers": 1,
                }),
                "midpoint_nanometers",
                "length_nanometers",
                serde_json::json!(-1),
            ),
            (
                serde_json::json!({
                    "kind": "face",
                    "centroid_nanometers": [0, 0, 0],
                    "normal_millionths": [0, 0, 1_000_000],
                    "area_square_nanometers": 1,
                }),
                "normal_millionths",
                "area_square_nanometers",
                serde_json::json!(-1),
            ),
        ];

        for (valid_signature, missing_field, malformed_field, malformed_value) in cases {
            let valid = topology_reference_json(serde_json::json!("0"), valid_signature.clone());
            assert!(serde_json::from_value::<TopologyReference>(valid).is_ok());

            let mut extra = valid_signature.clone();
            extra
                .as_object_mut()
                .unwrap()
                .insert("unexpected".into(), serde_json::json!(true));
            assert!(
                serde_json::from_value::<TopologyReference>(topology_reference_json(
                    serde_json::json!("0"),
                    extra,
                ))
                .is_err(),
                "accepted an extra signature field for {}",
                valid_signature["kind"]
            );

            let mut missing = valid_signature.clone();
            missing.as_object_mut().unwrap().remove(missing_field);
            assert!(
                serde_json::from_value::<TopologyReference>(topology_reference_json(
                    serde_json::json!("0"),
                    missing,
                ))
                .is_err(),
                "accepted a missing signature field for {}",
                valid_signature["kind"]
            );

            let mut malformed = valid_signature.clone();
            malformed
                .as_object_mut()
                .unwrap()
                .insert(malformed_field.into(), malformed_value);
            assert!(
                serde_json::from_value::<TopologyReference>(topology_reference_json(
                    serde_json::json!("0"),
                    malformed,
                ))
                .is_err(),
                "accepted a malformed signature field for {}",
                valid_signature["kind"]
            );
        }
    }

    #[test]
    fn all_persisted_kernel_ids_share_the_canonical_decimal_contract() {
        let external = SketchElement::ExternalLine {
            id: "external:edge".into(),
            start_nanometers: [0, 0],
            end_nanometers: [1, 1],
            body: BodyId::from("body:test"),
            stable_kernel_id: u64::MAX,
        };
        let json = serde_json::to_string(&external).unwrap();
        assert!(json.contains(r#""stable_kernel_id":"18446744073709551615""#));
        assert_eq!(
            serde_json::from_str::<SketchElement>(&json).unwrap(),
            external
        );

        for invalid in [
            json.replace(
                r#""stable_kernel_id":"18446744073709551615""#,
                r#""stable_kernel_id":42"#,
            ),
            json.replace("18446744073709551615", "01"),
        ] {
            assert!(serde_json::from_str::<SketchElement>(&invalid).is_err());
        }
    }

    #[test]
    fn topology_reference_schema_versions_fail_closed() {
        let json = serde_json::to_string(&topology_reference(u64::MAX)).unwrap();

        let unsupported = json.replacen("\"schema_version\":1", "\"schema_version\":2", 1);
        let error = serde_json::from_str::<TopologyReference>(&unsupported).unwrap_err();
        assert!(
            error
                .to_string()
                .contains("unsupported topology reference schema version 2")
        );

        let unversioned = json.replacen("\"schema_version\":1,", "", 1);
        let error = serde_json::from_str::<TopologyReference>(&unversioned).unwrap_err();
        assert!(error.to_string().contains("missing field `schema_version`"));
    }
}
