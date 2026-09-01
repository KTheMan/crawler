use std::{collections::BTreeSet, env, fs, path::PathBuf};

use crawler_package::sha256_hex;
use crawler_part_runtime::PartRuntime;
use monstertruck_modeling::Solid;
use serde_json::{Value, json};

#[derive(Clone)]
struct Metadata {
    candidate_id: String,
    revision: u64,
    manifest_sha256: String,
    recorded_at: String,
}

struct FixtureBinding {
    descriptor: Value,
    descriptor_sha256: String,
    input_sha256: String,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = env::args().skip(1);
    let mut manifest = PathBuf::from("contracts/solid-feature-candidate/sprint-1.json");
    let mut output = PathBuf::from("artifacts/solid-feature-qualification/current/runtime/native");
    let mut recorded_at = None;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--manifest" => manifest = args.next().ok_or("--manifest needs a path")?.into(),
            "--output" => output = args.next().ok_or("--output needs a path")?.into(),
            "--recorded-at" => {
                recorded_at = Some(args.next().ok_or("--recorded-at needs an RFC 3339 value")?)
            }
            _ => return Err(format!("unknown argument {arg}").into()),
        }
    }
    let bytes = fs::read(&manifest)?;
    let candidate: Value = serde_json::from_slice(&bytes)?;
    let metadata = Metadata {
        candidate_id: string(&candidate, "candidate_id")?,
        revision: candidate["revision"]
            .as_u64()
            .ok_or("manifest revision is absent")?,
        manifest_sha256: sha256_hex(&bytes),
        recorded_at: recorded_at.unwrap_or_else(|| {
            candidate["scope_frozen_at"]
                .as_str()
                .unwrap_or("1970-01-01T00:00:00Z")
                .to_owned()
        }),
    };
    let candidate_id = string(&candidate, "candidate_id")?;
    let manifest_fixture_ids = candidate["fixtures"]
        .as_array()
        .ok_or("manifest fixtures are absent")?
        .iter()
        .filter(|fixture| fixture["parity_required"].as_bool() == Some(true))
        .map(|fixture| fixture["id"].as_str().unwrap_or_default())
        .collect::<Vec<_>>();
    let owned_fixture_ids = owned_fixture_ids(&candidate_id).ok_or_else(|| {
        format!("native evidence exporter has no qualified adapter for candidate '{candidate_id}'")
    })?;
    if manifest_fixture_ids != owned_fixture_ids {
        return Err(format!(
            "native evidence exporter fixture ownership differs from the selected frozen parity manifest: manifest={manifest_fixture_ids:?}, owned={owned_fixture_ids:?}"
        )
        .into());
    }
    fs::create_dir_all(&output)?;
    let mut failures = Vec::new();
    for fixture_id in &manifest_fixture_ids {
        let fixture_ref = candidate["fixtures"]
            .as_array()
            .and_then(|fixtures| {
                fixtures
                    .iter()
                    .find(|fixture| fixture["id"].as_str() == Some(fixture_id))
            })
            .ok_or_else(|| format!("fixture descriptor reference is absent for {fixture_id}"))?;
        let descriptor_path = fixture_ref["path"]
            .as_str()
            .ok_or("fixture descriptor path is absent")?;
        let descriptor_bytes = fs::read(descriptor_path)?;
        let descriptor: Value = serde_json::from_slice(&descriptor_bytes)?;
        let binding = FixtureBinding {
            descriptor_sha256: sha256_hex(&descriptor_bytes),
            input_sha256: sha256_hex(&canonical_json_bytes(&descriptor["input"])?),
            descriptor,
        };
        let record = execute_fixture(fixture_id, &metadata, &binding);
        let status = record["status"].as_str().unwrap_or("failed");
        fs::write(
            output.join(format!("{fixture_id}.json")),
            format!("{}\n", serde_json::to_string_pretty(&record)?),
        )?;
        if status != "passed" {
            failures.push(*fixture_id);
        }
    }
    if !failures.is_empty() {
        return Err(format!(
            "{} fixture(s) did not produce passing native evidence: {}",
            failures.len(),
            failures.join(", ")
        )
        .into());
    }
    println!(
        "Native runtime evidence exported for {} fixtures to {}",
        manifest_fixture_ids.len(),
        output.display()
    );
    Ok(())
}

fn owned_fixture_ids(candidate_id: &str) -> Option<Vec<&'static str>> {
    Some(match candidate_id {
        "solid-feature-sprint-1" => vec![
            "feature-definition-v2-roundtrip",
            "feature-definition-v2-missing-reference",
            "profile-line-arc-capsule",
            "profile-unsupported-spline",
            "extrude-origin-blind-rectangle",
            "extrude-origin-blind-circle",
            "extrude-origin-annulus",
            "region-two-hole-plate",
            "region-creation-order-permutation",
            "region-invalid-open-loop",
            "region-invalid-overlap",
            "region-split-merge-repair",
            "extrude-origin-planes",
            "extrude-reload-edit",
            "legacy-solid-operation-matrix",
        ],
        "solid-feature-sprint-2" => vec![
            "extrude-origin-blind-negative",
            "extrude-origin-blind-symmetric",
        ],
        "solid-feature-sprint-3" => vec![
            "extrude-offset-plane-direction-matrix",
            "extrude-offset-plane-signed-edit",
            "construction-plane-missing-reference",
            "construction-plane-missing-offset-parameter",
            "construction-plane-wrong-type-offset-parameter",
            "construction-plane-unsafe-offset-parameter",
            "extrude-missing-construction-plane-support",
            "extrude-suppressed-construction-plane-support",
            "extrude-invalid-construction-plane-dependency",
        ],
        "solid-feature-sprint-4" => vec![
            "extrude-planar-face-orientation-matrix",
            "extrude-planar-face-upstream-edit",
            "extrude-planar-face-save-reopen-edit",
            "planar-face-missing-reference",
            "planar-face-stale-current-evidence",
            "planar-face-nonplanar-reference",
            "planar-face-suppressed-producer",
            "planar-face-wrong-body-producer-component",
            "planar-face-broken-support-explicit-repair",
            "planar-face-ambiguous-repair-refused",
        ],
        "solid-feature-sprint-5" => vec![
            "cut-origin-blind-rectangle",
            "cut-multi-body-unrelated-preserved",
            "cut-origin-circle",
            "cut-origin-annulus",
            "cut-origin-arc-capsule",
            "cut-offset-plane-reverse",
            "cut-offset-plane-upstream-recompute",
            "cut-planar-face-symmetric",
            "cut-edit-upstream-recompute",
            "cut-save-reopen-edit",
            "cut-missing-stale-suppressed-target",
            "cut-target-cardinality-refused",
            "cut-cross-component-target-refused",
            "cut-no-overlap-refused",
            "cut-body-erasure-refused",
            "cut-nonmanifold-result-refused",
            "cut-invalid-support-refused",
            "cut-invalid-profile-refused",
            "cut-last-valid-recovery",
        ],
        _ => return None,
    })
}

fn string(value: &Value, field: &str) -> Result<String, Box<dyn std::error::Error>> {
    value[field]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| format!("{field} is absent").into())
}

fn canonical_u64_decimal(value: &Value) -> Option<u64> {
    let text = value.as_str()?;
    if text.is_empty()
        || (text.len() > 1 && text.starts_with('0'))
        || !text.bytes().all(|byte| byte.is_ascii_digit())
    {
        return None;
    }
    text.parse().ok()
}

fn canonical_json_bytes(value: &Value) -> Result<Vec<u8>, serde_json::Error> {
    fn normalize(value: &Value) -> Value {
        match value {
            Value::Array(values) => Value::Array(values.iter().map(normalize).collect()),
            Value::Object(values) => {
                let mut keys = values.keys().collect::<Vec<_>>();
                keys.sort();
                let mut object = serde_json::Map::new();
                for key in keys {
                    object.insert(key.clone(), normalize(&values[key]));
                }
                Value::Object(object)
            }
            _ => value.clone(),
        }
    }
    serde_json::to_vec(&normalize(value))
}

fn execute_fixture(id: &str, metadata: &Metadata, binding: &FixtureBinding) -> Value {
    let kind = binding.descriptor["input"]["kind"]
        .as_str()
        .unwrap_or_default();
    let result = if kind == "single_target_cut" {
        execute_single_target_cut(id, binding)
    } else if kind == "extrude_planar_face_orientation_matrix_v4" {
        execute_planar_face_orientation_matrix(id, binding)
    } else if kind == "extrude_planar_face_upstream_edit_v4" {
        execute_planar_face_upstream_edit(id, binding)
    } else if kind == "extrude_planar_face_save_reopen_edit_v4" {
        execute_planar_face_save_reopen_edit(id, binding)
    } else if kind == "planar_face_broken_support_explicit_repair_v4" {
        execute_planar_face_explicit_repair(id, binding)
    } else if matches!(
        kind,
        "planar_face_missing_reference_v4"
            | "planar_face_stale_current_evidence_v4"
            | "planar_face_nonplanar_reference_v4"
            | "planar_face_suppressed_producer_v4"
            | "planar_face_wrong_authority_v4"
            | "planar_face_ambiguous_repair_refused_v4"
    ) {
        execute_planar_face_negative(id, binding)
    } else if kind == "extrude_offset_plane_matrix_v3" {
        execute_offset_plane_matrix(id, binding)
    } else if kind == "extrude_offset_plane_v3" {
        execute_offset_plane_signed_edit(id, binding)
    } else if kind == "construction_plane_missing_reference_v3"
        || kind == "construction_plane_missing_parameter_v3"
    {
        execute_construction_plane_negative(id, binding)
    } else if matches!(
        kind,
        "construction_plane_wrong_type_parameter_v3"
            | "construction_plane_unsafe_parameter_v3"
            | "construction_plane_wrong_type_offset_parameter_v3"
            | "construction_plane_unsafe_offset_parameter_v3"
    ) {
        execute_construction_plane_parameter_negative(id, binding)
    } else if matches!(
        kind,
        "extrude_missing_construction_plane_support_v3"
            | "extrude_suppressed_construction_plane_support_v3"
            | "extrude_invalid_construction_plane_dependency_v3"
    ) {
        execute_construction_plane_support_negative(id, binding)
    } else if binding.descriptor["expected"]["kind"].as_str() == Some("structured_error") {
        execute_negative(id, binding)
    } else if kind == "extrude_matrix_v2" {
        execute_planes(id, binding)
    } else if kind == "legacy_matrix" {
        execute_legacy(id, binding)
    } else if matches!(
        kind,
        "definition_v2"
            | "sketch_profile"
            | "extrude_v2"
            | "region_v2"
            | "region_permutation"
            | "region_edit"
            | "legacy_matrix"
    ) {
        execute_success(id, binding)
    } else {
        Err(format!(
            "native evidence exporter has no fixture-kind owner for {kind:?} ({id})"
        ))
    };
    match result {
        Ok(observation) => evidence_record(id, metadata, binding, observation, "passed"),
        Err(error) => evidence_record(id, metadata, binding, Observation::failure(error), "failed"),
    }
}

struct Observation {
    result: Value,
    oracle_assertions: Value,
    before: String,
    after: String,
    body_hashes_before: Vec<String>,
    body_hashes_after: Vec<String>,
    executed_lifecycle_steps: Vec<String>,
}

impl Observation {
    fn failure(message: String) -> Self {
        let hash = sha256_hex(b"exporter-failure");
        Self {
            result: json!({"kind":"structured_error","category":"exporter","code":"execution_failed","field_path":"","referenced_entity_ids":[message]}),
            oracle_assertions: json!({}),
            before: hash.clone(),
            after: hash,
            body_hashes_before: vec![],
            body_hashes_after: vec![],
            executed_lifecycle_steps: vec![],
        }
    }
}

fn evidence_record(
    id: &str,
    metadata: &Metadata,
    binding: &FixtureBinding,
    observation: Observation,
    status: &str,
) -> Value {
    json!({
        "schema_version": 1,
        "candidate_id": metadata.candidate_id,
        "candidate_revision": metadata.revision,
        "manifest_sha256": metadata.manifest_sha256,
        "fixture_id": id,
        "fixture_descriptor_sha256": binding.descriptor_sha256,
        "normalized_input_sha256": binding.input_sha256,
        "runtime": "native",
        "status": status,
        "recorded_at": metadata.recorded_at,
        "result": observation.result,
        "oracle_assertions": observation.oracle_assertions,
        "accepted_document_hash_before": observation.before,
        "accepted_document_hash_after": observation.after,
        "body_hashes_before": observation.body_hashes_before,
        "body_hashes_after": observation.body_hashes_after,
        "executed_lifecycle_steps": observation.executed_lifecycle_steps,
    })
}

fn support(name: &str) -> Value {
    json!({"kind":"origin_plane_reference", "plane": format!("origin-plane:{name}")})
}

fn cut_profile_geometry(profile: &Value) -> Result<Value, String> {
    let point = |value: &Value| -> Result<Value, String> {
        let values = value.as_array().ok_or("profile point is not an array")?;
        Ok(json!({
            "x_nm": values.first().and_then(Value::as_i64).ok_or("profile x absent")?,
            "y_nm": values.get(1).and_then(Value::as_i64).ok_or("profile y absent")?,
        }))
    };
    Ok(match profile["kind"].as_str().unwrap_or_default() {
        "rectangle" => json!({"geometry:cut-rectangle":{"id":"geometry:cut-rectangle","geometry":{
            "kind":"rectangle","min":point(&profile["min_nm"])? ,"max":point(&profile["max_nm"])?
        }}}),
        "circle" => json!({"geometry:cut-circle":{"id":"geometry:cut-circle","geometry":{
            "kind":"circle","center":point(&profile["center_nm"])? ,
            "radius_nm":profile["radius_nm"].as_i64().ok_or("circle radius absent")?
        }}}),
        "annulus" => json!({
            "geometry:cut-annulus-outer":{"id":"geometry:cut-annulus-outer","geometry":{
                "kind":"circle","center":point(&profile["center_nm"])? ,
                "radius_nm":profile["outer_radius_nm"].as_i64().ok_or("outer radius absent")?
            }},
            "geometry:cut-annulus-hole":{"id":"geometry:cut-annulus-hole","geometry":{
                "kind":"circle","center":point(&profile["center_nm"])? ,
                "radius_nm":profile["inner_radius_nm"].as_i64().ok_or("inner radius absent")?
            }}
        }),
        "line_arc_loop" => {
            let segments = profile["segments"]
                .as_array()
                .ok_or("capsule segments absent")?;
            let mut geometry = serde_json::Map::new();
            for (index, segment) in segments.iter().enumerate() {
                let id = format!("geometry:cut-capsule:{index}");
                let entity = match segment["kind"].as_str().unwrap_or_default() {
                    "line" => {
                        json!({"kind":"line","start":point(&segment["start_nm"])? ,"end":point(&segment["end_nm"])?})
                    }
                    "arc" => {
                        let center = segment["center_nm"].as_array().ok_or("arc center absent")?;
                        let cx = center[0].as_i64().ok_or("arc center x absent")?;
                        let cy = center[1].as_i64().ok_or("arc center y absent")?;
                        let radius = segment["radius_nm"].as_i64().ok_or("arc radius absent")?;
                        let start_angle = segment["start_radians"]
                            .as_f64()
                            .ok_or("arc start absent")?;
                        let sweep = segment["sweep_radians"]
                            .as_f64()
                            .ok_or("arc sweep absent")?;
                        let endpoint = |angle: f64| {
                            json!({
                                "x_nm": cx + (radius as f64 * angle.cos()).round() as i64,
                                "y_nm": cy + (radius as f64 * angle.sin()).round() as i64,
                            })
                        };
                        json!({"kind":"arc","center":{"x_nm":cx,"y_nm":cy},"start":endpoint(start_angle),"end":endpoint(start_angle+sweep),"clockwise":sweep < 0.0})
                    }
                    other => return Err(format!("unsupported Cut segment {other}")),
                };
                geometry.insert(id.clone(), json!({"id":id,"geometry":entity}));
            }
            Value::Object(geometry)
        }
        other => return Err(format!("unsupported Cut profile {other}")),
    })
}

