use crawler_sketch::{
    Anchor, Arc, Axis2d, Circle, ConflictReason, Conic, Constraint, ConstraintId,
    ControlPointSpline, Decomposition, DragRequest, Ellipse, EllipticalArc, EzpzSolver,
    FitPointSpline, Geometry, GeometryEntity, GeometryId, Line, OFFSET_MODEL_TOLERANCE_NM,
    OffsetCurveError, OffsetResultSpan, Point2, PointRef, ProfileDiagnostic, Rectangle, Sketch,
    SketchCommand, SketchOperation, SketchRecipe, SketchSolver, SolveState, TrimOperation,
    curve_bounds, evaluate_curve, evaluate_frame, intersect_curves, offset_curve_with_intervals,
    offset_curve_with_tolerance, offset_generation_call_count, project_point,
    reset_offset_generation_call_count, split_curve,
};
use std::collections::BTreeSet;

#[test]
fn atomic_batch_matches_sequential_command_semantics() {
    let commands = vec![
        SketchCommand::AddGeometry {
            entity: line("line:a", (0, 0), (10, 0)),
        },
        SketchCommand::AddGeometry {
            entity: line("line:b", (10, 0), (10, 10)),
        },
        SketchCommand::AddConstraint {
            id: "constraint:horizontal".into(),
            constraint: Constraint::Horizontal {
                line: "line:a".into(),
            },
        },
        SketchCommand::AddConstraint {
            id: "constraint:coincident".into(),
            constraint: Constraint::Coincident {
                a: PointRef::new("line:a", Anchor::End),
                b: PointRef::new("line:b", Anchor::Start),
            },
        },
    ];
    let base = Sketch::new("sketch:batch-equivalence");
    let mut sequential = base.clone();
    for command in commands.clone() {
        sequential = sequential.apply(command).unwrap().after;
    }

    let batch = base.apply_batch(commands).unwrap();
    assert_eq!(batch, sequential);
    assert_eq!(batch.revision, 4);
}

#[test]
fn atomic_batch_refuses_invalid_final_state_without_changing_the_source() {
    let base = Sketch::new("sketch:batch-atomicity");
    let result = base.apply_batch(vec![SketchCommand::AddConstraint {
        id: "constraint:missing".into(),
        constraint: Constraint::Horizontal {
            line: "line:missing".into(),
        },
    }]);

    assert!(result.is_err());
    assert_eq!(base, Sketch::new("sketch:batch-atomicity"));
}

#[test]
fn axis_relative_angles_solve_at_thirty_and_ninety_degrees_and_roundtrip() {
    for (degrees, seed) in [
        (30_i64, (9_000_000, 1_000_000)),
        (90, (8_000_000, 3_000_000)),
    ] {
        let mut sketch = Sketch::new(format!("sketch:axis-angle:{degrees}"));
        sketch = add_geometry(&sketch, line("line", (0, 0), seed));
        sketch = add_constraint(
            &sketch,
            "axis-angle",
            Constraint::AngleToAxis {
                line: "line".into(),
                axis: Axis2d::X,
                angle_microdegrees: degrees * 1_000_000,
            },
        );
        let bytes = sketch.canonical_bytes().unwrap();
        let json = std::str::from_utf8(&bytes).unwrap();
        assert!(json.contains("\"kind\":\"angle_to_axis\""));
        assert!(json.contains("\"axis\":\"x\""));
        assert_eq!(Sketch::from_canonical_bytes(&bytes).unwrap(), sketch);

        let solved = EzpzSolver.solve_sketch(&sketch).unwrap();
        assert_ne!(solved.solve.state, SolveState::Conflicting);
        let Geometry::Line(line) = &solved.sketch.geometry[&GeometryId::from("line")].geometry
        else {
            panic!("line geometry was replaced")
        };
        let actual = ((line.end.y_nm - line.start.y_nm) as f64)
            .atan2((line.end.x_nm - line.start.x_nm) as f64)
            .to_degrees();
        assert!(
            (actual - degrees as f64).abs() <= 0.001,
            "expected {degrees}°, got {actual}°"
        );
    }
}

#[test]
fn native_curve_service_supports_frames_projection_bounds_and_intersections() {
    let ellipse = Geometry::Ellipse(Ellipse {
        center: Point2::new(0, 0),
        major: Point2::new(20, 0),
        minor: Point2::new(0, 10),
    });
    let frame = evaluate_frame(&ellipse, 0.0);
    assert!(frame.tangent[1].abs() > 0.9);
    assert!(frame.curvature_per_nm.is_finite());
    let bounds = curve_bounds(&ellipse);
    assert!(bounds.min.x_nm <= -20 && bounds.min.y_nm <= -10);
    assert!(bounds.max.x_nm >= 20 && bounds.max.y_nm >= 10);
    assert!(bounds.min.x_nm >= -22 && bounds.min.y_nm >= -12);
    assert!(bounds.max.x_nm <= 22 && bounds.max.y_nm <= 12);
    let projection = project_point(&ellipse, Point2::new(23, 1));
    assert!(projection.distance_nm < 4.0);
    assert!(projection.error_bound_nm <= 5.0);
    let mut skew = Sketch::new("sketch:skew-ellipse");
    skew.geometry.insert(
        GeometryId::from("ellipse"),
        GeometryEntity::new(
            "ellipse",
            Geometry::Ellipse(Ellipse {
                center: Point2::new(0, 0),
                major: Point2::new(20, 0),
                minor: Point2::new(5, 10),
            }),
        ),
    );
    assert!(skew.validate().is_err());
    let mut reversed = Sketch::new("sketch:reversed-ellipse");
    reversed.geometry.insert(
        "ellipse".into(),
        GeometryEntity::new(
            "ellipse",
            Geometry::Ellipse(Ellipse {
                center: Point2::new(0, 0),
                major: Point2::new(10, 0),
                minor: Point2::new(0, 20),
            }),
        ),
    );
    assert!(reversed.validate().is_err());

    let conic = Geometry::Conic(Conic {
        start: Point2::new(-10, 0),
        control: Point2::new(0, 20),
        end: Point2::new(10, 0),
        weight_millionths: 1_000_000,
    });
    let line = Geometry::Line(Line {
        start: Point2::new(-20, 10),
        end: Point2::new(20, 10),
    });
    let hits = intersect_curves(&conic, &line, 128);
    assert!(!hits.is_empty());
    let tangent_hits = intersect_curves(
        &Geometry::Circle(Circle {
            center: Point2::new(0, 0),
            radius_nm: 1_000_000,
        }),
        &Geometry::Line(Line {
            start: Point2::new(-2_000_000, 1_000_000),
            end: Point2::new(2_000_000, 1_000_000),
        }),
        128,
    );
    assert_eq!(tangent_hits.len(), 1);
    assert!(tangent_hits[0].point.x_nm.abs() <= 2);
    assert!((tangent_hits[0].point.y_nm - 1_000_000).abs() <= 2);
    assert_eq!(evaluate_curve(&conic, 0.0), Point2::new(-10, 0));
    assert_eq!(evaluate_curve(&conic, 1.0), Point2::new(10, 0));
    let conic_parts = split_curve(&conic, &[0.5]);
    assert!(
        conic_parts
            .iter()
            .all(|part| matches!(part, Geometry::Conic(_)))
    );
    assert_eq!(
        evaluate_curve(&conic_parts[0], 1.0),
        evaluate_curve(&conic, 0.5)
    );
    let control = Geometry::ControlPointSpline(ControlPointSpline {
        degree: 3,
        knots_millionths: vec![],
        control_points: vec![
            Point2::new(0, 0),
            Point2::new(10, 20),
            Point2::new(20, -10),
            Point2::new(30, 0),
        ],
    });
    assert!(
        split_curve(&control, &[0.4])
            .iter()
            .all(|part| matches!(part, Geometry::ControlPointSpline(_)))
    );
    assert!(
        hits.windows(2)
            .all(|pair| pair[0].first_parameter <= pair[1].first_parameter)
    );
}

#[test]
fn adaptive_curve_services_bound_narrow_knots_and_split_fit_splines_exactly() {
    let collinear_loop = Geometry::ControlPointSpline(ControlPointSpline {
        degree: 3,
        control_points: vec![
            Point2::new(0, 0),
            Point2::new(200, 0),
            Point2::new(-200, 0),
            Point2::new(10, 0),
        ],
        knots_millionths: vec![0, 0, 0, 0, 1_000_000, 1_000_000, 1_000_000, 1_000_000],
    });
    let loop_bounds = curve_bounds(&collinear_loop);
    assert!(loop_bounds.min.x_nm < -20 && loop_bounds.max.x_nm > 20);
    let loop_projection = project_point(&collinear_loop, Point2::new(60, 2));
    assert!(loop_projection.distance_nm <= 5.0 && loop_projection.error_bound_nm <= 5.0);
    let multimodal = Geometry::ControlPointSpline(ControlPointSpline {
        degree: 4,
        control_points: [0, 976_185, 657_855, 190_446, 1_000_000]
            .into_iter()
            .map(|x| Point2::new(x, 0))
            .collect(),
        knots_millionths: vec![
            0, 0, 0, 0, 0, 1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000,
        ],
    });
    let multimodal_projection = project_point(&multimodal, Point2::new(135_400, 0));
    assert!(
        multimodal_projection.distance_nm <= 2.0,
        "projection was {multimodal_projection:?}"
    );
    assert!(multimodal_projection.error_bound_nm <= 5.0);

    let narrow = Geometry::ControlPointSpline(ControlPointSpline {
        degree: 1,
        control_points: vec![
            Point2::new(-1_000_000, 0),
            Point2::new(-1, 20_000_000),
            Point2::new(1, -20_000_000),
            Point2::new(1_000_000, 0),
        ],
        knots_millionths: vec![0, 0, 499_999, 500_001, 1_000_000, 1_000_000],
    });
    let bounds = curve_bounds(&narrow);
    assert!(bounds.max.y_nm >= 19_999_998);
    assert!(bounds.min.y_nm <= -19_999_998);
    let axis = Geometry::Line(Line {
        start: Point2::new(0, -25_000_000),
        end: Point2::new(0, 25_000_000),
    });
    assert!(!intersect_curves(&narrow, &axis, 128).is_empty());

    let fit = Geometry::FitPointSpline(FitPointSpline {
        fit_points: vec![
            Point2::new(0, 0),
            Point2::new(9_000_000, 12_000_000),
            Point2::new(18_000_000, -7_000_000),
            Point2::new(30_000_000, 0),
        ],
    });
    let cuts = [0.0, 1.0 / 3.0, 0.5, 2.0 / 3.0, 1.0];
    let parts = split_curve(&fit, &[0.5]);
    assert_eq!(parts.len(), cuts.len() - 1);
    assert!(
        parts
            .iter()
            .all(|part| matches!(part, Geometry::ControlPointSpline(_)))
    );
    for (part, interval) in parts.iter().zip(cuts.windows(2)) {
        for sample in 0..=16 {
            let u = sample as f64 / 16.0;
            let expected = evaluate_curve(&fit, interval[0] + (interval[1] - interval[0]) * u);
            let actual = evaluate_curve(part, u);
            assert!((actual.x_nm - expected.x_nm).abs() <= 2);
            assert!((actual.y_nm - expected.y_nm).abs() <= 2);
        }
    }
}

#[test]
fn polygon_recipe_side_count_edits_retain_unaffected_members_and_rebuild_intent() {
    let mut sketch = Sketch::new("sketch:polygon-topology");
    for entity in [
        line("edge:0", (10, 0), (-5, 9)),
        line("edge:1", (-5, 9), (-5, -9)),
        line("edge:2", (-5, -9), (10, 0)),
    ] {
        sketch = add_geometry(&sketch, entity);
    }
    sketch = sketch
        .apply(SketchCommand::AddRecipe {
            id: "polygon".into(),
            recipe: SketchRecipe::Polygon {
                mode: "inscribed".into(),
                center: Point2::new(0, 0),
                radius_nm: 10,
                sides: 3,
                orientation_microdegrees: 0,
                geometry: vec!["edge:0".into(), "edge:1".into(), "edge:2".into()],
            },
        })
        .unwrap()
        .after;
    let five = vec![
        "edge:0".into(),
        "edge:1".into(),
        "edge:2".into(),
        "edge:3".into(),
        "edge:4".into(),
    ];
    sketch = sketch
        .apply(SketchCommand::SetRecipe {
            id: "polygon".into(),
            recipe: SketchRecipe::Polygon {
                mode: "inscribed".into(),
                center: Point2::new(5, 7),
                radius_nm: 20,
                sides: 5,
                orientation_microdegrees: 18_000_000,
                geometry: five.clone(),
            },
        })
        .unwrap()
        .after;
    assert_eq!(sketch.recipes["polygon"].geometry(), five);
    assert!(
        sketch.geometry.contains_key(&GeometryId::from("edge:3"))
            && sketch.geometry.contains_key(&GeometryId::from("edge:4"))
    );
    assert!(
        sketch
            .constraints
            .contains_key(&ConstraintId::from("recipe:polygon:equal:4"))
    );
    assert!(
        sketch
            .suppressed_constraints
            .contains(&ConstraintId::from("recipe:polygon:angle:4"))
    );

    let four = vec![
        "edge:0".into(),
        "edge:1".into(),
        "edge:2".into(),
        "edge:3".into(),
    ];
    sketch = sketch
        .apply(SketchCommand::SetRecipe {
            id: "polygon".into(),
            recipe: SketchRecipe::Polygon {
                mode: "inscribed".into(),
                center: Point2::new(5, 7),
                radius_nm: 20,
                sides: 4,
                orientation_microdegrees: 0,
                geometry: four.clone(),
            },
        })
        .unwrap()
        .after;
    assert_eq!(sketch.recipes["polygon"].geometry(), four);
    assert!(!sketch.geometry.contains_key(&GeometryId::from("edge:4")));
    assert!(
        !sketch
            .constraints
            .contains_key(&ConstraintId::from("recipe:polygon:equal:4"))
    );
}

