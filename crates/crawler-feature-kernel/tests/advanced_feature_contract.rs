use monstertruck_meshing::prelude::*;
use monstertruck_modeling::{Point3, Solid, Vector3, builder};

use crawler_feature_kernel::*;

const TOLERANCE_NM: i64 = 50_000;

fn box_snapshot(body_id: &str, origin: [f64; 3], size: f64) -> BodySnapshot {
    let vertex = builder::vertex(Point3::new(origin[0], origin[1], origin[2]));
    let edge = builder::extrude(&vertex, Vector3::unit_x() * size);
    let face = builder::extrude(&edge, Vector3::unit_y() * size);
    let mut solid: Solid = builder::extrude(&face, Vector3::unit_z() * size);
    solid.ensure_topology_stable_ids();
    let volume = solid.triangulation(0.05).to_polygon().volume().abs();
    BodySnapshot {
        body_id: body_id.to_owned(),
        solid_json: serde_json::to_vec(&solid).unwrap(),
        evidence: GeometryEvidence {
            vertex_count: solid.vertex_iter().count(),
            edge_count: solid.edge_iter().count(),
            face_count: solid.face_iter().count(),
            bounds_nm: AxisAlignedBoundsNm {
                min: origin.map(|value| (value * 1_000_000.0).round() as i64),
                max: origin.map(|value| ((value + size) * 1_000_000.0).round() as i64),
            },
            volume_model_units3: volume,
            deterministic_digest: "fixture".to_owned(),
        },
    }
}

fn request(operation: FeatureOperation) -> FeatureRequest {
    FeatureRequest {
        schema_version: FEATURE_KERNEL_SCHEMA_VERSION,
        document_id: "document-advanced".to_owned(),
        feature_id: "feature-advanced".to_owned(),
        output_body_id: "body-output".to_owned(),
        operation,
    }
}

fn body_source(body: BodySnapshot) -> TransformSource {
    TransformSource::Body { body }
}

#[test]
fn closed_planar_profile_extrudes_to_a_durable_solid() {
    let result = execute(&request(FeatureOperation::Extrude(ExtrudeInput {
        profiles_nm: vec![vec![
            [0, 0, 0],
            [20_000_000, 0, 0],
            [20_000_000, 10_000_000, 0],
            [0, 10_000_000, 0],
        ]],
        direction_nm: [0, 0, 5_000_000],
        tolerance_nm: TOLERANCE_NM,
    })))
    .unwrap();

    assert_eq!(result.output.evidence.face_count, 6);
    assert_eq!(result.output.evidence.bounds_nm.min, [0, 0, 0]);
    assert_eq!(
        result.output.evidence.bounds_nm.max,
        [20_000_000, 10_000_000, 5_000_000]
    );
    assert!((result.output.evidence.volume_model_units3 - 1_000.0).abs() < 1.0e-6);
    assert!(result.ordered_input_body_ids.is_empty());
}

#[test]
fn arbitrary_world_axis_revolves_the_caller_polygon_deterministically() {
    let request = request(FeatureOperation::ProfileRevolve(ProfileRevolveInput {
        profile_nm: vec![
            [0, 0, 1_000_000],
            [2_000_000, 2_000_000, 1_000_000],
            [2_000_000, 2_000_000, 2_000_000],
            [0, 0, 2_000_000],
        ],
        axis_origin_nm: [0, 0, 0],
        axis_direction_nm: [1_000_000, 1_000_000, 0],
        sweep_microdegrees: 360_000_000,
        divisions: 16,
        tolerance_nm: 1_000,
    }));
    let first = execute(&request).unwrap();
    let second = execute(&request).unwrap();

    assert_eq!(first, second);
    assert!(first.ordered_input_body_ids.is_empty());
    assert!(first.output.evidence.face_count >= 4);
    let expected = std::f64::consts::PI * 3.0 * 8.0_f64.sqrt();
    assert!(
        (first.output.evidence.volume_model_units3 - expected).abs() < 0.1,
        "actual={} expected={expected}",
        first.output.evidence.volume_model_units3
    );
}

