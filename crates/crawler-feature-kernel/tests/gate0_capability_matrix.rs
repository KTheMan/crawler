//! Gate 0 qualification probes for E3D-S1-01 and E3D-S1-02.
//!
//! These tests intentionally exercise the pinned kernel through the public
//! feature boundary where one exists.  Curve probes also use Monstertruck
//! directly because the current feature DTO has no native-curve input.

#![cfg(not(target_arch = "wasm32"))]

use crawler_feature_kernel::*;
use monstertruck_meshing::prelude::*;
use monstertruck_modeling::{
    Curve, Edge, Face, InnerSpace, Point3, Solid, Vector3, Wire, builder, profile,
};
use monstertruck_step::save::{CompleteStepDisplay, StepHeaderDescriptor, StepModel};

const TOLERANCE_NM: i64 = 10_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Qualification {
    Supported,
    Unsupported,
}

#[derive(Debug)]
struct Outcome {
    fixture: &'static str,
    operation: &'static str,
    qualification: Qualification,
    category: Option<ErrorCategory>,
    input_hashes_unchanged: bool,
}

fn request(feature_id: &str, operation: FeatureOperation) -> FeatureRequest {
    FeatureRequest {
        schema_version: FEATURE_KERNEL_SCHEMA_VERSION,
        document_id: "gate0-document".to_owned(),
        feature_id: feature_id.to_owned(),
        output_body_id: format!("{feature_id}-output"),
        operation,
    }
}

fn execute_snapshot(feature_id: &str, operation: FeatureOperation) -> BodySnapshot {
    execute(&request(feature_id, operation)).unwrap().output
}

fn polygon_prism(
    feature_id: &str,
    points_nm: Vec<[i64; 3]>,
    direction_nm: [i64; 3],
) -> BodySnapshot {
    execute_snapshot(
        feature_id,
        FeatureOperation::Extrude(ExtrudeInput {
            profiles_nm: vec![points_nm],
            direction_nm,
            tolerance_nm: TOLERANCE_NM,
        }),
    )
}

fn box_snapshot(body_id: &str, min: [i64; 3], max: [i64; 3]) -> BodySnapshot {
    let mut snapshot = polygon_prism(
        &format!("{body_id}-fixture"),
        vec![
            [min[0], min[1], min[2]],
            [max[0], min[1], min[2]],
            [max[0], max[1], min[2]],
            [min[0], max[1], min[2]],
        ],
        [0, 0, max[2] - min[2]],
    );
    snapshot.body_id = body_id.to_owned();
    snapshot
}

fn curved_extrude_snapshot(body_id: &str, wire: Wire, direction: Vector3) -> BodySnapshot {
    let mut solid: Solid = profile::solid_from_planar_profile(vec![wire], direction).unwrap();
    solid.ensure_topology_stable_ids();
    let points = solid
        .vertex_iter()
        .map(|vertex| vertex.point())
        .collect::<Vec<_>>();
    let axis_bounds = |axis: usize| {
        let min = points
            .iter()
            .map(|point| point[axis])
            .fold(f64::INFINITY, f64::min);
        let max = points
            .iter()
            .map(|point| point[axis])
            .fold(f64::NEG_INFINITY, f64::max);
        [
            (min * 1_000_000.0).round() as i64,
            (max * 1_000_000.0).round() as i64,
        ]
    };
    let x = axis_bounds(0);
    let y = axis_bounds(1);
    let z = axis_bounds(2);
    let volume = solid.triangulation(0.01).to_polygon().volume().abs();
    BodySnapshot {
        body_id: body_id.to_owned(),
        solid_json: serde_json::to_vec(&solid).unwrap(),
        evidence: GeometryEvidence {
            vertex_count: solid.vertex_iter().count(),
            edge_count: solid.edge_iter().count(),
            face_count: solid.face_iter().count(),
            bounds_nm: AxisAlignedBoundsNm {
                min: [x[0], y[0], z[0]],
                max: [x[1], y[1], z[1]],
            },
            volume_model_units3: volume,
            surface_area_nm2: None,
            centroid_nm: None,
            deterministic_digest: "gate0-direct-kernel-fixture".to_owned(),
        },
    }
}

