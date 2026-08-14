use crate::{
    Anchor, Axis2d, Constraint as SketchConstraint, ConstraintId, Geometry, GeometryId,
    GraphDecompositionFrontend, Point2, PointRef, Sketch, SketchError, SolveComponent,
};
use ezpz::{
    CircleSide, Config, Constraint, ConstraintRequest, Id, IdGenerator, LineSide,
    datatypes::{
        Angle, AngleKind,
        inputs::{DatumCircle, DatumCircularArc, DatumDistance, DatumLineSegment, DatumPoint},
    },
    solve_analysis,
};
use std::collections::BTreeMap;

const MAX_ITERATIONS: usize = 128;

#[derive(Clone)]
enum Binding {
    Line(DatumLineSegment),
    Circle(DatumCircle),
    Arc {
        arc: DatumCircularArc,
        radius: DatumDistance,
    },
    Rectangle {
        min: DatumPoint,
        max: DatumPoint,
    },
    ControlPointSpline(Vec<DatumPoint>),
    FitPointSpline([DatumPoint; 4]),
    Ellipse {
        center: DatumPoint,
        major: DatumPoint,
        minor: DatumPoint,
    },
    EllipticalArc {
        center: DatumPoint,
        major: DatumPoint,
        minor: DatumPoint,
        start: DatumPoint,
        end: DatumPoint,
    },
    Conic {
        start: DatumPoint,
        control: DatumPoint,
        end: DatumPoint,
        weight: DatumDistance,
    },
    SketchPoint(DatumPoint),
}

fn binding_points(binding: Binding) -> Vec<DatumPoint> {
    match binding {
        Binding::Line(line) => vec![line.p0, line.p1],
        Binding::Circle(circle) => vec![circle.center],
        Binding::Arc { arc, .. } => vec![arc.center, arc.start, arc.end],
        Binding::Rectangle { min, max } => vec![min, max],
        Binding::ControlPointSpline(points) => points,
        Binding::FitPointSpline(points) => points.to_vec(),
        Binding::Ellipse {
            center,
            major,
            minor,
        } => vec![center, major, minor],
        Binding::EllipticalArc {
            center,
            major,
            minor,
            start,
            end,
        } => vec![center, major, minor, start, end],
        Binding::Conic {
            start,
            control,
            end,
            ..
        } => vec![start, control, end],
        Binding::SketchPoint(point) => vec![point],
    }
}

pub(crate) struct BackendSolve {
    pub sketch: Sketch,
    pub unsatisfied: Vec<ConstraintId>,
    /// Scalar variables EZPZ identifies as participating in unconstrained
    /// motion. This is deliberately not called degrees-of-freedom: EZPZ
    /// reports affected variables rather than the null-space dimension.
    pub underconstrained_variables: u32,
}

struct ComponentSolve {
    unsatisfied: Vec<ConstraintId>,
    underconstrained_variables: u32,
}

pub(crate) fn solve_decomposed(
    sketch: &Sketch,
    active_constraints: &[ConstraintId],
) -> Result<BackendSolve, SketchError> {
    let active = active_constraints.iter().cloned().collect();
    let components = GraphDecompositionFrontend
        .decompose_active(sketch, &active)
        .components;
    solve_decomposed_with_fixed_point(sketch, active_constraints, &components, None)
}

/// Solve a graph plan already prepared by the authoritative structural pass.
/// The same components can then be returned in `SolveResult` without running
/// decomposition a second time.
pub(crate) fn solve_decomposed_with_components(
    sketch: &Sketch,
    active_constraints: &[ConstraintId],
    components: &[SolveComponent],
) -> Result<BackendSolve, SketchError> {
    solve_decomposed_with_fixed_point(sketch, active_constraints, components, None)
}

pub(crate) fn solve_decomposed_for_drag_with_components(
    sketch: &Sketch,
    active_constraints: &[ConstraintId],
    components: &[SolveComponent],
    driven: &PointRef,
) -> Result<BackendSolve, SketchError> {
    solve_decomposed_with_fixed_point(sketch, active_constraints, components, Some(driven))
}