#[test]
fn loft_preserves_all_unequal_polygon_corners_across_three_sections() {
    let result = execute(&request(FeatureOperation::Loft(LoftInput {
        profiles_nm: vec![
            vec![[0, 0, 0], [4_000_000, 0, 0], [2_000_000, 4_000_000, 0]],
            vec![
                [0, 0, 2_000_000],
                [4_000_000, 0, 2_000_000],
                [4_000_000, 4_000_000, 2_000_000],
                [0, 4_000_000, 2_000_000],
            ],
            vec![
                [1_000_000, 1_000_000, 4_000_000],
                [3_000_000, 1_000_000, 4_000_000],
                [3_000_000, 3_000_000, 4_000_000],
                [1_000_000, 3_000_000, 4_000_000],
            ],
        ],
        tolerance_nm: TOLERANCE_NM,
    })))
    .unwrap();

    assert_eq!(result.output.evidence.bounds_nm.min, [0, 0, 0]);
    assert_eq!(result.output.evidence.bounds_nm.max, [4_000_000; 3]);
    assert!(result.output.evidence.face_count > 10);
    assert!(result.output.evidence.volume_model_units3 > 20.0);
}

#[test]
fn polygon_sweep_follows_a_bent_monotone_polyline_as_one_closed_solid() {
    let request = request(FeatureOperation::Sweep(SweepInput {
        profile_nm: vec![
            [0, 0, 0],
            [2_000_000, 0, 0],
            [2_000_000, 2_000_000, 0],
            [0, 2_000_000, 0],
        ],
        path_nm: vec![
            [0, 0, 0],
            [1_000_000, 0, 2_000_000],
            [1_000_000, 1_000_000, 4_000_000],
        ],
        tolerance_nm: TOLERANCE_NM,
    }));
    let first = execute(&request).unwrap();
    let second = execute(&request).unwrap();

    assert_eq!(first, second);
    assert_eq!(first.output.evidence.bounds_nm.min, [0, 0, 0]);
    assert_eq!(
        first.output.evidence.bounds_nm.max,
        [3_000_000, 3_000_000, 4_000_000]
    );
    assert_eq!(first.output.evidence.face_count, 10);
    assert!((first.output.evidence.volume_model_units3 - 16.0).abs() < 1.0e-8);
}

#[test]
fn sweep_refuses_a_reversing_or_tangent_path() {
    for path_nm in [
        vec![[0, 0, 0], [0, 0, 2_000_000], [0, 0, 1_000_000]],
        vec![[0, 0, 0], [1_000_000, 0, 0]],
    ] {
        let error = execute(&request(FeatureOperation::Sweep(SweepInput {
            profile_nm: vec![[0, 0, 0], [1_000_000, 0, 0], [0, 1_000_000, 0]],
            path_nm,
            tolerance_nm: TOLERANCE_NM,
        })))
        .unwrap_err();
        assert_eq!(error.category, ErrorCategory::InvalidInput);
        assert_eq!(error.field.as_deref(), Some("path_nm"));
    }
}

fn face_on_principal_plane(body: &BodySnapshot, axis: usize, coordinate: f64) -> u64 {
    let solid: Solid = serde_json::from_slice(&body.solid_json).unwrap();
    solid
        .face_iter()
        .find(|face| {
            face.vertex_iter()
                .all(|vertex| (vertex.point()[axis] - coordinate).abs() < 1.0e-9)
        })
        .unwrap()
        .stable_id()
        .raw()
}

#[test]
fn draft_tapers_selected_stable_prism_faces_about_a_neutral_plane() {
    let body = box_snapshot("draft-source", [0.0, 0.0, 0.0], 2.0);
    let positive_x = face_on_principal_plane(&body, 0, 2.0);
    let request = request(FeatureOperation::Draft(DraftInput {
        target: body.clone(),
        face_stable_ids: vec![positive_x],
        pull_direction: PrincipalAxis::Z,
        neutral_plane_origin_nm: [0, 0, 0],
        angle_microdegrees: 45_000_000,
        tolerance_nm: 1_000,
    }));
    let first = execute(&request).unwrap();
    let second = execute(&request).unwrap();

    assert_eq!(first, second);
    assert_eq!(first.ordered_input_body_ids, ["draft-source"]);
    assert_eq!(first.output.evidence.bounds_nm.min, [0, 0, 0]);
    assert_eq!(
        first.output.evidence.bounds_nm.max,
        [4_000_000, 2_000_000, 2_000_000]
    );
    assert!(
        (first.output.evidence.volume_model_units3 - 12.0).abs() < 1.0e-8,
        "actual={}",
        first.output.evidence.volume_model_units3
    );
}