#[test]
fn retained_offset_mirror_and_patterns_recompute_edit_and_unlink_durably() {
    let mut offset = Sketch::new("sketch:p1-offset");
    offset = add_geometry(&offset, line("source", (0, 0), (100, 0)));
    offset = add_geometry(&offset, line("result", (0, 10), (100, 10)));
    offset = offset
        .apply(SketchCommand::AddOperation {
            id: "offset".into(),
            operation: SketchOperation::Offset {
                sources: vec!["source".into()],
                result_chains: vec![vec!["result".into()]],
                distance_nm: 10,
                two_sided: false,
                linked: true,
                model_tolerance_nm: OFFSET_MODEL_TOLERANCE_NM,
                result_spans: None,
            },
        })
        .unwrap()
        .after;
    offset = offset
        .apply(SketchCommand::MovePoint {
            point: PointRef::new("source", Anchor::Start),
            to: Point2::new(10, 5),
        })
        .unwrap()
        .after;
    offset = offset
        .apply(SketchCommand::MovePoint {
            point: PointRef::new("source", Anchor::End),
            to: Point2::new(110, 5),
        })
        .unwrap()
        .after;
    assert!(
        matches!(&offset.geometry[&"result".into()].geometry, Geometry::Line(value) if value.start == Point2::new(10, 15) && value.end == Point2::new(110, 15))
    );
    offset = offset
        .apply(SketchCommand::SetOperation {
            id: "offset".into(),
            operation: SketchOperation::Offset {
                sources: vec!["source".into()],
                result_chains: vec![vec!["result".into()], vec!["result:other".into()]],
                distance_nm: 20,
                two_sided: true,
                linked: true,
                model_tolerance_nm: OFFSET_MODEL_TOLERANCE_NM,
                result_spans: None,
            },
        })
        .unwrap()
        .after;
    assert!(
        matches!(&offset.geometry[&"result".into()].geometry, Geometry::Line(value) if value.start.y_nm == 25)
    );
    assert!(
        matches!(&offset.geometry[&"result:other".into()].geometry, Geometry::Line(value) if value.start.y_nm == -15)
    );
    let bytes = offset.canonical_bytes().unwrap();
    assert_eq!(Sketch::from_canonical_bytes(&bytes).unwrap(), offset);
    let before_unlinked = offset.geometry[&GeometryId::from("result")]
        .geometry
        .clone();
    offset = offset
        .apply(SketchCommand::RemoveOperation {
            id: "offset".into(),
        })
        .unwrap()
        .after;
    offset = offset
        .apply(SketchCommand::MovePoint {
            point: PointRef::new("source", Anchor::Start),
            to: Point2::new(40, 5),
        })
        .unwrap()
        .after;
    assert_eq!(
        offset.geometry[&GeometryId::from("result")].geometry,
        before_unlinked
    );

    let mut mirror = Sketch::new("sketch:p1-mirror");
    mirror = add_geometry(&mirror, line("axis", (0, -100), (0, 100)));
    mirror = add_geometry(&mirror, line("source", (10, 20), (30, 20)));
    mirror = add_geometry(&mirror, line("result", (-10, 20), (-30, 20)));
    mirror = mirror
        .apply(SketchCommand::AddOperation {
            id: "mirror".into(),
            operation: SketchOperation::Mirror {
                sources: vec!["source".into()],
                axis: Some("axis".into()),
                results: vec!["result".into()],
                linked: true,
            },
        })
        .unwrap()
        .after;
    assert!(
        matches!(&mirror.geometry[&"result".into()].geometry, Geometry::Line(value) if value.start == Point2::new(-10, 20) && value.end == Point2::new(-30, 20))
    );
    assert!(
        mirror
            .constraints
            .keys()
            .any(|id| id.0.starts_with("operation:mirror:symmetry"))
    );

    let mut pattern = Sketch::new("sketch:p1-pattern");
    pattern = add_geometry(&pattern, line("source", (0, 0), (10, 0)));
    pattern = add_geometry(&pattern, line("instance:1", (20, 0), (30, 0)));
    pattern = pattern
        .apply(SketchCommand::AddOperation {
            id: "linear".into(),
            operation: SketchOperation::LinearPattern {
                sources: vec!["source".into()],
                instances: vec![vec!["instance:1".into()]],
                count: 2,
                spacing: Point2::new(20, 0),
                extent: false,
                suppressed_instances: BTreeSet::new(),
            },
        })
        .unwrap()
        .after;
    pattern = pattern
        .apply(SketchCommand::SetOperation {
            id: "linear".into(),
            operation: SketchOperation::LinearPattern {
                sources: vec!["source".into()],
                instances: vec![
                    vec!["instance:1".into()],
                    vec!["instance:2".into()],
                    vec!["instance:3".into()],
                ],
                count: 4,
                spacing: Point2::new(90, 0),
                extent: true,
                suppressed_instances: BTreeSet::from([2]),
            },
        })
        .unwrap()
        .after;
    assert!(
        matches!(&pattern.geometry[&"instance:3".into()].geometry, Geometry::Line(value) if value.start.x_nm == 90)
    );
    assert!(
        !pattern.geometry[&GeometryId::from("instance:2")].construction,
        "suppression must not corrupt construction state"
    );
    assert!(
        matches!(&pattern.operations["linear"], SketchOperation::LinearPattern { suppressed_instances, .. } if suppressed_instances.len() == 1 && suppressed_instances.contains(&2))
    );
    pattern = pattern
        .apply(SketchCommand::SetOperation {
            id: "linear".into(),
            operation: SketchOperation::LinearPattern {
                sources: vec!["source".into()],
                instances: vec![vec!["instance:1".into()]],
                count: 2,
                spacing: Point2::new(30, 0),
                extent: false,
                suppressed_instances: BTreeSet::new(),
            },
        })
        .unwrap()
        .after;
    assert!(
        !pattern
            .geometry
            .contains_key(&GeometryId::from("instance:2"))
            && !pattern
                .geometry
                .contains_key(&GeometryId::from("instance:3"))
    );
}

#[test]
fn offset_v2_metadata_roundtrips_and_reuses_one_generation_per_unchanged_group() {
    let mut sketch = Sketch::new("sketch:offset-v2");
    sketch = add_geometry(&sketch, line("source", (0, 0), (10_000, 0)));
    sketch = add_geometry(&sketch, line("result", (0, 2_000), (10_000, 2_000)));

    reset_offset_generation_call_count();
    sketch = sketch
        .apply(SketchCommand::AddOperation {
            id: "offset".into(),
            operation: SketchOperation::Offset {
                sources: vec!["source".into()],
                result_chains: vec![vec!["result".into()]],
                distance_nm: 2_000,
                two_sided: false,
                linked: true,
                model_tolerance_nm: OFFSET_MODEL_TOLERANCE_NM,
                // Some(empty) is the explicit feature gate for v2 metadata. The
                // canonical recompute owns the final aligned span records.
                result_spans: Some(Vec::new()),
            },
        })
        .unwrap()
        .after;
    assert_eq!(offset_generation_call_count(), 1);

    let SketchOperation::Offset {
        model_tolerance_nm,
        result_chains,
        result_spans: Some(span_chains),
        ..
    } = &sketch.operations["offset"]
    else {
        panic!("offset v2 metadata")
    };
    assert_eq!(*model_tolerance_nm, OFFSET_MODEL_TOLERANCE_NM);
    assert_eq!(span_chains.len(), result_chains.len());
    assert_eq!(
        span_chains[0],
        vec![OffsetResultSpan {
            result: result_chains[0][0].clone(),
            source_start_millionths: 0,
            source_end_millionths: 1_000_000,
            certified_error_nm: Some(2),
        }]
    );

    let stable_result_id = result_chains[0][0].clone();
    reset_offset_generation_call_count();
    sketch = sketch
        .apply(SketchCommand::MovePoint {
            point: PointRef::new("source", Anchor::End),
            to: Point2::new(20_000, 5_000),
        })
        .unwrap()
        .after;
    assert_eq!(offset_generation_call_count(), 1);
    let SketchOperation::Offset {
        result_chains,
        result_spans: Some(span_chains),
        ..
    } = &sketch.operations["offset"]
    else {
        panic!("offset v2 metadata after source edit")
    };
    assert_eq!(result_chains[0], vec![stable_result_id.clone()]);
    assert_eq!(span_chains[0][0].result, stable_result_id);
    assert_eq!(span_chains[0][0].source_start_millionths, 0);
    assert_eq!(span_chains[0][0].source_end_millionths, 1_000_000);

    let bytes = sketch.canonical_bytes().unwrap();
    let serialized: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        serialized["operations"]["offset"]["model_tolerance_nm"],
        OFFSET_MODEL_TOLERANCE_NM
    );
    assert_eq!(
        serialized["operations"]["offset"]["result_spans"][0][0]["source_end_millionths"],
        1_000_000
    );
    assert_eq!(Sketch::from_canonical_bytes(&bytes).unwrap(), sketch);

    let mut legacy = serialized;
    legacy["operations"]["offset"]
        .as_object_mut()
        .unwrap()
        .remove("model_tolerance_nm");
    legacy["operations"]["offset"]
        .as_object_mut()
        .unwrap()
        .remove("result_spans");
    let hydrated = Sketch::from_canonical_bytes(&serde_json::to_vec(&legacy).unwrap()).unwrap();
    assert!(matches!(
        &hydrated.operations["offset"],
        SketchOperation::Offset {
            model_tolerance_nm: OFFSET_MODEL_TOLERANCE_NM,
            result_spans: None,
            ..
        }
    ));
}

#[test]
fn retained_offset_never_joins_serial_neighbors_without_a_shared_source_endpoint() {
    let mut sketch = Sketch::new("sketch:offset-unrelated-neighbors");
    sketch = add_geometry(&sketch, line("source:a", (0, 0), (10, 0)));
    sketch = add_geometry(&sketch, line("source:b", (20, -10), (20, 10)));
    sketch = add_geometry(&sketch, line("result:a", (0, 2), (10, 2)));
    sketch = add_geometry(&sketch, line("result:b", (18, -10), (18, 10)));
    sketch = sketch
        .apply(SketchCommand::AddOperation {
            id: "offset".into(),
            operation: SketchOperation::Offset {
                sources: vec!["source:a".into(), "source:b".into()],
                result_chains: vec![vec!["result:a".into()], vec!["result:b".into()]],
                distance_nm: 2,
                two_sided: false,
                linked: true,
                model_tolerance_nm: OFFSET_MODEL_TOLERANCE_NM,
                result_spans: Some(vec![]),
            },
        })
        .unwrap()
        .after;

    assert!(matches!(
        &sketch.geometry[&"result:a".into()].geometry,
        Geometry::Line(line) if line.start == Point2::new(0, 2) && line.end == Point2::new(10, 2)
    ));
    assert!(matches!(
        &sketch.geometry[&"result:b".into()].geometry,
        Geometry::Line(line) if line.start == Point2::new(18, -10) && line.end == Point2::new(18, 10)
    ));
}

#[test]
fn native_offset_limits_fail_atomically_with_typed_truthful_errors() {
    assert_eq!(
        offset_curve_with_tolerance(
            &Geometry::Circle(Circle {
                center: Point2::new(0, 0),
                radius_nm: 10_000
            }),
            -10_000,
            OFFSET_MODEL_TOLERANCE_NM,
        ),
        Err(OffsetCurveError::SingularOffset),
    );
    assert!(matches!(
        offset_curve_with_tolerance(
            &Geometry::Line(Line {
                start: Point2::new(0, 0),
                end: Point2::new(1, 0)
            }),
            1,
            0,
        ),
        Err(OffsetCurveError::OffsetToleranceUnattainable { .. })
    ));

    // General-curve commits are rejected while no analytic interval proof is
    // available. The typed error still carries the deterministic resource
    // limits that a future certified implementation must obey.
    let many_points = (0..=257)
        .map(|index| Point2::new(index * 10_000, 0))
        .collect::<Vec<_>>();
    let bounded = Geometry::FitPointSpline(FitPointSpline {
        fit_points: many_points,
    });
    assert!(matches!(
        offset_curve_with_tolerance(&bounded, 1_000, OFFSET_MODEL_TOLERANCE_NM),
        Err(OffsetCurveError::OffsetToleranceUnattainable { .. })
    ));

    let mut sketch = Sketch::new("sketch:singular-offset-command");
    sketch = add_geometry(
        &sketch,
        GeometryEntity::new(
            "source",
            Geometry::Circle(Circle {
                center: Point2::new(0, 0),
                radius_nm: 10_000,
            }),
        ),
    );
    sketch = add_geometry(
        &sketch,
        GeometryEntity::new(
            "result",
            Geometry::Circle(Circle {
                center: Point2::new(0, 0),
                radius_nm: 1,
            }),
        ),
    );
    let error = sketch
        .apply(SketchCommand::AddOperation {
            id: "singular".into(),
            operation: SketchOperation::Offset {
                sources: vec!["source".into()],
                result_chains: vec![vec!["result".into()]],
                distance_nm: -10_000,
                two_sided: false,
                linked: true,
                model_tolerance_nm: OFFSET_MODEL_TOLERANCE_NM,
                result_spans: None,
            },
        })
        .unwrap_err();
    assert!(matches!(error, crawler_sketch::SketchError::SingularOffset(id) if id == "singular"));
}

