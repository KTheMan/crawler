use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
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

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Geometry {
    Line(Line),
    Circle(Circle),
    Arc(Arc),
    Rectangle(Rectangle),
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

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Anchor {
    Start,
    End,
    Center,
    Min,
    Max,
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
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Constraint {
    Coincident {
        a: PointRef,
        b: PointRef,
    },
    Horizontal {
        line: GeometryId,
    },
    Vertical {
        line: GeometryId,
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
    Radius {
        geometry: GeometryId,
        radius_nm: i64,
    },
    Angle {
        first: GeometryId,
        second: GeometryId,
        angle_microdegrees: i64,
    },
}

impl Constraint {
    pub(crate) fn referenced_geometry(&self) -> Vec<&GeometryId> {
        match self {
            Self::Coincident { a, b } | Self::Distance { a, b, .. } => {
                vec![&a.geometry, &b.geometry]
            }
            Self::Horizontal { line }
            | Self::Vertical { line }
            | Self::Radius { geometry: line, .. } => vec![line],
            Self::Parallel { first, second }
            | Self::Perpendicular { first, second }
            | Self::Tangent { first, second }
            | Self::Equal { first, second }
            | Self::Angle { first, second, .. } => vec![first, second],
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
}

impl Sketch {
    pub fn new(id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            revision: 0,
            geometry: BTreeMap::new(),
            constraints: BTreeMap::new(),
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
        let entity = self
            .geometry
            .get(&point.geometry)
            .ok_or_else(|| SketchError::MissingGeometry(point.geometry.clone()))?;
        point_of(entity, point.anchor)
    }

    pub(crate) fn set_point(&mut self, point: &PointRef, value: Point2) -> Result<(), SketchError> {
        let entity = self
            .geometry
            .get_mut(&point.geometry)
            .ok_or_else(|| SketchError::MissingGeometry(point.geometry.clone()))?;
        set_point_of(entity, point.anchor, value)
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
                || squared_distance(arc.center, arc.start)
                    != squared_distance(arc.center, arc.end)
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
        _ => Ok(()),
    }
}

fn validate_constraint_types(sketch: &Sketch, constraint: &Constraint) -> Result<(), SketchError> {
    let require_line = |id: &GeometryId| match &sketch.geometry[id].geometry {
        Geometry::Line(_) => Ok(()),
        _ => Err(SketchError::WrongGeometryKind(id.clone())),
    };
    match constraint {
        Constraint::Horizontal { line } | Constraint::Vertical { line } => require_line(line),
        Constraint::Parallel { first, second }
        | Constraint::Perpendicular { first, second }
        | Constraint::Angle { first, second, .. } => {
            require_line(first)?;
            require_line(second)
        }
        Constraint::Equal { first, second } => {
            let measurable = |id: &GeometryId| {
                if matches!(
                    sketch.geometry[id].geometry,
                    Geometry::Line(_) | Geometry::Circle(_) | Geometry::Arc(_)
                ) {
                    Ok(())
                } else {
                    Err(SketchError::WrongGeometryKind(id.clone()))
                }
            };
            measurable(first)?;
            measurable(second)
        }
        Constraint::Tangent { first, second } => {
            let tangent_capable = |id: &GeometryId| {
                if matches!(
                    sketch.geometry[id].geometry,
                    Geometry::Line(_) | Geometry::Circle(_) | Geometry::Arc(_)
                ) {
                    Ok(())
                } else {
                    Err(SketchError::WrongGeometryKind(id.clone()))
                }
            };
            tangent_capable(first)?;
            tangent_capable(second)
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
        Constraint::Distance { distance_nm, .. } if *distance_nm < 0 => {
            Err(SketchError::NegativeDimension)
        }
        _ => Ok(()),
    }
}

pub(crate) fn point_of(entity: &GeometryEntity, anchor: Anchor) -> Result<Point2, SketchError> {
    match (&entity.geometry, anchor) {
        (Geometry::Line(line), Anchor::Start) => Ok(line.start),
        (Geometry::Line(line), Anchor::End) => Ok(line.end),
        (Geometry::Circle(circle), Anchor::Center) => Ok(circle.center),
        (Geometry::Arc(arc), Anchor::Center) => Ok(arc.center),
        (Geometry::Arc(arc), Anchor::Start) => Ok(arc.start),
        (Geometry::Arc(arc), Anchor::End) => Ok(arc.end),
        (Geometry::Rectangle(rectangle), Anchor::Min) => Ok(rectangle.min),
        (Geometry::Rectangle(rectangle), Anchor::Max) => Ok(rectangle.max),
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
}