#[test]
fn draft_refuses_end_faces_and_preserves_the_target_byte_for_byte() {
    let body = box_snapshot("draft-source", [0.0, 0.0, 0.0], 2.0);
    let positive_z = face_on_principal_plane(&body, 2, 2.0);
    let error = execute(&request(FeatureOperation::Draft(DraftInput {
        target: body.clone(),
        face_stable_ids: vec![positive_z],
        pull_direction: PrincipalAxis::Z,
        neutral_plane_origin_nm: [0, 0, 0],
        angle_microdegrees: 5_000_000,
        tolerance_nm: TOLERANCE_NM,
    })))
    .unwrap_err();

    assert_eq!(error.category, ErrorCategory::InvalidInput);
    assert_eq!(error.preserved_inputs, [body]);
    assert_eq!(
        error.problematic_reference.unwrap().stable_id,
        positive_z.to_string()
    );
}

#[test]
fn durable_extrude_cut_subtracts_a_through_profile_and_keeps_target_identity() {
    let body = box_snapshot("cut-target", [0.0, 0.0, 0.0], 4.0);
    let result = execute(&request(FeatureOperation::ExtrudeCut(ExtrudeCutInput {
        target: body,
        profiles_nm: vec![vec![
            [1_000_000, 1_000_000, -1_000_000],
            [3_000_000, 1_000_000, -1_000_000],
            [3_000_000, 3_000_000, -1_000_000],
            [1_000_000, 3_000_000, -1_000_000],
        ]],
        direction_nm: [0, 0, 6_000_000],
        tolerance_nm: TOLERANCE_NM,
    })))
    .unwrap();

    assert_eq!(result.ordered_input_body_ids, ["cut-target"]);
    assert_eq!(result.output.evidence.bounds_nm.min, [0, 0, 0]);
    assert_eq!(result.output.evidence.bounds_nm.max, [4_000_000; 3]);
    assert!((result.output.evidence.volume_model_units3 - 48.0).abs() < 1.0e-8);
}

fn through_revolve_cut(
    body: BodySnapshot,
    inner_radius_nm: i64,
    outer_radius_nm: i64,
    sweep_microdegrees: i64,
    divisions: u32,
) -> FeatureRequest {
    request(FeatureOperation::RevolveCut(RevolveCutInput {
        target: body,
        profile_nm: vec![
            [2_000_000 + inner_radius_nm, 2_000_000, -1_000_000],
            [2_000_000 + outer_radius_nm, 2_000_000, -1_000_000],
            [2_000_000 + outer_radius_nm, 2_000_000, 5_000_000],
            [2_000_000 + inner_radius_nm, 2_000_000, 5_000_000],
        ],
        axis_origin_nm: [2_000_000, 2_000_000, 0],
        axis_direction_nm: [0, 0, 1_000_000],
        sweep_microdegrees,
        divisions,
        tolerance_nm: 10_000,
    }))
}

#[test]
fn durable_revolve_cut_builds_a_full_cylindrical_through_hole() {
    let body = box_snapshot("revolve-cut-target", [0.0, 0.0, 0.0], 4.0);
    let request = through_revolve_cut(body, 0, 1_000_000, 360_000_000, 24);
    let first = execute(&request).unwrap();
    let second = execute(&request).unwrap();

    assert_eq!(first, second);
    assert_eq!(first.ordered_input_body_ids, ["revolve-cut-target"]);
    assert_eq!(first.output.evidence.bounds_nm.min, [0, 0, 0]);
    assert_eq!(first.output.evidence.bounds_nm.max, [4_000_000; 3]);
    let expected = 64.0 - std::f64::consts::PI * 4.0;
    assert!((first.output.evidence.volume_model_units3 - expected).abs() < 0.1);
    let solid: Solid = serde_json::from_slice(&first.output.solid_json).unwrap();
    assert_eq!(solid.boundaries().len(), 1);
    assert!(first.output.evidence.face_count >= 8);
}