fn solve_decomposed_with_fixed_point(
    sketch: &Sketch,
    active_constraints: &[ConstraintId],
    components: &[SolveComponent],
    driven: Option<&PointRef>,
) -> Result<BackendSolve, SketchError> {
    let active: std::collections::BTreeSet<_> = active_constraints.iter().cloned().collect();
    let mut solved = sketch.clone();
    let mut unsatisfied = Vec::new();
    let mut underconstrained_variables = 0_u32;

    for component in components {
        let component_constraints = component
            .constraints
            .iter()
            .filter(|id| active.contains(*id))
            .cloned()
            .collect::<Vec<_>>();
        let component_driven = driven.filter(|point| component.geometry.contains(&point.geometry));
        let outcome = solve_component(
            sketch,
            &mut solved,
            component,
            &component_constraints,
            component_driven,
        )?;
        unsatisfied.extend(outcome.unsatisfied);
        underconstrained_variables =
            underconstrained_variables.saturating_add(outcome.underconstrained_variables);
    }
    unsatisfied.sort();
    unsatisfied.dedup();
    Ok(BackendSolve {
        sketch: solved,
        unsatisfied,
        underconstrained_variables,
    })
}

fn solve_component(
    sketch: &Sketch,
    solved_sketch: &mut Sketch,
    component: &SolveComponent,
    active_constraints: &[ConstraintId],
    driven: Option<&PointRef>,
) -> Result<ComponentSolve, SketchError> {
    let mut problem = Problem::new();
    for geometry_id in &component.geometry {
        problem.add_geometry(geometry_id, &sketch.geometry[geometry_id].geometry);
    }
    for constraint_id in active_constraints {
        problem.add_constraint(constraint_id, &sketch.constraints[constraint_id])?;
    }
    if let Some(point) = driven {
        let target = sketch.point(point)?;
        problem.fix_point(point, target)?;
    }

    // EZPZ currently skips freedom analysis for an entirely constraint-free
    // problem. In that case every submitted scalar is free, and there are no
    // internal auxiliary scalars because arcs add their own equations below.
    if problem.requests.is_empty() {
        return Ok(ComponentSolve {
            unsatisfied: Vec::new(),
            underconstrained_variables: u32::try_from(problem.initial_guesses.len())
                .unwrap_or(u32::MAX),
        });
    }

    let solved = match solve_analysis(
        &problem.requests,
        problem.initial_guesses.clone(),
        Config::default().with_max_iterations(MAX_ITERATIONS),
    ) {
        Ok(solved) => solved,
        Err(_) => {
            return Ok(ComponentSolve {
                unsatisfied: active_constraints.to_vec(),
                underconstrained_variables: 0,
            });
        }
    };

    let unsatisfied = solved
        .outcome
        .unsatisfied()
        .iter()
        .filter_map(|index| problem.request_sources.get(*index).and_then(Clone::clone))
        .collect::<Vec<_>>();
    if unsatisfied.is_empty() && solved.outcome.converged() {
        problem.write_solution(solved_sketch, &solved.outcome)?;
    }
    let underconstrained_variables =
        u32::try_from(solved.analysis.underconstrained().len()).unwrap_or(u32::MAX);

    Ok(ComponentSolve {
        unsatisfied,
        underconstrained_variables,
    })
}

struct Problem {
    ids: IdGenerator,
    bindings: BTreeMap<GeometryId, Binding>,
    initial_guesses: Vec<(Id, f64)>,
    requests: Vec<ConstraintRequest>,
    request_sources: Vec<Option<ConstraintId>>,
    origin: Option<DatumPoint>,
    geometry_values: BTreeMap<GeometryId, Geometry>,
}

impl Problem {
    fn new() -> Self {
        Self {
            ids: IdGenerator::default(),
            bindings: BTreeMap::new(),
            initial_guesses: Vec::new(),
            requests: Vec::new(),
            request_sources: Vec::new(),
            origin: None,
            geometry_values: BTreeMap::new(),
        }
    }

    fn point(&mut self, value: Point2) -> DatumPoint {
        let point = DatumPoint::new(&mut self.ids);
        self.initial_guesses.push((point.id_x(), value.x_nm as f64));
        self.initial_guesses.push((point.id_y(), value.y_nm as f64));
        point
    }

    fn distance(&mut self, value: f64) -> DatumDistance {
        let distance = DatumDistance::new(self.ids.next_id());
        self.initial_guesses.push((distance.id, value));
        distance
    }

    fn initial_value(&self, id: Id) -> f64 {
        self.initial_guesses
            .iter()
            .find_map(|(candidate, value)| (*candidate == id).then_some(*value))
            .unwrap_or(0.0)
    }

