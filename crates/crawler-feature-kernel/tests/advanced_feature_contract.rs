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