#[test]
fn durable_revolve_cut_builds_a_full_annular_through_cut_and_retains_the_core() {
    let body = box_snapshot("annular-revolve-cut-target", [0.0, 0.0, 0.0], 4.0);
    let request = through_revolve_cut(body, 500_000, 1_000_000, 360_000_000, 24);
    let first = execute(&request).unwrap();
    let second = execute(&request).unwrap();

    assert_eq!(first, second);
    assert_eq!(first.ordered_input_body_ids, ["annular-revolve-cut-target"]);
    assert_eq!(first.output.evidence.bounds_nm.min, [0, 0, 0]);
    assert_eq!(first.output.evidence.bounds_nm.max, [4_000_000; 3]);
    let expected = 64.0 - std::f64::consts::PI * 3.0;
    assert!((first.output.evidence.volume_model_units3 - expected).abs() < 0.1);
    let solid: Solid = serde_json::from_slice(&first.output.solid_json).unwrap();
    assert_eq!(solid.boundaries().len(), 2);
}

#[test]
fn durable_revolve_cut_builds_a_partial_annular_through_cut_at_requested_divisions() {
    let body = box_snapshot("partial-revolve-cut-target", [0.0, 0.0, 0.0], 4.0);
    let request = through_revolve_cut(body, 500_000, 1_000_000, 90_000_000, 6);
    let first = execute(&request).unwrap();
    let second = execute(&request).unwrap();

    assert_eq!(first, second);
    assert_eq!(first.ordered_input_body_ids, ["partial-revolve-cut-target"]);
    let expected = 64.0 - std::f64::consts::PI * (1.0 - 0.25);
    assert!((first.output.evidence.volume_model_units3 - expected).abs() < 0.1);
    // Six outer and six inner arc edges become twelve curved side faces;
    // radial closures add two more cut faces and the six box faces remain.
    assert!(first.output.evidence.face_count >= 20);
}

#[test]
fn durable_revolve_cut_builds_a_full_outer_radial_cut_as_the_exact_inner_core() {
    let body = box_snapshot("outer-revolve-cut-target", [0.0, 0.0, 0.0], 4.0);
    let request = through_revolve_cut(body, 1_000_000, 4_000_000, 360_000_000, 24);
    let result = execute(&request).unwrap();

    assert_eq!(result.ordered_input_body_ids, ["outer-revolve-cut-target"]);
    assert_eq!(
        result.output.evidence.bounds_nm.min,
        [1_000_000, 1_000_000, 0]
    );
    assert_eq!(
        result.output.evidence.bounds_nm.max,
        [3_000_000, 3_000_000, 4_000_000]
    );
    assert!((result.output.evidence.volume_model_units3 - std::f64::consts::PI * 4.0).abs() < 0.1);
}

#[test]
fn revolve_cut_clips_a_full_inscribed_core_at_prism_clearance() {
    let body = box_snapshot("inscribed-revolve-cut-target", [0.0, 0.0, 0.0], 4.0);
    let request = through_revolve_cut(body, 2_000_000, 5_000_000, 360_000_000, 32);
    let first = execute(&request).unwrap();
    let second = execute(&request).unwrap();

    assert_eq!(first, second);
    assert_eq!(
        first.ordered_input_body_ids,
        ["inscribed-revolve-cut-target"]
    );
    assert_eq!(first.output.evidence.bounds_nm.min, [0, 0, 0]);
    assert_eq!(first.output.evidence.bounds_nm.max, [4_000_000; 3]);
    let expected = 256.0 * (std::f64::consts::PI / 16.0).sin();
    assert!(
        (first.output.evidence.volume_model_units3 - expected).abs() < 1.0e-5,
        "actual={}, expected={expected}",
        first.output.evidence.volume_model_units3
    );
    assert_eq!(first.output.evidence.face_count, 34);
}

