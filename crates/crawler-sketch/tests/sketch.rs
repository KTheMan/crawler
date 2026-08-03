use crawler_sketch::{
    Anchor, Arc, Circle, ConflictReason, Constraint, ConstraintId, DeclarativeSolver, DragRequest,
    Geometry, GeometryEntity, GeometryId, Line, Point2, PointRef, ProfileDiagnostic, Rectangle,
    Sketch, SketchCommand, SketchSolver, SolveState, TrimOperation,
};

fn line(id: &str, start: (i64, i64), end: (i64, i64)) -> GeometryEntity {
    GeometryEntity::new(
        id,
        Geometry::Line(Line {
            start: Point2::new(start.0, start.1),
            end: Point2::new(end.0, end.1),
        }),
    )
}

fn add_geometry(sketch: &Sketch, entity: GeometryEntity) -> Sketch {
    sketch
        .apply(SketchCommand::AddGeometry { entity })
        .unwrap()
        .after
}

fn add_constraint(sketch: &Sketch, id: &str, constraint: Constraint) -> Sketch {
    sketch
        .apply(SketchCommand::AddConstraint {
            id: ConstraintId::from(id),
            constraint,
        })
        .unwrap()
        .after
}

#[test]
fn immutable_commands_are_undo_ready_and_stable_ids_survive_edits() {
    let original = Sketch::new("sketch:edit");
    let added = original
        .apply(SketchCommand::AddGeometry {
            entity: line("line:a", (0, 0), (10, 5)),
        })
        .unwrap();
    assert_eq!(added.before, original);
    assert_eq!(added.undo_snapshot(), &original);
    assert_eq!(added.after.revision, 1);

    let moved = added
        .after
        .apply(SketchCommand::MovePoint {
            point: PointRef::new("line:a", Anchor::End),
            to: Point2::new(20, 5),
        })
        .unwrap();
    assert_eq!(moved.before, added.after);
    assert_eq!(moved.after.geometry.keys().next().unwrap().0, "line:a");
    assert_eq!(moved.redo_snapshot().revision, 2);
    assert_eq!(original.revision, 0);
    assert!(original.geometry.is_empty());
}

#[test]
fn canonical_serde_round_trip_and_map_insertion_order_are_deterministic() {
    let mut first = Sketch::new("sketch:persist");
    first = add_geometry(&first, line("line:b", (10, 0), (10, 10)));
    first = add_geometry(&first, line("line:a", (0, 0), (10, 0)));
    first = add_geometry(
        &first,
        GeometryEntity::new(
            "circle:a",
            Geometry::Circle(Circle {
                center: Point2::new(5, 5),
                radius_nm: 5,
            }),
        ),
    );
    first = add_geometry(
        &first,
        GeometryEntity::new(
            "arc:a",
            Geometry::Arc(Arc {
                center: Point2::new(0, 0),
                start: Point2::new(5, 0),
                end: Point2::new(0, 5),
                clockwise: false,
            }),
        ),
    );
    first = add_geometry(
        &first,
        GeometryEntity::new(
            "rectangle:a",
            Geometry::Rectangle(Rectangle {
                min: Point2::new(-5, -5),
                max: Point2::new(5, 5),
            }),
        )
        .construction(),
    );
    let first = with_every_constraint(first);

    let bytes = first.canonical_bytes().unwrap();
    let reloaded = Sketch::from_canonical_bytes(&bytes).unwrap();
    assert_eq!(reloaded, first);
    assert_eq!(reloaded.canonical_bytes().unwrap(), bytes);
    assert_eq!(
        reloaded.canonical_hash().unwrap(),
        first.canonical_hash().unwrap()
    );
    assert!(
        String::from_utf8(bytes).unwrap().find("arc:a").unwrap()
            < serde_json::to_string(&first)
                .unwrap()
                .find("line:b")
                .unwrap()
    );
}