#[test]
fn general_curve_offsets_never_turn_sampled_residuals_into_tolerance_claims() {
    let representative_curves = [
        // Convex open curve.
        Geometry::FitPointSpline(FitPointSpline {
            fit_points: vec![
                Point2::new(0, 0),
                Point2::new(25_000_000, 20_000_000),
                Point2::new(75_000_000, 20_000_000),
                Point2::new(100_000_000, 0),
            ],
        }),
        // Concave/reversing-curvature open curve.
        Geometry::FitPointSpline(FitPointSpline {
            fit_points: vec![
                Point2::new(0, 0),
                Point2::new(25_000_000, 60_000_000),
                Point2::new(75_000_000, -60_000_000),
                Point2::new(100_000_000, 0),
            ],
        }),
        // High-curvature control-point spline.
        Geometry::ControlPointSpline(ControlPointSpline {
            degree: 3,
            control_points: vec![
                Point2::new(0, 0),
                Point2::new(1_000_000, 80_000_000),
                Point2::new(2_000_000, -80_000_000),
                Point2::new(3_000_000, 0),
            ],
            knots_millionths: vec![0, 0, 0, 0, 1_000_000, 1_000_000, 1_000_000, 1_000_000],
        }),
        // Nearly degenerate but still distinct fit points.
        Geometry::FitPointSpline(FitPointSpline {
            fit_points: vec![
                Point2::new(0, 0),
                Point2::new(1, 0),
                Point2::new(2, 1),
                Point2::new(3, 1),
            ],
        }),
        // Closed general curve.
        Geometry::Ellipse(Ellipse {
            center: Point2::new(0, 0),
            major: Point2::new(100_000_000, 0),
            minor: Point2::new(0, 40_000_000),
        }),
        // Reversed traversal of the concave fit-point case.
        Geometry::FitPointSpline(FitPointSpline {
            fit_points: vec![
                Point2::new(100_000_000, 0),
                Point2::new(75_000_000, -60_000_000),
                Point2::new(25_000_000, 60_000_000),
                Point2::new(0, 0),
            ],
        }),
        Geometry::EllipticalArc(EllipticalArc {
            center: Point2::new(0, 0),
            major: Point2::new(100_000_000, 0),
            minor: Point2::new(0, 40_000_000),
            start: Point2::new(100_000_000, 0),
            end: Point2::new(0, 40_000_000),
            clockwise: true,
        }),
        Geometry::Conic(Conic {
            start: Point2::new(0, 0),
            control: Point2::new(50_000_000, 90_000_000),
            end: Point2::new(100_000_000, 0),
            weight_millionths: 750_000,
        }),
    ];

    for geometry in representative_curves {
        let first = offset_curve_with_tolerance(&geometry, 10_000_000, OFFSET_MODEL_TOLERANCE_NM);
        let second = offset_curve_with_tolerance(&geometry, 10_000_000, OFFSET_MODEL_TOLERANCE_NM);
        assert_eq!(first, second);
        match first {
            Ok(pieces) => assert!(pieces.iter().all(|piece| {
                piece.certified && piece.error_bound_nm <= OFFSET_MODEL_TOLERANCE_NM as f64
            })),
            Err(OffsetCurveError::OffsetToleranceUnattainable {
                tolerance_nm: OFFSET_MODEL_TOLERANCE_NM,
                max_spans: 256,
                max_nodes: 32_768,
                max_depth: 24,
            }) => {}
            other => panic!("unexpected durable general-curve result: {other:?}"),
        }
    }
}

#[test]
fn rejected_general_curve_offset_command_is_atomic_and_preserves_document() {
    let mut sketch = Sketch::new("sketch:general-offset-atomic");
    sketch = add_geometry(
        &sketch,
        GeometryEntity::new(
            "source",
            Geometry::FitPointSpline(FitPointSpline {
                fit_points: vec![
                    Point2::new(0, 0),
                    Point2::new(25_000_000, 60_000_000),
                    Point2::new(75_000_000, -60_000_000),
                    Point2::new(100_000_000, 0),
                ],
            }),
        ),
    );
    sketch = add_geometry(
        &sketch,
        line(
            "result-placeholder",
            (0, 10_000_000),
            (100_000_000, 10_000_000),
        ),
    );
    let before_hash = sketch.canonical_hash().unwrap();

    let error = sketch
        .apply(SketchCommand::AddOperation {
            id: "offset-general".into(),
            operation: SketchOperation::Offset {
                sources: vec!["source".into()],
                result_chains: vec![vec!["result-placeholder".into()]],
                distance_nm: 10_000_000,
                two_sided: false,
                linked: true,
                model_tolerance_nm: OFFSET_MODEL_TOLERANCE_NM,
                result_spans: Some(Vec::new()),
            },
        })
        .unwrap_err();

    assert!(matches!(
        error,
        crawler_sketch::SketchError::OffsetToleranceUnattainable(id)
            if id == "offset-general"
    ));
    assert_eq!(sketch.canonical_hash().unwrap(), before_hash);
    assert!(!sketch.operations.contains_key("offset-general"));
}

#[test]
fn primitive_offsets_reject_unrepresentable_numeric_cases_without_panicking() {
    let audited_large_arc = Geometry::Arc(Arc {
        center: Point2::new(0, 0),
        start: Point2::new(3_941_667_066_368_441_554, 4_168_384_806_832_551_033),
        end: Point2::new(-4_168_384_806_832_551_033, 3_941_667_066_368_441_554),
        clockwise: false,
    });
    assert!(matches!(
        offset_curve_with_tolerance(&audited_large_arc, 123_456_789, 1_000),
        Err(OffsetCurveError::OffsetToleranceUnattainable { .. })
    ));

    for rectangle in [
        Geometry::Rectangle(Rectangle {
            min: Point2::new(i64::MIN, 0),
            max: Point2::new(0, 10),
        }),
        Geometry::Rectangle(Rectangle {
            min: Point2::new(0, 0),
            max: Point2::new(i64::MAX, 10),
        }),
    ] {
        assert_eq!(
            offset_curve_with_tolerance(&rectangle, 1, OFFSET_MODEL_TOLERANCE_NM),
            Err(OffsetCurveError::SingularOffset)
        );
    }

    let full_range_arc = Geometry::Arc(Arc {
        center: Point2::new(i64::MIN, 0),
        start: Point2::new(i64::MAX, 0),
        end: Point2::new(i64::MIN, 1),
        clockwise: false,
    });
    assert!(matches!(
        offset_curve_with_tolerance(&full_range_arc, 1, OFFSET_MODEL_TOLERANCE_NM),
        Err(OffsetCurveError::OffsetToleranceUnattainable { .. })
    ));

    let full_range_elliptical_arc = Geometry::EllipticalArc(EllipticalArc {
        center: Point2::new(i64::MIN, 0),
        major: Point2::new(i64::MAX, 0),
        minor: Point2::new(i64::MIN, 1),
        start: Point2::new(i64::MAX, 0),
        end: Point2::new(i64::MIN, 1),
        clockwise: false,
    });
    let result = std::panic::catch_unwind(|| {
        offset_curve_with_tolerance(&full_range_elliptical_arc, 1, OFFSET_MODEL_TOLERANCE_NM)
    });
    assert!(result.is_ok());
    assert!(matches!(
        result.unwrap(),
        Err(OffsetCurveError::OffsetToleranceUnattainable { .. })
            | Err(OffsetCurveError::SingularOffset)
    ));

    let overflowing_arc_result = Geometry::Arc(Arc {
        center: Point2::new(i64::MAX - 10, 0),
        start: Point2::new(i64::MAX, 0),
        end: Point2::new(i64::MAX - 10, 10),
        clockwise: false,
    });
    assert_eq!(
        offset_curve_with_tolerance(&overflowing_arc_result, 100, OFFSET_MODEL_TOLERANCE_NM,),
        Err(OffsetCurveError::SingularOffset)
    );
}

#[test]
fn successful_analytic_offsets_bound_the_observed_primitive_error() {
    let line = Geometry::Line(Line {
        start: Point2::new(-20_000_000, 10_000_000),
        end: Point2::new(70_000_000, 80_000_000),
    });
    let line_piece = offset_curve_with_tolerance(&line, 12_345_678, 1_000)
        .unwrap()
        .remove(0);
    let Geometry::Line(offset_line) = line_piece.geometry else {
        panic!("line offset")
    };
    let observed_line_error = (((offset_line.start.x_nm - (-20_000_000)) as f64)
        .hypot((offset_line.start.y_nm - 10_000_000) as f64)
        - 12_345_678.0)
        .abs();
    assert!(line_piece.certified);
    assert!(observed_line_error <= line_piece.error_bound_nm);

    for (x, y, distance_nm) in [
        (30_000_000, 40_000_000, 12_345_678),
        (999_999_937_111, 123_456_789, 100_000_000),
    ] {
        let arc = Geometry::Arc(Arc {
            center: Point2::new(0, 0),
            start: Point2::new(x, y),
            end: Point2::new(-y, x),
            clockwise: false,
        });
        let piece = offset_curve_with_tolerance(&arc, distance_nm, 1_000)
            .unwrap()
            .remove(0);
        let Geometry::Arc(offset_arc) = piece.geometry else {
            panic!("arc offset")
        };
        let source_radius = (x as f64).hypot(y as f64);
        let result_radius = (offset_arc.start.x_nm as f64).hypot(offset_arc.start.y_nm as f64);
        let observed_error = (result_radius - (source_radius + distance_nm as f64)).abs();
        assert!(piece.certified);
        assert!(observed_error <= piece.error_bound_nm);
    }
}

fn assert_certified_general_offset(
    geometry: &Geometry,
    distance_nm: i64,
    tolerance_nm: i64,
) -> Vec<crawler_sketch::OffsetCurvePiece> {
    let first = offset_curve_with_tolerance(geometry, distance_nm, tolerance_nm).unwrap();
    let second = offset_curve_with_tolerance(geometry, distance_nm, tolerance_nm).unwrap();
    assert_eq!(first, second);
    assert!(!first.is_empty());
    assert!(first.len() <= 256);
    assert!(first.iter().all(|piece| {
        piece.certified
            && piece.error_bound_nm <= tolerance_nm as f64
            && piece.source_start < piece.source_end
    }));
    for pair in first.windows(2) {
        assert!((pair[0].source_end - pair[1].source_start).abs() <= 1.0e-12);
    }
    assert!((first[0].source_start - 0.0).abs() <= 1.0e-12);
    assert!((first.last().unwrap().source_end - 1.0).abs() <= 1.0e-12);
    first
}

#[test]
fn regular_general_curve_offsets_have_deterministic_conservative_certificates() {
    let control_cases = [
        // Convex, concave/reversing-curvature, high-curvature, and reversed.
        vec![
            (0, 0),
            (25_000_000, 20_000_000),
            (75_000_000, 20_000_000),
            (100_000_000, 0),
        ],
        vec![
            (0, 0),
            (25_000_000, 60_000_000),
            (75_000_000, -60_000_000),
            (100_000_000, 0),
        ],
        vec![
            (0, 0),
            (4_000_000, 20_000_000),
            (8_000_000, -20_000_000),
            (12_000_000, 0),
        ],
        vec![
            (100_000_000, 0),
            (75_000_000, -60_000_000),
            (25_000_000, 60_000_000),
            (0, 0),
        ],
        // Nearly collinear but still regular at model scale.
        vec![(0, 0), (1_000_000, 0), (2_000_000, 1), (3_000_000, 1)],
    ];
    for points in control_cases {
        let geometry = Geometry::ControlPointSpline(ControlPointSpline {
            degree: 3,
            control_points: points.into_iter().map(|(x, y)| Point2::new(x, y)).collect(),
            knots_millionths: vec![0, 0, 0, 0, 1_000_000, 1_000_000, 1_000_000, 1_000_000],
        });
        assert_certified_general_offset(&geometry, 2_500_000, OFFSET_MODEL_TOLERANCE_NM);
    }

    for fit_points in [
        vec![
            (0, 0),
            (25_000_000, 20_000_000),
            (75_000_000, 20_000_000),
            (100_000_000, 0),
        ],
        vec![
            (0, 0),
            (25_000_000, 60_000_000),
            (75_000_000, -60_000_000),
            (100_000_000, 0),
        ],
    ] {
        let geometry = Geometry::FitPointSpline(FitPointSpline {
            fit_points: fit_points
                .into_iter()
                .map(|(x, y)| Point2::new(x, y))
                .collect(),
        });
        assert_certified_general_offset(&geometry, 2_500_000, OFFSET_MODEL_TOLERANCE_NM);
    }

    for geometry in [
        Geometry::Ellipse(Ellipse {
            center: Point2::new(0, 0),
            major: Point2::new(40_000_000, 0),
            minor: Point2::new(0, 20_000_000),
        }),
        Geometry::EllipticalArc(EllipticalArc {
            center: Point2::new(0, 0),
            major: Point2::new(40_000_000, 0),
            minor: Point2::new(0, 20_000_000),
            start: Point2::new(40_000_000, 0),
            end: Point2::new(0, 20_000_000),
            clockwise: false,
        }),
        Geometry::EllipticalArc(EllipticalArc {
            center: Point2::new(0, 0),
            major: Point2::new(40_000_000, 0),
            minor: Point2::new(0, 20_000_000),
            start: Point2::new(0, 20_000_000),
            end: Point2::new(40_000_000, 0),
            clockwise: true,
        }),
        Geometry::Conic(Conic {
            start: Point2::new(0, 0),
            control: Point2::new(50_000_000, 60_000_000),
            end: Point2::new(100_000_000, 0),
            weight_millionths: 1_000_000,
        }),
    ] {
        assert_certified_general_offset(&geometry, 2_500_000, OFFSET_MODEL_TOLERANCE_NM);
    }
}

#[test]
fn unsupported_or_singular_general_offsets_are_typed_and_bounded() {
    let cases = [
        // Exact cusp: derivative hull includes zero and subdivision cannot
        // establish a regular normal field.
        Geometry::ControlPointSpline(ControlPointSpline {
            degree: 3,
            control_points: vec![
                Point2::new(0, 0),
                Point2::new(1, 0),
                Point2::new(1, 0),
                Point2::new(0, 0),
            ],
            knots_millionths: vec![0, 0, 0, 0, 1_000_000, 1_000_000, 1_000_000, 1_000_000],
        }),
        // Multi-span B-splines need exact Bezier extraction before certification.
        Geometry::ControlPointSpline(ControlPointSpline {
            degree: 3,
            control_points: vec![
                Point2::new(0, 0),
                Point2::new(1_000_000, 0),
                Point2::new(2_000_000, 1_000_000),
                Point2::new(3_000_000, 0),
                Point2::new(4_000_000, 0),
            ],
            knots_millionths: vec![],
        }),
        // Rational quadratic bounds are not yet part of the durable evaluator.
        Geometry::Conic(Conic {
            start: Point2::new(0, 0),
            control: Point2::new(50_000_000, 60_000_000),
            end: Point2::new(100_000_000, 0),
            weight_millionths: 750_000,
        }),
        // Singular ellipse axes.
        Geometry::Ellipse(Ellipse {
            center: Point2::new(0, 0),
            major: Point2::new(40_000_000, 0),
            minor: Point2::new(20_000_000, 0),
        }),
        // Coordinates above the exact binary64 certification range.
        Geometry::Ellipse(Ellipse {
            center: Point2::new(1_i64 << 50, 0),
            major: Point2::new((1_i64 << 50) + 40_000_000, 0),
            minor: Point2::new(1_i64 << 50, 20_000_000),
        }),
    ];
    for geometry in cases {
        let result = std::panic::catch_unwind(|| {
            offset_curve_with_tolerance(&geometry, 2_500_000, OFFSET_MODEL_TOLERANCE_NM)
        });
        assert!(result.is_ok());
        assert!(matches!(
            result.unwrap(),
            Err(OffsetCurveError::OffsetToleranceUnattainable { .. })
                | Err(OffsetCurveError::SingularOffset)
        ));
    }

    let mut sketch = Sketch::new("sketch:min-two-sided-offset");
    sketch = add_geometry(&sketch, line("source", (0, 0), (1_000_000, 0)));
    let result = std::panic::catch_unwind(|| {
        sketch.apply(SketchCommand::AddOperation {
            id: "min-distance".into(),
            operation: SketchOperation::Offset {
                sources: vec!["source".into()],
                result_chains: vec![vec![], vec![]],
                distance_nm: i64::MIN,
                two_sided: true,
                linked: true,
                model_tolerance_nm: OFFSET_MODEL_TOLERANCE_NM,
                result_spans: Some(vec![]),
            },
        })
    });
    assert!(result.is_ok());
    assert!(matches!(
        result.unwrap(),
        Err(crawler_sketch::SketchError::SingularOffset(id))
            | Err(crawler_sketch::SketchError::OffsetToleranceUnattainable(id))
            if id == "min-distance"
    ));
}