    fn add_geometry(&mut self, id: &GeometryId, geometry: &Geometry) {
        self.geometry_values.insert(id.clone(), geometry.clone());
        let binding = match geometry {
            Geometry::Line(line) => Binding::Line(DatumLineSegment::new(
                self.point(line.start),
                self.point(line.end),
            )),
            Geometry::Circle(circle) => {
                let center = self.point(circle.center);
                let radius = self.distance(circle.radius_nm as f64);
                Binding::Circle(DatumCircle { center, radius })
            }
            Geometry::Arc(value) => {
                let center = self.point(value.center);
                let start = self.point(value.start);
                let end = self.point(value.end);
                let radius = self.distance(distance(value.center, value.start));
                let arc = DatumCircularArc { center, start, end };
                self.push_internal(Constraint::Arc(arc));
                self.push_internal(Constraint::DistanceVar(center, start, radius));
                Binding::Arc { arc, radius }
            }
            Geometry::Rectangle(rectangle) => Binding::Rectangle {
                min: self.point(rectangle.min),
                max: self.point(rectangle.max),
            },
            Geometry::ControlPointSpline(spline) => Binding::ControlPointSpline(
                spline
                    .control_points
                    .iter()
                    .copied()
                    .map(|point| self.point(point))
                    .collect(),
            ),
            Geometry::FitPointSpline(spline) => Binding::FitPointSpline([
                self.point(spline.fit_points[0]),
                self.point(spline.fit_points[1]),
                self.point(spline.fit_points[2]),
                self.point(spline.fit_points[3]),
            ]),
            Geometry::Ellipse(ellipse) => Binding::Ellipse {
                center: self.point(ellipse.center),
                major: self.point(ellipse.major),
                minor: self.point(ellipse.minor),
            },
            Geometry::EllipticalArc(arc) => Binding::EllipticalArc {
                center: self.point(arc.center),
                major: self.point(arc.major),
                minor: self.point(arc.minor),
                start: self.point(arc.start),
                end: self.point(arc.end),
            },
            Geometry::Conic(conic) => Binding::Conic {
                start: self.point(conic.start),
                control: self.point(conic.control),
                end: self.point(conic.end),
                weight: self.distance(conic.weight_millionths as f64),
            },
            Geometry::SketchPoint(point) => Binding::SketchPoint(self.point(*point)),
        };
        self.bindings.insert(id.clone(), binding);
    }

