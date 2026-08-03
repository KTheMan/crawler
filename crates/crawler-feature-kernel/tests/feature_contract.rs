use monstertruck_meshing::prelude::*;
use monstertruck_modeling::{Point3, Solid, Vector3, builder};

use crawler_feature_kernel::*;

const TOLERANCE_NM: i64 = 50_000;

fn revolve_request(feature_id: &str, body_id: &str) -> FeatureRequest {
    FeatureRequest {
        schema_version: FEATURE_KERNEL_SCHEMA_VERSION,
        document_id: "document-1".to_owned(),
        feature_id: feature_id.to_owned(),
        output_body_id: body_id.to_owned(),
        operation: FeatureOperation::Revolve(RevolveInput {
            axis_origin_nm: [0, 0, 0],
            axis: PrincipalAxis::Z,
            inner_radius_nm: 10_000_000,
            outer_radius_nm: 20_000_000,
            axial_start_nm: 0,
            axial_end_nm: 30_000_000,
            sweep_microdegrees: 360_000_000,
            divisions: 8,
            tolerance_nm: TOLERANCE_NM,
        }),
    }
}

fn box_snapshot(body_id: &str, origin: [f64; 3], size: f64) -> BodySnapshot {
    let vertex = builder::vertex(Point3::new(origin[0], origin[1], origin[2]));
    let edge = builder::extrude(&vertex, Vector3::unit_x() * size);
    let face = builder::extrude(&edge, Vector3::unit_y() * size);
    let solid: Solid = builder::extrude(&face, Vector3::unit_z() * size);
    let volume = solid.triangulation(0.05).to_polygon().volume().abs();
    BodySnapshot {
        body_id: body_id.to_owned(),
        solid_json: serde_json::to_vec(&solid).unwrap(),
        evidence: GeometryEvidence {
            vertex_count: 8,
            edge_count: 12,
            face_count: 6,
            bounds_nm: AxisAlignedBoundsNm {
                min: origin.map(|value| (value * 1_000_000.0).round() as i64),
                max: origin.map(|value| ((value + size) * 1_000_000.0).round() as i64),
            },
            volume_model_units3: volume,
            deterministic_digest: "test-seed".to_owned(),
        },
    }
}

fn boolean_request(kind: BooleanKind, tools: Vec<BodySnapshot>) -> FeatureRequest {
    FeatureRequest {
        schema_version: FEATURE_KERNEL_SCHEMA_VERSION,
        document_id: "document-1".to_owned(),
        feature_id: format!("feature-{kind:?}"),
        output_body_id: format!("body-{kind:?}"),
        operation: FeatureOperation::Boolean(BooleanInput {
            operation: kind,
            target: box_snapshot("target", [0.0, 0.0, 0.0], 1.0),
            tools,
            tolerance_nm: TOLERANCE_NM,
        }),
    }
}

#[test]
fn revolve_is_deterministic_and_save_load_ready() {
    let request = revolve_request("feature-revolve", "body-revolve");
    let first = execute(&request).expect("full rectangular profile revolve must succeed");
    let second = execute(&request).expect("repeat revolve must succeed");

    assert_eq!(first.feature_id, "feature-revolve");
    assert_eq!(first.output.body_id, "body-revolve");
    assert_eq!(first.output.evidence, second.output.evidence);
    assert!(first.output.evidence.face_count >= 4);
    assert_eq!(
        first.output.evidence.bounds_nm,
        AxisAlignedBoundsNm {
            min: [-20_000_000, -20_000_000, 0],
            max: [20_000_000, 20_000_000, 30_000_000],
        }
    );
    let expected_volume = std::f64::consts::PI * (20.0f64.powi(2) - 10.0f64.powi(2)) * 30.0;
    assert!(
        (first.output.evidence.volume_model_units3 - expected_volume).abs() < 2.0,
        "actual={}, expected={expected_volume}",
        first.output.evidence.volume_model_units3
    );

    let saved_request = serde_json::to_vec(&request).unwrap();
    let loaded_request: FeatureRequest = serde_json::from_slice(&saved_request).unwrap();
    assert_eq!(loaded_request, request);
    let saved_result = serde_json::to_vec(&first).unwrap();
    let loaded_result: FeatureResult = serde_json::from_slice(&saved_result).unwrap();
    assert_eq!(loaded_result, first);
}

