use crate::model::{
    Anchor, Axis2d, Constraint, ConstraintId, Geometry, GeometryId, Line, Point2, PointRef, Sketch,
    SketchError,
};
use crate::{Decomposition, SolveComponent};
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
    ContradictoryAxisAngle {
        line: GeometryId,
        axis: Axis2d,
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
    /// Count of scalar variables EZPZ identifies as participating in free
    /// motion. Unlike `degrees_of_freedom`, this is not a null-space rank.
    pub underconstrained_variables: u32,
    /// Deterministic graph plan actually submitted to the backend.
    pub solve_components: Vec<SolveComponent>,
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

/// Stable description of the implementation behind the Crawler sketch DTO.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SolverContract {
    pub schema_version: u32,
    pub frontend: String,
    pub backend: String,
    pub backend_version: String,
    pub numeric_units: String,
    /// EZPZ owns only the plane-local 2D values. Resolving durable plane
    /// references and projecting them into model space happens outside the
    /// solver so the same constraint graph is invariant across XY/XZ/YZ.
    pub coordinate_space: String,
    pub support_reference_kinds: Vec<String>,
    pub resolved_plane_frame_fields: Vec<String>,
    pub geometry_kinds: Vec<String>,
    pub constraint_kinds: Vec<String>,
    pub operations: Vec<String>,
    pub diagnostics: Vec<String>,
}

pub trait SketchSolver {
    fn solve(&self, sketch: &Sketch) -> Result<SolveResult, SketchError>;

    fn constrained_drag(
        &self,
        sketch: &Sketch,
        request: DragRequest,
    ) -> Result<ConstrainedDragResult, SketchError>;
}

/// Graph-decomposed KittyCAD EZPZ solver for the Crawler sketch contract.
#[derive(Clone, Copy, Debug, Default)]
pub struct EzpzSolver;

impl EzpzSolver {
    pub fn contract(&self) -> SolverContract {
        SolverContract {
            schema_version: 2,
            frontend: "planegcs_inspired_graph_decomposition".into(),
            backend: "kittycad_ezpz".into(),
            backend_version: "0.2.28".into(),
            numeric_units: "integer_nanometers".into(),
            coordinate_space: "resolved_plane_local_2d".into(),
            support_reference_kinds: [
                "origin_plane",
                "origin_plane_reference",
                "topology",
                "construction_plane_reference",
            ]
            .into_iter()
            .map(str::to_owned)
            .collect(),
            resolved_plane_frame_fields: [
                "origin_nanometers",
                "x_axis_millionths",
                "y_axis_millionths",
                "normal_millionths",
            ]
            .into_iter()
            .map(str::to_owned)
            .collect(),
            geometry_kinds: [
                "line",
                "circle",
                "arc",
                "rectangle",
                "control_point_spline",
                "fit_point_spline",
                "ellipse",
                "elliptical_arc",
                "conic",
                "sketch_point",
            ]
            .into_iter()
            .map(str::to_owned)
            .collect(),
            constraint_kinds: [
                "coincident",
                "point_on_origin",
                "fixed",
                "fixed_geometry",
                "midpoint",
                "concentric",
                "point_on_object",
                "horizontal",
                "vertical",
                "horizontal_points",
                "vertical_points",
                "collinear",
                "symmetry",
                "curvature_continuous",
                "parallel",
                "perpendicular",
                "tangent",
                "equal",
                "distance",
                "distance_x",
                "distance_y",
                "point_line_distance",
                "line_distance",
                "offset_distance",
                "radius",
                "diameter",
                "ellipse_radius",
                "angle",
                "angle_to_axis",
            ]
            .into_iter()
            .map(str::to_owned)
            .collect(),
            operations: [
                "apply_command",
                "apply_commands",
                "solve",
                "constrained_drag",
                "decompose",
                "import_dxf",
                "export_dxf",
            ]
            .into_iter()
            .map(str::to_owned)
            .collect(),
            diagnostics: [
                "solve_state",
                "degrees_of_freedom",
                "underconstrained_variables",
                "active_constraints",
                "redundant_constraints",
                "conflicts",
                "solve_components",
            ]
            .into_iter()
            .map(str::to_owned)
            .collect(),
        }
    }

    pub fn solve_sketch(&self, sketch: &Sketch) -> Result<SolvedSketch, SketchError> {
        sketch.validate()?;
        self.solve_prevalidated_sketch(sketch)
    }

    /// Solve a sketch whose caller has just completed full model validation.
    /// Batch command application uses this entry point to avoid validating the
    /// same large immutable draft twice at the WASM boundary.
    pub fn solve_prevalidated_sketch(&self, sketch: &Sketch) -> Result<SolvedSketch, SketchError> {
        let (active, redundant) = unique_constraints(sketch);
        let components = active_solve_components(sketch, &active);
        let structural = structural_conflicts(sketch);
        if !structural.is_empty() {
            return Ok(SolvedSketch {
                sketch: sketch.clone(),
                solve: classify_with_components(sketch, active, redundant, structural, components),
            });
        }

        // Preserve the exact integer-grid branch selected by the accepted
        // sketch before handing each graph component to the floating-point
        // backend. EZPZ remains authoritative: the seed is never accepted
        // unless EZPZ converges and the merged result passes contract checks.
        let mut seed = sketch.clone();
        project_constraints(&mut seed, &active, None)?;
        let seed_satisfies_contract = unsatisfied_constraints(&seed, &active)?.is_empty();
        let backend =
            crate::ezpz_backend::solve_decomposed_with_components(&seed, &active, &components)?;
        // EZPZ may choose any valid value for a free translation/rotation. When
        // the exact integer-grid seed already satisfies every equation, retain
        // that user-selected branch after EZPZ has converged instead of letting
        // an equivalent free-DOF solution make geometry visibly jump.
        let mut candidate = if seed_satisfies_contract && backend.unsatisfied.is_empty() {
            seed
        } else {
            backend.sketch
        };
        let verified_unsatisfied = unsatisfied_constraints(&candidate, &active)?;
        let conflicts = if backend.unsatisfied.is_empty()
            && verified_unsatisfied.is_empty()
            && candidate.validate().is_ok()
        {
            Vec::new()
        } else {
            vec![ConflictSet {
                constraints: irreducible_conflict(sketch, &active)?,
                reason: ConflictReason::GeometricResidual,
            }]
        };
        let mut solve = classify_with_components(sketch, active, redundant, conflicts, components);
        solve.underconstrained_variables = backend.underconstrained_variables;
        if solve.state == SolveState::Conflicting {
            candidate = sketch.clone();
        }
        Ok(SolvedSketch {
            sketch: candidate,
            solve,
        })
    }
}

impl SketchSolver for EzpzSolver {
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
        let components = active_solve_components(&candidate, &active);
        // Select the deterministic integer-grid drag branch expected by the
        // interaction contract (for example, an endpoint dragged off a
        // horizontal line projects back to that line). The branch is only a
        // target proposal; both acceptance passes below remain EZPZ-owned.
        project_constraints(&mut candidate, &active, Some(&request.point))?;

