use crate::{Constraint, ConstraintId, Geometry, GeometryId, Sketch};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

/// One connected component of the sketch's entity/constraint bipartite graph.
///
/// Geometry and constraints retain their durable IDs. Component IDs are stable
/// for a canonical sketch because traversal always starts at the smallest
/// unvisited geometry ID and visits sorted neighbours.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SolveComponent {
    pub id: u32,
    pub geometry: Vec<GeometryId>,
    pub constraints: Vec<ConstraintId>,
    pub variable_count: u32,
    pub equation_count: u32,
    pub structural_rank: u32,
    pub structural_degrees_of_freedom: u32,
    pub structurally_redundant_equations: u32,
}

/// Deterministic graph decomposition consumed by the numeric solver frontend.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Decomposition {
    pub components: Vec<SolveComponent>,
}

/// PlaneGCS-inspired graph preparation boundary in front of EZPZ.
///
/// Keeping this as a named frontend prevents numeric-backend details from
/// leaking into the durable sketch model and gives later structural analysis a
/// single place to add variable reduction or richer decomposition plans.
#[derive(Clone, Copy, Debug, Default)]
pub struct GraphDecompositionFrontend;

impl GraphDecompositionFrontend {
    /// Build a conservative entity/constraint graph.
    ///
    /// This follows PlaneGCS's useful separation of topology analysis from
    /// numeric solving: geometry entities and driving constraints are the two
    /// node partitions, and references are graph edges. Connected components
    /// can be sent to EZPZ independently without changing the solution set.
    pub fn decompose(&self, sketch: &Sketch) -> Decomposition {
        self.decompose_with_constraints(sketch, None)
    }

    /// Build the solve graph for an already classified active constraint set.
    /// This lets the numeric backend and result classifier share one graph
    /// without cloning the sketch merely to remove suppressed or redundant
    /// constraints.
    pub fn decompose_active(
        &self,
        sketch: &Sketch,
        active_constraints: &BTreeSet<ConstraintId>,
    ) -> Decomposition {
        self.decompose_with_constraints(sketch, Some(active_constraints))
    }

    fn decompose_with_constraints(
        &self,
        sketch: &Sketch,
        active_constraints: Option<&BTreeSet<ConstraintId>>,
    ) -> Decomposition {
        let mut geometry_to_constraints: BTreeMap<GeometryId, BTreeSet<ConstraintId>> = sketch
            .geometry
            .keys()
            .cloned()
            .map(|id| (id, BTreeSet::new()))
            .collect();
        let mut constraint_to_geometry = BTreeMap::new();

        for (constraint_id, constraint) in &sketch.constraints {
            if sketch.suppressed_constraints.contains(constraint_id)
                || active_constraints.is_some_and(|active| !active.contains(constraint_id))
            {
                continue;
            }
            let referenced: BTreeSet<GeometryId> = constraint
                .referenced_geometry()
                .into_iter()
                .cloned()
                .collect();
            for geometry_id in &referenced {
                geometry_to_constraints
                    .entry(geometry_id.clone())
                    .or_default()
                    .insert(constraint_id.clone());
            }
            constraint_to_geometry.insert(constraint_id.clone(), referenced);
        }

        let mut visited_geometry = BTreeSet::new();
        let mut visited_constraints = BTreeSet::new();
        let mut components = Vec::new();

        for root in sketch.geometry.keys() {
            if visited_geometry.contains(root) {
                continue;
            }
            let mut geometry = BTreeSet::new();
            let mut constraints = BTreeSet::new();
            let mut geometry_queue = VecDeque::from([root.clone()]);
            let mut constraint_queue = VecDeque::new();

            while !geometry_queue.is_empty() || !constraint_queue.is_empty() {
                while let Some(geometry_id) = geometry_queue.pop_front() {
                    if !visited_geometry.insert(geometry_id.clone()) {
                        continue;
                    }
                    geometry.insert(geometry_id.clone());
                    if let Some(neighbours) = geometry_to_constraints.get(&geometry_id) {
                        constraint_queue.extend(neighbours.iter().cloned());
                    }
                }
                while let Some(constraint_id) = constraint_queue.pop_front() {
                    if !visited_constraints.insert(constraint_id.clone()) {
                        continue;
                    }
                    constraints.insert(constraint_id.clone());
                    if let Some(neighbours) = constraint_to_geometry.get(&constraint_id) {
                        geometry_queue.extend(neighbours.iter().cloned());
                    }
                }
            }

            let geometry = geometry.into_iter().collect::<Vec<_>>();
            let constraints = constraints.into_iter().collect::<Vec<_>>();
            let analysis = structural_analysis(sketch, &geometry, &constraints);
            components.push(SolveComponent {
                id: components.len() as u32,
                geometry,
                constraints,
                variable_count: analysis.variables,
                equation_count: analysis.equations,
                structural_rank: analysis.rank,
                structural_degrees_of_freedom: analysis.variables.saturating_sub(analysis.rank),
                structurally_redundant_equations: analysis.equations.saturating_sub(analysis.rank),
            });
        }

        Decomposition { components }
    }
}

#[derive(Clone, Copy)]
struct StructuralAnalysis {
    variables: u32,
    equations: u32,
    rank: u32,
}