fn with_every_constraint(mut sketch: Sketch) -> Sketch {
    let a_start = PointRef::new("line:a", Anchor::Start);
    let a_end = PointRef::new("line:a", Anchor::End);
    let b_start = PointRef::new("line:b", Anchor::Start);
    let constraints = [
        (
            "c:coincident",
            Constraint::Coincident {
                a: a_end.clone(),
                b: b_start,
            },
        ),
        (
            "c:horizontal",
            Constraint::Horizontal {
                line: "line:a".into(),
            },
        ),
        (
            "c:vertical",
            Constraint::Vertical {
                line: "line:b".into(),
            },
        ),
        (
            "c:parallel",
            Constraint::Parallel {
                first: "line:a".into(),
                second: "line:b".into(),
            },
        ),
        (
            "c:perpendicular",
            Constraint::Perpendicular {
                first: "line:a".into(),
                second: "line:b".into(),
            },
        ),
        (
            "c:tangent",
            Constraint::Tangent {
                first: "line:a".into(),
                second: "circle:a".into(),
            },
        ),
        (
            "c:equal",
            Constraint::Equal {
                first: "line:a".into(),
                second: "line:b".into(),
            },
        ),
        (
            "c:distance",
            Constraint::Distance {
                a: a_start,
                b: a_end,
                distance_nm: 10,
            },
        ),
        (
            "c:radius",
            Constraint::Radius {
                geometry: "circle:a".into(),
                radius_nm: 5,
            },
        ),
        (
            "c:angle",
            Constraint::Angle {
                first: "line:a".into(),
                second: "line:b".into(),
                angle_microdegrees: 90_000_000,
            },
        ),
    ];
    for (id, constraint) in constraints {
        sketch = add_constraint(&sketch, id, constraint);
    }
    sketch
}

#[test]
fn solver_contract_distinguishes_all_four_states_and_reports_minimal_conflicts() {
    let solver = DeclarativeSolver;
    let base = add_geometry(
        &Sketch::new("sketch:states"),
        line("line:a", (0, 0), (10, 0)),
    );
    assert_eq!(
        solver.solve(&base).unwrap().state,
        SolveState::UnderConstrained
    );

    let full = add_constraint(
        &add_constraint(
            &add_constraint(
                &base,
                "c:coincident",
                Constraint::Coincident {
                    a: PointRef::new("line:a", Anchor::Start),
                    b: PointRef::new("line:a", Anchor::Start),
                },
            ),
            "c:horizontal",
            Constraint::Horizontal {
                line: "line:a".into(),
            },
        ),
        "c:distance",
        Constraint::Distance {
            a: PointRef::new("line:a", Anchor::Start),
            b: PointRef::new("line:a", Anchor::End),
            distance_nm: 10,
        },
    );
    assert_eq!(
        solver.solve(&full).unwrap().state,
        SolveState::FullyConstrained
    );

    let over = add_constraint(
        &full,
        "c:angle",
        Constraint::Angle {
            first: "line:a".into(),
            second: "line:a".into(),
            angle_microdegrees: 0,
        },
    );
    let over_result = solver.solve(&over).unwrap();
    assert_eq!(over_result.state, SolveState::OverConstrained);
    assert!(matches!(
        over_result.conflicts[0].reason,
        ConflictReason::ExcessIndependentConstraints
    ));

    let conflict = add_constraint(
        &add_constraint(
            &base,
            "c:h",
            Constraint::Horizontal {
                line: "line:a".into(),
            },
        ),
        "c:v",
        Constraint::Vertical {
            line: "line:a".into(),
        },
    );
    let conflict_result = solver.solve(&conflict).unwrap();
    assert_eq!(conflict_result.state, SolveState::Conflicting);
    assert_eq!(
        conflict_result.conflicts[0].constraints,
        vec![ConstraintId::from("c:h"), ConstraintId::from("c:v")]
    );
}

#[test]
fn constrained_drag_projects_axis_and_dimension_constraints_without_changing_dimensions() {
    let solver = DeclarativeSolver;
    let base = add_geometry(&Sketch::new("sketch:drag"), line("line:a", (0, 0), (10, 0)));
    let horizontal = add_constraint(
        &base,
        "c:h",
        Constraint::Horizontal {
            line: "line:a".into(),
        },
    );
    let drag = solver
        .constrained_drag(
            &horizontal,
            DragRequest {
                point: PointRef::new("line:a", Anchor::End),
                target: Point2::new(20, 7),
            },
        )
        .unwrap();
    assert!(drag.accepted);
    assert_eq!(drag.resolved, Point2::new(20, 0));
    assert_eq!(drag.sketch.revision, horizontal.revision + 1);

    let dimensioned = add_constraint(
        &horizontal,
        "c:d",
        Constraint::Distance {
            a: PointRef::new("line:a", Anchor::Start),
            b: PointRef::new("line:a", Anchor::End),
            distance_nm: 10,
        },
    );
    let dimensioned_drag = solver
        .constrained_drag(
            &dimensioned,
            DragRequest {
                point: PointRef::new("line:a", Anchor::End),
                target: Point2::new(20, 0),
            },
        )
        .unwrap();
    assert!(dimensioned_drag.accepted);
    assert_eq!(dimensioned_drag.resolved, Point2::new(20, 0));
    let Geometry::Line(line) =
        &dimensioned_drag.sketch.geometry[&GeometryId::from("line:a")].geometry
    else {
        panic!("expected line")
    };
    assert_eq!(line.start, Point2::new(10, 0));
    assert_eq!(line.end, Point2::new(20, 0));
}