#[test]
fn certified_general_offset_intent_roundtrips_and_recomputes_with_stable_span_ids() {
    let mut sketch = Sketch::new("sketch:certified-general-offset");
    sketch = add_geometry(
        &sketch,
        GeometryEntity::new(
            "source",
            Geometry::ControlPointSpline(ControlPointSpline {
                degree: 3,
                control_points: vec![
                    Point2::new(0, 0),
                    Point2::new(25_000_000, 20_000_000),
                    Point2::new(75_000_000, 20_000_000),
                    Point2::new(100_000_000, 0),
                ],
                knots_millionths: vec![0, 0, 0, 0, 1_000_000, 1_000_000, 1_000_000, 1_000_000],
            }),
        ),
    );
    sketch = sketch
        .apply(SketchCommand::AddOperation {
            id: "general".into(),
            operation: SketchOperation::Offset {
                sources: vec!["source".into()],
                result_chains: vec![vec![]],
                distance_nm: 2_500_000,
                two_sided: false,
                linked: true,
                model_tolerance_nm: OFFSET_MODEL_TOLERANCE_NM,
                result_spans: Some(vec![]),
            },
        })
        .unwrap()
        .after;
    let SketchOperation::Offset {
        result_chains,
        result_spans: Some(result_spans),
        ..
    } = &sketch.operations["general"]
    else {
        panic!("offset operation")
    };
    let ids = result_chains[0].clone();
    assert!(!ids.is_empty());
    assert_eq!(ids.len(), result_spans[0].len());
    assert!(result_spans[0].iter().all(|span| {
        span.certified_error_nm
            .is_some_and(|error| error <= OFFSET_MODEL_TOLERANCE_NM)
    }));
    assert!(ids.iter().all(|id| {
        matches!(
            sketch.geometry[id].geometry,
            Geometry::ControlPointSpline(ControlPointSpline { degree: 2, .. }) | Geometry::Line(_)
        )
    }));

    let reloaded = Sketch::from_canonical_bytes(&sketch.canonical_bytes().unwrap()).unwrap();
    assert_eq!(
        reloaded.canonical_hash().unwrap(),
        sketch.canonical_hash().unwrap()
    );
    let edited = reloaded
        .apply(SketchCommand::MovePoint {
            point: PointRef {
                geometry: "source".into(),
                anchor: crawler_sketch::Anchor::ControlPoint(1),
            },
            to: Point2::new(25_000_000, 18_000_000),
        })
        .unwrap()
        .after;
    let SketchOperation::Offset {
        result_chains: edited_chains,
        ..
    } = &edited.operations["general"]
    else {
        panic!("offset operation")
    };
    assert_eq!(edited_chains[0], ids);
    assert_ne!(
        edited.canonical_hash().unwrap(),
        sketch.canonical_hash().unwrap()
    );
}

#[test]
fn adaptive_offset_topology_reuses_ids_by_source_interval_not_position() {
    let make_source = |second_y| {
        Geometry::ControlPointSpline(ControlPointSpline {
            degree: 3,
            control_points: vec![
                Point2::new(0, 0),
                Point2::new(25_000_000, second_y),
                Point2::new(75_000_000, 20_000_000),
                Point2::new(100_000_000, 0),
            ],
            knots_millionths: vec![0, 0, 0, 0, 1_000_000, 1_000_000, 1_000_000, 1_000_000],
        })
    };
    let mut sketch = Sketch::new("sketch:offset-interval-identity");
    sketch = add_geometry(
        &sketch,
        GeometryEntity::new("source", make_source(20_000_000)),
    );
    sketch = sketch
        .apply(SketchCommand::AddOperation {
            id: "adaptive".into(),
            operation: SketchOperation::Offset {
                sources: vec!["source".into()],
                result_chains: vec![vec![]],
                distance_nm: 2_500_000,
                two_sided: false,
                linked: true,
                model_tolerance_nm: OFFSET_MODEL_TOLERANCE_NM,
                result_spans: Some(vec![]),
            },
        })
        .unwrap()
        .after;
    let SketchOperation::Offset {
        result_spans: Some(before),
        ..
    } = &sketch.operations["adaptive"]
    else {
        panic!("offset")
    };
    let before = before[0].clone();
    sketch = sketch
        .apply(SketchCommand::MovePoint {
            point: PointRef::new("source", Anchor::ControlPoint(1)),
            to: Point2::new(25_000_000, 40_000_000),
        })
        .unwrap()
        .after;
    let SketchOperation::Offset {
        result_spans: Some(after),
        ..
    } = &sketch.operations["adaptive"]
    else {
        panic!("offset")
    };
    for old in before {
        if let Some(exact) = after[0].iter().find(|new| {
            new.source_start_millionths == old.source_start_millionths
                && new.source_end_millionths == old.source_end_millionths
        }) {
            assert_eq!(exact.result, old.result);
        }
    }
}

#[test]
fn certified_general_bounds_cover_independent_dense_reference_evaluations() {
    let controls = [
        Point2::new(0, 0),
        Point2::new(25_000_000, 60_000_000),
        Point2::new(75_000_000, -60_000_000),
        Point2::new(100_000_000, 0),
    ];
    let spline = Geometry::ControlPointSpline(ControlPointSpline {
        degree: 3,
        control_points: controls.to_vec(),
        knots_millionths: vec![0, 0, 0, 0, 1_000_000, 1_000_000, 1_000_000, 1_000_000],
    });
    let distance_nm = 2_500_000_i64;
    let pieces =
        offset_curve_with_tolerance(&spline, distance_nm, OFFSET_MODEL_TOLERANCE_NM).unwrap();
    let coordinate = |index: usize, x: bool| {
        if x {
            controls[index].x_nm as f64
        } else {
            controls[index].y_nm as f64
        }
    };
    for piece in &pieces {
        for sample in 0..=32 {
            let u = sample as f64 / 32.0;
            let t = piece.source_start + (piece.source_end - piece.source_start) * u;
            let inverse = 1.0 - t;
            let value = |x: bool| {
                inverse.powi(3) * coordinate(0, x)
                    + 3.0 * inverse.powi(2) * t * coordinate(1, x)
                    + 3.0 * inverse * t * t * coordinate(2, x)
                    + t.powi(3) * coordinate(3, x)
            };
            let derivative = |x: bool| {
                3.0 * inverse.powi(2) * (coordinate(1, x) - coordinate(0, x))
                    + 6.0 * inverse * t * (coordinate(2, x) - coordinate(1, x))
                    + 3.0 * t * t * (coordinate(3, x) - coordinate(2, x))
            };
            let (dx, dy) = (derivative(true), derivative(false));
            let speed = dx.hypot(dy);
            let expected = (
                value(true) - dy / speed * distance_nm as f64,
                value(false) + dx / speed * distance_nm as f64,
            );
            let observed = evaluate_curve(&piece.geometry, u);
            let error =
                (observed.x_nm as f64 - expected.0).hypot(observed.y_nm as f64 - expected.1);
            assert!(
                error <= piece.error_bound_nm + 1.0e-6,
                "observed {error} > certified {} at {t}",
                piece.error_bound_nm
            );
        }
    }

    let ellipse = Geometry::Ellipse(Ellipse {
        center: Point2::new(10_000_000, -5_000_000),
        major: Point2::new(50_000_000, -5_000_000),
        minor: Point2::new(10_000_000, 15_000_000),
    });
    let pieces =
        offset_curve_with_tolerance(&ellipse, distance_nm, OFFSET_MODEL_TOLERANCE_NM).unwrap();
    assert_eq!(
        pieces.len(),
        1,
        "certified ellipse intervals should be one editable composite spline"
    );
    for piece in &pieces {
        for sample in 0..=32 {
            let u = sample as f64 / 32.0;
            let t = piece.source_start + (piece.source_end - piece.source_start) * u;
            let theta = std::f64::consts::TAU * t;
            let point = (
                10_000_000.0 + 40_000_000.0 * theta.cos(),
                -5_000_000.0 + 20_000_000.0 * theta.sin(),
            );
            let derivative = (-40_000_000.0 * theta.sin(), 20_000_000.0 * theta.cos());
            let speed = derivative.0.hypot(derivative.1);
            let expected = (
                point.0 - derivative.1 / speed * distance_nm as f64,
                point.1 + derivative.0 / speed * distance_nm as f64,
            );
            let observed = evaluate_curve(&piece.geometry, u);
            let error =
                (observed.x_nm as f64 - expected.0).hypot(observed.y_nm as f64 - expected.1);
            assert!(error <= piece.error_bound_nm + 1.0e-6);
        }
    }
}

#[test]
fn elliptical_arc_offset_side_follows_signed_traversal() {
    let distance_nm = 2_500_000_i64;
    for clockwise in [false, true] {
        let (start, end) = if clockwise {
            (Point2::new(0, 20_000_000), Point2::new(40_000_000, 0))
        } else {
            (Point2::new(40_000_000, 0), Point2::new(0, 20_000_000))
        };
        let arc = Geometry::EllipticalArc(EllipticalArc {
            center: Point2::new(0, 0),
            major: Point2::new(40_000_000, 0),
            minor: Point2::new(0, 20_000_000),
            start,
            end,
            clockwise,
        });
        let pieces =
            offset_curve_with_tolerance(&arc, distance_nm, OFFSET_MODEL_TOLERANCE_NM).unwrap();
        assert_eq!(pieces.len(), 1);
        for piece in &pieces {
            for sample in 0..=16 {
                let u = sample as f64 / 16.0;
                let t = piece.source_start + (piece.source_end - piece.source_start) * u;
                let theta = if clockwise {
                    std::f64::consts::FRAC_PI_2 * (1.0 - t)
                } else {
                    std::f64::consts::FRAC_PI_2 * t
                };
                let signed_rate = if clockwise { -1.0 } else { 1.0 };
                let point = (40_000_000.0 * theta.cos(), 20_000_000.0 * theta.sin());
                let derivative = (
                    signed_rate * -40_000_000.0 * theta.sin(),
                    signed_rate * 20_000_000.0 * theta.cos(),
                );
                let speed = derivative.0.hypot(derivative.1);
                let expected = (
                    point.0 - derivative.1 / speed * distance_nm as f64,
                    point.1 + derivative.0 / speed * distance_nm as f64,
                );
                let observed = evaluate_curve(&piece.geometry, u);
                let error =
                    (observed.x_nm as f64 - expected.0).hypot(observed.y_nm as f64 - expected.1);
                assert!(error <= piece.error_bound_nm + 1.0e-6);
            }
        }
    }
}

#[test]
fn retained_corner_break_transform_and_blend_operations_are_editable() {
    let corner = || {
        let mut sketch = Sketch::new("sketch:p1-corner");
        sketch = add_geometry(&sketch, line("first", (100, 0), (0, 0)));
        sketch = add_geometry(&sketch, line("second", (0, 0), (0, 100)));
        sketch = add_geometry(&sketch, line("result", (10, 0), (0, 10)));
        sketch
    };
    let mut fillet = corner();
    fillet = fillet
        .apply(SketchCommand::AddOperation {
            id: "fillet".into(),
            operation: SketchOperation::Fillet {
                first: "first".into(),
                second: "second".into(),
                result: "result".into(),
                radius_nm: 10,
            },
        })
        .unwrap()
        .after;
    assert!(matches!(
        fillet.geometry[&"result".into()].geometry,
        Geometry::Arc(_)
    ));
    fillet = fillet
        .apply(SketchCommand::SetOperation {
            id: "fillet".into(),
            operation: SketchOperation::Fillet {
                first: "first".into(),
                second: "second".into(),
                result: "result".into(),
                radius_nm: 20,
            },
        })
        .unwrap()
        .after;
    let Geometry::Arc(value) = &fillet.geometry[&"result".into()].geometry else {
        panic!("arc")
    };
    assert!((distance_for_test(value.center, value.start) - 20.0).abs() <= 1.0);

    let mut chamfer = corner();
    chamfer = chamfer
        .apply(SketchCommand::AddOperation {
            id: "chamfer".into(),
            operation: SketchOperation::Chamfer {
                first: "first".into(),
                second: "second".into(),
                result: "result".into(),
                first_distance_nm: 12,
                second_distance_nm: 18,
                angle_microdegrees: 45_000_000,
                mode: "two_distance".into(),
            },
        })
        .unwrap()
        .after;
    assert!(
        matches!(&chamfer.geometry[&"result".into()].geometry, Geometry::Line(value) if value.start == Point2::new(12, 0) && value.end == Point2::new(0, 18))
    );

    let mut split = Sketch::new("sketch:p1-break");
    split = add_geometry(&split, line("source", (0, 0), (100, 0)));
    split = add_geometry(&split, line("a", (0, 0), (50, 0)));
    split = add_geometry(&split, line("b", (50, 0), (100, 0)));
    split = split
        .apply(SketchCommand::AddOperation {
            id: "break".into(),
            operation: SketchOperation::Break {
                source: "source".into(),
                results: vec!["a".into(), "b".into()],
                parameters_millionths: vec![500_000],
            },
        })
        .unwrap()
        .after;
    assert!(
        matches!(&split.geometry[&"a".into()].geometry, Geometry::Line(value) if value.end == Point2::new(50, 0))
    );

    let original = Geometry::Line(Line {
        start: Point2::new(0, 0),
        end: Point2::new(10, 0),
    });
    let mut transform = Sketch::new("sketch:p1-transform");
    transform = add_geometry(&transform, GeometryEntity::new("source", original.clone()));
    transform = transform
        .apply(SketchCommand::AddOperation {
            id: "move".into(),
            operation: SketchOperation::MoveCopy {
                sources: vec!["source".into()],
                results: vec!["source".into()],
                originals: vec![original],
                delta: Point2::new(30, 40),
                copy: false,
            },
        })
        .unwrap()
        .after;
    assert!(
        matches!(&transform.geometry[&"source".into()].geometry, Geometry::Line(value) if value.start == Point2::new(30, 40))
    );
    // Recomputing an in-place retained transform uses its original basis and is not cumulative.
    transform = transform
        .apply(SketchCommand::SetOperation {
            id: "move".into(),
            operation: transform.operations["move"].clone(),
        })
        .unwrap()
        .after;
    assert!(
        matches!(&transform.geometry[&"source".into()].geometry, Geometry::Line(value) if value.start == Point2::new(30, 40))
    );

    let mut blend = Sketch::new("sketch:p1-blend");
    blend = add_geometry(&blend, line("first", (0, 0), (10, 0)));
    blend = add_geometry(&blend, line("second", (30, 10), (40, 10)));
    blend = add_geometry(&blend, line("blend", (10, 0), (30, 10)));
    blend = blend
        .apply(SketchCommand::AddOperation {
            id: "blend-op".into(),
            operation: SketchOperation::Blend {
                first: "first".into(),
                second: "second".into(),
                result: "blend".into(),
                continuity: "g2".into(),
                magnitude_nm: 5,
            },
        })
        .unwrap()
        .after;
    assert!(matches!(
        blend.geometry[&"blend".into()].geometry,
        Geometry::ControlPointSpline(_)
    ));
    assert!(
        blend
            .constraints
            .contains_key(&ConstraintId::from("operation:blend-op:g2:0"))
    );
}

