use super::*;

const SHELL_CAPABILITY: &str = "part.shell";

/// Capability evidence used to derive command enablement for the alpha catalog.
pub fn alpha_capabilities() -> Vec<CapabilitySchema> {
    [
        "sketch.line",
        "sketch.circle",
        "sketch.arc",
        "sketch.rectangle",
        "sketch.trim",
        "sketch.construction",
        "part.extrude",
        "part.revolve",
        "part.boolean.union",
        "part.boolean.cut",
        "part.boolean.intersect",
        "part.fillet",
        "part.chamfer",
        SHELL_CAPABILITY,
        "part.mirror",
        "part.transform",
        "part.pattern.linear",
        "part.pattern.circular",
    ]
    .into_iter()
    .map(qualified)
    .collect()
}

/// Complete, deterministically ordered operation catalog enabled for alpha.
pub fn alpha_operation_catalog() -> OperationCatalog {
    let capabilities = alpha_capabilities();
    let operations = vec![
        operation(
            &capabilities,
            "crawler.sketch.line",
            "Line",
            OperationGroup::Sketch,
            OutputKind::Sketch,
            "sketch.line",
            vec![],
            vec![
                length("start_x", "Start X", 0, None),
                length("start_y", "Start Y", 0, None),
                length("end_x", "End X", 10_000_000, None),
                length("end_y", "End Y", 0, None),
            ],
        ),
        operation(
            &capabilities,
            "crawler.sketch.circle",
            "Circle",
            OperationGroup::Sketch,
            OutputKind::Sketch,
            "sketch.circle",
            vec![],
            vec![
                length("center_x", "Center X", 0, None),
                length("center_y", "Center Y", 0, None),
                length(
                    "radius",
                    "Radius",
                    5_000_000,
                    Some((1_000, 1_000_000_000_000)),
                ),
            ],
        ),
        operation(
            &capabilities,
            "crawler.sketch.arc",
            "Arc",
            OperationGroup::Sketch,
            OutputKind::Sketch,
            "sketch.arc",
            vec![],
            vec![
                length("center_x", "Center X", 0, None),
                length("center_y", "Center Y", 0, None),
                length(
                    "radius",
                    "Radius",
                    5_000_000,
                    Some((1_000, 1_000_000_000_000)),
                ),
                angle("start_angle", "Start angle", 0, -360_000_000, 360_000_000),
                angle(
                    "end_angle",
                    "End angle",
                    90_000_000,
                    -360_000_000,
                    360_000_000,
                ),
            ],
        ),
        operation(
            &capabilities,
            "crawler.sketch.rectangle",
            "Rectangle",
            OperationGroup::Sketch,
            OutputKind::Sketch,
            "sketch.rectangle",
            vec![],
            vec![
                length(
                    "width",
                    "Width",
                    10_000_000,
                    Some((1_000, 1_000_000_000_000)),
                ),
                length(
                    "height",
                    "Height",
                    10_000_000,
                    Some((1_000, 1_000_000_000_000)),
                ),
                length("center_x", "Center X", 0, None),
                length("center_y", "Center Y", 0, None),
                boolean("centered", "Centered", true),
            ],
        ),
        operation(
            &capabilities,
            "crawler.sketch.trim",
            "Trim",
            OperationGroup::Sketch,
            OutputKind::Sketch,
            "sketch.trim",
            vec![slot(
                "curve",
                "Curve",
                &[SelectionKind::SketchCurve],
                1,
                Some(1),
            )],
            vec![scalar(
                "pick_parameter",
                "Pick position",
                500_000,
                0,
                1_000_000,
            )],
        ),
        operation(
            &capabilities,
            "crawler.sketch.construction",
            "Construction geometry",
            OperationGroup::Sketch,
            OutputKind::Sketch,
            "sketch.construction",
            vec![slot(
                "entities",
                "Sketch entities",
                &[
                    SelectionKind::SketchEntity,
                    SelectionKind::SketchCurve,
                    SelectionKind::SketchPoint,
                ],
                1,
                None,
            )],
            vec![boolean("construction", "Construction", true)],
        ),
        operation(
            &capabilities,
            "crawler.part.extrude",
            "Extrude",
            OperationGroup::PartDesign,
            OutputKind::Body,
            "part.extrude",
            vec![slot(
                "profile",
                "Profile",
                &[SelectionKind::SketchProfile, SelectionKind::Face],
                1,
                Some(1),
            )],
            vec![
                length(
                    "distance",
                    "Distance",
                    10_000_000,
                    Some((1_000, 1_000_000_000_000)),
                ),
                choice("extent", "Extent", "one_sided", &["one_sided", "symmetric"]),
                advanced(angle(
                    "draft_angle",
                    "Draft angle",
                    0,
                    -89_000_000,
                    89_000_000,
                )),
                advanced(boolean("reverse", "Reverse direction", false)),
            ],
        ),
        operation(
            &capabilities,
            "crawler.part.revolve",
            "Revolve",
            OperationGroup::PartDesign,
            OutputKind::Body,
            "part.revolve",
            vec![
                slot(
                    "profile",
                    "Profile",
                    &[SelectionKind::SketchProfile, SelectionKind::Face],
                    1,
                    Some(1),
                ),
                slot(
                    "axis",
                    "Axis",
                    &[SelectionKind::Axis, SelectionKind::Edge],
                    1,
                    Some(1),
                ),
            ],
            vec![
                angle("angle", "Angle", 360_000_000, -360_000_000, 360_000_000),
                choice(
                    "operation",
                    "Operation",
                    "new_body",
                    &["new_body", "union", "cut", "intersect"],
                ),
                boolean("reverse", "Reverse direction", false),
            ],
        ),
        boolean_operation(&capabilities, "union", "Boolean union"),
        boolean_operation(&capabilities, "cut", "Boolean cut"),
        boolean_operation(&capabilities, "intersect", "Boolean intersect"),
        edge_operation(&capabilities, "fillet", "Fillet", "radius", "Radius"),
        edge_operation(&capabilities, "chamfer", "Chamfer", "distance", "Distance"),
        operation(
            &capabilities,
            "crawler.part.mirror",
            "Mirror",
            OperationGroup::Transform,
            OutputKind::Bodies,
            "part.mirror",
            vec![
                slot(
                    "source",
                    "Source",
                    &[SelectionKind::Body, SelectionKind::Feature],
                    1,
                    None,
                ),
                slot(
                    "plane",
                    "Mirror plane",
                    &[SelectionKind::Plane, SelectionKind::Face],
                    1,
                    Some(1),
                ),
            ],
            vec![boolean("merge", "Merge result", false)],
        ),
        operation(
            &capabilities,
            "crawler.part.transform",
            "Transform",
            OperationGroup::Transform,
            OutputKind::Body,
            "part.transform",
            vec![slot(
                "source",
                "Source body",
                &[SelectionKind::Body],
                1,
                Some(1),
            )],
            vec![
                length("x", "X translation", 0, None),
                length("y", "Y translation", 0, None),
                length("z", "Z translation", 10_000_000, None),
            ],
        ),
        operation(
            &capabilities,
            "crawler.part.pattern.linear",
            "Linear pattern",
            OperationGroup::Transform,
            OutputKind::Bodies,
            "part.pattern.linear",
            vec![
                slot(
                    "source",
                    "Source",
                    &[SelectionKind::Body, SelectionKind::Feature],
                    1,
                    None,
                ),
                slot(
                    "direction",
                    "Direction",
                    &[SelectionKind::Axis, SelectionKind::Edge],
                    1,
                    Some(1),
                ),
            ],
            vec![
                count("count", "Count", 2, 2, 10_000),
                length(
                    "spacing",
                    "Spacing",
                    10_000_000,
                    Some((1_000, 1_000_000_000_000)),
                ),
                boolean("symmetric", "Symmetric", false),
            ],
        ),
        operation(
            &capabilities,
            "crawler.part.pattern.circular",
            "Circular pattern",
            OperationGroup::Transform,
            OutputKind::Bodies,
            "part.pattern.circular",
            vec![
                slot(
                    "source",
                    "Source",
                    &[SelectionKind::Body, SelectionKind::Feature],
                    1,
                    None,
                ),
                slot(
                    "axis",
                    "Axis",
                    &[SelectionKind::Axis, SelectionKind::Edge],
                    1,
                    Some(1),
                ),
            ],
            vec![
                count("count", "Count", 4, 2, 10_000),
                angle(
                    "angle",
                    "Total angle",
                    360_000_000,
                    -360_000_000,
                    360_000_000,
                ),
            ],
        ),
        operation(
            &capabilities,
            "crawler.part.shell",
            "Shell",
            OperationGroup::PartDesign,
            OutputKind::Body,
            SHELL_CAPABILITY,
            vec![
                slot("body", "Body", &[SelectionKind::Body], 1, Some(1)),
                slot(
                    "remove_faces",
                    "Faces to remove",
                    &[SelectionKind::Face],
                    1,
                    Some(1),
                ),
            ],
            vec![length(
                "thickness",
                "Wall thickness",
                1_000_000,
                Some((1_000, 1_000_000_000_000)),
            )],
        ),
    ];
    OperationCatalog {
        catalog_version: CatalogVersion::V1,
        capabilities,
        operations,
    }
}

