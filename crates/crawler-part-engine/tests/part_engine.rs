use crawler_document::{
    Document, DocumentChange, DocumentId, FeatureId, OriginPlaneId, ParameterId, SketchConstraint,
    SketchElement, SketchId, SketchSupport,
};
use crawler_part_engine::{
    DISTANCE_PARAMETER_ID, EXTRUDE_FEATURE_ID, EngineError, HEIGHT_PARAMETER_ID, NewPartCommand,
    ParameterEdit, PartDimensions, PartEngine, RECTANGLE_FEATURE_ID, RECTANGLE_SKETCH_ID,
    WIDTH_PARAMETER_ID, XY_PLANE_ID, XZ_PLANE_ID, YZ_PLANE_ID,
};

fn cube_engine() -> PartEngine {
    PartEngine::new_part(NewPartCommand::cube(
        DocumentId::from("document:new-part-cube"),
        "New Part Cube",
        10_000_000,
    ))
    .unwrap()
}

#[test]
fn same_new_part_command_has_same_fixture_and_semantic_hash() {
    let first = cube_engine();
    let second = cube_engine();
    assert_eq!(first.document(), second.document());
    assert_eq!(
        first.semantic_hash().unwrap(),
        second.semantic_hash().unwrap()
    );
    let create = &first.document().transactions[0];
    assert_eq!((create.base_revision, create.result_revision), (0, 1));
    assert!(matches!(
        create.changes.as_slice(),
        [DocumentChange::CreatePart { .. }]
    ));

    let fixture = include_bytes!("../../crawler-document/tests/fixtures/new-part-cube.json");
    assert_eq!(first.canonical_document_bytes().unwrap(), fixture);
    let parsed: Document = serde_json::from_slice(fixture).unwrap();
    assert_eq!(&parsed, first.document());

    let typescript = include_str!("../../crawler-document/tests/fixtures/new-part-cube.fixture.ts");
    let line = typescript.lines().next().unwrap();
    let json = line
        .strip_prefix("export const newPartCubeFixture = ")
        .and_then(|line| line.strip_suffix(" as const;"))
        .unwrap();
    let mirror: Document = serde_json::from_str(json).unwrap();
    assert_eq!(mirror, parsed);
    assert!(typescript.contains(&first.semantic_hash().unwrap()));
}

#[test]
fn new_part_has_addressable_planes_and_exact_rectangle_intent() {
    let engine = cube_engine();
    let document = engine.document();
    assert_eq!(
        document.origin_planes.keys().cloned().collect::<Vec<_>>(),
        vec![
            OriginPlaneId::from(XY_PLANE_ID),
            OriginPlaneId::from(XZ_PLANE_ID),
            OriginPlaneId::from(YZ_PLANE_ID),
        ]
    );
    let sketch = &document.sketches[&SketchId::from(RECTANGLE_SKETCH_ID)];
    assert_eq!(
        sketch.support,
        SketchSupport::OriginPlaneReference {
            plane: OriginPlaneId::from(XY_PLANE_ID)
        }
    );
    assert_eq!(sketch.elements.len(), 8);
    assert_eq!(
        sketch
            .elements
            .iter()
            .filter(|element| matches!(element, SketchElement::Point { .. }))
            .count(),
        4
    );
    assert_eq!(
        sketch
            .elements
            .iter()
            .filter(|element| matches!(element, SketchElement::Line { .. }))
            .count(),
        4
    );
    assert_eq!(sketch.constraints.len(), 7);
    assert!(sketch.constraints.iter().any(|constraint| matches!(
        constraint,
        SketchConstraint::DistanceX { parameter, .. }
            if parameter == &ParameterId::from(WIDTH_PARAMETER_ID)
    )));
    assert!(sketch.constraints.iter().any(|constraint| matches!(
        constraint,
        SketchConstraint::DistanceY { parameter, .. }
            if parameter == &ParameterId::from(HEIGHT_PARAMETER_ID)
    )));

    let extrude = &document.features[&FeatureId::from(EXTRUDE_FEATURE_ID)];
    assert_eq!(
        extrude.dependencies,
        vec![FeatureId::from(RECTANGLE_FEATURE_ID)]
    );
    assert_eq!(
        extrude.parameters.values().cloned().collect::<Vec<_>>(),
        vec![
            ParameterId::from(DISTANCE_PARAMETER_ID),
            ParameterId::from(HEIGHT_PARAMETER_ID),
            ParameterId::from(WIDTH_PARAMETER_ID),
        ]
    );
}

