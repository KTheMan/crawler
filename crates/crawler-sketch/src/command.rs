use crate::model::{
    Anchor, Arc, Constraint, ConstraintId, ControlPointSpline, Geometry, GeometryEntity,
    GeometryId, Line, OffsetResultSpan, Point2, PointRef, Sketch, SketchError, SketchOperation,
    SketchRecipe, squared_distance,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone)]
struct CachedOffsetPieces {
    source_geometry: Geometry,
    pieces: Vec<crate::curve::OffsetCurvePiece>,
}

fn remap_offset_result_ids(
    operation_id: &str,
    group: usize,
    previous_ids: &[GeometryId],
    previous_spans: Option<&[OffsetResultSpan]>,
    pieces: &[crate::curve::OffsetCurvePiece],
) -> Vec<GeometryId> {
    let mut available = previous_ids.to_vec();
    let old_intervals = previous_spans
        .map(|spans| {
            spans
                .iter()
                .map(|span| {
                    (
                        span.result.clone(),
                        span.source_start_millionths,
                        span.source_end_millionths,
                    )
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let mut next_serial = previous_ids
        .iter()
        .filter_map(|id| id.0.rsplit(':').next()?.parse::<usize>().ok())
        .max()
        .map_or(0, |value| value.saturating_add(1));
    pieces
        .iter()
        .enumerate()
        .map(|(index, piece)| {
            let start = (piece.source_start * 1_000_000.0).round() as u32;
            let end = if index + 1 == pieces.len() {
                1_000_000
            } else {
                (piece.source_end * 1_000_000.0).round() as u32
            };
            let choose = old_intervals
                .iter()
                .filter(|(id, _, _)| available.contains(id))
                .max_by_key(|(_, old_start, old_end)| {
                    let overlap = end.min(*old_end).saturating_sub(start.max(*old_start));
                    let exact = u32::from(start == *old_start && end == *old_end);
                    (exact, overlap, std::cmp::Reverse(*old_start))
                })
                .filter(|(_, old_start, old_end)| {
                    start == *old_start
                        || end == *old_end
                        || end.min(*old_end) > start.max(*old_start)
                })
                .map(|(id, _, _)| id.clone())
                .or_else(|| {
                    (old_intervals.is_empty() && previous_ids.len() == pieces.len())
                        .then(|| previous_ids.get(index).cloned())
                        .flatten()
                });
            let id = choose.unwrap_or_else(|| {
                let id = GeometryId(format!(
                    "operation:{operation_id}:offset:{group}:{next_serial}"
                ));
                next_serial = next_serial.saturating_add(1);
                id
            });
            available.retain(|candidate| candidate != &id);
            id
        })
        .collect()
}

#[derive(Default)]
struct OffsetGenerationCache {
    entries: BTreeMap<(GeometryId, i64, i64), CachedOffsetPieces>,
}

impl OffsetGenerationCache {
    fn generate(
        &mut self,
        operation_id: &str,
        source_id: &GeometryId,
        geometry: &Geometry,
        distance_nm: i64,
        tolerance_nm: i64,
    ) -> Result<Vec<crate::curve::OffsetCurvePiece>, SketchError> {
        let key = (source_id.clone(), distance_nm, tolerance_nm);
        if let Some(cached) = self
            .entries
            .get(&key)
            .filter(|cached| cached.source_geometry == *geometry)
        {
            return Ok(cached.pieces.clone());
        }
        let pieces = crate::curve::offset_curve_with_tolerance(geometry, distance_nm, tolerance_nm)
            .map_err(|error| map_offset_error(operation_id, error))?;
        self.entries.insert(
            key,
            CachedOffsetPieces {
                source_geometry: geometry.clone(),
                pieces: pieces.clone(),
            },
        );
        Ok(pieces)
    }
}

fn map_offset_error(operation_id: &str, error: crate::curve::OffsetCurveError) -> SketchError {
    match error {
        crate::curve::OffsetCurveError::OffsetToleranceUnattainable { .. } => {
            SketchError::OffsetToleranceUnattainable(operation_id.to_owned())
        }
        crate::curve::OffsetCurveError::SingularOffset => {
            SketchError::SingularOffset(operation_id.to_owned())
        }
    }
}

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
    SetConstraint {
        id: ConstraintId,
        constraint: Constraint,
    },
    RemoveConstraint {
        constraint: ConstraintId,
    },
    SetConstraintSuppressed {
        constraint: ConstraintId,
        suppressed: bool,
    },
    SetDimensionPosition {
        constraint: ConstraintId,
        position: Point2,
    },
    AddRecipe {
        id: String,
        recipe: SketchRecipe,
    },
    SetRecipe {
        id: String,
        recipe: SketchRecipe,
    },
    RemoveRecipe {
        id: String,
    },
    AddOperation {
        id: String,
        operation: SketchOperation,
    },
    SetOperation {
        id: String,
        operation: SketchOperation,
    },
    RemoveOperation {
        id: String,
    },
    MovePoint {
        point: PointRef,
        to: Point2,
    },
    SetRadius {
        geometry: GeometryId,
        radius_nm: i64,
    },
    SetConicWeight {
        geometry: GeometryId,
        weight_millionths: i64,
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
        let before = self.clone();
        let mut after = self.clone();
        let diagnostics = after.apply_in_place(&command)?;
        after.validate()?;
        Ok(CommandApplication {
            command,
            before,
            after,
            diagnostics,
        })
    }

    /// Apply an atomic command batch with one draft clone and one full model
    /// validation. Individual command guards still run in order, while the
    /// completed sketch is the only undo/history snapshot callers need.
    pub fn apply_batch(&self, commands: Vec<SketchCommand>) -> Result<Self, SketchError> {
        self.validate()?;
        let mut after = self.clone();
        for command in &commands {
            after.apply_in_place(command)?;
        }
        after.validate()?;
        Ok(after)
    }

    fn apply_in_place(
        &mut self,
        command: &SketchCommand,
    ) -> Result<Vec<CommandDiagnostic>, SketchError> {
        let mut diagnostics = Vec::new();
        let mut offset_cache = OffsetGenerationCache::default();
        match command {
            SketchCommand::AddGeometry { entity } => {
                if self.geometry.contains_key(&entity.id) {
                    return Err(SketchError::DuplicateGeometry(entity.id.clone()));
                }
                self.geometry.insert(entity.id.clone(), entity.clone());
            }
            SketchCommand::RemoveGeometry { geometry } => {
                remove_geometry(self, geometry, &mut diagnostics)?;
            }
            SketchCommand::AddConstraint { id, constraint } => {
                if self.constraints.contains_key(id) {
                    return Err(SketchError::DuplicateConstraint(id.clone()));
                }
                self.constraints.insert(id.clone(), constraint.clone());
            }
            SketchCommand::SetConstraint { id, constraint } => {
                if !self.constraints.contains_key(id) {
                    return Err(SketchError::MissingConstraint(id.clone()));
                }
                self.constraints.insert(id.clone(), constraint.clone());
            }
            SketchCommand::RemoveConstraint { constraint } => {
                if self.constraints.remove(constraint).is_none() {
                    return Err(SketchError::MissingConstraint(constraint.clone()));
                }
                self.dimension_parameters.remove(constraint);
                self.dimension_positions.remove(constraint);
                self.suppressed_constraints.remove(constraint);
            }
            SketchCommand::SetConstraintSuppressed {
                constraint,
                suppressed,
            } => {
                if !self.constraints.contains_key(constraint) {
                    return Err(SketchError::MissingConstraint(constraint.clone()));
                }
                if *suppressed {
                    self.suppressed_constraints.insert(constraint.clone());
                } else {
                    self.suppressed_constraints.remove(constraint);
                }
            }
            SketchCommand::SetDimensionPosition {
                constraint,
                position,
            } => {
                if !self.constraints.contains_key(constraint) {
                    return Err(SketchError::MissingConstraint(constraint.clone()));
                }
                self.dimension_positions
                    .insert(constraint.clone(), *position);
            }
            SketchCommand::AddRecipe { id, recipe } => {
                if id.is_empty() || self.recipes.contains_key(id) {
                    return Err(SketchError::InvalidRecipe(id.clone()));
                }
                self.recipes.insert(id.clone(), recipe.clone());
            }
            SketchCommand::SetRecipe { id, recipe } => {
                let previous = self
                    .recipes
                    .get(id)
                    .cloned()
                    .ok_or_else(|| SketchError::InvalidRecipe(id.clone()))?;
                if std::mem::discriminant(&previous) != std::mem::discriminant(recipe) {
                    return Err(SketchError::InvalidRecipe(id.clone()));
                }
                update_recipe_topology(self, id, &previous, recipe)?;
                regenerate_recipe_geometry(self, recipe)?;
                rebuild_recipe_constraints(self, id, recipe)?;
                self.recipes.insert(id.clone(), recipe.clone());
            }
            SketchCommand::RemoveRecipe { id } => {
                if self.recipes.remove(id).is_none() {
                    return Err(SketchError::InvalidRecipe(id.clone()));
                }
            }
            SketchCommand::AddOperation { id, operation } => {
                if id.is_empty() || self.operations.contains_key(id) {
                    return Err(SketchError::InvalidOperation(id.clone()));
                }
                prepare_operation_topology(self, None, operation)?;
                self.operations.insert(id.clone(), operation.clone());
                recompute_operation(self, id, operation, &mut offset_cache)?;
            }
            SketchCommand::SetOperation { id, operation } => {
                let previous = self
                    .operations
                    .remove(id)
                    .ok_or_else(|| SketchError::InvalidOperation(id.clone()))?;
                if std::mem::discriminant(&previous) != std::mem::discriminant(operation) {
                    return Err(SketchError::InvalidOperation(id.clone()));
                }
                prepare_operation_topology(self, Some(&previous), operation)?;
                self.operations.insert(id.clone(), operation.clone());
                recompute_operation(self, id, operation, &mut offset_cache)?;
            }
            SketchCommand::RemoveOperation { id } => {
                if self.operations.remove(id).is_none() {
                    return Err(SketchError::InvalidOperation(id.clone()));
                }
                remove_generated_constraints(self, id);
            }
            SketchCommand::MovePoint { point, to } => self.set_point(point, *to)?,
            SketchCommand::SetRadius {
                geometry,
                radius_nm,
            } => {
                if *radius_nm <= 0 {
                    return Err(SketchError::NegativeDimension);
                }
                let entity = self
                    .geometry
                    .get_mut(geometry)
                    .ok_or_else(|| SketchError::MissingGeometry(geometry.clone()))?;
                match &mut entity.geometry {
                    Geometry::Circle(circle) => circle.radius_nm = *radius_nm,
                    _ => return Err(SketchError::WrongGeometryKind(geometry.clone())),
                }
            }
            SketchCommand::SetConicWeight {
                geometry,
                weight_millionths,
            } => {
                if *weight_millionths <= 0 {
                    return Err(SketchError::NegativeDimension);
                }
                let entity = self
                    .geometry
                    .get_mut(geometry)
                    .ok_or_else(|| SketchError::MissingGeometry(geometry.clone()))?;
                match &mut entity.geometry {
                    Geometry::Conic(conic) => conic.weight_millionths = *weight_millionths,
                    _ => return Err(SketchError::WrongGeometryKind(geometry.clone())),
                }
            }
            SketchCommand::SetConstruction {
                geometry,
                construction,
            } => {
                self.geometry
                    .get_mut(geometry)
                    .ok_or_else(|| SketchError::MissingGeometry(geometry.clone()))?
                    .construction = *construction;
            }
            SketchCommand::Trim { operation } => apply_trim(self, operation, &mut diagnostics)?,
        }
        recompute_linked_operations(self, &mut offset_cache)?;
        self.revision = self
            .revision
            .checked_add(1)
            .ok_or(SketchError::RevisionOverflow)?;
        Ok(diagnostics)
    }
}

fn prepare_operation_topology(
    sketch: &mut Sketch,
    previous: Option<&SketchOperation>,
    operation: &SketchOperation,
) -> Result<(), SketchError> {
    for source in operation.sources() {
        if !sketch.geometry.contains_key(source) {
            return Err(SketchError::MissingGeometry(source.clone()));
        }
    }
    let previous_results = previous
        .map(SketchOperation::results)
        .unwrap_or_default()
        .into_iter()
        .cloned()
        .collect::<std::collections::BTreeSet<_>>();
    let next_results = operation
        .results()
        .into_iter()
        .cloned()
        .collect::<std::collections::BTreeSet<_>>();
    for id in previous_results.difference(&next_results) {
        if !operation.sources().into_iter().any(|source| source == id) {
            remove_generated_geometry(sketch, id);
        }
    }
    for id in &next_results {
        if sketch.geometry.contains_key(id) {
            continue;
        }
        let Some((source, geometry)) = operation_result_template(sketch, operation, id) else {
            return Err(SketchError::MissingGeometry(id.clone()));
        };
        sketch.geometry.insert(
            id.clone(),
            GeometryEntity {
                id: id.clone(),
                construction: source.construction,
                geometry,
            },
        );
    }
    Ok(())
}

fn operation_result_template(
    sketch: &Sketch,
    operation: &SketchOperation,
    result: &GeometryId,
) -> Option<(GeometryEntity, Geometry)> {
    let source_id = match operation {
        SketchOperation::Offset {
            sources,
            result_chains,
            ..
        } => result_chains
            .iter()
            .position(|chain| chain.contains(result))
            .and_then(|index| sources.get(index % sources.len())),
        SketchOperation::Mirror {
            sources, results, ..
        }
        | SketchOperation::Scale {
            sources, results, ..
        }
        | SketchOperation::MoveCopy {
            sources, results, ..
        } => results
            .iter()
            .position(|id| id == result)
            .and_then(|index| sources.get(index)),
        SketchOperation::LinearPattern {
            sources, instances, ..
        }
        | SketchOperation::CircularPattern {
            sources, instances, ..
        } => instances
            .iter()
            .find_map(|instance| instance.iter().position(|id| id == result))
            .and_then(|index| sources.get(index)),
        SketchOperation::Fillet { first, .. }
        | SketchOperation::Chamfer { first, .. }
        | SketchOperation::Blend { first, .. } => Some(first),
        SketchOperation::Break { source, .. } => Some(source),
        SketchOperation::ProjectInclude { .. } => None,
    }?;
    let source = sketch.geometry.get(source_id)?.clone();
    Some((source.clone(), source.geometry))
}

fn recompute_linked_operations(
    sketch: &mut Sketch,
    offset_cache: &mut OffsetGenerationCache,
) -> Result<(), SketchError> {
    let path_text = sketch
        .recipes
        .values()
        .filter(|recipe| matches!(recipe, SketchRecipe::Text { path: Some(_), .. }))
        .cloned()
        .collect::<Vec<_>>();
    for recipe in &path_text {
        regenerate_recipe_geometry(sketch, recipe)?;
    }
    // Multiple deterministic passes make simple operation chains associative
    // without introducing ordering into the durable document contract.
    for _ in 0..3 {
        synchronize_offset_topology(sketch, offset_cache)?;
        let operations = sketch
            .operations
            .iter()
            .map(|(id, operation)| (id.clone(), operation.clone()))
            .collect::<Vec<_>>();
        for (id, operation) in operations {
            let linked = match &operation {
                SketchOperation::Offset { linked, .. }
                | SketchOperation::Mirror { linked, .. }
                | SketchOperation::ProjectInclude { linked, .. } => *linked,
                _ => true,
            };
            if linked && !matches!(operation, SketchOperation::ProjectInclude { .. }) {
                recompute_operation(sketch, &id, &operation, offset_cache)?;
            }
        }
    }
    Ok(())
}

fn synchronize_offset_topology(
    sketch: &mut Sketch,
    offset_cache: &mut OffsetGenerationCache,
) -> Result<(), SketchError> {
    let offsets = sketch
        .operations
        .iter()
        .filter_map(|(id, operation)| match operation {
            SketchOperation::Offset { linked: true, .. } => Some((id.clone(), operation.clone())),
            _ => None,
        })
        .collect::<Vec<_>>();
    for (operation_id, mut operation) in offsets {
        let SketchOperation::Offset {
            sources,
            result_chains,
            two_sided,
            distance_nm,
            model_tolerance_nm,
            result_spans,
            ..
        } = &mut operation
        else {
            continue;
        };
        let groups = sources.len() * if *two_sided { 2 } else { 1 };
        result_chains.resize_with(groups, Vec::new);
        if let Some(span_chains) = result_spans {
            span_chains.resize_with(groups, Vec::new);
        }
        for group in 0..groups {
            let source = &sources[group % sources.len()];
            let signed_distance = if *two_sided && group >= sources.len() {
                distance_nm
                    .checked_neg()
                    .ok_or_else(|| SketchError::SingularOffset(operation_id.clone()))?
            } else {
                *distance_nm
            };
            let pieces = offset_cache.generate(
                &operation_id,
                source,
                &sketch.geometry[source].geometry,
                signed_distance,
                *model_tolerance_nm,
            )?;
            let previous_spans = result_spans
                .as_ref()
                .and_then(|span_chains| span_chains.get(group))
                .map(Vec::as_slice);
            result_chains[group] = remap_offset_result_ids(
                &operation_id,
                group,
                &result_chains[group],
                previous_spans,
                &pieces,
            );
            if let Some(span_chains) = result_spans {
                span_chains[group] = offset_result_spans(&result_chains[group], &pieces);
            }
        }
        let previous = sketch.operations.get(&operation_id).cloned();
        if previous.as_ref() != Some(&operation) {
            prepare_operation_topology(sketch, previous.as_ref(), &operation)?;
            sketch.operations.insert(operation_id, operation);
        }
    }
    Ok(())
}

fn recompute_operation(
    sketch: &mut Sketch,
    operation_id: &str,
    operation: &SketchOperation,
    offset_cache: &mut OffsetGenerationCache,
) -> Result<(), SketchError> {
    remove_generated_constraints(sketch, operation_id);
    match operation {
        SketchOperation::Offset {
            sources,
            result_chains,
            distance_nm,
            two_sided,
            linked,
            model_tolerance_nm,
            ..
        } => {
            if !*linked {
                return Ok(());
            }
            for (group_index, result_chain) in result_chains.iter().enumerate() {
                let source = &sources[group_index % sources.len()];
                let distance = if *two_sided && group_index >= sources.len() {
                    distance_nm
                        .checked_neg()
                        .ok_or_else(|| SketchError::SingularOffset(operation_id.to_owned()))?
                } else {
                    *distance_nm
                };
                let pieces = offset_cache.generate(
                    operation_id,
                    source,
                    &sketch.geometry[source].geometry,
                    distance,
                    *model_tolerance_nm,
                )?;
                for (index, result) in result_chain.iter().enumerate() {
                    replace_geometry(
                        sketch,
                        result,
                        pieces[index.min(pieces.len() - 1)].geometry.clone(),
                    )?;
                }
            }
            join_offset_line_results(sketch, sources, result_chains, *two_sided);
        }
        SketchOperation::Mirror {
            sources,
            axis,
            results,
            linked,
        } => {
            if !*linked {
                return Ok(());
            }
            let (axis_start, axis_end) = axis
                .as_ref()
                .map(|id| match &sketch.geometry[id].geometry {
                    Geometry::Line(line) => Ok((line.start, line.end)),
                    _ => Err(SketchError::WrongGeometryKind(id.clone())),
                })
                .transpose()?
                .unwrap_or((Point2::new(0, -1), Point2::new(0, 1)));
            for (source, result) in sources.iter().zip(results) {
                let geometry = transform_geometry(
                    &sketch.geometry[source].geometry,
                    |point| reflect_point(point, axis_start, axis_end),
                    true,
                );
                replace_geometry(sketch, result, geometry)?;
                if let (Some(axis), Geometry::Line(_), Geometry::Line(_)) = (
                    axis,
                    &sketch.geometry[source].geometry,
                    &sketch.geometry[result].geometry,
                ) {
                    for anchor in [Anchor::Start, Anchor::End] {
                        let suffix = match anchor {
                            Anchor::Start => "start",
                            _ => "end",
                        };
                        sketch.constraints.insert(
                            ConstraintId(format!(
                                "operation:{operation_id}:symmetry:{result:?}:{suffix}"
                            )),
                            Constraint::Symmetry {
                                first: PointRef::new(source.clone(), anchor),
                                second: PointRef::new(result.clone(), anchor),
                                axis: axis.clone(),
                            },
                        );
                    }
                }
            }
        }
        SketchOperation::LinearPattern {
            sources,
            instances,
            count,
            spacing,
            extent,
            suppressed_instances: _,
        } => {
            let divisor = if *extent {
                count.saturating_sub(1).max(1) as f64
            } else {
                1.0
            };
            for (instance_index, instance) in instances.iter().enumerate() {
                let multiplier = (instance_index + 1) as f64 / divisor;
                for (source, result) in sources.iter().zip(instance) {
                    let geometry = transform_geometry(
                        &sketch.geometry[source].geometry,
                        |point| {
                            Point2::new(
                                point.x_nm + (spacing.x_nm as f64 * multiplier).round() as i64,
                                point.y_nm + (spacing.y_nm as f64 * multiplier).round() as i64,
                            )
                        },
                        false,
                    );
                    replace_geometry(sketch, result, geometry)?;
                }
            }
        }
        SketchOperation::CircularPattern {
            sources,
            instances,
            center,
            count,
            angle_microdegrees,
            suppressed_instances: _,
        } => {
            let full = angle_microdegrees.unsigned_abs() == 360_000_000;
            let divisor = if full {
                *count
            } else {
                count.saturating_sub(1).max(1)
            } as f64;
            for (instance_index, instance) in instances.iter().enumerate() {
                let radians = (*angle_microdegrees as f64 / 1_000_000.0).to_radians()
                    * (instance_index + 1) as f64
                    / divisor;
                for (source, result) in sources.iter().zip(instance) {
                    let geometry = transform_geometry(
                        &sketch.geometry[source].geometry,
                        |point| rotate_point(point, *center, radians),
                        false,
                    );
                    replace_geometry(sketch, result, geometry)?;
                }
            }
        }
        SketchOperation::Fillet {
            first,
            second,
            result,
            radius_nm,
        } => {
            recompute_fillet(sketch, operation_id, first, second, result, *radius_nm)?;
        }
        SketchOperation::Chamfer {
            first,
            second,
            result,
            first_distance_nm,
            second_distance_nm,
            angle_microdegrees,
            mode,
        } => {
            let second_distance = if mode == "equal_distance" {
                *first_distance_nm
            } else if mode == "distance_angle" {
                ((*first_distance_nm as f64)
                    * (*angle_microdegrees as f64 / 1_000_000.0)
                        .to_radians()
                        .tan())
                .round()
                .abs() as i64
            } else {
                *second_distance_nm
            };
            recompute_chamfer(
                sketch,
                operation_id,
                first,
                second,
                result,
                *first_distance_nm,
                second_distance,
            )?;
        }
        SketchOperation::Break {
            source,
            results,
            parameters_millionths,
        } => {
            let parameters = parameters_millionths
                .iter()
                .map(|value| *value as f64 / 1_000_000.0)
                .collect::<Vec<_>>();
            let pieces = crate::curve::split_curve(&sketch.geometry[source].geometry, &parameters);
            if pieces.len() != results.len() {
                return Err(SketchError::InvalidOperation(operation_id.to_owned()));
            }
            for (result, geometry) in results.iter().zip(pieces) {
                replace_geometry(sketch, result, geometry)?;
            }
        }
        SketchOperation::Scale {
            sources,
            results,
            originals,
            center,
            factor_millionths,
            copy,
        } => {
            let factor = *factor_millionths as f64 / 1_000_000.0;
            for (index, (source, result)) in sources.iter().zip(results).enumerate() {
                let basis = if *copy {
                    &sketch.geometry[source].geometry
                } else {
                    &originals[index]
                };
                let geometry = transform_geometry(
                    basis,
                    |point| {
                        Point2::new(
                            center.x_nm
                                + ((point.x_nm - center.x_nm) as f64 * factor).round() as i64,
                            center.y_nm
                                + ((point.y_nm - center.y_nm) as f64 * factor).round() as i64,
                        )
                    },
                    false,
                );
                replace_geometry(sketch, result, geometry)?;
            }
        }
        SketchOperation::MoveCopy {
            sources,
            results,
            originals,
            delta,
            copy,
        } => {
            for (index, (source, result)) in sources.iter().zip(results).enumerate() {
                let basis = if *copy {
                    &sketch.geometry[source].geometry
                } else {
                    &originals[index]
                };
                let geometry = transform_geometry(
                    basis,
                    |point| Point2::new(point.x_nm + delta.x_nm, point.y_nm + delta.y_nm),
                    false,
                );
                replace_geometry(sketch, result, geometry)?;
            }
        }
        SketchOperation::Blend {
            first,
            second,
            result,
            continuity,
            magnitude_nm,
        } => {
            recompute_blend(
                sketch,
                operation_id,
                first,
                second,
                result,
                continuity,
                *magnitude_nm,
            )?;
        }
        SketchOperation::ProjectInclude { .. } => {}
    }
    Ok(())
}

fn offset_result_spans(
    results: &[GeometryId],
    pieces: &[crate::curve::OffsetCurvePiece],
) -> Vec<OffsetResultSpan> {
    let mut previous_end: u32 = 0;
    results
        .iter()
        .zip(pieces)
        .enumerate()
        .map(|(index, (result, piece))| {
            let start = previous_end;
            let end = if index + 1 == pieces.len() {
                1_000_000
            } else {
                ((piece.source_end * 1_000_000.0).round() as u32)
                    .clamp(start.saturating_add(1), 999_999)
            };
            previous_end = end;
            OffsetResultSpan {
                result: result.clone(),
                source_start_millionths: start,
                source_end_millionths: end,
                certified_error_nm: piece.certified.then(|| piece.error_bound_nm.ceil() as i64),
            }
        })
        .collect()
}

fn join_offset_line_results(
    sketch: &mut Sketch,
    sources: &[GeometryId],
    chains: &[Vec<GeometryId>],
    two_sided: bool,
) {
    let sides = if two_sided { 2 } else { 1 };
    for side in 0..sides {
        for index in 0..sources.len().saturating_sub(1) {
            // Joining is meaningful only for adjacent members of an ordered
            // contour. Legacy documents may contain a flat BFS component (or
            // even a branch), so never trim/extend two unrelated offset lines
            // merely because they are consecutive in serialized order.
            let (
                Some(GeometryEntity {
                    geometry: Geometry::Line(source_a),
                    ..
                }),
                Some(GeometryEntity {
                    geometry: Geometry::Line(source_b),
                    ..
                }),
            ) = (
                sketch.geometry.get(&sources[index]),
                sketch.geometry.get(&sources[index + 1]),
            )
            else {
                continue;
            };
            let source_members_share_endpoint = source_a.start == source_b.start
                || source_a.start == source_b.end
                || source_a.end == source_b.start
                || source_a.end == source_b.end;
            if !source_members_share_endpoint {
                continue;
            }
            let (Some(a_id), Some(b_id)) = (
                chains
                    .get(side * sources.len() + index)
                    .and_then(|chain| chain.last()),
                chains
                    .get(side * sources.len() + index + 1)
                    .and_then(|chain| chain.first()),
            ) else {
                continue;
            };
            let (Geometry::Line(a), Geometry::Line(b)) = (
                &sketch.geometry[a_id].geometry,
                &sketch.geometry[b_id].geometry,
            ) else {
                continue;
            };
            let (a, b) = (a.clone(), b.clone());
            let Some(join) = line_intersection(&a, &b) else {
                continue;
            };
            if let Geometry::Line(line) = &mut sketch.geometry.get_mut(a_id).unwrap().geometry {
                if squared_distance(line.start, join) < squared_distance(line.end, join) {
                    line.start = join;
                } else {
                    line.end = join;
                }
            }
            if let Geometry::Line(line) = &mut sketch.geometry.get_mut(b_id).unwrap().geometry {
                if squared_distance(line.start, join) < squared_distance(line.end, join) {
                    line.start = join;
                } else {
                    line.end = join;
                }
            }
        }
    }
}

fn replace_geometry(
    sketch: &mut Sketch,
    id: &GeometryId,
    geometry: Geometry,
) -> Result<(), SketchError> {
    sketch
        .geometry
        .get_mut(id)
        .ok_or_else(|| SketchError::MissingGeometry(id.clone()))?
        .geometry = geometry;
    Ok(())
}

fn transform_geometry(
    geometry: &Geometry,
    transform: impl Fn(Point2) -> Point2 + Copy,
    reverse: bool,
) -> Geometry {
    match geometry {
        Geometry::Line(value) => Geometry::Line(Line {
            start: transform(value.start),
            end: transform(value.end),
        }),
        Geometry::Circle(value) => Geometry::Circle(crate::model::Circle {
            center: transform(value.center),
            radius_nm: value.radius_nm,
        }),
        Geometry::Arc(value) => Geometry::Arc(Arc {
            center: transform(value.center),
            start: transform(value.start),
            end: transform(value.end),
            clockwise: if reverse {
                !value.clockwise
            } else {
                value.clockwise
            },
        }),
        Geometry::Rectangle(value) => {
            let first = transform(value.min);
            let second = transform(value.max);
            Geometry::Rectangle(crate::model::Rectangle {
                min: Point2::new(first.x_nm.min(second.x_nm), first.y_nm.min(second.y_nm)),
                max: Point2::new(first.x_nm.max(second.x_nm), first.y_nm.max(second.y_nm)),
            })
        }
        Geometry::ControlPointSpline(value) => Geometry::ControlPointSpline(ControlPointSpline {
            degree: value.degree,
            control_points: value
                .control_points
                .iter()
                .copied()
                .map(transform)
                .collect(),
            knots_millionths: value.knots_millionths.clone(),
        }),
        Geometry::FitPointSpline(value) => Geometry::FitPointSpline(crate::model::FitPointSpline {
            fit_points: value.fit_points.iter().copied().map(transform).collect(),
        }),
        Geometry::Ellipse(value) => Geometry::Ellipse(crate::model::Ellipse {
            center: transform(value.center),
            major: transform(value.major),
            minor: transform(value.minor),
        }),
        Geometry::EllipticalArc(value) => Geometry::EllipticalArc(crate::model::EllipticalArc {
            center: transform(value.center),
            major: transform(value.major),
            minor: transform(value.minor),
            start: transform(value.start),
            end: transform(value.end),
            clockwise: if reverse {
                !value.clockwise
            } else {
                value.clockwise
            },
        }),
        Geometry::Conic(value) => Geometry::Conic(crate::model::Conic {
            start: transform(value.start),
            control: transform(value.control),
            end: transform(value.end),
            weight_millionths: value.weight_millionths,
        }),
        Geometry::SketchPoint(value) => Geometry::SketchPoint(transform(*value)),
    }
}

fn reflect_point(point: Point2, start: Point2, end: Point2) -> Point2 {
    let dx = (end.x_nm - start.x_nm) as f64;
    let dy = (end.y_nm - start.y_nm) as f64;
    let denominator = dx * dx + dy * dy;
    let parameter = if denominator <= f64::EPSILON {
        0.0
    } else {
        ((point.x_nm - start.x_nm) as f64 * dx + (point.y_nm - start.y_nm) as f64 * dy)
            / denominator
    };
    let projection = Point2::new(
        start.x_nm + (dx * parameter).round() as i64,
        start.y_nm + (dy * parameter).round() as i64,
    );
    Point2::new(
        2 * projection.x_nm - point.x_nm,
        2 * projection.y_nm - point.y_nm,
    )
}

fn rotate_point(point: Point2, center: Point2, radians: f64) -> Point2 {
    let x = (point.x_nm - center.x_nm) as f64;
    let y = (point.y_nm - center.y_nm) as f64;
    Point2::new(
        center.x_nm + (x * radians.cos() - y * radians.sin()).round() as i64,
        center.y_nm + (x * radians.sin() + y * radians.cos()).round() as i64,
    )
}

fn line_intersection(first: &Line, second: &Line) -> Option<Point2> {
    let ax = (first.end.x_nm - first.start.x_nm) as f64;
    let ay = (first.end.y_nm - first.start.y_nm) as f64;
    let bx = (second.end.x_nm - second.start.x_nm) as f64;
    let by = (second.end.y_nm - second.start.y_nm) as f64;
    let denominator = ax * by - ay * bx;
    if denominator.abs() <= f64::EPSILON {
        return None;
    }
    let dx = (second.start.x_nm - first.start.x_nm) as f64;
    let dy = (second.start.y_nm - first.start.y_nm) as f64;
    let parameter = (dx * by - dy * bx) / denominator;
    Some(Point2::new(
        first.start.x_nm + (ax * parameter).round() as i64,
        first.start.y_nm + (ay * parameter).round() as i64,
    ))
}

fn unit(from: Point2, to: Point2) -> [f64; 2] {
    let x = (to.x_nm - from.x_nm) as f64;
    let y = (to.y_nm - from.y_nm) as f64;
    let length = x.hypot(y).max(1.0);
    [x / length, y / length]
}

fn offset_point(point: Point2, direction: [f64; 2], distance: f64) -> Point2 {
    Point2::new(
        point.x_nm + (direction[0] * distance).round() as i64,
        point.y_nm + (direction[1] * distance).round() as i64,
    )
}

fn recompute_fillet(
    sketch: &mut Sketch,
    operation_id: &str,
    first_id: &GeometryId,
    second_id: &GeometryId,
    result: &GeometryId,
    radius: i64,
) -> Result<(), SketchError> {
    let first = match &sketch.geometry[first_id].geometry {
        Geometry::Line(value) => value.clone(),
        _ => return Err(SketchError::WrongGeometryKind(first_id.clone())),
    };
    let second = match &sketch.geometry[second_id].geometry {
        Geometry::Line(value) => value.clone(),
        _ => return Err(SketchError::WrongGeometryKind(second_id.clone())),
    };
    let intersection = line_intersection(&first, &second)
        .ok_or_else(|| SketchError::InvalidOperation(operation_id.to_owned()))?;
    let first_far = if squared_distance(first.start, intersection)
        > squared_distance(first.end, intersection)
    {
        first.start
    } else {
        first.end
    };
    let second_far = if squared_distance(second.start, intersection)
        > squared_distance(second.end, intersection)
    {
        second.start
    } else {
        second.end
    };
    let first_direction = unit(intersection, first_far);
    let second_direction = unit(intersection, second_far);
    let cosine = (first_direction[0] * second_direction[0]
        + first_direction[1] * second_direction[1])
        .clamp(-0.999_999, 0.999_999);
    let half = cosine.acos() / 2.0;
    let tangent_distance = radius as f64 / half.tan().abs().max(1.0e-9);
    let first_tangent = offset_point(intersection, first_direction, tangent_distance);
    let second_tangent = offset_point(intersection, second_direction, tangent_distance);
    let bisector = [
        first_direction[0] + second_direction[0],
        first_direction[1] + second_direction[1],
    ];
    let length = bisector[0].hypot(bisector[1]).max(1.0e-9);
    let center = offset_point(
        intersection,
        [bisector[0] / length, bisector[1] / length],
        radius as f64 / half.sin().abs().max(1.0e-9),
    );
    set_line_corner(sketch, first_id, &first, intersection, first_tangent)?;
    set_line_corner(sketch, second_id, &second, intersection, second_tangent)?;
    let cross = first_direction[0] * second_direction[1] - first_direction[1] * second_direction[0];
    replace_geometry(
        sketch,
        result,
        Geometry::Arc(Arc {
            center,
            start: first_tangent,
            end: second_tangent,
            clockwise: cross > 0.0,
        }),
    )?;
    for (index, line) in [first_id, second_id].into_iter().enumerate() {
        sketch.constraints.insert(
            ConstraintId(format!("operation:{operation_id}:tangent:{index}")),
            Constraint::Tangent {
                first: line.clone(),
                second: result.clone(),
                first_parameter_millionths: None,
                second_parameter_millionths: None,
            },
        );
    }
    sketch.constraints.insert(
        ConstraintId(format!("operation:{operation_id}:radius")),
        Constraint::Radius {
            geometry: result.clone(),
            radius_nm: radius,
        },
    );
    Ok(())
}

fn recompute_chamfer(
    sketch: &mut Sketch,
    operation_id: &str,
    first_id: &GeometryId,
    second_id: &GeometryId,
    result: &GeometryId,
    first_distance: i64,
    second_distance: i64,
) -> Result<(), SketchError> {
    let first = match &sketch.geometry[first_id].geometry {
        Geometry::Line(value) => value.clone(),
        _ => return Err(SketchError::WrongGeometryKind(first_id.clone())),
    };
    let second = match &sketch.geometry[second_id].geometry {
        Geometry::Line(value) => value.clone(),
        _ => return Err(SketchError::WrongGeometryKind(second_id.clone())),
    };
    let intersection = line_intersection(&first, &second)
        .ok_or_else(|| SketchError::InvalidOperation(operation_id.to_owned()))?;
    let first_far = if squared_distance(first.start, intersection)
        > squared_distance(first.end, intersection)
    {
        first.start
    } else {
        first.end
    };
    let second_far = if squared_distance(second.start, intersection)
        > squared_distance(second.end, intersection)
    {
        second.start
    } else {
        second.end
    };
    let first_point = offset_point(
        intersection,
        unit(intersection, first_far),
        first_distance as f64,
    );
    let second_point = offset_point(
        intersection,
        unit(intersection, second_far),
        second_distance as f64,
    );
    set_line_corner(sketch, first_id, &first, intersection, first_point)?;
    set_line_corner(sketch, second_id, &second, intersection, second_point)?;
    replace_geometry(
        sketch,
        result,
        Geometry::Line(Line {
            start: first_point,
            end: second_point,
        }),
    )?;
    let first_anchor = if squared_distance(first.start, intersection)
        < squared_distance(first.end, intersection)
    {
        Anchor::Start
    } else {
        Anchor::End
    };
    let second_anchor = if squared_distance(second.start, intersection)
        < squared_distance(second.end, intersection)
    {
        Anchor::Start
    } else {
        Anchor::End
    };
    sketch.constraints.insert(
        ConstraintId(format!("operation:{operation_id}:coincident:0")),
        Constraint::Coincident {
            a: PointRef::new(first_id.clone(), first_anchor),
            b: PointRef::new(result.clone(), Anchor::Start),
        },
    );
    sketch.constraints.insert(
        ConstraintId(format!("operation:{operation_id}:coincident:1")),
        Constraint::Coincident {
            a: PointRef::new(second_id.clone(), second_anchor),
            b: PointRef::new(result.clone(), Anchor::End),
        },
    );
    Ok(())
}

fn set_line_corner(
    sketch: &mut Sketch,
    id: &GeometryId,
    original: &Line,
    intersection: Point2,
    target: Point2,
) -> Result<(), SketchError> {
    let Geometry::Line(line) = &mut sketch
        .geometry
        .get_mut(id)
        .ok_or_else(|| SketchError::MissingGeometry(id.clone()))?
        .geometry
    else {
        return Err(SketchError::WrongGeometryKind(id.clone()));
    };
    if squared_distance(original.start, intersection) < squared_distance(original.end, intersection)
    {
        line.start = target;
    } else {
        line.end = target;
    }
    Ok(())
}

fn recompute_blend(
    sketch: &mut Sketch,
    operation_id: &str,
    first: &GeometryId,
    second: &GeometryId,
    result: &GeometryId,
    continuity: &str,
    magnitude: i64,
) -> Result<(), SketchError> {
    let first_geometry = &sketch.geometry[first].geometry;
    let second_geometry = &sketch.geometry[second].geometry;
    let candidates = [(0.0, 0.0), (0.0, 1.0), (1.0, 0.0), (1.0, 1.0)];
    let (first_parameter, second_parameter) = candidates
        .into_iter()
        .min_by_key(|(a, b)| {
            squared_distance(
                crate::curve::evaluate_curve(first_geometry, *a),
                crate::curve::evaluate_curve(second_geometry, *b),
            )
        })
        .unwrap();
    let start_frame = crate::curve::evaluate_frame(first_geometry, first_parameter);
    let end_frame = crate::curve::evaluate_frame(second_geometry, second_parameter);
    let start_sign = if first_parameter == 0.0 { -1.0 } else { 1.0 };
    let end_sign = if second_parameter == 0.0 { -1.0 } else { 1.0 };
    let controls = vec![
        start_frame.point,
        offset_point(
            start_frame.point,
            [
                start_frame.tangent[0] * start_sign,
                start_frame.tangent[1] * start_sign,
            ],
            magnitude as f64,
        ),
        offset_point(
            end_frame.point,
            [
                end_frame.tangent[0] * end_sign,
                end_frame.tangent[1] * end_sign,
            ],
            magnitude as f64,
        ),
        end_frame.point,
    ];
    replace_geometry(
        sketch,
        result,
        Geometry::ControlPointSpline(ControlPointSpline {
            degree: 3,
            control_points: controls,
            knots_millionths: vec![0, 0, 0, 0, 1_000_000, 1_000_000, 1_000_000, 1_000_000],
        }),
    )?;
    sketch.constraints.insert(
        ConstraintId(format!("operation:{operation_id}:tangent:0")),
        Constraint::Tangent {
            first: first.clone(),
            second: result.clone(),
            first_parameter_millionths: Some((first_parameter * 1_000_000.0) as u32),
            second_parameter_millionths: Some(0),
        },
    );
    sketch.constraints.insert(
        ConstraintId(format!("operation:{operation_id}:tangent:1")),
        Constraint::Tangent {
            first: result.clone(),
            second: second.clone(),
            first_parameter_millionths: Some(1_000_000),
            second_parameter_millionths: Some((second_parameter * 1_000_000.0) as u32),
        },
    );
    if continuity == "g2" {
        sketch.constraints.insert(
            ConstraintId(format!("operation:{operation_id}:g2:0")),
            Constraint::CurvatureContinuous {
                first: first.clone(),
                second: result.clone(),
            },
        );
        sketch.constraints.insert(
            ConstraintId(format!("operation:{operation_id}:g2:1")),
            Constraint::CurvatureContinuous {
                first: result.clone(),
                second: second.clone(),
            },
        );
    }
    Ok(())
}

fn remove_generated_constraints(sketch: &mut Sketch, operation_id: &str) {
    let prefix = format!("operation:{operation_id}:");
    let ids = sketch
        .constraints
        .keys()
        .filter(|id| id.0.starts_with(&prefix))
        .cloned()
        .collect::<Vec<_>>();
    for id in ids {
        sketch.constraints.remove(&id);
        sketch.dimension_parameters.remove(&id);
        sketch.dimension_positions.remove(&id);
        sketch.suppressed_constraints.remove(&id);
    }
}

fn remove_generated_geometry(sketch: &mut Sketch, geometry: &GeometryId) {
    sketch.geometry.remove(geometry);
    sketch.external_references.remove(geometry);
    let constraints = sketch
        .constraints
        .iter()
        .filter(|(_, constraint)| constraint.referenced_geometry().contains(&geometry))
        .map(|(id, _)| id.clone())
        .collect::<Vec<_>>();
    for id in constraints {
        sketch.constraints.remove(&id);
        sketch.dimension_parameters.remove(&id);
        sketch.dimension_positions.remove(&id);
        sketch.suppressed_constraints.remove(&id);
    }
}

/// Rebuild a retained composite in-place. Member identifiers and their
/// constraint participation do not change, so downstream selections remain
/// stable while every defining recipe value is editable after reload.
fn regenerate_recipe_geometry(
    sketch: &mut Sketch,
    recipe: &SketchRecipe,
) -> Result<(), SketchError> {
    match recipe {
        SketchRecipe::Polygon {
            mode,
            center,
            radius_nm,
            sides,
            orientation_microdegrees,
            geometry,
        } => {
            if *radius_nm <= 0 || *sides < 3 || geometry.len() != *sides as usize {
                return Err(SketchError::InvalidRecipe("polygon".to_owned()));
            }
            let start =
                *orientation_microdegrees as f64 / 1_000_000.0 * std::f64::consts::PI / 180.0;
            let circumradius = if mode == "circumscribed" {
                *radius_nm as f64 / (std::f64::consts::PI / *sides as f64).cos()
            } else {
                *radius_nm as f64
            };
            let vertices = (0..*sides)
                .map(|index| {
                    let angle = start + std::f64::consts::TAU * index as f64 / *sides as f64;
                    Point2::new(
                        center.x_nm + (circumradius * angle.cos()).round() as i64,
                        center.y_nm + (circumradius * angle.sin()).round() as i64,
                    )
                })
                .collect::<Vec<_>>();
            for (index, id) in geometry.iter().enumerate() {
                let entity = sketch
                    .geometry
                    .get_mut(id)
                    .ok_or_else(|| SketchError::MissingGeometry(id.clone()))?;
                entity.geometry = Geometry::Line(Line {
                    start: vertices[index],
                    end: vertices[(index + 1) % vertices.len()],
                });
            }
        }
        SketchRecipe::Slot {
            mode,
            first,
            second,
            center,
            through,
            radius_nm,
            geometry,
        } => {
            if *radius_nm <= 0 || geometry.len() != 4 || squared_distance(*first, *second) == 0 {
                return Err(SketchError::InvalidRecipe("slot".to_owned()));
            }
            if mode == "three_point_arc" {
                let center = center.ok_or_else(|| SketchError::InvalidRecipe("slot".to_owned()))?;
                let through =
                    through.ok_or_else(|| SketchError::InvalidRecipe("slot".to_owned()))?;
                let centerline_radius =
                    (squared_distance(center, through) as f64).sqrt().round() as i64;
                if centerline_radius <= *radius_nm {
                    return Err(SketchError::InvalidRecipe("slot".to_owned()));
                }
                let radial = |point: Point2, radius: i64| {
                    let dx = (point.x_nm - center.x_nm) as f64;
                    let dy = (point.y_nm - center.y_nm) as f64;
                    let length = dx.hypot(dy);
                    Point2::new(
                        center.x_nm + (dx / length * radius as f64).round() as i64,
                        center.y_nm + (dy / length * radius as f64).round() as i64,
                    )
                };
                let cross = (first.x_nm - center.x_nm) as i128
                    * (through.y_nm - center.y_nm) as i128
                    - (first.y_nm - center.y_nm) as i128 * (through.x_nm - center.x_nm) as i128;
                let clockwise = cross < 0;
                let outer_start = radial(*first, centerline_radius + *radius_nm);
                let outer_end = radial(*second, centerline_radius + *radius_nm);
                let inner_start = radial(*first, centerline_radius - *radius_nm);
                let inner_end = radial(*second, centerline_radius - *radius_nm);
                let replacements = [
                    Geometry::Arc(Arc {
                        center,
                        start: outer_start,
                        end: outer_end,
                        clockwise,
                    }),
                    Geometry::Arc(Arc {
                        center: *second,
                        start: outer_end,
                        end: inner_end,
                        clockwise,
                    }),
                    Geometry::Arc(Arc {
                        center,
                        start: inner_end,
                        end: inner_start,
                        clockwise: !clockwise,
                    }),
                    Geometry::Arc(Arc {
                        center: *first,
                        start: inner_start,
                        end: outer_start,
                        clockwise,
                    }),
                ];
                for (id, replacement) in geometry.iter().zip(replacements) {
                    sketch
                        .geometry
                        .get_mut(id)
                        .ok_or_else(|| SketchError::MissingGeometry(id.clone()))?
                        .geometry = replacement;
                }
                return Ok(());
            }
            let dx = (second.x_nm - first.x_nm) as f64;
            let dy = (second.y_nm - first.y_nm) as f64;
            let length = dx.hypot(dy);
            let normal = [-dy / length, dx / length];
            let offset = |point: Point2, sign: f64| {
                Point2::new(
                    point.x_nm + (normal[0] * *radius_nm as f64 * sign).round() as i64,
                    point.y_nm + (normal[1] * *radius_nm as f64 * sign).round() as i64,
                )
            };
            let a_top = offset(*first, 1.0);
            let b_top = offset(*second, 1.0);
            let a_bottom = offset(*first, -1.0);
            let b_bottom = offset(*second, -1.0);
            let replacements = [
                Geometry::Line(Line {
                    start: a_top,
                    end: b_top,
                }),
                Geometry::Arc(Arc {
                    center: *second,
                    start: b_top,
                    end: b_bottom,
                    clockwise: true,
                }),
                Geometry::Line(Line {
                    start: b_bottom,
                    end: a_bottom,
                }),
                Geometry::Arc(Arc {
                    center: *first,
                    start: a_bottom,
                    end: a_top,
                    clockwise: true,
                }),
            ];
            for (id, replacement) in geometry.iter().zip(replacements) {
                sketch
                    .geometry
                    .get_mut(id)
                    .ok_or_else(|| SketchError::MissingGeometry(id.clone()))?
                    .geometry = replacement;
            }
        }
        SketchRecipe::Text {
            text,
            origin,
            height_nm,
            rotation_microdegrees,
            tracking_millionths,
            horizontal_alignment,
            path,
            path_start_millionths,
            reversed,
            geometry,
        } => {
            let replacements = text_recipe_geometry(
                sketch,
                text,
                *origin,
                *height_nm,
                *rotation_microdegrees,
                *tracking_millionths,
                horizontal_alignment,
                path.as_ref(),
                *path_start_millionths,
                *reversed,
            )?;
            if replacements.len() != geometry.len() {
                return Err(SketchError::InvalidRecipe("text".to_owned()));
            }
            for (id, replacement) in geometry.iter().zip(replacements) {
                sketch
                    .geometry
                    .get_mut(id)
                    .ok_or_else(|| SketchError::MissingGeometry(id.clone()))?
                    .geometry = replacement;
            }
        }
    }
    Ok(())
}

fn recipe_constraint_prefix(recipe_id: &str) -> String {
    format!("recipe:{recipe_id}:")
}

#[allow(clippy::too_many_arguments)]
fn text_recipe_geometry(
    sketch: &Sketch,
    text: &str,
    origin: Point2,
    height_nm: i64,
    rotation_microdegrees: i64,
    tracking_millionths: i64,
    alignment: &str,
    path: Option<&GeometryId>,
    path_start_millionths: u32,
    reversed: bool,
) -> Result<Vec<Geometry>, SketchError> {
    if text.is_empty() || height_nm <= 0 || tracking_millionths <= 0 {
        return Err(SketchError::InvalidRecipe("text".to_owned()));
    }
    let advance = height_nm as f64 * 0.8 * tracking_millionths as f64 / 1_000_000.0;
    let width = advance * text.chars().count().saturating_sub(1) as f64 + height_nm as f64 * 0.8;
    let offset = match alignment {
        "center" => -width / 2.0,
        "right" => -width,
        _ => 0.0,
    };
    let rotation = rotation_microdegrees as f64 / 1_000_000.0 * std::f64::consts::PI / 180.0;
    let path_geometry = path
        .map(|id| {
            sketch
                .geometry
                .get(id)
                .map(|value| &value.geometry)
                .ok_or_else(|| SketchError::MissingGeometry(id.clone()))
        })
        .transpose()?;
    let path_length = path_geometry.map(curve_length).unwrap_or(1.0).max(1.0);
    let start = path_start_millionths as f64 / 1_000_000.0;
    let transform = |x: f64, y: f64| -> Point2 {
        if let Some(curve) = path_geometry {
            let travel = offset + x;
            let parameter = if reversed {
                start - travel / path_length
            } else {
                start + travel / path_length
            }
            .clamp(0.0, 1.0);
            let frame = crate::curve::evaluate_frame(curve, parameter);
            let normal = if reversed {
                [frame.tangent[1], -frame.tangent[0]]
            } else {
                [-frame.tangent[1], frame.tangent[0]]
            };
            let baseline_clearance = height_nm as f64 * 0.12;
            Point2::new(
                frame.point.x_nm + (normal[0] * (y + baseline_clearance)).round() as i64,
                frame.point.y_nm + (normal[1] * (y + baseline_clearance)).round() as i64,
            )
        } else {
            let x = offset + x;
            Point2::new(
                origin.x_nm + (x * rotation.cos() - y * rotation.sin()).round() as i64,
                origin.y_nm + (x * rotation.sin() + y * rotation.cos()).round() as i64,
            )
        }
    };
    let mut output = Vec::new();
    for (index, character) in text.chars().enumerate() {
        let cursor = index as f64 * advance;
        for [x1, y1, x2, y2] in glyph_segments(character) {
            output.push(Geometry::Line(Line {
                start: transform(cursor + x1 * height_nm as f64, y1 * height_nm as f64),
                end: transform(cursor + x2 * height_nm as f64, y2 * height_nm as f64),
            }));
        }
    }
    Ok(output)
}

fn curve_length(geometry: &Geometry) -> f64 {
    let mut previous = crate::curve::evaluate_curve(geometry, 0.0);
    let mut length = 0.0;
    for index in 1..=96 {
        let next = crate::curve::evaluate_curve(geometry, index as f64 / 96.0);
        length += ((next.x_nm - previous.x_nm) as f64).hypot((next.y_nm - previous.y_nm) as f64);
        previous = next;
    }
    length
}

/// Compact, deterministic engineering stroke font. Every glyph is emitted as
/// ordinary native line geometry, so explode-to-curves is lossless.
fn glyph_segments(character: char) -> Vec<[f64; 4]> {
    const S: [[f64; 4]; 14] = [
        [0.0, 1.0, 0.8, 1.0],
        [0.0, 0.5, 0.8, 0.5],
        [0.0, 0.0, 0.8, 0.0],
        [0.0, 1.0, 0.0, 0.5],
        [0.0, 0.5, 0.0, 0.0],
        [0.8, 1.0, 0.8, 0.5],
        [0.8, 0.5, 0.8, 0.0],
        [0.0, 1.0, 0.4, 0.5],
        [0.8, 1.0, 0.4, 0.5],
        [0.4, 0.5, 0.0, 0.0],
        [0.4, 0.5, 0.8, 0.0],
        [0.4, 1.0, 0.4, 0.5],
        [0.4, 0.5, 0.4, 0.0],
        [0.0, 0.25, 0.8, 0.25],
    ];
    let indexes: &[usize] = match character.to_ascii_uppercase() {
        'A' => &[0, 1, 3, 4, 5, 6],
        'B' => &[0, 1, 2, 3, 4, 5, 6],
        'C' => &[0, 2, 3, 4],
        'D' => &[0, 2, 3, 4, 5, 6],
        'E' => &[0, 1, 2, 3, 4],
        'F' => &[0, 1, 3, 4],
        'G' => &[0, 1, 2, 3, 4, 6],
        'H' => &[1, 3, 4, 5, 6],
        'I' => &[0, 2, 11, 12],
        'J' => &[2, 5, 6, 4],
        'K' => &[3, 4, 8, 10],
        'L' => &[2, 3, 4],
        'M' => &[3, 4, 5, 6, 7, 8],
        'N' => &[3, 4, 5, 6, 7, 10],
        'O' => &[0, 2, 3, 4, 5, 6],
        'P' => &[0, 1, 3, 4, 5],
        'Q' => &[0, 2, 3, 4, 5, 6, 10],
        'R' => &[0, 1, 3, 4, 5, 10],
        'S' => &[0, 1, 2, 3, 6],
        'T' => &[0, 11, 12],
        'U' => &[2, 3, 4, 5, 6],
        'V' => &[3, 5, 9, 10],
        'W' => &[3, 4, 5, 6, 9, 10],
        'X' => &[7, 8, 9, 10],
        'Y' => &[7, 8, 12],
        'Z' => &[0, 2, 8, 9],
        '0' => &[0, 2, 3, 4, 5, 6],
        '1' => &[5, 6],
        '2' => &[0, 1, 2, 5, 4],
        '3' => &[0, 1, 2, 5, 6],
        '4' => &[1, 3, 5, 6],
        '5' => &[0, 1, 2, 3, 6],
        '6' => &[0, 1, 2, 3, 4, 6],
        '7' => &[0, 5, 6],
        '8' => &[0, 1, 2, 3, 4, 5, 6],
        '9' => &[0, 1, 2, 3, 5, 6],
        '-' => &[1],
        '_' => &[2],
        '+' => &[1, 11, 12],
        '=' => &[1, 13],
        '/' => &[8, 9],
        '\\' => &[7, 10],
        ' ' => &[],
        _ => &[0, 2, 3, 4, 5, 6, 7, 10],
    };
    indexes.iter().map(|index| S[*index]).collect()
}

/// Apply a composite topology edit while retaining every member identity that
/// is present in both the old and new recipe. New IDs must be supplied by the
/// caller so identity remains deterministic across the WASM boundary.
fn update_recipe_topology(
    sketch: &mut Sketch,
    recipe_id: &str,
    previous: &SketchRecipe,
    recipe: &SketchRecipe,
) -> Result<(), SketchError> {
    let old = previous.geometry();
    let new = recipe.geometry();
    let unique = new.iter().collect::<std::collections::BTreeSet<_>>();
    if unique.len() != new.len() {
        return Err(SketchError::InvalidRecipe(recipe_id.to_owned()));
    }
    for id in new {
        if !old.contains(id) && sketch.geometry.contains_key(id) {
            return Err(SketchError::DuplicateGeometry(id.clone()));
        }
    }

    let prefix = recipe_constraint_prefix(recipe_id);
    let generated = sketch
        .constraints
        .keys()
        .filter(|id| id.0.starts_with(&prefix))
        .cloned()
        .collect::<Vec<_>>();
    for id in generated {
        sketch.constraints.remove(&id);
        sketch.dimension_parameters.remove(&id);
        sketch.dimension_positions.remove(&id);
        sketch.suppressed_constraints.remove(&id);
    }

    for id in old.iter().filter(|id| !new.contains(id)) {
        let dependent = sketch
            .constraints
            .iter()
            .filter(|(_, constraint)| {
                constraint
                    .referenced_geometry()
                    .into_iter()
                    .any(|candidate| candidate == id)
            })
            .map(|(constraint_id, _)| constraint_id.clone())
            .collect::<Vec<_>>();
        for constraint_id in dependent {
            sketch.constraints.remove(&constraint_id);
            sketch.dimension_parameters.remove(&constraint_id);
            sketch.dimension_positions.remove(&constraint_id);
            sketch.suppressed_constraints.remove(&constraint_id);
        }
        sketch.geometry.remove(id);
        sketch.external_references.remove(id);
    }

    let construction = old
        .first()
        .and_then(|id| sketch.geometry.get(id))
        .map(|entity| entity.construction)
        .unwrap_or(false);
    for id in new.iter().filter(|id| !old.contains(id)) {
        sketch.geometry.insert(
            id.clone(),
            GeometryEntity {
                id: id.clone(),
                construction,
                geometry: Geometry::Line(Line {
                    start: Point2::new(0, 0),
                    end: Point2::new(1, 0),
                }),
            },
        );
    }
    Ok(())
}

fn rebuild_recipe_constraints(
    sketch: &mut Sketch,
    recipe_id: &str,
    recipe: &SketchRecipe,
) -> Result<(), SketchError> {
    let SketchRecipe::Polygon {
        sides, geometry, ..
    } = recipe
    else {
        return Ok(());
    };
    if geometry.len() != *sides as usize || geometry.len() < 3 {
        return Err(SketchError::InvalidRecipe(recipe_id.to_owned()));
    }
    let prefix = recipe_constraint_prefix(recipe_id);
    for index in 1..geometry.len() {
        sketch.constraints.insert(
            ConstraintId(format!("{prefix}equal:{index}")),
            Constraint::Equal {
                first: geometry[0].clone(),
                second: geometry[index].clone(),
            },
        );
    }
    let turn = (360_000_000_f64 / *sides as f64).round() as i64;
    for index in 0..geometry.len() {
        let id = ConstraintId(format!("{prefix}angle:{index}"));
        sketch.constraints.insert(
            id.clone(),
            Constraint::Angle {
                first: geometry[index].clone(),
                second: geometry[(index + 1) % geometry.len()].clone(),
                angle_microdegrees: turn,
            },
        );
        sketch.suppressed_constraints.insert(id);
    }
    Ok(())
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
    sketch.external_references.remove(geometry);
    sketch.recipes.retain(|_, recipe| {
        !recipe.geometry().contains(geometry)
            && !matches!(recipe, SketchRecipe::Text { path: Some(path), .. } if path == geometry)
    });
    let removed_operations = sketch
        .operations
        .iter()
        .filter(|(_, operation)| {
            operation.sources().contains(&geometry) || operation.results().contains(&geometry)
        })
        .map(|(id, _)| id.clone())
        .collect::<Vec<_>>();
    for id in removed_operations {
        sketch.operations.remove(&id);
        remove_generated_constraints(sketch, &id);
    }
    let removed: Vec<_> = sketch
        .constraints
        .iter()
        .filter(|(_, constraint)| constraint.referenced_geometry().contains(&geometry))
        .map(|(id, _)| id.clone())
        .collect();
    for constraint in removed {
        sketch.constraints.remove(&constraint);
        sketch.dimension_parameters.remove(&constraint);
        sketch.dimension_positions.remove(&constraint);
        sketch.suppressed_constraints.remove(&constraint);
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
