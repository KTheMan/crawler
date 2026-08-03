use crawler_operation_schema::{
    alpha_operation_catalog, CapabilityState, EnablementState, ErrorCode, InputSelection,
    OperationCatalog, OperationInvocation, OperationSchema, ParameterValue, ParameterValueKind,
    Recoverability, SelectionKind,
};
use std::collections::BTreeMap;

fn schema_json() -> &'static str {
    include_str!("../../../contracts/operation-schema/extrude.v1.json")
}

fn schema() -> OperationSchema {
    serde_json::from_str(schema_json()).expect("Extrude schema should deserialize")
}

fn catalog_json() -> &'static str {
    include_str!("../../../contracts/operation-schema/catalog.v1.json")
}

fn valid_invocation(schema: &OperationSchema) -> OperationInvocation {
    OperationInvocation {
        operation_id: "feature:extrude-1".to_owned(),
        schema_id: schema.id.clone(),
        schema_version: schema.schema_version.get(),
        inputs: BTreeMap::from([(
            "profile".to_owned(),
            vec![InputSelection {
                kind: SelectionKind::SketchProfile,
                entity_id: "sketch:rectangle/profile:outer".to_owned(),
            }],
        )]),
        parameters: schema
            .parameters
            .iter()
            .map(|parameter| (parameter.key.clone(), parameter.default.clone()))
            .collect(),
        preview_generation: 7,
    }
}

#[test]
fn extrude_schema_drives_a_validated_worker_command() {
    let schema = schema();
    let command = schema
        .worker_command(valid_invocation(&schema))
        .expect("valid invocation should produce a worker command");

    assert_eq!(command.schema_id, "crawler.part.extrude");
    assert_eq!(command.parameters.len(), schema.parameters.len());
    assert_eq!(command.preview_generation, 7);
    assert_eq!(command.cancellation, schema.preview.cancellation);
}

#[test]
fn validation_errors_identify_operation_field_recovery_and_action() {
    let schema = schema();
    let mut invocation = valid_invocation(&schema);
    invocation.inputs.clear();
    invocation
        .parameters
        .insert("distance".to_owned(), ParameterValue::LengthNanometers(-1));

    let errors = schema
        .worker_command(invocation)
        .expect_err("invalid invocation must not cross the worker boundary");

    assert!(errors.iter().any(|error| {
        error.code == ErrorCode::MissingInput
            && error.operation.operation_id == "feature:extrude-1"
            && error.recoverability == Recoverability::ReselectInput
            && error.user_actions[0].target == "profile"
    }));
    assert!(errors.iter().any(|error| {
        error.code == ErrorCode::ParameterOutOfBounds
            && error.recoverability == Recoverability::RetryAfterEdit
            && error.user_actions[0].target == "distance"
    }));
}

#[test]
fn unknown_schema_versions_fail_closed() {
    let incompatible = schema_json().replacen("\"schema_version\": 1", "\"schema_version\": 99", 1);
    let error = serde_json::from_str::<OperationSchema>(&incompatible)
        .expect_err("unknown schema version must not deserialize");
    assert!(error
        .to_string()
        .contains("unsupported crawler operation schema version 99"));
}

#[test]
fn schema_serialization_is_deterministic() {
    let first = serde_json::to_string(&schema()).unwrap();
    let second =
        serde_json::to_string(&serde_json::from_str::<OperationSchema>(&first).unwrap()).unwrap();
    assert_eq!(first, second);
}

#[test]
fn alpha_catalog_covers_every_enabled_sketch_and_feature_command() {
    let catalog = alpha_operation_catalog();
    let expected = [
        "crawler.sketch.line",
        "crawler.sketch.circle",
        "crawler.sketch.arc",
        "crawler.sketch.rectangle",
        "crawler.sketch.trim",
        "crawler.sketch.construction",
        "crawler.part.extrude",
        "crawler.part.revolve",
        "crawler.part.boolean.union",
        "crawler.part.boolean.cut",
        "crawler.part.boolean.intersect",
        "crawler.part.fillet",
        "crawler.part.chamfer",
        "crawler.part.mirror",
        "crawler.part.transform",
        "crawler.part.pattern.linear",
        "crawler.part.pattern.circular",
        "crawler.part.shell",
    ];
    assert_eq!(
        catalog
            .operations
            .iter()
            .map(|operation| operation.id.as_str())
            .collect::<Vec<_>>(),
        expected
    );
    assert_eq!(catalog.validate_definition(), []);

    let rectangle = catalog.operation("crawler.sketch.rectangle").unwrap();
    assert!(rectangle.input_slots.is_empty());
    assert_eq!(
        rectangle
            .parameters
            .iter()
            .find(|parameter| parameter.key == "width")
            .unwrap()
            .value_kind,
        ParameterValueKind::LengthNanometers
    );
    let trim = catalog.operation("crawler.sketch.trim").unwrap();
    assert_eq!(
        trim.input_slots[0].allowed_kinds,
        [SelectionKind::SketchCurve]
    );
    let circular = catalog.operation("crawler.part.pattern.circular").unwrap();
    assert!(circular.input_slots[1]
        .allowed_kinds
        .contains(&SelectionKind::Axis));
    assert_eq!(circular.parameters[0].value_kind, ParameterValueKind::Count);
    assert_eq!(
        circular.parameters[1].value_kind,
        ParameterValueKind::AngleMicrodegrees
    );
    let transform = catalog.operation("crawler.part.transform").unwrap();
    assert_eq!(transform.input_slots.len(), 1);
    assert_eq!(transform.input_slots[0].key, "source");
    assert_eq!(
        transform.input_slots[0].allowed_kinds,
        [SelectionKind::Body]
    );
    assert_eq!(transform.parameters.len(), 3);
    assert!(transform
        .parameters
        .iter()
        .all(|parameter| parameter.value_kind == ParameterValueKind::LengthNanometers));
}