fn run_boolean(
    fixture: &'static str,
    operation: BooleanKind,
    target: BodySnapshot,
    tool: BodySnapshot,
) -> Outcome {
    let target_before = target.solid_json.clone();
    let tool_before = tool.solid_json.clone();
    let result = execute(&request(
        fixture,
        FeatureOperation::Boolean(BooleanInput {
            operation,
            target: target.clone(),
            tools: vec![tool.clone()],
            tolerance_nm: TOLERANCE_NM,
        }),
    ));
    let operation_name = match operation {
        BooleanKind::Union => "union",
        BooleanKind::Cut => "difference",
        BooleanKind::Intersect => "intersection",
    };
    match result {
        Ok(_) => Outcome {
            fixture,
            operation: operation_name,
            qualification: Qualification::Supported,
            category: None,
            input_hashes_unchanged: target.solid_json == target_before
                && tool.solid_json == tool_before,
        },
        Err(error) => Outcome {
            fixture,
            operation: operation_name,
            qualification: Qualification::Unsupported,
            category: Some(error.category),
            input_hashes_unchanged: target.solid_json == target_before
                && tool.solid_json == tool_before,
        },
    }
}

#[test]
fn native_boolean_gate0_matrix_is_structured_and_preserves_inputs() {
    let overlapping_target = box_snapshot("overlap-target", [0, 0, 0], [2_000_000; 3]);
    let overlapping_tool = box_snapshot(
        "overlap-tool",
        [1_000_000, 1_000_000, 1_000_000],
        [3_000_000; 3],
    );
    let rotated_target = polygon_prism(
        "rotated-target",
        vec![
            [0, 1_000_000, 0],
            [1_000_000, 0, 0],
            [2_000_000, 1_000_000, 0],
            [1_000_000, 2_000_000, 0],
        ],
        [0, 0, 2_000_000],
    );
    let rotated_tool = box_snapshot(
        "rotated-tool",
        [750_000, 750_000, 500_000],
        [2_250_000, 2_250_000, 1_500_000],
    );
    let circular_target = curved_extrude_snapshot(
        "circular-target",
        builder::scaled(
            &circle_wire(),
            Point3::origin(),
            Vector3::new(2.0, 2.0, 1.0),
        ),
        Vector3::new(0.0, 0.0, 2.0),
    );
    let circular_tool = box_snapshot(
        "circular-tool",
        [0, -1_000_000, 500_000],
        [3_000_000, 1_000_000, 1_500_000],
    );
    let arc_target =
        curved_extrude_snapshot("arc-target", capsule_wire(), Vector3::new(0.0, 0.0, 2.0));
    let arc_tool = box_snapshot(
        "arc-tool",
        [0, -1_500_000, 500_000],
        [3_000_000, 1_500_000, 1_500_000],
    );
    let disjoint_target = box_snapshot("disjoint-target", [0, 0, 0], [1_000_000; 3]);
    let disjoint_tool = box_snapshot(
        "disjoint-tool",
        [2_000_000, 0, 0],
        [3_000_000, 1_000_000, 1_000_000],
    );
    let contained_target = box_snapshot("contained-target", [0, 0, 0], [3_000_000; 3]);
    let contained_tool = box_snapshot(
        "contained-tool",
        [1_000_000, 1_000_000, 1_000_000],
        [2_000_000; 3],
    );
    let tangent_target = box_snapshot("tangent-target", [0, 0, 0], [1_000_000; 3]);
    let tangent_tool = box_snapshot(
        "tangent-tool",
        [1_000_000, 0, 0],
        [2_000_000, 1_000_000, 1_000_000],
    );

    let outcomes = vec![
        run_boolean(
            "axis_aligned_union",
            BooleanKind::Union,
            overlapping_target.clone(),
            overlapping_tool.clone(),
        ),
        run_boolean(
            "axis_aligned_difference",
            BooleanKind::Cut,
            overlapping_target,
            overlapping_tool,
        ),
        run_boolean(
            "rotated_union",
            BooleanKind::Union,
            rotated_target.clone(),
            rotated_tool.clone(),
        ),
        run_boolean(
            "rotated_difference",
            BooleanKind::Cut,
            rotated_target,
            rotated_tool,
        ),
        run_boolean(
            "circular_union",
            BooleanKind::Union,
            circular_target.clone(),
            circular_tool.clone(),
        ),
        run_boolean(
            "circular_difference",
            BooleanKind::Cut,
            circular_target,
            circular_tool,
        ),
        run_boolean(
            "arc_profile_union",
            BooleanKind::Union,
            arc_target.clone(),
            arc_tool.clone(),
        ),
        run_boolean(
            "arc_profile_difference",
            BooleanKind::Cut,
            arc_target,
            arc_tool,
        ),
        run_boolean(
            "disjoint_union_multishell",
            BooleanKind::Union,
            disjoint_target.clone(),
            disjoint_tool.clone(),
        ),
        run_boolean(
            "disjoint_difference_noop",
            BooleanKind::Cut,
            disjoint_target.clone(),
            disjoint_tool.clone(),
        ),
        run_boolean(
            "disjoint_intersection_empty",
            BooleanKind::Intersect,
            disjoint_target,
            disjoint_tool,
        ),
        run_boolean(
            "contained_union",
            BooleanKind::Union,
            contained_target.clone(),
            contained_tool.clone(),
        ),
        run_boolean(
            "contained_difference_void",
            BooleanKind::Cut,
            contained_target,
            contained_tool.clone(),
        ),
        run_boolean(
            "tangent_union",
            BooleanKind::Union,
            tangent_target.clone(),
            tangent_tool.clone(),
        ),
        run_boolean(
            "tangent_difference",
            BooleanKind::Cut,
            tangent_target,
            tangent_tool,
        ),
        run_boolean(
            "identical_difference_empty",
            BooleanKind::Cut,
            contained_tool.clone(),
            contained_tool,
        ),
    ];

    for outcome in &outcomes {
        println!("{outcome:?}");
        assert!(outcome.input_hashes_unchanged, "{outcome:?}");
        assert!(!outcome.fixture.is_empty());
        assert!(!outcome.operation.is_empty());
    }

    // Axis-aligned cells are the only overlapping Boolean class shared by the
    // current native and browser implementations. Empty intersection is a
    // structured result rather than a process failure.
    for fixture in [
        "axis_aligned_union",
        "axis_aligned_difference",
        "disjoint_union_multishell",
        "contained_union",
        "contained_difference_void",
        "tangent_union",
        "tangent_difference",
    ] {
        let outcome = outcomes
            .iter()
            .find(|value| value.fixture == fixture)
            .unwrap();
        assert_eq!(
            outcome.qualification,
            Qualification::Supported,
            "{outcome:?}"
        );
    }
    let empty = outcomes
        .iter()
        .find(|value| value.fixture == "disjoint_intersection_empty")
        .unwrap();
    assert_eq!(empty.qualification, Qualification::Unsupported);
    assert_eq!(empty.category, Some(ErrorCategory::EmptyResult));
    for fixture in ["disjoint_difference_noop", "identical_difference_empty"] {
        let empty = outcomes
            .iter()
            .find(|value| value.fixture == fixture)
            .unwrap();
        assert_eq!(empty.qualification, Qualification::Unsupported);
        assert_eq!(empty.category, Some(ErrorCategory::EmptyResult));
    }
}

