use crawler_alpha_reference::{QualificationReport, run_qualification};

#[test]
fn m2_alpha_reference_is_deterministic_serializable_and_fail_closed() {
    let first = run_qualification().unwrap();
    let second = run_qualification().unwrap();
    assert_eq!(first, second);
    assert_eq!(first.schema_version, 2);
    assert_eq!(
        first.canonical_bytes().unwrap(),
        second.canonical_bytes().unwrap()
    );
    first.verify_run_digest().unwrap();

    let saved = first.canonical_bytes().unwrap();
    let reloaded: QualificationReport = serde_json::from_slice(&saved).unwrap();
    assert_eq!(reloaded, first);
    reloaded.verify_run_digest().unwrap();

    assert_eq!(first.provenance.license_spdx, "CC0-1.0");
    assert_eq!(
        first.provenance.declared_document_sha256,
        first.provenance.actual_document_sha256
    );
    assert_eq!(first.reference_part.topology_assertion_count, 3);
    assert_eq!(first.reference_part.geometric_assertion_count, 1);
    assert_eq!(
        first.reference_part.expected_bounds_nm,
        (
            [-30_000_000, -20_000_000, 0],
            [30_000_000, 20_000_000, 36_000_000]
        )
    );
    assert_eq!(
        first.reference_part.executed_qualified_operations,
        [
            "prismatic_extrude",
            "prismatic_extrude",
            "linear_pattern",
            "boolean_cut",
            "linear_pattern",
            "boolean_cut",
            "compose_shells"
        ]
    );
    assert!(
        first
            .reference_part
            .feature_operation_schema_ids
            .contains(&"crawler.operation.extrude".to_owned())
    );
    assert_eq!(first.sketch.closed_profile_count, 1);
    assert_eq!(first.sketch.diagnostic_count, 0);
    assert_eq!(first.geometry.final_body_id, "body:bracket");
    assert_eq!(first.geometry.executed_operations.len(), 7);
    for stage in [
        &first.geometry.base_plate,
        &first.geometry.upright_plate,
        &first.geometry.base_hole_pattern,
        &first.geometry.base_through_cut,
        &first.geometry.upright_hole_pattern,
        &first.geometry.upright_through_cut,
        &first.geometry.final_bracket,
    ] {
        assert!(stage.vertex_count > 0);
        assert!(stage.edge_count > 0);
        assert!(stage.face_count > 0);
        assert!((0..3).all(|axis| stage.bounds_nm.0[axis] <= stage.bounds_nm.1[axis]));
    }
    assert_eq!(
        first.feature_graph.minimum_recompute_order,
        ["feature:topology-consumer"]
    );
    assert!(first.feature_graph.fixture_timeline_feature_count > 0);
    assert_eq!(first.topology_repair.ambiguous_candidates.len(), 2);
    assert_eq!(
        first.topology_repair.preview_base_hash,
        first.topology_repair.undo_hash
    );
    assert!(first.topology_repair.failed_repair_preserved_hash);
    assert!(first.package.save_load_equal);
    assert_eq!(
        first.package.loaded_document_hash,
        first.reference_part.document_semantic_hash
    );
    assert!(first.package.archive_byte_length > 0);
    assert!(!first.package.archive_sha256.is_empty());
    assert!(first.versioning.structural_diff_changes > 0);
    assert_eq!(first.versioning.migration_source_version, 0);
    assert_eq!(first.versioning.migration_target_version, 1);
    assert_eq!(first.versioning.migration_steps.len(), 1);
    assert_eq!(first.interchange.exports.len(), 3);
    assert_eq!(first.interchange.source_body_id, "body:bracket");
    assert_eq!(
        first.interchange.source_geometry_digest,
        first.geometry.final_bracket.deterministic_digest
    );
    assert!(first.interchange.step_round_trip.shell_count > 0);
    assert!(first.interchange.step_round_trip.face_count > 0);
    assert!(first.interchange.step_round_trip.triangle_count > 0);
    assert!(
        first
            .failure_atomicity
            .failed_feature_preserved_semantic_hash
    );
    assert!(first.history.undo_restored_exact_base);
    assert!(first.history.redo_restored_exact_commit);
    assert_eq!(
        first.history.undo_semantic_hash,
        first.history.base_semantic_hash
    );
    assert_eq!(
        first.history.redo_semantic_hash,
        first.history.committed_semantic_hash
    );
    assert_eq!(first.performance_measurement.status, "pending_measured_run");
    assert_eq!(first.performance_measurement.fixture_document_revision, 5);
    assert!(first.performance_measurement.source_revision.is_none());
    assert!(first.performance_measurement.build_revision.is_none());
    assert!(first.performance_measurement.browser.is_none());
    assert!(first.performance_measurement.device_class.is_none());
    assert!(first.performance_measurement.warm_cold_state.is_none());
    assert!(
        first
            .performance_measurement
            .raw_observations_microseconds
            .is_empty()
    );
    assert_eq!(
        first.independent_reader.status,
        "pending_independent_reader"
    );
    assert!(first.independent_reader.reader_name.is_none());
    assert!(!first.independent_reader.geometric_validation_passed);
    assert!(!first.independent_reader.visual_validation_passed);
    assert!(
        first
            .failure_atomicity
            .failed_repair_preserved_semantic_hash
    );
    assert!(!first.metadata_boundaries.timing_values_serialized);
    assert_eq!(first.feature_graph.timing_sample_count, 1);
    assert!(
        first
            .contract_gaps
            .iter()
            .all(|gap| !gap.contains("no ZIP encoder") && !gap.contains("PartEngine results"))
    );
    assert!(first.contract_gaps.is_empty());
}