#[test]
fn trim_is_deterministic_and_reports_constraints_removed_with_source() {
    let base = add_geometry(
        &Sketch::new("sketch:trim"),
        line("line:source", (0, 0), (10, 0)),
    );
    let constrained = add_constraint(
        &base,
        "c:h",
        Constraint::Horizontal {
            line: "line:source".into(),
        },
    );
    let application = constrained
        .apply(SketchCommand::Trim {
            operation: TrimOperation::SplitLine {
                source: GeometryId::from("line:source"),
                first: GeometryId::from("line:left"),
                second: GeometryId::from("line:right"),
                at: Point2::new(4, 0),
            },
        })
        .unwrap();
    assert!(
        !application
            .after
            .geometry
            .contains_key(&GeometryId::from("line:source"))
    );
    assert!(
        application
            .after
            .geometry
            .contains_key(&GeometryId::from("line:left"))
    );
    assert!(application.after.constraints.is_empty());
    assert_eq!(application.diagnostics.len(), 1);
    assert_eq!(application.undo_snapshot(), &constrained);
}

#[test]
fn profile_diagnostics_distinguish_closed_open_branch_and_construction_geometry() {
    let mut sketch = Sketch::new("sketch:profiles");
    for entity in [
        line("edge:1", (0, 0), (10, 0)),
        line("edge:2", (10, 0), (10, 10)),
        line("edge:3", (10, 10), (0, 10)),
        line("edge:4", (0, 10), (0, 0)),
        line("edge:open", (20, 0), (30, 0)),
        line("construction", (10, 0), (20, 0)).construction(),
    ] {
        sketch = add_geometry(&sketch, entity);
    }
    let report = sketch.profile_report();
    assert!(report.closed_profiles.contains(&vec![
        "edge:1".into(),
        "edge:2".into(),
        "edge:3".into(),
        "edge:4".into(),
    ]));
    assert_eq!(
        report
            .diagnostics
            .iter()
            .filter(|diagnostic| matches!(diagnostic, ProfileDiagnostic::OpenEndpoint { .. }))
            .count(),
        2
    );
    assert!(
        report
            .diagnostics
            .iter()
            .all(|diagnostic| !format!("{diagnostic:?}").contains("construction"))
    );
}

#[test]
fn circle_trim_opens_profile_into_a_stable_arc() {
    let sketch = add_geometry(
        &Sketch::new("sketch:circle-trim"),
        GeometryEntity::new(
            "circle:source",
            Geometry::Circle(Circle {
                center: Point2::new(0, 0),
                radius_nm: 5,
            }),
        ),
    );
    assert_eq!(sketch.profile_report().closed_profiles.len(), 1);
    let trimmed = sketch
        .apply(SketchCommand::Trim {
            operation: TrimOperation::OpenCircle {
                source: "circle:source".into(),
                replacement: "arc:trimmed".into(),
                start: Point2::new(5, 0),
                end: Point2::new(0, 5),
                clockwise: false,
            },
        })
        .unwrap()
        .after;
    assert!(matches!(
        trimmed.geometry[&GeometryId::from("arc:trimmed")].geometry,
        Geometry::Arc(_)
    ));
    assert!(trimmed.profile_report().closed_profiles.is_empty());
    assert_eq!(trimmed.profile_report().diagnostics.len(), 2);
}

