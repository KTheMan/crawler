use crate::model::{
    Anchor, Constraint, ConstraintId, Geometry, GeometryId, Line, Point2, PointRef, Sketch,
    SketchError,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

const MAX_ITERATIONS: usize = 128;
const LENGTH_TOLERANCE_NM: f64 = 1.0;
const ANGLE_TOLERANCE_RADIANS: f64 = 2.0e-6;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SolveState {
    UnderConstrained,
    FullyConstrained,
    OverConstrained,
    Conflicting,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ConflictReason {
    HorizontalAndVertical {
        geometry: GeometryId,
    },
    ParallelAndPerpendicular {
        first: GeometryId,
        second: GeometryId,
    },
    ContradictoryDistance {
        a: PointRef,
        b: PointRef,
    },
    ContradictoryRadius {
        geometry: GeometryId,
    },
    ContradictoryAngle {
        first: GeometryId,
        second: GeometryId,
    },
    /// The listed constraints form a deterministic irreducible set whose
    /// geometric residual cannot be reduced below the alpha tolerance.
    GeometricResidual,
    ExcessIndependentConstraints,
    DragBlocked,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ConflictSet {
    pub constraints: Vec<ConstraintId>,
    pub reason: ConflictReason,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SolveResult {
    pub state: SolveState,
    pub degrees_of_freedom: u32,
    pub active_constraints: Vec<ConstraintId>,
    pub redundant_constraints: Vec<ConstraintId>,
    pub conflicts: Vec<ConflictSet>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SolvedSketch {
    /// Enforced geometry when the solve is feasible; the original geometry on
    /// conflict. Solving itself does not create a document revision.
    pub sketch: Sketch,
    pub solve: SolveResult,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DragRequest {
    pub point: PointRef,
    pub target: Point2,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ConstrainedDragResult {
    pub accepted: bool,
    pub sketch: Sketch,
    pub requested: Point2,
    pub resolved: Point2,
    pub solve: SolveResult,
}

pub trait SketchSolver {
    fn solve(&self, sketch: &Sketch) -> Result<SolveResult, SketchError>;

    fn constrained_drag(
        &self,
        sketch: &Sketch,
        request: DragRequest,
    ) -> Result<ConstrainedDragResult, SketchError>;
}

/// Deterministic integer-grid geometric solver.
///
/// Constraints are projected in stable constraint-ID order. Each projection
/// uses the first referenced entity as the datum and moves the second entity,
/// except during a drag where the driven point is preserved whenever the
/// constraint permits it. Projection stops at a fixed point or after a fixed
/// bounded iteration count, then every constraint is independently checked.
#[derive(Clone, Copy, Debug, Default)]
pub struct DeclarativeSolver;

impl DeclarativeSolver {
    pub fn solve_sketch(&self, sketch: &Sketch) -> Result<SolvedSketch, SketchError> {
        sketch.validate()?;
        let (active, redundant) = unique_constraints(sketch);
        let structural = structural_conflicts(sketch);
        if !structural.is_empty() {
            return Ok(SolvedSketch {
                sketch: sketch.clone(),
                solve: classify(sketch, active, redundant, structural),
            });
        }

        let mut candidate = sketch.clone();
        project_constraints(&mut candidate, &active, None)?;
        let unsatisfied = unsatisfied_constraints(&candidate, &active)?;
        let conflicts = if unsatisfied.is_empty() && candidate.validate().is_ok() {
            Vec::new()
        } else {
            vec![ConflictSet {
                constraints: irreducible_conflict(sketch, &active)?,
                reason: ConflictReason::GeometricResidual,
            }]
        };
        let solve = classify(sketch, active, redundant, conflicts);
        if solve.state == SolveState::Conflicting {
            candidate = sketch.clone();
        }
        Ok(SolvedSketch {
            sketch: candidate,
            solve,
        })
    }
}

impl SketchSolver for DeclarativeSolver {
    fn solve(&self, sketch: &Sketch) -> Result<SolveResult, SketchError> {
        Ok(self.solve_sketch(sketch)?.solve)
    }

    fn constrained_drag(
        &self,
        sketch: &Sketch,
        request: DragRequest,
    ) -> Result<ConstrainedDragResult, SketchError> {
        sketch.validate()?;
        let original_position = sketch.point(&request.point)?;
        let initial = self.solve_sketch(sketch)?;
        if initial.solve.state == SolveState::Conflicting {
            let mut solve = initial.solve;
            solve.conflicts.push(ConflictSet {
                constraints: constraints_for_point(sketch, &request.point),
                reason: ConflictReason::DragBlocked,
            });
            return Ok(rejected_drag(sketch, &request, original_position, solve));
        }

        let mut candidate = initial.sketch;
        set_solver_point(&mut candidate, &request.point, request.target)?;
        let (active, redundant) = unique_constraints(&candidate);
        project_constraints(&mut candidate, &active, Some(&request.point))?;

        let unsatisfied = unsatisfied_constraints(&candidate, &active)?;
        if !unsatisfied.is_empty() || candidate.validate().is_err() {
            let mut solve = self.solve(sketch)?;
            solve.conflicts.push(ConflictSet {
                constraints: if unsatisfied.is_empty() {
                    constraints_for_point(sketch, &request.point)
                } else {
                    unsatisfied
                },
                reason: ConflictReason::DragBlocked,
            });
            return Ok(rejected_drag(sketch, &request, original_position, solve));
        }

        candidate.revision = sketch
            .revision
            .checked_add(1)
            .ok_or(SketchError::RevisionOverflow)?;
        candidate.validate()?;
        let resolved = candidate.point(&request.point)?;
        let solve = classify(&candidate, active, redundant, Vec::new());
        Ok(ConstrainedDragResult {
            accepted: true,
            sketch: candidate,
            requested: request.target,
            resolved,
            solve,
        })
    }
}

fn rejected_drag(
    sketch: &Sketch,
    request: &DragRequest,
    resolved: Point2,
    solve: SolveResult,
) -> ConstrainedDragResult {
    ConstrainedDragResult {
        accepted: false,
        sketch: sketch.clone(),
        requested: request.target,
        resolved,
        solve,
    }
}

fn classify(
    sketch: &Sketch,
    active_constraints: Vec<ConstraintId>,
    redundant_constraints: Vec<ConstraintId>,
    mut conflicts: Vec<ConflictSet>,
) -> SolveResult {
    let total_dof: u32 = sketch
        .geometry
        .values()
        .map(|entity| geometry_dof(&entity.geometry))
        .sum();
    let consumed: u32 = active_constraints
        .iter()
        .map(|id| constraint_rank(&sketch.constraints[id]))
        .sum();
    let state = if !conflicts.is_empty() {
        SolveState::Conflicting
    } else if consumed > total_dof {
        conflicts.push(excess_conflict(sketch, &active_constraints, total_dof));
        SolveState::OverConstrained
    } else if consumed == total_dof {
        SolveState::FullyConstrained
    } else {
        SolveState::UnderConstrained
    };
    conflicts.sort_by(|a, b| a.constraints.cmp(&b.constraints));
    SolveResult {
        state,
        degrees_of_freedom: total_dof.saturating_sub(consumed),
        active_constraints,
        redundant_constraints,
        conflicts,
    }
}

fn geometry_dof(geometry: &Geometry) -> u32 {
    match geometry {
        Geometry::Line(_) => 4,
        Geometry::Circle(_) => 3,
        Geometry::Arc(_) => 5,
        Geometry::Rectangle(_) => 4,
    }
}

fn constraint_rank(constraint: &Constraint) -> u32 {
    match constraint {
        Constraint::Coincident { .. } => 2,
        _ => 1,
    }
}

fn unique_constraints(sketch: &Sketch) -> (Vec<ConstraintId>, Vec<ConstraintId>) {
    let mut fingerprints = BTreeSet::new();
    let mut active = Vec::new();
    let mut redundant = Vec::new();
    for (id, constraint) in &sketch.constraints {
        let fingerprint = constraint_fingerprint(constraint);
        if fingerprints.insert(fingerprint) {
            active.push(id.clone());
        } else {
            redundant.push(id.clone());
        }
    }
    (active, redundant)
}

fn constraint_fingerprint(constraint: &Constraint) -> Vec<u8> {
    let normalized = match constraint {
        Constraint::Coincident { a, b } => {
            let (a, b) = ordered_point_pair(a, b);
            Constraint::Coincident { a, b }
        }
        Constraint::Distance { a, b, distance_nm } => {
            let (a, b) = ordered_point_pair(a, b);
            Constraint::Distance {
                a,
                b,
                distance_nm: *distance_nm,
            }
        }
        Constraint::Parallel { first, second } => {
            let (first, second) = ordered_pair(first, second);
            Constraint::Parallel { first, second }
        }
        Constraint::Perpendicular { first, second } => {
            let (first, second) = ordered_pair(first, second);
            Constraint::Perpendicular { first, second }
        }
        Constraint::Tangent { first, second } => {
            let (first, second) = ordered_pair(first, second);
            Constraint::Tangent { first, second }
        }
        Constraint::Equal { first, second } => {
            let (first, second) = ordered_pair(first, second);
            Constraint::Equal { first, second }
        }
        other => other.clone(),
    };
    serde_json::to_vec(&normalized).expect("constraints are serializable")
}

fn project_constraints(
    sketch: &mut Sketch,
    ids: &[ConstraintId],
    driven: Option<&PointRef>,
) -> Result<(), SketchError> {
    for _ in 0..MAX_ITERATIONS {
        let before = sketch.geometry.clone();
        for id in ids {
            let constraint = sketch.constraints[id].clone();
            project_constraint(sketch, &constraint, driven)?;
        }
        if before == sketch.geometry {
            break;
        }
    }
    Ok(())
}

fn project_constraint(
    sketch: &mut Sketch,
    constraint: &Constraint,
    driven: Option<&PointRef>,
) -> Result<(), SketchError> {
    match constraint {
        Constraint::Coincident { a, b } => {
            let (source, target) = ordered_points_for_projection(a, b, driven);
            let value = sketch.point(source)?;
            set_solver_point(sketch, target, value)
        }
        Constraint::Horizontal { line } => project_axis(sketch, line, true, driven),
        Constraint::Vertical { line } => project_axis(sketch, line, false, driven),
        Constraint::Parallel { first, second } => {
            project_line_relation(sketch, first, second, 0.0, driven)
        }
        Constraint::Perpendicular { first, second } => {
            project_line_relation(sketch, first, second, std::f64::consts::FRAC_PI_2, driven)
        }
        Constraint::Angle {
            first,
            second,
            angle_microdegrees,
        } => project_line_relation(
            sketch,
            first,
            second,
            (*angle_microdegrees as f64).to_radians() / 1_000_000.0,
            driven,
        ),
        Constraint::Distance { a, b, distance_nm } => {
            project_distance(sketch, a, b, *distance_nm, driven)
        }
        Constraint::Radius {
            geometry,
            radius_nm,
        } => set_radius(sketch, geometry, *radius_nm),
        Constraint::Equal { first, second } => project_equal(sketch, first, second, driven),
        Constraint::Tangent { first, second } => project_tangent(sketch, first, second, driven),
    }
}

fn ordered_points_for_projection<'a>(
    a: &'a PointRef,
    b: &'a PointRef,
    driven: Option<&PointRef>,
) -> (&'a PointRef, &'a PointRef) {
    match driven {
        Some(point) if point == a => (a, b),
        Some(point) if point == b => (b, a),
        _ => (a, b),
    }
}

fn project_axis(
    sketch: &mut Sketch,
    id: &GeometryId,
    horizontal: bool,
    driven: Option<&PointRef>,
) -> Result<(), SketchError> {
    let start_ref = PointRef::new(id.clone(), Anchor::Start);
    let end_ref = PointRef::new(id.clone(), Anchor::End);
    let (source_ref, target_ref) = match driven {
        Some(point) if point == &end_ref => (&start_ref, &end_ref),
        Some(point) if point == &start_ref => (&end_ref, &start_ref),
        _ => (&start_ref, &end_ref),
    };
    let source = sketch.point(source_ref)?;
    let mut target = sketch.point(target_ref)?;
    if horizontal {
        target.y_nm = source.y_nm;
    } else {
        target.x_nm = source.x_nm;
    }
    sketch.set_point(target_ref, target)
}

fn project_distance(
    sketch: &mut Sketch,
    a: &PointRef,
    b: &PointRef,
    distance_nm: i64,
    driven: Option<&PointRef>,
) -> Result<(), SketchError> {
    let (fixed_ref, moving_ref) = ordered_points_for_projection(a, b, driven);
    let fixed = sketch.point(fixed_ref)?;
    let moving = sketch.point(moving_ref)?;
    let direction = unit_direction(fixed, moving);
    set_solver_point(
        sketch,
        moving_ref,
        offset(fixed, direction, distance_nm as f64),
    )
}

fn project_line_relation(
    sketch: &mut Sketch,
    first: &GeometryId,
    second: &GeometryId,
    angle: f64,
    driven: Option<&PointRef>,
) -> Result<(), SketchError> {
    let driven_first = driven.is_some_and(|point| point.geometry == *first);
    let (datum, moving, signed_angle) = if driven_first {
        (second, first, -angle)
    } else {
        (first, second, angle)
    };
    let datum_line = line_of(sketch, datum)?.clone();
    let moving_line = line_of(sketch, moving)?.clone();
    let datum_angle = direction_angle(datum_line.start, datum_line.end);
    let desired = datum_angle + signed_angle;
    set_line_direction(sketch, moving, &moving_line, desired, driven)
}

fn set_line_direction(
    sketch: &mut Sketch,
    id: &GeometryId,
    line: &Line,
    angle: f64,
    driven: Option<&PointRef>,
) -> Result<(), SketchError> {
    let start_ref = PointRef::new(id.clone(), Anchor::Start);
    let end_ref = PointRef::new(id.clone(), Anchor::End);
    let length = distance(line.start, line.end);
    let direction = (angle.cos(), angle.sin());
    if driven == Some(&end_ref) {
        let end = sketch.point(&end_ref)?;
        sketch.set_point(&start_ref, offset(end, direction, -length))
    } else {
        let start = sketch.point(&start_ref)?;
        sketch.set_point(&end_ref, offset(start, direction, length))
    }
}

fn project_equal(
    sketch: &mut Sketch,
    first: &GeometryId,
    second: &GeometryId,
    driven: Option<&PointRef>,
) -> Result<(), SketchError> {
    let driven_first = driven.is_some_and(|point| point.geometry == *first);
    let (datum, moving) = if driven_first {
        (second, first)
    } else {
        (first, second)
    };
    let measure = geometry_measure(sketch, datum)?;
    match &sketch.geometry[moving].geometry {
        Geometry::Line(line) => {
            let line = line.clone();
            let angle = direction_angle(line.start, line.end);
            set_line_direction(sketch, moving, &line, angle, driven)
                .and_then(|_| set_line_length(sketch, moving, measure, driven))
        }
        Geometry::Circle(_) | Geometry::Arc(_) => set_radius(sketch, moving, round_i64(measure)),
        Geometry::Rectangle(_) => Err(SketchError::WrongGeometryKind(moving.clone())),
    }
}

fn set_line_length(
    sketch: &mut Sketch,
    id: &GeometryId,
    length: f64,
    driven: Option<&PointRef>,
) -> Result<(), SketchError> {
    let line = line_of(sketch, id)?.clone();
    let start_ref = PointRef::new(id.clone(), Anchor::Start);
    let end_ref = PointRef::new(id.clone(), Anchor::End);
    let direction = unit_direction(line.start, line.end);
    if driven == Some(&end_ref) {
        sketch.set_point(&start_ref, offset(line.end, direction, -length))
    } else {
        sketch.set_point(&end_ref, offset(line.start, direction, length))
    }
}

fn project_tangent(
    sketch: &mut Sketch,
    first: &GeometryId,
    second: &GeometryId,
    driven: Option<&PointRef>,
) -> Result<(), SketchError> {
    let first_geometry = sketch.geometry[first].geometry.clone();
    let second_geometry = sketch.geometry[second].geometry.clone();
    match (&first_geometry, &second_geometry) {
        (Geometry::Line(line), Geometry::Circle(_) | Geometry::Arc(_)) => {
            tangent_line_round(sketch, first, line, second)
        }
        (Geometry::Circle(_) | Geometry::Arc(_), Geometry::Line(line)) => {
            tangent_line_round(sketch, second, line, first)
        }
        (Geometry::Circle(_) | Geometry::Arc(_), Geometry::Circle(_) | Geometry::Arc(_)) => {
            tangent_round_round(sketch, first, second, driven)
        }
        (Geometry::Line(_), Geometry::Line(_)) => {
            project_line_relation(sketch, first, second, 0.0, driven)
        }
        _ => Err(SketchError::WrongGeometryKind(second.clone())),
    }
}

fn tangent_line_round(
    sketch: &mut Sketch,
    _line_id: &GeometryId,
    line: &Line,
    round_id: &GeometryId,
) -> Result<(), SketchError> {
    let center = geometry_center(sketch, round_id)?;
    let radius = geometry_measure(sketch, round_id)?;
    let dx = (line.end.x_nm - line.start.x_nm) as f64;
    let dy = (line.end.y_nm - line.start.y_nm) as f64;
    let length = dx.hypot(dy);
    let signed = ((center.x_nm - line.start.x_nm) as f64 * -dy
        + (center.y_nm - line.start.y_nm) as f64 * dx)
        / length;
    let side = if signed < 0.0 { -1.0 } else { 1.0 };
    let correction = side * radius - signed;
    let next = Point2::new(
        round_i64(center.x_nm as f64 + correction * -dy / length),
        round_i64(center.y_nm as f64 + correction * dx / length),
    );
    translate_round_center(sketch, round_id, next)
}

fn tangent_round_round(
    sketch: &mut Sketch,
    first: &GeometryId,
    second: &GeometryId,
    driven: Option<&PointRef>,
) -> Result<(), SketchError> {
    let driven_first = driven.is_some_and(|point| point.geometry == *first);
    let (fixed_id, moving_id) = if driven_first {
        (second, first)
    } else {
        (first, second)
    };
    let fixed = geometry_center(sketch, fixed_id)?;
    let moving = geometry_center(sketch, moving_id)?;
    let target = geometry_measure(sketch, fixed_id)? + geometry_measure(sketch, moving_id)?;
    let next = offset(fixed, unit_direction(fixed, moving), target);
    translate_round_center(sketch, moving_id, next)
}

fn set_radius(sketch: &mut Sketch, id: &GeometryId, radius_nm: i64) -> Result<(), SketchError> {
    let entity = sketch
        .geometry
        .get_mut(id)
        .ok_or_else(|| SketchError::MissingGeometry(id.clone()))?;
    match &mut entity.geometry {
        Geometry::Circle(circle) => circle.radius_nm = radius_nm,
        Geometry::Arc(arc) => {
            let old_end = arc.end;
            arc.start = offset(
                arc.center,
                unit_direction(arc.center, arc.start),
                radius_nm as f64,
            );
            arc.end = matching_radius_point(arc.center, arc.start, old_end, arc.start);
        }
        _ => return Err(SketchError::WrongGeometryKind(id.clone())),
    }
    Ok(())
}

fn translate_round_center(
    sketch: &mut Sketch,
    id: &GeometryId,
    center: Point2,
) -> Result<(), SketchError> {
    let entity = sketch
        .geometry
        .get_mut(id)
        .ok_or_else(|| SketchError::MissingGeometry(id.clone()))?;
    match &mut entity.geometry {
        Geometry::Circle(circle) => circle.center = center,
        Geometry::Arc(arc) => {
            let dx = center.x_nm - arc.center.x_nm;
            let dy = center.y_nm - arc.center.y_nm;
            arc.center = center;
            arc.start = Point2::new(arc.start.x_nm + dx, arc.start.y_nm + dy);
            arc.end = Point2::new(arc.end.x_nm + dx, arc.end.y_nm + dy);
        }
        _ => return Err(SketchError::WrongGeometryKind(id.clone())),
    }
    Ok(())
}

fn set_solver_point(
    sketch: &mut Sketch,
    point: &PointRef,
    value: Point2,
) -> Result<(), SketchError> {
    let entity = sketch
        .geometry
        .get_mut(&point.geometry)
        .ok_or_else(|| SketchError::MissingGeometry(point.geometry.clone()))?;
    if let Geometry::Arc(arc) = &mut entity.geometry {
        match point.anchor {
            Anchor::Start => {
                let old_end = arc.end;
                arc.start = value;
                arc.end = matching_radius_point(arc.center, arc.start, old_end, arc.start);
                return Ok(());
            }
            Anchor::End => {
                let old_start = arc.start;
                arc.end = value;
                arc.start = matching_radius_point(arc.center, arc.end, old_start, arc.end);
                return Ok(());
            }
            _ => {}
        }
    }
    sketch.set_point(point, value)
}

/// Finds a point with exactly the same integer-grid radius as `radial_source`.
/// The eight axis/reflection symmetries are always exact lattice solutions;
/// selecting the one nearest `desired` keeps the arc stable without allowing
/// rounding to violate the model's exact equal-radius invariant.
fn matching_radius_point(
    center: Point2,
    radial_source: Point2,
    desired: Point2,
    avoid: Point2,
) -> Point2 {
    let x = radial_source.x_nm - center.x_nm;
    let y = radial_source.y_nm - center.y_nm;
    let mut candidates = BTreeSet::new();
    for (dx, dy) in [
        (x, y),
        (x, -y),
        (-x, y),
        (-x, -y),
        (y, x),
        (y, -x),
        (-y, x),
        (-y, -x),
    ] {
        candidates.insert(Point2::new(center.x_nm + dx, center.y_nm + dy));
    }
    candidates
        .into_iter()
        .filter(|point| *point != avoid)
        .min_by_key(|point| {
            let dx = i128::from(point.x_nm) - i128::from(desired.x_nm);
            let dy = i128::from(point.y_nm) - i128::from(desired.y_nm);
            dx * dx + dy * dy
        })
        .unwrap_or(avoid)
}

fn unsatisfied_constraints(
    sketch: &Sketch,
    ids: &[ConstraintId],
) -> Result<Vec<ConstraintId>, SketchError> {
    ids.iter()
        .filter_map(
            |id| match constraint_satisfied(sketch, &sketch.constraints[id]) {
                Ok(true) => None,
                Ok(false) => Some(Ok(id.clone())),
                Err(error) => Some(Err(error)),
            },
        )
        .collect()
}

fn constraint_satisfied(sketch: &Sketch, constraint: &Constraint) -> Result<bool, SketchError> {
    Ok(match constraint {
        Constraint::Coincident { a, b } => sketch.point(a)? == sketch.point(b)?,
        Constraint::Horizontal { line } => {
            let line = line_of(sketch, line)?;
            line.start.y_nm == line.end.y_nm
        }
        Constraint::Vertical { line } => {
            let line = line_of(sketch, line)?;
            line.start.x_nm == line.end.x_nm
        }
        Constraint::Parallel { first, second } => {
            line_angle_error(sketch, first, second, 0.0)? <= ANGLE_TOLERANCE_RADIANS
        }
        Constraint::Perpendicular { first, second } => {
            line_angle_error(sketch, first, second, std::f64::consts::FRAC_PI_2)?
                <= ANGLE_TOLERANCE_RADIANS
        }
        Constraint::Angle {
            first,
            second,
            angle_microdegrees,
        } => {
            let target = (*angle_microdegrees as f64).to_radians() / 1_000_000.0;
            line_angle_error(sketch, first, second, target)? <= ANGLE_TOLERANCE_RADIANS
        }
        Constraint::Distance { a, b, distance_nm } => {
            (distance(sketch.point(a)?, sketch.point(b)?) - *distance_nm as f64).abs()
                <= LENGTH_TOLERANCE_NM
        }
        Constraint::Radius {
            geometry,
            radius_nm,
        } => (geometry_measure(sketch, geometry)? - *radius_nm as f64).abs() <= LENGTH_TOLERANCE_NM,
        Constraint::Equal { first, second } => {
            (geometry_measure(sketch, first)? - geometry_measure(sketch, second)?).abs()
                <= LENGTH_TOLERANCE_NM
        }
        Constraint::Tangent { first, second } => tangent_satisfied(sketch, first, second)?,
    })
}

fn tangent_satisfied(
    sketch: &Sketch,
    first: &GeometryId,
    second: &GeometryId,
) -> Result<bool, SketchError> {
    match (
        &sketch.geometry[first].geometry,
        &sketch.geometry[second].geometry,
    ) {
        (Geometry::Line(a), Geometry::Line(b)) => Ok(angle_difference(
            direction_angle(a.start, a.end),
            direction_angle(b.start, b.end),
        )
        .min(
            (std::f64::consts::PI
                - angle_difference(
                    direction_angle(a.start, a.end),
                    direction_angle(b.start, b.end),
                ))
            .abs(),
        ) <= ANGLE_TOLERANCE_RADIANS),
        (Geometry::Line(line), Geometry::Circle(_) | Geometry::Arc(_)) => {
            line_round_tangent_satisfied(sketch, line, second)
        }
        (Geometry::Circle(_) | Geometry::Arc(_), Geometry::Line(line)) => {
            line_round_tangent_satisfied(sketch, line, first)
        }
        (Geometry::Circle(_) | Geometry::Arc(_), Geometry::Circle(_) | Geometry::Arc(_)) => {
            Ok((distance(
                geometry_center(sketch, first)?,
                geometry_center(sketch, second)?,
            ) - geometry_measure(sketch, first)?
                - geometry_measure(sketch, second)?)
            .abs()
                <= LENGTH_TOLERANCE_NM)
        }
        _ => Err(SketchError::WrongGeometryKind(second.clone())),
    }
}

fn line_round_tangent_satisfied(
    sketch: &Sketch,
    line: &Line,
    round: &GeometryId,
) -> Result<bool, SketchError> {
    let center = geometry_center(sketch, round)?;
    let dx = (line.end.x_nm - line.start.x_nm) as f64;
    let dy = (line.end.y_nm - line.start.y_nm) as f64;
    let numerator = ((center.x_nm - line.start.x_nm) as f64 * dy
        - (center.y_nm - line.start.y_nm) as f64 * dx)
        .abs();
    Ok((numerator / dx.hypot(dy) - geometry_measure(sketch, round)?).abs() <= LENGTH_TOLERANCE_NM)
}

fn irreducible_conflict(
    sketch: &Sketch,
    active: &[ConstraintId],
) -> Result<Vec<ConstraintId>, SketchError> {
    let mut core = active.to_vec();
    let mut index = 0;
    while index < core.len() && core.len() > 1 {
        let mut trial = core.clone();
        trial.remove(index);
        if !constraint_set_satisfiable(sketch, &trial)? {
            core = trial;
        } else {
            index += 1;
        }
    }
    Ok(core)
}

fn constraint_set_satisfiable(sketch: &Sketch, ids: &[ConstraintId]) -> Result<bool, SketchError> {
    let mut candidate = sketch.clone();
    project_constraints(&mut candidate, ids, None)?;
    Ok(candidate.validate().is_ok() && unsatisfied_constraints(&candidate, ids)?.is_empty())
}

fn structural_conflicts(sketch: &Sketch) -> Vec<ConflictSet> {
    let mut result = Vec::new();
    let mut horizontal = BTreeMap::new();
    let mut vertical = BTreeMap::new();
    let mut parallel = BTreeMap::new();
    let mut perpendicular = BTreeMap::new();
    let mut distances: BTreeMap<(PointRef, PointRef), (i64, ConstraintId)> = BTreeMap::new();
    let mut radii: BTreeMap<GeometryId, (i64, ConstraintId)> = BTreeMap::new();
    let mut angles: BTreeMap<(GeometryId, GeometryId), (i64, ConstraintId)> = BTreeMap::new();

    for (id, constraint) in &sketch.constraints {
        match constraint {
            Constraint::Horizontal { line } => {
                horizontal.entry(line.clone()).or_insert_with(|| id.clone());
            }
            Constraint::Vertical { line } => {
                vertical.entry(line.clone()).or_insert_with(|| id.clone());
            }
            Constraint::Parallel { first, second } => {
                parallel
                    .entry(ordered_pair(first, second))
                    .or_insert_with(|| id.clone());
            }
            Constraint::Perpendicular { first, second } => {
                perpendicular
                    .entry(ordered_pair(first, second))
                    .or_insert_with(|| id.clone());
            }
            Constraint::Distance { a, b, distance_nm } => {
                let key = ordered_point_pair(a, b);
                if let Some((prior, prior_id)) = distances.get(&key) {
                    if prior != distance_nm {
                        result.push(pair_conflict(
                            prior_id,
                            id,
                            ConflictReason::ContradictoryDistance {
                                a: key.0.clone(),
                                b: key.1.clone(),
                            },
                        ));
                    }
                } else {
                    distances.insert(key, (*distance_nm, id.clone()));
                }
            }
            Constraint::Radius {
                geometry,
                radius_nm,
            } => {
                if let Some((prior, prior_id)) = radii.get(geometry) {
                    if prior != radius_nm {
                        result.push(pair_conflict(
                            prior_id,
                            id,
                            ConflictReason::ContradictoryRadius {
                                geometry: geometry.clone(),
                            },
                        ));
                    }
                } else {
                    radii.insert(geometry.clone(), (*radius_nm, id.clone()));
                }
            }
            Constraint::Angle {
                first,
                second,
                angle_microdegrees,
            } => {
                let key = (first.clone(), second.clone());
                if let Some((prior, prior_id)) = angles.get(&key) {
                    if prior != angle_microdegrees {
                        result.push(pair_conflict(
                            prior_id,
                            id,
                            ConflictReason::ContradictoryAngle {
                                first: first.clone(),
                                second: second.clone(),
                            },
                        ));
                    }
                } else {
                    angles.insert(key, (*angle_microdegrees, id.clone()));
                }
            }
            _ => {}
        }
    }
    for (geometry, horizontal_id) in horizontal {
        if let Some(vertical_id) = vertical.get(&geometry) {
            result.push(pair_conflict(
                &horizontal_id,
                vertical_id,
                ConflictReason::HorizontalAndVertical { geometry },
            ));
        }
    }
    for (pair, parallel_id) in parallel {
        if let Some(perpendicular_id) = perpendicular.get(&pair) {
            result.push(pair_conflict(
                &parallel_id,
                perpendicular_id,
                ConflictReason::ParallelAndPerpendicular {
                    first: pair.0,
                    second: pair.1,
                },
            ));
        }
    }
    result
}

fn ordered_pair(a: &GeometryId, b: &GeometryId) -> (GeometryId, GeometryId) {
    if a <= b {
        (a.clone(), b.clone())
    } else {
        (b.clone(), a.clone())
    }
}

fn ordered_point_pair(a: &PointRef, b: &PointRef) -> (PointRef, PointRef) {
    if a <= b {
        (a.clone(), b.clone())
    } else {
        (b.clone(), a.clone())
    }
}

fn pair_conflict(a: &ConstraintId, b: &ConstraintId, reason: ConflictReason) -> ConflictSet {
    let mut constraints = vec![a.clone(), b.clone()];
    constraints.sort();
    ConflictSet {
        constraints,
        reason,
    }
}

fn excess_conflict(sketch: &Sketch, active: &[ConstraintId], total_dof: u32) -> ConflictSet {
    let mut ranked: Vec<_> = active
        .iter()
        .map(|id| {
            (
                std::cmp::Reverse(constraint_rank(&sketch.constraints[id])),
                id,
            )
        })
        .collect();
    ranked.sort();
    let mut rank = 0;
    let mut constraints = Vec::new();
    for (_, id) in ranked {
        constraints.push(id.clone());
        rank += constraint_rank(&sketch.constraints[id]);
        if rank > total_dof {
            break;
        }
    }
    constraints.sort();
    ConflictSet {
        constraints,
        reason: ConflictReason::ExcessIndependentConstraints,
    }
}

fn constraints_for_point(sketch: &Sketch, point: &PointRef) -> Vec<ConstraintId> {
    sketch
        .constraints
        .iter()
        .filter(|(_, constraint)| constraint.referenced_geometry().contains(&&point.geometry))
        .map(|(id, _)| id.clone())
        .collect()
}

fn line_of<'a>(sketch: &'a Sketch, id: &GeometryId) -> Result<&'a Line, SketchError> {
    match &sketch.geometry[id].geometry {
        Geometry::Line(line) => Ok(line),
        _ => Err(SketchError::WrongGeometryKind(id.clone())),
    }
}

fn geometry_center(sketch: &Sketch, id: &GeometryId) -> Result<Point2, SketchError> {
    match &sketch.geometry[id].geometry {
        Geometry::Circle(circle) => Ok(circle.center),
        Geometry::Arc(arc) => Ok(arc.center),
        _ => Err(SketchError::WrongGeometryKind(id.clone())),
    }
}

fn geometry_measure(sketch: &Sketch, id: &GeometryId) -> Result<f64, SketchError> {
    match &sketch.geometry[id].geometry {
        Geometry::Line(line) => Ok(distance(line.start, line.end)),
        Geometry::Circle(circle) => Ok(circle.radius_nm as f64),
        Geometry::Arc(arc) => Ok(distance(arc.center, arc.start)),
        Geometry::Rectangle(_) => Err(SketchError::WrongGeometryKind(id.clone())),
    }
}

fn line_angle_error(
    sketch: &Sketch,
    first: &GeometryId,
    second: &GeometryId,
    target: f64,
) -> Result<f64, SketchError> {
    let first = line_of(sketch, first)?;
    let second = line_of(sketch, second)?;
    Ok(angle_difference(
        direction_angle(first.start, first.end) + target,
        direction_angle(second.start, second.end),
    ))
}

fn direction_angle(start: Point2, end: Point2) -> f64 {
    ((end.y_nm - start.y_nm) as f64).atan2((end.x_nm - start.x_nm) as f64)
}

fn angle_difference(a: f64, b: f64) -> f64 {
    let mut difference = (a - b).rem_euclid(std::f64::consts::TAU);
    if difference > std::f64::consts::PI {
        difference = std::f64::consts::TAU - difference;
    }
    difference.abs()
}

fn distance(a: Point2, b: Point2) -> f64 {
    ((b.x_nm - a.x_nm) as f64).hypot((b.y_nm - a.y_nm) as f64)
}

fn unit_direction(a: Point2, b: Point2) -> (f64, f64) {
    let dx = (b.x_nm - a.x_nm) as f64;
    let dy = (b.y_nm - a.y_nm) as f64;
    let length = dx.hypot(dy);
    if length == 0.0 {
        (1.0, 0.0)
    } else {
        (dx / length, dy / length)
    }
}

fn offset(origin: Point2, direction: (f64, f64), length: f64) -> Point2 {
    Point2::new(
        round_i64(origin.x_nm as f64 + direction.0 * length),
        round_i64(origin.y_nm as f64 + direction.1 * length),
    )
}

fn round_i64(value: f64) -> i64 {
    value.round().clamp(i64::MIN as f64, i64::MAX as f64) as i64
}