#[test]
fn revolve_cut_clips_a_quarter_sector_crossing_the_prism_sides() {
    let body = box_snapshot("quarter-sector-cut-target", [0.0, 0.0, 0.0], 4.0);
    let request = through_revolve_cut(body, 2_000_000, 5_000_000, 90_000_000, 8);
    let first = execute(&request).unwrap();
    let second = execute(&request).unwrap();

    assert_eq!(first, second);
    assert_eq!(first.ordered_input_body_ids, ["quarter-sector-cut-target"]);
    assert_eq!(first.output.evidence.bounds_nm.min, [0, 0, 0]);
    assert_eq!(first.output.evidence.bounds_nm.max, [4_000_000; 3]);
    let expected = 48.0 + 64.0 * (std::f64::consts::PI / 16.0).sin();
    assert!(
        (first.output.evidence.volume_model_units3 - expected).abs() < 1.0e-5,
        "actual={}, expected={expected}",
        first.output.evidence.volume_model_units3
    );
    assert_eq!(first.output.evidence.face_count, 16);
}

#[test]
fn revolve_cut_outside_every_prism_corner_is_a_successful_no_op() {
    let body = box_snapshot("outside-sector-cut-target", [0.0, 0.0, 0.0], 4.0);
    let request = through_revolve_cut(body, 3_000_000, 5_000_000, 180_000_000, 16);
    let first = execute(&request).unwrap();
    let second = execute(&request).unwrap();

    assert_eq!(first, second);
    assert_eq!(first.ordered_input_body_ids, ["outside-sector-cut-target"]);
    assert_eq!(first.output.evidence.bounds_nm.min, [0, 0, 0]);
    assert_eq!(first.output.evidence.bounds_nm.max, [4_000_000; 3]);
    assert!((first.output.evidence.volume_model_units3 - 64.0).abs() < 1.0e-9);
    assert_eq!(first.output.evidence.face_count, 6);
}

#[test]
fn rejected_revolve_cut_preserves_only_the_durable_target() {
    let body = box_snapshot("revolve-cut-target", [0.0, 0.0, 0.0], 4.0);
    let error = execute(&request(FeatureOperation::RevolveCut(RevolveCutInput {
        target: body.clone(),
        profile_nm: vec![[0, 0, 0], [1_000_000, 0, 0], [0, 1_000_000, 0]],
        axis_origin_nm: [0, 0, 0],
        axis_direction_nm: [0, 0, 0],
        sweep_microdegrees: 360_000_000,
        divisions: 16,
        tolerance_nm: 1,
    })))
    .unwrap_err();

    assert_eq!(error.category, ErrorCategory::InvalidInput);
    assert_eq!(error.preserved_inputs, [body]);
}

#[test]
fn mirror_is_a_native_body_transform_with_deterministic_evidence() {
    let operation = FeatureOperation::Mirror(MirrorInput {
        source: body_source(box_snapshot("source", [1.0, 0.0, 0.0], 1.0)),
        plane_origin_nm: [0, 0, 0],
        plane_normal: PrincipalAxis::X,
        tolerance_nm: TOLERANCE_NM,
    });
    let request = request(operation);
    let first = execute(&request).unwrap();
    let second = execute(&request).unwrap();

    assert_eq!(first.ordered_input_body_ids, ["source"]);
    assert!(first.instance_body_ids.is_empty());
    assert_eq!(first.output.evidence, second.output.evidence);
    assert_eq!(
        first.output.evidence.bounds_nm,
        AxisAlignedBoundsNm {
            min: [-2_000_000, 0, 0],
            max: [-1_000_000, 1_000_000, 1_000_000],
        }
    );
    assert!((first.output.evidence.volume_model_units3 - 1.0).abs() < 1.0e-9);
}