#[test]
fn geometric_solver_enforces_coincident_axis_distance_and_line_relations() {
    let solver = DeclarativeSolver;
    let mut sketch = Sketch::new("sketch:line-solve");
    for entity in [
        line("line:datum", (0, 0), (100, 0)),
        line("line:joined", (120, 30), (150, 45)),
        line("line:parallel", (0, 10), (0, 60)),
        line("line:perpendicular", (0, 20), (50, 30)),
        line("line:angle", (0, 30), (20, 80)),
        line("line:vertical", (200, 0), (210, 75)),
    ] {
        sketch = add_geometry(&sketch, entity);
    }
    for (id, constraint) in [
        (
            "a:coincident",
            Constraint::Coincident {
                a: PointRef::new("line:datum", Anchor::End),
                b: PointRef::new("line:joined", Anchor::Start),
            },
        ),
        (
            "b:horizontal",
            Constraint::Horizontal {
                line: "line:joined".into(),
            },
        ),
        (
            "c:distance",
            Constraint::Distance {
                a: PointRef::new("line:joined", Anchor::Start),
                b: PointRef::new("line:joined", Anchor::End),
                distance_nm: 25,
            },
        ),
        (
            "d:parallel",
            Constraint::Parallel {
                first: "line:datum".into(),
                second: "line:parallel".into(),
            },
        ),
        (
            "e:perpendicular",
            Constraint::Perpendicular {
                first: "line:datum".into(),
                second: "line:perpendicular".into(),
            },
        ),
        (
            "f:angle",
            Constraint::Angle {
                first: "line:datum".into(),
                second: "line:angle".into(),
                angle_microdegrees: 45_000_000,
            },
        ),
        (
            "g:vertical",
            Constraint::Vertical {
                line: "line:vertical".into(),
            },
        ),
    ] {
        sketch = add_constraint(&sketch, id, constraint);
    }

    let solved = solver.solve_sketch(&sketch).unwrap();
    assert_ne!(solved.solve.state, SolveState::Conflicting);
    let geometry = |id: &str| {
        let Geometry::Line(line) = &solved.sketch.geometry[&GeometryId::from(id)].geometry else {
            panic!("expected line")
        };
        line.clone()
    };
    let datum = geometry("line:datum");
    let joined = geometry("line:joined");
    let parallel = geometry("line:parallel");
    let perpendicular = geometry("line:perpendicular");
    let angle = geometry("line:angle");
    let vertical = geometry("line:vertical");
    assert_eq!(joined.start, datum.end);
    assert_eq!(joined.end, Point2::new(125, 0));
    assert_eq!(parallel.start.y_nm, parallel.end.y_nm);
    assert_eq!(perpendicular.start.x_nm, perpendicular.end.x_nm);
    assert_eq!(
        angle.end.x_nm - angle.start.x_nm,
        angle.end.y_nm - angle.start.y_nm
    );
    assert_eq!(vertical.start.x_nm, vertical.end.x_nm);
    assert_eq!(solver.solve(&solved.sketch).unwrap().conflicts, vec![]);
}

#[test]
fn geometric_solver_enforces_radius_equal_and_tangent_for_round_geometry() {
    let solver = DeclarativeSolver;
    let mut sketch = Sketch::new("sketch:round-solve");
    sketch = add_geometry(&sketch, line("line:datum", (0, 0), (100, 0)));
    sketch = add_geometry(
        &sketch,
        GeometryEntity::new(
            "circle:a",
            Geometry::Circle(Circle {
                center: Point2::new(25, 50),
                radius_nm: 7,
            }),
        ),
    );
    sketch = add_geometry(
        &sketch,
        GeometryEntity::new(
            "circle:b",
            Geometry::Circle(Circle {
                center: Point2::new(90, 80),
                radius_nm: 4,
            }),
        ),
    );
    sketch = add_geometry(
        &sketch,
        GeometryEntity::new(
            "arc:a",
            Geometry::Arc(Arc {
                center: Point2::new(200, 0),
                start: Point2::new(205, 0),
                end: Point2::new(200, 5),
                clockwise: false,
            }),
        ),
    );
    for (id, constraint) in [
        (
            "a:radius",
            Constraint::Radius {
                geometry: "circle:a".into(),
                radius_nm: 10,
            },
        ),
        (
            "b:line-tangent",
            Constraint::Tangent {
                first: "line:datum".into(),
                second: "circle:a".into(),
            },
        ),
        (
            "c:equal",
            Constraint::Equal {
                first: "circle:a".into(),
                second: "arc:a".into(),
            },
        ),
        (
            "d:round-tangent",
            Constraint::Tangent {
                first: "circle:a".into(),
                second: "circle:b".into(),
            },
        ),
    ] {
        sketch = add_constraint(&sketch, id, constraint);
    }

    let solved = solver.solve_sketch(&sketch).unwrap();
    assert_ne!(solved.solve.state, SolveState::Conflicting);
    let Geometry::Circle(circle_a) =
        &solved.sketch.geometry[&GeometryId::from("circle:a")].geometry
    else {
        panic!("expected circle")
    };
    let Geometry::Circle(circle_b) =
        &solved.sketch.geometry[&GeometryId::from("circle:b")].geometry
    else {
        panic!("expected circle")
    };
    let Geometry::Arc(arc) = &solved.sketch.geometry[&GeometryId::from("arc:a")].geometry else {
        panic!("expected arc")
    };
    assert_eq!(circle_a.radius_nm, 10);
    assert_eq!(circle_a.center.y_nm, 10);
    assert_eq!(arc.start, Point2::new(210, 0));
    assert_eq!(arc.end, Point2::new(200, 10));
    let dx = circle_b.center.x_nm - circle_a.center.x_nm;
    let dy = circle_b.center.y_nm - circle_a.center.y_nm;
    let center_distance = ((dx * dx + dy * dy) as f64).sqrt();
    assert!((center_distance - 14.0).abs() <= 1.0);
    assert!(solver.solve(&solved.sketch).unwrap().conflicts.is_empty());
}