#[test]
fn project_include_retains_source_kind_lock_link_and_repair_state() {
    let mut sketch = Sketch::new("sketch:p1-project");
    sketch = add_geometry(&sketch, line("external:edge", (0, 0), (100, 0)));
    sketch = sketch
        .apply(SketchCommand::AddOperation {
            id: "project".into(),
            operation: SketchOperation::ProjectInclude {
                source_kind: "edge".into(),
                source_ids: vec!["kernel-edge:42".into()],
                results: vec!["external:edge".into()],
                linked: true,
                locked: true,
                intersect_plane: false,
                missing: false,
            },
        })
        .unwrap()
        .after;
    sketch = sketch
        .apply(SketchCommand::SetOperation {
            id: "project".into(),
            operation: SketchOperation::ProjectInclude {
                source_kind: "plane_intersection".into(),
                source_ids: vec!["face:7".into()],
                results: vec!["external:edge".into()],
                linked: true,
                locked: true,
                intersect_plane: true,
                missing: true,
            },
        })
        .unwrap()
        .after;
    let SketchOperation::ProjectInclude {
        source_kind,
        intersect_plane,
        missing,
        ..
    } = &sketch.operations["project"]
    else {
        panic!("projection")
    };
    assert_eq!(source_kind, "plane_intersection");
    assert!(*intersect_plane && *missing);
    assert_eq!(
        Sketch::from_canonical_bytes(&sketch.canonical_bytes().unwrap()).unwrap(),
        sketch
    );
}

#[test]
fn line_line_tangent_is_rejected_and_composite_intent_is_canonical() {
    let mut sketch = Sketch::new("sketch:composite-intent");
    sketch = add_geometry(&sketch, line("line:a", (0, 0), (10, 0)));
    sketch = add_geometry(&sketch, line("line:b", (0, 5), (10, 5)));
    sketch = add_geometry(&sketch, line("line:c", (10, 5), (0, 0)));
    assert!(
        sketch
            .apply(SketchCommand::AddConstraint {
                id: "constraint:tangent".into(),
                constraint: Constraint::Tangent {
                    first: "line:a".into(),
                    second: "line:b".into(),
                    first_parameter_millionths: None,
                    second_parameter_millionths: None,
                },
            })
            .is_err()
    );

    sketch = add_constraint(
        &sketch,
        "constraint:length",
        Constraint::Distance {
            a: PointRef::new("line:a", Anchor::Start),
            b: PointRef::new("line:a", Anchor::End),
            distance_nm: 10,
        },
    );
    sketch = sketch
        .apply(SketchCommand::SetDimensionPosition {
            constraint: "constraint:length".into(),
            position: Point2::new(4, 8),
        })
        .unwrap()
        .after;
    sketch = sketch
        .apply(SketchCommand::AddRecipe {
            id: "recipe:polygon".into(),
            recipe: SketchRecipe::Polygon {
                mode: "inscribed".into(),
                center: Point2::new(5, 2),
                radius_nm: 6,
                sides: 3,
                orientation_microdegrees: 0,
                geometry: vec!["line:a".into(), "line:b".into(), "line:c".into()],
            },
        })
        .unwrap()
        .after;
    let member_ids = sketch.recipes["recipe:polygon"].geometry().to_vec();
    sketch = sketch
        .apply(SketchCommand::SetRecipe {
            id: "recipe:polygon".into(),
            recipe: SketchRecipe::Polygon {
                mode: "inscribed".into(),
                center: Point2::new(20, 30),
                radius_nm: 10,
                sides: 3,
                orientation_microdegrees: 90_000_000,
                geometry: member_ids.clone(),
            },
        })
        .unwrap()
        .after;
    assert_eq!(sketch.recipes["recipe:polygon"].geometry(), member_ids);
    assert!(
        matches!(&sketch.geometry[&GeometryId::from("line:a")].geometry, Geometry::Line(value) if value.start == Point2::new(20, 40))
    );
    sketch = sketch
        .apply(SketchCommand::SetConstraint {
            id: "constraint:length".into(),
            constraint: Constraint::Distance {
                a: PointRef::new("line:a", Anchor::Start),
                b: PointRef::new("line:a", Anchor::End),
                distance_nm: 17,
            },
        })
        .unwrap()
        .after;
    assert_eq!(
        sketch.dimension_positions[&ConstraintId::from("constraint:length")],
        Point2::new(4, 8)
    );
    assert_eq!(
        Sketch::from_canonical_bytes(&sketch.canonical_bytes().unwrap()).unwrap(),
        sketch
    );
}

#[test]
fn retained_text_recomputes_on_a_path_and_explodes_without_losing_curves() {
    let mut sketch = Sketch::new("sketch:p2-text");
    sketch.geometry.insert(
        "path".into(),
        GeometryEntity::new(
            "path",
            Geometry::Line(Line {
                start: Point2::new(0, 0),
                end: Point2::new(100, 0),
            }),
        ),
    );
    let members = (0..6)
        .map(|index| GeometryId(format!("text:{index}")))
        .collect::<Vec<_>>();
    for id in &members {
        sketch.geometry.insert(
            id.clone(),
            GeometryEntity::new(
                id.clone(),
                Geometry::Line(Line {
                    start: Point2::new(0, 0),
                    end: Point2::new(1, 0),
                }),
            ),
        );
    }
    sketch = sketch
        .apply(SketchCommand::AddRecipe {
            id: "recipe:text".into(),
            recipe: SketchRecipe::Text {
                text: "A".into(),
                origin: Point2::new(0, 0),
                height_nm: 20,
                rotation_microdegrees: 0,
                tracking_millionths: 1_000_000,
                horizontal_alignment: "left".into(),
                path: Some("path".into()),
                path_start_millionths: 0,
                reversed: false,
                geometry: members.clone(),
            },
        })
        .unwrap()
        .after;
    sketch = sketch
        .apply(SketchCommand::SetRecipe {
            id: "recipe:text".into(),
            recipe: sketch.recipes["recipe:text"].clone(),
        })
        .unwrap()
        .after;
    assert!(
        members
            .iter()
            .all(|id| matches!(sketch.geometry[id].geometry, Geometry::Line(_)))
    );
    let before_path_edit = sketch.geometry[&members[0]].geometry.clone();
    sketch = sketch
        .apply(SketchCommand::MovePoint {
            point: PointRef::new("path", Anchor::End),
            to: Point2::new(100, 100),
        })
        .unwrap()
        .after;
    assert_ne!(sketch.geometry[&members[0]].geometry, before_path_edit);
    let shorter = members[..4].to_vec();
    sketch = sketch
        .apply(SketchCommand::SetRecipe {
            id: "recipe:text".into(),
            recipe: SketchRecipe::Text {
                text: "I".into(),
                origin: Point2::new(5, 7),
                height_nm: 30,
                rotation_microdegrees: 45_000_000,
                tracking_millionths: 900_000,
                horizontal_alignment: "center".into(),
                path: None,
                path_start_millionths: 0,
                reversed: true,
                geometry: shorter.clone(),
            },
        })
        .unwrap()
        .after;
    assert_eq!(sketch.recipes["recipe:text"].geometry(), shorter);
    assert!(!sketch.geometry.contains_key(&members[5]));
    sketch = sketch
        .apply(SketchCommand::RemoveRecipe {
            id: "recipe:text".into(),
        })
        .unwrap()
        .after;
    assert!(!sketch.recipes.contains_key("recipe:text"));
    assert!(shorter.iter().all(|id| sketch.geometry.contains_key(id)));
    assert_eq!(
        Sketch::from_canonical_bytes(&sketch.canonical_bytes().unwrap()).unwrap(),
        sketch
    );
}

#[test]
fn curvature_continuity_matches_endpoint_tangent_and_curvature() {
    let mut sketch = Sketch::new("sketch:g2");
    for (id, points) in [
        (
            "first",
            vec![
                Point2::new(0, 0),
                Point2::new(3_000_000, 4_000_000),
                Point2::new(6_000_000, 4_000_000),
                Point2::new(9_000_000, 0),
            ],
        ),
        (
            "second",
            vec![
                Point2::new(9_300_000, 400_000),
                Point2::new(12_000_000, -1_000_000),
                Point2::new(15_000_000, 9_000_000),
                Point2::new(18_000_000, 0),
            ],
        ),
    ] {
        sketch = add_geometry(
            &sketch,
            GeometryEntity::new(
                id,
                Geometry::ControlPointSpline(ControlPointSpline {
                    degree: 3,
                    knots_millionths: vec![],
                    control_points: points,
                }),
            ),
        );
    }
    sketch = add_constraint(
        &sketch,
        "g2",
        Constraint::CurvatureContinuous {
            first: "first".into(),
            second: "second".into(),
        },
    );
    let solved = EzpzSolver.solve_sketch(&sketch).unwrap();
    assert_ne!(solved.solve.state, SolveState::Conflicting);
    let first = evaluate_frame(
        &solved.sketch.geometry[&GeometryId::from("first")].geometry,
        1.0,
    );
    let second = evaluate_frame(
        &solved.sketch.geometry[&GeometryId::from("second")].geometry,
        0.0,
    );
    assert_eq!(first.point, second.point);
    assert!(
        (first.tangent[0] * second.tangent[1] - first.tangent[1] * second.tangent[0]).abs()
            <= 1.0e-3
    );
    assert!(
        (first.curvature_per_nm - second.curvature_per_nm).abs()
            <= 1.0e-10_f64.max(
                first
                    .curvature_per_nm
                    .abs()
                    .max(second.curvature_per_nm.abs())
                    * 0.03
            )
    );
}

#[test]
fn point_on_native_curve_is_projected_and_solved() {
    let ellipse = Geometry::Ellipse(Ellipse {
        center: Point2::new(0, 0),
        major: Point2::new(20, 0),
        minor: Point2::new(0, 10),
    });
    let mut sketch = Sketch::new("sketch:native-point-on-object");
    sketch = add_geometry(&sketch, GeometryEntity::new("ellipse", ellipse.clone()));
    sketch = add_geometry(
        &sketch,
        GeometryEntity::new("point", Geometry::SketchPoint(Point2::new(22, 1))),
    );
    sketch = add_constraint(
        &sketch,
        "on",
        Constraint::PointOnObject {
            point: PointRef::new("point", Anchor::Position),
            geometry: GeometryId::from("ellipse"),
        },
    );
    let solved = EzpzSolver.solve_sketch(&sketch).unwrap();
    assert_ne!(solved.solve.state, SolveState::Conflicting);
    let Geometry::SketchPoint(point) = solved.sketch.geometry[&GeometryId::from("point")].geometry
    else {
        panic!("point")
    };
    assert!(project_point(&ellipse, point).distance_nm <= 1.0);
}

#[test]
fn complete_geometric_constraints_project_points_symmetry_and_object_fix() {
    let mut sketch = Sketch::new("sketch:complete-constraints");
    sketch = add_geometry(&sketch, line("axis", (-20, 0), (20, 0)));
    sketch = add_geometry(
        &sketch,
        GeometryEntity::new("a", Geometry::SketchPoint(Point2::new(3, 7))),
    );
    sketch = add_geometry(
        &sketch,
        GeometryEntity::new("b", Geometry::SketchPoint(Point2::new(-1, -5))),
    );
    sketch = add_constraint(
        &sketch,
        "symmetry",
        Constraint::Symmetry {
            first: PointRef::new("a", Anchor::Position),
            second: PointRef::new("b", Anchor::Position),
            axis: "axis".into(),
        },
    );
    let solved = EzpzSolver.solve_sketch(&sketch).unwrap();
    let Geometry::SketchPoint(b) = solved.sketch.geometry[&GeometryId::from("b")].geometry else {
        panic!("point")
    };
    assert_eq!(b, Point2::new(3, -7));

    let mut horizontal = solved.sketch;
    horizontal.constraints.clear();
    horizontal = add_constraint(
        &horizontal,
        "horizontal-points",
        Constraint::HorizontalPoints {
            a: PointRef::new("a", Anchor::Position),
            b: PointRef::new("b", Anchor::Position),
        },
    );
    let solved = EzpzSolver.solve_sketch(&horizontal).unwrap();
    let Geometry::SketchPoint(a) = solved.sketch.geometry[&GeometryId::from("a")].geometry else {
        panic!("point")
    };
    let Geometry::SketchPoint(b) = solved.sketch.geometry[&GeometryId::from("b")].geometry else {
        panic!("point")
    };
    assert_eq!(a.y_nm, b.y_nm);

    let mut fixed = solved.sketch;
    fixed.constraints.clear();
    fixed = add_constraint(
        &fixed,
        "fix-axis",
        Constraint::FixedGeometry {
            geometry: "axis".into(),
        },
    );
    assert_ne!(
        EzpzSolver.solve_sketch(&fixed).unwrap().solve.state,
        SolveState::Conflicting
    );
}