#[test]
fn boolean_union_cut_and_intersect_match_deterministic_volumes() {
    let tool = box_snapshot("tool-a", [0.5, 0.5, 0.5], 1.0);
    let cases = [
        (BooleanKind::Union, 1.875),
        (BooleanKind::Cut, 0.875),
        (BooleanKind::Intersect, 0.125),
    ];
    for (kind, expected_volume) in cases {
        let result = execute(&boolean_request(kind, vec![tool.clone()]))
            .unwrap_or_else(|error| panic!("{kind:?} failed: {error:?}"));
        assert_eq!(result.ordered_input_body_ids, ["target", "tool-a"]);
        assert!((result.output.evidence.volume_model_units3 - expected_volume).abs() < 1.0e-3);
        assert!(!result.output.evidence.deterministic_digest.is_empty());
    }
}

#[test]
fn ordered_boolean_tools_are_preserved_and_deterministic() {
    let tools = vec![
        box_snapshot("tool-first", [0.5, 0.5, 0.5], 1.0),
        box_snapshot("tool-second", [1.0, 1.0, 1.0], 1.0),
    ];
    let request = boolean_request(BooleanKind::Union, tools);
    let first = execute(&request).unwrap();
    let second = execute(&request).unwrap();

    assert_eq!(
        first.ordered_input_body_ids,
        ["target", "tool-first", "tool-second"]
    );
    assert_eq!(first.output.evidence, second.output.evidence);
}

#[test]
fn invalid_and_numerical_inputs_fail_with_context() {
    let mut invalid = revolve_request("feature-invalid", "body-invalid");
    if let FeatureOperation::Revolve(input) = &mut invalid.operation {
        input.outer_radius_nm = input.inner_radius_nm;
    }
    let error = execute(&invalid).unwrap_err();
    assert_eq!(error.category, ErrorCategory::InvalidInput);
    assert_eq!(error.field.as_deref(), Some("outer_radius_nm"));
    assert!(!error.recovery.is_empty());

    if let FeatureOperation::Revolve(input) = &mut invalid.operation {
        input.outer_radius_nm = 9_007_199_254_740_992;
    }
    let error = execute(&invalid).unwrap_err();
    assert_eq!(error.category, ErrorCategory::Numerical);
    assert_eq!(error.field.as_deref(), Some("outer_radius_nm"));

    let mut invalid_tolerance = revolve_request("feature-tolerance", "body-tolerance");
    if let FeatureOperation::Revolve(input) = &mut invalid_tolerance.operation {
        input.tolerance_nm = 0;
    }
    let error = execute(&invalid_tolerance).unwrap_err();
    assert_eq!(error.category, ErrorCategory::InvalidInput);
    assert_eq!(error.field.as_deref(), Some("tolerance_nm"));
}

#[test]
fn empty_tool_list_and_corrupt_body_fail_closed() {
    let empty = boolean_request(BooleanKind::Union, vec![]);
    let error = execute(&empty).unwrap_err();
    assert_eq!(error.category, ErrorCategory::InvalidInput);
    assert_eq!(error.field.as_deref(), Some("tools"));

    let mut corrupt = box_snapshot("corrupt-tool", [0.0, 0.0, 0.0], 1.0);
    corrupt.solid_json = b"not-json".to_vec();
    let error = execute(&boolean_request(BooleanKind::Union, vec![corrupt])).unwrap_err();
    assert_eq!(error.category, ErrorCategory::InvalidInput);
    assert_eq!(error.field.as_deref(), Some("tools[0]"));
}

#[test]
fn disjoint_intersection_is_empty_or_fails_closed() {
    let request = boolean_request(
        BooleanKind::Intersect,
        vec![box_snapshot("far-tool", [5.0, 5.0, 5.0], 1.0)],
    );
    let error = execute(&request).unwrap_err();
    assert!(matches!(
        error.category,
        ErrorCategory::EmptyResult | ErrorCategory::Unsupported
    ));
}