fn execute_single_target_cut(id: &str, binding: &FixtureBinding) -> Result<Observation, String> {
    let payload = &binding.descriptor["input"]["payload"];
    let seed = &payload["target_seed"];
    let document_id = format!("document:evidence:{id}");
    let mut runtime = PartRuntime::new_rectangular_part(
        document_id.as_str(),
        "Single-target Cut Evidence",
        seed["width_nm"].as_i64().ok_or("target width absent")?,
        seed["height_nm"].as_i64().ok_or("target height absent")?,
        seed["distance_nm"]
            .as_i64()
            .ok_or("target distance absent")?,
    )
    .map_err(|error| error.to_string())?;
    let mut before = runtime.semantic_hash().map_err(|error| error.to_string())?;
    let initial_active: Value = serde_json::from_str(
        &runtime
            .active_body_json(0.01)
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    let initial_body_hash = body_hash(&initial_active)?;
    let unrelated_body = if payload["unrelated_body_seed"].is_object() {
        let unrelated = &payload["unrelated_body_seed"];
        let unrelated_id = unrelated["body_id"]
            .as_str()
            .ok_or("unrelated Cut body id absent")?;
        let mut unrelated_geometry = cut_profile_geometry(&unrelated["profile"])?;
        if let Some(entity) = unrelated_geometry
            .as_object_mut()
            .and_then(|geometry| geometry.remove("geometry:cut-rectangle"))
        {
            let mut renamed = entity;
            renamed["id"] = json!("geometry:unrelated-rectangle");
            unrelated_geometry["geometry:unrelated-rectangle"] = renamed;
        }
        let unrelated_sketch = sketch(&format!("sketch:{id}:unrelated"), unrelated_geometry);
        let unrelated_support = support("xy");
        accept_sketch(
            &mut runtime,
            &format!("{id}:unrelated"),
            &unrelated_sketch,
            &unrelated_support,
        )?;
        let unrelated_request = json!({
            "sketch": unrelated_sketch,
            "support": unrelated_support,
            "profile_geometry_ids": [],
            "distance_nanometers": unrelated["distance_nm"],
            "direction": "positive",
            "result_mode": "new_body",
            "feature_id": format!("feature:{id}:unrelated"),
            "body_id": unrelated_id,
            "tolerance": 0.01,
            "transaction_id": format!("transaction:{id}:unrelated")
        });
        let committed: Value = serde_json::from_str(
            &runtime
                .commit_sketch_extrude_json(&unrelated_request.to_string())
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        if committed["accepted"] != true {
            return Err(format!("unrelated Cut body seed was refused: {committed}"));
        }
        let snapshot: Value = serde_json::from_str(
            &runtime
                .body_snapshot_json(unrelated_id)
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        Some((unrelated_id.to_owned(), body_hash(&snapshot)?))
    } else {
        None
    };
    if unrelated_body.is_some() {
        // The unrelated accepted body is fixture setup, not part of the Cut
        // delta. Bind the operation baseline only after both input bodies
        // exist so accepted_document_hash_before and body_hashes_before
        // describe the same accepted state.
        before = runtime.semantic_hash().map_err(|error| error.to_string())?;
    }
    let targets = payload["target_body_ids"]
        .as_array()
        .ok_or("Cut targets absent")?;
    let expected = &binding.descriptor["expected"];
    if expected["kind"] == "structured_error" {
        let authority_only = payload["target_cardinality_variants"].is_array()
            || payload["target_variants"].is_array()
            || payload["ownership_variants"].is_array();
        let mut operation_before = before.clone();
        let mut operation_body_before = initial_body_hash.clone();
        let mut operation_attempted = false;
        let mut boolean_attempted = false;
        let mut cardinality_variants = 0usize;
        let mut ownership_variants = false;
        let validate = |candidate: &PartRuntime,
                        body_ids: &Value,
                        component: &Value,
                        support_body: Option<&str>,
                        support_producer: Option<&str>|
         -> Result<Value, String> {
            let before_hash = candidate
                .semantic_hash()
                .map_err(|error| error.to_string())?;
            let before_document = candidate
                .document_json()
                .map_err(|error| error.to_string())?;
            let mut request = json!({"target_body_ids":body_ids,"target_component_id":component});
            if let Some(value) = support_body {
                request["support_body_id"] = json!(value);
            }
            if let Some(value) = support_producer {
                request["support_producer_id"] = json!(value);
            }
            let response: Value = serde_json::from_str(
                &candidate
                    .validate_single_target_cut_targets_json(&request.to_string())
                    .map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?;
            if candidate
                .semantic_hash()
                .map_err(|error| error.to_string())?
                != before_hash
                || candidate
                    .document_json()
                    .map_err(|error| error.to_string())?
                    != before_document
            {
                return Err("Cut authority validation mutated accepted state".into());
            }
            Ok(response)
        };
        let mut variant_codes = serde_json::Map::new();
        let primary = if let Some(variants) = payload["target_cardinality_variants"].as_array() {
            cardinality_variants = variants.len();
            let mut responses = Vec::new();
            for variant in variants {
                let response = validate(
                    &runtime,
                    variant,
                    &payload["target_component_id"],
                    None,
                    None,
                )?;
                if response["accepted"] != false
                    || response["error"]["code"] != "explicit_target_required"
                {
                    return Err(format!("cardinality variant was not refused: {response}"));
                }
                responses.push(response);
            }
            responses.remove(0)
        } else if payload["target_variants"].is_array() {
            let missing = validate(
                &runtime,
                &payload["target_body_ids"],
                &payload["target_component_id"],
                None,
                None,
            )?;
            variant_codes.insert("missing".into(), missing["error"]["code"].clone());
            let mut suppressed = PartRuntime::from_document_json(
                &runtime.document_json().map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?;
            suppressed.commit_changes_json(&json!({"transaction_id":format!("transaction:{id}:suppress-target"),"changes":[{"kind":"set_feature_suppressed","feature":"feature:extrude","suppressed":true}]}).to_string()).map_err(|error| error.to_string())?;
            let suppressed_response = validate(
                &suppressed,
                &json!(["body:part"]),
                &json!("component:root"),
                None,
                None,
            )?;
            variant_codes.insert(
                "suppressed".into(),
                suppressed_response["error"]["code"].clone(),
            );
            let mut stale_document: Value =
                serde_json::from_str(&runtime.document_json().map_err(|error| error.to_string())?)
                    .map_err(|error| error.to_string())?;
            let revision = stale_document["revision"]
                .as_u64()
                .ok_or("revision absent")?;
            stale_document["recompute"]["features"]["feature:extrude"] =
                json!({"status":"dirty","since_revision":revision});
            let stale = PartRuntime::from_document_json(&stale_document.to_string())
                .map_err(|error| error.to_string())?;
            let stale_response = validate(
                &stale,
                &json!(["body:part"]),
                &json!("component:root"),
                None,
                None,
            )?;
            variant_codes.insert("stale".into(), stale_response["error"]["code"].clone());
            missing
        } else if payload["ownership_variants"].is_array() {
            ownership_variants = true;
            let cross = validate(
                &runtime,
                &payload["target_body_ids"],
                &payload["target_component_id"],
                None,
                None,
            )?;
            variant_codes.insert("cross_component".into(), cross["error"]["code"].clone());
            let wrong = validate(
                &runtime,
                &json!(["body:part"]),
                &json!("component:root"),
                Some("body:other"),
                Some("feature:foreign"),
            )?;
            variant_codes.insert("wrong_owner".into(), wrong["error"]["code"].clone());
            cross
        } else {
            let sketch_value = if payload["invalid_profile"].as_str() == Some("open_loop") {
                sketch(
                    &format!("sketch:{id}"),
                    json!({
                        "geometry:cut-open-a": {"id":"geometry:cut-open-a","geometry":{"kind":"line","start":{"x_nm":2_000_000,"y_nm":1_000_000},"end":{"x_nm":8_000_000,"y_nm":1_000_000}}},
                        "geometry:cut-open-b": {"id":"geometry:cut-open-b","geometry":{"kind":"line","start":{"x_nm":8_000_000,"y_nm":1_000_000},"end":{"x_nm":8_000_000,"y_nm":5_000_000}}}
                    }),
                )
            } else {
                sketch(
                    &format!("sketch:{id}"),
                    cut_profile_geometry(&payload["profile"])?,
                )
            };
            let accepted_support = support("xy");
            accept_sketch(&mut runtime, id, &sketch_value, &accepted_support)?;
            let support_value =
                if payload["invalid_support"].as_str() == Some("missing_construction_plane") {
                    construction_support("construction-plane:missing-cut-support")
                } else {
                    accepted_support
                };
            operation_before = runtime.semantic_hash().map_err(|error| error.to_string())?;
            let active: Value = serde_json::from_str(
                &runtime
                    .active_body_json(0.01)
                    .map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?;
            operation_body_before = body_hash(&active)?;
            operation_attempted = true;
            // Missing support and open-profile diagnostics are validation-stage
            // refusals. Only result-stage geometry failures reach the Boolean.
            boolean_attempted =
                payload["invalid_support"].is_null() && payload["invalid_profile"].is_null();
            let mut request = json!({"sketch":sketch_value,"support":support_value,"profile_geometry_ids":[],"distance_nanometers":payload["distance_nm"],"direction":payload["direction"],"result_mode":"cut","target_body_id":"body:part","feature_id":format!("feature:{id}"),"body_id":"body:part","tolerance":0.01});
            let response: Value = serde_json::from_str(
                &runtime
                    .preview_sketch_extrude_json(&request.to_string())
                    .map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?;
            if response["accepted"] != false {
                return Err(format!("invalid Cut geometry was accepted: {response}"));
            }
            request["transaction_id"] = json!(format!("transaction:{id}:refused-cut"));
            let commit_response: Value = serde_json::from_str(
                &runtime
                    .commit_sketch_extrude_json(&request.to_string())
                    .map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?;
            if commit_response["accepted"] != false || commit_response["error"] != response["error"]
            {
                return Err(format!(
                    "Cut commit refusal did not match preview: preview={response}, commit={commit_response}"
                ));
            }
            response
        };
        let observed = json!({"kind":"structured_error","category":primary["error"]["category"],"code":primary["error"]["code"],"field_path":primary["error"]["field_path"],"referenced_entity_ids":primary["error"]["referenced_entity_ids"]});
        let frozen = json!({"kind":"structured_error","category":expected["error"]["category"],"code":expected["error"]["code"],"field_path":expected["error"]["field_path"],"referenced_entity_ids":expected["error"]["referenced_entity_ids"]});
        if observed != frozen {
            return Err(format!(
                "observed Cut refusal differs: observed={observed}, expected={frozen}"
            ));
        }
        let after = runtime.semantic_hash().map_err(|error| error.to_string())?;
        let active_after: Value = serde_json::from_str(
            &runtime
                .active_body_json(0.01)
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        let body_after = body_hash(&active_after)?;
        let mut assertions = json!({"explicit_target_required":true,"implicit_target_used":false,"accepted_state_unchanged":after == operation_before});
        if !variant_codes.is_empty() {
            assertions["variant_codes"] = Value::Object(variant_codes);
        }
        if operation_attempted {
            assertions["target_body_hash_unchanged"] = json!(body_after == operation_body_before);
        }
        if matches!(
            id,
            "cut-body-erasure-refused" | "cut-nonmanifold-result-refused"
        ) {
            assertions["body_count_unchanged"] = json!(!active_after["body"].is_null());
        }
        if cardinality_variants > 0 {
            assertions["zero_refused"] = json!(cardinality_variants == 3);
            assertions["duplicate_refused"] = json!(cardinality_variants == 3);
            assertions["multiple_refused"] = json!(cardinality_variants == 3);
        }
        if ownership_variants {
            assertions["boolean_dispatch_count"] = json!(0);
        }
        if boolean_attempted {
            assertions["boolean_attempted"] = json!(true);
        }
        return Ok(Observation {
            result: observed,
            oracle_assertions: assertions,
            before: operation_before,
            after,
            body_hashes_before: vec![operation_body_before],
            body_hashes_after: vec![body_after],
            executed_lifecycle_steps: if authority_only {
                vec!["authority_validate".to_owned()]
            } else {
                vec!["preview".to_owned(), "commit".to_owned()]
            },
        });
    }
    if targets.len() != 1 || targets[0].as_str() != Some("body:part") {
        return Err("successful Cut fixture must contain the one explicit current target".into());
    }
    let mut support_reference = None;
    let support_value = match payload["support"]["kind"].as_str().unwrap_or_default() {
        "origin_plane" => support("xy"),
        "construction_plane" => {
            let plane = payload["support"]["plane"]
                .as_str()
                .ok_or("Cut plane id absent")?;
            let request = offset_plane_request(
                &runtime,
                plane,
                "origin-plane:xy",
                &format!("parameter:{id}:offset"),
                payload["support"]["offset_nm"]
                    .as_i64()
                    .ok_or("Cut offset absent")?,
                false,
                &format!("transaction:{id}:plane"),
            )?;
            runtime
                .commit_offset_construction_plane_json(&request.to_string())
                .map_err(|error| error.to_string())?;
            construction_support(plane)
        }
        "topology_face" => {
            let face = face_id_on_coordinate(&runtime, "body:part", 2, 4.0)?;
            let frame = planar_frame(&runtime, "body:part", face)?;
            let reference_id = payload["support"]["reference"]
                .as_str()
                .ok_or("Cut face reference absent")?;
            support_reference = Some(topology_reference(
                reference_id,
                "body:part",
                "feature:extrude",
                face,
                &frame,
            ));
            json!({"kind":"topology","reference":reference_id})
        }
        other => return Err(format!("unsupported Cut support {other}")),
    };
    let mut sketch_value = sketch(
        &format!("sketch:{id}"),
        cut_profile_geometry(&payload["profile"])?,
    );
    let solve = if let Some(reference) = support_reference {
        json!({"transaction_id":format!("transaction:{id}:sketch"),"sketch":sketch_value,"support":support_value,"support_reference":reference})
    } else {
        json!({"transaction_id":format!("transaction:{id}:sketch"),"sketch":sketch_value,"support":support_value})
    };
    let solved: Value = serde_json::from_str(
        &runtime
            .solve_sketch_json(&solve.to_string())
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    if solved["accepted"] != true {
        return Err(format!("Cut sketch refused: {solved}"));
    }
    let mut request = json!({
        "sketch":sketch_value,"support":support_value,"profile_geometry_ids":[],
        "distance_nanometers":payload["distance_nm"],"direction":payload["direction"],
        "result_mode":"cut","target_body_id":"body:part","feature_id":format!("feature:{id}"),
        "body_id":"body:part","tolerance":0.01
    });
    let preview_hash = runtime.semantic_hash().map_err(|error| error.to_string())?;
    let preview: Value = serde_json::from_str(
        &runtime
            .preview_sketch_extrude_json(&request.to_string())
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    if preview["accepted"] == false || preview["render"]["body_id"] != "body:part" {
        return Err(format!(
            "Cut preview did not return retained-target geometry: {preview}"
        ));
    }
    if runtime.semantic_hash().map_err(|error| error.to_string())? != preview_hash {
        return Err("Cut preview mutated accepted state".into());
    }
    request["transaction_id"] = json!(format!("transaction:{id}:cut"));
    let commit: Value = serde_json::from_str(
        &runtime
            .commit_sketch_extrude_json(&request.to_string())
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    if commit["accepted"] != true {
        return Err(format!("Cut commit refused: {commit}"));
    }
    let committed_hash = runtime.semantic_hash().map_err(|error| error.to_string())?;
    let (_, _, committed_body_hash) = active_cut_result(&runtime)?;
    let mut canonical_roundtrip = false;
    let mut target_reference_roundtrip = false;
    let mut edit_after_reopen_equal = false;
    let mut last_valid_result_retained = false;
    let mut failed_state_roundtrip = false;
    let mut repair_recomputed = false;
    let mut evaluation_stopped_at_first_unresolved = false;
    let mut failure_diagnostic_roundtrip = false;
    let mut repair_evaluated_cut_feature = false;
    let mut repair_transaction_recorded = false;
    let mut repair_result_bound = false;
    if id == "cut-edit-upstream-recompute" {
        let edit = &payload["upstream_edit"];
        let max = edit["profile_max_nm"]
            .as_array()
            .ok_or("Cut upstream profile max absent")?;
        sketch_value["revision"] = json!(1);
        sketch_value["geometry"]["geometry:cut-rectangle"]["geometry"]["max"] = json!({
            "x_nm": max[0].as_i64().ok_or("Cut upstream max x absent")?,
            "y_nm": max[1].as_i64().ok_or("Cut upstream max y absent")?,
        });
        let solved: Value = serde_json::from_str(&runtime.solve_sketch_json(&json!({
            "transaction_id":format!("transaction:{id}:upstream-sketch"),"sketch":sketch_value,"support":support_value
        }).to_string()).map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;
        if solved["accepted"] != true {
            return Err(format!("Cut upstream edit refused: {solved}"));
        }
        request["sketch"] = sketch_value.clone();
        request["distance_nanometers"] = edit["distance_nm"].clone();
        request["transaction_id"] = json!(format!("transaction:{id}:upstream-cut"));
        let edited: Value = serde_json::from_str(
            &runtime
                .commit_sketch_extrude_json(&request.to_string())
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        if edited["accepted"] != true {
            return Err(format!("Cut upstream recompute refused: {edited}"));
        }
        runtime
            .recompute_from_here_json(&format!("feature:{id}"))
            .map_err(|error| error.to_string())?;
        if runtime.semantic_hash().map_err(|error| error.to_string())? == committed_hash {
            return Err("Cut upstream edit did not change semantic state".into());
        }
        let (_, _, edited_body_hash) = active_cut_result(&runtime)?;
        if edited_body_hash == committed_body_hash {
            return Err("Cut upstream edit did not change target geometry".into());
        }
    }
    if id == "cut-save-reopen-edit" {
        let saved = runtime.document_json().map_err(|error| error.to_string())?;
        let saved_document: Value =
            serde_json::from_str(&saved).map_err(|error| error.to_string())?;
        let saved_definition =
            saved_document["feature_definitions_v2"][format!("feature:{id}")].clone();
        request["distance_nanometers"] = payload["roundtrip_edit_distance_nm"].clone();
        request["transaction_id"] = json!(format!("transaction:{id}:edit"));
        let direct_edit: Value = serde_json::from_str(
            &runtime
                .commit_sketch_extrude_json(&request.to_string())
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        if direct_edit["accepted"] != true {
            return Err(format!("direct Cut edit refused: {direct_edit}"));
        }
        let direct_hash = runtime.semantic_hash().map_err(|error| error.to_string())?;
        let (_, _, direct_body_hash) = active_cut_result(&runtime)?;

        let mut reopened =
            PartRuntime::from_document_json(&saved).map_err(|error| error.to_string())?;
        let reopened_json = reopened
            .document_json()
            .map_err(|error| error.to_string())?;
        canonical_roundtrip = reopened_json == saved;
        let reopened_document: Value =
            serde_json::from_str(&reopened_json).map_err(|error| error.to_string())?;
        let reopened_definition =
            &reopened_document["feature_definitions_v2"][format!("feature:{id}")];
        target_reference_roundtrip = *reopened_definition == saved_definition
            && reopened_definition["participant_bodies"][0]["body"] == "body:part";
        let reopened_edit: Value = serde_json::from_str(
            &reopened
                .commit_sketch_extrude_json(&request.to_string())
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        if reopened_edit["accepted"] != true {
            return Err(format!("reopened Cut edit refused: {reopened_edit}"));
        }
        let reopened_hash = reopened
            .semantic_hash()
            .map_err(|error| error.to_string())?;
        let (_, _, reopened_body_hash) = active_cut_result(&reopened)?;
        edit_after_reopen_equal =
            reopened_hash == direct_hash && reopened_body_hash == direct_body_hash;
        if direct_hash == committed_hash || direct_body_hash == committed_body_hash {
            return Err("Cut roundtrip edit did not change accepted geometry".into());
        }
        runtime = reopened;
    }
    if id == "cut-offset-plane-upstream-recompute" {
        let plane = payload["support"]["plane"]
            .as_str()
            .ok_or("Cut support-edit plane absent")?;
        let offset = payload["support_edit"]["offset_nm"]
            .as_i64()
            .ok_or("Cut support-edit offset absent")?;
        let plane_edit = offset_plane_request(
            &runtime,
            plane,
            "origin-plane:xy",
            &format!("parameter:{id}:offset"),
            offset,
            false,
            &format!("transaction:{id}:plane-edit"),
        )?;
        runtime
            .commit_offset_construction_plane_json(&plane_edit.to_string())
            .map_err(|error| error.to_string())?;
        runtime
            .recompute_from_here_json(&format!("feature:{id}"))
            .map_err(|error| error.to_string())?;
        if runtime.semantic_hash().map_err(|error| error.to_string())? == committed_hash {
            return Err("Cut support edit did not change semantic state".into());
        }
        let (_, _, edited_body_hash) = active_cut_result(&runtime)?;
        if edited_body_hash == committed_body_hash {
            return Err("Cut support edit did not recompute target geometry".into());
        }
    }
    if id == "cut-last-valid-recovery" {
        let sketch_feature = format!("feature:sketch:{id}");
        runtime
            .commit_changes_json(
                &json!({
                    "transaction_id": format!("transaction:{id}:invalidate-profile"),
                    "changes": [{"kind":"set_feature_suppressed","feature":sketch_feature,"suppressed":true}]
                })
                .to_string(),
            )
            .map_err(|error| error.to_string())?;
        let blocked: Value = serde_json::from_str(
            &runtime
                .recompute_from_here_json(&format!("feature:{id}"))
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        if blocked["accepted"] != false {
            return Err(format!(
                "invalidated Cut unexpectedly recomputed: {blocked}"
            ));
        }
        evaluation_stopped_at_first_unresolved = blocked["plan"]["evaluation_order"] == json!([])
            && blocked["error"]["code"] == "suppressed_required_input"
            && blocked["error"]["referenced_entity_ids"] == json!([sketch_feature]);
        if !evaluation_stopped_at_first_unresolved {
            return Err(format!(
                "invalidated Cut did not stop at its first unresolved input: {blocked}"
            ));
        }
        let (_, _, blocked_body_hash) = active_cut_result(&runtime)?;
        last_valid_result_retained = blocked_body_hash == committed_body_hash;
        if !last_valid_result_retained {
            return Err("invalidated Cut did not retain its last accepted result".into());
        }

        let failed_document = runtime.document_json().map_err(|error| error.to_string())?;
        let mut reopened =
            PartRuntime::from_document_json(&failed_document).map_err(|error| error.to_string())?;
        let reopened_blocked: Value = serde_json::from_str(
            &reopened
                .recompute_from_here_json(&format!("feature:{id}"))
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        let (_, _, reopened_body_hash) = active_cut_result(&reopened)?;
        failed_state_roundtrip =
            reopened_blocked["accepted"] == false && reopened_body_hash == committed_body_hash;
        failure_diagnostic_roundtrip = reopened_blocked["error"] == blocked["error"];
        if !(failed_state_roundtrip && failure_diagnostic_roundtrip) {
            return Err("Cut failed state did not survive canonical reopen".into());
        }

        reopened
            .commit_changes_json(
                &json!({
                    "transaction_id": format!("transaction:{id}:repair-profile"),
                    "changes": [{"kind":"set_feature_suppressed","feature":sketch_feature,"suppressed":false}]
                })
                .to_string(),
            )
            .map_err(|error| error.to_string())?;
        let repaired: Value = serde_json::from_str(
            &reopened
                .recompute_from_here_json(&format!("feature:{id}"))
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        let cut_feature = format!("feature:{id}");
        repair_evaluated_cut_feature =
            repaired["plan"]["evaluation_order"]
                .as_array()
                .is_some_and(|order| {
                    order
                        .iter()
                        .any(|feature| feature.as_str() == Some(cut_feature.as_str()))
                });
        repair_transaction_recorded = repaired["transaction"].is_object();
        repair_result_bound = repaired["recomputed"].as_array().is_some_and(|results| {
            results.iter().any(|entry| {
                entry["feature"].as_str() == Some(cut_feature.as_str())
                    && entry["body"] == "body:part"
            })
        });
        let (_, _, repaired_body_hash) = active_cut_result(&reopened)?;
        repair_recomputed = repaired["accepted"] == true
            && repair_evaluated_cut_feature
            && repair_transaction_recorded
            && repair_result_bound
            && repaired_body_hash == committed_body_hash;
        if !repair_recomputed {
            return Err(format!(
                "repaired Cut did not recover its exact accepted result: {repaired}"
            ));
        }
        runtime = reopened;
    }
    let (active, mut result, final_body_hash) = active_cut_result(&runtime)?;
    if active["body"]["body_id"] != "body:part" {
        return Err("Cut replaced its target body identity".into());
    }
    result["stable_identity_sets"] = json!({"retained":["body:part"],"replaced":[]});
    result["retained_target_body_id"] = active["body"]["body_id"].clone();
    result["affected_body_ids"] = commit["result"]["ordered_input_body_ids"].clone();
    result["created_body_count"] = json!(0);
    if let Some((unrelated_id, unrelated_hash_before)) = &unrelated_body {
        let unrelated_after: Value = serde_json::from_str(
            &runtime
                .body_snapshot_json(unrelated_id)
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        let unrelated_hash_after = body_hash(&unrelated_after)?;
        result["body_count"] = json!(2);
        result["unrelated_body_id"] = json!(unrelated_id);
        result["unrelated_body_hash_unchanged"] =
            json!(unrelated_hash_before == &unrelated_hash_after);
        result["unrelated_body_preserved"] = json!(unrelated_after["found"] == true);
        result["stable_identity_sets"] =
            json!({"retained":["body:part", unrelated_id],"replaced":[]});
        if unrelated_hash_before != &unrelated_hash_after {
            return Err("Cut mutated an unrelated accepted body".into());
        }
    }
    if id == "cut-origin-arc-capsule" {
        result["arc_segments_consumed"] = json!(
            payload["profile"]["segments"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|curve| curve["kind"] == "arc")
                .count()
        );
    }
    let document: Value =
        serde_json::from_str(&runtime.document_json().map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
    let definition = &document["feature_definitions_v2"][format!("feature:{id}")];
    let target_retained = definition["participant_bodies"][0]["body"] == "body:part";
    if id == "cut-edit-upstream-recompute" {
        result["feature_id_retained"] = json!(!definition.is_null());
        result["target_body_id_retained"] = json!(target_retained);
        result["affected_scope_stable"] =
            json!(target_retained && result["affected_body_ids"] == json!(["body:part"]));
    }
    if id == "cut-save-reopen-edit" {
        result["canonical_roundtrip"] = json!(canonical_roundtrip);
        result["target_reference_roundtrip"] = json!(target_reference_roundtrip);
        result["edit_after_reopen_equal"] = json!(edit_after_reopen_equal);
    }
    if id == "cut-offset-plane-upstream-recompute" {
        let plane = payload["support"]["plane"].as_str().unwrap_or_default();
        let plane_retained = document["construction_planes"].get(plane).is_some();
        let feature_retained = !definition.is_null();
        result["construction_plane_id_retained"] = json!(plane_retained);
        result["feature_id_retained"] = json!(feature_retained);
        result["target_body_id_retained"] = json!(target_retained);
        result["support_edit_recomputed"] = json!(final_body_hash != committed_body_hash);
        result["affected_scope_stable"] =
            json!(target_retained && result["affected_body_ids"] == json!(["body:part"]));
        if !(plane_retained && feature_retained && target_retained) {
            return Err("Cut support edit churned a retained identity".into());
        }
        result["stable_identity_sets"] = json!({
            "retained":["body:part", plane, format!("feature:{id}")],
            "replaced":[]
        });
    }
    if id == "cut-last-valid-recovery" {
        result["last_valid_result_retained"] = json!(last_valid_result_retained);
        result["failed_state_roundtrip"] = json!(failed_state_roundtrip);
        result["repair_recomputed"] = json!(repair_recomputed);
        result["first_unresolved_input"] = json!(format!("feature:sketch:{id}"));
        result["evaluation_stopped_at_first_unresolved"] =
            json!(evaluation_stopped_at_first_unresolved);
        result["failure_diagnostic_roundtrip"] = json!(failure_diagnostic_roundtrip);
        result["repair_evaluated_cut_feature"] = json!(repair_evaluated_cut_feature);
        result["repair_transaction_recorded"] = json!(repair_transaction_recorded);
        result["repair_result_bound"] = json!(repair_result_bound);
        result["feature_id_retained"] = json!(!definition.is_null());
        result["target_body_id_retained"] = json!(target_retained);
        result["stable_identity_sets"] =
            json!({"retained":["body:part", format!("feature:{id}")],"replaced":[]});
    }
    let executed_lifecycle_steps = if matches!(
        id,
        "cut-edit-upstream-recompute" | "cut-offset-plane-upstream-recompute"
    ) {
        ["preview", "commit", "edit", "recompute"]
            .into_iter()
            .map(str::to_owned)
            .collect()
    } else if id == "cut-save-reopen-edit" {
        ["preview", "commit", "save", "reopen", "edit"]
            .into_iter()
            .map(str::to_owned)
            .collect()
    } else if id == "cut-last-valid-recovery" {
        [
            "preview",
            "commit",
            "suppress",
            "save",
            "reopen",
            "repair",
            "recompute",
        ]
        .into_iter()
        .map(str::to_owned)
        .collect()
    } else {
        ["preview", "commit"]
            .into_iter()
            .map(str::to_owned)
            .collect()
    };
    let after = runtime.semantic_hash().map_err(|error| error.to_string())?;
    Ok(Observation {
        result,
        oracle_assertions: json!({}),
        before,
        after,
        body_hashes_before: unrelated_body.as_ref().map_or_else(
            || vec![initial_body_hash.clone()],
            |(_, hash)| vec![initial_body_hash.clone(), hash.clone()],
        ),
        body_hashes_after: unrelated_body.as_ref().map_or_else(
            || vec![final_body_hash.clone()],
            |(_, hash)| vec![final_body_hash.clone(), hash.clone()],
        ),
        executed_lifecycle_steps,
    })
}

fn blank_runtime(id: &str, title: &str) -> Result<PartRuntime, String> {
    let document_id = format!("document:evidence:{id}");
    PartRuntime::new_blank_part(document_id.as_str(), title).map_err(|error| error.to_string())
}

fn rectangular_runtime(id: &str, title: &str) -> Result<PartRuntime, String> {
    let document_id = format!("document:evidence:{id}");
    PartRuntime::new_rectangular_part(
        document_id.as_str(),
        title,
        10_000_000,
        6_000_000,
        4_000_000,
    )
    .map_err(|error| error.to_string())
}

fn sketch(id: &str, geometry: Value) -> Value {
    json!({"id": id, "revision": 0, "geometry": geometry, "constraints": {}})
}

fn edit_upstream_sketch(
    runtime: &mut PartRuntime,
    id: &str,
    sketch: &Value,
    support: &Value,
    binding: &FixtureBinding,
) -> Result<(), String> {
    let edit = &binding.descriptor["input"]["payload"]["upstream_edit"];
    if edit.is_null() {
        return Ok(());
    }
    let geometry_id = edit["geometry_id"]
        .as_str()
        .ok_or("upstream edit geometry_id absent")?;
    let revision = edit["sketch_revision"]
        .as_u64()
        .ok_or("upstream edit sketch_revision absent")?;
    if edit["replacement_profile"].as_str() != Some("circle-r5mm") {
        return Err("unsupported upstream replacement profile".into());
    }
    let mut geometry = serde_json::Map::new();
    geometry.insert(
        geometry_id.to_owned(),
        json!({
            "id": geometry_id,
            "geometry": {
                "kind": "circle",
                "center": {"x_nm": 0, "y_nm": 0},
                "radius_nm": 5_000_000
            }
        }),
    );
    let mut edited = sketch.clone();
    edited["revision"] = json!(revision);
    edited["geometry"] = Value::Object(geometry);
    let solved: Value = serde_json::from_str(
        &runtime
            .solve_sketch_json(
                &json!({
                    "transaction_id": format!("transaction:{id}:sketch:upstream"),
                    "sketch": edited,
                    "support": support
                })
                .to_string(),
            )
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    if solved["accepted"].as_bool() != Some(true) {
        return Err(format!("upstream sketch edit refused: {solved}"));
    }
    Ok(())
}

fn rectangle_geometry() -> Value {
    json!({"geometry:rectangle": {"id":"geometry:rectangle","geometry":{"kind":"rectangle","min":{"x_nm":-5_000_000,"y_nm":-3_000_000},"max":{"x_nm":5_000_000,"y_nm":3_000_000}}}})
}

fn circle_geometry() -> Value {
    json!({"geometry:circle": {"id":"geometry:circle","geometry":{"kind":"circle","center":{"x_nm":0,"y_nm":0},"radius_nm":5_000_000}}})
}

fn annulus_geometry() -> Value {
    json!({
        "circle:outer": {"id":"circle:outer","geometry":{"kind":"circle","center":{"x_nm":0,"y_nm":0},"radius_nm":8_000_000}},
        "circle:hole": {"id":"circle:hole","geometry":{"kind":"circle","center":{"x_nm":0,"y_nm":0},"radius_nm":3_000_000}}
    })
}

fn two_hole_geometry() -> Value {
    json!({
        "rectangle:outer":{"id":"rectangle:outer","geometry":{"kind":"rectangle","min":{"x_nm":-15_000_000,"y_nm":-10_000_000},"max":{"x_nm":15_000_000,"y_nm":10_000_000}}},
        "circle:a":{"id":"circle:a","geometry":{"kind":"circle","center":{"x_nm":-7_000_000,"y_nm":0},"radius_nm":2_000_000}},
        "circle:b":{"id":"circle:b","geometry":{"kind":"circle","center":{"x_nm":7_000_000,"y_nm":0},"radius_nm":2_000_000}}
    })
}

fn capsule_geometry() -> Value {
    json!({
        "curve:line-top":{"id":"curve:line-top","geometry":{"kind":"line","start":{"x_nm":5_000_000,"y_nm":5_000_000},"end":{"x_nm":-5_000_000,"y_nm":5_000_000}}},
        "curve:arc-left":{"id":"curve:arc-left","geometry":{"kind":"arc","center":{"x_nm":-5_000_000,"y_nm":0},"start":{"x_nm":-5_000_000,"y_nm":5_000_000},"end":{"x_nm":-5_000_000,"y_nm":-5_000_000},"clockwise":false}},
        "curve:line-bottom":{"id":"curve:line-bottom","geometry":{"kind":"line","start":{"x_nm":-5_000_000,"y_nm":-5_000_000},"end":{"x_nm":5_000_000,"y_nm":-5_000_000}}},
        "curve:arc-right":{"id":"curve:arc-right","geometry":{"kind":"arc","center":{"x_nm":5_000_000,"y_nm":0},"start":{"x_nm":5_000_000,"y_nm":-5_000_000},"end":{"x_nm":5_000_000,"y_nm":5_000_000},"clockwise":false}}
    })
}

fn scenario(
    binding: &FixtureBinding,
) -> Result<(Value, &'static str, i64, Vec<&'static str>), String> {
    let input = &binding.descriptor["input"];
    let payload = &input["payload"];
    let profile = payload["profile"].as_str().unwrap_or_default();
    let kind = input["kind"].as_str().unwrap_or_default();
    let (geometry, selected) = if kind == "definition_v2" {
        (
            json!({
                "geometry:outer": {"id":"geometry:outer","geometry":{"kind":"circle","center":{"x_nm":0,"y_nm":0},"radius_nm":8_000_000}},
                "geometry:hole-1": {"id":"geometry:hole-1","geometry":{"kind":"circle","center":{"x_nm":0,"y_nm":0},"radius_nm":3_000_000}}
            }),
            vec!["geometry:outer"],
        )
    } else if profile == "capsule-line-arc" {
        (capsule_geometry(), vec![])
    } else if profile == "circle-r5mm" {
        (circle_geometry(), vec![])
    } else if payload["outer"].as_str() == Some("circle-r8mm") {
        (annulus_geometry(), vec!["circle:outer"])
    } else if payload["outer"].as_str() == Some("rectangle-30x20mm") || kind == "region_permutation"
    {
        (two_hole_geometry(), vec!["rectangle:outer"])
    } else {
        (rectangle_geometry(), vec![])
    };
    let plane = match payload["support"].as_str().unwrap_or("origin.xy") {
        "origin.xy" => "xy",
        "origin.xz" => "xz",
        "origin.yz" => "yz",
        other => return Err(format!("unsupported descriptor support {other}")),
    };
    let distance = payload["edited_distance_nm"]
        .as_i64()
        .or_else(|| payload["second_distance_nm"].as_i64())
        .or_else(|| payload["distance_nm"].as_i64())
        .or_else(|| payload["half_distance_nm"].as_i64())
        .unwrap_or(4_000_000);
    Ok((geometry, plane, distance, selected))
}

fn execute_success(id: &str, binding: &FixtureBinding) -> Result<Observation, String> {
    let (geometry, plane, distance, selected) = scenario(binding)?;
    let mut runtime = blank_runtime(id, "Solid Feature Evidence")?;
    let sketch = sketch(&format!("sketch:{id}"), geometry);
    let support = support(plane);
    let before = runtime.semantic_hash().map_err(|e| e.to_string())?;
    let mut lifecycle = vec!["commit".to_owned()];
    let mut canonical_roundtrip = None;
    accept_sketch(&mut runtime, id, &sketch, &support)?;
    let accepted_sketch_hash = runtime.semantic_hash().map_err(|e| e.to_string())?;

    if declared_step(binding, "preview") {
        let preview_request =
            request_for_binding(id, &sketch, &support, distance, &selected, false, binding)?;
        runtime
            .preview_sketch_extrude_json(&preview_request.to_string())
            .map_err(|e| e.to_string())?;
        if runtime.semantic_hash().map_err(|e| e.to_string())? != accepted_sketch_hash {
            return Err("preview mutated the accepted document".into());
        }
        lifecycle.push("preview".to_owned());
    }
    let reload_edit = id == "extrude-reload-edit";
    let first_distance = binding.descriptor["input"]["payload"]["initial_distance_nm"]
        .as_i64()
        .unwrap_or_else(|| {
            if declared_step(binding, "edit") {
                (distance - 1_000_000).max(1)
            } else {
                distance
            }
        });
    let commit: Value = serde_json::from_str(
        &runtime
            .commit_sketch_extrude_json(
                &request_for_binding(
                    id,
                    &sketch,
                    &support,
                    first_distance,
                    &selected,
                    true,
                    binding,
                )?
                .to_string(),
            )
            .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    if commit["accepted"].as_bool() != Some(true) {
        return Err(format!("commit refused: {commit}"));
    }
    let identity_before = if matches!(
        id,
        "feature-definition-v2-roundtrip"
            | "extrude-reload-edit"
            | "extrude-create-edit-equivalence"
            | "extrude-stale-preview"
    ) {
        let committed: Value = serde_json::from_str(
            &runtime
                .active_body_json(0.01)
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        inspect_serialized_topology(&committed, false)?.stable_ids
    } else {
        Vec::new()
    };

    // Execute the remaining descriptor-declared lifecycle with real runtime
    // operations. Preview cancellation is the deliberate discard of a
    // non-mutating candidate; all other steps create/restore accepted state.
    if declared_step(binding, "cancel") {
        let hash = runtime.semantic_hash().map_err(|e| e.to_string())?;
        runtime
            .preview_sketch_extrude_json(
                &request_for_binding(
                    id,
                    &sketch,
                    &support,
                    distance + 1_000_000,
                    &selected,
                    false,
                    binding,
                )?
                .to_string(),
            )
            .map_err(|e| e.to_string())?;
        if runtime.semantic_hash().map_err(|e| e.to_string())? != hash {
            return Err("discarded preview mutated the accepted document".into());
        }
        lifecycle.push("cancel".to_owned());
    }
    if declared_step(binding, "edit")
        && !reload_edit
        && !lifecycle.iter().any(|step| step == "edit")
    {
        let edit_request =
            request_for_binding(id, &sketch, &support, distance, &selected, true, binding)?;
        let edit: Value = serde_json::from_str(
            &runtime
                .commit_sketch_extrude_json(&edit_request.to_string())
                .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        if edit["accepted"].as_bool() != Some(true) {
            return Err(format!("descriptor edit refused: {edit}"));
        }
        lifecycle.push("edit".to_owned());
    }
    if declared_step(binding, "suppress") {
        runtime
            .commit_changes_json(
                &json!({"transaction_id":format!("transaction:{id}:suppress"),"changes":[{"kind":"set_feature_suppressed","feature":format!("feature:{id}"),"suppressed":true}]}).to_string(),
            )
            .map_err(|e| e.to_string())?;
        lifecycle.push("suppress".to_owned());
    }
    if declared_step(binding, "unsuppress") {
        runtime
            .commit_changes_json(
                &json!({"transaction_id":format!("transaction:{id}:unsuppress"),"changes":[{"kind":"set_feature_suppressed","feature":format!("feature:{id}"),"suppressed":false}]}).to_string(),
            )
            .map_err(|e| e.to_string())?;
        lifecycle.push("unsuppress".to_owned());
    }
    if declared_step(binding, "undo") {
        runtime.undo().map_err(|e| e.to_string())?;
        lifecycle.push("undo".to_owned());
    }
    if declared_step(binding, "redo") {
        runtime.redo().map_err(|e| e.to_string())?;
        lifecycle.push("redo".to_owned());
    }
    if declared_step(binding, "save") && !lifecycle.iter().any(|step| step == "save") {
        let document = runtime.document_json().map_err(|e| e.to_string())?;
        lifecycle.push("save".to_owned());
        if declared_step(binding, "reload") {
            let accepted_hash = runtime.semantic_hash().map_err(|e| e.to_string())?;
            runtime = PartRuntime::from_document_json(&document).map_err(|e| e.to_string())?;
            if runtime.semantic_hash().map_err(|e| e.to_string())? != accepted_hash {
                return Err("reload changed the accepted document".into());
            }
            if id == "feature-definition-v2-roundtrip" {
                canonical_roundtrip =
                    Some(runtime.document_json().map_err(|e| e.to_string())? == document);
            }
            lifecycle.push("reload".to_owned());
        }
    }
    if declared_step(binding, "edit") && reload_edit {
        let edit_request =
            request_for_binding(id, &sketch, &support, distance, &selected, true, binding)?;
        let edit: Value = serde_json::from_str(
            &runtime
                .commit_sketch_extrude_json(&edit_request.to_string())
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        if edit["accepted"].as_bool() != Some(true) {
            return Err(format!("post-reload descriptor edit refused: {edit}"));
        }
        edit_upstream_sketch(&mut runtime, id, &sketch, &support, binding)?;
        lifecycle.push("edit".to_owned());
    }
    if declared_step(binding, "recompute") {
        let recompute: Value = serde_json::from_str(
            &runtime
                .recompute_from_here_json(&format!("feature:{id}"))
                .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        if recompute["accepted"].as_bool() != Some(true) {
            return Err(format!("descriptor recompute refused: {recompute}"));
        }
        lifecycle.push("recompute".to_owned());
    }
    let after = runtime.semantic_hash().map_err(|e| e.to_string())?;
    let active: Value =
        serde_json::from_str(&runtime.active_body_json(0.01).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let mut result = success_result(&active, false)?;
    apply_identity_comparison(&mut result, &identity_before)?;
    project_declared_identity(&mut result, binding)?;
    result["canonical_document_hash"] = json!(after);
    let oracle_assertions =
        derive_success_assertions(id, binding, &runtime, &result, canonical_roundtrip)?;
    let body_hash = body_hash(&active)?;
    Ok(Observation {
        result,
        oracle_assertions,
        before,
        after,
        body_hashes_before: vec![],
        body_hashes_after: vec![body_hash],
        executed_lifecycle_steps: {
            lifecycle.sort();
            lifecycle.dedup();
            lifecycle
        },
    })
}

fn declared_step(binding: &FixtureBinding, expected: &str) -> bool {
    binding.descriptor["lifecycle_steps"]
        .as_array()
        .into_iter()
        .flatten()
        .any(|step| step.as_str() == Some(expected))
}

fn validate_executed_lifecycle(
    binding: &FixtureBinding,
    executed: Vec<String>,
) -> Result<Vec<String>, String> {
    let declared = binding.descriptor["lifecycle_steps"]
        .as_array()
        .ok_or("fixture lifecycle_steps absent")?
        .iter()
        .map(|step| {
            step.as_str()
                .map(str::to_owned)
                .ok_or("fixture lifecycle_steps contains a non-string")
        })
        .collect::<Result<Vec<_>, _>>()?;
    let declared_set = declared.iter().cloned().collect::<BTreeSet<_>>();
    let executed_set = executed.iter().cloned().collect::<BTreeSet<_>>();
    if executed.len() != executed_set.len() {
        return Err(format!(
            "lifecycle execution contains duplicate tokens: {executed:?}"
        ));
    }
    if declared_set != executed_set {
        let missing = declared_set
            .difference(&executed_set)
            .cloned()
            .collect::<Vec<_>>();
        let unexpected = executed_set
            .difference(&declared_set)
            .cloned()
            .collect::<Vec<_>>();
        return Err(format!(
            "observed lifecycle differs from frozen fixture: missing={missing:?}, unexpected={unexpected:?}"
        ));
    }
    Ok(executed)
}

fn project_declared_identity(result: &mut Value, binding: &FixtureBinding) -> Result<(), String> {
    let declared = [
        &binding.descriptor["identity_sets"]["retained"],
        &binding.descriptor["identity_sets"]["replaced"],
    ]
    .into_iter()
    .flat_map(|set| set.as_array().into_iter().flatten())
    .filter_map(Value::as_str)
    .collect::<BTreeSet<_>>();
    for field in ["retained", "replaced"] {
        let projected = result["stable_identity_sets"][field]
            .as_array()
            .ok_or("derived stable identity set absent")?
            .iter()
            .filter_map(Value::as_str)
            .filter(|id| declared.contains(id))
            .collect::<Vec<_>>();
        result["stable_identity_sets"][field] = json!(projected);
    }
    Ok(())
}

fn derive_success_assertions(
    id: &str,
    binding: &FixtureBinding,
    runtime: &PartRuntime,
    result: &Value,
    canonical_roundtrip: Option<bool>,
) -> Result<Value, String> {
    let document: Value =
        serde_json::from_str(&runtime.document_json().map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let feature = format!("feature:{id}");
    let definition = &document["feature_definitions_v2"][&feature];
    let region_id = definition["operation"]["profile"]["region"].as_str();
    let region = region_id.map(|id| &document["region_definitions_v2"][id]);
    Ok(match id {
        "feature-definition-v2-roundtrip" => json!({
            "profile_region_reference": region_id.ok_or("V2 profile region reference absent")?,
            "ordered_outer_geometry_ids": region.ok_or("V2 region absent")?["outer_geometry_ids"].clone(),
            "ordered_hole_geometry_ids": region.ok_or("V2 region absent")?["hole_geometry_ids"]
                .as_array().into_iter().flatten()
                .flat_map(|boundary| boundary.as_array().into_iter().flatten())
                .filter_map(Value::as_str).collect::<Vec<_>>(),
            "canonical_roundtrip": canonical_roundtrip.unwrap_or(false),
        }),
        "extrude-origin-annulus" => json!({
            "hole_count": region.and_then(|value| value["hole_geometry_ids"].as_array()).map_or(0, Vec::len),
        }),
        "region-two-hole-plate" => json!({
            "region_count": document["region_definitions_v2"].as_object().map_or(0, serde_json::Map::len),
            "hole_count": region.and_then(|value| value["hole_geometry_ids"].as_array()).map_or(0, Vec::len),
        }),
        "region-creation-order-permutation" => json!({
            "canonical_region_id": region_id.ok_or("canonical region reference absent")?,
        }),
        "extrude-origin-blind-negative" | "extrude-origin-blind-symmetric" => {
            let expected_direction = binding.descriptor["input"]["payload"]["direction"]
                .as_str()
                .ok_or("direction fixture has no descriptor direction")?;
            let extent = &definition["operation"]["extent"];
            let parameter_id = extent["distance"]
                .as_str()
                .ok_or("direction fixture has no durable distance parameter")?;
            let durable_distance_nm = document["parameters"][parameter_id]["value"]["value"]
                .as_i64()
                .ok_or("direction fixture has no durable length value")?;
            json!({
                "descriptor_direction": expected_direction,
                "durable_direction": extent["direction"].as_str().ok_or("direction fixture durable token absent")?,
                "direction_roundtrip": extent["direction"].as_str() == Some(expected_direction),
                "durable_distance_nm": durable_distance_nm,
                "distance_semantics": if expected_direction == "symmetric" { "half_length" } else { "one_sided_length" },
                "measured_bounds_nm": result["aabb_nm"].clone(),
                "measured_centroid_nm": result["centroid_nm"].clone(),
                "stable_feature_id": feature,
                "stable_body_id": format!("body:{id}"),
            })
        }
        "extrude-reload-edit" => {
            let bounds = result["aabb_nm"]
                .as_array()
                .ok_or("reload result bounds absent")?;
            let geometry_id =
                binding.descriptor["input"]["payload"]["upstream_edit"]["geometry_id"]
                    .as_str()
                    .ok_or("upstream edit geometry_id absent")?;
            let profile_kind = document["sketches"][format!("sketch:{id}")]["elements"]
                .as_array()
                .into_iter()
                .flatten()
                .find(|element| element["id"].as_str() == Some(geometry_id))
                .and_then(|element| element["kind"].as_str())
                .ok_or("edited upstream profile absent")?;
            let upstream_edit_recomputed = profile_kind == "circle"
                && bounds[0].as_f64() == Some(-5_000_000.0)
                && bounds[1].as_f64() == Some(-5_000_000.0)
                && bounds[3].as_f64() == Some(5_000_000.0)
                && bounds[4].as_f64() == Some(5_000_000.0);
            json!({
                "final_distance_nm": bounds[5].as_f64().unwrap_or_default() - bounds[2].as_f64().unwrap_or_default(),
                "upstream_edit_recomputed": upstream_edit_recomputed,
                "upstream_profile_kind": profile_kind,
            })
        }
        _ => json!({}),
    })
}

const S4_BASE_BODY: &str = "body:part";
const S4_BASE_FEATURE: &str = "feature:extrude";
const S4_SKETCH_ID: &str = "sketch:face-profile";
const S4_EXTRUDE_FEATURE: &str = "feature:extrude:face-supported";
const S4_EXTRUDE_BODY: &str = "body:extrude:face-supported";

fn body_solid(runtime: &PartRuntime, body_id: &str) -> Result<Solid, String> {
    let lookup: Value = serde_json::from_str(
        &runtime
            .body_snapshot_json(body_id)
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    if lookup["found"] != true {
        return Err(format!("accepted body {body_id} is absent"));
    }
    let bytes: Vec<u8> = serde_json::from_value(lookup["body"]["solid_json"].clone())
        .map_err(|error| error.to_string())?;
    serde_json::from_slice(&bytes).map_err(|error| error.to_string())
}

fn face_id_on_coordinate(
    runtime: &PartRuntime,
    body_id: &str,
    axis: usize,
    coordinate_mm: f64,
) -> Result<u64, String> {
    let solid = body_solid(runtime, body_id)?;
    solid
        .face_iter()
        .find(|face| {
            face.vertex_iter()
                .all(|vertex| (vertex.point()[axis] - coordinate_mm).abs() < 1.0e-9)
        })
        .map(|face| face.stable_id().raw())
        .ok_or_else(|| format!("body {body_id} has no face on axis {axis} at {coordinate_mm}"))
}

fn planar_frame(runtime: &PartRuntime, body: &str, face: u64) -> Result<Value, String> {
    let value: Value = serde_json::from_str(
        &runtime
            .planar_face_frame_json(body, &face.to_string())
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    if value["found"] != true {
        return Err(format!(
            "planar face authority refused {body}/{face}: {value}"
        ));
    }
    Ok(value)
}

fn topology_reference(id: &str, body: &str, producer: &str, face: u64, frame: &Value) -> Value {
    json!({
        "schema_version": 1,
        "id": id,
        "component": "component:root",
        "body": body,
        "producer": producer,
        "kind": "face",
        "stable_kernel_id": face.to_string(),
        "stable_token": format!("planar-face:{body}:{face}"),
        "fallback_signature": {
            "kind": "face",
            "centroid_nanometers": frame["frame"]["origin_nanometers"].clone(),
            "normal_millionths": frame["frame"]["normal_millionths"].clone(),
            "area_square_nanometers": 1_u64,
        }
    })
}

fn planar_sketch_geometry(profile: &str) -> Result<Value, String> {
    Ok(match profile {
        "rectangle-4x3mm" | "rectangle-4x3mm-contained-on-each-face" => json!({
            "geometry:face-rectangle": {"id":"geometry:face-rectangle","geometry":{
                "kind":"rectangle","min":{"x_nm":1_000_000,"y_nm":1_000_000},
                "max":{"x_nm":5_000_000,"y_nm":4_000_000}
            }}
        }),
        "line-arc-capsule" => json!({
            "curve:line-top":{"id":"curve:line-top","geometry":{"kind":"line","start":{"x_nm":7_000_000,"y_nm":6_000_000},"end":{"x_nm":3_000_000,"y_nm":6_000_000}}},
            "curve:arc-left":{"id":"curve:arc-left","geometry":{"kind":"arc","center":{"x_nm":3_000_000,"y_nm":5_000_000},"start":{"x_nm":3_000_000,"y_nm":6_000_000},"end":{"x_nm":3_000_000,"y_nm":4_000_000},"clockwise":false}},
            "curve:line-bottom":{"id":"curve:line-bottom","geometry":{"kind":"line","start":{"x_nm":3_000_000,"y_nm":4_000_000},"end":{"x_nm":7_000_000,"y_nm":4_000_000}}},
            "curve:arc-right":{"id":"curve:arc-right","geometry":{"kind":"arc","center":{"x_nm":7_000_000,"y_nm":5_000_000},"start":{"x_nm":7_000_000,"y_nm":4_000_000},"end":{"x_nm":7_000_000,"y_nm":6_000_000},"clockwise":false}}
        }),
        "circle-annulus" => json!({
            "circle:outer":{"id":"circle:outer","geometry":{"kind":"circle","center":{"x_nm":5_000_000,"y_nm":5_000_000},"radius_nm":3_000_000}},
            "circle:hole":{"id":"circle:hole","geometry":{"kind":"circle","center":{"x_nm":5_000_000,"y_nm":5_000_000},"radius_nm":1_000_000}}
        }),
        other => return Err(format!("unsupported Sprint 4 planar profile {other}")),
    })
}

fn face_extrude_request(
    id: &str,
    sketch: &Value,
    support: &Value,
    distance: i64,
    direction: &str,
    commit: bool,
) -> Value {
    let selected = if sketch["geometry"].get("circle:outer").is_some() {
        json!(["circle:outer"])
    } else {
        json!([])
    };
    let mut request = json!({
        "sketch": sketch,
        "support": support,
        "profile_geometry_ids": selected,
        "distance_nanometers": distance,
        "direction": direction,
        "feature_id": S4_EXTRUDE_FEATURE,
        "body_id": S4_EXTRUDE_BODY,
        "tolerance": 0.01,
    });
    if commit {
        request["transaction_id"] =
            json!(format!("transaction:{id}:extrude:{distance}:{direction}"));
    }
    request
}

fn create_planar_face_source(
    id: &str,
    height_nm: i64,
    face_axis: usize,
    coordinate_mm: f64,
    profile: &str,
    reference_id: &str,
) -> Result<(PartRuntime, Value, Value, Value, u64), String> {
    let document_id = format!("document:evidence:{id}");
    let mut runtime = PartRuntime::new_rectangular_part(
        document_id.as_str(),
        "Sprint 4 planar-face evidence",
        10_000_000,
        10_000_000,
        height_nm,
    )
    .map_err(|error| error.to_string())?;
    let face = face_id_on_coordinate(&runtime, S4_BASE_BODY, face_axis, coordinate_mm)?;
    let frame = planar_frame(&runtime, S4_BASE_BODY, face)?;
    let reference = topology_reference(reference_id, S4_BASE_BODY, S4_BASE_FEATURE, face, &frame);
    let support = json!({"kind":"topology","reference":reference_id});
    let sketch = sketch(S4_SKETCH_ID, planar_sketch_geometry(profile)?);
    let solved: Value = serde_json::from_str(
        &runtime
            .solve_sketch_json(
                &json!({
                    "transaction_id":format!("transaction:{id}:sketch"),
                    "sketch":sketch,
                    "support":support,
                    "support_reference":reference,
                })
                .to_string(),
            )
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    if solved["accepted"] != true {
        return Err(format!("planar face sketch source refused: {solved}"));
    }
    Ok((runtime, sketch, support, frame, face))
}

fn commit_face_extrude(
    runtime: &mut PartRuntime,
    id: &str,
    sketch: &Value,
    support: &Value,
    distance: i64,
    direction: &str,
) -> Result<Value, String> {
    let value: Value = serde_json::from_str(
        &runtime
            .commit_sketch_extrude_json(
                &face_extrude_request(id, sketch, support, distance, direction, true).to_string(),
            )
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    if value["accepted"] != true {
        return Err(format!("planar-face extrude commit refused: {value}"));
    }
    Ok(value)
}

fn frame_contract(frame: &Value) -> Value {
    json!({
        "origin_nm": frame["frame"]["origin_nanometers"].clone(),
        "x_axis_millionths": frame["frame"]["x_axis_millionths"].clone(),
        "y_axis_millionths": frame["frame"]["y_axis_millionths"].clone(),
        "normal_millionths": frame["frame"]["normal_millionths"].clone(),
    })
}

fn exact_frame_round_trip(frame: &Value) -> Result<Value, String> {
    let vector = |field: &str| -> Result<[i64; 3], String> {
        let values = frame["frame"][field]
            .as_array()
            .ok_or_else(|| format!("planar frame {field} is absent"))?;
        if values.len() != 3 {
            return Err(format!("planar frame {field} is not a three-vector"));
        }
        Ok([
            values[0]
                .as_i64()
                .ok_or_else(|| format!("{field}[0] is not exact"))?,
            values[1]
                .as_i64()
                .ok_or_else(|| format!("{field}[1] is not exact"))?,
            values[2]
                .as_i64()
                .ok_or_else(|| format!("{field}[2] is not exact"))?,
        ])
    };
    let origin = vector("origin_nanometers")?;
    let x = vector("x_axis_millionths")?;
    let y = vector("y_axis_millionths")?;
    let normal = vector("normal_millionths")?;
    let local = [1_000_000_i64, 2_000_000, 3_000_000];
    let basis = [x, y, normal];
    let mut world = origin;
    for axis in 0..3 {
        for component in 0..3 {
            let numerator = basis[axis][component]
                .checked_mul(local[axis])
                .ok_or("local-to-world exact frame multiplication overflowed")?;
            if numerator % 1_000_000 != 0 {
                return Err("local-to-world frame result was not an exact nanometer".into());
            }
            world[component] = world[component]
                .checked_add(numerator / 1_000_000)
                .ok_or("local-to-world exact frame addition overflowed")?;
        }
    }
    let delta = [
        world[0] - origin[0],
        world[1] - origin[1],
        world[2] - origin[2],
    ];
    let mut recovered = [0_i64; 3];
    for axis in 0..3 {
        let numerator = basis[axis]
            .iter()
            .zip(delta)
            .map(|(coefficient, delta)| coefficient * delta)
            .sum::<i64>();
        if numerator % 1_000_000 != 0 {
            return Err("world-to-local frame result was not an exact nanometer".into());
        }
        recovered[axis] = numerator / 1_000_000;
    }
    if recovered != local {
        return Err(format!(
            "exact planar frame round trip changed coordinates: {local:?} -> {world:?} -> {recovered:?}"
        ));
    }
    Ok(json!({"local_nm":local,"world_nm":world,"recovered_local_nm":recovered,"exact":true}))
}

fn geometry_oracle(result: &Value) -> Value {
    json!({
        "aabb_nm": result["aabb_nm"].clone(),
        "centroid_nm": result["centroid_nm"].clone(),
        "signed_volume_nm3": result["signed_volume_nm3"].clone(),
        "surface_area_nm2": result["surface_area_nm2"].clone(),
        "orientation": result["orientation"].clone(),
        "analytic_classification": result["analytic_classification"].clone(),
        "body_count": result["body_count"].clone(),
        "canonical_document_hash": result["canonical_document_hash"].clone(),
    })
}

fn s4_identity_exists(document: &Value, id: &str) -> bool {
    [
        "bodies",
        "features",
        "sketches",
        "region_definitions_v2",
        "topology_references",
        "parameters",
        "construction_planes",
    ]
    .into_iter()
    .any(|collection| document[collection].get(id).is_some())
}

fn s4_topology_reference_has_live_consumer(document: &Value, id: &str) -> bool {
    let feature_consumer = document["features"]
        .as_object()
        .into_iter()
        .flat_map(|features| features.values())
        .filter_map(|feature| feature["inputs"].as_object())
        .flat_map(|inputs| inputs.values())
        .any(|input| input["kind"] == "topology" && input["id"] == id);
    let sketch_consumer = document["sketches"]
        .as_object()
        .into_iter()
        .flat_map(|sketches| sketches.values())
        .any(|sketch| {
            sketch["support"]["kind"] == "topology" && sketch["support"]["reference"] == id
        });
    let definition_consumer = document["feature_definitions_v2"]
        .as_object()
        .into_iter()
        .flat_map(|definitions| definitions.values())
        .any(|definition| {
            definition["operation"]["support"]["kind"] == "topology"
                && definition["operation"]["support"]["reference"] == id
        });
    feature_consumer || sketch_consumer || definition_consumer
}

fn s4_replaced_identity_is_live(document: &Value, id: &str) -> bool {
    if document["topology_references"].get(id).is_some() {
        // The definition remains addressable for immutable history, undo, and
        // branch-scoped repair. Replaced means that no current support consumes
        // it, not that history's reference definition was deleted.
        s4_topology_reference_has_live_consumer(document, id)
    } else {
        s4_identity_exists(document, id)
    }
}

fn s4_region_id(runtime: &PartRuntime) -> Result<String, String> {
    let document: Value =
        serde_json::from_str(&runtime.document_json().map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
    document["feature_definitions_v2"][S4_EXTRUDE_FEATURE]["operation"]["profile"]["region"]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| "Sprint 4 durable profile region identity is absent".into())
}

fn set_verified_identities(
    runtime: &PartRuntime,
    result: &mut Value,
    retained: &[&str],
    replaced: &[&str],
) -> Result<(), String> {
    let document: Value =
        serde_json::from_str(&runtime.document_json().map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
    let missing = retained
        .iter()
        .filter(|id| !s4_identity_exists(&document, id))
        .copied()
        .collect::<Vec<_>>();
    let still_present = replaced
        .iter()
        .filter(|id| s4_replaced_identity_is_live(&document, id))
        .copied()
        .collect::<Vec<_>>();
    if !missing.is_empty() || !still_present.is_empty() {
        return Err(format!(
            "Sprint 4 stable identity observation failed: missing retained={missing:?}, still-present replaced={still_present:?}"
        ));
    }
    result["stable_identity_sets"] = json!({"retained":retained,"replaced":replaced});
    Ok(())
}

fn execute_planar_face_orientation_matrix(
    id: &str,
    binding: &FixtureBinding,
) -> Result<Observation, String> {
    let cases = [
        ("cap_positive_z", 2, 10.0),
        ("cap_negative_z", 2, 0.0),
        ("side_positive_x", 0, 10.0),
    ];
    let directions = ["positive", "negative", "symmetric"];
    let mut observations = Vec::new();
    let mut frames = serde_json::Map::new();
    let mut round_trips = serde_json::Map::new();
    let mut geometry_oracles = serde_json::Map::new();
    let mut one_sided_volume = None;
    let mut symmetric_volume = None;
    for (label, axis, coordinate) in cases {
        for direction in directions {
            let case_id = format!("{id}:{label}:{direction}");
            let reference_id = format!("topology:{case_id}");
            let (mut runtime, sketch, support, frame, _) = create_planar_face_source(
                &case_id,
                10_000_000,
                axis,
                coordinate,
                "rectangle-4x3mm-contained-on-each-face",
                &reference_id,
            )?;
            frames
                .entry(label)
                .or_insert_with(|| frame_contract(&frame));
            if !round_trips.contains_key(label) {
                round_trips.insert(label.to_owned(), exact_frame_round_trip(&frame)?);
            }
            let before = runtime.semantic_hash().map_err(|error| error.to_string())?;
            let accepted_sketch = before.clone();
            runtime
                .preview_sketch_extrude_json(
                    &face_extrude_request(&case_id, &sketch, &support, 2_000_000, direction, false)
                        .to_string(),
                )
                .map_err(|error| error.to_string())?;
            if runtime.semantic_hash().map_err(|error| error.to_string())? != accepted_sketch {
                return Err("Sprint 4 planar-face preview mutated accepted state".into());
            }
            // Cancel is the deliberate discard of the non-mutating preview.
            commit_face_extrude(
                &mut runtime,
                &case_id,
                &sketch,
                &support,
                2_000_000,
                direction,
            )?;
            // Execute a materially changed extent edit against the durable
            // feature identity, then restore the descriptor's final extent.
            commit_face_extrude(
                &mut runtime,
                &case_id,
                &sketch,
                &support,
                2_500_000,
                direction,
            )?;
            commit_face_extrude(
                &mut runtime,
                &case_id,
                &sketch,
                &support,
                2_000_000,
                direction,
            )?;
            let saved = runtime.document_json().map_err(|error| error.to_string())?;
            runtime = PartRuntime::from_document_json(&saved).map_err(|error| error.to_string())?;
            let recompute: Value = serde_json::from_str(
                &runtime
                    .recompute_from_here_json(S4_EXTRUDE_FEATURE)
                    .map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?;
            if recompute["accepted"] != true {
                return Err(format!("planar-face matrix recompute refused: {recompute}"));
            }
            let (active, mut result, hash) = active_result(&runtime)?;
            let volume = result["signed_volume_nm3"]
                .as_f64()
                .ok_or("matrix volume absent")?;
            if direction == "symmetric" {
                symmetric_volume.get_or_insert(volume);
            } else {
                one_sided_volume.get_or_insert(volume);
            }
            set_verified_identities(&runtime, &mut result, &[S4_BASE_BODY, S4_BASE_FEATURE], &[])?;
            geometry_oracles.insert(case_id.clone(), geometry_oracle(&result));
            observations.push((
                before,
                runtime.semantic_hash().map_err(|error| error.to_string())?,
                hash,
                result,
            ));
            if active["body"].is_null() {
                return Err("planar-face matrix produced no body".into());
            }
        }
    }
    for (profile_label, profile) in [
        ("line_arc_capsule", "line-arc-capsule"),
        ("circle_annulus_with_hole", "circle-annulus"),
    ] {
        let case_id = format!("{id}:cap_positive_z:positive:{profile_label}");
        let reference_id = format!("topology:{case_id}");
        let (mut runtime, sketch, support, _, _) =
            create_planar_face_source(&case_id, 10_000_000, 2, 10.0, profile, &reference_id)?;
        let before = runtime.semantic_hash().map_err(|error| error.to_string())?;
        commit_face_extrude(
            &mut runtime,
            &case_id,
            &sketch,
            &support,
            2_000_000,
            "positive",
        )?;
        let (_active, mut result, hash) = active_result(&runtime)?;
        set_verified_identities(&runtime, &mut result, &[S4_BASE_BODY, S4_BASE_FEATURE], &[])?;
        geometry_oracles.insert(case_id.clone(), geometry_oracle(&result));
        observations.push((
            before,
            runtime.semantic_hash().map_err(|error| error.to_string())?,
            hash,
            result,
        ));
    }
    let mut observation = combine_success(observations)?;
    // Every per-case runtime above independently verified this retained set.
    observation.result["stable_identity_sets"] =
        json!({"retained":[S4_BASE_BODY, S4_BASE_FEATURE],"replaced":[]});
    observation.oracle_assertions = json!({
        "case_count": 11,
        "body_count_each": 1,
        "manifold_each": true,
        "orientation_each": "outward",
        "authority_source": "accepted_body_snapshot_solid_json",
        "analytic_surface": "plane",
        "handedness": "right",
        "scale_millionths": 1_000_000,
        "directions_qualified": directions,
        "profile_curve_kinds_qualified": ["line", "arc", "circle"],
        "hole_profile_qualified": true,
        "one_side_signed_volume_nm3": one_sided_volume.ok_or("one-side volume absent")?,
        "symmetric_signed_volume_nm3": symmetric_volume.ok_or("symmetric volume absent")?,
        "support_frames": frames,
        "exact_coordinate_round_trips": round_trips,
        "geometry_oracles": geometry_oracles,
    });
    observation.executed_lifecycle_steps = validate_executed_lifecycle(
        binding,
        [
            "preview",
            "cancel",
            "commit",
            "edit",
            "save",
            "reload",
            "recompute",
        ]
        .into_iter()
        .map(str::to_owned)
        .collect(),
    )?;
    Ok(observation)
}

fn execute_planar_face_upstream_edit(
    id: &str,
    binding: &FixtureBinding,
) -> Result<Observation, String> {
    let reference_id = "topology:face-support";
    let (mut runtime, sketch, support, initial_frame, _) =
        create_planar_face_source(id, 10_000_000, 2, 10.0, "rectangle-4x3mm", reference_id)?;
    let before = runtime.semantic_hash().map_err(|error| error.to_string())?;
    commit_face_extrude(&mut runtime, id, &sketch, &support, 2_000_000, "positive")?;
    let initial = active_result(&runtime)?.1;
    runtime
        .commit_length("parameter:distance", 14_000_000)
        .map_err(|error| error.to_string())?;
    let recompute: Value = serde_json::from_str(
        &runtime
            .recompute_from_here_json(S4_BASE_FEATURE)
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    if recompute["accepted"] != true {
        return Err(format!("upstream recompute refused: {recompute}"));
    }
    let face = face_id_on_coordinate(&runtime, S4_BASE_BODY, 2, 14.0)?;
    let edited_frame = planar_frame(&runtime, S4_BASE_BODY, face)?;
    let saved = runtime.document_json().map_err(|error| error.to_string())?;
    runtime = PartRuntime::from_document_json(&saved).map_err(|error| error.to_string())?;
    let (_active, mut result, body) = active_result(&runtime)?;
    let region_id = s4_region_id(&runtime)?;
    set_verified_identities(
        &runtime,
        &mut result,
        &[
            S4_BASE_BODY,
            S4_BASE_FEATURE,
            S4_SKETCH_ID,
            S4_EXTRUDE_FEATURE,
            S4_EXTRUDE_BODY,
            &region_id,
        ],
        &[],
    )?;
    let order = recompute["plan"]["evaluation_order"].clone();
    observation_bounds_present(&initial)?;
    observation_bounds_present(&result)?;
    Ok(Observation {
        result,
        oracle_assertions: json!({
            "stable_face_identity_retained": initial_frame["face_stable_id"] == edited_frame["face_stable_id"],
            "initial_frame_origin_nm": initial_frame["frame"]["origin_nanometers"].clone(),
            "edited_frame_origin_nm": edited_frame["frame"]["origin_nanometers"].clone(),
            "initial_output_bounds_nm": initial["aabb_nm"].clone(),
            "edited_output_bounds_nm": active_result(&runtime)?.1["aabb_nm"].clone(),
            "evaluation_order": order,
            "unrelated_feature_recomputed": false,
        }),
        before,
        after: runtime.semantic_hash().map_err(|error| error.to_string())?,
        body_hashes_before: vec![],
        body_hashes_after: vec![body],
        executed_lifecycle_steps: validate_executed_lifecycle(
            binding,
            ["commit", "edit", "recompute", "save", "reload"]
                .into_iter()
                .map(str::to_owned)
                .collect(),
        )?,
    })
}

fn observation_bounds_present(result: &Value) -> Result<(), String> {
    if result["aabb_nm"]
        .as_array()
        .is_some_and(|bounds| bounds.len() == 6)
    {
        Ok(())
    } else {
        Err("observed bounds are absent".into())
    }
}

fn execute_planar_face_save_reopen_edit(
    id: &str,
    binding: &FixtureBinding,
) -> Result<Observation, String> {
    let (mut runtime, sketch, support, _, _) = create_planar_face_source(
        id,
        10_000_000,
        2,
        10.0,
        "line-arc-capsule",
        "topology:face-support",
    )?;
    let before = runtime.semantic_hash().map_err(|error| error.to_string())?;
    let sketch_hash = before.clone();
    runtime
        .preview_sketch_extrude_json(
            &face_extrude_request(id, &sketch, &support, 2_000_000, "positive", false).to_string(),
        )
        .map_err(|e| e.to_string())?;
    if runtime.semantic_hash().map_err(|e| e.to_string())? != sketch_hash {
        return Err("cancelled face preview mutated document".into());
    }
    commit_face_extrude(&mut runtime, id, &sketch, &support, 2_000_000, "positive")?;
    let committed_hash = runtime.semantic_hash().map_err(|e| e.to_string())?;
    let saved = runtime.document_json().map_err(|e| e.to_string())?;
    runtime = PartRuntime::from_document_json(&saved).map_err(|e| e.to_string())?;
    let save_reopen_equal = runtime.semantic_hash().map_err(|e| e.to_string())? == committed_hash;
    commit_face_extrude(&mut runtime, id, &sketch, &support, 3_500_000, "symmetric")?;
    let _edited_hash = runtime.semantic_hash().map_err(|e| e.to_string())?;
    runtime.commit_changes_json(&json!({"transaction_id":format!("transaction:{id}:suppress"),"changes":[{"kind":"set_feature_suppressed","feature":S4_EXTRUDE_FEATURE,"suppressed":true}]}).to_string()).map_err(|e|e.to_string())?;
    let suppressed: Value =
        serde_json::from_str(&runtime.active_body_json(0.01).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let suppressed_body_absent = suppressed["body"]["body_id"] != S4_EXTRUDE_BODY;
    runtime.commit_changes_json(&json!({"transaction_id":format!("transaction:{id}:unsuppress"),"changes":[{"kind":"set_feature_suppressed","feature":S4_EXTRUDE_FEATURE,"suppressed":false}]}).to_string()).map_err(|e|e.to_string())?;
    let recompute: Value = serde_json::from_str(
        &runtime
            .recompute_from_here_json(S4_EXTRUDE_FEATURE)
            .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    if recompute["accepted"] != true {
        return Err(format!("unsuppressed recompute refused: {recompute}"));
    }
    let recomputed_hash = runtime.semantic_hash().map_err(|e| e.to_string())?;
    let undo_hash = runtime.undo().map_err(|e| e.to_string())?;
    let redo_hash = runtime.redo().map_err(|e| e.to_string())?;
    let (active, mut result, body) = active_result(&runtime)?;
    if active["body"].is_null() {
        return Err("reopened planar-face edit has no body".into());
    }
    let document: Value =
        serde_json::from_str(&runtime.document_json().map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let definition = &document["feature_definitions_v2"][S4_EXTRUDE_FEATURE];
    let region_id = s4_region_id(&runtime)?;
    set_verified_identities(
        &runtime,
        &mut result,
        &[
            "topology:face-support",
            S4_SKETCH_ID,
            &region_id,
            S4_EXTRUDE_FEATURE,
            S4_EXTRUDE_BODY,
        ],
        &[],
    )?;
    Ok(Observation {
        result,
        oracle_assertions: json!({
            "durable_support_kind": if definition["operation"]["support"]["kind"] == "topology_face" { "topology_face" } else { "invalid" },
            "profile_binding_stable": definition["operation"]["profile"]["sketch"] == S4_SKETCH_ID,
            "feature_identity_stable": document["features"].get(S4_EXTRUDE_FEATURE).is_some(),
            "body_identity_stable": active["body"]["body_id"] == S4_EXTRUDE_BODY,
            "save_reopen_equal": save_reopen_equal,
            "suppressed_body_absent": suppressed_body_absent,
            "unsuppressed_recompute_equal": recompute["accepted"] == true,
            "undo_redo_equal": undo_hash != redo_hash && redo_hash == recomputed_hash,
        }),
        before,
        after: runtime.semantic_hash().map_err(|e| e.to_string())?,
        body_hashes_before: vec![],
        body_hashes_after: vec![body],
        executed_lifecycle_steps: validate_executed_lifecycle(
            binding,
            [
                "preview",
                "cancel",
                "commit",
                "save",
                "reopen",
                "edit",
                "suppress",
                "unsuppress",
                "undo",
                "redo",
                "recompute",
            ]
            .into_iter()
            .map(str::to_owned)
            .collect(),
        )?,
    })
}

fn break_topology_reference(
    runtime: PartRuntime,
    reference_id: &str,
) -> Result<(PartRuntime, Value, u64), String> {
    let valid_face = face_id_on_coordinate(&runtime, S4_BASE_BODY, 2, 10.0)?;
    let mut document: Value =
        serde_json::from_str(&runtime.document_json().map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
    document["topology_references"][reference_id]["stable_kernel_id"] = json!(u64::MAX.to_string());
    document["topology_references"][reference_id]["stable_token"] = json!("missing:face");
    let broken = PartRuntime::from_document_json(&document.to_string())
        .map_err(|error| error.to_string())?;
    Ok((broken, document, valid_face))
}

fn repair_candidate(reference_id: &str, stable_id: u64, frame: &Value) -> Value {
    topology_reference(
        reference_id,
        S4_BASE_BODY,
        S4_BASE_FEATURE,
        stable_id,
        frame,
    )
}

fn create_revolve_with_curved_face(id: &str) -> Result<(PartRuntime, u64, Value), String> {
    let mut runtime = blank_runtime(id, "Sprint 4 nonplanar authority evidence")?;
    let sketch_id = format!("sketch:{id}:revolve");
    let sketch_value = sketch(&sketch_id, circle_geometry());
    let support_value = support("xy");
    accept_sketch(
        &mut runtime,
        &format!("{id}:revolve"),
        &sketch_value,
        &support_value,
    )?;
    let executed: Value = serde_json::from_str(
        &runtime
            .commit_sketch_extrude_json(
                &json!({
                    "transaction_id":format!("transaction:{id}:revolve"),
                    "sketch":sketch_value,
                    "support":support_value,
                    "profile_geometry_ids":[],
                    "distance_nanometers":4_000_000,
                    "direction":"positive",
                    "feature_id":"feature:revolve",
                    "body_id":"body:revolve",
                    "tolerance":0.01,
                })
                .to_string(),
            )
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    if executed["accepted"] != true {
        return Err(format!("curved-face fixture setup refused: {executed}"));
    }
    let solid = body_solid(&runtime, "body:revolve")?;
    let mut stable_ids = solid
        .face_iter()
        .map(|face| face.stable_id().raw())
        .collect::<Vec<_>>();
    stable_ids.sort_unstable();
    for stable_id in stable_ids {
        let diagnostic: Value = serde_json::from_str(
            &runtime
                .planar_face_frame_json("body:revolve", &stable_id.to_string())
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        if diagnostic["found"] == false && diagnostic["error"]["code"] == "nonplanar_face" {
            return Ok((runtime, stable_id, diagnostic));
        }
    }
    Err("accepted Revolve body exposed no real curved face".into())
}

fn create_nonplanar_extrude_probe(id: &str) -> Result<(PartRuntime, Value, Value, Value), String> {
    let (mut runtime, stable_id, diagnostic) = create_revolve_with_curved_face(id)?;
    let sketch_id = format!("sketch:{id}:curved-profile");
    let sketch_value = sketch(&sketch_id, planar_sketch_geometry("rectangle-4x3mm")?);
    accept_sketch(
        &mut runtime,
        &format!("{id}:curved-profile"),
        &sketch_value,
        &support("xy"),
    )?;
    let reference_id = format!("topology:{id}:curved-face");
    let support_value = json!({"kind":"topology","reference":reference_id});
    let mut document: Value =
        serde_json::from_str(&runtime.document_json().map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
    document["topology_references"][&reference_id] = json!({
        "schema_version": 1,
        "id": reference_id,
        "component": "component:root",
        "body": "body:revolve",
        "producer": "feature:revolve",
        "kind": "face",
        "stable_kernel_id": stable_id.to_string(),
        "stable_token": format!("nonplanar:body:revolve:{stable_id}"),
        "fallback_signature": {
            "kind": "face",
            "centroid_nanometers": [0,0,0],
            "normal_millionths": [0,0,1_000_000],
            "area_square_nanometers": 1,
        },
    });
    document["sketches"][&sketch_id]["support"] = support_value.clone();
    let sketch_feature = format!("feature:{sketch_id}");
    document["features"][&sketch_feature]["inputs"]["support"] =
        json!({"kind":"topology","id":reference_id});
    document["features"][&sketch_feature]["dependencies"] = json!(["feature:revolve"]);
    let runtime = PartRuntime::from_document_json(&document.to_string())
        .map_err(|error| error.to_string())?;
    Ok((runtime, sketch_value, support_value, diagnostic))
}

fn execute_planar_face_explicit_repair(
    id: &str,
    binding: &FixtureBinding,
) -> Result<Observation, String> {
    let source = binding.descriptor["input"]["payload"]["from_reference"]
        .as_str()
        .ok_or("repair source reference absent")?;
    let selected = binding.descriptor["input"]["payload"]["selected_reference"]
        .as_str()
        .ok_or("repair selected reference absent")?;
    let (mut runtime, sketch, support, _, _) =
        create_planar_face_source(id, 10_000_000, 2, 10.0, "rectangle-4x3mm", source)?;
    commit_face_extrude(&mut runtime, id, &sketch, &support, 2_000_000, "positive")?;
    let (mut runtime, _, face) = break_topology_reference(runtime, source)?;
    let frame = planar_frame(&runtime, S4_BASE_BODY, face)?;
    let candidate = repair_candidate(selected, face, &frame);
    let before = runtime.semantic_hash().map_err(|e| e.to_string())?;
    let transaction_count_before =
        serde_json::from_str::<Value>(&runtime.document_json().map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?["transactions"]
            .as_array()
            .ok_or("broken repair transaction journal absent")?
            .len();
    let body_before = body_hash(
        &serde_json::from_str(&runtime.active_body_json(0.01).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?,
    )?;
    let inspection: Value = serde_json::from_str(
        &runtime
            .repair_inspection_json(&json!([candidate.clone()]).to_string())
            .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    if inspection["status"] != "evaluation_blocked" {
        return Err(format!("repair inspection did not block: {inspection}"));
    }
    let ranking_mutated_document = runtime.semantic_hash().map_err(|e| e.to_string())? != before;
    // The inspection is the actual preview. Cancel discards it and must preserve the hash.
    let cancel_preserved_hash = runtime.semantic_hash().map_err(|e| e.to_string())? == before;
    let accepted: Value = serde_json::from_str(
        &runtime
            .explicit_rebind_json(
                &json!({
                    "transaction_id":format!("transaction:{id}:repair"),
                    "selected":selected,
                    "observed":[candidate],
                    "base_document_hash":inspection["preview"]["base_document_hash"],
                    "base_revision":inspection["preview"]["base_revision"],
                })
                .to_string(),
            )
            .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    if accepted["accepted"] != true {
        return Err(format!("explicit repair refused: {accepted}"));
    }
    let repaired_hash = runtime.semantic_hash().map_err(|e| e.to_string())?;
    let repaired_document: Value =
        serde_json::from_str(&runtime.document_json().map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let locations = [
        (
            "topology_reference",
            repaired_document["topology_references"]
                .get(selected)
                .is_some(),
        ),
        (
            "sketch_feature.support",
            repaired_document["features"]["feature:sketch:face-profile"]["inputs"]["support"]["kind"]
                == "topology"
                && repaired_document["features"]["feature:sketch:face-profile"]["inputs"]["support"]
                    ["id"]
                    == selected,
        ),
        (
            "sketch.support",
            repaired_document["sketches"][S4_SKETCH_ID]["support"]["reference"] == selected,
        ),
        (
            "feature_definition_v2.operation.support",
            repaired_document["feature_definitions_v2"][S4_EXTRUDE_FEATURE]["operation"]["support"]
                ["reference"]
                == selected,
        ),
    ];
    if locations.iter().any(|(_, updated)| !updated) {
        return Err(format!(
            "explicit repair was not atomic across durable locations: {locations:?}"
        ));
    }
    if s4_topology_reference_has_live_consumer(&repaired_document, source) {
        return Err("explicit repair left a live consumer of the replaced support".into());
    }
    let transactions = repaired_document["transactions"]
        .as_array()
        .ok_or("repaired transaction journal absent")?;
    if transactions.len() != transaction_count_before + 1 {
        return Err(format!(
            "explicit repair committed {} transactions instead of one",
            transactions.len().saturating_sub(transaction_count_before)
        ));
    }
    let repair_transaction = transactions.last().ok_or("repair transaction absent")?;
    let expected_transaction_id = format!("transaction:{id}:repair");
    if repair_transaction["id"] != expected_transaction_id
        || repair_transaction["changes"].as_array().map(|changes| {
            changes
                .iter()
                .map(|change| change["kind"].as_str().unwrap_or_default())
                .collect::<Vec<_>>()
        }) != Some(vec!["rebind_topology", "accept_feature_result"])
    {
        return Err(format!(
            "explicit repair transaction does not contain exactly RebindTopology + AcceptFeatureResult: {repair_transaction}"
        ));
    }
    let transaction_count = transactions.len() - transaction_count_before;
    let undo_hash = runtime.undo().map_err(|e| e.to_string())?;
    let redo_hash = runtime.redo().map_err(|e| e.to_string())?;
    let saved = runtime.document_json().map_err(|e| e.to_string())?;
    runtime = PartRuntime::from_document_json(&saved).map_err(|e| e.to_string())?;
    let recompute: Value = serde_json::from_str(
        &runtime
            .recompute_from_here_json(S4_EXTRUDE_FEATURE)
            .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    if recompute["accepted"] != true {
        return Err(format!("repaired reopen recompute refused: {recompute}"));
    }
    let (active, mut result, body_after) = active_result(&runtime)?;
    if active["body"].is_null() {
        return Err("repair lost descendant body".into());
    }
    let region_id = s4_region_id(&runtime)?;
    set_verified_identities(
        &runtime,
        &mut result,
        &[
            S4_SKETCH_ID,
            &region_id,
            S4_EXTRUDE_FEATURE,
            S4_EXTRUDE_BODY,
        ],
        &[source],
    )?;
    Ok(Observation {
        result,
        oracle_assertions: json!({
            "ranking_mutated_document":ranking_mutated_document,
            "repair_preview_executed":inspection["preview"]["candidates"].as_array().is_some_and(|v|!v.is_empty()),
            "cancel_preserved_hash":cancel_preserved_hash,
            "transaction_count":transaction_count,
            "updated_locations":locations.into_iter().map(|(name,_)|name).collect::<Vec<_>>(),
            "undo_restored_broken_state":undo_hash == before,
            "redo_restored_repair":redo_hash == repaired_hash,
            "reopen_recompute_equal":recompute["accepted"] == true,
            "descendant_identities_stable":active["body"]["body_id"] == S4_EXTRUDE_BODY,
        }),
        before,
        after: runtime.semantic_hash().map_err(|e| e.to_string())?,
        body_hashes_before: vec![body_before],
        body_hashes_after: vec![body_after],
        executed_lifecycle_steps: validate_executed_lifecycle(
            binding,
            [
                "commit",
                "recompute",
                "repair",
                "preview",
                "cancel",
                "undo",
                "redo",
                "save",
                "reopen",
            ]
            .into_iter()
            .map(str::to_owned)
            .collect(),
        )?,
    })
}

fn planar_diagnostic_result(diagnostic: &Value) -> Result<Value, String> {
    let error = &diagnostic["error"];
    let body = diagnostic["body_id"]
        .as_str()
        .ok_or("planar diagnostic body_id absent")?;
    let mut referenced = vec![body.to_owned()];
    referenced.extend(
        error["referenced_body_ids"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_owned),
    );
    referenced.sort();
    referenced.dedup();
    Ok(json!({
        "kind":"structured_error",
        "category":error["category"].as_str().ok_or("planar diagnostic category absent")?,
        "code":error["code"].as_str().ok_or("planar diagnostic code absent")?,
        "field_path":error["field"].as_str().ok_or("planar diagnostic field absent")?,
        "referenced_entity_ids":referenced,
    }))
}

fn topology_support_diagnostic_result(value: &Value) -> Result<Value, String> {
    if value["valid"] != false {
        return Err(format!(
            "topology support diagnostic unexpectedly passed: {value}"
        ));
    }
    let diagnostic = &value["diagnostic"];
    let mut referenced = vec![
        diagnostic["reference_id"]
            .as_str()
            .ok_or("topology support diagnostic reference_id absent")?
            .to_owned(),
    ];
    referenced.extend(
        diagnostic["referenced_body_ids"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_owned),
    );
    referenced.extend(
        diagnostic["referenced_feature_ids"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_owned),
    );
    referenced.sort();
    referenced.dedup();
    Ok(json!({
        "kind":"structured_error",
        "category":diagnostic["category"].as_str().ok_or("topology support diagnostic category absent")?,
        "code":diagnostic["code"].as_str().ok_or("topology support diagnostic code absent")?,
        "field_path":diagnostic["field"].as_str().ok_or("topology support diagnostic field absent")?,
        "referenced_entity_ids":referenced,
    }))
}

fn ambiguous_repair_result(inspection: &Value) -> Result<Value, String> {
    if inspection["status"] != "evaluation_blocked"
        || inspection["preview"]["explicit_rebind_required"] != true
        || inspection["preview"]["selection"]["status"] != "ambiguous"
    {
        return Err(format!(
            "runtime did not report an ambiguous explicit repair: {inspection}"
        ));
    }
    let mut referenced = vec![
        inspection["preview"]["unresolved"]["reference"]
            .as_str()
            .ok_or("ambiguous repair unresolved reference absent")?
            .to_owned(),
    ];
    referenced.extend(
        inspection["preview"]["selection"]["candidates"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_owned),
    );
    referenced.sort();
    referenced.dedup();
    Ok(json!({
        "kind":"structured_error",
        "category":"repair_selection",
        "code":inspection["preview"]["selection"]["status"],
        "field_path":"repair.preview.selection",
        "referenced_entity_ids":referenced,
    }))
}

fn clone_runtime(runtime: &PartRuntime) -> Result<PartRuntime, String> {
    PartRuntime::from_document_json(&runtime.document_json().map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())
}

fn execute_planar_face_negative(id: &str, binding: &FixtureBinding) -> Result<Observation, String> {
    let kind = binding.descriptor["input"]["kind"]
        .as_str()
        .ok_or("fixture kind absent")?;
    let payload = &binding.descriptor["input"]["payload"];
    let declared = binding.descriptor["lifecycle_steps"]
        .as_array()
        .ok_or("lifecycle absent")?
        .iter()
        .filter_map(Value::as_str)
        .collect::<BTreeSet<_>>();
    let mut executed = Vec::<String>::new();
    let stored_reference = payload["reference"]
        .as_str()
        .unwrap_or("topology:face-support");
    let setup_reference = if kind == "planar_face_missing_reference_v4" {
        "topology:fixture-valid"
    } else {
        stored_reference
    };
    let (mut runtime, mut sketch_value, mut support_value, _, _) =
        create_planar_face_source(id, 10_000_000, 2, 10.0, "rectangle-4x3mm", setup_reference)?;
    if declared.contains("commit") && kind != "planar_face_nonplanar_reference_v4" {
        commit_face_extrude(
            &mut runtime,
            id,
            &sketch_value,
            &support_value,
            2_000_000,
            "positive",
        )?;
    }

    let mut direct_diagnostic = None;
    let mut repair_inspection = None;
    let mut negative_assertions = json!({});
    if kind == "planar_face_stale_current_evidence_v4" {
        let mut document: Value =
            serde_json::from_str(&runtime.document_json().map_err(|error| error.to_string())?)
                .map_err(|error| error.to_string())?;
        let face = canonical_u64_decimal(
            &document["topology_references"][setup_reference]["stable_kernel_id"],
        )
        .ok_or("stale fixture face ID must be a canonical decimal u64 string")?;
        let revision = document["revision"].as_u64().ok_or("revision absent")?;
        document["recompute"]["features"][S4_BASE_FEATURE] =
            json!({"status":"dirty","since_revision":revision});
        runtime = PartRuntime::from_document_json(&document.to_string())
            .map_err(|error| error.to_string())?;
        direct_diagnostic = Some(
            serde_json::from_str(
                &runtime
                    .planar_face_frame_json(S4_BASE_BODY, &face.to_string())
                    .map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?,
        );
    } else if kind == "planar_face_suppressed_producer_v4" {
        runtime
            .commit_changes_json(
                &json!({"transaction_id":format!("transaction:{id}:suppress"),"changes":[{"kind":"set_feature_suppressed","feature":S4_BASE_FEATURE,"suppressed":true}]}).to_string(),
            )
            .map_err(|error| error.to_string())?;
        executed.push("suppress".into());
        direct_diagnostic = Some(
            serde_json::from_str(
                &runtime
                    .topology_support_diagnostic_json(setup_reference, "component:root")
                    .map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?,
        );
    } else if kind == "planar_face_nonplanar_reference_v4" {
        let (nonplanar, sketch, support, diagnostic) = create_nonplanar_extrude_probe(id)?;
        runtime = nonplanar;
        sketch_value = sketch;
        support_value = support;
        direct_diagnostic = Some(diagnostic);
    } else if kind == "planar_face_wrong_authority_v4" {
        let accepted_document: Value =
            serde_json::from_str(&runtime.document_json().map_err(|error| error.to_string())?)
                .map_err(|error| error.to_string())?;
        let mut variants = serde_json::Map::new();
        for (variant, field, replacement, expected_component) in [
            ("body", Some("body"), Some("body:missing"), "component:root"),
            (
                "producer",
                Some("producer"),
                Some("feature:rectangle-sketch"),
                "component:root",
            ),
            ("component", None, None, "component:other"),
        ] {
            let mut document = accepted_document.clone();
            if let (Some(field), Some(replacement)) = (field, replacement) {
                document["topology_references"][setup_reference][field] = json!(replacement);
            }
            let probe = PartRuntime::from_document_json(&document.to_string())
                .map_err(|error| error.to_string())?;
            let before_probe = probe.semantic_hash().map_err(|error| error.to_string())?;
            let diagnostic: Value = serde_json::from_str(
                &probe
                    .topology_support_diagnostic_json(setup_reference, expected_component)
                    .map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?;
            let projected = topology_support_diagnostic_result(&diagnostic)?;
            if probe.semantic_hash().map_err(|error| error.to_string())? != before_probe {
                return Err(format!(
                    "wrong-authority {variant} diagnostic mutated the document"
                ));
            }
            variants.insert(variant.into(), projected);
        }

        // Exercise a same-local-ID collision against a different body's own
        // producer. Ownership validation alone is deliberately insufficient:
        // the durable stable token still names body:part, so the consuming
        // operation must refuse the otherwise plausible local face number.
        let base_face_ids = body_solid(&runtime, S4_BASE_BODY)?
            .face_iter()
            .map(|face| face.stable_id().raw())
            .collect::<BTreeSet<_>>();
        let other_face_ids = body_solid(&runtime, S4_EXTRUDE_BODY)?
            .face_iter()
            .map(|face| face.stable_id().raw())
            .collect::<BTreeSet<_>>();
        let collision_face = base_face_ids
            .intersection(&other_face_ids)
            .next()
            .copied()
            .ok_or("fixture bodies exposed no real body-local face ID collision")?;
        let mut collision_document = accepted_document.clone();
        collision_document["topology_references"][setup_reference]["body"] = json!(S4_EXTRUDE_BODY);
        collision_document["topology_references"][setup_reference]["producer"] =
            json!(S4_EXTRUDE_FEATURE);
        collision_document["topology_references"][setup_reference]["stable_kernel_id"] =
            json!(collision_face.to_string());
        collision_document["topology_references"][setup_reference]["stable_token"] =
            json!(format!("planar-face:{S4_BASE_BODY}:{collision_face}"));
        let mut collision = PartRuntime::from_document_json(&collision_document.to_string())
            .map_err(|error| error.to_string())?;
        let collision_before = collision
            .semantic_hash()
            .map_err(|error| error.to_string())?;
        let ownership: Value = serde_json::from_str(
            &collision
                .topology_support_diagnostic_json(setup_reference, "component:root")
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        let collision_commit_refused = collision
            .commit_sketch_extrude_json(
                &face_extrude_request(
                    &format!("{id}:body-local-id-collision"),
                    &sketch_value,
                    &support_value,
                    2_000_000,
                    "positive",
                    true,
                )
                .to_string(),
            )
            .is_err();
        if !collision_commit_refused
            || collision
                .semantic_hash()
                .map_err(|error| error.to_string())?
                != collision_before
        {
            return Err("body-local face ID collision was accepted or mutated state".into());
        }
        variants.insert(
            "body_local_id_collision".into(),
            json!({
                "ownership_diagnostic_valid": ownership["valid"].clone(),
                "stable_kernel_id_collided": true,
                "stable_token_body_mismatch": true,
                "commit_refused": true,
                "atomic": true,
            }),
        );
        negative_assertions = json!({"mismatch_variants":variants,"variant_count":4});

        let mut document = accepted_document;
        document["topology_references"][setup_reference]["producer"] =
            json!("feature:rectangle-sketch");
        runtime = PartRuntime::from_document_json(&document.to_string())
            .map_err(|error| error.to_string())?;
        direct_diagnostic = Some(
            serde_json::from_str(
                &runtime
                    .topology_support_diagnostic_json(setup_reference, "component:root")
                    .map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?,
        );
    } else if kind == "planar_face_ambiguous_repair_refused_v4" {
        let (broken, _, face) = break_topology_reference(runtime, setup_reference)?;
        runtime = broken;
        let frame = planar_frame(&runtime, S4_BASE_BODY, face)?;
        let candidates = [
            repair_candidate("topology:repair:a", face, &frame),
            repair_candidate("topology:repair:b", face, &frame),
        ];
        let inspection: Value = serde_json::from_str(
            &runtime
                .repair_inspection_json(&json!(candidates).to_string())
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        repair_inspection = Some(inspection.clone());
        executed.push("repair".into());
        executed.push("preview".into());
        let before_refusal = runtime.semantic_hash().map_err(|error| error.to_string())?;
        if runtime
            .explicit_rebind_json(
                &json!({
                    "transaction_id": format!("transaction:{id}:repair"),
                    "selected": "topology:repair:absent",
                    "observed": candidates,
                    "base_document_hash": inspection["preview"]["base_document_hash"],
                    "base_revision": inspection["preview"]["base_revision"],
                })
                .to_string(),
            )
            .is_ok()
        {
            return Err(
                "ambiguous repair unexpectedly committed without an explicit preview row".into(),
            );
        }
        if runtime.semantic_hash().map_err(|error| error.to_string())? != before_refusal {
            return Err("ambiguous repair refusal mutated the accepted document".into());
        }
        executed.push("commit".into());
    } else if kind == "planar_face_missing_reference_v4" {
        direct_diagnostic = Some(
            serde_json::from_str(
                &runtime
                    .topology_support_diagnostic_json(
                        payload["reference"]
                            .as_str()
                            .ok_or("missing reference payload absent")?,
                        "component:root",
                    )
                    .map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?,
        );
    }

    let before = runtime.semantic_hash().map_err(|error| error.to_string())?;
    let active_before: Value = serde_json::from_str(
        &runtime
            .active_body_json(0.01)
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    let body_before = if active_before["body"].is_null() {
        vec![]
    } else {
        vec![body_hash(&active_before)?]
    };

    if declared.contains("preview") && kind != "planar_face_ambiguous_repair_refused_v4" {
        let probe = clone_runtime(&runtime)?;
        let requested_support = if kind == "planar_face_missing_reference_v4" {
            json!({"kind":"topology","reference":payload["reference"].clone()})
        } else {
            support_value.clone()
        };
        if probe
            .preview_sketch_extrude_json(
                &face_extrude_request(
                    id,
                    &sketch_value,
                    &requested_support,
                    2_000_000,
                    "positive",
                    false,
                )
                .to_string(),
            )
            .is_ok()
        {
            return Err(format!("{kind} preview unexpectedly succeeded"));
        }
        if probe.semantic_hash().map_err(|error| error.to_string())? != before {
            return Err(format!("{kind} preview mutated accepted state"));
        }
        executed.push("preview".into());
    }
    if declared.contains("commit") && kind == "planar_face_missing_reference_v4" {
        let mut probe = clone_runtime(&runtime)?;
        let missing = json!({"kind":"topology","reference":payload["reference"].clone()});
        if probe
            .commit_sketch_extrude_json(
                &face_extrude_request(id, &sketch_value, &missing, 2_000_000, "positive", true)
                    .to_string(),
            )
            .is_ok()
        {
            return Err("missing-reference commit unexpectedly succeeded".into());
        }
        if probe.semantic_hash().map_err(|error| error.to_string())? != before {
            return Err("missing-reference commit mutated accepted state".into());
        }
        executed.push("commit".into());
    }
    if declared.contains("commit")
        && !matches!(
            kind,
            "planar_face_missing_reference_v4" | "planar_face_ambiguous_repair_refused_v4"
        )
    {
        let mut probe = clone_runtime(&runtime)?;
        if probe
            .commit_sketch_extrude_json(
                &face_extrude_request(
                    id,
                    &sketch_value,
                    &support_value,
                    2_000_000,
                    "positive",
                    true,
                )
                .to_string(),
            )
            .is_ok()
        {
            return Err(format!("{kind} commit unexpectedly succeeded"));
        }
        if probe.semantic_hash().map_err(|error| error.to_string())? != before {
            return Err(format!("{kind} commit mutated accepted state"));
        }
        executed.push("commit".into());
    }
    if declared.contains("load") {
        let mut invalid: Value =
            serde_json::from_str(&runtime.document_json().map_err(|error| error.to_string())?)
                .map_err(|error| error.to_string())?;
        let missing = payload["reference"]
            .as_str()
            .ok_or("missing reference payload absent")?;
        invalid["sketches"][S4_SKETCH_ID]["support"] =
            json!({"kind":"topology","reference":missing});
        invalid["features"]["feature:sketch:face-profile"]["inputs"]["support"] =
            json!({"kind":"topology","id":missing});
        invalid["feature_definitions_v2"][S4_EXTRUDE_FEATURE]["operation"]["support"] =
            json!({"kind":"topology","reference":missing});
        if PartRuntime::from_document_json(&invalid.to_string()).is_ok() {
            return Err("document load unexpectedly accepted a missing topology support".into());
        }
        executed.push("load".into());
    }
    if declared.contains("recompute") {
        let mut probe = clone_runtime(&runtime)?;
        let probe_before = probe.semantic_hash().map_err(|error| error.to_string())?;
        match probe.recompute_from_here_json(S4_EXTRUDE_FEATURE) {
            Ok(response) if kind == "planar_face_suppressed_producer_v4" => {
                let refusal: Value = serde_json::from_str(&response).map_err(|error| {
                    format!("suppressed-producer recompute returned invalid JSON: {error}")
                })?;
                let evaluation_order_is_empty = refusal["plan"]["evaluation_order"]
                    .as_array()
                    .is_some_and(Vec::is_empty);
                if refusal["accepted"] != false
                    || refusal["error"]["category"] != "reference"
                    || refusal["error"]["code"] != "suppressed_required_input"
                    || refusal["error"]["field_path"] != "recompute.required_inputs"
                    || refusal["error"]["referenced_entity_ids"] != json!([S4_BASE_FEATURE])
                    || !evaluation_order_is_empty
                    || refusal["before_hash"].as_str() != Some(probe_before.as_str())
                    || refusal["document_hash"].as_str() != Some(probe_before.as_str())
                {
                    return Err(format!(
                        "suppressed-producer recompute did not return the expected atomic structured refusal: {refusal}"
                    ));
                }
            }
            Ok(response) => {
                return Err(format!(
                    "{kind} recompute unexpectedly succeeded: {response}"
                ));
            }
            Err(error) if kind == "planar_face_suppressed_producer_v4" => {
                return Err(format!(
                    "suppressed-producer recompute returned an engine error instead of its structured refusal: {error}"
                ));
            }
            Err(_) => {}
        }
        if probe.semantic_hash().map_err(|error| error.to_string())? != probe_before {
            return Err(format!("{kind} recompute refusal mutated accepted state"));
        }
        executed.push("recompute".into());
    }
    if declared.contains("repair") && kind == "planar_face_wrong_authority_v4" {
        let probe = clone_runtime(&runtime)?;
        let inspection: Value = serde_json::from_str(
            &probe
                .repair_inspection_json("[]")
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        if inspection["status"] != "evaluation_blocked" {
            return Err(format!(
                "wrong-authority repair inspection did not block: {inspection}"
            ));
        }
        executed.push("repair".into());
    }
    if declared.contains("unsuppress") {
        let mut recovery = clone_runtime(&runtime)?;
        recovery
            .commit_changes_json(
                &json!({"transaction_id":format!("transaction:{id}:unsuppress"),"changes":[{"kind":"set_feature_suppressed","feature":S4_BASE_FEATURE,"suppressed":false}]}).to_string(),
            )
            .map_err(|error| error.to_string())?;
        let recompute: Value = serde_json::from_str(
            &recovery
                .recompute_from_here_json(S4_BASE_FEATURE)
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        if recompute["accepted"] != true {
            return Err(format!(
                "unsuppressed producer recompute refused: {recompute}"
            ));
        }
        executed.push("unsuppress".into());
    }

    let after = runtime.semantic_hash().map_err(|error| error.to_string())?;
    let active_after: Value = serde_json::from_str(
        &runtime
            .active_body_json(0.01)
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    let body_after = if active_after["body"].is_null() {
        vec![]
    } else {
        vec![body_hash(&active_after)?]
    };
    if before != after || body_before != body_after {
        return Err(format!(
            "Sprint 4 negative workload mutated accepted state for {kind}: hash {before} -> {after}, bodies {body_before:?} -> {body_after:?}"
        ));
    }
    let result = if let Some(inspection) = repair_inspection.as_ref() {
        ambiguous_repair_result(inspection)?
    } else if matches!(
        kind,
        "planar_face_stale_current_evidence_v4" | "planar_face_nonplanar_reference_v4"
    ) {
        planar_diagnostic_result(
            direct_diagnostic
                .as_ref()
                .ok_or("planar diagnostic absent")?,
        )?
    } else {
        topology_support_diagnostic_result(
            direct_diagnostic
                .as_ref()
                .ok_or("topology support diagnostic absent")?,
        )?
    };
    Ok(Observation {
        result,
        oracle_assertions: negative_assertions,
        before,
        after,
        body_hashes_before: body_before,
        body_hashes_after: body_after,
        executed_lifecycle_steps: validate_executed_lifecycle(binding, executed)?,
    })
}

fn execute_planes(id: &str, binding: &FixtureBinding) -> Result<Observation, String> {
    let mut observations = Vec::new();
    let supports = binding.descriptor["input"]["payload"]["supports"]
        .as_array()
        .ok_or("plane matrix supports absent")?;
    let mut qualified = Vec::new();
    let mut body_count_each = Vec::new();
    for support_name in supports {
        let support_name = support_name
            .as_str()
            .ok_or("plane support is not a string")?;
        let plane = support_name
            .strip_prefix("origin.")
            .ok_or("plane support is not qualified")?;
        let mut runtime = blank_runtime(&format!("{id}:{plane}"), "Plane Evidence")?;
        let sketch = sketch(&format!("sketch:{id}:{plane}"), rectangle_geometry());
        let support = support(plane);
        let before = runtime.semantic_hash().map_err(|e| e.to_string())?;
        accept_sketch(&mut runtime, &format!("{id}:{plane}"), &sketch, &support)?;
        let accepted_sketch = runtime.semantic_hash().map_err(|e| e.to_string())?;
        runtime
            .preview_sketch_extrude_json(
                &request(
                    &format!("{id}:{plane}"),
                    &sketch,
                    &support,
                    4_000_000,
                    &[],
                    false,
                )
                .to_string(),
            )
            .map_err(|e| e.to_string())?;
        if runtime.semantic_hash().map_err(|e| e.to_string())? != accepted_sketch {
            return Err(format!(
                "{support_name} preview mutated the accepted document"
            ));
        }
        let commit: Value = serde_json::from_str(
            &runtime
                .commit_sketch_extrude_json(
                    &request(
                        &format!("{id}:{plane}"),
                        &sketch,
                        &support,
                        4_000_000,
                        &[],
                        true,
                    )
                    .to_string(),
                )
                .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        if commit["accepted"].as_bool() != Some(true) {
            return Err(format!("{plane} commit refused"));
        }
        let document = runtime.document_json().map_err(|e| e.to_string())?;
        runtime = PartRuntime::from_document_json(&document).map_err(|e| e.to_string())?;
        let recompute: Value = serde_json::from_str(
            &runtime
                .recompute_from_here_json(&format!("feature:{id}:{plane}"))
                .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        if recompute["accepted"].as_bool() != Some(true) {
            return Err(format!("{support_name} recompute refused: {recompute}"));
        }
        let active: Value =
            serde_json::from_str(&runtime.active_body_json(0.01).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        qualified.push(support_name.to_owned());
        body_count_each.push(usize::from(!active["body"].is_null()));
        observations.push((
            before,
            runtime.semantic_hash().map_err(|e| e.to_string())?,
            body_hash(&active)?,
            {
                let mut result = success_result(&active, false)?;
                apply_identity_comparison(&mut result, &[])?;
                result
            },
        ));
    }
    let mut observation = combine_success(observations)?;
    project_declared_identity(&mut observation.result, binding)?;
    observation.oracle_assertions = json!({
        "supports_qualified": qualified,
        "body_count_each": if body_count_each.iter().all(|count| *count == 1) { 1 } else { 0 },
    });
    observation.executed_lifecycle_steps = ["preview", "commit", "save", "reload", "recompute"]
        .into_iter()
        .map(str::to_owned)
        .collect();
    Ok(observation)
}

fn construction_support(plane: &str) -> Value {
    json!({"kind":"construction_plane_reference", "plane":plane})
}

fn offset_plane_request(
    runtime: &PartRuntime,
    plane: &str,
    base: &str,
    parameter: &str,
    offset_nm: i64,
    suppressed: bool,
    transaction: &str,
) -> Result<Value, String> {
    let document: Value =
        serde_json::from_str(&runtime.document_json().map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
    Ok(json!({
        "plane_id": plane,
        "component_id": "component:root",
        "base_plane_id": base,
        "offset_parameter_id": parameter,
        "offset_nanometers": offset_nm,
        "suppressed": suppressed,
        "transaction_id": transaction,
        "base_revision": document["revision"].as_u64().ok_or("document revision absent")?,
    }))
}

fn active_result(runtime: &PartRuntime) -> Result<(Value, Value, String), String> {
    let active: Value = serde_json::from_str(
        &runtime
            .active_body_json(0.01)
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    let result = success_result(&active, false)?;
    let hash = body_hash(&active)?;
    Ok((active, result, hash))
}

fn active_cut_result(runtime: &PartRuntime) -> Result<(Value, Value, String), String> {
    let active: Value = serde_json::from_str(
        &runtime
            .active_body_json(0.01)
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    let result = success_result(&active, true)?;
    let hash = body_hash(&active)?;
    Ok((active, result, hash))
}

fn exact_i64_array(value: &Value, field: &str) -> Result<Vec<i64>, String> {
    value
        .as_array()
        .ok_or_else(|| format!("{field} is not an array"))?
        .iter()
        .map(|entry| {
            entry
                .as_i64()
                .or_else(|| entry.as_f64().map(|number| number.round() as i64))
                .ok_or_else(|| format!("{field} contains a non-number"))
        })
        .collect()
}

fn observed_bounds(result: &Value) -> Result<Vec<i64>, String> {
    exact_i64_array(&result["aabb_nm"], "aabb_nm")
}

fn observed_centroid(result: &Value) -> Result<Vec<i64>, String> {
    exact_i64_array(&result["centroid_nm"], "centroid_nm")
}

fn assert_sprint3_oracle(observed: &Value, expected: &Value) -> Result<(), String> {
    if observed != expected {
        return Err(format!(
            "Sprint 3 observed oracle differs from frozen descriptor\nobserved={}\nexpected={}",
            serde_json::to_string_pretty(observed).unwrap_or_else(|_| observed.to_string()),
            serde_json::to_string_pretty(expected).unwrap_or_else(|_| expected.to_string())
        ));
    }
    Ok(())
}

fn execute_offset_plane_matrix(id: &str, binding: &FixtureBinding) -> Result<Observation, String> {
    let payload = &binding.descriptor["input"]["payload"];
    let offset = payload["offset_nanometers"]
        .as_i64()
        .ok_or("matrix offset_nanometers absent")?;
    let distance = payload["distance_nm"]
        .as_i64()
        .ok_or("matrix distance_nm absent")?;
    let parameter = payload["offset_parameter"]
        .as_str()
        .ok_or("matrix offset_parameter absent")?;
    let bases = payload["base_planes"]
        .as_array()
        .ok_or("matrix base_planes absent")?;
    let directions = payload["directions"]
        .as_array()
        .ok_or("matrix directions absent")?;
    let mut cases = Vec::new();
    let mut values = Vec::new();
    let mut one_side_volume = None;
    let mut symmetric_volume = None;
    let mut lifecycle = BTreeSet::new();

    for base_name in bases {
        let base_name = base_name.as_str().ok_or("matrix base plane is not text")?;
        let base_token = base_name
            .strip_prefix("origin.")
            .ok_or("matrix base plane is not origin-qualified")?;
        let base_id = format!("origin-plane:{base_token}");
        for direction in directions {
            let direction = direction.as_str().ok_or("matrix direction is not text")?;
            if !matches!(direction, "positive" | "negative" | "symmetric") {
                return Err(format!("unsupported matrix direction {direction}"));
            }
            let case_id = format!("{id}:{base_token}:{direction}");
            let plane_id = format!("construction-plane:{case_id}");
            let mut runtime = blank_runtime(&case_id, "Offset Plane Matrix Evidence")?;
            let before = runtime.semantic_hash().map_err(|error| error.to_string())?;
            let plane_request = offset_plane_request(
                &runtime,
                &plane_id,
                &base_id,
                parameter,
                offset,
                false,
                &format!("transaction:{case_id}:plane"),
            )?;
            let preview_hash = runtime.semantic_hash().map_err(|error| error.to_string())?;
            runtime
                .preview_offset_construction_plane_json(&plane_request.to_string())
                .map_err(|error| error.to_string())?;
            if runtime.semantic_hash().map_err(|error| error.to_string())? != preview_hash {
                return Err(format!("{case_id} plane preview mutated accepted state"));
            }
            lifecycle.extend(["preview".to_owned(), "cancel".to_owned()]);
            runtime
                .commit_offset_construction_plane_json(&plane_request.to_string())
                .map_err(|error| error.to_string())?;
            lifecycle.insert("commit".to_owned());

            let sketch_value = sketch(&format!("sketch:{case_id}"), rectangle_geometry());
            let support_value = construction_support(&plane_id);
            accept_sketch(&mut runtime, &case_id, &sketch_value, &support_value)?;
            let mut extrude = request(&case_id, &sketch_value, &support_value, distance, &[], true);
            extrude["direction"] = json!(direction);
            let accepted_sketch_hash =
                runtime.semantic_hash().map_err(|error| error.to_string())?;
            let mut preview = extrude.clone();
            preview.as_object_mut().unwrap().remove("transaction_id");
            runtime
                .preview_sketch_extrude_json(&preview.to_string())
                .map_err(|error| error.to_string())?;
            if runtime.semantic_hash().map_err(|error| error.to_string())? != accepted_sketch_hash {
                return Err(format!("{case_id} Extrude preview mutated accepted state"));
            }
            let committed: Value = serde_json::from_str(
                &runtime
                    .commit_sketch_extrude_json(&extrude.to_string())
                    .map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?;
            if committed["accepted"].as_bool() != Some(true) {
                return Err(format!("{case_id} Extrude commit refused: {committed}"));
            }

            let edit = offset_plane_request(
                &runtime,
                &plane_id,
                &base_id,
                parameter,
                offset,
                false,
                &format!("transaction:{case_id}:plane-edit"),
            )?;
            runtime
                .commit_offset_construction_plane_json(&edit.to_string())
                .map_err(|error| error.to_string())?;
            lifecycle.insert("edit".to_owned());
            runtime
                .recompute_from_here_json(&format!("feature:{case_id}"))
                .map_err(|error| error.to_string())?;
            lifecycle.insert("recompute".to_owned());

            let saved = runtime.document_json().map_err(|error| error.to_string())?;
            lifecycle.insert("save".to_owned());
            let accepted_hash = runtime.semantic_hash().map_err(|error| error.to_string())?;
            runtime = PartRuntime::from_document_json(&saved).map_err(|error| error.to_string())?;
            if runtime.semantic_hash().map_err(|error| error.to_string())? != accepted_hash {
                return Err(format!("{case_id} reload changed accepted state"));
            }
            lifecycle.insert("reload".to_owned());

            let frame: Value = serde_json::from_str(
                &runtime
                    .construction_plane_frame_json(&plane_id)
                    .map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?;
            let document: Value =
                serde_json::from_str(&runtime.document_json().map_err(|error| error.to_string())?)
                    .map_err(|error| error.to_string())?;
            if document["construction_planes"][&plane_id]["definition"]["kind"] != "offset"
                || document["construction_planes"][&plane_id]["definition"]["offset"] != parameter
                || document["parameters"][parameter]["value"]["value"] != offset
            {
                return Err(format!("{case_id} durable plane intent differs"));
            }
            let (_active, result, body) = active_result(&runtime)?;
            if result["manifold"] != true || result["orientation"] != "outward" {
                return Err(format!("{case_id} output is not an outward manifold"));
            }
            let volume = result["signed_volume_nm3"]
                .as_f64()
                .ok_or("matrix signed volume absent")?;
            if direction == "symmetric" {
                symmetric_volume.get_or_insert(volume);
            } else {
                one_side_volume.get_or_insert(volume);
            }
            cases.push(json!({
                "support": base_name,
                "direction": direction,
                "frame_origin_nm": exact_i64_array(&frame["frame"]["origin_nanometers"], "frame origin")?,
                "expected_bounds_nm": observed_bounds(&result)?,
                "expected_centroid_nm": observed_centroid(&result)?,
            }));
            values.push((
                before,
                runtime.semantic_hash().map_err(|error| error.to_string())?,
                body,
                result,
            ));
        }
    }
    let expected = &binding.descriptor["expected"]["result"];
    let observed = json!({
        "case_count": cases.len(),
        "body_count_each": 1,
        "manifold_each": true,
        "orientation_each": "outward",
        "construction_plane_definition_kind": "offset",
        "durable_offset_parameter": parameter,
        "one_side_signed_volume_nm3": one_side_volume.ok_or("one-sided volume absent")?,
        "symmetric_signed_volume_nm3": symmetric_volume.ok_or("symmetric volume absent")?,
        "durable_offset_nm": offset,
        "durable_distance_nm": distance,
        "supports_qualified": bases,
        "directions_qualified": directions,
        "cases": cases,
    });
    assert_sprint3_oracle(&observed, expected)?;
    let mut combined = combine_success(values)?;
    combined.result["stable_identity_sets"] = json!({"retained":[], "replaced":[]});
    combined.oracle_assertions = observed;
    combined.executed_lifecycle_steps =
        validate_executed_lifecycle(binding, lifecycle.into_iter().collect())?;
    Ok(combined)
}

fn execute_offset_plane_signed_edit(
    id: &str,
    binding: &FixtureBinding,
) -> Result<Observation, String> {
    let payload = &binding.descriptor["input"]["payload"];
    let initial_offset = payload["initial_offset_nanometers"]
        .as_i64()
        .ok_or("initial offset absent")?;
    let edited_offset = payload["edited_offset_nanometers"]
        .as_i64()
        .ok_or("edited offset absent")?;
    let zero_offset = payload["zero_offset_nanometers"]
        .as_i64()
        .ok_or("zero offset absent")?;
    if zero_offset != 0 {
        return Err(format!(
            "zero offset boundary must be exactly 0, got {zero_offset}"
        ));
    }
    let distance = payload["distance_nm"].as_i64().ok_or("distance absent")?;
    let direction = payload["direction"].as_str().ok_or("direction absent")?;
    let parameter = payload["offset_parameter"]
        .as_str()
        .ok_or("offset parameter absent")?;
    let base_name = payload["base_plane"].as_str().ok_or("base plane absent")?;
    let base = match base_name {
        "origin.xy" => "origin-plane:xy",
        "origin.xz" => "origin-plane:xz",
        "origin.yz" => "origin-plane:yz",
        other => return Err(format!("unsupported signed-edit base plane {other}")),
    };
    let plane_id = format!("construction-plane:{id}");
    let sketch_id = format!("sketch:{id}");
    let feature_id = format!("feature:{id}");
    let mut runtime = blank_runtime(id, "Signed Offset Plane Evidence")?;
    let mut lifecycle = Vec::new();
    let before = runtime.semantic_hash().map_err(|error| error.to_string())?;
    let plane = offset_plane_request(
        &runtime,
        &plane_id,
        base,
        parameter,
        initial_offset,
        false,
        &format!("transaction:{id}:plane"),
    )?;
    let preview_hash = runtime.semantic_hash().map_err(|error| error.to_string())?;
    runtime
        .preview_offset_construction_plane_json(&plane.to_string())
        .map_err(|error| error.to_string())?;
    if runtime.semantic_hash().map_err(|error| error.to_string())? != preview_hash {
        return Err("signed offset preview mutated accepted state".into());
    }
    lifecycle.push("preview".to_owned());
    // The preview is deliberately discarded; the unchanged accepted hash is
    // the observed cancellation result.
    lifecycle.push("cancel".to_owned());
    runtime
        .commit_offset_construction_plane_json(&plane.to_string())
        .map_err(|error| error.to_string())?;
    let initial_frame: Value = serde_json::from_str(
        &runtime
            .construction_plane_frame_json(&plane_id)
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    let sketch_value = sketch(&sketch_id, rectangle_geometry());
    let support_value = construction_support(&plane_id);
    accept_sketch(&mut runtime, id, &sketch_value, &support_value)?;
    let mut extrude = request(id, &sketch_value, &support_value, distance, &[], true);
    extrude["direction"] = json!(direction);
    runtime
        .commit_sketch_extrude_json(&extrude.to_string())
        .map_err(|error| error.to_string())?;
    let (_initial_active, initial_result, _initial_body_hash) = active_result(&runtime)?;
    lifecycle.push("commit".to_owned());

    let edit = offset_plane_request(
        &runtime,
        &plane_id,
        base,
        parameter,
        edited_offset,
        false,
        &format!("transaction:{id}:plane-edit"),
    )?;
    runtime
        .commit_offset_construction_plane_json(&edit.to_string())
        .map_err(|error| error.to_string())?;
    runtime
        .recompute_from_here_json(&feature_id)
        .map_err(|error| error.to_string())?;
    let (_edited_active, edited_result, edited_body_hash) = active_result(&runtime)?;
    let edited_frame: Value = serde_json::from_str(
        &runtime
            .construction_plane_frame_json(&plane_id)
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    lifecycle.push("edit".to_owned());

    let suppress = offset_plane_request(
        &runtime,
        &plane_id,
        base,
        parameter,
        edited_offset,
        true,
        &format!("transaction:{id}:suppress"),
    )?;
    runtime
        .commit_offset_construction_plane_json(&suppress.to_string())
        .map_err(|error| error.to_string())?;
    if runtime.construction_plane_frame_json(&plane_id).is_ok() {
        return Err("suppressed construction plane unexpectedly resolved".into());
    }
    let suppressed_active: Value = serde_json::from_str(
        &runtime
            .active_body_json(0.01)
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    if suppressed_active["kind"] != "none" || !suppressed_active["body"].is_null() {
        return Err("suppressed construction plane exposed stale dependent geometry".into());
    }
    lifecycle.push("suppress".to_owned());
    let unsuppress = offset_plane_request(
        &runtime,
        &plane_id,
        base,
        parameter,
        edited_offset,
        false,
        &format!("transaction:{id}:unsuppress"),
    )?;
    runtime
        .commit_offset_construction_plane_json(&unsuppress.to_string())
        .map_err(|error| error.to_string())?;
    runtime
        .construction_plane_frame_json(&plane_id)
        .map_err(|error| error.to_string())?;
    active_result(&runtime)?;
    lifecycle.push("unsuppress".to_owned());
    runtime.undo().map_err(|error| error.to_string())?;
    if runtime.construction_plane_frame_json(&plane_id).is_ok() {
        return Err("undo did not restore suppressed construction plane".into());
    }
    lifecycle.push("undo".to_owned());
    runtime.redo().map_err(|error| error.to_string())?;
    runtime
        .construction_plane_frame_json(&plane_id)
        .map_err(|error| error.to_string())?;
    active_result(&runtime)?;
    lifecycle.push("redo".to_owned());

    let saved = runtime.document_json().map_err(|error| error.to_string())?;
    serde_json::from_str::<Value>(&saved).map_err(|error| error.to_string())?;
    let saved_hash = runtime.semantic_hash().map_err(|error| error.to_string())?;
    lifecycle.push("save".to_owned());
    runtime = PartRuntime::from_document_json(&saved).map_err(|error| error.to_string())?;
    if runtime.semantic_hash().map_err(|error| error.to_string())? != saved_hash {
        return Err("signed offset reload changed accepted state".into());
    }
    lifecycle.push("reload".to_owned());
    let reloaded_frame: Value = serde_json::from_str(
        &runtime
            .construction_plane_frame_json(&plane_id)
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    runtime
        .recompute_from_here_json(&feature_id)
        .map_err(|error| error.to_string())?;
    let (_final_active, final_result, final_body_hash) = active_result(&runtime)?;
    lifecycle.push("recompute".to_owned());

    let zero_edit = offset_plane_request(
        &runtime,
        &plane_id,
        base,
        parameter,
        zero_offset,
        false,
        &format!("transaction:{id}:plane-zero"),
    )?;
    runtime
        .commit_offset_construction_plane_json(&zero_edit.to_string())
        .map_err(|error| error.to_string())?;
    runtime
        .recompute_from_here_json(&feature_id)
        .map_err(|error| error.to_string())?;
    let zero_frame: Value = serde_json::from_str(
        &runtime
            .construction_plane_frame_json(&plane_id)
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    let (zero_active, zero_result, _) = active_result(&runtime)?;
    let zero_document: Value =
        serde_json::from_str(&runtime.document_json().map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
    let zero_observed = json!({
        "zero_offset_frame_origin_nm": exact_i64_array(&zero_frame["frame"]["origin_nanometers"], "zero-offset frame")?,
        "zero_offset_bounds_nm": observed_bounds(&zero_result)?,
        "zero_offset_stable_plane_id": zero_document["construction_planes"].as_object().and_then(|map| map.keys().find(|key| *key == &plane_id)).ok_or("zero-offset stable plane missing")?,
        "zero_offset_stable_sketch_id": zero_document["sketches"].as_object().and_then(|map| map.keys().find(|key| *key == &sketch_id)).ok_or("zero-offset stable sketch missing")?,
        "zero_offset_stable_feature_id": zero_document["features"].as_object().and_then(|map| map.keys().find(|key| *key == &feature_id)).ok_or("zero-offset stable feature missing")?,
        "zero_offset_stable_body_id": zero_active["body"]["body_id"],
    });
    let zero_expected = json!({
        "zero_offset_frame_origin_nm": [0, 0, 0],
        "zero_offset_bounds_nm": [-5_000_000, -3_000_000, 0, 5_000_000, 3_000_000, 4_000_000],
        "zero_offset_stable_plane_id": plane_id.clone(),
        "zero_offset_stable_sketch_id": sketch_id.clone(),
        "zero_offset_stable_feature_id": feature_id.clone(),
        "zero_offset_stable_body_id": format!("body:{id}"),
    });
    assert_sprint3_oracle(&zero_observed, &zero_expected)?;

    let restore_edit = offset_plane_request(
        &runtime,
        &plane_id,
        base,
        parameter,
        edited_offset,
        false,
        &format!("transaction:{id}:plane-zero-restore"),
    )?;
    runtime
        .commit_offset_construction_plane_json(&restore_edit.to_string())
        .map_err(|error| error.to_string())?;
    runtime
        .recompute_from_here_json(&feature_id)
        .map_err(|error| error.to_string())?;
    let (restored_active, restored_result, restored_body_hash) = active_result(&runtime)?;
    let document: Value =
        serde_json::from_str(&runtime.document_json().map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
    let transaction_ids = document["transactions"]
        .as_array()
        .ok_or("signed offset transactions absent")?
        .iter()
        .filter_map(|transaction| transaction["id"].as_str())
        .collect::<Vec<_>>();
    let zero_transaction = format!("transaction:{id}:plane-zero");
    let restore_transaction = format!("transaction:{id}:plane-zero-restore");
    let zero_position = transaction_ids
        .iter()
        .position(|transaction| *transaction == zero_transaction)
        .ok_or("signed offset zero transaction absent")?;
    let restore_position = transaction_ids
        .iter()
        .position(|transaction| *transaction == restore_transaction)
        .ok_or("signed offset zero-restore transaction absent")?;
    if zero_position >= restore_position {
        return Err(
            "signed offset zero/restore transaction order differs from parity sequence".into(),
        );
    }
    if restored_result["aabb_nm"] != final_result["aabb_nm"]
        || restored_body_hash != final_body_hash
        || document["parameters"][parameter]["value"]["value"] != edited_offset
    {
        return Err("signed offset zero-boundary restore did not recover edited state".into());
    }
    let frame_roundtrip = edited_frame["frame"] == reloaded_frame["frame"];
    let recompute_deterministic =
        edited_result["aabb_nm"] == final_result["aabb_nm"] && edited_body_hash == final_body_hash;
    let mut observed = json!({
        "initial_frame_origin_nm": exact_i64_array(&initial_frame["frame"]["origin_nanometers"], "initial frame")?,
        "edited_frame_origin_nm": exact_i64_array(&reloaded_frame["frame"]["origin_nanometers"], "edited frame")?,
        "initial_bounds_nm": observed_bounds(&initial_result)?,
        "edited_bounds_nm": observed_bounds(&final_result)?,
        "durable_offset_nm": document["parameters"][parameter]["value"]["value"],
        "durable_distance_nm": distance,
        "direction": direction,
        "offset_parameter_roundtrip": document["construction_planes"][&plane_id]["definition"]["offset"] == parameter,
        "frame_roundtrip": frame_roundtrip,
        "recompute_deterministic": recompute_deterministic,
        "stable_plane_id": plane_id.clone(),
        "stable_sketch_id": document["sketches"].as_object().and_then(|map| map.keys().find(|key| *key == &sketch_id)).ok_or("stable sketch missing")?,
        "stable_feature_id": document["features"].as_object().and_then(|map| map.keys().find(|key| *key == &feature_id)).ok_or("stable feature missing")?,
        "stable_body_id": restored_active["body"]["body_id"],
    });
    let expected = &binding.descriptor["expected"]["result"];
    let zero_fields = zero_observed
        .as_object()
        .ok_or("zero-offset observation is not an object")?;
    let declared_zero_fields = zero_fields
        .keys()
        .filter(|field| expected.get(*field).is_some())
        .count();
    if declared_zero_fields != 0 && declared_zero_fields != zero_fields.len() {
        return Err("frozen fixture declares an incomplete zero-offset oracle".into());
    }
    if declared_zero_fields == zero_fields.len() {
        for (field, value) in zero_fields {
            observed[field] = value.clone();
        }
    }
    assert_sprint3_oracle(&observed, expected)?;
    let after = runtime.semantic_hash().map_err(|error| error.to_string())?;
    let mut evidence_result = restored_result;
    evidence_result["stable_identity_sets"] = json!({
        "retained": [plane_id, sketch_id, feature_id, format!("body:{id}")],
        "replaced": [],
    });
    evidence_result["canonical_document_hash"] = json!(after);
    Ok(Observation {
        result: evidence_result,
        oracle_assertions: observed,
        before,
        after,
        body_hashes_before: Vec::new(),
        body_hashes_after: vec![restored_body_hash],
        executed_lifecycle_steps: validate_executed_lifecycle(binding, lifecycle)?,
    })
}

fn accepted_construction_plane_error_baseline(
    fixture_id: &str,
) -> Result<(PartRuntime, String), String> {
    let accepted_id = "accepted-before-construction-plane-error";
    let mut runtime = blank_runtime(fixture_id, "Construction Plane Negative Evidence")?;
    let sketch_value = sketch(&format!("sketch:{accepted_id}"), rectangle_geometry());
    let support_value = support("xy");
    accept_sketch(&mut runtime, accepted_id, &sketch_value, &support_value)?;
    let committed: Value = serde_json::from_str(
        &runtime
            .commit_sketch_extrude_json(
                &request(
                    accepted_id,
                    &sketch_value,
                    &support_value,
                    4_000_000,
                    &[],
                    true,
                )
                .to_string(),
            )
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    if committed["accepted"].as_bool() != Some(true) {
        return Err(format!("accepted negative baseline refused: {committed}"));
    }
    let (active, _, body) = active_result(&runtime)?;
    if active["body"]["body_id"] != "body:accepted-before-construction-plane-error" {
        return Err("negative baseline body identity differs".into());
    }
    Ok((runtime, body))
}

fn assert_accepted_runtime_state(
    runtime: &PartRuntime,
    expected_hash: &str,
    expected_body_hash: &str,
    context: &str,
) -> Result<(), String> {
    let actual_hash = runtime.semantic_hash().map_err(|error| error.to_string())?;
    let (active, _, actual_body_hash) = active_result(runtime)?;
    if actual_hash != expected_hash
        || actual_body_hash != expected_body_hash
        || active["body"]["body_id"] != "body:accepted-before-construction-plane-error"
    {
        return Err(format!(
            "{context} changed the last accepted construction-plane negative state"
        ));
    }
    Ok(())
}

fn assert_construction_plane_repair_transition(
    repaired: &PartRuntime,
    rejected_state_hash: &str,
    retained_body_hash: &str,
    repaired_plane: &str,
    context: &str,
) -> Result<(), String> {
    repaired
        .construction_plane_frame_json(repaired_plane)
        .map_err(|error| error.to_string())?;
    let repaired_hash = repaired
        .semantic_hash()
        .map_err(|error| error.to_string())?;
    let (active, _, body_hash) = active_result(repaired)?;
    if repaired_hash == rejected_state_hash
        || body_hash != retained_body_hash
        || active["body"]["body_id"] != "body:accepted-before-construction-plane-error"
        || active["feature_id"] != "feature:accepted-before-construction-plane-error"
    {
        return Err(format!(
            "{context} did not create a distinct repaired plane while retaining the accepted baseline body/feature"
        ));
    }
    Ok(())
}

fn construction_plane_structured_error(
    kind: &str,
    runtime_error: &str,
    referenced_id: &str,
) -> Result<Value, String> {
    let (code, field_path) = match kind {
        "construction_plane_missing_reference_v3" => (
            "missing_construction_plane_base_plane",
            "construction_plane.base_plane",
        ),
        "construction_plane_missing_parameter_v3" => (
            "missing_construction_plane_offset_parameter",
            "construction_plane.offset_parameter",
        ),
        "construction_plane_wrong_type_offset_parameter_v3" => (
            "wrong_type_construction_plane_offset_parameter",
            "construction_plane.offset_parameter",
        ),
        "construction_plane_wrong_type_parameter_v3" => (
            "wrong_type_construction_plane_offset_parameter",
            "construction_plane.offset_parameter",
        ),
        "construction_plane_unsafe_offset_parameter_v3" => (
            "unsafe_construction_plane_offset_parameter",
            "construction_plane.offset_parameter",
        ),
        "construction_plane_unsafe_parameter_v3" => (
            "unsafe_construction_plane_offset_parameter",
            "construction_plane.offset_parameter",
        ),
        "extrude_missing_construction_plane_support_v3" => {
            ("missing_construction_plane_support", "extrude.support")
        }
        "extrude_suppressed_construction_plane_support_v3" => {
            ("suppressed_construction_plane_support", "extrude.support")
        }
        "extrude_invalid_construction_plane_dependency_v3" => {
            ("invalid_construction_plane_dependency", "extrude.support")
        }
        _ => {
            return Err(format!(
                "unsupported construction-plane negative kind {kind}"
            ));
        }
    };
    if !runtime_error.contains(code)
        || !runtime_error.contains(field_path)
        || !runtime_error.contains(referenced_id)
    {
        return Err(format!(
            "runtime error lacks the frozen construction-plane diagnostic contract: {runtime_error}"
        ));
    }
    Ok(json!({
        "kind": "structured_error",
        "category": "reference",
        "code": code,
        "field_path": field_path,
        "referenced_entity_ids": [referenced_id],
    }))
}

fn execute_construction_plane_parameter_negative(
    id: &str,
    binding: &FixtureBinding,
) -> Result<Observation, String> {
    let kind = binding.descriptor["input"]["kind"]
        .as_str()
        .ok_or("construction-plane parameter-negative kind absent")?;
    let payload = &binding.descriptor["input"]["payload"];
    let plane = payload["plane"].as_str().ok_or("negative plane absent")?;
    let parameter = payload["offset_parameter"]
        .as_str()
        .ok_or("negative offset parameter absent")?;
    let base = match payload["base_plane"]
        .as_str()
        .ok_or("negative base plane absent")?
    {
        "origin.xy" | "origin-plane:xy" => "origin-plane:xy",
        "origin.xz" | "origin-plane:xz" => "origin-plane:xz",
        "origin.yz" | "origin-plane:yz" => "origin-plane:yz",
        other => return Err(format!("unsupported parameter-negative base plane {other}")),
    };
    let attempted_offset = payload["attempted_offset_nanometers"]
        .as_i64()
        .or_else(|| payload["request_offset_nanometers"].as_i64())
        .ok_or("attempted/request offset absent")?;
    if let Some(request_offset) = payload["request_offset_nanometers"].as_i64()
        && request_offset != attempted_offset
    {
        return Err(format!(
            "request_offset_nanometers {request_offset} differs from attempted_offset_nanometers {attempted_offset}"
        ));
    }
    let repair_offset = payload["repair_offset_nanometers"]
        .as_i64()
        .ok_or("repair offset absent")?;
    let invalid_value = payload["parameter_value"].clone();
    if !invalid_value.is_object() {
        return Err("negative parameter_value is not an object".into());
    }

    let (mut runtime, body_before) = accepted_construction_plane_error_baseline(id)?;
    runtime
        .commit_changes_json(
            &json!({
                "transaction_id": format!("transaction:{id}:invalid-parameter-setup"),
                "changes": [{
                    "kind": "create_parameter",
                    "component": "component:root",
                    "parameter": {
                        "id": parameter,
                        "display_name": "Invalid Offset Evidence",
                        "value": invalid_value,
                    },
                }],
            })
            .to_string(),
        )
        .map_err(|error| error.to_string())?;
    let before = runtime.semantic_hash().map_err(|error| error.to_string())?;
    let canonical = runtime.document_json().map_err(|error| error.to_string())?;
    let mut lifecycle = Vec::new();
    assert_accepted_runtime_state(&runtime, &before, &body_before, "parameter-negative setup")?;

    let request = offset_plane_request(
        &runtime,
        plane,
        base,
        parameter,
        attempted_offset,
        false,
        &format!("transaction:{id}:invalid-plane"),
    )?;
    let preview_error = runtime
        .preview_offset_construction_plane_json(&request.to_string())
        .err()
        .ok_or("parameter-negative preview unexpectedly succeeded")?
        .to_string();
    for value_token in match invalid_value["value"].as_str() {
        Some(value) => vec![value.to_owned()],
        None => vec![invalid_value["value"].to_string()],
    } {
        if !preview_error.contains(&value_token) {
            return Err(format!(
                "parameter-negative preview diagnostic omits value {value_token}: {preview_error}"
            ));
        }
    }
    assert_accepted_runtime_state(
        &runtime,
        &before,
        &body_before,
        "parameter-negative preview",
    )?;
    lifecycle.push("preview".to_owned());

    let mut commit_runtime =
        PartRuntime::from_document_json(&canonical).map_err(|error| error.to_string())?;
    let commit_error = commit_runtime
        .commit_offset_construction_plane_json(&request.to_string())
        .err()
        .ok_or("parameter-negative commit unexpectedly succeeded")?
        .to_string();
    if preview_error != commit_error {
        return Err(format!(
            "parameter-negative preview/commit diagnostics differ: {preview_error:?} vs {commit_error:?}"
        ));
    }
    assert_accepted_runtime_state(
        &commit_runtime,
        &before,
        &body_before,
        "parameter-negative commit rejection",
    )?;
    lifecycle.push("commit".to_owned());

    let saved = runtime.document_json().map_err(|error| error.to_string())?;
    serde_json::from_str::<Value>(&saved).map_err(|error| error.to_string())?;
    assert_accepted_runtime_state(&runtime, &before, &body_before, "parameter-negative save")?;
    lifecycle.push("save".to_owned());

    let mut repaired =
        PartRuntime::from_document_json(&saved).map_err(|error| error.to_string())?;
    assert_accepted_runtime_state(
        &repaired,
        &before,
        &body_before,
        "parameter-negative reopen",
    )?;
    lifecycle.push("reopen".to_owned());

    let repair_parameter = if matches!(
        kind,
        "construction_plane_wrong_type_parameter_v3"
            | "construction_plane_wrong_type_offset_parameter_v3"
    ) {
        payload["repair_offset_parameter"]
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| format!("{parameter}:repair"))
    } else {
        repaired
            .commit_changes_json(
                &json!({
                    "transaction_id": format!("transaction:{id}:repair-parameter"),
                    "changes": [{
                        "kind": "set_parameter_value",
                        "parameter": parameter,
                        "value": {"kind":"length_nanometers", "value":repair_offset},
                    }],
                })
                .to_string(),
            )
            .map_err(|error| error.to_string())?;
        parameter.to_owned()
    };
    let repair = offset_plane_request(
        &repaired,
        plane,
        base,
        &repair_parameter,
        repair_offset,
        false,
        &format!("transaction:{id}:repair-plane"),
    )?;
    repaired
        .commit_offset_construction_plane_json(&repair.to_string())
        .map_err(|error| error.to_string())?;
    repaired
        .construction_plane_frame_json(plane)
        .map_err(|error| error.to_string())?;
    let repaired_document: Value = serde_json::from_str(
        &repaired
            .document_json()
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    if repaired_document["parameters"][&repair_parameter]["value"]["value"] != repair_offset
        || repaired_document["construction_planes"][plane]["definition"]["offset"]
            != repair_parameter
    {
        return Err("parameter-negative repair did not persist the safe length".into());
    }
    assert_construction_plane_repair_transition(
        &repaired,
        &before,
        &body_before,
        plane,
        "parameter-negative repair",
    )?;
    assert_accepted_runtime_state(&runtime, &before, &body_before, "parameter-negative repair")?;
    lifecycle.push("repair".to_owned());

    let result = construction_plane_structured_error(kind, &preview_error, parameter)?;
    let mut expected = binding.descriptor["expected"]["error"].clone();
    expected["kind"] = json!("structured_error");
    if result != expected {
        return Err(format!(
            "construction-plane parameter error differs from descriptor: {result} vs {expected}"
        ));
    }
    let after = runtime.semantic_hash().map_err(|error| error.to_string())?;
    let (_, _, body_after) = active_result(&runtime)?;
    if before != after || body_before != body_after {
        return Err("construction-plane parameter negative mutated accepted hash/body".into());
    }
    Ok(Observation {
        result,
        oracle_assertions: json!({}),
        before,
        after,
        body_hashes_before: vec![body_before],
        body_hashes_after: vec![body_after],
        executed_lifecycle_steps: validate_executed_lifecycle(binding, lifecycle)?,
    })
}

fn execute_construction_plane_support_negative(
    id: &str,
    binding: &FixtureBinding,
) -> Result<Observation, String> {
    let kind = binding.descriptor["input"]["kind"]
        .as_str()
        .ok_or("construction-plane support-negative kind absent")?;
    let payload = &binding.descriptor["input"]["payload"];
    let plane = payload["plane"].as_str().ok_or("support plane absent")?;
    let parameter = payload["offset_parameter"]
        .as_str()
        .ok_or("support offset parameter absent")?;
    let invalid_dependency = payload["invalid_dependency"]
        .as_str()
        .unwrap_or("origin-plane:missing-dependency");
    let (mut runtime, body_before) = accepted_construction_plane_error_baseline(id)?;
    let probe_id = format!("{id}:support-probe");
    let probe_sketch = sketch(&format!("sketch:{probe_id}"), rectangle_geometry());
    let origin_support = support("xy");
    let plane_support = construction_support(plane);

    if kind == "extrude_suppressed_construction_plane_support_v3" {
        let accepted_plane = offset_plane_request(
            &runtime,
            plane,
            "origin-plane:xy",
            parameter,
            0,
            false,
            &format!("transaction:{id}:plane-setup"),
        )?;
        runtime
            .commit_offset_construction_plane_json(&accepted_plane.to_string())
            .map_err(|error| error.to_string())?;
        accept_sketch(&mut runtime, &probe_id, &probe_sketch, &plane_support)?;
        let suppressed = offset_plane_request(
            &runtime,
            plane,
            "origin-plane:xy",
            parameter,
            0,
            true,
            &format!("transaction:{id}:suppressed-setup"),
        )?;
        runtime
            .commit_offset_construction_plane_json(&suppressed.to_string())
            .map_err(|error| error.to_string())?;
    } else if kind == "extrude_missing_construction_plane_support_v3" {
        accept_sketch(&mut runtime, &probe_id, &probe_sketch, &origin_support)?;
    }
    let before = runtime.semantic_hash().map_err(|error| error.to_string())?;
    let canonical = runtime.document_json().map_err(|error| error.to_string())?;
    let mut lifecycle = Vec::new();

    let (runtime_error, referenced_id) = match kind {
        "extrude_missing_construction_plane_support_v3" => (
            runtime
                .preview_sketch_extrude_json(
                    &request(
                        &probe_id,
                        &probe_sketch,
                        &plane_support,
                        4_000_000,
                        &[],
                        false,
                    )
                    .to_string(),
                )
                .err()
                .ok_or("missing support Extrude preview unexpectedly succeeded")?
                .to_string(),
            plane,
        ),
        "extrude_suppressed_construction_plane_support_v3" => (
            runtime
                .preview_sketch_extrude_json(
                    &request(
                        &probe_id,
                        &probe_sketch,
                        &plane_support,
                        4_000_000,
                        &[],
                        false,
                    )
                    .to_string(),
                )
                .err()
                .ok_or("suppressed support Extrude preview unexpectedly succeeded")?
                .to_string(),
            plane,
        ),
        "extrude_invalid_construction_plane_dependency_v3" => {
            let mut invalid: Value =
                serde_json::from_str(&canonical).map_err(|error| error.to_string())?;
            invalid["construction_planes"][plane] = json!({
                "schema_version": 1,
                "id": plane,
                "component": "component:root",
                "definition": {"kind":"offset", "base_plane":invalid_dependency, "offset":parameter},
                "suppressed": false,
            });
            invalid["components"]["component:root"]["construction_plane_order"] = json!([plane]);
            invalid["parameters"][parameter] = json!({
                "id": parameter,
                "display_name": "Invalid Dependency Offset",
                "value": {"kind":"length_nanometers", "value":0},
            });
            invalid["components"]["component:root"]["parameter_order"]
                .as_array_mut()
                .ok_or("component parameter order absent")?
                .push(json!(parameter));
            (
                PartRuntime::from_document_json(&invalid.to_string())
                    .err()
                    .ok_or("invalid dependency document unexpectedly loaded")?
                    .to_string(),
                invalid_dependency,
            )
        }
        _ => return Err(format!("unsupported support-negative kind {kind}")),
    };
    let observed_step = if kind == "extrude_invalid_construction_plane_dependency_v3" {
        "load"
    } else {
        "preview"
    };
    assert_accepted_runtime_state(
        &runtime,
        &before,
        &body_before,
        &format!("support-negative {observed_step}"),
    )?;
    lifecycle.push(observed_step.to_owned());

    let saved = runtime.document_json().map_err(|error| error.to_string())?;
    serde_json::from_str::<Value>(&saved).map_err(|error| error.to_string())?;
    assert_accepted_runtime_state(&runtime, &before, &body_before, "support-negative save")?;
    lifecycle.push("save".to_owned());

    let mut repaired =
        PartRuntime::from_document_json(&saved).map_err(|error| error.to_string())?;
    assert_accepted_runtime_state(&repaired, &before, &body_before, "support-negative reopen")?;
    lifecycle.push("reopen".to_owned());
    let repair = offset_plane_request(
        &repaired,
        plane,
        "origin-plane:xy",
        parameter,
        0,
        false,
        &format!("transaction:{id}:repair"),
    )?;
    repaired
        .commit_offset_construction_plane_json(&repair.to_string())
        .map_err(|error| error.to_string())?;
    repaired
        .construction_plane_frame_json(plane)
        .map_err(|error| error.to_string())?;
    let repaired_probe = if kind == "extrude_suppressed_construction_plane_support_v3" {
        probe_sketch.clone()
    } else {
        let repaired_probe = sketch(
            &format!("sketch:{id}:repaired-support-probe"),
            rectangle_geometry(),
        );
        accept_sketch(
            &mut repaired,
            &format!("{id}:repaired-support-probe"),
            &repaired_probe,
            &plane_support,
        )?;
        repaired_probe
    };
    let repair_preview_hash = repaired
        .semantic_hash()
        .map_err(|error| error.to_string())?;
    repaired
        .preview_sketch_extrude_json(
            &request(
                &format!("{id}:repaired-support-preview"),
                &repaired_probe,
                &plane_support,
                4_000_000,
                &[],
                false,
            )
            .to_string(),
        )
        .map_err(|error| error.to_string())?;
    if repaired
        .semantic_hash()
        .map_err(|error| error.to_string())?
        != repair_preview_hash
    {
        return Err("support repair Extrude preview mutated repaired state".into());
    }
    assert_construction_plane_repair_transition(
        &repaired,
        &before,
        &body_before,
        plane,
        "support-negative repair",
    )?;
    assert_accepted_runtime_state(&runtime, &before, &body_before, "support-negative repair")?;
    lifecycle.push("repair".to_owned());

    let result = construction_plane_structured_error(kind, &runtime_error, referenced_id)?;
    let mut expected = binding.descriptor["expected"]["error"].clone();
    expected["kind"] = json!("structured_error");
    if result != expected {
        return Err(format!(
            "construction-plane support error differs from descriptor: {result} vs {expected}"
        ));
    }
    let after = runtime.semantic_hash().map_err(|error| error.to_string())?;
    let (_, _, body_after) = active_result(&runtime)?;
    Ok(Observation {
        result,
        oracle_assertions: json!({}),
        before,
        after,
        body_hashes_before: vec![body_before],
        body_hashes_after: vec![body_after],
        executed_lifecycle_steps: validate_executed_lifecycle(binding, lifecycle)?,
    })
}

fn execute_construction_plane_negative(
    id: &str,
    binding: &FixtureBinding,
) -> Result<Observation, String> {
    let kind = binding.descriptor["input"]["kind"]
        .as_str()
        .ok_or("construction-plane negative kind absent")?;
    let payload = &binding.descriptor["input"]["payload"];
    let plane = payload["plane"].as_str().ok_or("negative plane absent")?;
    let base = payload["base_plane"]
        .as_str()
        .ok_or("negative base absent")?;
    let parameter = payload["offset_parameter"]
        .as_str()
        .ok_or("negative offset parameter absent")?;
    let (mut runtime, body_before) = accepted_construction_plane_error_baseline(id)?;
    let accepted_offset_parameter = format!("{parameter}:accepted");
    if kind == "construction_plane_missing_parameter_v3" {
        let accepted_plane = offset_plane_request(
            &runtime,
            plane,
            "origin-plane:xy",
            &accepted_offset_parameter,
            0,
            false,
            &format!("transaction:{id}:accepted-plane-setup"),
        )?;
        runtime
            .commit_offset_construction_plane_json(&accepted_plane.to_string())
            .map_err(|error| error.to_string())?;
        runtime
            .construction_plane_frame_json(plane)
            .map_err(|error| error.to_string())?;
    }
    let before = runtime.semantic_hash().map_err(|error| error.to_string())?;
    let canonical = runtime.document_json().map_err(|error| error.to_string())?;
    let mut lifecycle = Vec::new();

    let runtime_error = if kind == "construction_plane_missing_reference_v3" {
        let request = offset_plane_request(
            &runtime,
            plane,
            base,
            parameter,
            payload["offset_nanometers"]
                .as_i64()
                .ok_or("negative offset value absent")?,
            false,
            &format!("transaction:{id}:invalid-plane"),
        )?;
        let preview_error = runtime
            .preview_offset_construction_plane_json(&request.to_string())
            .err()
            .ok_or("missing-base preview unexpectedly succeeded")?
            .to_string();
        assert_accepted_runtime_state(&runtime, &before, &body_before, "missing-base preview")?;
        lifecycle.push("preview".to_owned());

        let mut commit_runtime =
            PartRuntime::from_document_json(&canonical).map_err(|error| error.to_string())?;
        let commit_error = commit_runtime
            .commit_offset_construction_plane_json(&request.to_string())
            .err()
            .ok_or("missing-base commit unexpectedly succeeded")?
            .to_string();
        assert_accepted_runtime_state(
            &commit_runtime,
            &before,
            &body_before,
            "missing-base commit rejection",
        )?;
        lifecycle.push("commit".to_owned());
        if preview_error != commit_error {
            return Err(format!(
                "missing-base preview/commit diagnostics differ: {preview_error:?} vs {commit_error:?}"
            ));
        }
        let mut repaired =
            PartRuntime::from_document_json(&canonical).map_err(|error| error.to_string())?;
        let repair = offset_plane_request(
            &repaired,
            plane,
            "origin-plane:xy",
            parameter,
            payload["offset_nanometers"].as_i64().unwrap(),
            false,
            &format!("transaction:{id}:repair"),
        )?;
        repaired
            .commit_offset_construction_plane_json(&repair.to_string())
            .map_err(|error| error.to_string())?;
        repaired
            .construction_plane_frame_json(plane)
            .map_err(|error| error.to_string())?;
        assert_construction_plane_repair_transition(
            &repaired,
            &before,
            &body_before,
            plane,
            "missing-base repair",
        )?;
        assert_accepted_runtime_state(&runtime, &before, &body_before, "missing-base repair")?;
        lifecycle.push("repair".to_owned());

        let mut recomputed =
            PartRuntime::from_document_json(&canonical).map_err(|error| error.to_string())?;
        recomputed
            .recompute_from_here_json("feature:accepted-before-construction-plane-error")
            .map_err(|error| error.to_string())?;
        let (recomputed_active, _, recomputed_body) = active_result(&recomputed)?;
        if recomputed_body != body_before
            || recomputed_active["body"]["body_id"]
                != "body:accepted-before-construction-plane-error"
        {
            return Err("missing-base recompute changed the accepted body".into());
        }
        assert_accepted_runtime_state(&runtime, &before, &body_before, "missing-base recompute")?;
        lifecycle.push("recompute".to_owned());
        preview_error
    } else if kind == "construction_plane_missing_parameter_v3" {
        let request = offset_plane_request(
            &runtime,
            plane,
            "origin-plane:xy",
            parameter,
            0,
            false,
            &format!("transaction:{id}:missing-offset-edit"),
        )?;
        let preview_error = runtime
            .preview_offset_construction_plane_json(&request.to_string())
            .err()
            .ok_or("missing-offset existing-plane preview unexpectedly succeeded")?
            .to_string();
        assert_accepted_runtime_state(&runtime, &before, &body_before, "missing-offset preview")?;
        lifecycle.push("preview".to_owned());

        let mut commit_runtime =
            PartRuntime::from_document_json(&canonical).map_err(|error| error.to_string())?;
        let commit_error = commit_runtime
            .commit_offset_construction_plane_json(&request.to_string())
            .err()
            .ok_or("missing-offset existing-plane commit unexpectedly succeeded")?
            .to_string();
        if preview_error != commit_error {
            return Err(format!(
                "missing-offset preview/commit diagnostics differ: {preview_error:?} vs {commit_error:?}"
            ));
        }
        assert_accepted_runtime_state(
            &commit_runtime,
            &before,
            &body_before,
            "missing-offset commit rejection",
        )?;
        lifecycle.push("commit".to_owned());

        let saved = runtime.document_json().map_err(|error| error.to_string())?;
        serde_json::from_str::<Value>(&saved).map_err(|error| error.to_string())?;
        assert_accepted_runtime_state(&runtime, &before, &body_before, "missing-offset save")?;
        lifecycle.push("save".to_owned());

        let mut repaired =
            PartRuntime::from_document_json(&saved).map_err(|error| error.to_string())?;
        assert_accepted_runtime_state(&repaired, &before, &body_before, "missing-offset reopen")?;
        lifecycle.push("reopen".to_owned());

        let repair = offset_plane_request(
            &repaired,
            plane,
            "origin-plane:xy",
            &accepted_offset_parameter,
            0,
            false,
            &format!("transaction:{id}:repair"),
        )?;
        repaired
            .commit_offset_construction_plane_json(&repair.to_string())
            .map_err(|error| error.to_string())?;
        repaired
            .construction_plane_frame_json(plane)
            .map_err(|error| error.to_string())?;
        let repaired_document: Value = serde_json::from_str(
            &repaired
                .document_json()
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        if repaired_document["construction_planes"][plane]["definition"]["offset"]
            != accepted_offset_parameter
            || repaired_document["parameters"][&accepted_offset_parameter]["value"]["kind"]
                != "length_nanometers"
        {
            return Err("missing-offset repair did not durably restore its parameter".into());
        }
        assert_construction_plane_repair_transition(
            &repaired,
            &before,
            &body_before,
            plane,
            "missing-offset repair",
        )?;
        assert_accepted_runtime_state(&runtime, &before, &body_before, "missing-offset repair")?;
        lifecycle.push("repair".to_owned());
        preview_error
    } else {
        return Err(format!(
            "unsupported construction-plane negative kind {kind}"
        ));
    };
    let result = construction_plane_structured_error(
        kind,
        &runtime_error,
        if kind == "construction_plane_missing_reference_v3" {
            base
        } else {
            parameter
        },
    )?;
    if result != binding.descriptor["expected"]["error"] {
        let mut expected = binding.descriptor["expected"]["error"].clone();
        expected["kind"] = json!("structured_error");
        if result != expected {
            return Err(format!(
                "construction-plane structured error differs from descriptor: {result} vs {expected}"
            ));
        }
    }
    let after = runtime.semantic_hash().map_err(|error| error.to_string())?;
    let (active_after, _, body_after) = active_result(&runtime)?;
    if before != after
        || body_before != body_after
        || active_after["body"]["body_id"] != "body:accepted-before-construction-plane-error"
    {
        return Err("construction-plane negative mutated accepted hash/body".into());
    }
    Ok(Observation {
        result,
        oracle_assertions: json!({}),
        before,
        after,
        body_hashes_before: vec![body_before],
        body_hashes_after: vec![body_after],
        executed_lifecycle_steps: validate_executed_lifecycle(binding, lifecycle)?,
    })
}

fn execute_legacy(id: &str, binding: &FixtureBinding) -> Result<Observation, String> {
    let mut runtime = rectangular_runtime(id, "Legacy Matrix Evidence")?;
    let before = runtime.semantic_hash().map_err(|e| e.to_string())?;
    let before_active: Value =
        serde_json::from_str(&runtime.active_body_json(0.01).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let mut lifecycle = Vec::new();

    runtime = PartRuntime::from_document_json(&runtime.document_json().map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    lifecycle.push("reload".to_owned());
    let document: Value =
        serde_json::from_str(&runtime.document_json().map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let feature = document["features"]
        .as_object()
        .and_then(|features| features.keys().next_back())
        .ok_or("legacy document has no feature")?
        .clone();
    let recompute: Value = serde_json::from_str(
        &runtime
            .recompute_from_here_json(&feature)
            .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    if recompute["accepted"].as_bool() != Some(true) {
        return Err(format!("legacy recompute refused: {recompute}"));
    }
    lifecycle.push("recompute".to_owned());
    runtime
        .commit_length("parameter:distance", 4_000_000)
        .map_err(|e| e.to_string())?;
    lifecycle.push("edit".to_owned());
    let edited = runtime.document_json().map_err(|e| e.to_string())?;
    lifecycle.push("save".to_owned());
    runtime = PartRuntime::from_document_json(&edited).map_err(|e| e.to_string())?;
    lifecycle.push("reopen".to_owned());
    let hash = runtime.semantic_hash().map_err(|e| e.to_string())?;
    let active: Value =
        serde_json::from_str(&runtime.active_body_json(0.01).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let mut result = success_result(&active, false)?;
    result["canonical_document_hash"] = json!(hash);
    project_declared_identity(&mut result, binding)?;

    let matrix: Value = serde_json::from_slice(
        &fs::read("contracts/solid-feature-candidate/legacy-solid-feature-matrix.v1.json")
            .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let requested = binding.descriptor["input"]["payload"]["operations"]
        .as_array()
        .ok_or("legacy requested operations absent")?
        .iter()
        .filter_map(Value::as_str)
        .collect::<BTreeSet<_>>();
    let mut dispositions = BTreeSet::new();
    for operation in matrix["operations"]
        .as_array()
        .ok_or("legacy policy operations absent")?
    {
        let name = operation["schema_id"]
            .as_str()
            .unwrap_or_default()
            .strip_prefix("crawler.part.")
            .unwrap_or_default()
            .replace('.', "_");
        if requested.contains(name.as_str())
            && let Some(disposition) = operation["disposition"].as_str()
        {
            dispositions.insert(disposition.to_owned());
        }
    }
    let oracle_assertions = json!({
        "required_dispositions": dispositions,
        "automatic_v1_to_v2_migration": matrix["automatic_v1_to_v2_migration"].as_bool().ok_or("legacy migration policy absent")?,
        "future_schema_disposition": matrix["future_schema"]["disposition"].as_str().ok_or("future schema disposition absent")?,
        "downgrade_disposition": matrix["downgrade"]["disposition"].as_str().ok_or("downgrade disposition absent")?,
        "polygon_sweep_relabelled": matrix["operations"].as_array().unwrap().iter().any(|operation| operation["schema_id"].as_str().is_some_and(|id| id.contains("polygon_sweep"))),
    });
    Ok(Observation {
        result,
        oracle_assertions,
        before,
        after: hash,
        body_hashes_before: vec![body_hash(&before_active)?],
        body_hashes_after: vec![body_hash(&active)?],
        executed_lifecycle_steps: lifecycle,
    })
}

fn execute_negative(id: &str, binding: &FixtureBinding) -> Result<Observation, String> {
    if binding.descriptor["input"]["kind"].as_str() == Some("definition_v2") {
        return execute_missing_reference(id, binding);
    }
    if binding.descriptor["input"]["kind"].as_str() == Some("region_edit") {
        return execute_region_repair(id, binding);
    }
    let mut runtime = blank_runtime(id, "Negative Evidence")?;
    let payload = &binding.descriptor["input"]["payload"];
    let geometry = if payload["profile"].as_str() == Some("unsupported-spline") {
        json!({"curve:spline-1":{"id":"curve:spline-1","geometry":{"kind":"control_point_spline","degree":2,"control_points":[{"x_nm":0,"y_nm":0},{"x_nm":5_000_000,"y_nm":0},{"x_nm":5_000_000,"y_nm":5_000_000},{"x_nm":0,"y_nm":0}]}}})
    } else if payload["outer"].as_str() == Some("open-rectangle") {
        json!({
            "curve:line-1":{"id":"curve:line-1","geometry":{"kind":"line","start":{"x_nm":0,"y_nm":0},"end":{"x_nm":5_000_000,"y_nm":0}}},
            "curve:line-2":{"id":"curve:line-2","geometry":{"kind":"line","start":{"x_nm":5_000_000,"y_nm":0},"end":{"x_nm":5_000_000,"y_nm":5_000_000}}},
            "curve:line-4":{"id":"curve:line-4","geometry":{"kind":"line","start":{"x_nm":5_000_000,"y_nm":5_000_000},"end":{"x_nm":0,"y_nm":1_000}}}
        })
    } else if payload["outer"].as_str() == Some("overlapping-loop") {
        json!({
            "curve:line-2":{"id":"curve:line-2","geometry":{"kind":"rectangle","min":{"x_nm":-5_000_000,"y_nm":-5_000_000},"max":{"x_nm":5_000_000,"y_nm":5_000_000}}},
            "curve:line-5":{"id":"curve:line-5","geometry":{"kind":"rectangle","min":{"x_nm":0,"y_nm":-5_000_000},"max":{"x_nm":10_000_000,"y_nm":5_000_000}}}
        })
    } else {
        rectangle_geometry()
    };
    let sketch = sketch(&format!("sketch:{id}"), geometry);
    let support = support("xy");
    let solve = runtime.solve_sketch_json(&json!({"transaction_id":format!("transaction:{id}:sketch"),"sketch":sketch.clone(),"support":support}).to_string());
    let before_attempt = runtime.semantic_hash().map_err(|e| e.to_string())?;
    let selected = if binding.descriptor["input"]["kind"].as_str() == Some("definition_v2") {
        payload["references"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
    } else if binding.descriptor["input"]["kind"].as_str() == Some("region_edit") {
        vec!["geometry:missing-after-split"]
    } else {
        vec![]
    };
    let attempt = if solve.is_err() {
        solve.map(|_| String::new())
    } else {
        runtime.preview_sketch_extrude_json(
            &request(id, &sketch, &support, 4_000_000, &selected, false).to_string(),
        )
    };
    let runtime_error = attempt
        .err()
        .ok_or_else(|| format!("negative workload {id} unexpectedly succeeded"))?
        .to_string();
    let mut lifecycle = vec!["preview".to_owned()];
    if declared_step(binding, "commit") {
        let commit = runtime.commit_sketch_extrude_json(
            &request(id, &sketch, &support, 4_000_000, &selected, true).to_string(),
        );
        if commit.is_ok() {
            return Err(format!(
                "negative workload {id} commit unexpectedly succeeded"
            ));
        }
        lifecycle.push("commit".to_owned());
    }
    if declared_step(binding, "edit") {
        let mut edit = request(id, &sketch, &support, 5_000_000, &selected, true);
        edit["transaction_id"] = json!(format!("transaction:{id}:rejected-edit"));
        if runtime
            .commit_sketch_extrude_json(&edit.to_string())
            .is_ok()
        {
            return Err(format!(
                "negative workload {id} edit unexpectedly succeeded"
            ));
        }
        lifecycle.push("edit".to_owned());
    }
    if declared_step(binding, "recompute") {
        if runtime
            .recompute_from_here_json(&format!("feature:{id}"))
            .is_ok()
        {
            return Err(format!(
                "negative workload {id} recompute unexpectedly succeeded"
            ));
        }
        lifecycle.push("recompute".to_owned());
    }
    if declared_step(binding, "repair") {
        let document = runtime.document_json().map_err(|e| e.to_string())?;
        let mut repair = PartRuntime::from_document_json(&document).map_err(|e| e.to_string())?;
        let repaired_sketch = json!({
            "id": format!("sketch:{id}:repair"),
            "revision": 0,
            "geometry": rectangle_geometry(),
            "constraints": {}
        });
        accept_sketch(
            &mut repair,
            &format!("{id}:repair"),
            &repaired_sketch,
            &support,
        )?;
        let repaired: Value = serde_json::from_str(
            &repair
                .commit_sketch_extrude_json(
                    &request(
                        &format!("{id}:repair"),
                        &repaired_sketch,
                        &support,
                        4_000_000,
                        &[],
                        true,
                    )
                    .to_string(),
                )
                .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        if repaired["accepted"].as_bool() != Some(true) {
            return Err(format!("repair workload refused: {repaired}"));
        }
        lifecycle.push("repair".to_owned());
    }
    let after_attempt = runtime.semantic_hash().map_err(|e| e.to_string())?;
    if before_attempt != after_attempt {
        return Err("negative workload mutated accepted document".into());
    }
    Ok(Observation {
        result: structured_error_from_runtime(&runtime_error, &sketch, &selected, binding)?,
        oracle_assertions: json!({}),
        before: before_attempt.clone(),
        after: after_attempt,
        body_hashes_before: vec![],
        body_hashes_after: vec![],
        executed_lifecycle_steps: lifecycle,
    })
}

fn execute_region_repair(id: &str, binding: &FixtureBinding) -> Result<Observation, String> {
    let mut runtime = blank_runtime(id, "Negative Evidence")?;
    let sketch = sketch(&format!("sketch:{id}"), rectangle_geometry());
    let support = support("xy");
    accept_sketch(&mut runtime, id, &sketch, &support)?;
    let initial: Value = serde_json::from_str(
        &runtime
            .commit_sketch_extrude_json(
                &request(id, &sketch, &support, 4_000_000, &[], true).to_string(),
            )
            .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    if initial["accepted"].as_bool() != Some(true) {
        return Err(format!("repair setup commit refused: {initial}"));
    }
    let recomputed: Value = serde_json::from_str(
        &runtime
            .recompute_from_here_json(&format!("feature:{id}"))
            .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    if recomputed["accepted"].as_bool() != Some(true) {
        return Err(format!("repair setup recompute refused: {recomputed}"));
    }
    let before = runtime.semantic_hash().map_err(|e| e.to_string())?;
    let active =
        serde_json::from_str::<Value>(&runtime.active_body_json(0.01).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let body = body_hash(&active)?;
    let original = binding.descriptor["input"]["payload"]["original_region"]
        .as_str()
        .ok_or("region repair input lacks original_region")?;
    let runtime_error = runtime
        .commit_sketch_extrude_json(
            &request(id, &sketch, &support, 5_000_000, &[original], true).to_string(),
        )
        .err()
        .ok_or("stale region edit unexpectedly succeeded")?
        .to_string();
    runtime
        .preview_sketch_extrude_json(
            &request(id, &sketch, &support, 4_000_000, &[], false).to_string(),
        )
        .map_err(|e| e.to_string())?;
    let after = runtime.semantic_hash().map_err(|e| e.to_string())?;
    if after != before
        || body_hash(
            &serde_json::from_str::<Value>(
                &runtime.active_body_json(0.01).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?,
        )? != body
    {
        return Err("region repair validation mutated the accepted runtime".into());
    }
    Ok(Observation {
        result: structured_error_from_runtime(&runtime_error, &sketch, &[original], binding)?,
        oracle_assertions: json!({}),
        before: before.clone(),
        after,
        body_hashes_before: vec![body.clone()],
        body_hashes_after: vec![body],
        executed_lifecycle_steps: ["commit", "edit", "recompute", "repair"]
            .into_iter()
            .map(str::to_owned)
            .collect(),
    })
}

fn execute_missing_reference(id: &str, binding: &FixtureBinding) -> Result<Observation, String> {
    let mut runtime = blank_runtime(id, "Missing Definition Evidence")?;
    let sketch = sketch(&format!("sketch:{id}"), rectangle_geometry());
    let support = support("xy");
    accept_sketch(&mut runtime, id, &sketch, &support)?;
    let accepted_sketch = runtime.semantic_hash().map_err(|e| e.to_string())?;
    runtime
        .preview_sketch_extrude_json(
            &request(id, &sketch, &support, 4_000_000, &[], false).to_string(),
        )
        .map_err(|e| e.to_string())?;
    if runtime.semantic_hash().map_err(|e| e.to_string())? != accepted_sketch {
        return Err("missing-reference setup preview mutated the accepted document".into());
    }
    let committed: Value = serde_json::from_str(
        &runtime
            .commit_sketch_extrude_json(
                &request(id, &sketch, &support, 4_000_000, &[], true).to_string(),
            )
            .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    if committed["accepted"].as_bool() != Some(true) {
        return Err(format!(
            "missing-reference setup commit refused: {committed}"
        ));
    }
    let before = runtime.semantic_hash().map_err(|e| e.to_string())?;
    let active =
        serde_json::from_str::<Value>(&runtime.active_body_json(0.01).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let body = body_hash(&active)?;
    let valid_document = runtime.document_json().map_err(|e| e.to_string())?;
    let mut invalid: Value = serde_json::from_str(&valid_document).map_err(|e| e.to_string())?;
    let missing = binding.descriptor["input"]["payload"]["profile_region"]
        .as_str()
        .ok_or("missing-reference fixture has no profile_region")?;
    invalid["feature_definitions_v2"][format!("feature:{id}")]["operation"]["profile"]["region"] =
        json!(missing);
    let runtime_error = PartRuntime::from_document_json(&invalid.to_string())
        .err()
        .ok_or("invalid V2 region reference unexpectedly loaded")?
        .to_string();
    // Repair is exercised by reopening the unmodified canonical document.
    PartRuntime::from_document_json(&valid_document).map_err(|e| e.to_string())?;
    let after = runtime.semantic_hash().map_err(|e| e.to_string())?;
    if before != after {
        return Err("missing-reference validation mutated the accepted document".into());
    }
    Ok(Observation {
        result: structured_error_from_runtime(&runtime_error, &sketch, &[missing], binding)?,
        oracle_assertions: json!({}),
        before: before.clone(),
        after,
        body_hashes_before: vec![body.clone()],
        body_hashes_after: vec![body],
        executed_lifecycle_steps: ["preview", "commit", "repair"]
            .into_iter()
            .map(str::to_owned)
            .collect(),
    })
}

fn structured_error_from_runtime(
    runtime_error: &str,
    sketch: &Value,
    selected: &[&str],
    binding: &FixtureBinding,
) -> Result<Value, String> {
    let lower = runtime_error.to_ascii_lowercase();
    let geometry = sketch["geometry"]
        .as_object()
        .ok_or("negative sketch has no geometry map")?;

    if binding.descriptor["input"]["kind"].as_str() == Some("definition_v2")
        && (lower.contains("missing") || lower.contains("region"))
    {
        let region = binding.descriptor["input"]["payload"]["profile_region"]
            .as_str()
            .ok_or("definition V2 input has no profile_region")?;
        return Ok(json!({
            "kind":"structured_error","category":"reference","code":"missing_reference",
            "field_path":"feature.operation.profile.region","referenced_entity_ids":[region]
        }));
    }

    if lower.contains("selected profile is stale") {
        let input_kind = binding.descriptor["input"]["kind"]
            .as_str()
            .unwrap_or_default();
        let payload = &binding.descriptor["input"]["payload"];
        if input_kind == "region_edit" {
            return Ok(json!({
                "kind":"structured_error","category":"repair","code":"region_topology_changed",
                "field_path":"feature.operation.profile.region",
                "referenced_entity_ids":[payload["original_region"].as_str().ok_or("region edit lacks original_region")?]
            }));
        }
        let references = selected.iter().map(|id| id.to_string()).collect::<Vec<_>>();
        if references.is_empty() {
            return Err(format!(
                "runtime reported a stale selection without an input reference: {runtime_error}"
            ));
        }
        let repair = references
            .iter()
            .any(|id| id.contains("missing-after-split"));
        return Ok(json!({
            "kind":"structured_error",
            "category":if repair { "repair" } else { "reference" },
            "code":if repair { "region_topology_changed" } else { "missing_reference" },
            "field_path":"profile_geometry_ids[0]",
            "referenced_entity_ids":references
        }));
    }

    if lower.contains("open or branched") {
        let rectangles = geometry
            .iter()
            .filter_map(|(id, entry)| {
                let curve = &entry["geometry"];
                (curve["kind"].as_str() == Some("rectangle")).then_some((id, curve))
            })
            .collect::<Vec<_>>();
        for left in 0..rectangles.len() {
            for right in left + 1..rectangles.len() {
                let (_, a) = rectangles[left];
                let (_, b) = rectangles[right];
                let overlaps = a["min"]["x_nm"].as_i64().unwrap_or_default()
                    < b["max"]["x_nm"].as_i64().unwrap_or_default()
                    && b["min"]["x_nm"].as_i64().unwrap_or_default()
                        < a["max"]["x_nm"].as_i64().unwrap_or_default()
                    && a["min"]["y_nm"].as_i64().unwrap_or_default()
                        < b["max"]["y_nm"].as_i64().unwrap_or_default()
                    && b["min"]["y_nm"].as_i64().unwrap_or_default()
                        < a["max"]["y_nm"].as_i64().unwrap_or_default();
                if overlaps {
                    return Ok(json!({
                        "kind":"structured_error","category":"profile","code":"overlapping_curves",
                        "field_path":"sketch.geometry",
                        "referenced_entity_ids":[rectangles[left].0, rectangles[right].0]
                    }));
                }
            }
        }
        let unsupported = geometry
            .iter()
            .filter_map(|(id, entry)| {
                let kind = entry["geometry"]["kind"].as_str()?;
                (!matches!(kind, "line" | "arc" | "circle" | "rectangle")).then(|| id.clone())
            })
            .collect::<Vec<_>>();
        if !unsupported.is_empty() {
            return Ok(json!({
                "kind":"structured_error",
                "category":"capability",
                "code":"unsupported_curve_kind",
                "field_path":format!("sketch.geometry[{}].geometry.kind", unsupported[0]),
                "referenced_entity_ids":unsupported
            }));
        }
        let mut endpoint_owners = std::collections::BTreeMap::<String, Vec<String>>::new();
        for (id, entry) in geometry {
            let curve = &entry["geometry"];
            for endpoint in [curve.get("start"), curve.get("end")].into_iter().flatten() {
                endpoint_owners
                    .entry(endpoint.to_string())
                    .or_default()
                    .push(id.clone());
            }
        }
        let references = endpoint_owners
            .values()
            .filter(|owners| owners.len() == 1)
            .flatten()
            .cloned()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        return Ok(json!({
            "kind":"structured_error",
            "category":"profile",
            "code":"open_loop",
            "field_path":"sketch.geometry",
            "referenced_entity_ids":references
        }));
    }

    if lower.contains("overlap") || lower.contains("intersect") {
        return Ok(json!({
            "kind":"structured_error",
            "category":"profile",
            "code":"overlapping_curves",
            "field_path":"sketch.geometry",
            "referenced_entity_ids":geometry.keys().cloned().collect::<Vec<_>>()
        }));
    }

    Err(format!(
        "unclassified runtime error (evidence refused): {runtime_error}"
    ))
}

fn accept_sketch(
    runtime: &mut PartRuntime,
    id: &str,
    sketch: &Value,
    support: &Value,
) -> Result<(), String> {
    let solved: Value = serde_json::from_str(&runtime.solve_sketch_json(&json!({"transaction_id":format!("transaction:{id}:sketch"),"sketch":sketch,"support":support}).to_string()).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    if solved["accepted"].as_bool() != Some(true) {
        return Err(format!("sketch solve refused: {solved}"));
    }
    Ok(())
}

fn request(
    id: &str,
    sketch: &Value,
    support: &Value,
    distance: i64,
    selected: &[&str],
    commit: bool,
) -> Value {
    let mut value = json!({"sketch":sketch,"support":support,"profile_geometry_ids":selected,"distance_nanometers":distance,"feature_id":format!("feature:{id}"),"body_id":format!("body:{id}"),"tolerance":0.01});
    if commit {
        value["transaction_id"] = json!(format!("transaction:{id}:extrude:{distance}"));
    }
    value
}

fn request_for_binding(
    id: &str,
    sketch: &Value,
    support: &Value,
    distance: i64,
    selected: &[&str],
    commit: bool,
    binding: &FixtureBinding,
) -> Result<Value, String> {
    let mut value = request(id, sketch, support, distance, selected, commit);
    if let Some(direction) = binding.descriptor["input"]["payload"]["direction"].as_str() {
        if !matches!(direction, "positive" | "negative" | "symmetric") {
            return Err(format!(
                "unsupported descriptor Extrude direction {direction}"
            ));
        }
        value["direction"] = json!(direction);
    }
    Ok(value)
}

fn body_hash(active: &Value) -> Result<String, String> {
    let bytes = active["body"]["solid_json"]
        .as_array()
        .ok_or("active body has no solid_json")?
        .iter()
        .map(|v| {
            v.as_u64()
                .map(|n| n as u8)
                .ok_or("solid_json contains non-byte")
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(sha256_hex(&bytes))
}

struct TopologyObservation {
    manifold: bool,
    surface_classes: Vec<String>,
    stable_ids: Vec<String>,
}

fn inspect_serialized_topology(
    active: &Value,
    recognize_cylinders: bool,
) -> Result<TopologyObservation, String> {
    let bytes = active["body"]["solid_json"]
        .as_array()
        .ok_or("active body has no solid_json")?
        .iter()
        .map(|value| {
            value
                .as_u64()
                .map(|byte| byte as u8)
                .ok_or("solid_json contains non-byte")
        })
        .collect::<Result<Vec<_>, _>>()?;
    let solid: Value = serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
    let boundaries = solid["boundaries"]
        .as_array()
        .ok_or("serialized solid has no boundaries")?;
    let body_id = active["body"]["body_id"]
        .as_str()
        .ok_or("active body id absent")?;
    let mut manifold = !boundaries.is_empty();
    let mut classes = BTreeSet::new();
    let mut stable_ids = BTreeSet::new();

    for (boundary_index, boundary) in boundaries.iter().enumerate() {
        let vertices = boundary["vertices"]
            .as_array()
            .ok_or("boundary vertices absent")?;
        let edges = boundary["edges"]
            .as_array()
            .ok_or("boundary edges absent")?;
        let faces = boundary["faces"]
            .as_array()
            .ok_or("boundary faces absent")?;
        let mut edge_uses = vec![0usize; edges.len()];
        for face in faces {
            let surface = face["surface"].as_object().ok_or("face surface absent")?;
            for (name, definition) in surface {
                if recognize_cylinders
                    && name == "NurbsSurface"
                    && rational_surface_is_cylindrical(definition)?
                {
                    classes.insert("cylinder".to_owned());
                } else {
                    classes.insert(snake_case(name));
                }
            }
            let loops = face["boundaries"]
                .as_array()
                .ok_or("face boundaries absent")?;
            manifold &= !loops.is_empty();
            for loop_edges in loops {
                for edge_ref in loop_edges.as_array().ok_or("face loop is not an array")? {
                    let index =
                        edge_ref["index"].as_u64().ok_or("face edge index absent")? as usize;
                    if let Some(uses) = edge_uses.get_mut(index) {
                        *uses += 1;
                    } else {
                        manifold = false;
                    }
                }
            }
        }
        manifold &= edge_uses.iter().all(|uses| *uses == 2);
        for (kind, count) in [
            ("vertex", vertices.len()),
            ("edge", edges.len()),
            ("face", faces.len()),
        ] {
            let field = format!("{kind}_stable_ids");
            let ids = boundary[&field]
                .as_array()
                .ok_or_else(|| format!("{field} absent"))?;
            manifold &= ids.len() == count;
            for id in ids {
                let value = id
                    .as_u64()
                    .ok_or_else(|| format!("{field} contains non-integer"))?;
                manifold &= value != 0;
                stable_ids.insert(format!(
                    "{body_id}:boundary:{boundary_index}:{kind}:{value}"
                ));
            }
        }
    }
    Ok(TopologyObservation {
        manifold,
        surface_classes: classes.into_iter().collect(),
        stable_ids: stable_ids.into_iter().collect(),
    })
}

/// Recognizes an exact cylindrical tensor-product NURBS from its serialized
/// homogeneous control net rather than from the fixture/profile label. The
/// ruled-axis invariant is checked for every control-point pair. Each degree-2
/// rational curve span is then checked at five distinct parameters; the
/// resulting degree-4 circle equation is therefore fully constrained on every
/// span (within serialization tolerance), not inferred from render triangles.
fn rational_surface_is_cylindrical(surface: &Value) -> Result<bool, String> {
    let rows = surface["control_points"]
        .as_array()
        .ok_or("NURBS surface control points absent")?;
    let knot_vecs = surface["knot_vecs"]
        .as_array()
        .ok_or("NURBS surface knot vectors absent")?;
    if rows.len() < 3 || knot_vecs.len() != 2 {
        return Ok(false);
    }
    let u_knots = knot_vecs[0]
        .as_array()
        .ok_or("NURBS u knot vector absent")?
        .iter()
        .map(|value| value.as_f64().ok_or("invalid NURBS u knot"))
        .collect::<Result<Vec<_>, _>>()?;
    let v_knots = knot_vecs[1]
        .as_array()
        .ok_or("NURBS v knot vector absent")?
        .iter()
        .map(|value| value.as_f64().ok_or("invalid NURBS v knot"))
        .collect::<Result<Vec<_>, _>>()?;
    let degree = u_knots
        .len()
        .checked_sub(rows.len() + 1)
        .unwrap_or(usize::MAX);
    if degree != 2 || v_knots != [0.0, 0.0, 1.0, 1.0] {
        return Ok(false);
    }
    let homogeneous = rows
        .iter()
        .map(|row| {
            let pair = row
                .as_array()
                .filter(|pair| pair.len() == 2)
                .ok_or("NURBS cylinder control row must contain two points")?;
            pair.iter()
                .map(|point| {
                    Ok([
                        point["x"].as_f64().ok_or("NURBS control x absent")?,
                        point["y"].as_f64().ok_or("NURBS control y absent")?,
                        point["z"].as_f64().ok_or("NURBS control z absent")?,
                        point["w"].as_f64().ok_or("NURBS control w absent")?,
                    ])
                })
                .collect::<Result<Vec<_>, String>>()
        })
        .collect::<Result<Vec<_>, _>>()?;
    if homogeneous
        .iter()
        .flatten()
        .any(|point| point[3].abs() <= f64::EPSILON || !point.iter().all(|value| value.is_finite()))
    {
        return Ok(false);
    }
    let euclidean = |point: [f64; 4]| {
        [
            point[0] / point[3],
            point[1] / point[3],
            point[2] / point[3],
        ]
    };
    let first = euclidean(homogeneous[0][0]);
    let second = euclidean(homogeneous[0][1]);
    let axis = sub3(second, first);
    let scale = axis.iter().map(|value| value.abs()).fold(1.0_f64, f64::max);
    if dot3(axis, axis) <= 1.0e-20 {
        return Ok(false);
    }
    for row in &homogeneous {
        if !approximately(row[0][3], row[1][3], scale)
            || !vec_approximately(sub3(euclidean(row[1]), euclidean(row[0])), axis, scale)
        {
            return Ok(false);
        }
    }

    let domain_start = u_knots[degree];
    let domain_end = u_knots[rows.len()];
    let base = homogeneous.iter().map(|row| row[0]).collect::<Vec<_>>();
    let evaluate = |parameter| rational_curve_point(&base, &u_knots, degree, parameter);
    let p0 = evaluate(domain_start)?;
    let p1 = evaluate((domain_start + domain_end) * 0.5)?;
    let p2 = evaluate(domain_end)?;
    let a = sub3(p1, p0);
    let b = sub3(p2, p0);
    let normal = cross3(a, b);
    let normal_squared = dot3(normal, normal);
    if normal_squared <= 1.0e-20 {
        return Ok(false);
    }
    let center_offset = scale3(
        add3(
            scale3(cross3(b, normal), dot3(a, a)),
            scale3(cross3(normal, a), dot3(b, b)),
        ),
        1.0 / (2.0 * normal_squared),
    );
    let center = add3(p0, center_offset);
    let radius_squared = dot3(sub3(p0, center), sub3(p0, center));
    let circle_scale = radius_squared.sqrt().max(scale);
    if radius_squared <= 1.0e-20 || dot3(normal, axis).abs() <= 1.0e-10 {
        return Ok(false);
    }
    let axis_length = dot3(axis, axis).sqrt();
    let unique_knots = u_knots
        .iter()
        .copied()
        .filter(|value| *value >= domain_start && *value <= domain_end)
        .fold(Vec::<f64>::new(), |mut values, value| {
            if values.last().is_none_or(|last| *last != value) {
                values.push(value);
            }
            values
        });
    for span in unique_knots.windows(2).filter(|span| span[0] < span[1]) {
        for numerator in 0..5 {
            let parameter = span[0] + (span[1] - span[0]) * (numerator as f64 + 0.5) / 5.0;
            let point = evaluate(parameter)?;
            let radial = sub3(point, center);
            if !approximately(
                dot3(radial, radial),
                radius_squared,
                circle_scale * circle_scale,
            ) || dot3(sub3(point, p0), axis).abs() > 1.0e-8 * circle_scale * axis_length
            {
                return Ok(false);
            }
        }
    }
    Ok(true)
}

fn rational_curve_point(
    control: &[[f64; 4]],
    knots: &[f64],
    degree: usize,
    parameter: f64,
) -> Result<[f64; 3], String> {
    fn basis(index: usize, degree: usize, knots: &[f64], parameter: f64, last: bool) -> f64 {
        if degree == 0 {
            return if (knots[index] <= parameter && parameter < knots[index + 1])
                || (last && parameter == knots[index + 1])
            {
                1.0
            } else {
                0.0
            };
        }
        let left_denominator = knots[index + degree] - knots[index];
        let right_denominator = knots[index + degree + 1] - knots[index + 1];
        let left = if left_denominator == 0.0 {
            0.0
        } else {
            (parameter - knots[index]) / left_denominator
                * basis(index, degree - 1, knots, parameter, last)
        };
        let right = if right_denominator == 0.0 {
            0.0
        } else {
            (knots[index + degree + 1] - parameter) / right_denominator
                * basis(index + 1, degree - 1, knots, parameter, last)
        };
        left + right
    }
    let last = parameter == knots[control.len()];
    let mut sum = [0.0; 4];
    for (index, point) in control.iter().enumerate() {
        let coefficient = basis(index, degree, knots, parameter, last);
        for axis in 0..4 {
            sum[axis] += coefficient * point[axis];
        }
    }
    if sum[3].abs() <= f64::EPSILON {
        return Err("NURBS evaluation has zero homogeneous weight".into());
    }
    Ok([sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3]])
}

fn approximately(left: f64, right: f64, scale: f64) -> bool {
    (left - right).abs() <= 1.0e-8 * scale.max(1.0)
}

fn vec_approximately(left: [f64; 3], right: [f64; 3], scale: f64) -> bool {
    (0..3).all(|axis| approximately(left[axis], right[axis], scale))
}

fn add3(left: [f64; 3], right: [f64; 3]) -> [f64; 3] {
    [left[0] + right[0], left[1] + right[1], left[2] + right[2]]
}

fn sub3(left: [f64; 3], right: [f64; 3]) -> [f64; 3] {
    [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
}

fn scale3(value: [f64; 3], scale: f64) -> [f64; 3] {
    [value[0] * scale, value[1] * scale, value[2] * scale]
}

fn dot3(left: [f64; 3], right: [f64; 3]) -> f64 {
    left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

fn cross3(left: [f64; 3], right: [f64; 3]) -> [f64; 3] {
    [
        left[1] * right[2] - left[2] * right[1],
        left[2] * right[0] - left[0] * right[2],
        left[0] * right[1] - left[1] * right[0],
    ]
}

fn snake_case(name: &str) -> String {
    let mut output = String::new();
    for (index, character) in name.chars().enumerate() {
        if character.is_ascii_uppercase() {
            if index > 0 {
                output.push('_');
            }
            output.push(character.to_ascii_lowercase());
        } else {
            output.push(character);
        }
    }
    output
}

fn apply_identity_comparison(result: &mut Value, before: &[String]) -> Result<(), String> {
    let after = result["stable_identity_sets"]["replaced"]
        .as_array()
        .ok_or("derived stable identity list absent")?
        .iter()
        .map(|value| {
            value
                .as_str()
                .map(str::to_owned)
                .ok_or("stable identity is not a string")
        })
        .collect::<Result<BTreeSet<_>, _>>()?;
    let before = before.iter().cloned().collect::<BTreeSet<_>>();
    result["stable_identity_sets"]["retained"] =
        json!(before.intersection(&after).cloned().collect::<Vec<_>>());
    result["stable_identity_sets"]["replaced"] =
        json!(before.difference(&after).cloned().collect::<Vec<_>>());
    Ok(())
}

fn success_result(active: &Value, recognize_cylinders: bool) -> Result<Value, String> {
    let evidence = &active["body"]["evidence"];
    let bounds = &evidence["bounds_nm"];
    let aabb = bounds["min"]
        .as_array()
        .ok_or("missing bounds min")?
        .iter()
        .chain(bounds["max"].as_array().ok_or("missing bounds max")?)
        .map(|v| v.as_i64().map(|v| v as f64).ok_or("invalid bound"))
        .collect::<Result<Vec<_>, _>>()?;
    let packet = &active["render"]["packet"];
    let sampled = mesh_metrics(packet)?;
    let surface = evidence["surface_area_nm2"].as_f64().unwrap_or(sampled.0);
    let centroid = evidence["centroid_nm"]
        .as_array()
        .and_then(|values| {
            values
                .iter()
                .map(serde_json::Value::as_f64)
                .collect::<Option<Vec<_>>>()
        })
        .filter(|values| values.len() == 3)
        .unwrap_or(sampled.1);
    let volume = evidence["volume_model_units3"]
        .as_f64()
        .ok_or("missing kernel volume")?
        * 1e18;
    let topology = inspect_serialized_topology(active, recognize_cylinders)?;
    Ok(json!({
        "kind":"success",
        "body_count":usize::from(!active["body"].is_null()),
        "manifold":topology.manifold,
        "orientation":if sampled.2 > 0.0 { "outward" } else { "inward" },
        "aabb_nm":aabb,
        "signed_volume_nm3":volume,
        "surface_area_nm2":surface,
        "centroid_nm":centroid,
        "analytic_classification":topology.surface_classes,
        "stable_identity_sets":{"retained":[],"replaced":topology.stable_ids},
        "canonical_document_hash":active["body"]["evidence"]["deterministic_digest"].as_str().map(|s| sha256_hex(s.as_bytes())).unwrap_or_else(|| sha256_hex(b"missing-digest"))
    }))
}

fn mesh_metrics(packet: &Value) -> Result<(f64, Vec<f64>, f64), String> {
    let positions = packet["positions"]
        .as_array()
        .ok_or("render packet positions absent")?
        .iter()
        .map(|v| v.as_f64().ok_or("invalid position"))
        .collect::<Result<Vec<_>, _>>()?;
    let indices = packet["triangleIndices"]
        .as_array()
        .ok_or("render packet indices absent")?
        .iter()
        .map(|v| v.as_u64().map(|v| v as usize).ok_or("invalid index"))
        .collect::<Result<Vec<_>, _>>()?;
    let mut area = 0.0;
    let mut signed_volume = 0.0;
    let mut moment = [0.0; 3];
    for tri in indices.chunks_exact(3) {
        let p = |i: usize| [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
        let a = p(tri[0]);
        let b = p(tri[1]);
        let c = p(tri[2]);
        let ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        let ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        let cross = [
            ab[1] * ac[2] - ab[2] * ac[1],
            ab[2] * ac[0] - ab[0] * ac[2],
            ab[0] * ac[1] - ab[1] * ac[0],
        ];
        area += 0.5 * (cross[0] * cross[0] + cross[1] * cross[1] + cross[2] * cross[2]).sqrt();
        let v = (a[0] * (b[1] * c[2] - b[2] * c[1])
            + a[1] * (b[2] * c[0] - b[0] * c[2])
            + a[2] * (b[0] * c[1] - b[1] * c[0]))
            / 6.0;
        signed_volume += v;
        for axis in 0..3 {
            moment[axis] += v * (a[axis] + b[axis] + c[axis]) / 4.0;
        }
    }
    let denom = if signed_volume.abs() > f64::EPSILON {
        signed_volume
    } else {
        1.0
    };
    Ok((
        area * 1e12,
        moment.into_iter().map(|v| v / denom * 1e6).collect(),
        signed_volume,
    ))
}

fn combine_success(values: Vec<(String, String, String, Value)>) -> Result<Observation, String> {
    let mut aabb = [
        f64::INFINITY,
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    let mut volume = 0.0;
    let mut surface = 0.0;
    let mut moment = [0.0; 3];
    let mut manifold = true;
    let mut outward = true;
    let mut classes = BTreeSet::new();
    let mut replaced = BTreeSet::new();
    for (_, _, _, result) in &values {
        let b = result["aabb_nm"]
            .as_array()
            .ok_or("combined bounds absent")?;
        for i in 0..3 {
            aabb[i] = aabb[i].min(b[i].as_f64().unwrap());
            aabb[i + 3] = aabb[i + 3].max(b[i + 3].as_f64().unwrap());
        }
        let v = result["signed_volume_nm3"].as_f64().unwrap();
        volume += v;
        surface += result["surface_area_nm2"].as_f64().unwrap();
        manifold &= result["manifold"].as_bool() == Some(true);
        outward &= result["orientation"].as_str() == Some("outward");
        classes.extend(
            result["analytic_classification"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(str::to_owned),
        );
        replaced.extend(
            result["stable_identity_sets"]["replaced"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(str::to_owned),
        );
        for i in 0..3 {
            moment[i] += v * result["centroid_nm"][i].as_f64().unwrap();
        }
    }
    let digest = |parts: Vec<&String>| {
        sha256_hex(
            parts
                .into_iter()
                .flat_map(|s| s.as_bytes().iter().copied())
                .collect::<Vec<_>>()
                .as_slice(),
        )
    };
    let before = digest(values.iter().map(|v| &v.0).collect());
    let after = digest(values.iter().map(|v| &v.1).collect());
    let body_hashes = values.iter().map(|v| v.2.clone()).collect::<Vec<_>>();
    Ok(Observation {
        result: json!({"kind":"success","body_count":values.len(),"manifold":manifold,"orientation":if outward {"outward"} else {"inward"},"aabb_nm":aabb,"signed_volume_nm3":volume,"surface_area_nm2":surface,"centroid_nm":moment.map(|v|v/volume),"analytic_classification":classes,"stable_identity_sets":{"retained":[],"replaced":replaced},"canonical_document_hash":after}),
        oracle_assertions: json!({}),
        before,
        after,
        body_hashes_before: vec![],
        body_hashes_after: body_hashes,
        executed_lifecycle_steps: vec!["commit".to_owned()],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rational_cylinder_recognizer_checks_serialized_control_net_invariants() {
        let mut surface = json!({
            "control_points": [
                [{"w":1.0,"x":6.5,"y":3.0,"z":0.0},{"w":1.0,"x":6.5,"y":3.0,"z":2.0}],
                [{"w":0.75,"x":4.875,"y":2.625,"z":0.0},{"w":0.75,"x":4.875,"y":2.625,"z":1.5}],
                [{"w":0.5,"x":2.875,"y":2.25,"z":0.0},{"w":0.5,"x":2.875,"y":2.25,"z":1.0}],
                [{"w":0.5,"x":2.125,"y":2.25,"z":0.0},{"w":0.5,"x":2.125,"y":2.25,"z":1.0}],
                [{"w":0.75,"x":2.625,"y":2.625,"z":0.0},{"w":0.75,"x":2.625,"y":2.625,"z":1.5}],
                [{"w":1.0,"x":3.5,"y":3.0,"z":0.0},{"w":1.0,"x":3.5,"y":3.0,"z":2.0}]
            ],
            "knot_vecs": [[0.0,0.0,0.0,0.25,0.5,0.75,1.0,1.0,1.0],[0.0,0.0,1.0,1.0]]
        });
        assert!(rational_surface_is_cylindrical(&surface).unwrap());

        // Same key/type and ruled extrusion, but the base conic no longer has
        // constant radius. A label-only classifier would incorrectly accept it.
        surface["control_points"][2][0]["x"] = json!(2.5);
        surface["control_points"][2][1]["x"] = json!(2.5);
        assert!(!rational_surface_is_cylindrical(&surface).unwrap());
    }

    #[test]
    fn persisted_kernel_id_probe_accepts_only_canonical_decimal_u64_strings() {
        assert_eq!(canonical_u64_decimal(&json!("0")), Some(0));
        assert_eq!(
            canonical_u64_decimal(&json!("18446744073709551615")),
            Some(u64::MAX)
        );
        for invalid in [
            json!(0),
            json!(""),
            json!("00"),
            json!("06"),
            json!("+1"),
            json!("-1"),
            json!(" 1"),
            json!("1 "),
            json!("18446744073709551616"),
        ] {
            assert_eq!(canonical_u64_decimal(&invalid), None, "{invalid}");
        }
    }

    fn descriptor_binding(path: &str) -> FixtureBinding {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join(path);
        let bytes = fs::read(path).unwrap();
        let descriptor: Value = serde_json::from_slice(&bytes).unwrap();
        FixtureBinding {
            descriptor_sha256: sha256_hex(&bytes),
            input_sha256: sha256_hex(&canonical_json_bytes(&descriptor["input"]).unwrap()),
            descriptor,
        }
    }

    fn binding(kind: &str, payload: Value) -> FixtureBinding {
        FixtureBinding {
            descriptor: json!({"input":{"kind":kind,"payload":payload}}),
            descriptor_sha256: String::new(),
            input_sha256: String::new(),
        }
    }

    #[test]
    fn structured_error_uses_observed_request_identity() {
        let sketch =
            json!({"geometry":{"curve:observed":{"geometry":{"kind":"control_point_spline"}}}});
        let result = structured_error_from_runtime(
            "invalid part document: Extrude profile is open or branched",
            &sketch,
            &[],
            &binding("extrude_v2", json!({"profile":"unsupported-spline"})),
        )
        .unwrap();
        assert_eq!(result["code"], "unsupported_curve_kind");
        assert_eq!(result["referenced_entity_ids"], json!(["curve:observed"]));
        assert_eq!(
            result["field_path"],
            "sketch.geometry[curve:observed].geometry.kind"
        );

        let missing = structured_error_from_runtime(
            "invalid part document: feature region reference region:observed-missing is missing",
            &json!({"geometry":{}}),
            &["region:observed-missing"],
            &binding(
                "definition_v2",
                json!({"profile_region":"region:observed-missing"}),
            ),
        )
        .unwrap();
        assert_eq!(missing["code"], "missing_reference");
        assert_eq!(missing["field_path"], "feature.operation.profile.region");
        assert_eq!(
            missing["referenced_entity_ids"],
            json!(["region:observed-missing"])
        );
    }

    #[test]
    fn unrecognized_runtime_error_refuses_evidence() {
        let error = structured_error_from_runtime(
            "different runtime failure",
            &json!({"geometry":{}}),
            &[],
            &binding("region_v2", json!({})),
        )
        .unwrap_err();
        assert!(error.contains("unclassified runtime error (evidence refused)"));
    }

    #[test]
    fn sprint3_fixture_ownership_is_exact_and_unknown_candidates_fail() {
        assert_eq!(
            owned_fixture_ids("solid-feature-sprint-3").unwrap(),
            vec![
                "extrude-offset-plane-direction-matrix",
                "extrude-offset-plane-signed-edit",
                "construction-plane-missing-reference",
                "construction-plane-missing-offset-parameter",
                "construction-plane-wrong-type-offset-parameter",
                "construction-plane-unsafe-offset-parameter",
                "extrude-missing-construction-plane-support",
                "extrude-suppressed-construction-plane-support",
                "extrude-invalid-construction-plane-dependency",
            ]
        );
        assert!(owned_fixture_ids("solid-feature-unknown").is_none());
    }

    #[test]
    fn sprint4_fixture_ownership_is_exact_and_excludes_browser_only_fixture() {
        assert_eq!(
            owned_fixture_ids("solid-feature-sprint-4").unwrap(),
            vec![
                "extrude-planar-face-orientation-matrix",
                "extrude-planar-face-upstream-edit",
                "extrude-planar-face-save-reopen-edit",
                "planar-face-missing-reference",
                "planar-face-stale-current-evidence",
                "planar-face-nonplanar-reference",
                "planar-face-suppressed-producer",
                "planar-face-wrong-body-producer-component",
                "planar-face-broken-support-explicit-repair",
                "planar-face-ambiguous-repair-refused",
            ]
        );
        assert!(
            !owned_fixture_ids("solid-feature-sprint-4")
                .unwrap()
                .contains(&"production-planar-face-lifecycle")
        );
    }

    #[test]
    fn sprint4_missing_stale_and_real_curved_face_diagnostics_are_observed() {
        let missing = descriptor_binding(
            "contracts/solid-feature-candidate/fixtures/planar-face-missing-reference.json",
        );
        let missing_observation =
            execute_planar_face_negative("planar-face-missing-reference", &missing).unwrap();
        assert_eq!(
            missing_observation.result["code"],
            "missing_topology_face_support"
        );
        assert_eq!(missing_observation.result["field_path"], "extrude.support");
        assert_eq!(missing_observation.before, missing_observation.after);

        let stale = descriptor_binding(
            "contracts/solid-feature-candidate/fixtures/planar-face-stale-current-evidence.json",
        );
        let stale_observation =
            execute_planar_face_negative("planar-face-stale-current-evidence", &stale).unwrap();
        assert_eq!(stale_observation.result["code"], "stale_body");
        assert_eq!(stale_observation.result["category"], "stale_reference");
        assert_eq!(stale_observation.before, stale_observation.after);

        let curved = descriptor_binding(
            "contracts/solid-feature-candidate/fixtures/planar-face-nonplanar-reference.json",
        );
        let curved_observation =
            execute_planar_face_negative("planar-face-nonplanar-reference", &curved).unwrap();
        assert_eq!(curved_observation.result["code"], "nonplanar_face");
        assert_eq!(
            curved_observation.result["referenced_entity_ids"],
            json!(["body:revolve"])
        );
        assert_eq!(curved_observation.before, curved_observation.after);
    }

    #[test]
    fn sprint4_all_parity_adapters_are_descriptor_exact_and_repeatable() {
        fn json_numbers_semantically_equal(left: &Value, right: &Value) -> bool {
            match (left, right) {
                (Value::Number(left), Value::Number(right)) => left.as_f64() == right.as_f64(),
                (Value::Array(left), Value::Array(right)) => {
                    left.len() == right.len()
                        && left
                            .iter()
                            .zip(right)
                            .all(|(left, right)| json_numbers_semantically_equal(left, right))
                }
                (Value::Object(left), Value::Object(right)) => {
                    left.len() == right.len()
                        && left.iter().all(|(key, left)| {
                            right
                                .get(key)
                                .is_some_and(|right| json_numbers_semantically_equal(left, right))
                        })
                }
                _ => left == right,
            }
        }

        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let manifest_bytes =
            fs::read(root.join("contracts/solid-feature-candidate/sprint-4.json")).unwrap();
        let manifest: Value = serde_json::from_slice(&manifest_bytes).unwrap();
        let metadata = Metadata {
            candidate_id: manifest["candidate_id"].as_str().unwrap().to_owned(),
            revision: manifest["revision"].as_u64().unwrap(),
            manifest_sha256: sha256_hex(&manifest_bytes),
            recorded_at: "2026-08-28T00:00:00Z".into(),
        };

        let parity_fixtures = manifest["fixtures"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|fixture| fixture["parity_required"] == true)
            .collect::<Vec<_>>();
        assert_eq!(parity_fixtures.len(), 10);

        for fixture in parity_fixtures {
            let id = fixture["id"].as_str().unwrap();
            let descriptor_bytes = fs::read(root.join(fixture["path"].as_str().unwrap())).unwrap();
            let descriptor: Value = serde_json::from_slice(&descriptor_bytes).unwrap();
            let binding = FixtureBinding {
                descriptor_sha256: sha256_hex(&descriptor_bytes),
                input_sha256: sha256_hex(&canonical_json_bytes(&descriptor["input"]).unwrap()),
                descriptor,
            };

            let first = execute_fixture(id, &metadata, &binding);
            assert_eq!(first["status"], "passed", "{id}: {}", first["result"]);
            let second = execute_fixture(id, &metadata, &binding);
            assert_eq!(
                second["status"], "passed",
                "repeat {id}: {}",
                second["result"]
            );
            for field in [
                "result",
                "oracle_assertions",
                "accepted_document_hash_before",
                "accepted_document_hash_after",
                "body_hashes_before",
                "body_hashes_after",
                "executed_lifecycle_steps",
            ] {
                assert_eq!(first[field], second[field], "nondeterministic {id}.{field}");
            }

            let expected_steps = binding.descriptor["lifecycle_steps"]
                .as_array()
                .unwrap()
                .iter()
                .map(|step| step.as_str().unwrap())
                .collect::<BTreeSet<_>>();
            let actual_steps = first["executed_lifecycle_steps"]
                .as_array()
                .unwrap()
                .iter()
                .map(|step| step.as_str().unwrap())
                .collect::<BTreeSet<_>>();
            assert_eq!(
                first["executed_lifecycle_steps"].as_array().unwrap().len(),
                actual_steps.len(),
                "duplicate lifecycle in {id}"
            );
            assert_eq!(actual_steps, expected_steps, "{id} lifecycle");
            if binding.descriptor["expected"]["kind"] == "structured_error" {
                let mut expected = binding.descriptor["expected"]["error"].clone();
                expected["kind"] = json!("structured_error");
                assert_eq!(first["result"], expected, "{id} diagnostic");
                assert_eq!(
                    first["accepted_document_hash_before"], first["accepted_document_hash_after"],
                    "{id} document atomicity"
                );
                assert_eq!(
                    first["body_hashes_before"], first["body_hashes_after"],
                    "{id} body atomicity"
                );
                if !binding.descriptor["expected"]["oracle_assertions"].is_null() {
                    assert!(
                        json_numbers_semantically_equal(
                            &first["oracle_assertions"],
                            &binding.descriptor["expected"]["oracle_assertions"]
                        ),
                        "{id} negative oracle: actual={} expected={}",
                        first["oracle_assertions"],
                        binding.descriptor["expected"]["oracle_assertions"]
                    );
                }
            } else {
                assert!(
                    json_numbers_semantically_equal(
                        &first["oracle_assertions"],
                        &binding.descriptor["expected"]["result"]
                    ),
                    "{id} result oracle: actual={} expected={}",
                    first["oracle_assertions"],
                    binding.descriptor["expected"]["result"]
                );
                assert_eq!(
                    first["result"]["stable_identity_sets"], binding.descriptor["identity_sets"],
                    "{id} identity oracle"
                );
            }
        }
    }

    #[test]
    fn sprint3_success_adapters_observe_exact_descriptor_oracles() {
        let matrix = descriptor_binding(
            "contracts/solid-feature-candidate/fixtures/extrude-offset-plane-direction-matrix.json",
        );
        let matrix_observation =
            execute_offset_plane_matrix("extrude-offset-plane-direction-matrix", &matrix).unwrap();
        assert_eq!(matrix_observation.result["kind"], "success");
        assert_eq!(
            matrix_observation.oracle_assertions,
            matrix.descriptor["expected"]["result"]
        );
        assert_eq!(
            matrix_observation
                .executed_lifecycle_steps
                .iter()
                .cloned()
                .collect::<BTreeSet<_>>(),
            matrix.descriptor["lifecycle_steps"]
                .as_array()
                .unwrap()
                .iter()
                .map(|step| step.as_str().unwrap().to_owned())
                .collect::<BTreeSet<_>>()
        );

        let mut signed = descriptor_binding(
            "contracts/solid-feature-candidate/fixtures/extrude-offset-plane-signed-edit.json",
        );
        signed.descriptor["input"]["payload"]["zero_offset_nanometers"] = json!(0);
        signed.descriptor["expected"]["result"]["zero_offset_frame_origin_nm"] = json!([0, 0, 0]);
        signed.descriptor["expected"]["result"]["zero_offset_bounds_nm"] =
            json!([-5_000_000, -3_000_000, 0, 5_000_000, 3_000_000, 4_000_000]);
        signed.descriptor["expected"]["result"]["zero_offset_stable_plane_id"] =
            json!("construction-plane:extrude-offset-plane-signed-edit");
        signed.descriptor["expected"]["result"]["zero_offset_stable_sketch_id"] =
            json!("sketch:extrude-offset-plane-signed-edit");
        signed.descriptor["expected"]["result"]["zero_offset_stable_feature_id"] =
            json!("feature:extrude-offset-plane-signed-edit");
        signed.descriptor["expected"]["result"]["zero_offset_stable_body_id"] =
            json!("body:extrude-offset-plane-signed-edit");
        let signed_observation =
            execute_offset_plane_signed_edit("extrude-offset-plane-signed-edit", &signed).unwrap();
        let repeated_signed_observation =
            execute_offset_plane_signed_edit("extrude-offset-plane-signed-edit", &signed).unwrap();
        assert_eq!(signed_observation.after, repeated_signed_observation.after);
        assert_eq!(
            signed_observation.body_hashes_after,
            repeated_signed_observation.body_hashes_after
        );
        assert_eq!(signed_observation.result["kind"], "success");
        assert_eq!(
            signed_observation.oracle_assertions,
            signed.descriptor["expected"]["result"]
        );
        assert_eq!(
            signed_observation.oracle_assertions["zero_offset_frame_origin_nm"],
            json!([0, 0, 0])
        );
        assert_eq!(
            signed_observation.oracle_assertions["zero_offset_bounds_nm"],
            json!([-5_000_000, -3_000_000, 0, 5_000_000, 3_000_000, 4_000_000])
        );
        assert_eq!(
            signed_observation.result["stable_identity_sets"]["retained"],
            signed.descriptor["identity_sets"]["retained"]
        );
        assert_eq!(
            signed_observation.result["stable_identity_sets"]["replaced"],
            json!([])
        );
        assert_eq!(
            signed_observation.executed_lifecycle_steps,
            signed.descriptor["lifecycle_steps"]
                .as_array()
                .unwrap()
                .iter()
                .map(|step| step.as_str().unwrap().to_owned())
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn sprint3_negative_adapters_require_real_tokens_and_preserve_state() {
        for (id, path) in [
            (
                "construction-plane-missing-reference",
                "contracts/solid-feature-candidate/fixtures/construction-plane-missing-reference.json",
            ),
            (
                "construction-plane-missing-offset-parameter",
                "contracts/solid-feature-candidate/fixtures/construction-plane-missing-offset-parameter.json",
            ),
        ] {
            let binding = descriptor_binding(path);
            let observation = execute_construction_plane_negative(id, &binding).unwrap();
            let mut expected = binding.descriptor["expected"]["error"].clone();
            expected["kind"] = json!("structured_error");
            assert_eq!(observation.result, expected);
            assert_eq!(observation.before, observation.after);
            assert_eq!(
                observation.body_hashes_before,
                observation.body_hashes_after
            );
            assert_eq!(observation.body_hashes_before.len(), 1);
            assert_eq!(
                observation.executed_lifecycle_steps,
                binding.descriptor["lifecycle_steps"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|step| step.as_str().unwrap().to_owned())
                    .collect::<Vec<_>>()
            );
        }

        assert!(
            construction_plane_structured_error(
                "construction_plane_missing_reference_v3",
                "generic missing reference",
                "origin.missing",
            )
            .unwrap_err()
            .contains("lacks the frozen")
        );
    }

    #[test]
    fn omitted_or_unobserved_lifecycle_steps_fail_closed() {
        let lifecycle_binding = FixtureBinding {
            descriptor: json!({"lifecycle_steps":["preview","commit"]}),
            descriptor_sha256: String::new(),
            input_sha256: String::new(),
        };
        let omitted = validate_executed_lifecycle(&lifecycle_binding, vec!["preview".to_owned()])
            .unwrap_err();
        assert!(omitted.contains("missing=[\"commit\"]"));

        let unexpected = validate_executed_lifecycle(
            &lifecycle_binding,
            vec!["preview".to_owned(), "commit".to_owned(), "save".to_owned()],
        )
        .unwrap_err();
        assert!(unexpected.contains("unexpected=[\"save\"]"));

        let mut fixture = descriptor_binding(
            "contracts/solid-feature-candidate/fixtures/construction-plane-missing-offset-parameter.json",
        );
        fixture.descriptor["lifecycle_steps"]
            .as_array_mut()
            .unwrap()
            .push(json!("unexecuted-step"));
        let error = execute_construction_plane_negative(
            "construction-plane-missing-offset-parameter",
            &fixture,
        )
        .err()
        .expect("unexecuted lifecycle token must refuse evidence");
        assert!(error.contains("missing=[\"unexecuted-step\"]"));
    }

    #[test]
    fn construction_plane_parameter_negatives_are_observed_and_atomic() {
        for (id, kind, value, attempted_offset, code) in [
            (
                "construction-plane-wrong-type-offset-parameter",
                "construction_plane_wrong_type_parameter_v3",
                json!({"kind":"boolean", "value":true}),
                0,
                "wrong_type_construction_plane_offset_parameter",
            ),
            (
                "construction-plane-unsafe-offset-parameter",
                "construction_plane_unsafe_parameter_v3",
                json!({"kind":"length_nanometers", "value":9_007_199_254_740_992_i64}),
                9_007_199_254_740_992_i64,
                "unsafe_construction_plane_offset_parameter",
            ),
        ] {
            let parameter = format!("parameter:{id}");
            let fixture = FixtureBinding {
                descriptor: json!({
                    "input": {"kind":kind, "payload":{
                        "plane": format!("construction-plane:{id}"),
                        "base_plane": "origin.xy",
                        "offset_parameter": parameter,
                        "parameter_value": value,
                        "attempted_offset_nanometers": attempted_offset,
                        "request_offset_nanometers": attempted_offset,
                        "repair_offset_nanometers": 0,
                    }},
                    "expected": {"kind":"structured_error", "error":{
                        "category":"reference",
                        "code":code,
                        "field_path":"construction_plane.offset_parameter",
                        "referenced_entity_ids":[parameter],
                    }},
                    "identity_sets": {
                        "retained":["body:accepted-before-construction-plane-error"],
                        "replaced":[],
                    },
                    "lifecycle_steps":["preview","commit","save","reopen","repair"],
                }),
                descriptor_sha256: String::new(),
                input_sha256: String::new(),
            };
            let observation = execute_construction_plane_parameter_negative(id, &fixture).unwrap();
            assert_eq!(observation.result["code"], code);
            assert_eq!(observation.before, observation.after);
            assert_eq!(
                observation.body_hashes_before,
                observation.body_hashes_after
            );
            assert_eq!(
                observation.executed_lifecycle_steps,
                ["preview", "commit", "save", "reopen", "repair"]
                    .into_iter()
                    .map(str::to_owned)
                    .collect::<Vec<_>>()
            );
        }
    }

    #[test]
    fn construction_plane_support_negatives_emit_stable_repair_evidence() {
        for (id, kind, code, referenced) in [
            (
                "extrude-missing-construction-plane-support",
                "extrude_missing_construction_plane_support_v3",
                "missing_construction_plane_support",
                "construction-plane:missing-support",
            ),
            (
                "extrude-suppressed-construction-plane-support",
                "extrude_suppressed_construction_plane_support_v3",
                "suppressed_construction_plane_support",
                "construction-plane:suppressed-support",
            ),
            (
                "extrude-invalid-construction-plane-dependency",
                "extrude_invalid_construction_plane_dependency_v3",
                "invalid_construction_plane_dependency",
                "origin-plane:missing-dependency",
            ),
        ] {
            let observed_boundary_step =
                if kind == "extrude_invalid_construction_plane_dependency_v3" {
                    "load"
                } else {
                    "preview"
                };
            let plane = if kind == "extrude_missing_construction_plane_support_v3" {
                "construction-plane:missing-support"
            } else if kind == "extrude_suppressed_construction_plane_support_v3" {
                "construction-plane:suppressed-support"
            } else {
                "construction-plane:invalid-dependency"
            };
            let fixture = FixtureBinding {
                descriptor: json!({
                    "input":{"kind":kind,"payload":{
                        "plane":plane,
                        "offset_parameter":format!("parameter:{id}:offset"),
                        "invalid_dependency":"origin-plane:missing-dependency",
                    }},
                    "expected":{"kind":"structured_error","error":{
                        "category":"reference",
                        "code":code,
                        "field_path":"extrude.support",
                        "referenced_entity_ids":[referenced],
                    }},
                    "lifecycle_steps":[observed_boundary_step,"save","reopen","repair"],
                }),
                descriptor_sha256: String::new(),
                input_sha256: String::new(),
            };
            let observation = execute_construction_plane_support_negative(id, &fixture).unwrap();
            assert_eq!(observation.result["code"], code);
            assert_eq!(observation.before, observation.after);
            assert_eq!(
                observation.body_hashes_before,
                observation.body_hashes_after
            );
        }
    }
}