#[test]
fn universal_dimensions_and_curve_parameter_references_solve_durably() {
    let mut sketch = Sketch::new("sketch:universal-dimensions");
    sketch = add_geometry(&sketch, line("a", (0, 0), (20, 0)));
    sketch = add_geometry(&sketch, line("b", (0, 7), (20, 7)));
    sketch = add_geometry(
        &sketch,
        GeometryEntity::new("point", Geometry::SketchPoint(Point2::new(4, 9))),
    );
    sketch = add_constraint(
        &sketch,
        "line-distance",
        Constraint::LineDistance {
            first: "a".into(),
            second: "b".into(),
            distance_nm: 5,
        },
    );
    sketch = add_constraint(
        &sketch,
        "point-line",
        Constraint::PointLineDistance {
            point: PointRef::new("point", Anchor::Position),
            line: "a".into(),
            distance_nm: 3,
        },
    );
    let solved = EzpzSolver.solve_sketch(&sketch).unwrap();
    assert_ne!(solved.solve.state, SolveState::Conflicting);
    let Geometry::Line(b) = &solved.sketch.geometry[&GeometryId::from("b")].geometry else {
        panic!("line")
    };
    assert_eq!(b.start.y_nm.abs(), 5);
    let Geometry::SketchPoint(point) = solved.sketch.geometry[&GeometryId::from("point")].geometry
    else {
        panic!("point")
    };
    assert_eq!(point.y_nm.abs(), 3);

    let mut referenced = Sketch::new("sketch:parameter-ref");
    referenced = add_geometry(
        &referenced,
        GeometryEntity::new(
            "spline",
            Geometry::ControlPointSpline(ControlPointSpline {
                degree: 3,
                knots_millionths: vec![],
                control_points: vec![
                    Point2::new(0, 0),
                    Point2::new(10, 20),
                    Point2::new(20, -10),
                    Point2::new(30, 0),
                ],
            }),
        ),
    );
    referenced = add_geometry(
        &referenced,
        GeometryEntity::new("datum", Geometry::SketchPoint(Point2::new(0, 0))),
    );
    referenced = add_constraint(
        &referenced,
        "parameter-coincident",
        Constraint::Coincident {
            a: PointRef::new("spline", Anchor::CurveParameter(500_000)),
            b: PointRef::new("datum", Anchor::Position),
        },
    );
    assert_ne!(
        EzpzSolver.solve_sketch(&referenced).unwrap().solve.state,
        SolveState::Conflicting
    );
    let bytes = serde_json::to_vec(&PointRef::new("spline", Anchor::Knot(2))).unwrap();
    assert_eq!(
        serde_json::from_slice::<PointRef>(&bytes).unwrap().anchor,
        Anchor::Knot(2)
    );
}

fn line(id: &str, start: (i64, i64), end: (i64, i64)) -> GeometryEntity {
    GeometryEntity::new(
        id,
        Geometry::Line(Line {
            start: Point2::new(start.0, start.1),
            end: Point2::new(end.0, end.1),
        }),
    )
}

#[test]
fn native_control_point_spline_round_trips_moves_and_participates_in_profiles() {
    let mut sketch = Sketch::new("sketch:spline");
    sketch = add_geometry(
        &sketch,
        GeometryEntity::new(
            "spline:a",
            Geometry::ControlPointSpline(ControlPointSpline {
                degree: 3,
                knots_millionths: vec![],
                control_points: vec![
                    Point2::new(0, 0),
                    Point2::new(10, 20),
                    Point2::new(20, -10),
                    Point2::new(30, 0),
                ],
            }),
        ),
    );
    sketch = add_geometry(&sketch, line("line:close", (30, 0), (0, 0)));

    let bytes = sketch.canonical_bytes().unwrap();
    let json = String::from_utf8(bytes.clone()).unwrap();
    assert!(json.contains("control_point_spline"));
    assert_eq!(Sketch::from_canonical_bytes(&bytes).unwrap(), sketch);
    assert_eq!(
        sketch.profile_report().closed_profiles,
        vec![vec![
            GeometryId::from("line:close"),
            GeometryId::from("spline:a"),
        ]]
    );

    let moved = sketch
        .apply(SketchCommand::MovePoint {
            point: PointRef::control_point("spline:a", 2),
            to: Point2::new(22, -12),
        })
        .unwrap()
        .after;
    let Geometry::ControlPointSpline(spline) =
        &moved.geometry[&GeometryId::from("spline:a")].geometry
    else {
        panic!("native spline was replaced");
    };
    assert_eq!(spline.control_points[2], Point2::new(22, -12));
    assert!(
        serde_json::to_string(&PointRef::control_point("spline:a", 2))
            .unwrap()
            .contains("control:2")
    );
    let decomposition = Decomposition::from_sketch(&moved);
    let spline_component = decomposition
        .components
        .iter()
        .find(|component| component.geometry.contains(&GeometryId::from("spline:a")))
        .unwrap();
    assert_eq!(spline_component.variable_count, 8);
}

#[test]
fn spline_control_points_are_solver_addressable() {
    let mut sketch = Sketch::new("sketch:spline-solver");
    sketch = add_geometry(
        &sketch,
        GeometryEntity::new(
            "spline:a",
            Geometry::ControlPointSpline(ControlPointSpline {
                degree: 3,
                knots_millionths: vec![],
                control_points: vec![
                    Point2::new(5, 5),
                    Point2::new(10, 20),
                    Point2::new(20, -10),
                    Point2::new(30, 0),
                ],
            }),
        ),
    );
    sketch = add_constraint(
        &sketch,
        "constraint:origin",
        Constraint::PointOnOrigin {
            point: PointRef::control_point("spline:a", 0),
        },
    );
    let solved = EzpzSolver.solve_sketch(&sketch).unwrap();
    assert!(solved.solve.conflicts.is_empty());
    let Geometry::ControlPointSpline(spline) =
        &solved.sketch.geometry[&GeometryId::from("spline:a")].geometry
    else {
        panic!("native spline was replaced");
    };
    assert_eq!(spline.control_points[0], Point2::new(0, 0));
}

#[test]
fn remaining_native_geometry_round_trips_solves_and_preserves_subentity_identity() {
    let mut sketch = Sketch::new("sketch:native-curves");
    for entity in [
        GeometryEntity::new(
            "fit:a",
            Geometry::FitPointSpline(FitPointSpline {
                fit_points: vec![
                    Point2::new(5, 5),
                    Point2::new(10, 20),
                    Point2::new(20, -10),
                    Point2::new(30, 0),
                ],
            }),
        ),
        GeometryEntity::new(
            "ellipse:a",
            Geometry::Ellipse(Ellipse {
                center: Point2::new(50, 50),
                major: Point2::new(70, 50),
                minor: Point2::new(50, 60),
            }),
        ),
        GeometryEntity::new(
            "elliptical-arc:a",
            Geometry::EllipticalArc(EllipticalArc {
                center: Point2::new(80, 50),
                major: Point2::new(100, 50),
                minor: Point2::new(80, 60),
                start: Point2::new(100, 50),
                end: Point2::new(80, 60),
                clockwise: false,
            }),
        ),
        GeometryEntity::new(
            "conic:a",
            Geometry::Conic(Conic {
                start: Point2::new(100, 0),
                control: Point2::new(115, 20),
                end: Point2::new(130, 0),
                weight_millionths: 1_000_000,
            }),
        ),
        GeometryEntity::new("point:a", Geometry::SketchPoint(Point2::new(8, 9))),
    ] {
        sketch = add_geometry(&sketch, entity);
    }
    assert_eq!(
        Decomposition::from_sketch(&sketch)
            .components
            .iter()
            .map(|component| component.variable_count)
            .sum::<u32>(),
        31
    );
    let bytes = sketch.canonical_bytes().unwrap();
    let json = String::from_utf8(bytes.clone()).unwrap();
    for kind in [
        "fit_point_spline",
        "ellipse",
        "elliptical_arc",
        "conic",
        "sketch_point",
    ] {
        assert!(json.contains(kind));
    }
    assert_eq!(Sketch::from_canonical_bytes(&bytes).unwrap(), sketch);
    let profiled = add_geometry(
        &add_geometry(
            &add_geometry(&sketch, line("line:fit-close", (30, 0), (5, 5))),
            line("line:conic-close", (130, 0), (100, 0)),
        ),
        line("line:elliptical-arc-close", (80, 60), (100, 50)),
    );
    let profiles = profiled.profile_report().closed_profiles;
    assert!(profiles.contains(&vec![GeometryId::from("ellipse:a")]));
    assert!(profiles.contains(&vec![
        GeometryId::from("fit:a"),
        GeometryId::from("line:fit-close")
    ]));
    assert!(profiles.contains(&vec![
        GeometryId::from("conic:a"),
        GeometryId::from("line:conic-close")
    ]));
    assert!(profiles.contains(&vec![
        GeometryId::from("elliptical-arc:a"),
        GeometryId::from("line:elliptical-arc-close")
    ]));

    sketch = add_constraint(
        &sketch,
        "constraint:fit-origin",
        Constraint::PointOnOrigin {
            point: PointRef::fit_point("fit:a", 0),
        },
    );
    sketch = add_constraint(
        &sketch,
        "constraint:point-origin",
        Constraint::PointOnOrigin {
            point: PointRef::new("point:a", Anchor::Position),
        },
    );
    let solved = EzpzSolver.solve_sketch(&sketch).unwrap();
    assert!(solved.solve.conflicts.is_empty());
    assert!(
        matches!(&solved.sketch.geometry[&GeometryId::from("fit:a")].geometry, Geometry::FitPointSpline(value) if value.fit_points[0] == Point2::new(0, 0))
    );
    assert!(
        matches!(&solved.sketch.geometry[&GeometryId::from("point:a")].geometry, Geometry::SketchPoint(value) if *value == Point2::new(0, 0))
    );

    let edited = solved
        .sketch
        .apply(SketchCommand::MovePoint {
            point: PointRef::new("ellipse:a", Anchor::Major),
            to: Point2::new(75, 50),
        })
        .unwrap()
        .after
        .apply(SketchCommand::SetConicWeight {
            geometry: GeometryId::from("conic:a"),
            weight_millionths: 707_107,
        })
        .unwrap()
        .after;
    assert!(
        matches!(&edited.geometry[&GeometryId::from("ellipse:a")].geometry, Geometry::Ellipse(value) if value.major == Point2::new(75, 50))
    );
    assert!(
        matches!(&edited.geometry[&GeometryId::from("conic:a")].geometry, Geometry::Conic(value) if value.weight_millionths == 707_107)
    );
    assert!(
        serde_json::to_string(&PointRef::fit_point("fit:a", 2))
            .unwrap()
            .contains("fit:2")
    );
    assert!(
        serde_json::to_string(&PointRef::new("ellipse:a", Anchor::Major))
            .unwrap()
            .contains("major")
    );
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
                first_parameter_millionths: None,
                second_parameter_millionths: None,
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
                a: a_start.clone(),
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
        (
            "c:point-on-origin",
            Constraint::PointOnOrigin { point: a_start },
        ),
        (
            "c:fixed",
            Constraint::Fixed {
                point: PointRef::new("line:b", Anchor::End),
                x_nm: 10,
                y_nm: 10,
            },
        ),
        (
            "c:midpoint",
            Constraint::Midpoint {
                point: PointRef::new("line:b", Anchor::Start),
                line: "line:a".into(),
            },
        ),
        (
            "c:concentric",
            Constraint::Concentric {
                first: "circle:a".into(),
                second: "arc:a".into(),
            },
        ),
        (
            "c:point-on-object",
            Constraint::PointOnObject {
                point: PointRef::new("line:b", Anchor::End),
                geometry: "line:a".into(),
            },
        ),
    ];
    for (id, constraint) in constraints {
        sketch = add_constraint(&sketch, id, constraint);
    }
    sketch
}

#[test]
fn point_on_origin_projects_and_permanently_holds_a_sketch_anchor_at_zero() {
    let mut sketch = add_geometry(
        &Sketch::new("sketch:origin-reference"),
        line("line:a", (25, -40), (100, 70)),
    );
    sketch = add_constraint(
        &sketch,
        "constraint:origin",
        Constraint::PointOnOrigin {
            point: PointRef::new("line:a", Anchor::Start),
        },
    );

    let solved = EzpzSolver.solve_sketch(&sketch).unwrap();
    let Geometry::Line(line) = &solved.sketch.geometry[&GeometryId::from("line:a")].geometry else {
        panic!("expected line")
    };
    assert_eq!(line.start, Point2::new(0, 0));
    assert!(
        solved
            .solve
            .active_constraints
            .contains(&ConstraintId::from("constraint:origin"))
    );
    assert_eq!(
        Decomposition::from_sketch(&sketch).components[0].equation_count,
        2
    );
}