#[test]
fn transform_translates_one_body_exactly_and_preserves_topology_identity() {
    let source = box_snapshot("translate-source", [1.0, 2.0, 3.0], 1.0);
    let source_solid: Solid = serde_json::from_slice(&source.solid_json).unwrap();
    let source_faces = source_solid
        .face_iter()
        .map(|face| face.stable_id().raw())
        .collect::<Vec<_>>();
    let request = request(FeatureOperation::Transform(TransformInput {
        source: body_source(source),
        translation_nm: [-2_000_000, 4_000_000, 500_000],
        tolerance_nm: TOLERANCE_NM,
    }));
    let first = execute(&request).unwrap();
    let second = execute(&request).unwrap();

    assert_eq!(first, second);
    assert_eq!(first.ordered_input_body_ids, ["translate-source"]);
    assert!(first.instance_body_ids.is_empty());
    assert_eq!(first.output.body_id, "body-output");
    assert_eq!(
        first.output.evidence.bounds_nm,
        AxisAlignedBoundsNm {
            min: [-1_000_000, 6_000_000, 3_500_000],
            max: [0, 7_000_000, 4_500_000],
        }
    );
    assert!((first.output.evidence.volume_model_units3 - 1.0).abs() < 1.0e-9);
    let translated: Solid = serde_json::from_slice(&first.output.solid_json).unwrap();
    assert_eq!(
        translated
            .face_iter()
            .map(|face| face.stable_id().raw())
            .collect::<Vec<_>>(),
        source_faces
    );
}

#[test]
fn transform_rejects_identity_and_feature_sequence_substitution() {
    let body = box_snapshot("resolved", [0.0, 0.0, 0.0], 1.0);
    let identity = request(FeatureOperation::Transform(TransformInput {
        source: body_source(body.clone()),
        translation_nm: [0, 0, 0],
        tolerance_nm: TOLERANCE_NM,
    }));
    let error = execute(&identity).unwrap_err();
    assert_eq!(error.category, ErrorCategory::InvalidInput);
    assert_eq!(error.field.as_deref(), Some("translation_nm"));

    let sequence = request(FeatureOperation::Transform(TransformInput {
        source: TransformSource::FeatureSequence {
            ordered_feature_ids: vec!["feature-a".into(), "feature-b".into()],
            resolved_body: body.clone(),
        },
        translation_nm: [1_000_000, 0, 0],
        tolerance_nm: TOLERANCE_NM,
    }));
    let error = execute(&sequence).unwrap_err();
    assert_eq!(error.category, ErrorCategory::Unsupported);
    assert_eq!(error.preserved_inputs, [body]);
    assert_eq!(error.problematic_reference.unwrap().stable_id, "feature-a");
}

#[test]
fn linear_and_circular_patterns_preserve_instance_identity_order() {
    let linear = request(FeatureOperation::LinearPattern(LinearPatternInput {
        source: body_source(box_snapshot("linear-source", [0.0, 0.0, 0.0], 1.0)),
        instance_body_ids: vec!["linear-0".into(), "linear-1".into(), "linear-2".into()],
        step_nm: [2_000_000, 0, 0],
        tolerance_nm: TOLERANCE_NM,
    }));
    let result = execute(&linear).unwrap();
    assert_eq!(
        result.instance_body_ids,
        ["linear-0", "linear-1", "linear-2"]
    );
    assert_eq!(result.output.evidence.bounds_nm.min, [0, 0, 0]);
    assert_eq!(
        result.output.evidence.bounds_nm.max,
        [5_000_000, 1_000_000, 1_000_000]
    );
    assert!((result.output.evidence.volume_model_units3 - 3.0).abs() < 1.0e-9);

    let circular = request(FeatureOperation::CircularPattern(CircularPatternInput {
        source: body_source(box_snapshot("circular-source", [2.0, 0.0, 0.0], 1.0)),
        instance_body_ids: vec![
            "circle-0".into(),
            "circle-1".into(),
            "circle-2".into(),
            "circle-3".into(),
        ],
        axis_origin_nm: [0, 0, 0],
        axis: PrincipalAxis::Z,
        step_microdegrees: 90_000_000,
        tolerance_nm: TOLERANCE_NM,
    }));
    let result = execute(&circular).unwrap();
    assert_eq!(
        result.instance_body_ids,
        ["circle-0", "circle-1", "circle-2", "circle-3"]
    );
    assert_eq!(
        result.output.evidence.bounds_nm.min,
        [-3_000_000, -3_000_000, 0]
    );
    assert_eq!(
        result.output.evidence.bounds_nm.max,
        [3_000_000, 3_000_000, 1_000_000]
    );
    assert!((result.output.evidence.volume_model_units3 - 4.0).abs() < 1.0e-9);
}

