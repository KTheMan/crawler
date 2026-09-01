use crawler_feature_kernel::*;

const NM: i64 = 1_000_000;
const TOLERANCE_NM: i64 = 10_000;

fn line(start_nm: [i64; 3], end_nm: [i64; 3]) -> NativeCurveV2 {
    NativeCurveV2::Line { start_nm, end_nm }
}

fn rectangle(min: [i64; 2], max: [i64; 2]) -> NativeCurveLoopV2 {
    let a = [min[0], min[1], 0];
    let b = [max[0], min[1], 0];
    let c = [max[0], max[1], 0];
    let d = [min[0], max[1], 0];
    NativeCurveLoopV2 {
        curves: vec![line(a, b), line(b, c), line(c, d), line(d, a)],
    }
}

fn circle(center_nm: [i64; 3], radius_nm: i64) -> NativeCurveLoopV2 {
    NativeCurveLoopV2 {
        curves: vec![NativeCurveV2::Circle {
            center_nm,
            radius_point_nm: [center_nm[0] + radius_nm, center_nm[1], center_nm[2]],
            transit_point_nm: [center_nm[0], center_nm[1] + radius_nm, center_nm[2]],
        }],
    }
}

fn request(region: NativeProfileRegionV2, height_nm: i64) -> FeatureRequest {
    FeatureRequest {
        schema_version: FEATURE_KERNEL_SCHEMA_VERSION,
        document_id: "document-native-extrude".to_owned(),
        feature_id: "feature-native-extrude".to_owned(),
        output_body_id: "body-native-extrude".to_owned(),
        operation: FeatureOperation::NativeExtrudeV2(NativeExtrudeInputV2 {
            region,
            direction_nm: [0, 0, height_nm],
            tolerance_nm: TOLERANCE_NM,
        }),
    }
}

fn target_box() -> BodySnapshot {
    let mut target = request(
        NativeProfileRegionV2 {
            outer: rectangle([-10 * NM, -10 * NM], [10 * NM, 10 * NM]),
            holes: vec![],
        },
        10 * NM,
    );
    target.output_body_id = "body-cut-target".into();
    execute(&target).unwrap().output
}

fn cut_request(
    target: BodySnapshot,
    region: NativeProfileRegionV2,
    direction_nm: [i64; 3],
) -> FeatureRequest {
    FeatureRequest {
        schema_version: FEATURE_KERNEL_SCHEMA_VERSION,
        document_id: "document-native-cut".into(),
        feature_id: "feature-native-cut".into(),
        output_body_id: target.body_id.clone(),
        operation: FeatureOperation::NativeExtrudeCutV2(NativeExtrudeCutInputV2 {
            target,
            region,
            direction_nm,
            tolerance_nm: TOLERANCE_NM,
        }),
    }
}

#[test]
fn exact_rectangle_extrudes_with_expected_bounds_and_volume() {
    let result = execute(&request(
        NativeProfileRegionV2 {
            outer: rectangle([-2 * NM, -NM], [2 * NM, NM]),
            holes: vec![],
        },
        3 * NM,
    ))
    .unwrap();

    assert_eq!(result.schema_version, 2);
    assert_eq!(result.output.evidence.face_count, 6);
    assert_eq!(
        result.output.evidence.bounds_nm,
        AxisAlignedBoundsNm {
            min: [-2 * NM, -NM, 0],
            max: [2 * NM, NM, 3 * NM],
        }
    );
    assert!((result.output.evidence.volume_model_units3 - 24.0).abs() < 1.0e-8);
    assert_eq!(
        result.output.evidence.surface_area_nm2,
        Some(52_000_000_000_000.0)
    );
    assert_eq!(
        result.output.evidence.centroid_nm,
        Some([0.0, 0.0, 1_500_000.0])
    );
}