fn qualified(id: &str) -> CapabilitySchema {
    CapabilitySchema {
        id: id.to_owned(),
        state: CapabilityState::Qualified,
        reason: None,
    }
}

#[allow(clippy::too_many_arguments)]
fn operation(
    capabilities: &[CapabilitySchema],
    id: &str,
    label: &str,
    group: OperationGroup,
    output_kind: OutputKind,
    capability_id: &str,
    input_slots: Vec<InputSlotSchema>,
    parameters: Vec<ParameterSchema>,
) -> OperationSchema {
    let capability = capabilities
        .iter()
        .find(|capability| capability.id == capability_id)
        .expect("catalog operation must reference a declared capability");
    OperationSchema {
        schema_version: SchemaVersion::V1,
        id: id.to_owned(),
        label: label.to_owned(),
        group,
        output_kind,
        input_slots,
        parameters,
        preview: PreviewSchema {
            strategy: PreviewStrategy::Debounced,
            debounce_milliseconds: 75,
            cancellation: CancellationBehavior::ReplaceOlderPreview,
        },
        lifecycle: LifecycleSchema::default(),
        enablement: EnablementSchema {
            state: match capability.state {
                CapabilityState::Qualified => EnablementState::Enabled,
                CapabilityState::Unavailable => EnablementState::Disabled,
            },
            capability: capability.id.clone(),
            reason: capability.reason.clone(),
        },
    }
}

