use crate::model::{
    Arc, Constraint, ConstraintId, Geometry, GeometryEntity, GeometryId, Line, Point2, PointRef,
    Sketch, SketchError, squared_distance,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum TrimOperation {
    SplitLine {
        source: GeometryId,
        first: GeometryId,
        second: GeometryId,
        at: Point2,
    },
    OpenCircle {
        source: GeometryId,
        replacement: GeometryId,
        start: Point2,
        end: Point2,
        clockwise: bool,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum SketchCommand {
    AddGeometry {
        entity: GeometryEntity,
    },
    RemoveGeometry {
        geometry: GeometryId,
    },
    AddConstraint {
        id: ConstraintId,
        constraint: Constraint,
    },
    RemoveConstraint {
        constraint: ConstraintId,
    },
    MovePoint {
        point: PointRef,
        to: Point2,
    },
    SetConstruction {
        geometry: GeometryId,
        construction: bool,
    },
    Trim {
        operation: TrimOperation,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum CommandDiagnostic {
    ConstraintRemovedWithGeometry {
        constraint: ConstraintId,
        geometry: GeometryId,
    },
}

/// Immutable edit result. Keeping `before` makes the accepted edit directly
/// undo-ready without synthesizing an inverse geometric operation.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CommandApplication {
    pub command: SketchCommand,
    pub before: Sketch,
    pub after: Sketch,
    pub diagnostics: Vec<CommandDiagnostic>,
}

impl CommandApplication {
    pub const fn undo_snapshot(&self) -> &Sketch {
        &self.before
    }

    pub const fn redo_snapshot(&self) -> &Sketch {
        &self.after
    }
}

impl Sketch {
    pub fn apply(&self, command: SketchCommand) -> Result<CommandApplication, SketchError> {
        self.validate()?;
        let mut after = self.clone();
        let mut diagnostics = Vec::new();
        match &command {
            SketchCommand::AddGeometry { entity } => {
                if after.geometry.contains_key(&entity.id) {
                    return Err(SketchError::DuplicateGeometry(entity.id.clone()));
                }
                after.geometry.insert(entity.id.clone(), entity.clone());
            }
            SketchCommand::RemoveGeometry { geometry } => {
                remove_geometry(&mut after, geometry, &mut diagnostics)?;
            }
            SketchCommand::AddConstraint { id, constraint } => {
                if after.constraints.contains_key(id) {
                    return Err(SketchError::DuplicateConstraint(id.clone()));
                }
                after.constraints.insert(id.clone(), constraint.clone());
            }
            SketchCommand::RemoveConstraint { constraint } => {
                if after.constraints.remove(constraint).is_none() {
                    return Err(SketchError::MissingConstraint(constraint.clone()));
                }
            }
            SketchCommand::MovePoint { point, to } => after.set_point(point, *to)?,
            SketchCommand::SetConstruction {
                geometry,
                construction,
            } => {
                after
                    .geometry
                    .get_mut(geometry)
                    .ok_or_else(|| SketchError::MissingGeometry(geometry.clone()))?
                    .construction = *construction;
            }
            SketchCommand::Trim { operation } => {
                apply_trim(&mut after, operation, &mut diagnostics)?
            }
        }
        after.revision = self
            .revision
            .checked_add(1)
            .ok_or(SketchError::RevisionOverflow)?;
        after.validate()?;
        Ok(CommandApplication {
            command,
            before: self.clone(),
            after,
            diagnostics,
        })
    }
}

fn apply_trim(
    sketch: &mut Sketch,
    operation: &TrimOperation,
    diagnostics: &mut Vec<CommandDiagnostic>,
) -> Result<(), SketchError> {
    match operation {
        TrimOperation::SplitLine {
            source,
            first,
            second,
            at,
        } => {
            ensure_new_ids(sketch, source, first, second)?;
            let entity = sketch
                .geometry
                .get(source)
                .ok_or_else(|| SketchError::MissingGeometry(source.clone()))?
                .clone();
            let Geometry::Line(line) = entity.geometry else {
                return Err(SketchError::WrongGeometryKind(source.clone()));
            };
            if !strictly_inside_line(&line, *at) {
                return Err(SketchError::InvalidTrim(source.clone()));
            }
            remove_geometry(sketch, source, diagnostics)?;
            sketch.geometry.insert(
                first.clone(),
                GeometryEntity {
                    id: first.clone(),
                    construction: entity.construction,
                    geometry: Geometry::Line(Line {
                        start: line.start,
                        end: *at,
                    }),
                },
            );
            sketch.geometry.insert(
                second.clone(),
                GeometryEntity {
                    id: second.clone(),
                    construction: entity.construction,
                    geometry: Geometry::Line(Line {
                        start: *at,
                        end: line.end,
                    }),
                },
            );
        }
        TrimOperation::OpenCircle {
            source,
            replacement,
            start,
            end,
            clockwise,
        } => {
            if source == replacement || sketch.geometry.contains_key(replacement) {
                return Err(SketchError::DuplicateGeometry(replacement.clone()));
            }
            let entity = sketch
                .geometry
                .get(source)
                .ok_or_else(|| SketchError::MissingGeometry(source.clone()))?
                .clone();
            let Geometry::Circle(circle) = entity.geometry else {
                return Err(SketchError::WrongGeometryKind(source.clone()));
            };
            let radius_squared = i128::from(circle.radius_nm) * i128::from(circle.radius_nm);
            if start == end
                || squared_distance(circle.center, *start) != radius_squared
                || squared_distance(circle.center, *end) != radius_squared
            {
                return Err(SketchError::InvalidTrim(source.clone()));
            }
            remove_geometry(sketch, source, diagnostics)?;
            sketch.geometry.insert(
                replacement.clone(),
                GeometryEntity {
                    id: replacement.clone(),
                    construction: entity.construction,
                    geometry: Geometry::Arc(Arc {
                        center: circle.center,
                        start: *start,
                        end: *end,
                        clockwise: *clockwise,
                    }),
                },
            );
        }
    }
    Ok(())
}

fn ensure_new_ids(
    sketch: &Sketch,
    source: &GeometryId,
    first: &GeometryId,
    second: &GeometryId,
) -> Result<(), SketchError> {
    for id in [first, second] {
        if id == source || sketch.geometry.contains_key(id) || first == second {
            return Err(SketchError::DuplicateGeometry(id.clone()));
        }
    }
    Ok(())
}

fn remove_geometry(
    sketch: &mut Sketch,
    geometry: &GeometryId,
    diagnostics: &mut Vec<CommandDiagnostic>,
) -> Result<(), SketchError> {
    if sketch.geometry.remove(geometry).is_none() {
        return Err(SketchError::MissingGeometry(geometry.clone()));
    }
    let removed: Vec<_> = sketch
        .constraints
        .iter()
        .filter(|(_, constraint)| constraint.referenced_geometry().contains(&geometry))
        .map(|(id, _)| id.clone())
        .collect();
    for constraint in removed {
        sketch.constraints.remove(&constraint);
        diagnostics.push(CommandDiagnostic::ConstraintRemovedWithGeometry {
            constraint,
            geometry: geometry.clone(),
        });
    }
    Ok(())
}

fn strictly_inside_line(line: &Line, point: Point2) -> bool {
    if point == line.start || point == line.end {
        return false;
    }
    let ax = i128::from(line.end.x_nm) - i128::from(line.start.x_nm);
    let ay = i128::from(line.end.y_nm) - i128::from(line.start.y_nm);
    let bx = i128::from(point.x_nm) - i128::from(line.start.x_nm);
    let by = i128::from(point.y_nm) - i128::from(line.start.y_nm);
    let collinear = ax * by == ay * bx;
    let dot = bx * ax + by * ay;
    let length_squared = ax * ax + ay * ay;
    collinear && dot > 0 && dot < length_squared
}