        // The dragged scalar pair is represented as temporary highest-priority
        // fixed equations inside its graph component. These equations never
        // enter the durable sketch contract.
        let driven_backend = crate::ezpz_backend::solve_decomposed_for_drag_with_components(
            &candidate,
            &active,
            &components,
            &request.point,
        )?;
        candidate = driven_backend.sketch;
        // Do not immediately run another free-DOF solve: that can legally pick a
        // different translation and erase the user's driven target. Instead,
        // independently verify the driven result against every durable equation;
        // temporary drag equations never enter the returned sketch contract.
        let mut unsatisfied = driven_backend.unsatisfied;
        unsatisfied.extend(unsatisfied_constraints(&candidate, &active)?);
        unsatisfied.sort();
        unsatisfied.dedup();
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
        let mut solve =
            classify_with_components(&candidate, active, redundant, Vec::new(), components);
        solve.underconstrained_variables = driven_backend.underconstrained_variables;
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

fn active_solve_components(
    sketch: &Sketch,
    active_constraints: &[ConstraintId],
) -> Vec<SolveComponent> {
    let active = active_constraints.iter().cloned().collect();
    Decomposition::from_active_constraints(sketch, &active).components
}

fn classify_with_components(
    sketch: &Sketch,
    active_constraints: Vec<ConstraintId>,
    redundant_constraints: Vec<ConstraintId>,
    mut conflicts: Vec<ConflictSet>,
    components: Vec<SolveComponent>,
) -> SolveResult {
    let total_dof = components
        .iter()
        .map(|component| component.variable_count)
        .sum();
    let equation_count: u32 = components
        .iter()
        .map(|component| component.equation_count)
        .sum();
    let structural_rank: u32 = components
        .iter()
        .map(|component| component.structural_rank)
        .sum();
    let degrees_of_freedom: u32 = components
        .iter()
        .map(|component| component.structural_degrees_of_freedom)
        .sum();
    let state = if !conflicts.is_empty() {
        SolveState::Conflicting
    } else if equation_count > structural_rank {
        conflicts.push(excess_conflict(sketch, &active_constraints, total_dof));
        SolveState::OverConstrained
    } else if degrees_of_freedom == 0 {
        SolveState::FullyConstrained
    } else {
        SolveState::UnderConstrained
    };
    conflicts.sort_by(|a, b| a.constraints.cmp(&b.constraints));
    SolveResult {
        state,
        degrees_of_freedom,
        underconstrained_variables: total_dof,
        solve_components: components,
        active_constraints,
        redundant_constraints,
        conflicts,
    }
}

fn constraint_rank(constraint: &Constraint) -> u32 {
    match constraint {
        Constraint::Coincident { .. }
        | Constraint::PointOnOrigin { .. }
        | Constraint::Fixed { .. }
        | Constraint::FixedGeometry { .. }
        | Constraint::Midpoint { .. }
        | Constraint::Concentric { .. }
        | Constraint::Symmetry { .. } => 2,
        _ => 1,
    }
}

fn unique_constraints(sketch: &Sketch) -> (Vec<ConstraintId>, Vec<ConstraintId>) {
    let active_entries = sketch
        .constraints
        .iter()
        .filter(|(id, _)| !sketch.suppressed_constraints.contains(*id))
        .collect::<Vec<_>>();
    // A point at a line midpoint that is held on the origin already implies
    // "the line midpoint is the origin". The origin hold can be direct, a
    // zero-valued fix, or flow through coincident points. Treat the direct
    // origin-midpoint relation as a semantic duplicate; otherwise its two
    // equations can falsely exhaust the structural rank of a valid component.
    let mut points_on_origin = active_entries
        .iter()
        .filter_map(|(_, constraint)| match constraint {
            Constraint::PointOnOrigin { point }
            | Constraint::Fixed {
                point,
                x_nm: 0,
                y_nm: 0,
            } => Some(point.clone()),
            _ => None,
        })
        .collect::<BTreeSet<_>>();
    let mut coincident_neighbors = BTreeMap::<PointRef, BTreeSet<PointRef>>::new();
    for (_, constraint) in &active_entries {
        if let Constraint::Coincident { a, b } = constraint {
            coincident_neighbors
                .entry(a.clone())
                .or_default()
                .insert(b.clone());
            coincident_neighbors
                .entry(b.clone())
                .or_default()
                .insert(a.clone());
        }
    }
    let mut frontier = points_on_origin.iter().cloned().collect::<Vec<_>>();
    while let Some(point) = frontier.pop() {
        if let Some(neighbors) = coincident_neighbors.get(&point) {
            for neighbor in neighbors {
                if points_on_origin.insert(neighbor.clone()) {
                    frontier.push(neighbor.clone());
                }
            }
        }
    }
    let midpoint_lines_with_origin_points = active_entries
        .iter()
        .filter_map(|(_, constraint)| match constraint {
            Constraint::Midpoint { point, line }
                if !point.is_origin() && points_on_origin.contains(point) =>
            {
                Some(line.clone())
            }
            _ => None,
        })
        .collect::<BTreeSet<_>>();
    let implied_origin_midpoints = active_entries
        .iter()
        .filter_map(|(id, constraint)| match constraint {
            Constraint::Midpoint { point, line }
                if point.is_origin() && midpoint_lines_with_origin_points.contains(line) =>
            {
                Some((*id).clone())
            }
            _ => None,
        })
        .collect::<BTreeSet<_>>();
    let mut fingerprints = BTreeSet::new();
    let mut active = Vec::new();
    let mut redundant = Vec::new();
    for (id, constraint) in &sketch.constraints {
        if sketch.suppressed_constraints.contains(id) {
            continue;
        }
        if implied_origin_midpoints.contains(id) {
            redundant.push(id.clone());
            continue;
        }
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
        Constraint::HorizontalPoints { a, b } => {
            let (a, b) = ordered_point_pair(a, b);
            Constraint::HorizontalPoints { a, b }
        }
        Constraint::VerticalPoints { a, b } => {
            let (a, b) = ordered_point_pair(a, b);
            Constraint::VerticalPoints { a, b }
        }
        Constraint::Distance { a, b, distance_nm } => {
            let (a, b) = ordered_point_pair(a, b);
            Constraint::Distance {
                a,
                b,
                distance_nm: *distance_nm,
            }
        }
        Constraint::DistanceX { a, b, distance_nm } => {
            let (a, b) = ordered_point_pair(a, b);
            Constraint::DistanceX {
                a,
                b,
                distance_nm: *distance_nm,
            }
        }
        Constraint::DistanceY { a, b, distance_nm } => {
            let (a, b) = ordered_point_pair(a, b);
            Constraint::DistanceY {
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
        Constraint::Tangent {
            first,
            second,
            first_parameter_millionths,
            second_parameter_millionths,
        } => {
            let swapped = first > second;
            let (first, second) = ordered_pair(first, second);
            Constraint::Tangent {
                first,
                second,
                first_parameter_millionths: if swapped {
                    *second_parameter_millionths
                } else {
                    *first_parameter_millionths
                },
                second_parameter_millionths: if swapped {
                    *first_parameter_millionths
                } else {
                    *second_parameter_millionths
                },
            }
        }
        Constraint::Equal { first, second } => {
            let (first, second) = ordered_pair(first, second);
            Constraint::Equal { first, second }
        }
        Constraint::Concentric { first, second } => {
            let (first, second) = ordered_pair(first, second);
            Constraint::Concentric { first, second }
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
        Constraint::HorizontalPoints { a, b } => {
            let (source, target) = ordered_points_for_projection(a, b, driven);
            let source_value = sketch.point(source)?;
            let target_value = sketch.point(target)?;
            set_solver_point(
                sketch,
                target,
                Point2::new(target_value.x_nm, source_value.y_nm),
            )
        }
        Constraint::VerticalPoints { a, b } => {
            let (source, target) = ordered_points_for_projection(a, b, driven);
            let source_value = sketch.point(source)?;
            let target_value = sketch.point(target)?;
            set_solver_point(
                sketch,
                target,
                Point2::new(source_value.x_nm, target_value.y_nm),
            )
        }
        Constraint::PointOnOrigin { point } => set_solver_point(sketch, point, Point2::new(0, 0)),
        Constraint::Fixed { point, x_nm, y_nm } => {
            set_solver_point(sketch, point, Point2::new(*x_nm, *y_nm))
        }
        Constraint::FixedGeometry { .. } => Ok(()),
        Constraint::Midpoint {
            point,
            line: line_id,
        } => {
            let line = line_of(sketch, line_id)?.clone();
            if point.is_origin() {
                let midpoint = Point2::new(
                    ((line.start.x_nm as i128 + line.end.x_nm as i128) / 2) as i64,
                    ((line.start.y_nm as i128 + line.end.y_nm as i128) / 2) as i64,
                );
                let entity = sketch
                    .geometry
                    .get_mut(line_id)
                    .ok_or_else(|| SketchError::MissingGeometry(line_id.clone()))?;
                let Geometry::Line(moving) = &mut entity.geometry else {
                    return Err(SketchError::WrongGeometryKind(line_id.clone()));
                };
                moving.start = Point2::new(
                    moving.start.x_nm - midpoint.x_nm,
                    moving.start.y_nm - midpoint.y_nm,
                );
                moving.end = Point2::new(
                    moving.end.x_nm - midpoint.x_nm,
                    moving.end.y_nm - midpoint.y_nm,
                );
                return Ok(());
            }
            set_solver_point(
                sketch,
                point,
                Point2::new(
                    ((line.start.x_nm as i128 + line.end.x_nm as i128) / 2) as i64,
                    ((line.start.y_nm as i128 + line.end.y_nm as i128) / 2) as i64,
                ),
            )
        }
        Constraint::Concentric { first, second } => {
            let driven_first = driven.is_some_and(|point| point.geometry == *first);
            let (datum, moving) = if driven_first {
                (second, first)
            } else {
                (first, second)
            };
            let center = geometry_center(sketch, datum)?;
            translate_round_center(sketch, moving, center)
        }
        Constraint::PointOnObject { point, geometry } => {
            let value = sketch.point(point)?;
            let projected = project_point_to_geometry(sketch, value, geometry)?;
            if point.is_origin() {
                return translate_geometry(sketch, geometry, -projected.x_nm, -projected.y_nm);
            }
            set_solver_point(sketch, point, projected)
        }
        Constraint::Collinear { point, line } => {
            let value = sketch.point(point)?;
            let projected = project_point_to_geometry(sketch, value, line)?;
            set_solver_point(sketch, point, projected)
        }
        Constraint::Symmetry {
            first,
            second,
            axis,
        } => {
            let line = line_of(sketch, axis)?.clone();
            let source = sketch.point(first)?;
            let reflected = reflect_across_line(source, &line);
            set_solver_point(sketch, second, reflected)
        }
        Constraint::CurvatureContinuous { first, second } => {
            project_curvature_continuous(sketch, first, second)
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
        Constraint::AngleToAxis {
            line,
            axis,
            angle_microdegrees,
        } => {
            let axis_angle = match axis {
                Axis2d::X => 0.0,
                Axis2d::Y => std::f64::consts::FRAC_PI_2,
            };
            let line_value = line_of(sketch, line)?.clone();
            set_line_direction(
                sketch,
                line,
                &line_value,
                axis_angle + (*angle_microdegrees as f64).to_radians() / 1_000_000.0,
                driven,
            )
        }
        Constraint::Distance { a, b, distance_nm } => {
            project_distance(sketch, a, b, *distance_nm, driven)
        }
        Constraint::DistanceX { a, b, distance_nm } => {
            project_axis_distance(sketch, a, b, *distance_nm, true, driven)
        }
        Constraint::DistanceY { a, b, distance_nm } => {
            project_axis_distance(sketch, a, b, *distance_nm, false, driven)
        }
        Constraint::PointLineDistance {
            point,
            line,
            distance_nm,
        } => project_point_line_distance(sketch, point, line, *distance_nm),
        Constraint::LineDistance {
            first,
            second,
            distance_nm,
        } => project_line_distance(sketch, first, second, *distance_nm),
        Constraint::OffsetDistance {
            source,
            offset,
            distance_nm,
            source_start_millionths,
            source_end_millionths,
        } => project_offset_distance(
            sketch,
            source,
            offset,
            *distance_nm,
            *source_start_millionths,
            *source_end_millionths,
        ),
        Constraint::Radius {
            geometry,
            radius_nm,
        } => set_radius(sketch, geometry, *radius_nm),
        Constraint::Diameter {
            geometry,
            diameter_nm,
        } => set_radius(sketch, geometry, (*diameter_nm / 2).max(1)),
        Constraint::EllipseRadius {
            geometry,
            axis,
            radius_nm,
        } => set_ellipse_radius(sketch, geometry, *axis, *radius_nm),
        Constraint::Equal { first, second } => project_equal(sketch, first, second, driven),
        Constraint::Tangent {
            first,
            second,
            first_parameter_millionths,
            second_parameter_millionths,
        } => project_tangent(
            sketch,
            first,
            second,
            *first_parameter_millionths,
            *second_parameter_millionths,
            driven,
        ),
    }
}

fn project_offset_distance(
    sketch: &mut Sketch,
    source_id: &GeometryId,
    offset_id: &GeometryId,
    distance_nm: i64,
    start_millionths: u32,
    end_millionths: u32,
) -> Result<(), SketchError> {
    let source = sketch.geometry[source_id].geometry.clone();
    let current = sketch.geometry[offset_id].geometry.clone();
    let start = start_millionths as f64 / 1_000_000.0;
    let end = end_millionths as f64 / 1_000_000.0;
    let middle = (start + end) * 0.5;
    let source_frame = crate::evaluate_frame(&source, middle);
    let current_middle = crate::evaluate_curve(&current, 0.5);
    let delta = [
        (current_middle.x_nm - source_frame.point.x_nm) as f64,
        (current_middle.y_nm - source_frame.point.y_nm) as f64,
    ];
    let normal = [-source_frame.tangent[1], source_frame.tangent[0]];
    let sign = if delta[0] * normal[0] + delta[1] * normal[1] < 0.0 {
        -1.0
    } else {
        1.0
    };
    let signed_offset = distance_nm.abs() as f64 * sign;
    let offset_point = |parameter: f64| {
        let frame = crate::evaluate_frame(&source, parameter.clamp(0.0, 1.0));
        Point2::new(
            round_i64(frame.point.x_nm as f64 - frame.tangent[1] * signed_offset),
            round_i64(frame.point.y_nm as f64 + frame.tangent[0] * signed_offset),
        )
    };
    let entity = sketch
        .geometry
        .get_mut(offset_id)
        .ok_or_else(|| SketchError::MissingGeometry(offset_id.clone()))?;
    match (&source, &mut entity.geometry) {
        (Geometry::Line(_), Geometry::Line(line)) => {
            line.start = offset_point(start);
            line.end = offset_point(end);
        }
        (Geometry::Circle(source), Geometry::Circle(circle)) => {
            circle.center = source.center;
            circle.radius_nm = round_i64((source.radius_nm as f64 + signed_offset).abs()).max(1);
        }
        (Geometry::Arc(source), Geometry::Arc(arc)) => {
            let radius = (distance(source.center, source.start) + signed_offset)
                .abs()
                .max(1.0);
            arc.center = source.center;
            arc.start = offset(
                source.center,
                unit_direction(source.center, source.start),
                radius,
            );
            arc.end = offset(
                source.center,
                unit_direction(source.center, source.end),
                radius,
            );
            arc.clockwise = source.clockwise;
        }
        (_, Geometry::FitPointSpline(spline)) => {
            let count = spline.fit_points.len().max(2);
            spline.fit_points = (0..count)
                .map(|index| {
                    let u = index as f64 / (count - 1) as f64;
                    offset_point(start + (end - start) * u)
                })
                .collect();
        }
        (_, Geometry::ControlPointSpline(spline)) => {
            let count = spline.control_points.len().max(2);
            spline.control_points = (0..count)
                .map(|index| {
                    offset_point(start + (end - start) * index as f64 / (count - 1) as f64)
                })
                .collect();
        }
        _ => return Err(SketchError::WrongGeometryKind(offset_id.clone())),
    }
    Ok(())
}

fn translate_geometry(
    sketch: &mut Sketch,
    id: &GeometryId,
    dx_nm: i64,
    dy_nm: i64,
) -> Result<(), SketchError> {
    let translate = |point: &mut Point2| {
        point.x_nm += dx_nm;
        point.y_nm += dy_nm;
    };
    let entity = sketch
        .geometry
        .get_mut(id)
        .ok_or_else(|| SketchError::MissingGeometry(id.clone()))?;
    match &mut entity.geometry {
        Geometry::Line(line) => {
            translate(&mut line.start);
            translate(&mut line.end);
        }
        Geometry::Circle(circle) => translate(&mut circle.center),
        Geometry::Arc(arc) => {
            translate(&mut arc.center);
            translate(&mut arc.start);
            translate(&mut arc.end);
        }
        Geometry::Rectangle(rectangle) => {
            translate(&mut rectangle.min);
            translate(&mut rectangle.max);
        }
        Geometry::ControlPointSpline(spline) => {
            for point in &mut spline.control_points {
                translate(point);
            }
        }
        Geometry::FitPointSpline(spline) => spline.fit_points.iter_mut().for_each(translate),
        Geometry::Ellipse(ellipse) => {
            translate(&mut ellipse.center);
            translate(&mut ellipse.major);
            translate(&mut ellipse.minor);
        }
        Geometry::EllipticalArc(arc) => {
            translate(&mut arc.center);
            translate(&mut arc.major);
            translate(&mut arc.minor);
            translate(&mut arc.start);
            translate(&mut arc.end);
        }
        Geometry::Conic(conic) => {
            translate(&mut conic.start);
            translate(&mut conic.control);
            translate(&mut conic.end);
        }
        Geometry::SketchPoint(point) => translate(point),
    }
    Ok(())
}

fn project_point_to_geometry(
    sketch: &Sketch,
    point: Point2,
    geometry: &GeometryId,
) -> Result<Point2, SketchError> {
    Ok(match &sketch.geometry[geometry].geometry {
        Geometry::Line(line) => {
            let dx = (line.end.x_nm - line.start.x_nm) as f64;
            let dy = (line.end.y_nm - line.start.y_nm) as f64;
            let length_squared = dx * dx + dy * dy;
            if length_squared <= f64::EPSILON {
                line.start
            } else {
                let t = ((point.x_nm - line.start.x_nm) as f64 * dx
                    + (point.y_nm - line.start.y_nm) as f64 * dy)
                    / length_squared;
                Point2::new(
                    round_i64(line.start.x_nm as f64 + t * dx),
                    round_i64(line.start.y_nm as f64 + t * dy),
                )
            }
        }
        Geometry::Circle(circle) => offset(
            circle.center,
            unit_direction(circle.center, point),
            circle.radius_nm as f64,
        ),
        Geometry::Arc(arc) => offset(
            arc.center,
            unit_direction(arc.center, point),
            distance(arc.center, arc.start),
        ),
        Geometry::ControlPointSpline(_)
        | Geometry::FitPointSpline(_)
        | Geometry::Ellipse(_)
        | Geometry::EllipticalArc(_)
        | Geometry::Conic(_) => {
            crate::curve::project_point(&sketch.geometry[geometry].geometry, point)
                .frame
                .point
        }
        Geometry::Rectangle(_) | Geometry::SketchPoint(_) => {
            return Err(SketchError::WrongGeometryKind(geometry.clone()));
        }
    })
}

fn reflect_across_line(point: Point2, line: &Line) -> Point2 {
    let dx = (line.end.x_nm - line.start.x_nm) as f64;
    let dy = (line.end.y_nm - line.start.y_nm) as f64;
    let length_squared = dx * dx + dy * dy;
    if length_squared <= f64::EPSILON {
        return point;
    }
    let t = ((point.x_nm - line.start.x_nm) as f64 * dx
        + (point.y_nm - line.start.y_nm) as f64 * dy)
        / length_squared;
    let projection_x = line.start.x_nm as f64 + t * dx;
    let projection_y = line.start.y_nm as f64 + t * dy;
    Point2::new(
        round_i64(2.0 * projection_x - point.x_nm as f64),
        round_i64(2.0 * projection_y - point.y_nm as f64),
    )
}

fn endpoint_handle_refs(
    id: &GeometryId,
    geometry: &Geometry,
) -> Result<[(PointRef, PointRef); 2], SketchError> {
    let pair = |endpoint, handle| {
        (
            PointRef::new(id.clone(), endpoint),
            PointRef::new(id.clone(), handle),
        )
    };
    Ok(match geometry {
        Geometry::Line(_) => [
            pair(Anchor::Start, Anchor::End),
            pair(Anchor::End, Anchor::Start),
        ],
        Geometry::ControlPointSpline(spline) => [
            pair(Anchor::Start, Anchor::ControlPoint(1)),
            pair(
                Anchor::End,
                Anchor::ControlPoint((spline.control_points.len() - 2) as u32),
            ),
        ],
        Geometry::FitPointSpline(spline) => [
            pair(Anchor::Start, Anchor::FitPoint(1)),
            pair(
                Anchor::End,
                Anchor::FitPoint((spline.fit_points.len() - 2) as u32),
            ),
        ],
        Geometry::Conic(_) => [
            pair(Anchor::Start, Anchor::Control),
            pair(Anchor::End, Anchor::Control),
        ],
        _ => return Err(SketchError::WrongGeometryKind(id.clone())),
    })
}

fn closest_endpoint_pair(
    sketch: &Sketch,
    first: &GeometryId,
    second: &GeometryId,
) -> Result<((PointRef, PointRef), (PointRef, PointRef)), SketchError> {
    let a = endpoint_handle_refs(first, &sketch.geometry[first].geometry)?;
    let b = endpoint_handle_refs(second, &sketch.geometry[second].geometry)?;
    let mut best = (a[0].clone(), b[0].clone());
    let mut best_distance = f64::INFINITY;
    for first_pair in a {
        for second_pair in &b {
            let candidate = distance(sketch.point(&first_pair.0)?, sketch.point(&second_pair.0)?);
            if candidate < best_distance {
                best_distance = candidate;
                best = (first_pair.clone(), second_pair.clone());
            }
        }
    }
    Ok(best)
}

fn project_curvature_continuous(
    sketch: &mut Sketch,
    first: &GeometryId,
    second: &GeometryId,
) -> Result<(), SketchError> {
    let ((first_end, first_handle), (second_end, second_handle)) =
        closest_endpoint_pair(sketch, first, second)?;
    let first_adjustable =
        curvature_adjustment_ref(first, &sketch.geometry[first].geometry, &first_end.anchor);
    let second_adjustable = curvature_adjustment_ref(
        second,
        &sketch.geometry[second].geometry,
        &second_end.anchor,
    );
    if second_adjustable.is_none() && first_adjustable.is_some() {
        return project_curvature_continuous(sketch, second, first);
    }
    let contact = sketch.point(&first_end)?;
    let first_inner = sketch.point(&first_handle)?;
    let second_inner = sketch.point(&second_handle)?;
    let length = distance(sketch.point(&second_end)?, second_inner).max(1.0);
    let direction = unit_direction(contact, first_inner);
    set_solver_point(sketch, &second_end, contact)?;
    set_solver_point(sketch, &second_handle, offset(contact, direction, -length))?;

    let Some(adjustment) = second_adjustable else {
        return Ok(());
    };
    let first_parameter = endpoint_parameter(&first_end.anchor);
    let second_parameter = endpoint_parameter(&second_end.anchor);
    let target = crate::curve::evaluate_frame(&sketch.geometry[first].geometry, first_parameter)
        .curvature_per_nm;
    // Curvature is controlled by the next independent point. Solve its normal
    // displacement numerically so this remains valid for cubic control and fit
    // splines as well as rational conics.
    for _ in 0..6 {
        let frame =
            crate::curve::evaluate_frame(&sketch.geometry[second].geometry, second_parameter);
        let error = target - frame.curvature_per_nm;
        if curvature_close(target, frame.curvature_per_nm) {
            break;
        }
        let current = sketch.point(&adjustment)?;
        let probe_nm = length.mul_add(0.05, 10.0).max(10.0);
        let normal = (-frame.tangent[1], frame.tangent[0]);
        let probe = offset(current, normal, probe_nm);
        set_solver_point(sketch, &adjustment, probe)?;
        let probed =
            crate::curve::evaluate_frame(&sketch.geometry[second].geometry, second_parameter)
                .curvature_per_nm;
        let slope = (probed - frame.curvature_per_nm) / probe_nm;
        if slope.abs() <= 1.0e-18 {
            set_solver_point(sketch, &adjustment, current)?;
            break;
        }
        let correction = (error / slope).clamp(-length * 8.0, length * 8.0);
        set_solver_point(sketch, &adjustment, offset(current, normal, correction))?;
    }
    Ok(())
}

fn curvature_continuous_satisfied(
    sketch: &Sketch,
    first: &GeometryId,
    second: &GeometryId,
) -> Result<bool, SketchError> {
    let ((first_end, first_handle), (second_end, second_handle)) =
        closest_endpoint_pair(sketch, first, second)?;
    let contact = sketch.point(&first_end)?;
    let other = sketch.point(&second_end)?;
    if distance(contact, other) > LENGTH_TOLERANCE_NM {
        return Ok(false);
    }
    let a = unit_direction(contact, sketch.point(&first_handle)?);
    let b = unit_direction(other, sketch.point(&second_handle)?);
    if (a.0 + b.0).hypot(a.1 + b.1) > 1.0e-3 {
        return Ok(false);
    }
    let first_curvature = crate::curve::evaluate_frame(
        &sketch.geometry[first].geometry,
        endpoint_parameter(&first_end.anchor),
    )
    .curvature_per_nm;
    let second_curvature = crate::curve::evaluate_frame(
        &sketch.geometry[second].geometry,
        endpoint_parameter(&second_end.anchor),
    )
    .curvature_per_nm;
    Ok(curvature_close(first_curvature, second_curvature))
}

fn endpoint_parameter(anchor: &Anchor) -> f64 {
    if matches!(anchor, Anchor::End) {
        1.0
    } else {
        0.0
    }
}

fn curvature_close(first: f64, second: f64) -> bool {
    let scale = first.abs().max(second.abs());
    (first - second).abs() <= 1.0e-10_f64.max(scale * 0.03)
}

fn curvature_adjustment_ref(
    id: &GeometryId,
    geometry: &Geometry,
    endpoint: &Anchor,
) -> Option<PointRef> {
    let start = !matches!(endpoint, Anchor::End);
    let anchor = match geometry {
        Geometry::ControlPointSpline(value) if value.control_points.len() >= 3 => {
            Anchor::ControlPoint(if start {
                2
            } else {
                (value.control_points.len() - 3) as u32
            })
        }
        Geometry::FitPointSpline(value) if value.fit_points.len() >= 3 => {
            Anchor::FitPoint(if start {
                2
            } else {
                (value.fit_points.len() - 3) as u32
            })
        }
        Geometry::Conic(_) => {
            if start {
                Anchor::End
            } else {
                Anchor::Start
            }
        }
        _ => return None,
    };
    Some(PointRef::new(id.clone(), anchor))
}

fn point_line_distance(point: Point2, line: &Line) -> f64 {
    let dx = (line.end.x_nm - line.start.x_nm) as f64;
    let dy = (line.end.y_nm - line.start.y_nm) as f64;
    let length = dx.hypot(dy);
    if length <= f64::EPSILON {
        return distance(point, line.start);
    }
    (((point.x_nm - line.start.x_nm) as f64 * dy - (point.y_nm - line.start.y_nm) as f64 * dx)
        / length)
        .abs()
}

fn ordered_points_for_projection<'a>(
    a: &'a PointRef,
    b: &'a PointRef,
    driven: Option<&PointRef>,
) -> (&'a PointRef, &'a PointRef) {
    if a.is_origin() {
        return (a, b);
    }
    if b.is_origin() {
        return (b, a);
    }
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

fn project_axis_distance(
    sketch: &mut Sketch,
    a: &PointRef,
    b: &PointRef,
    distance_nm: i64,
    horizontal: bool,
    driven: Option<&PointRef>,
) -> Result<(), SketchError> {
    let (fixed_ref, moving_ref) = ordered_points_for_projection(a, b, driven);
    let fixed = sketch.point(fixed_ref)?;
    let mut moving = sketch.point(moving_ref)?;
    let current = if horizontal {
        moving.x_nm - fixed.x_nm
    } else {
        moving.y_nm - fixed.y_nm
    };
    let signed = if current < 0 {
        -distance_nm.abs()
    } else {
        distance_nm.abs()
    };
    if horizontal {
        moving.x_nm = fixed.x_nm + signed;
    } else {
        moving.y_nm = fixed.y_nm + signed;
    }
    set_solver_point(sketch, moving_ref, moving)
}

fn project_point_line_distance(
    sketch: &mut Sketch,
    point: &PointRef,
    line_id: &GeometryId,
    distance_nm: i64,
) -> Result<(), SketchError> {
    let line = line_of(sketch, line_id)?.clone();
    let value = sketch.point(point)?;
    let projection = project_point_to_geometry(sketch, value, line_id)?;
    let dx = (line.end.x_nm - line.start.x_nm) as f64;
    let dy = (line.end.y_nm - line.start.y_nm) as f64;
    let length = dx.hypot(dy).max(1.0);
    let normal = (-dy / length, dx / length);
    let side = if (value.x_nm - projection.x_nm) as f64 * normal.0
        + (value.y_nm - projection.y_nm) as f64 * normal.1
        < 0.0
    {
        -1.0
    } else {
        1.0
    };
    set_solver_point(
        sketch,
        point,
        offset(projection, normal, side * distance_nm.abs() as f64),
    )
}

fn project_line_distance(
    sketch: &mut Sketch,
    first: &GeometryId,
    second: &GeometryId,
    distance_nm: i64,
) -> Result<(), SketchError> {
    project_line_relation(sketch, first, second, 0.0, None)?;
    let a = line_of(sketch, first)?.clone();
    let b = line_of(sketch, second)?.clone();
    let dx = (a.end.x_nm - a.start.x_nm) as f64;
    let dy = (a.end.y_nm - a.start.y_nm) as f64;
    let length = dx.hypot(dy).max(1.0);
    let normal = (-dy / length, dx / length);
    let current = (b.start.x_nm - a.start.x_nm) as f64 * normal.0
        + (b.start.y_nm - a.start.y_nm) as f64 * normal.1;
    let desired = if current < 0.0 {
        -distance_nm.abs() as f64
    } else {
        distance_nm.abs() as f64
    };
    translate_geometry(
        sketch,
        second,
        round_i64(normal.0 * (desired - current)),
        round_i64(normal.1 * (desired - current)),
    )
}

fn parallel_line_distance(first: &Line, second: &Line) -> f64 {
    point_line_distance(second.start, first)
}

fn set_ellipse_radius(
    sketch: &mut Sketch,
    id: &GeometryId,
    axis: Anchor,
    radius_nm: i64,
) -> Result<(), SketchError> {
    let entity = sketch
        .geometry
        .get_mut(id)
        .ok_or_else(|| SketchError::MissingGeometry(id.clone()))?;
    let (center, target) = match &mut entity.geometry {
        Geometry::Ellipse(value) => (
            value.center,
            if axis == Anchor::Major {
                &mut value.major
            } else {
                &mut value.minor
            },
        ),
        Geometry::EllipticalArc(value) => (
            value.center,
            if axis == Anchor::Major {
                &mut value.major
            } else {
                &mut value.minor
            },
        ),
        _ => return Err(SketchError::WrongGeometryKind(id.clone())),
    };
    *target = offset(center, unit_direction(center, *target), radius_nm as f64);
    Ok(())
}

fn ellipse_radius(sketch: &Sketch, id: &GeometryId, axis: Anchor) -> Result<f64, SketchError> {
    match &sketch.geometry[id].geometry {
        Geometry::Ellipse(value) => Ok(distance(
            value.center,
            if axis == Anchor::Major {
                value.major
            } else {
                value.minor
            },
        )),
        Geometry::EllipticalArc(value) => Ok(distance(
            value.center,
            if axis == Anchor::Major {
                value.major
            } else {
                value.minor
            },
        )),
        _ => Err(SketchError::WrongGeometryKind(id.clone())),
    }
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
    let moving_angle = direction_angle(moving_line.start, moving_line.end);
    let desired = closest_equivalent_line_angle(datum_angle + signed_angle, moving_angle);
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
        Geometry::Rectangle(_)
        | Geometry::ControlPointSpline(_)
        | Geometry::FitPointSpline(_)
        | Geometry::Ellipse(_)
        | Geometry::EllipticalArc(_)
        | Geometry::Conic(_) => scale_geometry_measure(sketch, moving, measure),
        Geometry::SketchPoint(_) => Err(SketchError::WrongGeometryKind(moving.clone())),
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

fn scale_geometry_measure(
    sketch: &mut Sketch,
    id: &GeometryId,
    target: f64,
) -> Result<(), SketchError> {
    let current = geometry_measure(sketch, id)?;
    if current <= f64::EPSILON {
        return Err(SketchError::WrongGeometryKind(id.clone()));
    }
    let factor = target / current;
    let pivot = crate::evaluate_curve(&sketch.geometry[id].geometry, 0.0);
    let scale = |point: &mut Point2| {
        point.x_nm = pivot.x_nm + (((*point).x_nm - pivot.x_nm) as f64 * factor).round() as i64;
        point.y_nm = pivot.y_nm + (((*point).y_nm - pivot.y_nm) as f64 * factor).round() as i64;
    };
    let entity = sketch
        .geometry
        .get_mut(id)
        .ok_or_else(|| SketchError::MissingGeometry(id.clone()))?;
    match &mut entity.geometry {
        Geometry::Rectangle(value) => {
            scale(&mut value.min);
            scale(&mut value.max);
        }
        Geometry::ControlPointSpline(value) => value.control_points.iter_mut().for_each(scale),
        Geometry::FitPointSpline(value) => value.fit_points.iter_mut().for_each(scale),
        Geometry::Ellipse(value) => {
            scale(&mut value.center);
            scale(&mut value.major);
            scale(&mut value.minor);
        }
        Geometry::EllipticalArc(value) => {
            scale(&mut value.center);
            scale(&mut value.major);
            scale(&mut value.minor);
            scale(&mut value.start);
            scale(&mut value.end);
        }
        Geometry::Conic(value) => {
            scale(&mut value.start);
            scale(&mut value.control);
            scale(&mut value.end);
        }
        _ => return Err(SketchError::WrongGeometryKind(id.clone())),
    }
    Ok(())
}

fn project_tangent(
    sketch: &mut Sketch,
    first: &GeometryId,
    second: &GeometryId,
    first_parameter_millionths: Option<u32>,
    second_parameter_millionths: Option<u32>,
    driven: Option<&PointRef>,
) -> Result<(), SketchError> {
    let first_geometry = sketch.geometry[first].geometry.clone();
    let second_geometry = sketch.geometry[second].geometry.clone();
    match (&first_geometry, &second_geometry) {
        (Geometry::Line(line), Geometry::Circle(_) | Geometry::Arc(_)) => tangent_line_round(
            sketch,
            first,
            line,
            second,
            first_parameter_millionths,
            second_parameter_millionths,
        ),
        (Geometry::Circle(_) | Geometry::Arc(_), Geometry::Line(line)) => tangent_line_round(
            sketch,
            second,
            line,
            first,
            second_parameter_millionths,
            first_parameter_millionths,
        ),
        (Geometry::Circle(_), Geometry::Circle(_)) => {
            if first_parameter_millionths.is_some() && second_parameter_millionths.is_some() {
                project_general_tangent(
                    sketch,
                    first,
                    second,
                    first_parameter_millionths,
                    second_parameter_millionths,
                )
            } else {
                tangent_round_round(sketch, first, second, driven)
            }
        }
        (Geometry::Line(_), Geometry::Line(_)) => {
            Err(SketchError::WrongGeometryKind(second.clone()))
        }
        _ => project_general_tangent(
            sketch,
            first,
            second,
            first_parameter_millionths,
            second_parameter_millionths,
        ),
    }
}

fn tangent_line_round(
    sketch: &mut Sketch,
    line_id: &GeometryId,
    line: &Line,
    round_id: &GeometryId,
    line_parameter_millionths: Option<u32>,
    round_parameter_millionths: Option<u32>,
) -> Result<(), SketchError> {
    if let Some((line_parameter, round_parameter)) =
        line_parameter_millionths.zip(round_parameter_millionths)
    {
        let line_frame = crate::evaluate_frame(
            &sketch.geometry[line_id].geometry,
            line_parameter as f64 / 1_000_000.0,
        );
        let round_frame = crate::evaluate_frame(
            &sketch.geometry[round_id].geometry,
            round_parameter as f64 / 1_000_000.0,
        );
        translate_geometry(
            sketch,
            round_id,
            line_frame.point.x_nm - round_frame.point.x_nm,
            line_frame.point.y_nm - round_frame.point.y_nm,
        )?;
        let moved_frame = crate::evaluate_frame(
            &sketch.geometry[round_id].geometry,
            round_parameter as f64 / 1_000_000.0,
        );
        let mut rotation = line_frame.tangent[1].atan2(line_frame.tangent[0])
            - moved_frame.tangent[1].atan2(moved_frame.tangent[0]);
        while rotation > std::f64::consts::FRAC_PI_2 {
            rotation -= std::f64::consts::PI;
        }
        while rotation < -std::f64::consts::FRAC_PI_2 {
            rotation += std::f64::consts::PI;
        }
        rotate_geometry(sketch, round_id, line_frame.point, rotation)?;
        return Ok(());
    }
    let center = geometry_center(sketch, round_id)?;
    let radius = geometry_measure(sketch, round_id)?;
    let dx = (line.end.x_nm - line.start.x_nm) as f64;
    let dy = (line.end.y_nm - line.start.y_nm) as f64;
    let length = dx.hypot(dy);
    let signed = ((center.x_nm - line.start.x_nm) as f64 * -dy
        + (center.y_nm - line.start.y_nm) as f64 * dx)
        / length;
    let along = (((center.x_nm - line.start.x_nm) as f64 * dx
        + (center.y_nm - line.start.y_nm) as f64 * dy)
        / (length * length))
        .clamp(0.0, 1.0);
    let side = if signed < 0.0 { -1.0 } else { 1.0 };
    let contact = Point2::new(
        round_i64(line.start.x_nm as f64 + along * dx),
        round_i64(line.start.y_nm as f64 + along * dy),
    );
    let next = Point2::new(
        round_i64(contact.x_nm as f64 + side * radius * -dy / length),
        round_i64(contact.y_nm as f64 + side * radius * dx / length),
    );
    translate_round_center(sketch, round_id, next)?;
    if let Geometry::Arc(arc) = sketch.geometry[round_id].geometry.clone() {
        let contact_angle =
            ((contact.y_nm - next.y_nm) as f64).atan2((contact.x_nm - next.x_nm) as f64);
        if !round_contains_contact(
            &Geometry::Arc(arc.clone()),
            (contact.x_nm as f64, contact.y_nm as f64),
        ) {
            let start_angle =
                ((arc.start.y_nm - next.y_nm) as f64).atan2((arc.start.x_nm - next.x_nm) as f64);
            let end_angle =
                ((arc.end.y_nm - next.y_nm) as f64).atan2((arc.end.x_nm - next.x_nm) as f64);
            let start_delta = normalized_half_turn(contact_angle - start_angle);
            let end_delta = normalized_half_turn(contact_angle - end_angle);
            let rotation = if start_delta.abs() <= end_delta.abs() {
                start_delta
            } else {
                end_delta
            };
            rotate_geometry(sketch, round_id, next, rotation)?;
        }
    }
    Ok(())
}

fn normalized_half_turn(mut angle: f64) -> f64 {
    while angle > std::f64::consts::PI {
        angle -= std::f64::consts::TAU;
    }
    while angle < -std::f64::consts::PI {
        angle += std::f64::consts::TAU;
    }
    angle
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
    let fixed_radius = geometry_measure(sketch, fixed_id)?;
    let moving_radius = geometry_measure(sketch, moving_id)?;
    let external = fixed_radius + moving_radius;
    let internal = (fixed_radius - moving_radius).abs();
    let current = distance(fixed, moving);
    let target = if internal > LENGTH_TOLERANCE_NM
        && (current - internal).abs() < (current - external).abs()
    {
        internal
    } else {
        external
    };
    let next = offset(fixed, unit_direction(fixed, moving), target);
    translate_round_center(sketch, moving_id, next)
}

fn closest_curve_pair(
    first: &Geometry,
    second: &Geometry,
    retained: Option<(f64, f64)>,
) -> (crate::CurveFrame, crate::CurveFrame, f64, (f64, f64)) {
    let mut best_parameters = retained.unwrap_or((0.0, 0.0));
    let mut best_distance = f64::INFINITY;
    if let Some(parameters) = retained {
        let first_frame = crate::evaluate_frame(first, parameters.0);
        let second_frame = crate::evaluate_frame(second, parameters.1);
        return (
            first_frame,
            second_frame,
            distance(first_frame.point, second_frame.point),
            parameters,
        );
    }
    for (first_parameter, first_point) in crate::curve::adaptive_curve_samples(first, 8) {
        let projection = crate::project_point(second, first_point);
        if projection.distance_nm < best_distance {
            best_parameters = (first_parameter, projection.parameter);
            best_distance = projection.distance_nm;
        }
    }
    for (second_parameter, second_point) in crate::curve::adaptive_curve_samples(second, 8) {
        let reverse = crate::project_point(first, second_point);
        if reverse.distance_nm < best_distance {
            best_parameters = (reverse.parameter, second_parameter);
            best_distance = reverse.distance_nm;
        }
    }
    let mut previous = f64::INFINITY;
    for _ in 0..32 {
        let second_projection =
            crate::project_point(second, crate::evaluate_curve(first, best_parameters.0));
        best_parameters.1 = second_projection.parameter;
        let first_projection =
            crate::project_point(first, crate::evaluate_curve(second, best_parameters.1));
        best_parameters.0 = first_projection.parameter;
        let separation = distance(
            crate::evaluate_curve(first, best_parameters.0),
            crate::evaluate_curve(second, best_parameters.1),
        );
        if (previous - separation).abs() <= 0.25 {
            break;
        }
        previous = separation;
    }
    let first_frame = crate::evaluate_frame(first, best_parameters.0);
    let second_frame = crate::evaluate_frame(second, best_parameters.1);
    (
        first_frame,
        second_frame,
        distance(first_frame.point, second_frame.point),
        best_parameters,
    )
}

fn project_general_tangent(
    sketch: &mut Sketch,
    first: &GeometryId,
    second: &GeometryId,
    first_parameter_millionths: Option<u32>,
    second_parameter_millionths: Option<u32>,
) -> Result<(), SketchError> {
    let mut retained = first_parameter_millionths
        .zip(second_parameter_millionths)
        .map(|(a, b)| (a as f64 / 1_000_000.0, b as f64 / 1_000_000.0));
    for _ in 0..24 {
        let first_geometry = sketch.geometry[first].geometry.clone();
        let second_geometry = sketch.geometry[second].geometry.clone();
        let (a, b, separation, parameters) =
            closest_curve_pair(&first_geometry, &second_geometry, retained);
        retained.get_or_insert(parameters);
        translate_geometry(
            sketch,
            second,
            a.point.x_nm - b.point.x_nm,
            a.point.y_nm - b.point.y_nm,
        )?;
        let moved = sketch.geometry[second].geometry.clone();
        let (a, b, _, _) = closest_curve_pair(&first_geometry, &moved, retained);
        let mut angle = a.tangent[1].atan2(a.tangent[0]) - b.tangent[1].atan2(b.tangent[0]);
        while angle > std::f64::consts::FRAC_PI_2 {
            angle -= std::f64::consts::PI;
        }
        while angle < -std::f64::consts::FRAC_PI_2 {
            angle += std::f64::consts::PI;
        }
        rotate_geometry(sketch, second, a.point, angle)?;
        if separation <= LENGTH_TOLERANCE_NM && angle.abs() <= ANGLE_TOLERANCE_RADIANS {
            break;
        }
    }
    Ok(())
}

fn general_tangent_satisfied(
    sketch: &Sketch,
    first: &GeometryId,
    second: &GeometryId,
    first_parameter_millionths: Option<u32>,
    second_parameter_millionths: Option<u32>,
) -> Result<bool, SketchError> {
    let retained = first_parameter_millionths
        .zip(second_parameter_millionths)
        .map(|(a, b)| (a as f64 / 1_000_000.0, b as f64 / 1_000_000.0));
    let (a, b, separation, _) = closest_curve_pair(
        &sketch.geometry[first].geometry,
        &sketch.geometry[second].geometry,
        retained,
    );
    let cross = (a.tangent[0] * b.tangent[1] - a.tangent[1] * b.tangent[0]).abs();
    Ok(separation <= LENGTH_TOLERANCE_NM && cross <= 1.0e-3)
}

fn rotate_geometry(
    sketch: &mut Sketch,
    id: &GeometryId,
    pivot: Point2,
    angle: f64,
) -> Result<(), SketchError> {
    let rotate = |point: &mut Point2| {
        let x = (point.x_nm - pivot.x_nm) as f64;
        let y = (point.y_nm - pivot.y_nm) as f64;
        *point = Point2::new(
            pivot.x_nm + round_i64(x * angle.cos() - y * angle.sin()),
            pivot.y_nm + round_i64(x * angle.sin() + y * angle.cos()),
        );
    };
    let entity = sketch
        .geometry
        .get_mut(id)
        .ok_or_else(|| SketchError::MissingGeometry(id.clone()))?;
    match &mut entity.geometry {
        Geometry::Line(value) => {
            rotate(&mut value.start);
            rotate(&mut value.end);
        }
        Geometry::Circle(value) => rotate(&mut value.center),
        Geometry::Arc(value) => {
            rotate(&mut value.center);
            rotate(&mut value.start);
            rotate(&mut value.end);
        }
        Geometry::ControlPointSpline(value) => value.control_points.iter_mut().for_each(rotate),
        Geometry::FitPointSpline(value) => value.fit_points.iter_mut().for_each(rotate),
        Geometry::Ellipse(value) => {
            rotate(&mut value.center);
            rotate(&mut value.major);
            rotate(&mut value.minor);
        }
        Geometry::EllipticalArc(value) => {
            rotate(&mut value.center);
            rotate(&mut value.major);
            rotate(&mut value.minor);
            rotate(&mut value.start);
            rotate(&mut value.end);
        }
        Geometry::Conic(value) => {
            rotate(&mut value.start);
            rotate(&mut value.control);
            rotate(&mut value.end);
        }
        Geometry::Rectangle(_) | Geometry::SketchPoint(_) => {
            return Err(SketchError::WrongGeometryKind(id.clone()));
        }
    }
    Ok(())
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
    if point.is_origin() {
        return if value == Point2::new(0, 0) {
            Ok(())
        } else {
            Err(SketchError::ImmutableReference(point.geometry.clone()))
        };
    }
    if matches!(point.anchor, Anchor::CurveParameter(_) | Anchor::Knot(_)) {
        let current = sketch.point(point)?;
        return translate_geometry(
            sketch,
            &point.geometry,
            value.x_nm - current.x_nm,
            value.y_nm - current.y_nm,
        );
    }
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

/// Projects the desired point along its arbitrary cursor angle onto the radius
/// defined by `radial_source`. Rounding remains on the durable nanometer grid;
/// validation admits only the sub-nanometer radial error introduced here.
fn matching_radius_point(
    center: Point2,
    radial_source: Point2,
    desired: Point2,
    avoid: Point2,
) -> Point2 {
    let radius = distance(center, radial_source);
    let desired_radius = distance(center, desired);
    if radius == 0.0 || desired_radius == 0.0 {
        return avoid;
    }
    let scale = radius / desired_radius;
    let projected = Point2::new(
        center.x_nm + ((desired.x_nm - center.x_nm) as f64 * scale).round() as i64,
        center.y_nm + ((desired.y_nm - center.y_nm) as f64 * scale).round() as i64,
    );
    if projected == avoid { avoid } else { projected }
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
        Constraint::HorizontalPoints { a, b } => sketch.point(a)?.y_nm == sketch.point(b)?.y_nm,
        Constraint::VerticalPoints { a, b } => sketch.point(a)?.x_nm == sketch.point(b)?.x_nm,
        Constraint::PointOnOrigin { point } => sketch.point(point)? == Point2::new(0, 0),
        Constraint::Fixed { point, x_nm, y_nm } => {
            sketch.point(point)? == Point2::new(*x_nm, *y_nm)
        }
        Constraint::FixedGeometry { .. } => true,
        Constraint::Midpoint { point, line } => {
            let value = sketch.point(point)?;
            let line = line_of(sketch, line)?;
            (2_i128 * value.x_nm as i128 - line.start.x_nm as i128 - line.end.x_nm as i128).abs()
                <= 1
                && (2_i128 * value.y_nm as i128 - line.start.y_nm as i128 - line.end.y_nm as i128)
                    .abs()
                    <= 1
        }
        Constraint::Concentric { first, second } => {
            geometry_center(sketch, first)? == geometry_center(sketch, second)?
        }
        Constraint::PointOnObject { point, geometry } => {
            let value = sketch.point(point)?;
            match &sketch.geometry[geometry].geometry {
                Geometry::Line(line) => point_line_distance(value, line) <= LENGTH_TOLERANCE_NM,
                Geometry::Circle(circle) => {
                    (distance(value, circle.center) - circle.radius_nm as f64).abs()
                        <= LENGTH_TOLERANCE_NM
                }
                Geometry::Arc(arc) => {
                    (distance(value, arc.center) - distance(arc.center, arc.start)).abs()
                        <= LENGTH_TOLERANCE_NM
                        && round_contains_contact(
                            &sketch.geometry[geometry].geometry,
                            (value.x_nm as f64, value.y_nm as f64),
                        )
                }
                Geometry::ControlPointSpline(_)
                | Geometry::FitPointSpline(_)
                | Geometry::Ellipse(_)
                | Geometry::EllipticalArc(_)
                | Geometry::Conic(_) => {
                    crate::curve::project_point(&sketch.geometry[geometry].geometry, value)
                        .distance_nm
                        <= LENGTH_TOLERANCE_NM
                }
                Geometry::Rectangle(_) | Geometry::SketchPoint(_) => {
                    return Err(SketchError::WrongGeometryKind(geometry.clone()));
                }
            }
        }
        Constraint::Collinear { point, line } => {
            point_line_distance(sketch.point(point)?, line_of(sketch, line)?) <= LENGTH_TOLERANCE_NM
        }
        Constraint::Symmetry {
            first,
            second,
            axis,
        } => {
            distance(
                reflect_across_line(sketch.point(first)?, line_of(sketch, axis)?),
                sketch.point(second)?,
            ) <= LENGTH_TOLERANCE_NM
        }
        Constraint::CurvatureContinuous { first, second } => {
            curvature_continuous_satisfied(sketch, first, second)?
        }
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
        Constraint::AngleToAxis {
            line,
            axis,
            angle_microdegrees,
        } => {
            let axis_angle = match axis {
                Axis2d::X => 0.0,
                Axis2d::Y => std::f64::consts::FRAC_PI_2,
            };
            let line = line_of(sketch, line)?;
            let target = axis_angle + (*angle_microdegrees as f64).to_radians() / 1_000_000.0;
            angle_difference(target, direction_angle(line.start, line.end))
                <= ANGLE_TOLERANCE_RADIANS
        }
        Constraint::Distance { a, b, distance_nm } => {
            (distance(sketch.point(a)?, sketch.point(b)?) - *distance_nm as f64).abs()
                <= LENGTH_TOLERANCE_NM
        }
        Constraint::DistanceX { a, b, distance_nm } => {
            ((sketch.point(a)?.x_nm - sketch.point(b)?.x_nm).abs() - distance_nm.abs()).abs() <= 1
        }
        Constraint::DistanceY { a, b, distance_nm } => {
            ((sketch.point(a)?.y_nm - sketch.point(b)?.y_nm).abs() - distance_nm.abs()).abs() <= 1
        }
        Constraint::PointLineDistance {
            point,
            line,
            distance_nm,
        } => {
            (point_line_distance(sketch.point(point)?, line_of(sketch, line)?)
                - distance_nm.abs() as f64)
                .abs()
                <= LENGTH_TOLERANCE_NM
        }
        Constraint::LineDistance {
            first,
            second,
            distance_nm,
        } => {
            (parallel_line_distance(line_of(sketch, first)?, line_of(sketch, second)?)
                - distance_nm.abs() as f64)
                .abs()
                <= LENGTH_TOLERANCE_NM
                && line_angle_error(sketch, first, second, 0.0)? <= ANGLE_TOLERANCE_RADIANS
        }
        Constraint::OffsetDistance {
            source,
            offset,
            distance_nm,
            source_start_millionths,
            source_end_millionths,
        } => offset_distance_satisfied(
            sketch,
            source,
            offset,
            *distance_nm,
            *source_start_millionths,
            *source_end_millionths,
        )?,
        Constraint::Radius {
            geometry,
            radius_nm,
        } => (geometry_measure(sketch, geometry)? - *radius_nm as f64).abs() <= LENGTH_TOLERANCE_NM,
        Constraint::Diameter {
            geometry,
            diameter_nm,
        } => {
            (geometry_measure(sketch, geometry)? * 2.0 - *diameter_nm as f64).abs()
                <= LENGTH_TOLERANCE_NM
        }
        Constraint::EllipseRadius {
            geometry,
            axis,
            radius_nm,
        } => {
            (ellipse_radius(sketch, geometry, *axis)? - *radius_nm as f64).abs()
                <= LENGTH_TOLERANCE_NM
        }
        Constraint::Equal { first, second } => {
            (geometry_measure(sketch, first)? - geometry_measure(sketch, second)?).abs()
                <= LENGTH_TOLERANCE_NM
        }
        Constraint::Tangent {
            first,
            second,
            first_parameter_millionths,
            second_parameter_millionths,
        } => tangent_satisfied(
            sketch,
            first,
            second,
            *first_parameter_millionths,
            *second_parameter_millionths,
        )?,
    })
}

fn offset_distance_satisfied(
    sketch: &Sketch,
    source: &GeometryId,
    offset: &GeometryId,
    distance_nm: i64,
    start_millionths: u32,
    end_millionths: u32,
) -> Result<bool, SketchError> {
    let source_geometry = &sketch.geometry[source].geometry;
    let offset_geometry = &sketch.geometry[offset].geometry;
    let start = start_millionths as f64 / 1_000_000.0;
    let end = end_millionths as f64 / 1_000_000.0;
    fn interval_ok(
        source: &Geometry,
        offset: &Geometry,
        distance_nm: i64,
        start: f64,
        end: f64,
        a: f64,
        b: f64,
        depth: u8,
    ) -> bool {
        let residual = |u: f64| {
            let source_parameter = start + (end - start) * u;
            (distance(
                crate::evaluate_curve(source, source_parameter),
                crate::evaluate_curve(offset, u),
            ) - distance_nm.abs() as f64)
                .abs()
        };
        let middle = (a + b) * 0.5;
        let ra = residual(a);
        let rm = residual(middle);
        let rb = residual(b);
        let tolerance =
            (LENGTH_TOLERANCE_NM * 2.0).max(crate::curve::geometry_scale_nm(source) * 1.0e-3);
        if ra > tolerance || rm > tolerance || rb > tolerance {
            return false;
        }
        if depth >= 20 || ((rm - (ra + rb) * 0.5).abs() <= 1.0 && b - a <= 1.0 / 64.0) {
            return true;
        }
        interval_ok(
            source,
            offset,
            distance_nm,
            start,
            end,
            a,
            middle,
            depth + 1,
        ) && interval_ok(
            source,
            offset,
            distance_nm,
            start,
            end,
            middle,
            b,
            depth + 1,
        )
    }
    Ok(interval_ok(
        source_geometry,
        offset_geometry,
        distance_nm,
        start,
        end,
        0.0,
        1.0,
        0,
    ))
}

fn tangent_satisfied(
    sketch: &Sketch,
    first: &GeometryId,
    second: &GeometryId,
    first_parameter_millionths: Option<u32>,
    second_parameter_millionths: Option<u32>,
) -> Result<bool, SketchError> {
    match (
        &sketch.geometry[first].geometry,
        &sketch.geometry[second].geometry,
    ) {
        (Geometry::Line(_), Geometry::Line(_)) => Ok(false),
        (Geometry::Line(line), Geometry::Circle(_) | Geometry::Arc(_)) => {
            line_round_tangent_satisfied(sketch, line, second)
        }
        (Geometry::Circle(_) | Geometry::Arc(_), Geometry::Line(line)) => {
            line_round_tangent_satisfied(sketch, line, first)
        }
        (Geometry::Circle(_), Geometry::Circle(_)) => {
            let first_center = geometry_center(sketch, first)?;
            let second_center = geometry_center(sketch, second)?;
            let first_radius = geometry_measure(sketch, first)?;
            let second_radius = geometry_measure(sketch, second)?;
            let center_distance = distance(first_center, second_center);
            let external = first_radius + second_radius;
            let internal = (first_radius - second_radius).abs();
            if (center_distance - external).abs() > LENGTH_TOLERANCE_NM
                && (center_distance - internal).abs() > LENGTH_TOLERANCE_NM
            {
                return Ok(false);
            }
            Ok(center_distance > f64::EPSILON)
        }
        _ => general_tangent_satisfied(
            sketch,
            first,
            second,
            first_parameter_millionths,
            second_parameter_millionths,
        ),
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
    let length_squared = dx * dx + dy * dy;
    if length_squared <= f64::EPSILON
        || (numerator / length_squared.sqrt() - geometry_measure(sketch, round)?).abs()
            > LENGTH_TOLERANCE_NM
    {
        return Ok(false);
    }
    let projection = ((center.x_nm - line.start.x_nm) as f64 * dx
        + (center.y_nm - line.start.y_nm) as f64 * dy)
        / length_squared;
    if !(-1.0e-9..=1.0 + 1.0e-9).contains(&projection) {
        return Ok(false);
    }
    let contact = (
        line.start.x_nm as f64 + projection * dx,
        line.start.y_nm as f64 + projection * dy,
    );
    Ok(round_contains_contact(
        &sketch.geometry[round].geometry,
        contact,
    ))
}

fn round_contains_contact(geometry: &Geometry, contact: (f64, f64)) -> bool {
    let Geometry::Arc(arc) = geometry else {
        return true;
    };
    let start = ((arc.start.y_nm - arc.center.y_nm) as f64)
        .atan2((arc.start.x_nm - arc.center.x_nm) as f64);
    let end =
        ((arc.end.y_nm - arc.center.y_nm) as f64).atan2((arc.end.x_nm - arc.center.x_nm) as f64);
    let candidate = (contact.1 - arc.center.y_nm as f64).atan2(contact.0 - arc.center.x_nm as f64);
    let full = std::f64::consts::TAU;
    let sweep = if arc.clockwise {
        (start - end).rem_euclid(full)
    } else {
        (end - start).rem_euclid(full)
    };
    let offset = if arc.clockwise {
        (start - candidate).rem_euclid(full)
    } else {
        (candidate - start).rem_euclid(full)
    };
    offset <= sweep + ANGLE_TOLERANCE_RADIANS
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
    let mut seed = sketch.clone();
    project_constraints(&mut seed, ids, None)?;
    let backend = crate::ezpz_backend::solve_decomposed(&seed, ids)?;
    Ok(backend.unsatisfied.is_empty()
        && backend.sketch.validate().is_ok()
        && unsatisfied_constraints(&backend.sketch, ids)?.is_empty())
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
    let mut axis_angles: BTreeMap<(GeometryId, Axis2d), (i64, ConstraintId)> = BTreeMap::new();

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
            Constraint::AngleToAxis {
                line,
                axis,
                angle_microdegrees,
            } => {
                let key = (line.clone(), *axis);
                if let Some((prior, prior_id)) = axis_angles.get(&key) {
                    if prior != angle_microdegrees {
                        result.push(pair_conflict(
                            prior_id,
                            id,
                            ConflictReason::ContradictoryAxisAngle {
                                line: line.clone(),
                                axis: *axis,
                            },
                        ));
                    }
                } else {
                    axis_angles.insert(key, (*angle_microdegrees, id.clone()));
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
        Geometry::Rectangle(_)
        | Geometry::ControlPointSpline(_)
        | Geometry::FitPointSpline(_)
        | Geometry::Ellipse(_)
        | Geometry::EllipticalArc(_)
        | Geometry::Conic(_) => {
            let geometry = &sketch.geometry[id].geometry;
            let mut total = 0.0;
            let mut prior = crate::evaluate_curve(geometry, 0.0);
            for index in 1..=256 {
                let point = crate::evaluate_curve(geometry, index as f64 / 256.0);
                total += distance(prior, point);
                prior = point;
            }
            Ok(total)
        }
        Geometry::SketchPoint(_) => Err(SketchError::WrongGeometryKind(id.clone())),
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
    let expected = direction_angle(first.start, first.end) + target;
    let actual = direction_angle(second.start, second.end);
    Ok(angle_difference(expected, actual)
        .min(angle_difference(expected + std::f64::consts::PI, actual)))
}

fn closest_equivalent_line_angle(expected: f64, actual: f64) -> f64 {
    if angle_difference(expected, actual)
        <= angle_difference(expected + std::f64::consts::PI, actual)
    {
        expected
    } else {
        expected + std::f64::consts::PI
    }
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
