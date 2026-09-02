use crawler_part_runtime::PartRuntime;
use crawler_versioning::{MigrationError, MigrationRegistry};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

const GOLDENS: &str = include_str!("fixtures/legacy-solid-feature-goldens.v1.json");
const MATRIX: &str =
    include_str!("../../../contracts/solid-feature-candidate/legacy-solid-feature-matrix.v1.json");

fn snapshot(runtime: &PartRuntime) -> Value {
    serde_json::from_str::<Value>(&runtime.active_body_json(0.01).unwrap()).unwrap()["body"].clone()
}

fn materialize_bodies(value: &mut Value, bodies: &BTreeMap<&str, Value>) {
    match value {
        Value::Array(values) => {
            for value in values {
                materialize_bodies(value, bodies);
            }
        }
        Value::Object(object) => {
            if let Some(name) = object.get("$body").and_then(Value::as_str) {
                *value = bodies.get(name).unwrap().clone();
            } else {
                for value in object.values_mut() {
                    materialize_bodies(value, bodies);
                }
            }
        }
        _ => {}
    }
}

fn envelope(
    document_id: &str,
    base_feature_id: &str,
    feature_id: &str,
    transaction_id: &str,
    operation: Value,
) -> Value {
    json!({
        "transaction_id": transaction_id,
        "feature": {
            "id": feature_id,
            "display_name": format!("Legacy golden {feature_id}"),
            "component": "component:root",
            "operation": {
                "schema_id": format!("crawler.operation.{}", operation["kind"].as_str().unwrap()),
                "schema_version": 1
            },
            "dependencies": [base_feature_id],
            "inputs": {},
            "parameters": {},
            "suppressed": false
        },
        "before": null,
        "request": {
            "schema_version": 1,
            "document_id": document_id,
            "feature_id": feature_id,
            "output_body_id": format!("body:{feature_id}"),
            "operation": operation
        }
    })
}

fn accepted(value: &str) -> Value {
    let value: Value = serde_json::from_str(value).unwrap();
    assert_eq!(value["accepted"], true, "{value:#}");
    value
}

fn latest_request(document: &Value, feature_id: &str) -> Value {
    for transaction in document["transactions"].as_array().unwrap().iter().rev() {
        for change in transaction["changes"].as_array().unwrap().iter().rev() {
            if change["kind"] == "accept_feature_result" && change["feature"] == feature_id {
                return serde_json::from_str(change["request_json"].as_str().unwrap()).unwrap();
            }
        }
    }
    panic!("no accepted request for {feature_id}")
}