/// Deterministic maximum matching over a conservative equation/variable
/// bipartite graph. It is intentionally structural rather than numerical: the
/// EZPZ analysis remains the authority for actual free motion, while this
/// PlaneGCS-style pass identifies independently solvable and potentially
/// redundant subsystems before floating-point work begins.
fn structural_analysis(
    sketch: &Sketch,
    geometry: &[GeometryId],
    constraints: &[ConstraintId],
) -> StructuralAnalysis {
    let mut variable_offsets = BTreeMap::new();
    let mut variables = 0_usize;
    for id in geometry {
        let count = geometry_dof(&sketch.geometry[id].geometry);
        variable_offsets.insert(id.clone(), (variables, count));
        variables += count;
    }

    let mut rows = Vec::<Vec<usize>>::new();
    for id in constraints {
        let constraint = &sketch.constraints[id];
        let neighbours = constraint
            .referenced_geometry()
            .into_iter()
            .flat_map(|geometry_id| {
                let (offset, count) = variable_offsets[geometry_id];
                offset..offset + count
            })
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        for _ in 0..constraint_equations(constraint) {
            rows.push(neighbours.clone());
        }
    }

    let mut variable_match = vec![None; variables];
    let mut rank = 0_usize;
    for row in 0..rows.len() {
        let mut visited = vec![false; variables];
        if augment(row, &rows, &mut variable_match, &mut visited) {
            rank += 1;
        }
    }
    StructuralAnalysis {
        variables: u32::try_from(variables).unwrap_or(u32::MAX),
        equations: u32::try_from(rows.len()).unwrap_or(u32::MAX),
        rank: u32::try_from(rank).unwrap_or(u32::MAX),
    }
}

fn augment(
    row: usize,
    rows: &[Vec<usize>],
    variable_match: &mut [Option<usize>],
    visited: &mut [bool],
) -> bool {
    for &variable in &rows[row] {
        if visited[variable] {
            continue;
        }
        visited[variable] = true;
        let previous = variable_match[variable];
        if previous.is_none()
            || augment(
                previous.expect("matched variable has a row"),
                rows,
                variable_match,
                visited,
            )
        {
            variable_match[variable] = Some(row);
            return true;
        }
    }
    false
}

fn geometry_dof(geometry: &Geometry) -> usize {
    match geometry {
        Geometry::Line(_) | Geometry::Rectangle(_) => 4,
        Geometry::Circle(_) => 3,
        Geometry::Arc(_) => 5,
        Geometry::ControlPointSpline(spline) => spline.control_points.len() * 2,
        Geometry::FitPointSpline(spline) => spline.fit_points.len() * 2,
        Geometry::Ellipse(_) => 6,
        Geometry::EllipticalArc(_) => 8,
        Geometry::Conic(_) => 7,
        Geometry::SketchPoint(_) => 2,
    }
}

fn constraint_equations(constraint: &Constraint) -> usize {
    usize::from(matches!(
        constraint,
        Constraint::Coincident { .. }
            | Constraint::PointOnOrigin { .. }
            | Constraint::Fixed { .. }
            | Constraint::Midpoint { .. }
            | Constraint::Concentric { .. }
            | Constraint::Symmetry { .. }
    )) + 1
}

impl Decomposition {
    /// Convenience entry point for callers that only need the decomposition.
    pub fn from_sketch(sketch: &Sketch) -> Self {
        GraphDecompositionFrontend.decompose(sketch)
    }

    /// Decompose only constraints selected by the solver's canonical active
    /// constraint pass.
    pub fn from_active_constraints(
        sketch: &Sketch,
        active_constraints: &BTreeSet<ConstraintId>,
    ) -> Self {
        GraphDecompositionFrontend.decompose_active(sketch, active_constraints)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Anchor, Constraint, Geometry, GeometryEntity, Line, Point2, PointRef};

    fn line(id: &str, y: i64) -> GeometryEntity {
        GeometryEntity::new(
            id,
            Geometry::Line(Line {
                start: Point2::new(0, y),
                end: Point2::new(10, y),
            }),
        )
    }

    #[test]
    fn disconnected_groups_and_isolated_geometry_are_stable_components() {
        let mut sketch = Sketch::new("sketch:graph");
        for entity in [line("line:b", 10), line("line:a", 0), line("line:c", 20)] {
            sketch.geometry.insert(entity.id.clone(), entity);
        }
        sketch.constraints.insert(
            "constraint:join".into(),
            Constraint::Coincident {
                a: PointRef::new("line:a", Anchor::End),
                b: PointRef::new("line:b", Anchor::Start),
            },
        );

        assert_eq!(
            Decomposition::from_sketch(&sketch),
            Decomposition {
                components: vec![
                    SolveComponent {
                        id: 0,
                        geometry: vec!["line:a".into(), "line:b".into()],
                        constraints: vec!["constraint:join".into()],
                        variable_count: 8,
                        equation_count: 2,
                        structural_rank: 2,
                        structural_degrees_of_freedom: 6,
                        structurally_redundant_equations: 0,
                    },
                    SolveComponent {
                        id: 1,
                        geometry: vec!["line:c".into()],
                        constraints: vec![],
                        variable_count: 4,
                        equation_count: 0,
                        structural_rank: 0,
                        structural_degrees_of_freedom: 4,
                        structurally_redundant_equations: 0,
                    },
                ],
            }
        );
    }
}