#[test]
fn solved_geometry_is_stable_across_recompute_and_canonical_reload() {
    let solver = DeclarativeSolver;
    let mut sketch = Sketch::new("sketch:reload-determinism");
    sketch = add_geometry(&sketch, line("line:a", (7, 4), (89, 31)));
    sketch = add_constraint(
        &sketch,
        "c:horizontal",
        Constraint::Horizontal {
            line: "line:a".into(),
        },
    );
    sketch = add_constraint(
        &sketch,
        "c:length",
        Constraint::Distance {
            a: PointRef::new("line:a", Anchor::Start),
            b: PointRef::new("line:a", Anchor::End),
            distance_nm: 125,
        },
    );

    let first = solver.solve_sketch(&sketch).unwrap().sketch;
    let second = solver.solve_sketch(&first).unwrap().sketch;
    let reloaded = Sketch::from_canonical_bytes(&first.canonical_bytes().unwrap()).unwrap();
    let after_reload = solver.solve_sketch(&reloaded).unwrap().sketch;
    assert_eq!(first, second);
    assert_eq!(first, after_reload);
    assert_eq!(
        first.canonical_hash().unwrap(),
        after_reload.canonical_hash().unwrap()
    );
}

#[test]
fn contradictory_solve_and_drag_are_atomic_and_report_minimal_constraint_ids() {
    let solver = DeclarativeSolver;
    let mut sketch = add_geometry(
        &Sketch::new("sketch:atomic-conflict"),
        line("line:a", (0, 0), (10, 0)),
    );
    for (id, distance_nm) in [("c:ten", 10), ("c:twenty", 20)] {
        sketch = add_constraint(
            &sketch,
            id,
            Constraint::Distance {
                a: PointRef::new("line:a", Anchor::Start),
                b: PointRef::new("line:a", Anchor::End),
                distance_nm,
            },
        );
    }
    let before_hash = sketch.canonical_hash().unwrap();
    let solved = solver.solve_sketch(&sketch).unwrap();
    assert_eq!(solved.sketch, sketch);
    assert_eq!(solved.solve.state, SolveState::Conflicting);
    assert_eq!(
        solved.solve.conflicts[0].constraints,
        vec![ConstraintId::from("c:ten"), ConstraintId::from("c:twenty")]
    );

    let drag = solver
        .constrained_drag(
            &sketch,
            DragRequest {
                point: PointRef::new("line:a", Anchor::End),
                target: Point2::new(30, 20),
            },
        )
        .unwrap();
    assert!(!drag.accepted);
    assert_eq!(drag.sketch, sketch);
    assert_eq!(drag.sketch.canonical_hash().unwrap(), before_hash);
    assert!(matches!(
        drag.solve.conflicts.last().unwrap().reason,
        ConflictReason::DragBlocked
    ));
}

#[test]
fn constrained_drag_preserves_parallelism_and_exact_distance() {
    let solver = DeclarativeSolver;
    let mut sketch = Sketch::new("sketch:multi-drag");
    sketch = add_geometry(&sketch, line("line:datum", (0, 0), (100, 0)));
    sketch = add_geometry(&sketch, line("line:moving", (0, 10), (10, 10)));
    sketch = add_constraint(
        &sketch,
        "a:distance",
        Constraint::Distance {
            a: PointRef::new("line:moving", Anchor::Start),
            b: PointRef::new("line:moving", Anchor::End),
            distance_nm: 10,
        },
    );
    sketch = add_constraint(
        &sketch,
        "b:parallel",
        Constraint::Parallel {
            first: "line:datum".into(),
            second: "line:moving".into(),
        },
    );

    let drag = solver
        .constrained_drag(
            &sketch,
            DragRequest {
                point: PointRef::new("line:moving", Anchor::End),
                target: Point2::new(40, 50),
            },
        )
        .unwrap();
    assert!(drag.accepted);
    let Geometry::Line(line) = &drag.sketch.geometry[&GeometryId::from("line:moving")].geometry
    else {
        panic!("expected line")
    };
    assert_eq!(line.end, Point2::new(40, 50));
    assert_eq!(line.start, Point2::new(30, 50));
    assert!(drag.solve.conflicts.is_empty());
}

