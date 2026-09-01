use std::collections::BTreeSet;

#[test]
fn legacy_solid_feature_matrix_is_complete_unique_and_fail_closed() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../contracts/solid-feature-candidate/legacy-solid-feature-matrix.v1.json");
    let matrix: serde_json::Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    assert_eq!(matrix["schema_version"], 1);
    assert_eq!(matrix["policy"], "preserve_without_implicit_migration");
    assert_eq!(matrix["automatic_v1_to_v2_migration"], false);
    assert_eq!(matrix["future_schema"]["disposition"], "reject");
    assert_eq!(matrix["future_schema"]["mutation_allowed"], false);
    assert_eq!(matrix["downgrade"]["disposition"], "reject");
    assert_eq!(matrix["downgrade"]["lossy_conversion_allowed"], false);

    let operations = matrix["operations"].as_array().unwrap();
    let mut identities = BTreeSet::new();
    for operation in operations {
        let schema_id = operation["schema_id"].as_str().unwrap();
        let version = operation["request_schema_version"].as_u64().unwrap();
        assert!(identities.insert((schema_id, version)));
        let disposition = operation["disposition"].as_str().unwrap();
        assert!(matches!(disposition, "preserve_v1" | "preserve_v2"));
        assert_eq!(operation["open"], "editable");
        assert_eq!(operation["save"], disposition);
        if version == 1 {
            assert_eq!(operation["analytic_claim"], false);
        }
    }
    let required_v1 = BTreeSet::from([
        "crawler.part.boolean",
        "crawler.part.extrude",
        "crawler.part.extrude.cut",
        "crawler.part.loft",
        "crawler.part.revolve",
        "crawler.part.revolve.cut",
        "crawler.part.sweep",
    ]);
    let covered_v1: BTreeSet<&str> = identities
        .iter()
        .filter_map(|(schema_id, version)| (*version == 1).then_some(*schema_id))
        .collect();
    assert_eq!(covered_v1, required_v1);
}