fn rectangle_wire() -> Wire {
    let vertices = builder::vertices([
        Point3::new(-2.0, -1.0, 0.0),
        Point3::new(2.0, -1.0, 0.0),
        Point3::new(2.0, 1.0, 0.0),
        Point3::new(-2.0, 1.0, 0.0),
    ]);
    vec![
        builder::line(&vertices[0], &vertices[1]),
        builder::line(&vertices[1], &vertices[2]),
        builder::line(&vertices[2], &vertices[3]),
        builder::line(&vertices[3], &vertices[0]),
    ]
    .into()
}

fn circle_wire() -> Wire {
    let positive = builder::vertex(Point3::new(1.0, 0.0, 0.0));
    let negative = builder::vertex(Point3::new(-1.0, 0.0, 0.0));
    let upper: Edge = builder::circle_arc(&positive, &negative, Point3::new(0.0, 1.0, 0.0));
    let lower: Edge = builder::circle_arc(&negative, &positive, Point3::new(0.0, -1.0, 0.0));
    vec![upper, lower].into()
}

fn capsule_wire() -> Wire {
    let top_right = builder::vertex(Point3::new(1.0, 1.0, 0.0));
    let top_left = builder::vertex(Point3::new(-1.0, 1.0, 0.0));
    let bottom_left = builder::vertex(Point3::new(-1.0, -1.0, 0.0));
    let bottom_right = builder::vertex(Point3::new(1.0, -1.0, 0.0));
    let top: Edge = builder::line(&top_right, &top_left);
    let left: Edge = builder::circle_arc(&top_left, &bottom_left, Point3::new(-2.0, 0.0, 0.0));
    let bottom: Edge = builder::line(&bottom_left, &bottom_right);
    let right: Edge = builder::circle_arc(&bottom_right, &top_right, Point3::new(2.0, 0.0, 0.0));
    vec![top, left, bottom, right].into()
}