#[test]
fn exact_circular_arcs_extrude_without_polygonizing_the_profile() {
    // A 4 x 2 capsule: two exact semicircles joined by exact lines.
    let top_right = [NM, NM, 0];
    let top_left = [-NM, NM, 0];
    let bottom_left = [-NM, -NM, 0];
    let bottom_right = [NM, -NM, 0];
    let capsule = NativeCurveLoopV2 {
        curves: vec![
            line(top_right, top_left),
            NativeCurveV2::CircularArc {
                start_nm: top_left,
                end_nm: bottom_left,
                transit_nm: [-2 * NM, 0, 0],
            },
            line(bottom_left, bottom_right),
            NativeCurveV2::CircularArc {
                start_nm: bottom_right,
                end_nm: top_right,
                transit_nm: [2 * NM, 0, 0],
            },
        ],
    };
    let request = request(
        NativeProfileRegionV2 {
            outer: capsule,
            holes: vec![],
        },
        2 * NM,
    );
    let result = execute(&request).unwrap();

    assert_eq!(result.output.evidence.bounds_nm.min, [-2 * NM, -NM, 0]);
    assert_eq!(result.output.evidence.bounds_nm.max, [2 * NM, NM, 2 * NM]);
    let expected = (4.0 + std::f64::consts::PI) * 2.0;
    assert!((result.output.evidence.volume_model_units3 - expected).abs() < 0.05);

    // Four source curves produce four lateral faces. A sampled polygon would
    // introduce additional edges and faces into the authoritative B-rep.
    assert_eq!(result.output.evidence.face_count, 6);
    let body_json = String::from_utf8(result.output.solid_json).unwrap();
    assert!(body_json.contains("NurbsCurve"));
}

#[test]
fn exact_circle_with_circle_hole_preserves_void() {
    let result = execute(&request(
        NativeProfileRegionV2 {
            outer: circle([0, 0, 0], 5 * NM),
            holes: vec![circle([0, 0, 0], 2 * NM)],
        },
        3 * NM,
    ))
    .unwrap();

    assert_eq!(result.output.evidence.bounds_nm.min, [-5 * NM, -5 * NM, 0]);
    assert_eq!(
        result.output.evidence.bounds_nm.max,
        [5 * NM, 5 * NM, 3 * NM]
    );
    let expected = std::f64::consts::PI * (25.0 - 4.0) * 3.0;
    assert!(
        (result.output.evidence.volume_model_units3 - expected).abs() < 0.5,
        "actual={}, expected={expected}",
        result.output.evidence.volume_model_units3
    );
    assert_eq!(result.output.evidence.face_count, 6);
    let expected_surface = 2.0 * std::f64::consts::PI * (25.0 - 4.0) * 1.0e12
        + std::f64::consts::TAU * (5.0 + 2.0) * 3.0e12;
    assert!((result.output.evidence.surface_area_nm2.unwrap() - expected_surface).abs() < 1.0);
    assert_eq!(
        result.output.evidence.centroid_nm,
        Some([0.0, 0.0, 1_500_000.0])
    );
}

#[test]
fn disconnected_and_invalid_analytic_profiles_fail_closed() {
    let mut disconnected = rectangle([0, 0], [2 * NM, 2 * NM]);
    if let NativeCurveV2::Line { start_nm, .. } = &mut disconnected.curves[2] {
        *start_nm = [3 * NM, 2 * NM, 0];
    }
    let error = execute(&request(
        NativeProfileRegionV2 {
            outer: disconnected,
            holes: vec![],
        },
        NM,
    ))
    .unwrap_err();
    assert_eq!(error.category, ErrorCategory::InvalidInput);
    assert_eq!(error.field.as_deref(), Some("region.outer"));

    let collinear_arc = NativeCurveLoopV2 {
        curves: vec![
            NativeCurveV2::CircularArc {
                start_nm: [0, 0, 0],
                end_nm: [2 * NM, 0, 0],
                transit_nm: [NM, 0, 0],
            },
            line([2 * NM, 0, 0], [0, 0, 0]),
        ],
    };
    let error = execute(&request(
        NativeProfileRegionV2 {
            outer: collinear_arc,
            holes: vec![],
        },
        NM,
    ))
    .unwrap_err();
    assert_eq!(error.category, ErrorCategory::InvalidInput);
    assert_eq!(error.field.as_deref(), Some("region.outer.curves[0]"));
}

