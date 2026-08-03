use crawler_alpha_reference::run_native_fixture_geometry;

#[test]
fn declarative_mounting_bracket_drives_native_through_cut_contract() {
    let geometry = run_native_fixture_geometry()
        .expect("fixture program must execute through Crawler contracts");
    let trace = &geometry.executed_operations;
    assert_eq!(
        trace
            .iter()
            .map(|entry| (entry.feature_id.as_str(), entry.operation.as_str()))
            .collect::<Vec<_>>(),
        [
            ("feature:base-plate", "prismatic_extrude"),
            ("feature:upright", "prismatic_extrude"),
            ("feature:base-hole-pair", "linear_pattern"),
            ("feature:base-hole-pair", "boolean_cut"),
            ("feature:upright-hole-pair", "linear_pattern"),
            ("feature:upright-hole-pair", "boolean_cut"),
            ("feature:upright-hole-pair", "compose_shells"),
        ]
    );
    assert_eq!(
        trace[3].ordered_input_body_ids,
        ["body:base-plate", "body:base-hole:0", "body:base-hole:1"]
    );
    assert_eq!(
        trace[5].ordered_input_body_ids,
        ["body:upright", "body:upright-hole:0", "body:upright-hole:1"]
    );
    assert_eq!(geometry.final_body_id, "body:bracket");
    assert_eq!(
        geometry.final_bracket.bounds_nm,
        (
            [-30_000_000, -20_000_000, 0],
            [30_000_000, 20_000_000, 36_000_000]
        )
    );
    assert!(
        f64::from_bits(geometry.base_through_cut.volume_model_units3_bits)
            < f64::from_bits(geometry.base_plate.volume_model_units3_bits)
    );
    assert!(
        f64::from_bits(geometry.upright_through_cut.volume_model_units3_bits)
            < f64::from_bits(geometry.upright_plate.volume_model_units3_bits)
    );
    assert!(geometry.base_through_cut.face_count > 6);
    assert!(geometry.upright_through_cut.face_count > 6);
}

#[test]
fn native_fixture_geometry_and_operation_evidence_are_byte_deterministic() {
    let first = run_native_fixture_geometry().expect("first native fixture execution must succeed");
    let second =
        run_native_fixture_geometry().expect("second native fixture execution must succeed");
    assert_eq!(first, second);
}