    fn add_constraint(
        &mut self,
        id: &ConstraintId,
        constraint: &SketchConstraint,
    ) -> Result<(), SketchError> {
        match constraint {
            SketchConstraint::Coincident { a, b } => {
                let (a, b) = (self.point_ref(a)?, self.point_ref(b)?);
                self.push(id, Constraint::PointsCoincident(a, b));
            }
            SketchConstraint::HorizontalPoints { a, b } => {
                let (a, b) = (self.point_ref(a)?, self.point_ref(b)?);
                self.push(id, Constraint::Horizontal(DatumLineSegment::new(a, b)));
            }
            SketchConstraint::VerticalPoints { a, b } => {
                let (a, b) = (self.point_ref(a)?, self.point_ref(b)?);
                self.push(id, Constraint::Vertical(DatumLineSegment::new(a, b)));
            }
            SketchConstraint::PointOnOrigin { point } => {
                let point = self.point_ref(point)?;
                self.push(id, Constraint::Fixed(point.id_x(), 0.0));
                self.push(id, Constraint::Fixed(point.id_y(), 0.0));
            }
            SketchConstraint::Fixed { point, x_nm, y_nm } => {
                let point = self.point_ref(point)?;
                self.push(id, Constraint::Fixed(point.id_x(), *x_nm as f64));
                self.push(id, Constraint::Fixed(point.id_y(), *y_nm as f64));
            }
            SketchConstraint::FixedGeometry { geometry } => {
                for point in binding_points(self.binding(geometry)?) {
                    self.pin_point(id, point);
                }
            }
            SketchConstraint::Midpoint { point, line } => {
                let point = self.point_ref(point)?;
                let line = self.line(line)?;
                self.push(id, Constraint::Midpoint(line, point));
            }
            SketchConstraint::Concentric { first, second } => {
                let first = as_circle(self.binding(first)?)
                    .ok_or_else(|| SketchError::WrongGeometryKind(first.clone()))?;
                let second = as_circle(self.binding(second)?)
                    .ok_or_else(|| SketchError::WrongGeometryKind(second.clone()))?;
                self.push(
                    id,
                    Constraint::PointsCoincident(first.center, second.center),
                );
            }
            SketchConstraint::PointOnObject { point, geometry } => {
                let point = self.point_ref(point)?;
                match self.binding(geometry)? {
                    Binding::Line(line) => {
                        self.push(id, Constraint::PointLineDistance(point, line, 0.0))
                    }
                    Binding::Circle(circle) => self.push(
                        id,
                        Constraint::DistanceVar(circle.center, point, circle.radius),
                    ),
                    Binding::Arc { arc, .. } => {
                        self.push(id, Constraint::PointArcCoincident(arc, point))
                    }
                    Binding::ControlPointSpline(_)
                    | Binding::FitPointSpline(_)
                    | Binding::Ellipse { .. }
                    | Binding::EllipticalArc { .. }
                    | Binding::Conic { .. } => {
                        // The integer-grid projection pass has already selected
                        // the closest native-curve point. Pin that accepted seed
                        // for EZPZ, whose public constraint vocabulary does not
                        // yet expose general parametric curves.
                        let x = self.initial_value(point.id_x());
                        let y = self.initial_value(point.id_y());
                        self.push(id, Constraint::Fixed(point.id_x(), x));
                        self.push(id, Constraint::Fixed(point.id_y(), y));
                    }
                    Binding::Rectangle { .. } | Binding::SketchPoint(_) => {
                        return Err(SketchError::WrongGeometryKind(geometry.clone()));
                    }
                }
            }
            SketchConstraint::Collinear { point, line } => {
                let point = self.point_ref(point)?;
                let line = self.line(line)?;
                self.push(id, Constraint::PointLineDistance(point, line, 0.0));
            }
            SketchConstraint::Symmetry { second, .. } => {
                let point = self.point_ref(second)?;
                self.pin_point(id, point);
            }
            SketchConstraint::CurvatureContinuous { second, .. } => {
                for point in binding_points(self.binding(second)?) {
                    self.pin_point(id, point);
                }
            }
            SketchConstraint::Horizontal { line } => {
                self.push(id, Constraint::Horizontal(self.line(line)?));
            }
            SketchConstraint::Vertical { line } => {
                self.push(id, Constraint::Vertical(self.line(line)?));
            }
            SketchConstraint::Parallel { first, second } => {
                let (first, second) = (self.line(first)?, self.line(second)?);
                self.push(
                    id,
                    Constraint::LinesAtAngle(first, second, AngleKind::Parallel),
                );
            }
            SketchConstraint::Perpendicular { first, second } => {
                let (first, second) = (self.line(first)?, self.line(second)?);
                self.push(
                    id,
                    Constraint::LinesAtAngle(first, second, AngleKind::Perpendicular),
                );
            }
            SketchConstraint::Angle {
                first,
                second,
                angle_microdegrees,
            } => {
                let (first, second) = (self.line(first)?, self.line(second)?);
                self.push(
                    id,
                    Constraint::LinesAtAngle(
                        first,
                        second,
                        AngleKind::Other(Angle::from_degrees(
                            *angle_microdegrees as f64 / 1_000_000.0,
                        )),
                    ),
                );
            }
            SketchConstraint::AngleToAxis {
                line,
                axis,
                angle_microdegrees,
            } => {
                let moving = self.line(line)?;
                // EZPZ exposes angles only between two line segments. This
                // fixed plane-local datum is internal solver state and never
                // becomes user-visible sketch geometry.
                let end_value = match axis {
                    Axis2d::X => Point2::new(1, 0),
                    Axis2d::Y => Point2::new(0, 1),
                };
                let origin = self.point(Point2::new(0, 0));
                let end = self.point(end_value);
                self.push_internal(Constraint::Fixed(origin.id_x(), 0.0));
                self.push_internal(Constraint::Fixed(origin.id_y(), 0.0));
                self.push_internal(Constraint::Fixed(end.id_x(), end_value.x_nm as f64));
                self.push_internal(Constraint::Fixed(end.id_y(), end_value.y_nm as f64));
                self.push(
                    id,
                    Constraint::LinesAtAngle(
                        DatumLineSegment::new(origin, end),
                        moving,
                        AngleKind::Other(Angle::from_degrees(
                            *angle_microdegrees as f64 / 1_000_000.0,
                        )),
                    ),
                );
            }
            SketchConstraint::Distance { a, b, distance_nm } => {
                let (a, b) = (self.point_ref(a)?, self.point_ref(b)?);
                self.push(id, Constraint::Distance(a, b, *distance_nm as f64));
            }
            SketchConstraint::DistanceX { a, b, distance_nm } => {
                let (a, b) = (self.point_ref(a)?, self.point_ref(b)?);
                self.push(
                    id,
                    Constraint::HorizontalDistance(a, b, *distance_nm as f64),
                );
            }
            SketchConstraint::DistanceY { a, b, distance_nm } => {
                let (a, b) = (self.point_ref(a)?, self.point_ref(b)?);
                self.push(id, Constraint::VerticalDistance(a, b, *distance_nm as f64));
            }
            SketchConstraint::PointLineDistance {
                point,
                line,
                distance_nm,
            } => {
                let (point, line) = (self.point_ref(point)?, self.line(line)?);
                self.push(
                    id,
                    Constraint::PointLineDistance(point, line, *distance_nm as f64),
                );
            }
            SketchConstraint::LineDistance {
                first,
                second,
                distance_nm,
            } => {
                let lines = [self.line(first)?, self.line(second)?];
                for constraint in Constraint::parallel_lines_distance(lines, *distance_nm as f64) {
                    self.push(id, constraint);
                }
            }
            SketchConstraint::OffsetDistance { offset, .. } => {
                for point in binding_points(self.binding(offset)?) {
                    self.pin_point(id, point);
                }
            }
            SketchConstraint::Radius {
                geometry,
                radius_nm,
            } => match self.binding(geometry)? {
                Binding::Circle(circle) => {
                    self.push(id, Constraint::CircleRadius(circle, *radius_nm as f64));
                }
                Binding::Arc { arc, .. } => {
                    self.push(id, Constraint::ArcRadius(arc, *radius_nm as f64));
                }
                _ => return Err(SketchError::WrongGeometryKind(geometry.clone())),
            },
            SketchConstraint::Diameter {
                geometry,
                diameter_nm,
            } => match self.binding(geometry)? {
                Binding::Circle(circle) => self.push(
                    id,
                    Constraint::CircleRadius(circle, *diameter_nm as f64 / 2.0),
                ),
                Binding::Arc { arc, .. } => {
                    self.push(id, Constraint::ArcRadius(arc, *diameter_nm as f64 / 2.0))
                }
                _ => return Err(SketchError::WrongGeometryKind(geometry.clone())),
            },
            SketchConstraint::EllipseRadius {
                geometry,
                axis,
                radius_nm,
            } => match (self.binding(geometry)?, axis) {
                (
                    Binding::Ellipse { center, major, .. }
                    | Binding::EllipticalArc { center, major, .. },
                    Anchor::Major,
                ) => self.push(id, Constraint::Distance(center, major, *radius_nm as f64)),
                (
                    Binding::Ellipse { center, minor, .. }
                    | Binding::EllipticalArc { center, minor, .. },
                    Anchor::Minor,
                ) => self.push(id, Constraint::Distance(center, minor, *radius_nm as f64)),
                _ => return Err(SketchError::WrongGeometryKind(geometry.clone())),
            },
            SketchConstraint::Equal { first, second } => {
                self.add_equal(id, first, second)?;
            }
            SketchConstraint::Tangent { first, second, .. } => {
                self.add_tangent(id, first, second)?;
            }
        }
        Ok(())
    }