#[test]
fn first_class_point_and_round_constraints_are_solved_by_ezpz() {
    let solver = EzpzSolver;

    let mut fixed = add_geometry(
        &Sketch::new("sketch:fixed"),
        line("line:a", (3, 4), (20, 7)),
    );
    fixed = add_constraint(
        &fixed,
        "c:fixed",
        Constraint::Fixed {
            point: PointRef::new("line:a", Anchor::Start),
            x_nm: 3,
            y_nm: 4,
        },
    );
    let fixed = solver.solve_sketch(&fixed).unwrap();
    let Geometry::Line(fixed_line) = &fixed.sketch.geometry[&GeometryId::from("line:a")].geometry
    else {
        panic!("line")
    };
    assert_eq!(fixed_line.start, Point2::new(3, 4));

    let mut midpoint = Sketch::new("sketch:midpoint");
    midpoint = add_geometry(&midpoint, line("line:datum", (0, 0), (20, 0)));
    midpoint = add_geometry(&midpoint, line("line:moving", (4, 9), (30, 14)));
    midpoint = add_constraint(
        &midpoint,
        "c:midpoint",
        Constraint::Midpoint {
            point: PointRef::new("line:moving", Anchor::Start),
            line: "line:datum".into(),
        },
    );
    let midpoint = solver.solve_sketch(&midpoint).unwrap();
    let Geometry::Line(midpoint_line) =
        &midpoint.sketch.geometry[&GeometryId::from("line:moving")].geometry
    else {
        panic!("line")
    };
    assert_eq!(midpoint_line.start, Point2::new(10, 0));

    let mut origin_midpoint = Sketch::new("sketch:origin-midpoint");
    origin_midpoint = add_geometry(&origin_midpoint, line("line:centered", (-4, 2), (10, 8)));
    origin_midpoint = add_constraint(
        &origin_midpoint,
        "c:origin-midpoint",
        Constraint::Midpoint {
            point: PointRef::origin(),
            line: "line:centered".into(),
        },
    );
    let origin_midpoint = solver.solve_sketch(&origin_midpoint).unwrap();
    let Geometry::Line(centered) =
        &origin_midpoint.sketch.geometry[&GeometryId::from("line:centered")].geometry
    else {
        panic!("line")
    };
    assert_eq!(centered.start.x_nm + centered.end.x_nm, 0);
    assert_eq!(centered.start.y_nm + centered.end.y_nm, 0);

    let mut origin_on_line = Sketch::new("sketch:origin-on-line");
    origin_on_line = add_geometry(
        &origin_on_line,
        line("line:through-origin", (-8, 6), (12, 6)),
    );
    origin_on_line = add_constraint(
        &origin_on_line,
        "c:origin-on-line",
        Constraint::PointOnObject {
            point: PointRef::origin(),
            geometry: "line:through-origin".into(),
        },
    );
    let origin_on_line = solver.solve_sketch(&origin_on_line).unwrap();
    let Geometry::Line(through_origin) =
        &origin_on_line.sketch.geometry[&GeometryId::from("line:through-origin")].geometry
    else {
        panic!("line")
    };
    assert_eq!(through_origin.start.y_nm, 0);
    assert_eq!(through_origin.end.y_nm, 0);

    let mut point_on = Sketch::new("sketch:point-on-object");
    point_on = add_geometry(&point_on, line("line:datum", (0, 0), (20, 0)));
    point_on = add_geometry(&point_on, line("line:moving", (4, 9), (30, 14)));
    point_on = add_constraint(
        &point_on,
        "c:on",
        Constraint::PointOnObject {
            point: PointRef::new("line:moving", Anchor::Start),
            geometry: "line:datum".into(),
        },
    );
    let point_on = solver.solve_sketch(&point_on).unwrap();
    let Geometry::Line(point_on_line) =
        &point_on.sketch.geometry[&GeometryId::from("line:moving")].geometry
    else {
        panic!("line")
    };
    assert_eq!(point_on_line.start.y_nm, 0);

    let mut concentric = Sketch::new("sketch:concentric");
    concentric = add_geometry(
        &concentric,
        GeometryEntity::new(
            "circle:a",
            Geometry::Circle(Circle {
                center: Point2::new(0, 0),
                radius_nm: 10,
            }),
        ),
    );
    concentric = add_geometry(
        &concentric,
        GeometryEntity::new(
            "circle:b",
            Geometry::Circle(Circle {
                center: Point2::new(20, 30),
                radius_nm: 5,
            }),
        ),
    );
    concentric = add_constraint(
        &concentric,
        "c:concentric",
        Constraint::Concentric {
            first: "circle:a".into(),
            second: "circle:b".into(),
        },
    );
    let concentric = solver.solve_sketch(&concentric).unwrap();
    let Geometry::Circle(first) =
        &concentric.sketch.geometry[&GeometryId::from("circle:a")].geometry
    else {
        panic!("circle")
    };
    let Geometry::Circle(second) =
        &concentric.sketch.geometry[&GeometryId::from("circle:b")].geometry
    else {
        panic!("circle")
    };
    assert_eq!(first.center, second.center);
}

#[test]
fn implied_origin_midpoint_is_redundant_instead_of_overconstraining_a_centered_construction_line() {
    let solver = EzpzSolver;
    let mut sketch = Sketch::new("sketch:centered-construction-line");
    sketch = add_geometry(&sketch, line("line:center", (-10, 0), (10, 0)));
    sketch.geometry.insert(
        "point:center".into(),
        GeometryEntity::new("point:center", Geometry::SketchPoint(Point2::new(0, 0))),
    );
    for (id, constraint) in [
        (
            "c:center-point-midpoint",
            Constraint::Midpoint {
                point: PointRef::new("point:center", Anchor::Position),
                line: "line:center".into(),
            },
        ),
        (
            "c:center-point-origin",
            Constraint::PointOnOrigin {
                point: PointRef::new("point:center", Anchor::Position),
            },
        ),
        (
            "c:horizontal",
            Constraint::Horizontal {
                line: "line:center".into(),
            },
        ),
        (
            "c:length",
            Constraint::Distance {
                a: PointRef::new("line:center", Anchor::Start),
                b: PointRef::new("line:center", Anchor::End),
                distance_nm: 20,
            },
        ),
    ] {
        sketch = add_constraint(&sketch, id, constraint);
    }
    assert_eq!(
        solver.solve(&sketch).unwrap().state,
        SolveState::FullyConstrained
    );

    sketch = add_constraint(
        &sketch,
        "c:origin-midpoint",
        Constraint::Midpoint {
            point: PointRef::origin(),
            line: "line:center".into(),
        },
    );
    let result = solver.solve_sketch(&sketch).unwrap();
    assert_eq!(result.solve.state, SolveState::FullyConstrained);
    assert!(result.solve.conflicts.is_empty());
    assert_eq!(
        result.solve.redundant_constraints,
        vec![ConstraintId::from("c:origin-midpoint")]
    );
    let Geometry::Line(centered) =
        &result.sketch.geometry[&GeometryId::from("line:center")].geometry
    else {
        panic!("expected construction line")
    };
    assert_eq!(centered.start.x_nm + centered.end.x_nm, 0);
    assert_eq!(centered.start.y_nm + centered.end.y_nm, 0);
}

fn origin_midpoint_fixture(id: &str, construction: bool) -> Sketch {
    let mut center_line = line("line:center", (-10, 0), (10, 0));
    center_line.construction = construction;
    let mut sketch = add_geometry(&Sketch::new(id), center_line);
    sketch.geometry.insert(
        "point:center".into(),
        GeometryEntity::new("point:center", Geometry::SketchPoint(Point2::new(0, 0))),
    );
    for (id, constraint) in [
        (
            "c:point-midpoint",
            Constraint::Midpoint {
                point: PointRef::new("point:center", Anchor::Position),
                line: "line:center".into(),
            },
        ),
        (
            "c:horizontal",
            Constraint::Horizontal {
                line: "line:center".into(),
            },
        ),
        (
            "c:length",
            Constraint::Distance {
                a: PointRef::new("line:center", Anchor::Start),
                b: PointRef::new("line:center", Anchor::End),
                distance_nm: 20,
            },
        ),
    ] {
        sketch = add_constraint(&sketch, id, constraint);
    }
    sketch
}

#[test]
fn origin_midpoint_semantic_redundancy_flows_through_fixed_and_coincident_points() {
    let center = PointRef::new("point:center", Anchor::Position);
    for (case, construction, mut sketch) in [
        (
            "fixed-zero",
            false,
            add_constraint(
                &origin_midpoint_fixture("sketch:fixed-zero", false),
                "z:origin-hold",
                Constraint::Fixed {
                    point: center.clone(),
                    x_nm: 0,
                    y_nm: 0,
                },
            ),
        ),
        ("coincident-chain", true, {
            let mut sketch = origin_midpoint_fixture("sketch:coincident-chain", true);
            for point in ["point:bridge-a", "point:bridge-b"] {
                sketch.geometry.insert(
                    point.into(),
                    GeometryEntity::new(point, Geometry::SketchPoint(Point2::new(0, 0))),
                );
            }
            for (id, constraint) in [
                (
                    "z:coincident-a",
                    Constraint::Coincident {
                        a: center.clone(),
                        b: PointRef::new("point:bridge-a", Anchor::Position),
                    },
                ),
                (
                    "z:coincident-b",
                    Constraint::Coincident {
                        a: PointRef::new("point:bridge-a", Anchor::Position),
                        b: PointRef::new("point:bridge-b", Anchor::Position),
                    },
                ),
                (
                    "z:origin-hold",
                    Constraint::PointOnOrigin {
                        point: PointRef::new("point:bridge-b", Anchor::Position),
                    },
                ),
            ] {
                sketch = add_constraint(&sketch, id, constraint);
            }
            sketch
        }),
    ] {
        sketch = add_constraint(
            &sketch,
            "a:direct-origin-midpoint",
            Constraint::Midpoint {
                point: PointRef::origin(),
                line: "line:center".into(),
            },
        );
        let result = EzpzSolver.solve(&sketch).unwrap();
        assert_eq!(
            result.state,
            SolveState::FullyConstrained,
            "{case} (construction={construction})"
        );
        assert!(result.conflicts.is_empty(), "{case}");
        assert!(
            result
                .redundant_constraints
                .contains(&ConstraintId::from("a:direct-origin-midpoint")),
            "{case}"
        );
        assert!(
            !result
                .active_constraints
                .contains(&ConstraintId::from("a:direct-origin-midpoint")),
            "{case}"
        );
    }
}

#[test]
fn suppressed_or_unrelated_constraints_do_not_create_origin_midpoint_redundancy() {
    for (case, suppressed_id) in [
        ("suppressed-origin", "c:origin-hold"),
        ("suppressed-point-midpoint", "c:point-midpoint"),
    ] {
        let mut sketch = origin_midpoint_fixture(&format!("sketch:{case}"), true);
        sketch = add_constraint(
            &sketch,
            "c:origin-hold",
            Constraint::PointOnOrigin {
                point: PointRef::new("point:center", Anchor::Position),
            },
        );
        sketch.suppressed_constraints.insert(suppressed_id.into());
        sketch = add_constraint(
            &sketch,
            "c:direct-origin-midpoint",
            Constraint::Midpoint {
                point: PointRef::origin(),
                line: "line:center".into(),
            },
        );
        let result = EzpzSolver.solve(&sketch).unwrap();
        assert!(
            result
                .active_constraints
                .contains(&ConstraintId::from("c:direct-origin-midpoint")),
            "{case}"
        );
        assert!(
            !result
                .redundant_constraints
                .contains(&ConstraintId::from("c:direct-origin-midpoint")),
            "{case}"
        );
        assert_ne!(result.state, SolveState::OverConstrained, "{case}");
    }

    let mut unrelated = origin_midpoint_fixture("sketch:unrelated-line", false);
    unrelated = add_geometry(&unrelated, line("line:other", (-4, 7), (4, 7)));
    unrelated = add_constraint(
        &unrelated,
        "c:center-origin",
        Constraint::PointOnOrigin {
            point: PointRef::new("point:center", Anchor::Position),
        },
    );
    unrelated = add_constraint(
        &unrelated,
        "c:other-origin-midpoint",
        Constraint::Midpoint {
            point: PointRef::origin(),
            line: "line:other".into(),
        },
    );
    let result = EzpzSolver.solve(&unrelated).unwrap();
    assert!(
        result
            .active_constraints
            .contains(&"c:other-origin-midpoint".into())
    );
    assert!(
        !result
            .redundant_constraints
            .contains(&"c:other-origin-midpoint".into())
    );
    assert_eq!(result.state, SolveState::UnderConstrained);
}

#[test]
fn origin_midpoint_redundancy_does_not_hide_a_real_geometric_conflict() {
    let mut sketch = origin_midpoint_fixture("sketch:true-conflict", true);
    sketch = add_constraint(
        &sketch,
        "c:origin-hold",
        Constraint::PointOnOrigin {
            point: PointRef::new("point:center", Anchor::Position),
        },
    );
    sketch = add_constraint(
        &sketch,
        "c:direct-origin-midpoint",
        Constraint::Midpoint {
            point: PointRef::origin(),
            line: "line:center".into(),
        },
    );
    sketch = add_constraint(
        &sketch,
        "c:vertical",
        Constraint::Vertical {
            line: "line:center".into(),
        },
    );
    let result = EzpzSolver.solve(&sketch).unwrap();
    assert_eq!(result.state, SolveState::Conflicting);
    assert!(
        result
            .redundant_constraints
            .contains(&"c:direct-origin-midpoint".into())
    );
    assert!(result.conflicts.iter().any(|conflict| matches!(
        conflict.reason,
        ConflictReason::HorizontalAndVertical { .. }
    )));
}