fn boolean_operation(
    capabilities: &[CapabilitySchema],
    mode: &str,
    label: &str,
) -> OperationSchema {
    operation(
        capabilities,
        &format!("crawler.part.boolean.{mode}"),
        label,
        OperationGroup::PartDesign,
        OutputKind::Body,
        &format!("part.boolean.{mode}"),
        vec![
            slot("target", "Target body", &[SelectionKind::Body], 1, Some(1)),
            slot("tools", "Tool bodies", &[SelectionKind::Body], 1, None),
        ],
        vec![
            length("tolerance", "Tolerance", 10_000, Some((1, 1_000_000))),
            boolean("keep_tools", "Keep tools visible", false),
        ],
    )
}

fn edge_operation(
    capabilities: &[CapabilitySchema],
    kind: &str,
    label: &str,
    quantity_key: &str,
    quantity_label: &str,
) -> OperationSchema {
    operation(
        capabilities,
        &format!("crawler.part.{kind}"),
        label,
        OperationGroup::PartDesign,
        OutputKind::Body,
        &format!("part.{kind}"),
        vec![
            slot("body", "Body", &[SelectionKind::Body], 1, Some(1)),
            slot("edges", "Edges", &[SelectionKind::Edge], 1, None),
        ],
        vec![length(
            quantity_key,
            quantity_label,
            1_000_000,
            Some((1_000, 1_000_000_000_000)),
        )],
    )
}

fn slot(
    key: &str,
    label: &str,
    allowed_kinds: &[SelectionKind],
    minimum_count: u32,
    maximum_count: Option<u32>,
) -> InputSlotSchema {
    InputSlotSchema {
        key: key.to_owned(),
        label: label.to_owned(),
        allowed_kinds: allowed_kinds.to_vec(),
        minimum_count,
        maximum_count,
    }
}

fn parameter(
    key: &str,
    label: &str,
    value_kind: ParameterValueKind,
    default: ParameterValue,
    bounds: Option<(i64, i64)>,
) -> ParameterSchema {
    ParameterSchema {
        key: key.to_owned(),
        label: label.to_owned(),
        value_kind,
        default,
        bounds: bounds.map(|(minimum, maximum)| ParameterBounds {
            minimum: Some(minimum),
            maximum: Some(maximum),
        }),
        choices: Vec::new(),
        advanced_group: None,
    }
}

fn length(key: &str, label: &str, default: i64, bounds: Option<(i64, i64)>) -> ParameterSchema {
    parameter(
        key,
        label,
        ParameterValueKind::LengthNanometers,
        ParameterValue::LengthNanometers(default),
        bounds,
    )
}

fn angle(key: &str, label: &str, default: i64, minimum: i64, maximum: i64) -> ParameterSchema {
    parameter(
        key,
        label,
        ParameterValueKind::AngleMicrodegrees,
        ParameterValue::AngleMicrodegrees(default),
        Some((minimum, maximum)),
    )
}

fn scalar(key: &str, label: &str, default: i64, minimum: i64, maximum: i64) -> ParameterSchema {
    parameter(
        key,
        label,
        ParameterValueKind::ScalarMillionths,
        ParameterValue::ScalarMillionths(default),
        Some((minimum, maximum)),
    )
}

fn count(key: &str, label: &str, default: u64, minimum: i64, maximum: i64) -> ParameterSchema {
    parameter(
        key,
        label,
        ParameterValueKind::Count,
        ParameterValue::Count(default),
        Some((minimum, maximum)),
    )
}

fn boolean(key: &str, label: &str, default: bool) -> ParameterSchema {
    parameter(
        key,
        label,
        ParameterValueKind::Boolean,
        ParameterValue::Boolean(default),
        None,
    )
}

fn choice(key: &str, label: &str, default: &str, choices: &[&str]) -> ParameterSchema {
    let mut schema = parameter(
        key,
        label,
        ParameterValueKind::Text,
        ParameterValue::Text(default.to_owned()),
        None,
    );
    schema.choices = choices.iter().map(|choice| (*choice).to_owned()).collect();
    schema
}

fn advanced(mut parameter: ParameterSchema) -> ParameterSchema {
    parameter.advanced_group = Some("Advanced".to_owned());
    parameter
}