    fn fix_point(&mut self, point: &PointRef, target: Point2) -> Result<(), SketchError> {
        let datum = self.point_ref(point)?;
        self.push_internal(Constraint::Fixed(datum.id_x(), target.x_nm as f64));
        self.push_internal(Constraint::Fixed(datum.id_y(), target.y_nm as f64));
        Ok(())
    }

    fn add_equal(
        &mut self,
        id: &ConstraintId,
        first: &GeometryId,
        second: &GeometryId,
    ) -> Result<(), SketchError> {
        match (self.binding(first)?, self.binding(second)?) {
            (Binding::Line(a), Binding::Line(b)) => {
                self.push(id, Constraint::LinesEqualLength(a, b));
            }
            (a, b) if round_radius(a.clone()).is_some() && round_radius(b.clone()).is_some() => {
                self.push(
                    id,
                    Constraint::ScalarEqual(
                        round_radius(a).unwrap().id,
                        round_radius(b).unwrap().id,
                    ),
                );
            }
            (Binding::Line(line), round) | (round, Binding::Line(line))
                if round_radius(round.clone()).is_some() =>
            {
                let initial = self.line_initial_length(line);
                let length = self.distance(initial);
                self.push(id, Constraint::DistanceVar(line.p0, line.p1, length));
                self.push(
                    id,
                    Constraint::ScalarEqual(length.id, round_radius(round).unwrap().id),
                );
            }
            (_, moving) => {
                for point in binding_points(moving) {
                    self.pin_point(id, point);
                }
            }
        }
        Ok(())
    }