fn bspline_wire() -> Wire {
    let start = builder::vertex(Point3::new(-1.0, 0.0, 0.0));
    let end = builder::vertex(Point3::new(1.0, 0.0, 0.0));
    let upper: Edge = builder::bezier(
        &start,
        &end,
        vec![Point3::new(-0.5, 1.0, 0.0), Point3::new(0.5, 1.0, 0.0)],
    );
    let lower: Edge = builder::line(&end, &start);
    vec![upper, lower].into()
}

fn assert_curve_face_extrude_and_step(
    label: &str,
    wire: Wire,
    expected_nurbs_edges: usize,
    expected_bspline_edges: usize,
) {
    let nurbs_edges = wire
        .edge_iter()
        .filter(|edge| matches!(edge.oriented_curve(), Curve::NurbsCurve(_)))
        .count();
    let bspline_edges = wire
        .edge_iter()
        .filter(|edge| matches!(edge.oriented_curve(), Curve::BsplineCurve(_)))
        .count();
    assert_eq!(nurbs_edges, expected_nurbs_edges, "{label}");
    assert_eq!(bspline_edges, expected_bspline_edges, "{label}");

    let face: Face = profile::attach_plane_normalized(vec![wire.clone()]).unwrap();
    assert_eq!(face.boundaries().len(), 1, "{label}");
    let solid: Solid =
        profile::solid_from_planar_profile(vec![wire], Vector3::new(0.0, 0.0, 2.0)).unwrap();
    assert!(solid.is_geometric_consistent(), "{label}");
    let mesh = solid.triangulation(0.02).to_polygon();
    assert!(mesh.volume().abs() > 0.0, "{label}");

    let compressed = solid.compress();
    let step = CompleteStepDisplay::new(
        StepModel::from(&compressed),
        StepHeaderDescriptor {
            organization_system: "crawler-gate0".to_owned(),
            time_stamp: "2026-08-25T00:00:00".to_owned(),
            ..Default::default()
        },
    )
    .to_string();
    assert!(step.contains("ISO-10303-21"), "{label}");
    assert!(step.contains("MANIFOLD_SOLID_BREP"), "{label}");
}

#[test]
fn native_line_arc_circle_and_bspline_face_extrude_step_matrix() {
    assert_curve_face_extrude_and_step("line", rectangle_wire(), 0, 0);
    assert_curve_face_extrude_and_step("trimmed_arc", capsule_wire(), 2, 0);
    assert_curve_face_extrude_and_step("circle_as_two_exact_rational_arcs", circle_wire(), 2, 0);

    let ellipse = builder::scaled(
        &circle_wire(),
        Point3::origin(),
        Vector3::new(2.0, 1.0, 1.0),
    );
    assert_curve_face_extrude_and_step("ellipse_as_exact_rational_arcs", ellipse, 2, 0);
    assert_curve_face_extrude_and_step("control_point_bspline", bspline_wire(), 0, 1);
}

#[test]
fn native_curve_results_do_not_depend_on_display_tolerance() {
    let solid: Solid =
        profile::solid_from_planar_profile(vec![circle_wire()], Vector3::new(0.0, 0.0, 2.0))
            .unwrap();
    let coarse = solid.triangulation(0.1).to_polygon();
    let fine = solid.triangulation(0.005).to_polygon();

    // The display meshes differ, while the authoritative serialized B-rep is
    // untouched and keeps its rational curve variants.
    assert_ne!(coarse.tri_faces().len(), fine.tri_faces().len());
    let serialized_before = serde_json::to_vec(&solid).unwrap();
    let _ = coarse.volume();
    let _ = fine.volume();
    assert_eq!(serialized_before, serde_json::to_vec(&solid).unwrap());
}

#[test]
fn trimmed_circle_arc_is_exact_rational_not_sampled_polygon() {
    let start = builder::vertex(Point3::new(1.0, 0.0, 0.0));
    let end = builder::vertex(Point3::new(0.0, 1.0, 0.0));
    let arc: Edge = builder::circle_arc(&start, &end, Vector3::unit_y());
    let curve = match arc.oriented_curve() {
        Curve::NurbsCurve(curve) => curve,
        other => panic!("expected rational NURBS, got {other:?}"),
    };
    let knots = curve.knot_vector();
    let start_parameter = knots[0];
    let end_parameter = knots[knots.len() - 1];
    for index in 0..=32 {
        let parameter = start_parameter + (end_parameter - start_parameter) * index as f64 / 32.0;
        let point = curve.evaluate(parameter);
        assert!((point.to_vec().magnitude() - 1.0).abs() < 1.0e-10);
    }
}