#[test]
fn legacy_solid_schemas_have_operation_specific_golden_lifecycles() {
    let goldens: Value = serde_json::from_str(GOLDENS).unwrap();
    let matrix: Value = serde_json::from_str(MATRIX).unwrap();
    assert_eq!(goldens["schema_version"], 1);
    assert_eq!(goldens["policy"], matrix["policy"]);
    assert_eq!(matrix["automatic_v1_to_v2_migration"], false);

    let policies = matrix["operations"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|entry| entry["request_schema_version"] == 1)
        .map(|entry| (entry["schema_id"].as_str().unwrap(), entry))
        .collect::<BTreeMap<_, _>>();
    let cases = goldens["operations"].as_array().unwrap();
    assert_eq!(cases.len(), 7);
    assert_eq!(policies.len(), 7);

    let mut observed = Vec::new();
    for case in cases {
        let id = case["id"].as_str().unwrap();
        let schema_id = case["schema_id"].as_str().unwrap();
        let policy = policies.get(schema_id).unwrap();
        assert_eq!(case["disposition"], policy["disposition"]);
        assert_eq!(case["open"], policy["open"]);
        assert_eq!(case["save"], policy["save"]);
        assert_eq!(case["disposition"], "preserve_v1");
        assert_eq!(case["open"], "editable");
        assert_eq!(case["save"], "preserve_v1");

        let document_id = format!("document:legacy-golden:{id}");
        let mut runtime = PartRuntime::new_rectangular_part(
            document_id.as_str(),
            format!("Legacy golden {id}"),
            10_000_000,
            10_000_000,
            10_000_000,
        )
        .unwrap();
        let initial_document = runtime.document_json().unwrap();
        let initial: Value =
            serde_json::from_str(&runtime.active_body_json(0.01).unwrap()).unwrap();
        let base_feature_id = initial["feature_id"].as_str().unwrap().to_owned();
        let base = initial["body"].clone();
        let mut tool = base.clone();
        tool["body_id"] = json!(format!("body:legacy-golden:{id}:tool"));
        let bodies = BTreeMap::from([("base", base), ("tool", tool)]);

        let mut operation = case["operation"].clone();
        materialize_bodies(&mut operation, &bodies);
        let feature_id = format!("feature:legacy-golden:{id}");
        let create_envelope = envelope(
            &document_id,
            &base_feature_id,
            &feature_id,
            &format!("transaction:legacy-golden:{id}:create"),
            operation,
        );

        let preview = accepted(
            &runtime
                .preview_feature_json(&create_envelope.to_string())
                .unwrap(),
        );
        assert_eq!(runtime.document_json().unwrap(), initial_document);
        let created = accepted(
            &runtime
                .execute_new_feature_json(&create_envelope.to_string())
                .unwrap(),
        );
        assert_eq!(created["result"], preview["result"]);
        let created_body_digest = created["result"]["output"]["evidence"]["deterministic_digest"]
            .as_str()
            .unwrap()
            .to_owned();

        let saved_after_create = runtime.document_json().unwrap();
        runtime = PartRuntime::from_document_json(&saved_after_create).unwrap();
        assert_eq!(runtime.document_json().unwrap(), saved_after_create);
        let reopened = snapshot(&runtime);
        assert_eq!(
            reopened["evidence"]["deterministic_digest"],
            created_body_digest
        );

        let recomputed = accepted(&runtime.recompute_from_here_json(&feature_id).unwrap());
        assert!(
            recomputed["recomputed"]
                .as_array()
                .unwrap()
                .iter()
                .any(|entry| entry["feature"] == feature_id),
            "{id}: {recomputed:#}"
        );

        let mut edit_operation = case["edit_operation"].clone();
        materialize_bodies(&mut edit_operation, &bodies);
        let edit_envelope = envelope(
            &document_id,
            &base_feature_id,
            &feature_id,
            &format!("transaction:legacy-golden:{id}:edit"),
            edit_operation,
        );
        let edited = accepted(
            &runtime
                .execute_feature_json(&edit_envelope.to_string())
                .unwrap(),
        );
        let edited_body_digest = edited["result"]["output"]["evidence"]["deterministic_digest"]
            .as_str()
            .unwrap()
            .to_owned();

        let final_saved = runtime.document_json().unwrap();
        let final_document_sha256 = crawler_package::sha256_hex(final_saved.as_bytes());
        runtime = PartRuntime::from_document_json(&final_saved).unwrap();
        assert_eq!(runtime.document_json().unwrap(), final_saved);
        assert_eq!(
            snapshot(&runtime)["evidence"]["deterministic_digest"],
            edited_body_digest
        );

        let final_document: Value = serde_json::from_str(&final_saved).unwrap();
        let persisted = latest_request(&final_document, &feature_id);
        assert_eq!(persisted["schema_version"], 1);
        assert_eq!(
            persisted["operation"]["kind"],
            case["edit_operation"]["kind"]
        );
        assert!(
            final_document["feature_definitions_v2"]
                .get(&feature_id)
                .is_none(),
            "{id} was silently promoted to V2"
        );
        if id == "sweep" {
            assert!(persisted["operation"]["profile_nm"].is_array());
            assert!(persisted["operation"]["path_nm"].is_array());
            assert!(persisted["operation"].get("frame").is_none());
        }

        let actual = json!({
            "created_body_digest": created_body_digest,
            "edited_body_digest": edited_body_digest,
            "final_document_sha256": final_document_sha256
        });
        observed.push(json!({ "id": id, "expected": actual.clone() }));
        if !case["expected"].is_null() {
            assert_eq!(case["expected"], actual, "golden drift for {id}");
        }
    }

    if cases.iter().any(|case| case["expected"].is_null()) {
        panic!(
            "populate the golden expected values with:\n{}",
            serde_json::to_string_pretty(&observed).unwrap()
        );
    }
}