    fn add_tangent(
        &mut self,
        id: &ConstraintId,
        first: &GeometryId,
        second: &GeometryId,
    ) -> Result<(), SketchError> {
        match (self.binding(first)?, self.binding(second)?) {
            (Binding::Line(a), Binding::Line(b)) => {
                self.push(id, Constraint::LinesAtAngle(a, b, AngleKind::Parallel))
            }
            (Binding::Line(line), round) | (round, Binding::Line(line))
                if as_circle(round.clone()).is_some() =>
            {
                self.push(
                    id,
                    Constraint::LineTangentToCircle(
                        line,
                        as_circle(round).unwrap(),
                        LineSide::Undefined,
                    ),
                );
            }
            (a, b) if as_circle(a.clone()).is_some() && as_circle(b.clone()).is_some() => self
                .push(
                    id,
                    Constraint::CircleTangentToCircle(
                        as_circle(a).unwrap(),
                        as_circle(b).unwrap(),
                        CircleSide::Undefined,
                    ),
                ),
            (_, moving) => {
                for point in binding_points(moving) {
                    self.pin_point(id, point);
                }
            }
        }
        Ok(())
    }

    fn push(&mut self, source: &ConstraintId, constraint: Constraint) {
        self.requests
            .push(ConstraintRequest::highest_priority(constraint));
        self.request_sources.push(Some(source.clone()));
    }

    fn pin_point(&mut self, source: &ConstraintId, point: DatumPoint) {
        let x = self.initial_value(point.id_x());
        let y = self.initial_value(point.id_y());
        self.push(source, Constraint::Fixed(point.id_x(), x));
        self.push(source, Constraint::Fixed(point.id_y(), y));
    }

    fn pin_point_internal(&mut self, point: DatumPoint) {
        let x = self.initial_value(point.id_x());
        let y = self.initial_value(point.id_y());
        self.push_internal(Constraint::Fixed(point.id_x(), x));
        self.push_internal(Constraint::Fixed(point.id_y(), y));
    }

    fn push_internal(&mut self, constraint: Constraint) {
        self.requests
            .push(ConstraintRequest::highest_priority(constraint));
        self.request_sources.push(None);
    }

    fn binding(&self, id: &GeometryId) -> Result<Binding, SketchError> {
        self.bindings
            .get(id)
            .cloned()
            .ok_or_else(|| SketchError::MissingGeometry(id.clone()))
    }

    fn line(&self, id: &GeometryId) -> Result<DatumLineSegment, SketchError> {
        match self.binding(id)? {
            Binding::Line(line) => Ok(line),
            _ => Err(SketchError::WrongGeometryKind(id.clone())),
        }
    }