#[test]
fn arc_projection_keeps_the_exact_model_invariant_on_the_integer_grid() {
    let solver = DeclarativeSolver;
    let mut sketch = add_geometry(
        &Sketch::new("sketch:arc-grid"),
        GeometryEntity::new(
            "arc:a",
            Geometry::Arc(Arc {
                center: Point2::new(10, 20),
                start: Point2::new(13, 24),
                end: Point2::new(6, 23),
                clockwise: false,
            }),
        ),
    );
    sketch = add_constraint(
        &sketch,
        "c:radius",
        Constraint::Radius {
            geometry: "arc:a".into(),
            radius_nm: 10,
        },
    );
    let solved = solver.solve_sketch(&sketch).unwrap();
    solved.sketch.validate().unwrap();
    let Geometry::Arc(arc) = &solved.sketch.geometry[&GeometryId::from("arc:a")].geometry else {
        panic!("expected arc")
    };
    let start_squared =
        (arc.start.x_nm - arc.center.x_nm).pow(2) + (arc.start.y_nm - arc.center.y_nm).pow(2);
    let end_squared =
        (arc.end.x_nm - arc.center.x_nm).pow(2) + (arc.end.y_nm - arc.center.y_nm).pow(2);
    assert_eq!(start_squared, end_squared);
    assert!(((start_squared as f64).sqrt() - 10.0).abs() <= 1.0);
}

#[test]
fn reversed_symmetric_constraints_are_deterministically_redundant() {
    let solver = DeclarativeSolver;
    let mut sketch = Sketch::new("sketch:semantic-redundancy");
    sketch = add_geometry(&sketch, line("line:a", (0, 0), (10, 0)));
    sketch = add_geometry(&sketch, line("line:b", (0, 10), (10, 10)));
    sketch = add_constraint(
        &sketch,
        "c:first",
        Constraint::Parallel {
            first: "line:a".into(),
            second: "line:b".into(),
        },
    );
    sketch = add_constraint(
        &sketch,
        "c:reversed",
        Constraint::Parallel {
            first: "line:b".into(),
            second: "line:a".into(),
        },
    );
    let result = solver.solve(&sketch).unwrap();
    assert_eq!(
        result.active_constraints,
        vec![ConstraintId::from("c:first")]
    );
    assert_eq!(
        result.redundant_constraints,
        vec![ConstraintId::from("c:reversed")]
    );
}

#[test]
fn residual_conflict_reduction_removes_unrelated_constraints() {
    let solver = DeclarativeSolver;
    let mut sketch = Sketch::new("sketch:residual-core");
    sketch = add_geometry(&sketch, line("line:a", (0, 0), (10, 0)));
    sketch = add_geometry(&sketch, line("line:b", (0, 10), (0, 20)));
    for (id, constraint) in [
        (
            "c:parallel",
            Constraint::Parallel {
                first: "line:a".into(),
                second: "line:b".into(),
            },
        ),
        (
            "c:angle",
            Constraint::Angle {
                first: "line:a".into(),
                second: "line:b".into(),
                angle_microdegrees: 90_000_000,
            },
        ),
        (
            "c:unrelated-length",
            Constraint::Distance {
                a: PointRef::new("line:a", Anchor::Start),
                b: PointRef::new("line:a", Anchor::End),
                distance_nm: 10,
            },
        ),
    ] {
        sketch = add_constraint(&sketch, id, constraint);
    }
    let solved = solver.solve_sketch(&sketch).unwrap();
    assert_eq!(solved.solve.state, SolveState::Conflicting);
    assert_eq!(
        solved.solve.conflicts,
        vec![crawler_sketch::ConflictSet {
            constraints: vec![
                ConstraintId::from("c:angle"),
                ConstraintId::from("c:parallel"),
            ],
            reason: ConflictReason::GeometricResidual,
        }]
    );
    assert_eq!(solved.sketch, sketch);
}
