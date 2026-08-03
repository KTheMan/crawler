use crawler_reference_fixtures::{
    FixtureCategory, TopologyStatus, ValidationCode, sha256_hex, validate_repository,
};
use std::fs;
use std::path::{Path, PathBuf};

fn reference_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/reference-models")
}

#[test]
fn complete_reference_catalog_is_executable_evidence() {
    let report = validate_repository(reference_root()).unwrap();
    assert_eq!(report.fixture_count, 5);
    assert_eq!(report.artifact_count, 3);
    assert!(
        report
            .categories
            .contains(&FixtureCategory::ParametricModel)
    );
    assert!(
        report
            .categories
            .contains(&FixtureCategory::MechanicalReference)
    );
    assert!(report.categories.contains(&FixtureCategory::StepRoundtrip));
    assert!(report.categories.contains(&FixtureCategory::TopologyBreak));
    assert!(report.topology_statuses.contains(&TopologyStatus::Resolved));
    assert!(report.topology_statuses.contains(&TopologyStatus::Missing));
    assert!(
        report
            .topology_statuses
            .contains(&TopologyStatus::Ambiguous)
    );
}

#[test]
fn recorded_document_hashes_detect_same_length_corruption() {
    let source = reference_root();
    let temp = std::env::temp_dir().join(format!(
        "crawler-reference-fixtures-{}-{}",
        std::process::id(),
        sha256_hex(source.to_string_lossy().as_bytes())
    ));
    if temp.exists() {
        fs::remove_dir_all(&temp).unwrap();
    }
    copy_tree(&source, &temp);

    let document = temp.join("parametric-cube/document.json");
    let mut bytes = fs::read(&document).unwrap();
    bytes[0] ^= 1;
    fs::write(&document, bytes).unwrap();

    let error = validate_repository(&temp).unwrap_err();
    assert_eq!(error.code, ValidationCode::HashMismatch);
    fs::remove_dir_all(temp).unwrap();
}

#[test]
fn measurement_schema_requires_reproducible_percentile_context() {
    let schema_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../docs/measurements/measurement-record-v1.schema.json");
    let schema: serde_json::Value =
        serde_json::from_slice(&fs::read(schema_path).unwrap()).unwrap();

    let root_required = required_names(&schema);
    for required in [
        "fixture",
        "revision",
        "device_class",
        "environment",
        "run_state",
        "metrics",
    ] {
        assert!(root_required.contains(required), "missing {required}");
    }

    let properties = schema["properties"].as_object().unwrap();
    let fixture_required = required_names(&properties["fixture"]);
    for required in [
        "document_sha256",
        "document_revision",
        "license_spdx",
        "creator",
        "source",
        "generator",
    ] {
        assert!(fixture_required.contains(required), "missing {required}");
    }
    let summary = &properties["metrics"]["items"]["properties"]["summary"];
    let summary_required = required_names(summary);
    for required in ["count", "min", "p50", "p95", "p99", "max", "method"] {
        assert!(summary_required.contains(required), "missing {required}");
    }
    assert_eq!(summary["properties"]["method"]["const"], "nearest_rank");
    assert_eq!(
        properties["run_state"]["properties"]["kind"]["enum"],
        serde_json::json!(["cold", "warm"])
    );
}

fn required_names(value: &serde_json::Value) -> std::collections::BTreeSet<&str> {
    value["required"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item.as_str().unwrap())
        .collect()
}

fn copy_tree(source: &Path, destination: &Path) {
    fs::create_dir_all(destination).unwrap();
    for entry in fs::read_dir(source).unwrap() {
        let entry = entry.unwrap();
        let target = destination.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_tree(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}