    fn point_ref(&mut self, point: &PointRef) -> Result<DatumPoint, SketchError> {
        if point.is_origin() {
            if let Some(origin) = self.origin {
                return Ok(origin);
            }
            let origin = self.point(Point2::new(0, 0));
            self.push_internal(Constraint::Fixed(origin.id_x(), 0.0));
            self.push_internal(Constraint::Fixed(origin.id_y(), 0.0));
            self.origin = Some(origin);
            return Ok(origin);
        }
        if let Anchor::CurveParameter(value) = point.anchor {
            let geometry = self
                .geometry_values
                .get(&point.geometry)
                .cloned()
                .ok_or_else(|| SketchError::MissingGeometry(point.geometry.clone()))?;
            let datum = self.point(crate::curve::evaluate_curve(
                &geometry,
                value as f64 / 1_000_000.0,
            ));
            self.pin_point_internal(datum);
            return Ok(datum);
        }
        if let Anchor::Knot(index) = point.anchor {
            let geometry = self
                .geometry_values
                .get(&point.geometry)
                .cloned()
                .ok_or_else(|| SketchError::MissingGeometry(point.geometry.clone()))?;
            let (index, denominator) = match &geometry {
                Geometry::ControlPointSpline(value) => {
                    let knots = crate::curve::control_spline_knots(value);
                    let knot_index = index.min(knots.len().saturating_sub(1) as u32) as usize;
                    let datum =
                        self.point(crate::curve::evaluate_curve(&geometry, knots[knot_index]));
                    self.pin_point_internal(datum);
                    return Ok(datum);
                }
                Geometry::FitPointSpline(value) => {
                    let denominator = value.fit_points.len().saturating_sub(1).max(1);
                    (index.min(denominator as u32), denominator)
                }
                _ => {
                    return Err(SketchError::WrongAnchor {
                        geometry: point.geometry.clone(),
                        anchor: point.anchor,
                    });
                }
            };
            let datum = self.point(crate::curve::evaluate_curve(
                &geometry,
                index as f64 / denominator as f64,
            ));
            self.pin_point_internal(datum);
            return Ok(datum);
        }
        let binding = self.binding(&point.geometry)?;
        match (binding, point.anchor) {
            (Binding::Line(line), Anchor::Start) => Ok(line.p0),
            (Binding::Line(line), Anchor::End) => Ok(line.p1),
            (Binding::Circle(circle), Anchor::Center) => Ok(circle.center),
            (Binding::Arc { arc, .. }, Anchor::Center) => Ok(arc.center),
            (Binding::Arc { arc, .. }, Anchor::Start) => Ok(arc.start),
            (Binding::Arc { arc, .. }, Anchor::End) => Ok(arc.end),
            (Binding::Rectangle { min, .. }, Anchor::Min) => Ok(min),
            (Binding::Rectangle { max, .. }, Anchor::Max) => Ok(max),
            (Binding::ControlPointSpline(points), Anchor::Start) => points
                .first()
                .copied()
                .ok_or_else(|| SketchError::WrongAnchor {
                    geometry: point.geometry.clone(),
                    anchor: point.anchor,
                }),
            (Binding::ControlPointSpline(points), Anchor::End) => points
                .last()
                .copied()
                .ok_or_else(|| SketchError::WrongAnchor {
                    geometry: point.geometry.clone(),
                    anchor: point.anchor,
                }),
            (Binding::ControlPointSpline(points), Anchor::ControlPoint(index)) => points
                .get(index as usize)
                .copied()
                .ok_or_else(|| SketchError::WrongAnchor {
                    geometry: point.geometry.clone(),
                    anchor: point.anchor,
                }),
            (Binding::FitPointSpline(points), Anchor::Start) => Ok(points[0]),
            (Binding::FitPointSpline(points), Anchor::End) => Ok(points[3]),
            (Binding::FitPointSpline(points), Anchor::FitPoint(index)) => points
                .get(index as usize)
                .copied()
                .ok_or_else(|| SketchError::WrongAnchor {
                    geometry: point.geometry.clone(),
                    anchor: point.anchor,
                }),
            (Binding::Ellipse { center, .. }, Anchor::Center) => Ok(center),
            (Binding::Ellipse { major, .. }, Anchor::Major) => Ok(major),
            (Binding::Ellipse { minor, .. }, Anchor::Minor) => Ok(minor),
            (Binding::EllipticalArc { center, .. }, Anchor::Center) => Ok(center),
            (Binding::EllipticalArc { major, .. }, Anchor::Major) => Ok(major),
            (Binding::EllipticalArc { minor, .. }, Anchor::Minor) => Ok(minor),
            (Binding::EllipticalArc { start, .. }, Anchor::Start) => Ok(start),
            (Binding::EllipticalArc { end, .. }, Anchor::End) => Ok(end),
            (Binding::Conic { start, .. }, Anchor::Start) => Ok(start),
            (Binding::Conic { control, .. }, Anchor::Control) => Ok(control),
            (Binding::Conic { end, .. }, Anchor::End) => Ok(end),
            (Binding::SketchPoint(position), Anchor::Position) => Ok(position),
            _ => Err(SketchError::WrongAnchor {
                geometry: point.geometry.clone(),
                anchor: point.anchor,
            }),
        }
    }

    fn line_initial_length(&self, line: DatumLineSegment) -> f64 {
        let value = |id: Id| self.initial_guesses[id as usize].1;
        (value(line.p1.id_x()) - value(line.p0.id_x()))
            .hypot(value(line.p1.id_y()) - value(line.p0.id_y()))
    }