#[test]
fn solver_contract_distinguishes_all_four_states_and_reports_minimal_conflicts() {
    let solver = EzpzSolver;
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
    let solver = EzpzSolver;
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
    let solver = EzpzSolver;
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
    let solver = EzpzSolver;
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
                first_parameter_millionths: None,
                second_parameter_millionths: None,
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
                first_parameter_millionths: None,
                second_parameter_millionths: None,
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
fn tangent_to_arc_projects_a_contact_inside_the_bounded_sweep() {
    let solver = EzpzSolver;
    let mut sketch = Sketch::new("sketch:arc-domain-tangent");
    sketch = add_geometry(&sketch, line("line:outside", (-10, -20), (-10, 20)));
    sketch = add_geometry(
        &sketch,
        GeometryEntity::new(
            "arc:quarter",
            Geometry::Arc(Arc {
                center: Point2::new(0, 0),
                start: Point2::new(10, 0),
                end: Point2::new(0, 10),
                clockwise: false,
            }),
        ),
    );
    sketch = add_constraint(
        &sketch,
        "constraint:tangent-outside",
        Constraint::Tangent {
            first: "line:outside".into(),
            second: "arc:quarter".into(),
            first_parameter_millionths: None,
            second_parameter_millionths: None,
        },
    );

    let solved = solver.solve_sketch(&sketch).unwrap();
    assert_ne!(solved.solve.state, SolveState::Conflicting);
    assert!(solved.solve.conflicts.is_empty());
    assert!(solver.solve(&solved.sketch).unwrap().conflicts.is_empty());
}

#[test]
fn retained_line_arc_tangent_parameters_survive_recompute_and_reload() {
    let solver = EzpzSolver;
    let mut sketch = Sketch::new("sketch:retained-line-arc-contact");
    sketch = add_geometry(&sketch, line("line", (-20, 0), (20, 0)));
    sketch = add_geometry(
        &sketch,
        GeometryEntity::new(
            "arc",
            Geometry::Arc(Arc {
                center: Point2::new(0, 20),
                start: Point2::new(-10, 20),
                end: Point2::new(10, 20),
                clockwise: true,
            }),
        ),
    );
    sketch = add_constraint(
        &sketch,
        "tangent:retained",
        Constraint::Tangent {
            first: "line".into(),
            second: "arc".into(),
            first_parameter_millionths: Some(250_000),
            second_parameter_millionths: Some(0),
        },
    );
    sketch = solver.solve_sketch(&sketch).unwrap().sketch;
    let expected = evaluate_curve(&sketch.geometry[&GeometryId::from("line")].geometry, 0.25);
    assert_eq!(
        evaluate_curve(&sketch.geometry[&GeometryId::from("arc")].geometry, 0.0),
        expected
    );

    let reloaded = Sketch::from_canonical_bytes(&sketch.canonical_bytes().unwrap()).unwrap();
    let solved = solver.solve_sketch(&reloaded).unwrap().sketch;
    assert_eq!(
        evaluate_curve(&solved.geometry[&GeometryId::from("arc")].geometry, 0.0),
        evaluate_curve(&solved.geometry[&GeometryId::from("line")].geometry, 0.25)
    );
    assert!(matches!(
        solved.constraints[&ConstraintId::from("tangent:retained")],
        Constraint::Tangent {
            first_parameter_millionths: Some(250_000),
            second_parameter_millionths: Some(0),
            ..
        }
    ));
}

#[test]
fn tangency_covers_internal_round_and_general_native_curve_pairs() {
    let solver = EzpzSolver;
    let mut internal = Sketch::new("sketch:internal-tangent");
    internal = add_geometry(
        &internal,
        GeometryEntity::new(
            "outer",
            Geometry::Circle(Circle {
                center: Point2::new(0, 0),
                radius_nm: 10,
            }),
        ),
    );
    internal = add_geometry(
        &internal,
        GeometryEntity::new(
            "inner",
            Geometry::Circle(Circle {
                center: Point2::new(6, 0),
                radius_nm: 3,
            }),
        ),
    );
    internal = add_constraint(
        &internal,
        "tangent",
        Constraint::Tangent {
            first: "outer".into(),
            second: "inner".into(),
            first_parameter_millionths: None,
            second_parameter_millionths: None,
        },
    );
    let solved = solver.solve_sketch(&internal).unwrap();
    assert_ne!(solved.solve.state, SolveState::Conflicting);
    let Geometry::Circle(outer) = &solved.sketch.geometry[&GeometryId::from("outer")].geometry
    else {
        panic!("circle")
    };
    let Geometry::Circle(inner) = &solved.sketch.geometry[&GeometryId::from("inner")].geometry
    else {
        panic!("circle")
    };
    assert!((distance_for_test(outer.center, inner.center) - 7.0).abs() <= 1.0);

    let native_pairs = [
        (
            Geometry::Line(Line {
                start: Point2::new(-20, 0),
                end: Point2::new(20, 0),
            }),
            Geometry::Arc(Arc {
                center: Point2::new(0, 12),
                start: Point2::new(8, 12),
                end: Point2::new(0, 20),
                clockwise: false,
            }),
        ),
        (
            Geometry::ControlPointSpline(ControlPointSpline {
                degree: 3,
                knots_millionths: vec![],
                control_points: vec![
                    Point2::new(0, 0),
                    Point2::new(10, 10),
                    Point2::new(20, 10),
                    Point2::new(30, 0),
                ],
            }),
            Geometry::Conic(Conic {
                start: Point2::new(28, 4),
                control: Point2::new(40, -10),
                end: Point2::new(55, 0),
                weight_millionths: 800_000,
            }),
        ),
        (
            Geometry::Ellipse(Ellipse {
                center: Point2::new(0, 0),
                major: Point2::new(20, 0),
                minor: Point2::new(0, 10),
            }),
            Geometry::FitPointSpline(FitPointSpline {
                fit_points: vec![
                    Point2::new(18, 2),
                    Point2::new(25, 5),
                    Point2::new(30, 0),
                    Point2::new(35, -4),
                ],
            }),
        ),
    ];
    for (index, (first, second)) in native_pairs.into_iter().enumerate() {
        let mut sketch = Sketch::new(format!("sketch:native-tangent:{index}"));
        sketch = add_geometry(&sketch, GeometryEntity::new("first", first));
        sketch = add_geometry(&sketch, GeometryEntity::new("second", second));
        sketch = add_constraint(
            &sketch,
            "tangent",
            Constraint::Tangent {
                first: "first".into(),
                second: "second".into(),
                first_parameter_millionths: None,
                second_parameter_millionths: None,
            },
        );
        let solved = solver.solve_sketch(&sketch).unwrap();
        assert_ne!(solved.solve.state, SolveState::Conflicting, "pair {index}");
    }
}

#[test]
fn open_uniform_b_spline_knots_split_natively_and_offset_intent_recomputes() {
    let spline = Geometry::ControlPointSpline(ControlPointSpline {
        degree: 3,
        control_points: vec![
            Point2::new(0, 0),
            Point2::new(10_000, 20_000),
            Point2::new(20_000, -10_000),
            Point2::new(30_000, 20_000),
            Point2::new(40_000, 0),
        ],
        knots_millionths: vec![
            0, 0, 0, 0, 500_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000,
        ],
    });
    let at_knot = evaluate_curve(&spline, 0.5);
    let pieces = split_curve(&spline, &[0.5]);
    assert_eq!(pieces.len(), 2);
    assert!(
        pieces
            .iter()
            .all(|piece| matches!(piece, Geometry::ControlPointSpline(_)))
    );
    assert_eq!(evaluate_curve(&pieces[0], 1.0), at_knot);
    assert_eq!(evaluate_curve(&pieces[1], 0.0), at_knot);

    let browser_scale_spline = Geometry::ControlPointSpline(ControlPointSpline {
        degree: 3,
        knots_millionths: vec![0, 0, 0, 0, 1_000_000, 1_000_000, 1_000_000, 1_000_000],
        control_points: vec![
            Point2::new(-80_000_000, -20_000_000),
            Point2::new(-40_000_000, 30_000_000),
            Point2::new(0, -20_000_000),
            Point2::new(40_000_000, 0),
        ],
    });
    assert!(matches!(
        offset_curve_with_intervals(&spline, 2_500),
        Err(OffsetCurveError::OffsetToleranceUnattainable { .. })
    ));
    let certified = offset_curve_with_intervals(&browser_scale_spline, 2_500).unwrap();
    assert!(certified.iter().all(|piece| {
        piece.certified && piece.error_bound_nm <= OFFSET_MODEL_TOLERANCE_NM as f64
    }));

    let mut sketch = Sketch::new("sketch:offset-intent");
    sketch = add_geometry(&sketch, line("source", (0, 0), (100, 0)));
    sketch = add_geometry(&sketch, line("offset", (0, 25), (100, 25)));
    sketch = add_constraint(
        &sketch,
        "offset-distance",
        Constraint::OffsetDistance {
            source: "source".into(),
            offset: "offset".into(),
            distance_nm: 25,
            source_start_millionths: 0,
            source_end_millionths: 1_000_000,
        },
    );
    sketch.dimension_parameters.insert(
        ConstraintId::from("offset-distance"),
        "parameter:offset".to_owned(),
    );
    sketch
        .geometry
        .get_mut(&GeometryId::from("source"))
        .unwrap()
        .geometry = Geometry::Line(Line {
        start: Point2::new(20, 10),
        end: Point2::new(120, 10),
    });
    let solved = EzpzSolver.solve_sketch(&sketch).unwrap();
    let Geometry::Line(offset) = &solved.sketch.geometry[&GeometryId::from("offset")].geometry
    else {
        panic!("line")
    };
    assert_eq!(offset.start, Point2::new(20, 35));
    assert_eq!(offset.end, Point2::new(120, 35));
    let bytes = solved.sketch.canonical_bytes().unwrap();
    let reloaded = Sketch::from_canonical_bytes(&bytes).unwrap();
    assert_eq!(
        reloaded.dimension_parameters[&ConstraintId::from("offset-distance")],
        "parameter:offset"
    );
}

fn distance_for_test(a: Point2, b: Point2) -> f64 {
    ((a.x_nm - b.x_nm) as f64).hypot((a.y_nm - b.y_nm) as f64)
}

#[test]
fn solved_geometry_is_stable_across_recompute_and_canonical_reload() {
    let solver = EzpzSolver;
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
    let solver = EzpzSolver;
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
    let solver = EzpzSolver;
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
fn closed_rectangles_accept_oppositely_directed_parallel_edges() {
    let mut sketch = Sketch::new("sketch:antiparallel-rectangle");
    for (id, start, end) in [
        ("bottom", (0, 0), (40, 0)),
        ("right", (40, 0), (40, 20)),
        ("top", (40, 20), (0, 20)),
        ("left", (0, 20), (0, 0)),
    ] {
        sketch = add_geometry(&sketch, line(id, start, end));
    }
    for (id, first, second) in [
        (
            "join:bottom-right",
            ("bottom", Anchor::End),
            ("right", Anchor::Start),
        ),
        (
            "join:right-top",
            ("right", Anchor::End),
            ("top", Anchor::Start),
        ),
        (
            "join:top-left",
            ("top", Anchor::End),
            ("left", Anchor::Start),
        ),
        (
            "join:left-bottom",
            ("left", Anchor::End),
            ("bottom", Anchor::Start),
        ),
    ] {
        sketch = add_constraint(
            &sketch,
            id,
            Constraint::Coincident {
                a: PointRef::new(first.0, first.1),
                b: PointRef::new(second.0, second.1),
            },
        );
    }
    for (id, constraint) in [
        (
            "parallel:horizontal",
            Constraint::Parallel {
                first: "bottom".into(),
                second: "top".into(),
            },
        ),
        (
            "parallel:vertical",
            Constraint::Parallel {
                first: "right".into(),
                second: "left".into(),
            },
        ),
        (
            "perpendicular",
            Constraint::Perpendicular {
                first: "bottom".into(),
                second: "right".into(),
            },
        ),
    ] {
        sketch = add_constraint(&sketch, id, constraint);
    }

    let solved = EzpzSolver.solve_sketch(&sketch).unwrap();
    assert_ne!(solved.solve.state, SolveState::Conflicting);
    assert!(solved.solve.conflicts.is_empty());
}

#[test]
fn arc_projection_preserves_arbitrary_angle_with_nanometer_grid_tolerance() {
    let solver = EzpzSolver;
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
    let start_radius = ((arc.start.x_nm - arc.center.x_nm) as f64)
        .hypot((arc.start.y_nm - arc.center.y_nm) as f64);
    let end_radius =
        ((arc.end.x_nm - arc.center.x_nm) as f64).hypot((arc.end.y_nm - arc.center.y_nm) as f64);
    assert!((start_radius - end_radius).abs() <= 1.0);
    assert!((start_radius - 10.0).abs() <= 1.0);
}

#[test]
fn reversed_symmetric_constraints_are_deterministically_redundant() {
    let solver = EzpzSolver;
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
    let solver = EzpzSolver;
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

#[test]
fn graph_frontend_solves_disconnected_ezpz_components_and_preserves_contract_ids() {
    let mut sketch = Sketch::new("sketch:decomposed");
    sketch = add_geometry(&sketch, line("line:a", (0, 0), (20, 7)));
    sketch = add_geometry(&sketch, line("line:b", (100, 30), (110, 80)));
    sketch = add_constraint(
        &sketch,
        "constraint:horizontal",
        Constraint::Horizontal {
            line: "line:a".into(),
        },
    );
    sketch = add_constraint(
        &sketch,
        "constraint:vertical",
        Constraint::Vertical {
            line: "line:b".into(),
        },
    );

    let decomposition = Decomposition::from_sketch(&sketch);
    assert_eq!(decomposition.components.len(), 2);
    let solved = EzpzSolver.solve_sketch(&sketch).unwrap();
    let Geometry::Line(a) = &solved.sketch.geometry[&GeometryId::from("line:a")].geometry else {
        panic!("expected line")
    };
    let Geometry::Line(b) = &solved.sketch.geometry[&GeometryId::from("line:b")].geometry else {
        panic!("expected line")
    };
    assert_eq!(a.start.y_nm, a.end.y_nm);
    assert_eq!(b.start.x_nm, b.end.x_nm);
    assert_eq!(
        solved.solve.active_constraints,
        vec!["constraint:horizontal".into(), "constraint:vertical".into(),]
    );
    assert_eq!(EzpzSolver.contract().backend, "kittycad_ezpz");
}

#[test]
fn suppressed_constraints_remain_durable_but_leave_the_ezpz_solve_graph() {
    let mut sketch = add_geometry(
        &Sketch::new("sketch:suppression"),
        line("line:a", (0, 0), (20, 7)),
    );
    sketch = add_constraint(
        &sketch,
        "constraint:horizontal",
        Constraint::Horizontal {
            line: "line:a".into(),
        },
    );
    let active = EzpzSolver.solve_sketch(&sketch).unwrap();
    let Geometry::Line(active_line) = &active.sketch.geometry[&GeometryId::from("line:a")].geometry
    else {
        panic!("expected line")
    };
    assert_eq!(active_line.start.y_nm, active_line.end.y_nm);

    let suppressed = sketch
        .apply(SketchCommand::SetConstraintSuppressed {
            constraint: "constraint:horizontal".into(),
            suppressed: true,
        })
        .unwrap()
        .after;
    assert!(
        suppressed
            .suppressed_constraints
            .contains(&"constraint:horizontal".into())
    );
    let solved = EzpzSolver.solve_sketch(&suppressed).unwrap();
    assert!(solved.solve.active_constraints.is_empty());
    assert_eq!(solved.sketch.geometry, suppressed.geometry);

    let enabled = suppressed
        .apply(SketchCommand::SetConstraintSuppressed {
            constraint: "constraint:horizontal".into(),
            suppressed: false,
        })
        .unwrap()
        .after;
    assert!(enabled.suppressed_constraints.is_empty());
    assert!(
        EzpzSolver
            .solve_sketch(&enabled)
            .unwrap()
            .solve
            .active_constraints
            .contains(&"constraint:horizontal".into())
    );
}