#[test]
fn feature_sequence_transform_refuses_without_substituting_body_semantics() {
    let body = box_snapshot("resolved", [0.0, 0.0, 0.0], 1.0);
    let request = request(FeatureOperation::Mirror(MirrorInput {
        source: TransformSource::FeatureSequence {
            ordered_feature_ids: vec!["feature-a".into(), "feature-b".into()],
            resolved_body: body.clone(),
        },
        plane_origin_nm: [0, 0, 0],
        plane_normal: PrincipalAxis::X,
        tolerance_nm: TOLERANCE_NM,
    }));
    let error = execute(&request).unwrap_err();

    assert_eq!(error.category, ErrorCategory::Unsupported);
    assert_eq!(error.preserved_inputs, [body]);
    assert_eq!(error.problematic_reference.unwrap().stable_id, "feature-a");
}

#[test]
fn shell_builds_an_exact_closed_prismatic_cavity_from_each_stable_outer_face() {
    let body = box_snapshot("shell-source", [0.0, 0.0, 0.0], 1.0);
    let solid: Solid = serde_json::from_slice(&body.solid_json).unwrap();
    let face_ids = solid
        .face_iter()
        .map(|face| face.stable_id().raw())
        .collect::<Vec<_>>();
    assert_eq!(face_ids.len(), 6);
    for face_id in face_ids {
        let request = request(FeatureOperation::Shell(ShellInput {
            target: body.clone(),
            removed_face_stable_ids: vec![face_id],
            wall_thickness_nm: 100_000,
            tolerance_nm: TOLERANCE_NM,
        }));
        let first = execute(&request).unwrap();
        let second = execute(&request).unwrap();

        assert_eq!(first, second);
        assert_eq!(first.ordered_input_body_ids, ["shell-source"]);
        assert_eq!(first.output.evidence.bounds_nm.min, [0, 0, 0]);
        assert_eq!(first.output.evidence.bounds_nm.max, [1_000_000; 3]);
        assert_eq!(first.output.evidence.face_count, 14);
        assert!((first.output.evidence.volume_model_units3 - 0.424).abs() < 1.0e-12);
        let result: Solid = serde_json::from_slice(&first.output.solid_json).unwrap();
        assert_eq!(result.boundaries().len(), 1);
        assert_eq!(result.face_iter().count(), 14);
    }
}

#[test]
fn shell_rejects_a_missing_face_without_mutating_the_exact_input() {
    let body = box_snapshot("shell-source", [0.0, 0.0, 0.0], 1.0);
    let face_id = u64::MAX;
    let request = request(FeatureOperation::Shell(ShellInput {
        target: body.clone(),
        removed_face_stable_ids: vec![face_id],
        wall_thickness_nm: 100_000,
        tolerance_nm: TOLERANCE_NM,
    }));
    let error = execute(&request).unwrap_err();

    assert_eq!(error.category, ErrorCategory::InvalidInput);
    assert_eq!(error.preserved_inputs, [body]);
    let reference = error.problematic_reference.unwrap();
    assert_eq!(reference.kind, ReferenceKind::Face);
    assert_eq!(reference.stable_id, face_id.to_string());
}