#[test]
fn native_extrude_is_deterministic_and_v1_remains_compatible() {
    let native = request(
        NativeProfileRegionV2 {
            outer: circle([0, 0, 0], 2 * NM),
            holes: vec![],
        },
        4 * NM,
    );
    let first = execute(&native).unwrap();
    let second = execute(&native).unwrap();
    assert_eq!(first, second);

    let legacy = FeatureRequest {
        schema_version: LEGACY_FEATURE_KERNEL_SCHEMA_VERSION,
        document_id: "legacy-document".to_owned(),
        feature_id: "legacy-feature".to_owned(),
        output_body_id: "legacy-body".to_owned(),
        operation: FeatureOperation::Extrude(ExtrudeInput {
            profiles_nm: vec![vec![[0, 0, 0], [NM, 0, 0], [NM, NM, 0], [0, NM, 0]]],
            direction_nm: [0, 0, NM],
            tolerance_nm: TOLERANCE_NM,
        }),
    };
    assert_eq!(execute(&legacy).unwrap().schema_version, 1);

    let mut wrong_version = native;
    wrong_version.schema_version = LEGACY_FEATURE_KERNEL_SCHEMA_VERSION;
    let error = execute(&wrong_version).unwrap_err();
    assert_eq!(error.category, ErrorCategory::Unsupported);
    assert_eq!(error.field.as_deref(), Some("schema_version"));
}

#[test]
fn principal_axis_extent_edit_affinely_preserves_exact_annulus() {
    let region = NativeProfileRegionV2 {
        outer: circle([0, 0, 0], 5 * NM),
        holes: vec![circle([0, 0, 0], 2 * NM)],
    };
    let previous_request = request(region.clone(), 3 * NM);
    let previous = execute(&previous_request).unwrap();
    let edited_request = request(region, 5 * NM);
    let edited =
        execute_native_extrude_extent_edit(&edited_request, &previous_request, &previous.output)
            .unwrap();
    let rebuilt = execute(&edited_request).unwrap();

    assert_eq!(edited.output.evidence, rebuilt.output.evidence);
    assert_eq!(edited.output.evidence.bounds_nm.max[2], 5 * NM);
    assert_eq!(
        edited.output.evidence.centroid_nm,
        Some([0.0, 0.0, 2_500_000.0])
    );
    let solid: monstertruck_modeling::Solid =
        serde_json::from_slice(&edited.output.solid_json).unwrap();
    assert!(!solid.boundaries().is_empty());
}

#[test]
fn native_cut_retains_target_identity_and_subtracts_the_direct_brep() {
    let target = target_box();
    let request = cut_request(
        target.clone(),
        NativeProfileRegionV2 {
            outer: rectangle([-2 * NM, -2 * NM], [2 * NM, 2 * NM]),
            holes: vec![],
        },
        [0, 0, 10 * NM],
    );
    let result = execute(&request).unwrap();

    assert_eq!(result.output.body_id, target.body_id);
    assert_eq!(result.ordered_input_body_ids, [target.body_id]);
    assert_eq!(result.output.evidence.bounds_nm, target.evidence.bounds_nm);
    assert!(result.output.evidence.volume_model_units3 < target.evidence.volume_model_units3);
    assert!(result.output.evidence.volume_model_units3 > 0.0);
    let solid: monstertruck_modeling::Solid =
        serde_json::from_slice(&result.output.solid_json).unwrap();
    assert_eq!(solid.boundaries().len(), 1);
}

