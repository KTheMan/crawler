//! Release-WASM execution probes for E3D-S1-01.

#![cfg(target_arch = "wasm32")]

use crawler_feature_kernel::*;
use wasm_bindgen_test::*;

const TOLERANCE_NM: i64 = 10_000;

fn request(feature_id: &str, operation: FeatureOperation) -> FeatureRequest {
    FeatureRequest {
        schema_version: FEATURE_KERNEL_SCHEMA_VERSION,
        document_id: "gate0-wasm-document".to_owned(),
        feature_id: feature_id.to_owned(),
        output_body_id: format!("{feature_id}-output"),
        operation,
    }
}

fn prism(feature_id: &str, points_nm: Vec<[i64; 3]>, direction_nm: [i64; 3]) -> BodySnapshot {
    execute(&request(
        feature_id,
        FeatureOperation::Extrude(ExtrudeInput {
            profiles_nm: vec![points_nm],
            direction_nm,
            tolerance_nm: TOLERANCE_NM,
        }),
    ))
    .unwrap()
    .output
}

fn box_snapshot(body_id: &str, min: [i64; 3], max: [i64; 3]) -> BodySnapshot {
    let mut snapshot = prism(
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

fn boolean(
    feature_id: &str,
    operation: BooleanKind,
    target: BodySnapshot,
    tool: BodySnapshot,
) -> Result<FeatureResult, FeatureError> {
    execute(&request(
        feature_id,
        FeatureOperation::Boolean(BooleanInput {
            operation,
            target,
            tools: vec![tool],
            tolerance_nm: TOLERANCE_NM,
        }),
    ))
}

#[wasm_bindgen_test]
fn release_wasm_executes_qualified_axis_aligned_union_and_difference() {
    let target = box_snapshot("target", [0, 0, 0], [2_000_000; 3]);
    let tool = box_snapshot("tool", [1_000_000, 1_000_000, 1_000_000], [3_000_000; 3]);

    let union = boolean(
        "axis-union",
        BooleanKind::Union,
        target.clone(),
        tool.clone(),
    )
    .unwrap();
    let difference = boolean("axis-cut", BooleanKind::Cut, target, tool).unwrap();
    assert!((union.output.evidence.volume_model_units3 - 15.0).abs() < 1.0e-6);
    assert!((difference.output.evidence.volume_model_units3 - 7.0).abs() < 1.0e-6);
}

#[wasm_bindgen_test]
fn release_wasm_executes_disjoint_and_tangent_qualified_classes() {
    let target = box_snapshot("target", [0, 0, 0], [1_000_000; 3]);
    let disjoint = box_snapshot(
        "disjoint",
        [2_000_000, 0, 0],
        [3_000_000, 1_000_000, 1_000_000],
    );
    let tangent = box_snapshot(
        "tangent",
        [1_000_000, 0, 0],
        [2_000_000, 1_000_000, 1_000_000],
    );

    let union = boolean(
        "disjoint-union",
        BooleanKind::Union,
        target.clone(),
        disjoint.clone(),
    )
    .unwrap();
    let no_op = boolean("disjoint-cut", BooleanKind::Cut, target.clone(), disjoint).unwrap();
    let tangent_union = boolean(
        "tangent-union",
        BooleanKind::Union,
        target.clone(),
        tangent.clone(),
    )
    .unwrap();
    let tangent_cut = boolean("tangent-cut", BooleanKind::Cut, target, tangent).unwrap();

    assert_eq!(
        union.output.evidence.bounds_nm.max,
        [3_000_000, 1_000_000, 1_000_000]
    );
    assert!((no_op.output.evidence.volume_model_units3 - 1.0).abs() < 1.0e-6);
    assert!((tangent_union.output.evidence.volume_model_units3 - 2.0).abs() < 1.0e-6);
    assert!((tangent_cut.output.evidence.volume_model_units3 - 1.0).abs() < 1.0e-6);
}

#[wasm_bindgen_test]
fn release_wasm_refuses_rotated_overlap_with_structured_unsupported_error() {
    let rotated = prism(
        "rotated",
        vec![
            [0, 1_000_000, 0],
            [1_000_000, 0, 0],
            [2_000_000, 1_000_000, 0],
            [1_000_000, 2_000_000, 0],
        ],
        [0, 0, 2_000_000],
    );
    let tool = box_snapshot(
        "tool",
        [750_000, 750_000, 500_000],
        [2_250_000, 2_250_000, 1_500_000],
    );
    let rotated_before = rotated.solid_json.clone();
    let tool_before = tool.solid_json.clone();

    for operation in [BooleanKind::Union, BooleanKind::Cut] {
        let error =
            boolean("rotated-refusal", operation, rotated.clone(), tool.clone()).unwrap_err();
        assert_eq!(error.category, ErrorCategory::Unsupported);
        assert!(error.message.contains("native intersection backend"));
    }
    assert_eq!(rotated.solid_json, rotated_before);
    assert_eq!(tool.solid_json, tool_before);
}

#[wasm_bindgen_test]
fn release_wasm_reports_empty_results_without_trapping() {
    let target = box_snapshot("target", [0, 0, 0], [1_000_000; 3]);
    let error = boolean("identical-cut", BooleanKind::Cut, target.clone(), target).unwrap_err();
    assert_eq!(error.category, ErrorCategory::EmptyResult);

    let target = box_snapshot("intersection-target", [0, 0, 0], [1_000_000; 3]);
    let disjoint = box_snapshot(
        "intersection-tool",
        [2_000_000, 0, 0],
        [3_000_000, 1_000_000, 1_000_000],
    );
    let error = boolean(
        "disjoint-intersection",
        BooleanKind::Intersect,
        target,
        disjoint,
    )
    .unwrap_err();
    assert_eq!(error.category, ErrorCategory::EmptyResult);
}