#[test]
fn fillet_and_chamfer_use_stable_edge_references_or_fail_closed() {
    for (name, wrap) in [
        (
            "fillet",
            FeatureOperation::Fillet as fn(EdgeTreatmentInput) -> FeatureOperation,
        ),
        (
            "chamfer",
            FeatureOperation::Chamfer as fn(EdgeTreatmentInput) -> FeatureOperation,
        ),
    ] {
        let body = box_snapshot(&format!("{name}-source"), [0.0, 0.0, 0.0], 1.0);
        let solid: Solid = serde_json::from_slice(&body.solid_json).unwrap();
        let edge_id = solid.edge_iter().next().unwrap().stable_id().raw();
        let request = request(wrap(EdgeTreatmentInput {
            target: body.clone(),
            edge_stable_ids: vec![edge_id],
            radius_nm: 100_000,
            divisions: 5,
            tolerance_nm: TOLERANCE_NM,
        }));
        let first = execute(&request).unwrap_or_else(|error| panic!("{name}: {error:?}"));
        let second = execute(&request).unwrap_or_else(|error| panic!("{name}: {error:?}"));
        assert_eq!(first, second, "{name} must be deterministic");
        assert_eq!(first.ordered_input_body_ids, [body.body_id.as_str()]);
        assert!(first.output.evidence.volume_model_units3 > 0.0);
        assert_ne!(first.output.solid_json, body.solid_json);
    }
}

#[test]
fn missing_edge_reference_reports_context_without_mutating_the_body() {
    let body = box_snapshot("edge-source", [0.0, 0.0, 0.0], 1.0);
    let request = request(FeatureOperation::Fillet(EdgeTreatmentInput {
        target: body.clone(),
        edge_stable_ids: vec![u64::MAX],
        radius_nm: 100_000,
        divisions: 5,
        tolerance_nm: TOLERANCE_NM,
    }));
    let error = execute(&request).unwrap_err();

    assert_eq!(error.category, ErrorCategory::InvalidInput);
    assert_eq!(error.preserved_inputs, [body]);
    let reference = error.problematic_reference.unwrap();
    assert_eq!(reference.kind, ReferenceKind::Edge);
    assert_eq!(reference.stable_id, u64::MAX.to_string());
    assert_eq!(reference.ordered_index, Some(0));
}

#[test]
fn rejected_edge_geometry_preserves_input_with_problematic_reference() {
    let body = box_snapshot("edge-failure-source", [0.0, 0.0, 0.0], 1.0);
    let solid: Solid = serde_json::from_slice(&body.solid_json).unwrap();
    let edge_id = solid.edge_iter().next().unwrap().stable_id().raw();
    let request = request(FeatureOperation::Fillet(EdgeTreatmentInput {
        target: body.clone(),
        edge_stable_ids: vec![edge_id],
        radius_nm: 10_000_000,
        divisions: 5,
        tolerance_nm: TOLERANCE_NM,
    }));
    let error = execute(&request).unwrap_err();

    assert_eq!(error.category, ErrorCategory::Unsupported);
    assert_eq!(error.preserved_inputs, [body]);
    let reference = error.problematic_reference.unwrap();
    assert_eq!(reference.kind, ReferenceKind::Edge);
    assert_eq!(reference.stable_id, edge_id.to_string());
    assert_eq!(reference.ordered_index, Some(0));
}

#[test]
fn advanced_contracts_round_trip_and_validate_exact_counts_and_angles() {
    let mut request = request(FeatureOperation::CircularPattern(CircularPatternInput {
        source: body_source(box_snapshot("source", [1.0, 0.0, 0.0], 1.0)),
        instance_body_ids: vec!["instance-0".into(), "instance-1".into()],
        axis_origin_nm: [0, 0, 0],
        axis: PrincipalAxis::Z,
        step_microdegrees: 180_000_000,
        tolerance_nm: TOLERANCE_NM,
    }));
    let json = serde_json::to_vec(&request).unwrap();
    assert_eq!(
        serde_json::from_slice::<FeatureRequest>(&json).unwrap(),
        request
    );

    if let FeatureOperation::CircularPattern(input) = &mut request.operation {
        input.instance_body_ids.pop();
    }
    let error = execute(&request).unwrap_err();
    assert_eq!(error.category, ErrorCategory::InvalidInput);
    assert_eq!(error.field.as_deref(), Some("instance_body_ids"));

    if let FeatureOperation::CircularPattern(input) = &mut request.operation {
        input.instance_body_ids.push("instance-1".into());
        input.step_microdegrees = 0;
    }
    let error = execute(&request).unwrap_err();
    assert_eq!(error.category, ErrorCategory::InvalidInput);
    assert_eq!(error.field.as_deref(), Some("step_microdegrees"));
}
