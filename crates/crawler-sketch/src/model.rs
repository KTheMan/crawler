use serde::{Deserialize, Deserializer, Serialize, Serializer, de};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use thiserror::Error;

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

        impl From<String> for $name {
            fn from(value: String) -> Self {
                Self(value)
            }
        }
    };
}

stable_id!(GeometryId);
stable_id!(ConstraintId);

/// Stable virtual geometry identity used for the sketch-plane origin. It is a
/// solver datum, not stored geometry, so referencing it never creates a
/// visible helper entity.
pub const IMPLIED_ORIGIN_GEOMETRY_ID: &str = "reference:origin";

/// Stable plane-local reference axes used by directional dimensions. These
/// are solver datums rather than sketch geometry, so constraining a line to an
/// axis never creates a user-visible construction entity.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Axis2d {
    X,
    Y,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Point2 {
    pub x_nm: i64,
    pub y_nm: i64,
}

impl Point2 {
    pub const fn new(x_nm: i64, y_nm: i64) -> Self {
        Self { x_nm, y_nm }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Line {
    pub start: Point2,
    pub end: Point2,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Circle {
    pub center: Point2,
    pub radius_nm: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Arc {
    pub center: Point2,
    pub start: Point2,
    pub end: Point2,
    pub clockwise: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Rectangle {
    pub min: Point2,
    pub max: Point2,
}

/// A native, open-uniform control-point B-spline. Its knot vector is derived
/// deterministically from `degree` and the durable control-point count, so the
/// canonical representation is compact while real knot spans remain stable.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ControlPointSpline {
    pub degree: u8,
    pub control_points: Vec<Point2>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub knots_millionths: Vec<u32>,
}

/// A bounded native fit-point spline. The initial contract uses four stable
/// interpolation points and deterministic open Catmull-Rom evaluation.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FitPointSpline {
    pub fit_points: Vec<Point2>,
}

/// A native affine ellipse defined by its center and two axis endpoints.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Ellipse {
    pub center: Point2,
    pub major: Point2,
    pub minor: Point2,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct EllipticalArc {
    pub center: Point2,
    pub major: Point2,
    pub minor: Point2,
    pub start: Point2,
    pub end: Point2,
    pub clockwise: bool,
}

/// A native rational quadratic Bezier conic. Weight is stored in millionths
/// so the canonical document remains deterministic and integer-valued.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Conic {
    pub start: Point2,
    pub control: Point2,
    pub end: Point2,
    pub weight_millionths: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Geometry {
    Line(Line),
    Circle(Circle),
    Arc(Arc),
    Rectangle(Rectangle),
    ControlPointSpline(ControlPointSpline),
    FitPointSpline(FitPointSpline),
    Ellipse(Ellipse),
    EllipticalArc(EllipticalArc),
    Conic(Conic),
    SketchPoint(Point2),
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GeometryEntity {
    pub id: GeometryId,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub construction: bool,
    pub geometry: Geometry,
}

impl GeometryEntity {
    pub fn new(id: impl Into<GeometryId>, geometry: Geometry) -> Self {
        Self {
            id: id.into(),
            construction: false,
            geometry,
        }
    }

    pub fn construction(mut self) -> Self {
        self.construction = true;
        self
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum Anchor {
    Start,
    End,
    Center,
    Min,
    Max,
    ControlPoint(u32),
    FitPoint(u32),
    Knot(u32),
    CurveParameter(u32),
    Major,
    Minor,
    Control,
    Position,
}

impl Serialize for Anchor {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let value = match self {
            Self::Start => "start".to_owned(),
            Self::End => "end".to_owned(),
            Self::Center => "center".to_owned(),
            Self::Min => "min".to_owned(),
            Self::Max => "max".to_owned(),
            Self::ControlPoint(index) => format!("control:{index}"),
            Self::FitPoint(index) => format!("fit:{index}"),
            Self::Knot(index) => format!("knot:{index}"),
            Self::CurveParameter(value) => format!("parameter:{value}"),
            Self::Major => "major".to_owned(),
            Self::Minor => "minor".to_owned(),
            Self::Control => "control".to_owned(),
            Self::Position => "position".to_owned(),
        };
        serializer.serialize_str(&value)
    }
}

impl<'de> Deserialize<'de> for Anchor {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        match value.as_str() {
            "start" => Ok(Self::Start),
            "end" => Ok(Self::End),
            "center" => Ok(Self::Center),
            "min" => Ok(Self::Min),
            "max" => Ok(Self::Max),
            "major" => Ok(Self::Major),
            "minor" => Ok(Self::Minor),
            "control" => Ok(Self::Control),
            "position" => Ok(Self::Position),
            _ => value
                .strip_prefix("control:")
                .and_then(|index| index.parse::<u32>().ok())
                .map(Self::ControlPoint)
                .or_else(|| {
                    value
                        .strip_prefix("fit:")
                        .and_then(|index| index.parse::<u32>().ok())
                        .map(Self::FitPoint)
                })
                .or_else(|| {
                    value
                        .strip_prefix("knot:")
                        .and_then(|index| index.parse::<u32>().ok())
                        .map(Self::Knot)
                })
                .or_else(|| {
                    value
                        .strip_prefix("parameter:")
                        .and_then(|index| index.parse::<u32>().ok())
                        .map(Self::CurveParameter)
                })
                .ok_or_else(|| de::Error::custom(format!("unknown sketch anchor `{value}`"))),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PointRef {
    pub geometry: GeometryId,
    pub anchor: Anchor,
}

impl PointRef {
    pub fn new(geometry: impl Into<GeometryId>, anchor: Anchor) -> Self {
        Self {
            geometry: geometry.into(),
            anchor,
        }
    }

    pub fn origin() -> Self {
        Self::new(IMPLIED_ORIGIN_GEOMETRY_ID, Anchor::Center)
    }

    pub fn control_point(geometry: impl Into<GeometryId>, index: u32) -> Self {
        Self::new(geometry, Anchor::ControlPoint(index))
    }

    pub fn fit_point(geometry: impl Into<GeometryId>, index: u32) -> Self {
        Self::new(geometry, Anchor::FitPoint(index))
    }

    pub fn is_origin(&self) -> bool {
        self.geometry.0 == IMPLIED_ORIGIN_GEOMETRY_ID && self.anchor == Anchor::Center
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Constraint {
    Coincident {
        a: PointRef,
        b: PointRef,
    },
    PointOnOrigin {
        point: PointRef,
    },
    Fixed {
        point: PointRef,
        x_nm: i64,
        y_nm: i64,
    },
    FixedGeometry {
        geometry: GeometryId,
    },
    Midpoint {
        point: PointRef,
        line: GeometryId,
    },
    Concentric {
        first: GeometryId,
        second: GeometryId,
    },
    PointOnObject {
        point: PointRef,
        geometry: GeometryId,
    },
    Horizontal {
        line: GeometryId,
    },
    Vertical {
        line: GeometryId,
    },
    HorizontalPoints {
        a: PointRef,
        b: PointRef,
    },
    VerticalPoints {
        a: PointRef,
        b: PointRef,
    },
    Collinear {
        point: PointRef,
        line: GeometryId,
    },
    Symmetry {
        first: PointRef,
        second: PointRef,
        axis: GeometryId,
    },
    CurvatureContinuous {
        first: GeometryId,
        second: GeometryId,
    },
    Parallel {
        first: GeometryId,
        second: GeometryId,
    },
    Perpendicular {
        first: GeometryId,
        second: GeometryId,
    },
    Tangent {
        first: GeometryId,
        second: GeometryId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        first_parameter_millionths: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        second_parameter_millionths: Option<u32>,
    },
    Equal {
        first: GeometryId,
        second: GeometryId,
    },
    Distance {
        a: PointRef,
        b: PointRef,
        distance_nm: i64,
    },
    DistanceX {
        a: PointRef,
        b: PointRef,
        distance_nm: i64,
    },
    DistanceY {
        a: PointRef,
        b: PointRef,
        distance_nm: i64,
    },
    PointLineDistance {
        point: PointRef,
        line: GeometryId,
        distance_nm: i64,
    },
    LineDistance {
        first: GeometryId,
        second: GeometryId,
        distance_nm: i64,
    },
    OffsetDistance {
        source: GeometryId,
        offset: GeometryId,
        distance_nm: i64,
        source_start_millionths: u32,
        source_end_millionths: u32,
    },
    Radius {
        geometry: GeometryId,
        radius_nm: i64,
    },
    Diameter {
        geometry: GeometryId,
        diameter_nm: i64,
    },
    EllipseRadius {
        geometry: GeometryId,
        axis: Anchor,
        radius_nm: i64,
    },
    Angle {
        first: GeometryId,
        second: GeometryId,
        angle_microdegrees: i64,
    },
    AngleToAxis {
        line: GeometryId,
        axis: Axis2d,
        angle_microdegrees: i64,
    },
}

impl Constraint {
    pub(crate) fn referenced_geometry(&self) -> Vec<&GeometryId> {
        let referenced = match self {
            Self::Coincident { a, b }
            | Self::HorizontalPoints { a, b }
            | Self::VerticalPoints { a, b }
            | Self::DistanceX { a, b, .. }
            | Self::DistanceY { a, b, .. }
            | Self::Distance { a, b, .. } => {
                vec![&a.geometry, &b.geometry]
            }
            Self::PointOnOrigin { point } | Self::Fixed { point, .. } => vec![&point.geometry],
            Self::FixedGeometry { geometry } => vec![geometry],
            Self::Midpoint { point, line }
            | Self::Collinear { point, line }
            | Self::PointLineDistance { point, line, .. }
            | Self::PointOnObject {
                point,
                geometry: line,
            } => {
                vec![&point.geometry, line]
            }
            Self::Horizontal { line }
            | Self::Vertical { line }
            | Self::AngleToAxis { line, .. }
            | Self::Radius { geometry: line, .. } => vec![line],
            Self::Diameter { geometry, .. } | Self::EllipseRadius { geometry, .. } => {
                vec![geometry]
            }
            Self::Parallel { first, second }
            | Self::Perpendicular { first, second }
            | Self::Tangent { first, second, .. }
            | Self::Equal { first, second }
            | Self::Concentric { first, second }
            | Self::CurvatureContinuous { first, second }
            | Self::LineDistance { first, second, .. }
            | Self::Angle { first, second, .. } => vec![first, second],
            Self::OffsetDistance { source, offset, .. } => vec![source, offset],
            Self::Symmetry {
                first,
                second,
                axis,
            } => {
                vec![&first.geometry, &second.geometry, axis]
            }
        };
        referenced
            .into_iter()
            .filter(|geometry| geometry.0 != IMPLIED_ORIGIN_GEOMETRY_ID)
            .collect()
    }
}

/// Durable high-level construction intent for composite sketch generators.
/// Member geometry remains independently constrainable while this recipe keeps
/// the parameters and composite identity needed for later recipe-level edits.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum SketchRecipe {
    Polygon {
        #[serde(default, skip_serializing_if = "String::is_empty")]
        mode: String,
        center: Point2,
        radius_nm: i64,
        sides: u32,
        orientation_microdegrees: i64,
        geometry: Vec<GeometryId>,
    },
    Slot {
        #[serde(default, skip_serializing_if = "String::is_empty")]
        mode: String,
        first: Point2,
        second: Point2,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        center: Option<Point2>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        through: Option<Point2>,
        radius_nm: i64,
        geometry: Vec<GeometryId>,
    },
    Text {
        text: String,
        origin: Point2,
        height_nm: i64,
        rotation_microdegrees: i64,
        tracking_millionths: i64,
        horizontal_alignment: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        path: Option<GeometryId>,
        #[serde(default)]
        path_start_millionths: u32,
        #[serde(default)]
        reversed: bool,
        geometry: Vec<GeometryId>,
    },
}

impl SketchRecipe {
    pub fn geometry(&self) -> &[GeometryId] {
        match self {
            Self::Polygon { geometry, .. }
            | Self::Slot { geometry, .. }
            | Self::Text { geometry, .. } => geometry,
        }
    }
}

/// Durable associative intent for P1 sketch modifiers and include operations.
/// Generated geometry remains ordinary editable sketch geometry while this
/// record owns recompute parameters, topology correspondence, and suppression.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum SketchOperation {
    Offset {
        sources: Vec<GeometryId>,
        result_chains: Vec<Vec<GeometryId>>,
        distance_nm: i64,
        two_sided: bool,
        linked: bool,
        #[serde(default = "default_offset_model_tolerance_nm")]
        model_tolerance_nm: i64,
        /// Optional v2 representation metadata. `None` preserves legacy
        /// documents and keeps the representation change feature-gated.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        result_spans: Option<Vec<Vec<OffsetResultSpan>>>,
    },
    Mirror {
        sources: Vec<GeometryId>,
        axis: Option<GeometryId>,
        results: Vec<GeometryId>,
        linked: bool,
    },
    LinearPattern {
        sources: Vec<GeometryId>,
        instances: Vec<Vec<GeometryId>>,
        count: u32,
        spacing: Point2,
        extent: bool,
        suppressed_instances: BTreeSet<u32>,
    },
    CircularPattern {
        sources: Vec<GeometryId>,
        instances: Vec<Vec<GeometryId>>,
        center: Point2,
        count: u32,
        angle_microdegrees: i64,
        suppressed_instances: BTreeSet<u32>,
    },
    Fillet {
        first: GeometryId,
        second: GeometryId,
        result: GeometryId,
        radius_nm: i64,
    },
    Chamfer {
        first: GeometryId,
        second: GeometryId,
        result: GeometryId,
        first_distance_nm: i64,
        second_distance_nm: i64,
        #[serde(default = "default_chamfer_angle")]
        angle_microdegrees: i64,
        mode: String,
    },
    Break {
        source: GeometryId,
        results: Vec<GeometryId>,
        parameters_millionths: Vec<u32>,
    },
    Scale {
        sources: Vec<GeometryId>,
        results: Vec<GeometryId>,
        originals: Vec<Geometry>,
        center: Point2,
        factor_millionths: i64,
        copy: bool,
    },
    MoveCopy {
        sources: Vec<GeometryId>,
        results: Vec<GeometryId>,
        originals: Vec<Geometry>,
        delta: Point2,
        copy: bool,
    },
    Blend {
        first: GeometryId,
        second: GeometryId,
        result: GeometryId,
        continuity: String,
        magnitude_nm: i64,
    },
    ProjectInclude {
        source_kind: String,
        source_ids: Vec<String>,
        results: Vec<GeometryId>,
        linked: bool,
        locked: bool,
        intersect_plane: bool,
        missing: bool,
    },
}

fn default_chamfer_angle() -> i64 {
    45_000_000
}
fn default_offset_model_tolerance_nm() -> i64 {
    crate::curve::OFFSET_MODEL_TOLERANCE_NM
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct OffsetResultSpan {
    pub result: GeometryId,
    pub source_start_millionths: u32,
    pub source_end_millionths: u32,
    /// Present only for a conservative analytic error bound. Adaptive sampled
    /// residuals deliberately serialize as `None` rather than as proof.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub certified_error_nm: Option<i64>,
}

impl SketchOperation {
    pub fn sources(&self) -> Vec<&GeometryId> {
        match self {
            Self::Offset { sources, .. }
            | Self::Mirror { sources, .. }
            | Self::LinearPattern { sources, .. }
            | Self::CircularPattern { sources, .. }
            | Self::Scale { sources, .. }
            | Self::MoveCopy { sources, .. } => sources.iter().collect(),
            Self::Fillet { first, second, .. }
            | Self::Chamfer { first, second, .. }
            | Self::Blend { first, second, .. } => vec![first, second],
            Self::Break { source, .. } => vec![source],
            Self::ProjectInclude { .. } => Vec::new(),
        }
    }
    pub fn results(&self) -> Vec<&GeometryId> {
        match self {
            Self::Mirror { results, .. }
            | Self::Break { results, .. }
            | Self::Scale { results, .. }
            | Self::MoveCopy { results, .. }
            | Self::ProjectInclude { results, .. } => results.iter().collect(),
            Self::Offset { result_chains, .. } => result_chains.iter().flatten().collect(),
            Self::LinearPattern { instances, .. } | Self::CircularPattern { instances, .. } => {
                instances.iter().flatten().collect()
            }
            Self::Fillet { result, .. }
            | Self::Chamfer { result, .. }
            | Self::Blend { result, .. } => vec![result],
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Sketch {
    pub id: String,
    pub revision: u64,
    pub geometry: BTreeMap<GeometryId, GeometryEntity>,
    pub constraints: BTreeMap<ConstraintId, Constraint>,
    /// Stable document-parameter identity for dimensional constraints. The
    /// numerical solver consumes the resolved value in `constraints`; the
    /// runtime owns expression evaluation and durable parameter storage.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub dimension_parameters: BTreeMap<ConstraintId, String>,
    /// Canonical plane-local label placement for dimensional constraints.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub dimension_positions: BTreeMap<ConstraintId, Point2>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub recipes: BTreeMap<String, SketchRecipe>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub operations: BTreeMap<String, SketchOperation>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub external_references: BTreeMap<GeometryId, ExternalReference>,
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub suppressed_constraints: BTreeSet<ConstraintId>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ExternalReference {
    pub body: String,
    /// Decimal u64 string so the browser never passes stable kernel identity
    /// through a JavaScript number.
    pub stable_kernel_id: String,
}

fn is_canonical_decimal_u64(value: &str) -> bool {
    let bytes = value.as_bytes();
    let has_canonical_syntax = match bytes {
        [b'0'] => true,
        [b'1'..=b'9', rest @ ..] => rest.iter().all(u8::is_ascii_digit),
        _ => false,
    };
    has_canonical_syntax && value.parse::<u64>().is_ok()
}

impl Sketch {
    pub fn new(id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            revision: 0,
            geometry: BTreeMap::new(),
            constraints: BTreeMap::new(),
            dimension_parameters: BTreeMap::new(),
            dimension_positions: BTreeMap::new(),
            recipes: BTreeMap::new(),
            operations: BTreeMap::new(),
            external_references: BTreeMap::new(),
            suppressed_constraints: BTreeSet::new(),
        }
    }

    pub fn validate(&self) -> Result<(), SketchError> {
        if self.id.is_empty() {
            return Err(SketchError::EmptySketchId);
        }
        for (id, entity) in &self.geometry {
            if id.0.is_empty() || id != &entity.id {
                return Err(SketchError::GeometryIdentityMismatch(id.clone()));
            }
            validate_geometry(entity)?;
        }
        for (id, constraint) in &self.constraints {
            if id.0.is_empty() {
                return Err(SketchError::EmptyConstraintId);
            }
            for geometry in constraint.referenced_geometry() {
                if !self.geometry.contains_key(geometry) {
                    return Err(SketchError::MissingGeometry(geometry.clone()));
                }
            }
            validate_constraint_types(self, constraint)?;
        }
        for id in self.dimension_parameters.keys() {
            if !matches!(
                self.constraints.get(id),
                Some(
                    Constraint::Distance { .. }
                        | Constraint::DistanceX { .. }
                        | Constraint::DistanceY { .. }
                        | Constraint::PointLineDistance { .. }
                        | Constraint::LineDistance { .. }
                        | Constraint::OffsetDistance { .. }
                        | Constraint::Radius { .. }
                        | Constraint::Diameter { .. }
                        | Constraint::EllipseRadius { .. }
                        | Constraint::Angle { .. }
                        | Constraint::AngleToAxis { .. }
                )
            ) {
                return Err(SketchError::MissingConstraint(id.clone()));
            }
        }
        for id in self.dimension_positions.keys() {
            if !matches!(
                self.constraints.get(id),
                Some(
                    Constraint::Distance { .. }
                        | Constraint::DistanceX { .. }
                        | Constraint::DistanceY { .. }
                        | Constraint::PointLineDistance { .. }
                        | Constraint::LineDistance { .. }
                        | Constraint::OffsetDistance { .. }
                        | Constraint::Radius { .. }
                        | Constraint::Diameter { .. }
                        | Constraint::EllipseRadius { .. }
                        | Constraint::Angle { .. }
                        | Constraint::AngleToAxis { .. }
                )
            ) {
                return Err(SketchError::MissingConstraint(id.clone()));
            }
        }
        for (id, recipe) in &self.recipes {
            if id.is_empty()
                || recipe
                    .geometry()
                    .iter()
                    .any(|geometry| !self.geometry.contains_key(geometry))
            {
                return Err(SketchError::InvalidRecipe(id.clone()));
            }
            match recipe {
                SketchRecipe::Polygon {
                    radius_nm,
                    sides,
                    geometry,
                    ..
                } if *radius_nm <= 0 || *sides < 3 || geometry.len() != *sides as usize => {
                    return Err(SketchError::InvalidRecipe(id.clone()));
                }
                SketchRecipe::Slot {
                    first,
                    second,
                    radius_nm,
                    geometry,
                    ..
                } if first == second || *radius_nm <= 0 || geometry.len() != 4 => {
                    return Err(SketchError::InvalidRecipe(id.clone()));
                }
                SketchRecipe::Text {
                    text,
                    height_nm,
                    tracking_millionths,
                    horizontal_alignment,
                    path,
                    geometry,
                    ..
                } if text.is_empty()
                    || *height_nm <= 0
                    || *tracking_millionths <= 0
                    || !matches!(horizontal_alignment.as_str(), "left" | "center" | "right")
                    || geometry.is_empty()
                    || path
                        .as_ref()
                        .is_some_and(|value| !self.geometry.contains_key(value)) =>
                {
                    return Err(SketchError::InvalidRecipe(id.clone()));
                }
                _ => {}
            }
        }
        for (id, operation) in &self.operations {
            if id.is_empty()
                || operation
                    .sources()
                    .into_iter()
                    .chain(operation.results())
                    .any(|geometry| !self.geometry.contains_key(geometry))
            {
                return Err(SketchError::InvalidOperation(id.clone()));
            }
            validate_operation(id, operation)?;
        }
        if let Some(id) = self
            .suppressed_constraints
            .iter()
            .find(|id| !self.constraints.contains_key(*id))
        {
            return Err(SketchError::MissingConstraint(id.clone()));
        }
        for (id, reference) in &self.external_references {
            if !matches!(
                self.geometry.get(id).map(|entity| &entity.geometry),
                Some(Geometry::Line(_))
            ) {
                return Err(SketchError::WrongGeometryKind(id.clone()));
            }
            if reference.body.is_empty() || !is_canonical_decimal_u64(&reference.stable_kernel_id) {
                return Err(SketchError::InvalidExternalReference(id.clone()));
            }
        }
        Ok(())
    }

    pub fn canonical_bytes(&self) -> Result<Vec<u8>, SketchError> {
        self.validate()?;
        serde_json::to_vec(self).map_err(SketchError::Serialize)
    }

    pub fn canonical_hash(&self) -> Result<String, SketchError> {
        Ok(format!("{:x}", Sha256::digest(self.canonical_bytes()?)))
    }

    pub fn from_canonical_bytes(bytes: &[u8]) -> Result<Self, SketchError> {
        let sketch: Self = serde_json::from_slice(bytes).map_err(SketchError::Deserialize)?;
        sketch.validate()?;
        Ok(sketch)
    }

    pub(crate) fn point(&self, point: &PointRef) -> Result<Point2, SketchError> {
        if point.is_origin() {
            return Ok(Point2::new(0, 0));
        }
        let entity = self
            .geometry
            .get(&point.geometry)
            .ok_or_else(|| SketchError::MissingGeometry(point.geometry.clone()))?;
        point_of(entity, point.anchor)
    }

    pub(crate) fn set_point(&mut self, point: &PointRef, value: Point2) -> Result<(), SketchError> {
        if point.is_origin() {
            return if value == Point2::new(0, 0) {
                Ok(())
            } else {
                Err(SketchError::ImmutableReference(point.geometry.clone()))
            };
        }
        let entity = self
            .geometry
            .get_mut(&point.geometry)
            .ok_or_else(|| SketchError::MissingGeometry(point.geometry.clone()))?;
        set_point_of(entity, point.anchor, value)
    }
}

fn validate_operation(id: &str, operation: &SketchOperation) -> Result<(), SketchError> {
    let invalid = || Err(SketchError::InvalidOperation(id.to_owned()));
    let unique = |geometry: Vec<&GeometryId>| {
        geometry.iter().collect::<BTreeSet<_>>().len() == geometry.len()
    };
    if !unique(operation.sources()) || !unique(operation.results()) {
        return invalid();
    }
    match operation {
        SketchOperation::Offset {
            sources,
            result_chains,
            distance_nm,
            two_sided,
            model_tolerance_nm,
            result_spans,
            ..
        } if sources.is_empty()
            || *distance_nm == 0
            || *model_tolerance_nm <= 0
            || result_chains.len() != sources.len() * if *two_sided { 2 } else { 1 }
            || result_chains.iter().any(Vec::is_empty)
            || result_spans.as_ref().is_some_and(|span_chains| {
                span_chains.len() != result_chains.len()
                    || span_chains
                        .iter()
                        .zip(result_chains)
                        .any(|(spans, results)| {
                            spans.len() != results.len()
                                || spans
                                    .first()
                                    .is_none_or(|span| span.source_start_millionths != 0)
                                || spans
                                    .last()
                                    .is_none_or(|span| span.source_end_millionths != 1_000_000)
                                || spans.iter().zip(results).any(|(span, result)| {
                                    &span.result != result
                                        || span.source_start_millionths
                                            >= span.source_end_millionths
                                        || span.source_end_millionths > 1_000_000
                                        || span.certified_error_nm.is_some_and(|error| {
                                            error < 0 || error > *model_tolerance_nm
                                        })
                                })
                                || spans.windows(2).any(|pair| {
                                    pair[0].source_end_millionths != pair[1].source_start_millionths
                                })
                        })
            }) =>
        {
            invalid()
        }
        SketchOperation::Mirror {
            sources, results, ..
        } if sources.is_empty() || sources.len() != results.len() => invalid(),
        SketchOperation::LinearPattern {
            sources,
            instances,
            count,
            spacing,
            ..
        } if sources.is_empty()
            || *count < 1
            || (spacing.x_nm == 0 && spacing.y_nm == 0)
            || instances.len() != count.saturating_sub(1) as usize
            || instances
                .iter()
                .any(|instance| instance.len() != sources.len()) =>
        {
            invalid()
        }
        SketchOperation::CircularPattern {
            sources,
            instances,
            count,
            angle_microdegrees,
            ..
        } if sources.is_empty()
            || *count < 1
            || *angle_microdegrees == 0
            || instances.len() != count.saturating_sub(1) as usize
            || instances
                .iter()
                .any(|instance| instance.len() != sources.len()) =>
        {
            invalid()
        }
        SketchOperation::Fillet { radius_nm, .. } if *radius_nm <= 0 => invalid(),
        SketchOperation::Chamfer {
            first_distance_nm,
            second_distance_nm,
            angle_microdegrees,
            mode,
            ..
        } if *first_distance_nm <= 0
            || *second_distance_nm <= 0
            || (*mode == "distance_angle"
                && !(*angle_microdegrees > 0 && *angle_microdegrees < 90_000_000))
            || !matches!(
                mode.as_str(),
                "equal_distance" | "two_distance" | "distance_angle"
            ) =>
        {
            invalid()
        }
        SketchOperation::Break {
            results,
            parameters_millionths,
            ..
        } if parameters_millionths.is_empty()
            || parameters_millionths
                .iter()
                .any(|value| *value == 0 || *value >= 1_000_000)
            || !parameters_millionths
                .windows(2)
                .all(|values| values[0] < values[1])
            || results.len() != parameters_millionths.len() + 1 =>
        {
            invalid()
        }
        SketchOperation::Scale {
            sources,
            results,
            originals,
            factor_millionths,
            ..
        } if sources.is_empty()
            || sources.len() != results.len()
            || sources.len() != originals.len()
            || *factor_millionths <= 0 =>
        {
            invalid()
        }
        SketchOperation::MoveCopy {
            sources,
            results,
            originals,
            delta,
            ..
        } if sources.is_empty()
            || sources.len() != results.len()
            || sources.len() != originals.len()
            || (delta.x_nm == 0 && delta.y_nm == 0) =>
        {
            invalid()
        }
        SketchOperation::Blend {
            continuity,
            magnitude_nm,
            ..
        } if *magnitude_nm <= 0 || !matches!(continuity.as_str(), "tangent" | "g2") => invalid(),
        SketchOperation::ProjectInclude {
            source_kind,
            source_ids,
            results,
            missing,
            ..
        } if source_kind.is_empty()
            || source_ids.is_empty()
            || results.is_empty()
            || (!*missing && source_ids.len() != results.len()) =>
        {
            invalid()
        }
        _ => Ok(()),
    }
}

fn validate_geometry(entity: &GeometryEntity) -> Result<(), SketchError> {
    match &entity.geometry {
        Geometry::Line(line) if line.start == line.end => {
            Err(SketchError::DegenerateGeometry(entity.id.clone()))
        }
        Geometry::Circle(circle) if circle.radius_nm <= 0 => {
            Err(SketchError::DegenerateGeometry(entity.id.clone()))
        }
        Geometry::Arc(arc)
            if arc.start == arc.end
                || (distance(arc.center, arc.start) - distance(arc.center, arc.end)).abs()
                    > 1.0
                || squared_distance(arc.center, arc.start) == 0 =>
        {
            Err(SketchError::DegenerateGeometry(entity.id.clone()))
        }
        Geometry::Rectangle(rectangle)
            if rectangle.min.x_nm >= rectangle.max.x_nm
                || rectangle.min.y_nm >= rectangle.max.y_nm =>
        {
            Err(SketchError::DegenerateGeometry(entity.id.clone()))
        }
        Geometry::ControlPointSpline(spline)
            if spline.degree == 0
                || spline.control_points.len() < usize::from(spline.degree) + 1
                || (!spline.knots_millionths.is_empty()
                    && (spline.knots_millionths.len()
                        != spline.control_points.len() + usize::from(spline.degree) + 1
                        || spline
                            .knots_millionths
                            .windows(2)
                            .any(|pair| pair[0] > pair[1])
                        || spline.knots_millionths.first() != Some(&0)
                        || spline.knots_millionths.last() != Some(&1_000_000)))
                || spline
                    .control_points
                    .windows(2)
                    .all(|pair| pair[0] == pair[1]) =>
        {
            Err(SketchError::DegenerateGeometry(entity.id.clone()))
        }
        Geometry::FitPointSpline(spline)
            if spline.fit_points.len() != 4
                || spline.fit_points.windows(2).all(|pair| pair[0] == pair[1]) =>
        {
            Err(SketchError::DegenerateGeometry(entity.id.clone()))
        }
        Geometry::Ellipse(ellipse)
            if ellipse.center == ellipse.major
                || ellipse.center == ellipse.minor
                || ellipse_determinant(ellipse.center, ellipse.major, ellipse.minor) == 0
                || !ellipse_axes_perpendicular(ellipse.center, ellipse.major, ellipse.minor) =>
        {
            Err(SketchError::DegenerateGeometry(entity.id.clone()))
        }
        Geometry::EllipticalArc(arc)
            if ellipse_determinant(arc.center, arc.major, arc.minor) == 0
                || !ellipse_axes_perpendicular(arc.center, arc.major, arc.minor)
                || arc.start == arc.end
                || !point_on_ellipse(arc.center, arc.major, arc.minor, arc.start)
                || !point_on_ellipse(arc.center, arc.major, arc.minor, arc.end) =>
        {
            Err(SketchError::DegenerateGeometry(entity.id.clone()))
        }
        Geometry::Conic(conic) if conic.start == conic.end || conic.weight_millionths <= 0 => {
            Err(SketchError::DegenerateGeometry(entity.id.clone()))
        }
        _ => Ok(()),
    }
}

fn ellipse_axes_perpendicular(center: Point2, major: Point2, minor: Point2) -> bool {
    let major = [
        (major.x_nm - center.x_nm) as f64,
        (major.y_nm - center.y_nm) as f64,
    ];
    let minor = [
        (minor.x_nm - center.x_nm) as f64,
        (minor.y_nm - center.y_nm) as f64,
    ];
    let denominator = major[0].hypot(major[1]) * minor[0].hypot(minor[1]);
    denominator > 0.0
        && major[0].hypot(major[1]) + 1.0e-6 >= minor[0].hypot(minor[1])
        && (major[0] * minor[0] + major[1] * minor[1]).abs() / denominator <= 1.0e-5
}

fn distance(a: Point2, b: Point2) -> f64 {
    (a.x_nm as f64 - b.x_nm as f64).hypot(a.y_nm as f64 - b.y_nm as f64)
}

fn validate_constraint_types(sketch: &Sketch, constraint: &Constraint) -> Result<(), SketchError> {
    if matches!(
        constraint,
        Constraint::Distance { distance_nm, .. }
            | Constraint::DistanceX { distance_nm, .. }
            | Constraint::DistanceY { distance_nm, .. }
            | Constraint::PointLineDistance { distance_nm, .. }
            | Constraint::LineDistance { distance_nm, .. }
            | Constraint::OffsetDistance { distance_nm, .. }
            if *distance_nm < 0
    ) {
        return Err(SketchError::NegativeDimension);
    }
    let require_line = |id: &GeometryId| match &sketch.geometry[id].geometry {
        Geometry::Line(_) => Ok(()),
        _ => Err(SketchError::WrongGeometryKind(id.clone())),
    };
    match constraint {
        Constraint::FixedGeometry { .. } => Ok(()),
        Constraint::Horizontal { line }
        | Constraint::Vertical { line }
        | Constraint::AngleToAxis { line, .. }
        | Constraint::Midpoint { line, .. }
        | Constraint::Collinear { line, .. }
        | Constraint::PointLineDistance { line, .. }
        | Constraint::Symmetry { axis: line, .. } => require_line(line),
        Constraint::HorizontalPoints { .. } | Constraint::VerticalPoints { .. } => Ok(()),
        Constraint::Concentric { first, second } => {
            let require_round = |id: &GeometryId| {
                if matches!(
                    sketch.geometry[id].geometry,
                    Geometry::Circle(_) | Geometry::Arc(_)
                ) {
                    Ok(())
                } else {
                    Err(SketchError::WrongGeometryKind(id.clone()))
                }
            };
            require_round(first)?;
            require_round(second)
        }
        Constraint::PointOnObject { geometry, .. } => {
            if matches!(
                sketch.geometry[geometry].geometry,
                Geometry::Line(_)
                    | Geometry::Circle(_)
                    | Geometry::Arc(_)
                    | Geometry::ControlPointSpline(_)
                    | Geometry::FitPointSpline(_)
                    | Geometry::Ellipse(_)
                    | Geometry::EllipticalArc(_)
                    | Geometry::Conic(_)
            ) {
                Ok(())
            } else {
                Err(SketchError::WrongGeometryKind(geometry.clone()))
            }
        }
        Constraint::Parallel { first, second }
        | Constraint::Perpendicular { first, second }
        | Constraint::Angle { first, second, .. }
        | Constraint::LineDistance { first, second, .. } => {
            require_line(first)?;
            require_line(second)
        }
        Constraint::OffsetDistance {
            source,
            offset,
            source_start_millionths,
            source_end_millionths,
            ..
        } => {
            if source_start_millionths >= source_end_millionths
                || *source_end_millionths > 1_000_000
            {
                return Err(SketchError::WrongGeometryKind(source.clone()));
            }
            let source_capable = !matches!(
                sketch.geometry[source].geometry,
                Geometry::Rectangle(_) | Geometry::SketchPoint(_)
            );
            let result_capable = !matches!(
                sketch.geometry[offset].geometry,
                Geometry::Rectangle(_) | Geometry::SketchPoint(_)
            );
            if source_capable && result_capable {
                Ok(())
            } else {
                Err(SketchError::WrongGeometryKind(source.clone()))
            }
        }
        Constraint::Equal { first, second } => {
            let measurable = |id: &GeometryId| {
                if matches!(
                    sketch.geometry[id].geometry,
                    Geometry::Line(_)
                        | Geometry::Circle(_)
                        | Geometry::Arc(_)
                        | Geometry::ControlPointSpline(_)
                        | Geometry::FitPointSpline(_)
                        | Geometry::Ellipse(_)
                        | Geometry::EllipticalArc(_)
                        | Geometry::Conic(_)
                ) {
                    Ok(())
                } else {
                    Err(SketchError::WrongGeometryKind(id.clone()))
                }
            };
            measurable(first)?;
            measurable(second)
        }
        Constraint::Tangent { first, second, .. } => {
            // Straight lines have no isolated point of tangency. Parallel is
            // a separate retained relation and must not satisfy Tangent.
            if matches!(sketch.geometry[first].geometry, Geometry::Line(_))
                && matches!(sketch.geometry[second].geometry, Geometry::Line(_))
            {
                return Err(SketchError::WrongGeometryKind(second.clone()));
            }
            let tangent_capable = |id: &GeometryId| {
                if matches!(
                    sketch.geometry[id].geometry,
                    Geometry::Line(_)
                        | Geometry::Circle(_)
                        | Geometry::Arc(_)
                        | Geometry::ControlPointSpline(_)
                        | Geometry::FitPointSpline(_)
                        | Geometry::Ellipse(_)
                        | Geometry::EllipticalArc(_)
                        | Geometry::Conic(_)
                ) {
                    Ok(())
                } else {
                    Err(SketchError::WrongGeometryKind(id.clone()))
                }
            };
            tangent_capable(first)?;
            tangent_capable(second)
        }
        Constraint::CurvatureContinuous { first, second } => {
            let capable = |id: &GeometryId| {
                if matches!(
                    sketch.geometry[id].geometry,
                    Geometry::Line(_)
                        | Geometry::ControlPointSpline(_)
                        | Geometry::FitPointSpline(_)
                        | Geometry::Conic(_)
                ) {
                    Ok(())
                } else {
                    Err(SketchError::WrongGeometryKind(id.clone()))
                }
            };
            capable(first)?;
            capable(second)
        }
        Constraint::Radius {
            geometry,
            radius_nm,
        } => {
            if *radius_nm <= 0
                || !matches!(
                    sketch.geometry[geometry].geometry,
                    Geometry::Circle(_) | Geometry::Arc(_)
                )
            {
                Err(SketchError::WrongGeometryKind(geometry.clone()))
            } else {
                Ok(())
            }
        }
        Constraint::Diameter {
            geometry,
            diameter_nm,
        } => {
            if *diameter_nm <= 0
                || !matches!(
                    sketch.geometry[geometry].geometry,
                    Geometry::Circle(_) | Geometry::Arc(_)
                )
            {
                Err(SketchError::WrongGeometryKind(geometry.clone()))
            } else {
                Ok(())
            }
        }
        Constraint::EllipseRadius {
            geometry,
            axis,
            radius_nm,
        } => {
            if *radius_nm <= 0
                || !matches!(axis, Anchor::Major | Anchor::Minor)
                || !matches!(
                    sketch.geometry[geometry].geometry,
                    Geometry::Ellipse(_) | Geometry::EllipticalArc(_)
                )
            {
                Err(SketchError::WrongGeometryKind(geometry.clone()))
            } else {
                Ok(())
            }
        }
        _ => Ok(()),
    }
}

pub(crate) fn point_of(entity: &GeometryEntity, anchor: Anchor) -> Result<Point2, SketchError> {
    if let Anchor::CurveParameter(value) = anchor {
        return Ok(crate::curve::evaluate_curve(
            &entity.geometry,
            value as f64 / 1_000_000.0,
        ));
    }
    if let Anchor::Knot(index) = anchor {
        let (index, denominator) = match &entity.geometry {
            Geometry::ControlPointSpline(value) => {
                let knots = crate::curve::control_spline_knots(value);
                let knot_index = index.min(knots.len().saturating_sub(1) as u32) as usize;
                return Ok(crate::curve::evaluate_curve(
                    &entity.geometry,
                    knots[knot_index],
                ));
            }
            Geometry::FitPointSpline(value) => {
                let denominator = value.fit_points.len().saturating_sub(1).max(1);
                (index.min(denominator as u32), denominator)
            }
            _ => {
                return Err(SketchError::WrongAnchor {
                    geometry: entity.id.clone(),
                    anchor,
                });
            }
        };
        return Ok(crate::curve::evaluate_curve(
            &entity.geometry,
            index as f64 / denominator.max(1) as f64,
        ));
    }
    match (&entity.geometry, anchor) {
        (Geometry::Line(line), Anchor::Start) => Ok(line.start),
        (Geometry::Line(line), Anchor::End) => Ok(line.end),
        (Geometry::Circle(circle), Anchor::Center) => Ok(circle.center),
        (Geometry::Arc(arc), Anchor::Center) => Ok(arc.center),
        (Geometry::Arc(arc), Anchor::Start) => Ok(arc.start),
        (Geometry::Arc(arc), Anchor::End) => Ok(arc.end),
        (Geometry::Rectangle(rectangle), Anchor::Min) => Ok(rectangle.min),
        (Geometry::Rectangle(rectangle), Anchor::Max) => Ok(rectangle.max),
        (Geometry::ControlPointSpline(spline), Anchor::Start) => spline
            .control_points
            .first()
            .copied()
            .ok_or_else(|| SketchError::WrongAnchor {
                geometry: entity.id.clone(),
                anchor,
            }),
        (Geometry::ControlPointSpline(spline), Anchor::End) => spline
            .control_points
            .last()
            .copied()
            .ok_or_else(|| SketchError::WrongAnchor {
                geometry: entity.id.clone(),
                anchor,
            }),
        (Geometry::ControlPointSpline(spline), Anchor::ControlPoint(index)) => spline
            .control_points
            .get(index as usize)
            .copied()
            .ok_or_else(|| SketchError::WrongAnchor {
                geometry: entity.id.clone(),
                anchor,
            }),
        (Geometry::FitPointSpline(spline), Anchor::Start) => spline
            .fit_points
            .first()
            .copied()
            .ok_or_else(|| SketchError::WrongAnchor {
                geometry: entity.id.clone(),
                anchor,
            }),
        (Geometry::FitPointSpline(spline), Anchor::End) => spline
            .fit_points
            .last()
            .copied()
            .ok_or_else(|| SketchError::WrongAnchor {
                geometry: entity.id.clone(),
                anchor,
            }),
        (Geometry::FitPointSpline(spline), Anchor::FitPoint(index)) => spline
            .fit_points
            .get(index as usize)
            .copied()
            .ok_or_else(|| SketchError::WrongAnchor {
                geometry: entity.id.clone(),
                anchor,
            }),
        (Geometry::Ellipse(ellipse), Anchor::Center) => Ok(ellipse.center),
        (Geometry::Ellipse(ellipse), Anchor::Major) => Ok(ellipse.major),
        (Geometry::Ellipse(ellipse), Anchor::Minor) => Ok(ellipse.minor),
        (Geometry::EllipticalArc(arc), Anchor::Center) => Ok(arc.center),
        (Geometry::EllipticalArc(arc), Anchor::Major) => Ok(arc.major),
        (Geometry::EllipticalArc(arc), Anchor::Minor) => Ok(arc.minor),
        (Geometry::EllipticalArc(arc), Anchor::Start) => Ok(arc.start),
        (Geometry::EllipticalArc(arc), Anchor::End) => Ok(arc.end),
        (Geometry::Conic(conic), Anchor::Start) => Ok(conic.start),
        (Geometry::Conic(conic), Anchor::Control) => Ok(conic.control),
        (Geometry::Conic(conic), Anchor::End) => Ok(conic.end),
        (Geometry::SketchPoint(point), Anchor::Position) => Ok(*point),
        _ => Err(SketchError::WrongAnchor {
            geometry: entity.id.clone(),
            anchor,
        }),
    }
}

fn set_point_of(
    entity: &mut GeometryEntity,
    anchor: Anchor,
    value: Point2,
) -> Result<(), SketchError> {
    match (&mut entity.geometry, anchor) {
        (Geometry::Line(line), Anchor::Start) => line.start = value,
        (Geometry::Line(line), Anchor::End) => line.end = value,
        (Geometry::Circle(circle), Anchor::Center) => circle.center = value,
        (Geometry::Arc(arc), Anchor::Center) => {
            let delta = Point2::new(value.x_nm - arc.center.x_nm, value.y_nm - arc.center.y_nm);
            arc.center = value;
            arc.start = Point2::new(arc.start.x_nm + delta.x_nm, arc.start.y_nm + delta.y_nm);
            arc.end = Point2::new(arc.end.x_nm + delta.x_nm, arc.end.y_nm + delta.y_nm);
        }
        (Geometry::Arc(arc), Anchor::Start) => arc.start = value,
        (Geometry::Arc(arc), Anchor::End) => arc.end = value,
        (Geometry::Rectangle(rectangle), Anchor::Min) => rectangle.min = value,
        (Geometry::Rectangle(rectangle), Anchor::Max) => rectangle.max = value,
        (Geometry::ControlPointSpline(spline), Anchor::Start) => spline.control_points[0] = value,
        (Geometry::ControlPointSpline(spline), Anchor::End) => {
            if let Some(point) = spline.control_points.last_mut() {
                *point = value;
            }
        }
        (Geometry::ControlPointSpline(spline), Anchor::ControlPoint(index))
            if (index as usize) < spline.control_points.len() =>
        {
            spline.control_points[index as usize] = value;
        }
        (Geometry::FitPointSpline(spline), Anchor::Start) => spline.fit_points[0] = value,
        (Geometry::FitPointSpline(spline), Anchor::End) => {
            if let Some(point) = spline.fit_points.last_mut() {
                *point = value;
            }
        }
        (Geometry::FitPointSpline(spline), Anchor::FitPoint(index))
            if (index as usize) < spline.fit_points.len() =>
        {
            spline.fit_points[index as usize] = value
        }
        (Geometry::Ellipse(ellipse), Anchor::Center) => {
            let delta = Point2::new(
                value.x_nm - ellipse.center.x_nm,
                value.y_nm - ellipse.center.y_nm,
            );
            ellipse.center = value;
            ellipse.major = Point2::new(
                ellipse.major.x_nm + delta.x_nm,
                ellipse.major.y_nm + delta.y_nm,
            );
            ellipse.minor = Point2::new(
                ellipse.minor.x_nm + delta.x_nm,
                ellipse.minor.y_nm + delta.y_nm,
            );
        }
        (Geometry::Ellipse(ellipse), Anchor::Major) => ellipse.major = value,
        (Geometry::Ellipse(ellipse), Anchor::Minor) => ellipse.minor = value,
        (Geometry::EllipticalArc(arc), Anchor::Center) => {
            let delta = Point2::new(value.x_nm - arc.center.x_nm, value.y_nm - arc.center.y_nm);
            arc.center = value;
            for point in [&mut arc.major, &mut arc.minor, &mut arc.start, &mut arc.end] {
                *point = Point2::new(point.x_nm + delta.x_nm, point.y_nm + delta.y_nm);
            }
        }
        (Geometry::EllipticalArc(arc), Anchor::Major) => {
            let start = ellipse_coefficients(arc.center, arc.major, arc.minor, arc.start);
            let end = ellipse_coefficients(arc.center, arc.major, arc.minor, arc.end);
            arc.major = value;
            if let Some(coefficients) = start {
                arc.start =
                    ellipse_point_from_coefficients(arc.center, arc.major, arc.minor, coefficients);
            }
            if let Some(coefficients) = end {
                arc.end =
                    ellipse_point_from_coefficients(arc.center, arc.major, arc.minor, coefficients);
            }
        }
        (Geometry::EllipticalArc(arc), Anchor::Minor) => {
            let start = ellipse_coefficients(arc.center, arc.major, arc.minor, arc.start);
            let end = ellipse_coefficients(arc.center, arc.major, arc.minor, arc.end);
            arc.minor = value;
            if let Some(coefficients) = start {
                arc.start =
                    ellipse_point_from_coefficients(arc.center, arc.major, arc.minor, coefficients);
            }
            if let Some(coefficients) = end {
                arc.end =
                    ellipse_point_from_coefficients(arc.center, arc.major, arc.minor, coefficients);
            }
        }
        (Geometry::EllipticalArc(arc), Anchor::Start) => {
            arc.start = project_to_ellipse(arc.center, arc.major, arc.minor, value)
        }
        (Geometry::EllipticalArc(arc), Anchor::End) => {
            arc.end = project_to_ellipse(arc.center, arc.major, arc.minor, value)
        }
        (Geometry::Conic(conic), Anchor::Start) => conic.start = value,
        (Geometry::Conic(conic), Anchor::Control) => conic.control = value,
        (Geometry::Conic(conic), Anchor::End) => conic.end = value,
        (Geometry::SketchPoint(point), Anchor::Position) => *point = value,
        _ => {
            return Err(SketchError::WrongAnchor {
                geometry: entity.id.clone(),
                anchor,
            });
        }
    }
    Ok(())
}

pub(crate) fn squared_distance(a: Point2, b: Point2) -> i128 {
    let dx = i128::from(a.x_nm) - i128::from(b.x_nm);
    let dy = i128::from(a.y_nm) - i128::from(b.y_nm);
    dx * dx + dy * dy
}

fn ellipse_determinant(center: Point2, major: Point2, minor: Point2) -> i128 {
    (i128::from(major.x_nm) - i128::from(center.x_nm))
        * (i128::from(minor.y_nm) - i128::from(center.y_nm))
        - (i128::from(major.y_nm) - i128::from(center.y_nm))
            * (i128::from(minor.x_nm) - i128::from(center.x_nm))
}

fn ellipse_coefficients(
    center: Point2,
    major: Point2,
    minor: Point2,
    point: Point2,
) -> Option<(f64, f64)> {
    let ax = (major.x_nm - center.x_nm) as f64;
    let ay = (major.y_nm - center.y_nm) as f64;
    let bx = (minor.x_nm - center.x_nm) as f64;
    let by = (minor.y_nm - center.y_nm) as f64;
    let px = (point.x_nm - center.x_nm) as f64;
    let py = (point.y_nm - center.y_nm) as f64;
    let determinant = ax * by - ay * bx;
    if determinant.abs() <= f64::EPSILON {
        return None;
    }
    Some((
        (px * by - py * bx) / determinant,
        (ax * py - ay * px) / determinant,
    ))
}

fn ellipse_point_from_coefficients(
    center: Point2,
    major: Point2,
    minor: Point2,
    coefficients: (f64, f64),
) -> Point2 {
    let length = coefficients.0.hypot(coefficients.1).max(f64::EPSILON);
    let (a, b) = (coefficients.0 / length, coefficients.1 / length);
    Point2::new(
        (center.x_nm as f64
            + (major.x_nm - center.x_nm) as f64 * a
            + (minor.x_nm - center.x_nm) as f64 * b)
            .round() as i64,
        (center.y_nm as f64
            + (major.y_nm - center.y_nm) as f64 * a
            + (minor.y_nm - center.y_nm) as f64 * b)
            .round() as i64,
    )
}

pub(crate) fn project_to_ellipse(
    center: Point2,
    major: Point2,
    minor: Point2,
    point: Point2,
) -> Point2 {
    ellipse_coefficients(center, major, minor, point)
        .map(|coefficients| ellipse_point_from_coefficients(center, major, minor, coefficients))
        .unwrap_or(point)
}

fn point_on_ellipse(center: Point2, major: Point2, minor: Point2, point: Point2) -> bool {
    let Some((a, b)) = ellipse_coefficients(center, major, minor, point) else {
        return false;
    };
    (a.hypot(b) - 1.0).abs() * distance(center, major).max(distance(center, minor)) <= 2.0
}

#[derive(Debug, Error)]
pub enum SketchError {
    #[error("sketch id must not be empty")]
    EmptySketchId,
    #[error("constraint id must not be empty")]
    EmptyConstraintId,
    #[error("geometry identity does not match map key: {0:?}")]
    GeometryIdentityMismatch(GeometryId),
    #[error("geometry already exists: {0:?}")]
    DuplicateGeometry(GeometryId),
    #[error("implied sketch reference cannot be moved: {0:?}")]
    ImmutableReference(GeometryId),
    #[error("constraint already exists: {0:?}")]
    DuplicateConstraint(ConstraintId),
    #[error("geometry does not exist: {0:?}")]
    MissingGeometry(GeometryId),
    #[error("constraint does not exist: {0:?}")]
    MissingConstraint(ConstraintId),
    #[error("geometry is degenerate: {0:?}")]
    DegenerateGeometry(GeometryId),
    #[error("geometry has the wrong kind: {0:?}")]
    WrongGeometryKind(GeometryId),
    #[error("anchor {anchor:?} is invalid for geometry {geometry:?}")]
    WrongAnchor {
        geometry: GeometryId,
        anchor: Anchor,
    },
    #[error("dimension must not be negative")]
    NegativeDimension,
    #[error("trim point is not strictly inside geometry {0:?}")]
    InvalidTrim(GeometryId),
    #[error("revision overflow")]
    RevisionOverflow,
    #[error("canonical serialization failed: {0}")]
    Serialize(serde_json::Error),
    #[error("canonical deserialization failed: {0}")]
    Deserialize(serde_json::Error),
    #[error("2D constraint solver failed: {0}")]
    Solver(String),
    #[error("external reference for {0:?} is invalid")]
    InvalidExternalReference(GeometryId),
    #[error("composite sketch recipe is invalid: {0}")]
    InvalidRecipe(String),
    #[error("associative sketch operation is invalid: {0}")]
    InvalidOperation(String),
    #[error("offset_tolerance_unattainable: {0}")]
    OffsetToleranceUnattainable(String),
    #[error("singular_offset: {0}")]
    SingularOffset(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sketch_with_external_reference(stable_kernel_id: &str) -> Sketch {
        let geometry_id = GeometryId::from("line:external");
        let mut sketch = Sketch::new("sketch:external-reference");
        sketch.geometry.insert(
            geometry_id.clone(),
            GeometryEntity::new(
                geometry_id.clone(),
                Geometry::Line(Line {
                    start: Point2::new(0, 0),
                    end: Point2::new(10, 0),
                }),
            ),
        );
        sketch.external_references.insert(
            geometry_id,
            ExternalReference {
                body: "body:source".to_owned(),
                stable_kernel_id: stable_kernel_id.to_owned(),
            },
        );
        sketch
    }

    #[test]
    fn external_reference_accepts_canonical_u64_bounds_and_reemits_them_unchanged() {
        for stable_kernel_id in ["0", "18446744073709551615"] {
            let sketch = sketch_with_external_reference(stable_kernel_id);
            let bytes = sketch
                .canonical_bytes()
                .expect("canonical ID must serialize");
            let reloaded = Sketch::from_canonical_bytes(&bytes)
                .expect("canonical ID must deserialize and validate");

            assert_eq!(
                reloaded.external_references[&GeometryId::from("line:external")].stable_kernel_id,
                stable_kernel_id
            );
            assert_eq!(
                reloaded
                    .canonical_bytes()
                    .expect("reloaded sketch must re-emit"),
                bytes
            );
        }
    }

    #[test]
    fn external_reference_rejects_noncanonical_or_out_of_range_kernel_ids() {
        for stable_kernel_id in [
            "",
            "+1",
            "-1",
            "00",
            "01",
            " 1",
            "1 ",
            "18446744073709551616",
        ] {
            let sketch = sketch_with_external_reference(stable_kernel_id);
            assert!(matches!(
                sketch.validate(),
                Err(SketchError::InvalidExternalReference(id))
                    if id == GeometryId::from("line:external")
            ));
            assert!(matches!(
                sketch.canonical_bytes(),
                Err(SketchError::InvalidExternalReference(id))
                    if id == GeometryId::from("line:external")
            ));

            let bytes = serde_json::to_vec(&sketch).expect("typed sketch must serialize");
            assert!(matches!(
                Sketch::from_canonical_bytes(&bytes),
                Err(SketchError::InvalidExternalReference(id))
                    if id == GeometryId::from("line:external")
            ));
        }
    }

    #[test]
    fn external_reference_rejects_numeric_kernel_id_during_deserialization() {
        let sketch = sketch_with_external_reference("6");
        let mut value = serde_json::to_value(&sketch).expect("typed sketch must serialize");
        value["external_references"]["line:external"]["stable_kernel_id"] = serde_json::json!(6);

        assert!(matches!(
            Sketch::from_canonical_bytes(
                &serde_json::to_vec(&value).expect("mutated JSON must serialize")
            ),
            Err(SketchError::Deserialize(_))
        ));
    }
}