#[test]
fn native_cut_accepts_exact_circle_arc_and_hole_profiles() {
    let target = target_box();
    let circle_cut = execute(&cut_request(
        target.clone(),
        NativeProfileRegionV2 {
            outer: circle([0, 0, 0], 3 * NM),
            holes: vec![],
        },
        [0, 0, 5 * NM],
    ))
    .unwrap();
    let expected_circle_volume =
        target.evidence.volume_model_units3 - std::f64::consts::PI * 3.0_f64.powi(2) * 5.0;
    assert_eq!(circle_cut.output.body_id, target.body_id);
    assert!(
        (circle_cut.output.evidence.volume_model_units3 - expected_circle_volume).abs() < 0.1,
        "actual={}, expected={expected_circle_volume}",
        circle_cut.output.evidence.volume_model_units3,
    );

    let annulus_cut = execute(&cut_request(
        target.clone(),
        NativeProfileRegionV2 {
            outer: circle([0, 0, 0], 5 * NM),
            holes: vec![circle([0, 0, 0], 2 * NM)],
        },
        [0, 0, 5 * NM],
    ))
    .unwrap();
    let expected_annulus_volume = target.evidence.volume_model_units3
        - std::f64::consts::PI * (5.0_f64.powi(2) - 2.0_f64.powi(2)) * 5.0;
    assert_eq!(annulus_cut.output.body_id, target.body_id);
    assert!(
        (annulus_cut.output.evidence.volume_model_units3 - expected_annulus_volume).abs() < 0.1
    );

    let capsule = NativeCurveLoopV2 {
        curves: vec![
            line([NM, NM, 0], [-NM, NM, 0]),
            NativeCurveV2::CircularArc {
                start_nm: [-NM, NM, 0],
                end_nm: [-NM, -NM, 0],
                transit_nm: [-2 * NM, 0, 0],
            },
            line([-NM, -NM, 0], [NM, -NM, 0]),
            NativeCurveV2::CircularArc {
                start_nm: [NM, -NM, 0],
                end_nm: [NM, NM, 0],
                transit_nm: [2 * NM, 0, 0],
            },
        ],
    };
    let capsule_cut = execute(&cut_request(
        target.clone(),
        NativeProfileRegionV2 {
            outer: capsule,
            holes: vec![],
        },
        [0, 0, 5 * NM],
    ))
    .unwrap();
    let expected_capsule_volume =
        target.evidence.volume_model_units3 - (4.0 + std::f64::consts::PI) * 5.0;
    assert_eq!(capsule_cut.output.body_id, target.body_id);
    assert!(
        (capsule_cut.output.evidence.volume_model_units3 - expected_capsule_volume).abs() < 0.1
    );
}

#[test]
fn native_cut_failures_preserve_the_exact_target() {
    let target = target_box();
    let no_intersection = cut_request(
        target.clone(),
        NativeProfileRegionV2 {
            outer: circle([0, 0, 20 * NM], 2 * NM),
            holes: vec![],
        },
        [0, 0, 2 * NM],
    );
    let error = execute(&no_intersection).unwrap_err();
    assert_eq!(error.category, ErrorCategory::InvalidInput);
    assert!(error.message.starts_with("no_intersection:"));
    assert_eq!(error.preserved_inputs.as_slice(), std::slice::from_ref(&target));

    let remove_all = cut_request(
        target.clone(),
        NativeProfileRegionV2 {
            outer: rectangle([-10 * NM, -10 * NM], [10 * NM, 10 * NM]),
            holes: vec![],
        },
        [0, 0, 10 * NM],
    );
    let error = execute(&remove_all).unwrap_err();
    assert_eq!(error.category, ErrorCategory::EmptyResult);
    assert!(error.message.starts_with("remove_all_material:"));
    assert_eq!(error.preserved_inputs.as_slice(), std::slice::from_ref(&target));

    let tangent = cut_request(
        target.clone(),
        NativeProfileRegionV2 {
            outer: circle([-17 * NM / 2, 0, 0], 3 * NM / 2),
            holes: vec![],
        },
        [0, 0, 5 * NM],
    );
    let error = execute(&tangent).unwrap_err();
    assert_eq!(error.category, ErrorCategory::Unsupported);
    assert!(error.message.starts_with("nonmanifold_result:"));
    assert_eq!(error.preserved_inputs.as_slice(), std::slice::from_ref(&target));

    let mut wrong_identity = cut_request(
        target.clone(),
        NativeProfileRegionV2 {
            outer: rectangle([-NM, -NM], [NM, NM]),
            holes: vec![],
        },
        [0, 0, 5 * NM],
    );
    wrong_identity.output_body_id = "body-replacement".into();
    let error = execute(&wrong_identity).unwrap_err();
    assert_eq!(error.category, ErrorCategory::InvalidInput);
    assert_eq!(error.field.as_deref(), Some("output_body_id"));
    assert_eq!(error.preserved_inputs, [target]);
}