#[test]
fn legacy_solid_compatibility_rejections_are_fail_closed_and_atomic() {
    let runtime = PartRuntime::new_rectangular_part(
        "document:legacy-rejections",
        "Legacy rejection atomicity",
        10_000_000,
        10_000_000,
        10_000_000,
    )
    .unwrap();
    let accepted_document = runtime.document_json().unwrap();
    let accepted_hash = runtime.semantic_hash().unwrap();

    let mut future_document: Value = serde_json::from_str(&accepted_document).unwrap();
    future_document["schema_version"] = json!(99);
    assert!(PartRuntime::from_document_json(&future_document.to_string()).is_err());
    assert_eq!(runtime.semantic_hash().unwrap(), accepted_hash);
    assert_eq!(runtime.document_json().unwrap(), accepted_document);

    let migration = MigrationRegistry::default();
    let downgrade = migration
        .migrate(
            accepted_document.as_bytes(),
            &BTreeSet::new(),
            &BTreeSet::from(["document.core".to_owned()]),
            0,
        )
        .unwrap_err();
    assert!(matches!(
        downgrade,
        MigrationError::UnsupportedOrLossy {
            source_version: 1,
            target_version: 0,
            ..
        }
    ));
    assert_eq!(runtime.semantic_hash().unwrap(), accepted_hash);
    assert_eq!(runtime.document_json().unwrap(), accepted_document);

    let unknown_capability = migration
        .migrate(
            accepted_document.as_bytes(),
            &BTreeSet::from(["document.future-solid-capability".to_owned()]),
            &BTreeSet::from(["document.core".to_owned()]),
            1,
        )
        .unwrap_err();
    assert!(matches!(
        unknown_capability,
        MigrationError::UnsupportedRequiredFeature(ref capability)
            if capability == "document.future-solid-capability"
    ));
    assert_eq!(runtime.semantic_hash().unwrap(), accepted_hash);
    assert_eq!(runtime.document_json().unwrap(), accepted_document);

    let mut malformed_v0: Value = serde_json::from_str(&accepted_document).unwrap();
    malformed_v0["schema_version"] = json!(0);
    malformed_v0["units"] = json!({
        "length": "millimeter",
        "angle": "degree",
        "future_unit_policy": "unsupported"
    });
    let malformed_source = serde_json::to_vec(&malformed_v0).unwrap();
    let retained_source = malformed_source.clone();
    let failed_adjacent = migration
        .migrate(
            &malformed_source,
            &BTreeSet::new(),
            &BTreeSet::from(["document.core".to_owned()]),
            1,
        )
        .unwrap_err();
    assert!(matches!(
        failed_adjacent,
        MigrationError::UnsupportedOrLossy {
            source_version: 0,
            target_version: 1,
            ..
        }
    ));
    assert_eq!(malformed_source, retained_source);
    assert_eq!(runtime.semantic_hash().unwrap(), accepted_hash);
    assert_eq!(runtime.document_json().unwrap(), accepted_document);

    let initial: Value = serde_json::from_str(&runtime.active_body_json(0.01).unwrap()).unwrap();
    let invalid_envelope = envelope(
        "document:legacy-rejections",
        initial["feature_id"].as_str().unwrap(),
        "feature:legacy-invalid",
        "transaction:legacy-invalid",
        json!({
            "kind": "extrude",
            "profiles_nm": [[[0,0,0],[1000000,0,0],[1000000,1000000,0],[0,1000000,0]]],
            "direction_nm": [0,0,1000000],
            "tolerance_nm": 10000
        }),
    );
    let mut future_request = invalid_envelope.clone();
    future_request["request"]["schema_version"] = json!(99);
    let refusal = runtime
        .preview_feature_json(&future_request.to_string())
        .unwrap();
    let refusal: Value = serde_json::from_str(&refusal).unwrap();
    assert_eq!(refusal["accepted"], false);
    assert_eq!(refusal["error"]["field"], "schema_version");

    let mut unknown_enum = invalid_envelope;
    unknown_enum["request"]["operation"]["kind"] = json!("future_solid_operation");
    let refusal = runtime
        .preview_feature_json(&unknown_enum.to_string())
        .unwrap();
    let refusal: Value = serde_json::from_str(&refusal).unwrap();
    assert_eq!(refusal["accepted"], false);
    assert_eq!(refusal["error"]["field"], "envelope");
    assert_eq!(runtime.semantic_hash().unwrap(), accepted_hash);
    assert_eq!(runtime.document_json().unwrap(), accepted_document);
}

#[test]
fn legacy_solid_adjacent_document_migration_is_deterministic_atomic_and_idempotent() {
    let runtime = PartRuntime::new_rectangular_part(
        "document:legacy-adjacent-migration",
        "Adjacent migration",
        2_000_000,
        3_000_000,
        4_000_000,
    )
    .unwrap();
    let accepted = runtime.document_json().unwrap();
    let mut legacy: Value = serde_json::from_str(&accepted).unwrap();
    legacy["schema_version"] = json!(0);
    legacy["units"] = json!({ "length": "millimeter", "angle": "degree" });
    let source = serde_json::to_vec(&legacy).unwrap();
    let registry = MigrationRegistry::default();
    let required = BTreeSet::from(["document.core".to_owned()]);

    let first = registry.migrate(&source, &required, &required, 1).unwrap();
    let repeated = registry.migrate(&source, &required, &required, 1).unwrap();
    assert_eq!(first.source_version, 0);
    assert_eq!(first.target_version, 1);
    assert_eq!(first.applied_steps.len(), 1);
    assert_eq!(first.applied_steps[0].source_version, 0);
    assert_eq!(first.applied_steps[0].destination_version, 1);
    assert_eq!(first.original_bytes, source);
    assert_eq!(first.migrated_bytes, repeated.migrated_bytes);

    let twice = registry
        .migrate(&first.migrated_bytes, &required, &required, 1)
        .unwrap();
    assert!(twice.applied_steps.is_empty());
    assert_eq!(twice.migrated_bytes, first.migrated_bytes);
    let restored =
        PartRuntime::from_document_json(std::str::from_utf8(&twice.migrated_bytes).unwrap())
            .unwrap();
    assert_eq!(
        restored.dimensions().unwrap(),
        runtime.dimensions().unwrap()
    );
}