#[test]
fn shell_is_enabled_from_the_qualified_prismatic_capability() {
    let catalog = alpha_operation_catalog();
    let capability = catalog
        .capabilities
        .iter()
        .find(|capability| capability.id == "part.shell")
        .unwrap();
    let shell = catalog.operation("crawler.part.shell").unwrap();
    assert_eq!(capability.state, CapabilityState::Qualified);
    assert_eq!(shell.enablement.state, EnablementState::Enabled);
    assert_eq!(shell.enablement.reason, None);
    let faces = shell
        .input_slots
        .iter()
        .find(|slot| slot.key == "remove_faces")
        .unwrap();
    assert_eq!(faces.minimum_count, 1);
    assert_eq!(faces.maximum_count, Some(1));
}

#[test]
fn generated_catalog_is_the_deterministic_rust_catalog_mirror() {
    let from_fixture: OperationCatalog = serde_json::from_str(catalog_json()).unwrap();
    assert_eq!(from_fixture, alpha_operation_catalog());
    let mut generated = serde_json::to_string_pretty(&alpha_operation_catalog()).unwrap();
    generated.push('\n');
    assert_eq!(generated, catalog_json());
    assert_eq!(
        serde_json::to_string(&from_fixture).unwrap(),
        serde_json::to_string(&alpha_operation_catalog()).unwrap()
    );
}

#[test]
fn unknown_catalog_versions_fail_closed() {
    let incompatible =
        catalog_json().replacen("\"catalog_version\": 1", "\"catalog_version\": 9", 1);
    let error = serde_json::from_str::<OperationCatalog>(&incompatible)
        .expect_err("unknown catalog version must not deserialize");
    assert!(error
        .to_string()
        .contains("unsupported crawler operation catalog version 9"));
}

#[test]
fn catalog_validation_rejects_definition_and_invocation_shape_errors() {
    let catalog = alpha_operation_catalog();
    let fillet = catalog.operation("crawler.part.fillet").unwrap();
    let mut invocation = OperationInvocation {
        operation_id: "feature:fillet-1".to_owned(),
        schema_id: fillet.id.clone(),
        schema_version: 1,
        inputs: BTreeMap::from([
            (
                "body".to_owned(),
                vec![InputSelection {
                    kind: SelectionKind::Face,
                    entity_id: "face:wrong-kind".to_owned(),
                }],
            ),
            (
                "edges".to_owned(),
                vec![InputSelection {
                    kind: SelectionKind::Edge,
                    entity_id: "edge:1".to_owned(),
                }],
            ),
            ("unexpected".to_owned(), vec![]),
        ]),
        parameters: fillet
            .parameters
            .iter()
            .map(|parameter| (parameter.key.clone(), parameter.default.clone()))
            .collect(),
        preview_generation: 0,
    };
    invocation
        .parameters
        .insert("unexpected".to_owned(), ParameterValue::Boolean(true));
    let errors = fillet.validate(&invocation);
    assert!(errors
        .iter()
        .any(|error| error.code == ErrorCode::InvalidInputKind));
    assert!(errors
        .iter()
        .any(|error| error.code == ErrorCode::UnknownInput));
    assert!(errors
        .iter()
        .any(|error| error.code == ErrorCode::UnknownParameter));

    let mut malformed = fillet.clone();
    malformed.parameters[0].default = ParameterValue::Boolean(false);
    assert!(malformed
        .validate_definition()
        .iter()
        .any(|error| error.path.ends_with("default")));
}