#[test]
fn shared_parameter_edits_produce_cube_dimensions_and_minimum_dirty_roots() {
    let mut engine = cube_engine();
    let outcome = engine
        .commit(vec![
            ParameterEdit::length(WIDTH_PARAMETER_ID, 20_000_000),
            ParameterEdit::length(HEIGHT_PARAMETER_ID, 30_000_000),
        ])
        .unwrap();
    assert_eq!(
        outcome.dimensions,
        PartDimensions {
            width_nanometers: 20_000_000,
            height_nanometers: 30_000_000,
            distance_nanometers: 10_000_000,
        }
    );
    assert_eq!(
        outcome.plan.dirty_roots,
        vec![FeatureId::from(RECTANGLE_FEATURE_ID)]
    );
    assert_eq!(
        outcome.plan.evaluation_order,
        vec![
            FeatureId::from(RECTANGLE_FEATURE_ID),
            FeatureId::from(EXTRUDE_FEATURE_ID),
        ]
    );
    assert_eq!(
        outcome.dimensions.bounds().1,
        [20_000_000, 30_000_000, 10_000_000]
    );

    let distance = engine
        .commit(vec![ParameterEdit::length(
            DISTANCE_PARAMETER_ID,
            40_000_000,
        )])
        .unwrap();
    assert_eq!(
        distance.plan.dirty_roots,
        vec![FeatureId::from(EXTRUDE_FEATURE_ID)]
    );
    assert_eq!(
        distance.plan.evaluation_order,
        vec![FeatureId::from(EXTRUDE_FEATURE_ID)]
    );
    assert_eq!(
        distance.dimensions.bounds().1,
        [20_000_000, 30_000_000, 40_000_000]
    );
}

#[test]
fn failed_atomic_commit_leaves_document_hash_and_history_unchanged() {
    let mut engine = cube_engine();
    let document = engine.document().clone();
    let hash = engine.semantic_hash().unwrap();
    let history = engine.history_depths();
    let error = engine
        .commit(vec![
            ParameterEdit::length(WIDTH_PARAMETER_ID, 25_000_000),
            ParameterEdit::length("parameter:not-present", 9_000_000),
        ])
        .unwrap_err();
    assert!(matches!(error, EngineError::UnknownParameter(_)));
    assert_eq!(engine.document(), &document);
    assert_eq!(engine.semantic_hash().unwrap(), hash);
    assert_eq!(engine.history_depths(), history);

    let error = engine
        .commit(vec![ParameterEdit::length(WIDTH_PARAMETER_ID, i64::MAX)])
        .unwrap_err();
    assert_eq!(error, EngineError::DimensionOverflow);
    assert_eq!(engine.document(), &document);
    assert_eq!(engine.semantic_hash().unwrap(), hash);
    assert_eq!(engine.history_depths(), history);
}

#[test]
fn undo_and_redo_restore_exact_snapshot_hashes_without_inverse_transactions() {
    let mut engine = cube_engine();
    let before_hash = engine.semantic_hash().unwrap();
    let before_transactions = engine.document().transactions.len();
    let committed = engine
        .commit(vec![ParameterEdit::length(
            DISTANCE_PARAMETER_ID,
            22_000_000,
        )])
        .unwrap();
    assert_eq!(engine.history_depths(), (1, 0));
    assert_eq!(
        engine.document().transactions.len(),
        before_transactions + 1
    );

    assert_eq!(engine.undo().unwrap(), before_hash);
    assert_eq!(engine.history_depths(), (0, 1));
    assert_eq!(engine.document().transactions.len(), before_transactions);

    assert_eq!(engine.redo().unwrap(), committed.after_hash);
    assert_eq!(engine.history_depths(), (1, 0));
    assert_eq!(
        engine.document().transactions.len(),
        before_transactions + 1
    );
}