    fn write_solution(
        &self,
        sketch: &mut Sketch,
        outcome: &ezpz::SolveOutcome,
    ) -> Result<(), SketchError> {
        for (id, binding) in &self.bindings {
            let entity = sketch
                .geometry
                .get_mut(id)
                .ok_or_else(|| SketchError::MissingGeometry(id.clone()))?;
            match (&mut entity.geometry, binding) {
                (Geometry::Line(line), Binding::Line(datum)) => {
                    line.start = solved_point(outcome, datum.p0)?;
                    line.end = solved_point(outcome, datum.p1)?;
                }
                (Geometry::Circle(circle), Binding::Circle(datum)) => {
                    let solved = outcome.final_value_circle(datum);
                    circle.center = point_from_f64(solved.center.x, solved.center.y)?;
                    circle.radius_nm = scalar_from_f64(solved.radius)?;
                }
                (Geometry::Arc(arc), Binding::Arc { arc: datum, .. }) => {
                    let solved = outcome.final_value_arc(datum);
                    arc.center = point_from_f64(solved.center.x, solved.center.y)?;
                    arc.start = point_from_f64(solved.a.x, solved.a.y)?;
                    let desired_end = point_from_f64(solved.b.x, solved.b.y)?;
                    arc.end = matching_radius_point(arc.center, arc.start, desired_end, arc.start);
                }
                (Geometry::Rectangle(rectangle), Binding::Rectangle { min, max }) => {
                    rectangle.min = solved_point(outcome, *min)?;
                    rectangle.max = solved_point(outcome, *max)?;
                }
                (Geometry::ControlPointSpline(spline), Binding::ControlPointSpline(points)) => {
                    spline.control_points = points
                        .iter()
                        .map(|point| solved_point(outcome, *point))
                        .collect::<Result<Vec<_>, _>>()?;
                }
                (Geometry::FitPointSpline(spline), Binding::FitPointSpline(points)) => {
                    spline.fit_points = points
                        .iter()
                        .map(|point| solved_point(outcome, *point))
                        .collect::<Result<Vec<_>, _>>()?;
                }
                (
                    Geometry::Ellipse(ellipse),
                    Binding::Ellipse {
                        center,
                        major,
                        minor,
                    },
                ) => {
                    ellipse.center = solved_point(outcome, *center)?;
                    ellipse.major = solved_point(outcome, *major)?;
                    ellipse.minor = solved_point(outcome, *minor)?;
                }
                (
                    Geometry::EllipticalArc(arc),
                    Binding::EllipticalArc {
                        center,
                        major,
                        minor,
                        start,
                        end,
                    },
                ) => {
                    arc.center = solved_point(outcome, *center)?;
                    arc.major = solved_point(outcome, *major)?;
                    arc.minor = solved_point(outcome, *minor)?;
                    arc.start = crate::model::project_to_ellipse(
                        arc.center,
                        arc.major,
                        arc.minor,
                        solved_point(outcome, *start)?,
                    );
                    arc.end = crate::model::project_to_ellipse(
                        arc.center,
                        arc.major,
                        arc.minor,
                        solved_point(outcome, *end)?,
                    );
                }
                (
                    Geometry::Conic(conic),
                    Binding::Conic {
                        start,
                        control,
                        end,
                        weight,
                    },
                ) => {
                    conic.start = solved_point(outcome, *start)?;
                    conic.control = solved_point(outcome, *control)?;
                    conic.end = solved_point(outcome, *end)?;
                    conic.weight_millionths =
                        scalar_from_f64(outcome.final_value_distance(weight))?;
                }
                (Geometry::SketchPoint(point), Binding::SketchPoint(position)) => {
                    *point = solved_point(outcome, *position)?
                }
                _ => return Err(SketchError::WrongGeometryKind(id.clone())),
            }
        }
        Ok(())
    }
}

fn round_radius(binding: Binding) -> Option<DatumDistance> {
    match binding {
        Binding::Circle(circle) => Some(circle.radius),
        Binding::Arc { radius, .. } => Some(radius),
        _ => None,
    }
}

fn as_circle(binding: Binding) -> Option<DatumCircle> {
    match binding {
        Binding::Circle(circle) => Some(circle),
        Binding::Arc { arc, radius } => Some(DatumCircle {
            center: arc.center,
            radius,
        }),
        _ => None,
    }
}

fn solved_point(outcome: &ezpz::SolveOutcome, point: DatumPoint) -> Result<Point2, SketchError> {
    let solved = outcome.final_value_point(&point);
    point_from_f64(solved.x, solved.y)
}

fn point_from_f64(x: f64, y: f64) -> Result<Point2, SketchError> {
    Ok(Point2::new(scalar_from_f64(x)?, scalar_from_f64(y)?))
}

fn scalar_from_f64(value: f64) -> Result<i64, SketchError> {
    if !value.is_finite() || value < i64::MIN as f64 || value > i64::MAX as f64 {
        return Err(SketchError::Solver(
            "non-finite or out-of-range solution".into(),
        ));
    }
    Ok(value.round() as i64)
}

fn distance(a: Point2, b: Point2) -> f64 {
    (a.x_nm as f64 - b.x_nm as f64).hypot(a.y_nm as f64 - b.y_nm as f64)
}

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
