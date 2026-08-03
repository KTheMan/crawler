//! Deterministic M1 part-document command and evaluation engine.
//!
//! This crate evaluates only the authoritative declarative document contract.
//! It intentionally contains no kernel, render, persistence, or UI state.

use crawler_document::{
    AngleUnit, Body, BodyId, Component, ComponentId, Document, DocumentChange, DocumentId,
    DocumentTransaction, DocumentUnits, Feature, FeatureId, FeatureInput, FeatureRecomputeState,
    LengthUnit, ModelVisibility, OperationReference, OriginPlane, OriginPlaneDefinition,
    OriginPlaneId, Parameter, ParameterId, ParameterValue, RecomputeState, SchemaVersion, Sketch,
    SketchConstraint, SketchElement, SketchId, SketchSupport, TopologyKind, TopologyReference,
    TopologyReferenceId, TopologySignature, TransactionId,
};
use crawler_history::DocumentHistory;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;
use std::fmt::{self, Display, Formatter};

pub const ROOT_COMPONENT_ID: &str = "component:root";
pub const XY_PLANE_ID: &str = "origin-plane:xy";
pub const XZ_PLANE_ID: &str = "origin-plane:xz";
pub const YZ_PLANE_ID: &str = "origin-plane:yz";
pub const RECTANGLE_SKETCH_ID: &str = "sketch:rectangle";
pub const RECTANGLE_FEATURE_ID: &str = "feature:rectangle-sketch";
pub const EXTRUDE_FEATURE_ID: &str = "feature:extrude";
pub const BODY_ID: &str = "body:part";
pub const WIDTH_PARAMETER_ID: &str = "parameter:width";
pub const HEIGHT_PARAMETER_ID: &str = "parameter:height";
pub const DISTANCE_PARAMETER_ID: &str = "parameter:distance";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NewPartCommand {
    pub document_id: DocumentId,
    pub display_name: String,
    pub width_nanometers: i64,
    pub height_nanometers: i64,
    pub distance_nanometers: i64,
}

impl NewPartCommand {
    pub fn cube(
        document_id: impl Into<DocumentId>,
        display_name: impl Into<String>,
        side: i64,
    ) -> Self {
        Self {
            document_id: document_id.into(),
            display_name: display_name.into(),
            width_nanometers: side,
            height_nanometers: side,
            distance_nanometers: side,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ParameterEdit {
    pub parameter: ParameterId,
    pub value_nanometers: i64,
}

impl ParameterEdit {
    pub fn length(parameter: impl Into<ParameterId>, value_nanometers: i64) -> Self {
        Self {
            parameter: parameter.into(),
            value_nanometers,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PartDimensions {
    pub width_nanometers: i64,
    pub height_nanometers: i64,
    pub distance_nanometers: i64,
}

impl PartDimensions {
    pub const fn bounds(self) -> ([i64; 3], [i64; 3]) {
        (
            [0, 0, 0],
            [
                self.width_nanometers,
                self.height_nanometers,
                self.distance_nanometers,
            ],
        )
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EvaluationPlan {
    pub dirty_roots: Vec<FeatureId>,
    pub evaluation_order: Vec<FeatureId>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommitOutcome {
    pub base_revision: u64,
    pub result_revision: u64,
    pub before_hash: String,
    pub after_hash: String,
    pub plan: EvaluationPlan,
    pub dimensions: PartDimensions,
}

/// Undo and redo are process-local accepted snapshots. They are deliberately
/// not serialized into `Document.transactions` and do not synthesize inverse
/// timeline transactions.
#[derive(Clone, Debug)]
pub struct PartEngine {
    document: Document,
    undo_snapshots: Vec<Document>,
    redo_snapshots: Vec<Document>,
}

impl PartEngine {
    pub fn new_part(command: NewPartCommand) -> Result<Self, EngineError> {
        validate_positive("width", command.width_nanometers)?;
        validate_positive("height", command.height_nanometers)?;
        validate_positive("distance", command.distance_nanometers)?;
        if command.document_id.0.is_empty() {
            return Err(EngineError::InvalidDocument("document id is empty".into()));
        }
        if command.display_name.is_empty() {
            return Err(EngineError::InvalidDocument("display name is empty".into()));
        }

        let dimensions = PartDimensions {
            width_nanometers: command.width_nanometers,
            height_nanometers: command.height_nanometers,
            distance_nanometers: command.distance_nanometers,
        };
        let document = build_new_document(command, dimensions)?;
        evaluate_document(&document)?;
        Ok(Self {
            document,
            undo_snapshots: Vec::new(),
            redo_snapshots: Vec::new(),
        })
    }

    pub fn from_document(document: Document) -> Result<Self, EngineError> {
        evaluate_document(&document)?;
        Ok(Self {
            document,
            undo_snapshots: Vec::new(),
            redo_snapshots: Vec::new(),
        })
    }

    pub const fn document(&self) -> &Document {
        &self.document
    }

    pub fn dimensions(&self) -> Result<PartDimensions, EngineError> {
        dimensions(&self.document)
    }

    pub fn semantic_hash(&self) -> Result<String, EngineError> {
        semantic_hash(&self.document)
    }

    pub fn canonical_document_bytes(&self) -> Result<Vec<u8>, EngineError> {
        canonical_document_bytes(&self.document)
    }

    pub const fn history_depths(&self) -> (usize, usize) {
        (self.undo_snapshots.len(), self.redo_snapshots.len())
    }

    /// Atomically validates and applies a normalized parameter transaction.
    /// The accepted document and snapshot stacks remain byte-for-byte unchanged
    /// if any edit or the resulting evaluation fails.
    pub fn commit(&mut self, edits: Vec<ParameterEdit>) -> Result<CommitOutcome, EngineError> {
        let normalized = normalize_edits(edits)?;
        let before_hash = self.semantic_hash()?;
        let base_revision = self.document.revision;
        let result_revision = base_revision
            .checked_add(1)
            .ok_or(EngineError::RevisionOverflow)?;

        let edited_parameters: BTreeSet<_> = normalized.keys().cloned().collect();
        let plan = evaluation_plan(&self.document, &edited_parameters)?;
        let mut candidate = self.document.clone();
        let mut changes = Vec::new();
        for (parameter, value_nanometers) in &normalized {
            let stored = candidate
                .parameters
                .get_mut(parameter)
                .ok_or_else(|| EngineError::UnknownParameter(parameter.clone()))?;
            match stored.value {
                ParameterValue::LengthNanometers(_) => {
                    stored.value = ParameterValue::LengthNanometers(*value_nanometers);
                }
                _ => return Err(EngineError::NotLengthParameter(parameter.clone())),
            }
            changes.push(DocumentChange::SetParameterValue {
                parameter: parameter.clone(),
                value: ParameterValue::LengthNanometers(*value_nanometers),
            });
        }

        candidate.revision = result_revision;
        update_derived_geometry(&mut candidate)?;
        candidate.transactions.push(DocumentTransaction {
            id: deterministic_transaction_id(result_revision, normalized.keys()),
            base_revision,
            result_revision,
            changes,
        });
        candidate.recompute.accepted_revision = result_revision;
        for feature in &plan.evaluation_order {
            candidate.recompute.features.insert(
                feature.clone(),
                FeatureRecomputeState::Clean {
                    evaluated_revision: result_revision,
                },
            );
        }

        let dimensions = evaluate_document(&candidate)?;
        let after_hash = semantic_hash(&candidate)?;
        self.undo_snapshots.push(self.document.clone());
        self.redo_snapshots.clear();
        self.document = candidate;
        Ok(CommitOutcome {
            base_revision,
            result_revision,
            before_hash,
            after_hash,
            plan,
            dimensions,
        })
    }

    /// Apply any durable document change atomically. Geometry execution for
    /// advanced operations remains owned by the feature kernel; this method
    /// accepts only a document that still satisfies the qualified base-part
    /// contract and preserves both snapshot stacks on failure.
    pub fn commit_changes(
        &mut self,
        transaction_id: TransactionId,
        changes: Vec<DocumentChange>,
    ) -> Result<String, EngineError> {
        let before_hash = self.semantic_hash()?;
        let updates_dimensions = changes.iter().any(|change| {
            matches!(
                change,
                DocumentChange::SetParameterValue { parameter, .. }
                    | DocumentChange::SetParameterExpression { parameter, .. }
                    if matches!(
                        parameter.0.as_str(),
                        WIDTH_PARAMETER_ID | HEIGHT_PARAMETER_ID | DISTANCE_PARAMETER_ID
                    )
            )
        });
        let mut history = DocumentHistory::new(self.document.clone());
        history
            .commit(transaction_id, changes)
            .map_err(|error| EngineError::InvalidDocument(error.to_string()))?;
        let mut candidate = history.accepted().clone();
        if updates_dimensions {
            update_derived_geometry(&mut candidate)?;
        }
        evaluate_document(&candidate)?;
        self.undo_snapshots.push(self.document.clone());
        self.redo_snapshots.clear();
        self.document = candidate;
        serde_json::to_string(&serde_json::json!({
            "before_hash": before_hash,
            "after_hash": self.semantic_hash()?,
            "revision": self.document.revision,
        }))
        .map_err(|error| EngineError::Serialization(error.to_string()))
    }

    pub fn undo(&mut self) -> Result<String, EngineError> {
        let previous = self
            .undo_snapshots
            .pop()
            .ok_or(EngineError::NothingToUndo)?;
        self.redo_snapshots.push(self.document.clone());
        self.document = previous;
        self.semantic_hash()
    }

    pub fn redo(&mut self) -> Result<String, EngineError> {
        let next = self
            .redo_snapshots
            .pop()
            .ok_or(EngineError::NothingToRedo)?;
        self.undo_snapshots.push(self.document.clone());
        self.document = next;
        self.semantic_hash()
    }
}

pub fn canonical_document_bytes(document: &Document) -> Result<Vec<u8>, EngineError> {
    let mut bytes = serde_json::to_vec(document)
        .map_err(|error| EngineError::Serialization(error.to_string()))?;
    bytes.push(b'\n');
    Ok(bytes)
}

pub fn semantic_hash(document: &Document) -> Result<String, EngineError> {
    Ok(format!(
        "{:x}",
        Sha256::digest(canonical_document_bytes(document)?)
    ))
}

pub fn evaluate_document(document: &Document) -> Result<PartDimensions, EngineError> {
    validate_origin_planes(document)?;
    let order = stable_topological_order(document)?;
    let expected = [
        FeatureId::from(RECTANGLE_FEATURE_ID),
        FeatureId::from(EXTRUDE_FEATURE_ID),
    ];
    if order.len() < expected.len() || order[..expected.len()] != expected {
        return Err(EngineError::InvalidFeatureGraph(format!(
            "expected rectangle then extrude before advanced features, got {order:?}"
        )));
    }
    validate_feature_contract(document)?;
    let dimensions = dimensions(document)?;
    validate_rectangle(document, dimensions)?;
    validate_topology(document, dimensions)?;
    Ok(dimensions)
}

fn build_new_document(
    command: NewPartCommand,
    dimensions: PartDimensions,
) -> Result<Document, EngineError> {
    let component_id = ComponentId::from(ROOT_COMPONENT_ID);
    let sketch_id = SketchId::from(RECTANGLE_SKETCH_ID);
    let rectangle_feature_id = FeatureId::from(RECTANGLE_FEATURE_ID);
    let extrude_feature_id = FeatureId::from(EXTRUDE_FEATURE_ID);
    let body_id = BodyId::from(BODY_ID);
    let width_id = ParameterId::from(WIDTH_PARAMETER_ID);
    let height_id = ParameterId::from(HEIGHT_PARAMETER_ID);
    let distance_id = ParameterId::from(DISTANCE_PARAMETER_ID);

    let mut document = Document {
        schema_version: SchemaVersion::V1,
        id: command.document_id,
        display_name: command.display_name.clone(),
        revision: 1,
        units: DocumentUnits {
            display_length: LengthUnit::Millimeter,
            display_angle: AngleUnit::Degree,
        },
        root_component: component_id.clone(),
        origin_planes: origin_planes(&component_id),
        components: BTreeMap::from([(
            component_id.clone(),
            Component {
                id: component_id.clone(),
                display_name: command.display_name,
                parent: None,
                child_components: Vec::new(),
                body_order: vec![body_id.clone()],
                sketch_order: vec![sketch_id.clone()],
                feature_order: vec![rectangle_feature_id.clone(), extrude_feature_id.clone()],
                parameter_order: vec![width_id.clone(), height_id.clone(), distance_id.clone()],
            },
        )]),
        bodies: BTreeMap::from([(
            body_id.clone(),
            Body {
                id: body_id.clone(),
                display_name: "Part Body".into(),
                component: component_id.clone(),
                generated_by: extrude_feature_id.clone(),
                visibility: ModelVisibility::Visible,
            },
        )]),
        sketches: BTreeMap::from([(
            sketch_id.clone(),
            rectangle_sketch(&component_id, dimensions),
        )]),
        features: BTreeMap::from([
            (
                extrude_feature_id.clone(),
                Feature {
                    id: extrude_feature_id.clone(),
                    display_name: "Extrude".into(),
                    component: component_id.clone(),
                    operation: OperationReference {
                        schema_id: "crawler.operation.extrude".into(),
                        schema_version: 1,
                    },
                    dependencies: vec![rectangle_feature_id.clone()],
                    inputs: BTreeMap::from([(
                        "profile".into(),
                        FeatureInput::Sketch(sketch_id.clone()),
                    )]),
                    parameters: BTreeMap::from([
                        ("distance".into(), distance_id.clone()),
                        ("height".into(), height_id.clone()),
                        ("width".into(), width_id.clone()),
                    ]),
                    suppressed: false,
                },
            ),
            (
                rectangle_feature_id.clone(),
                Feature {
                    id: rectangle_feature_id.clone(),
                    display_name: "Constrained Rectangle".into(),
                    component: component_id.clone(),
                    operation: OperationReference {
                        schema_id: "crawler.operation.constrained_rectangle".into(),
                        schema_version: 1,
                    },
                    dependencies: Vec::new(),
                    inputs: BTreeMap::new(),
                    parameters: BTreeMap::from([
                        ("height".into(), height_id.clone()),
                        ("width".into(), width_id.clone()),
                    ]),
                    suppressed: false,
                },
            ),
        ]),
        parameters: BTreeMap::from([
            (
                distance_id.clone(),
                length_parameter(
                    distance_id.clone(),
                    "Distance",
                    dimensions.distance_nanometers,
                ),
            ),
            (
                height_id.clone(),
                length_parameter(height_id.clone(), "Height", dimensions.height_nanometers),
            ),
            (
                width_id.clone(),
                length_parameter(width_id.clone(), "Width", dimensions.width_nanometers),
            ),
        ]),
        topology_references: BTreeMap::new(),
        transactions: vec![DocumentTransaction {
            id: TransactionId::from("transaction:1:create-part"),
            base_revision: 0,
            result_revision: 1,
            changes: vec![DocumentChange::CreatePart {
                component: component_id,
                sketch: sketch_id,
                feature: extrude_feature_id.clone(),
                body: body_id,
            }],
        }],
        recompute: RecomputeState {
            accepted_revision: 1,
            features: BTreeMap::from([
                (
                    extrude_feature_id,
                    FeatureRecomputeState::Clean {
                        evaluated_revision: 1,
                    },
                ),
                (
                    rectangle_feature_id,
                    FeatureRecomputeState::Clean {
                        evaluated_revision: 1,
                    },
                ),
            ]),
        },
    };
    update_derived_geometry(&mut document)?;
    Ok(document)
}

fn origin_planes(component: &ComponentId) -> BTreeMap<OriginPlaneId, OriginPlaneDefinition> {
    [
        (
            XY_PLANE_ID,
            OriginPlane::Xy,
            [0, 0, 1_000_000],
            [1_000_000, 0, 0],
        ),
        (
            XZ_PLANE_ID,
            OriginPlane::Xz,
            [0, -1_000_000, 0],
            [1_000_000, 0, 0],
        ),
        (
            YZ_PLANE_ID,
            OriginPlane::Yz,
            [1_000_000, 0, 0],
            [0, 1_000_000, 0],
        ),
    ]
    .into_iter()
    .map(|(id, plane, normal_millionths, x_axis_millionths)| {
        let id = OriginPlaneId::from(id);
        (
            id.clone(),
            OriginPlaneDefinition {
                id,
                component: component.clone(),
                plane,
                normal_millionths,
                x_axis_millionths,
            },
        )
    })
    .collect()
}

fn rectangle_sketch(component: &ComponentId, dimensions: PartDimensions) -> Sketch {
    Sketch {
        id: SketchId::from(RECTANGLE_SKETCH_ID),
        display_name: "Rectangle".into(),
        component: component.clone(),
        support: SketchSupport::OriginPlaneReference {
            plane: OriginPlaneId::from(XY_PLANE_ID),
        },
        elements: rectangle_elements(dimensions),
        constraints: vec![
            SketchConstraint::PointOnOrigin {
                id: "constraint:origin".into(),
                point: "point:0".into(),
            },
            SketchConstraint::Horizontal {
                id: "constraint:bottom-horizontal".into(),
                line: "line:bottom".into(),
            },
            SketchConstraint::Vertical {
                id: "constraint:right-vertical".into(),
                line: "line:right".into(),
            },
            SketchConstraint::Horizontal {
                id: "constraint:top-horizontal".into(),
                line: "line:top".into(),
            },
            SketchConstraint::Vertical {
                id: "constraint:left-vertical".into(),
                line: "line:left".into(),
            },
            SketchConstraint::DistanceX {
                id: "constraint:width".into(),
                start_point: "point:0".into(),
                end_point: "point:1".into(),
                parameter: ParameterId::from(WIDTH_PARAMETER_ID),
            },
            SketchConstraint::DistanceY {
                id: "constraint:height".into(),
                start_point: "point:0".into(),
                end_point: "point:3".into(),
                parameter: ParameterId::from(HEIGHT_PARAMETER_ID),
            },
        ],
    }
}

fn rectangle_elements(dimensions: PartDimensions) -> Vec<SketchElement> {
    vec![
        SketchElement::Point {
            id: "point:0".into(),
            x_nanometers: 0,
            y_nanometers: 0,
        },
        SketchElement::Point {
            id: "point:1".into(),
            x_nanometers: dimensions.width_nanometers,
            y_nanometers: 0,
        },
        SketchElement::Point {
            id: "point:2".into(),
            x_nanometers: dimensions.width_nanometers,
            y_nanometers: dimensions.height_nanometers,
        },
        SketchElement::Point {
            id: "point:3".into(),
            x_nanometers: 0,
            y_nanometers: dimensions.height_nanometers,
        },
        SketchElement::Line {
            id: "line:bottom".into(),
            start_element: "point:0".into(),
            end_element: "point:1".into(),
        },
        SketchElement::Line {
            id: "line:right".into(),
            start_element: "point:1".into(),
            end_element: "point:2".into(),
        },
        SketchElement::Line {
            id: "line:top".into(),
            start_element: "point:2".into(),
            end_element: "point:3".into(),
        },
        SketchElement::Line {
            id: "line:left".into(),
            start_element: "point:3".into(),
            end_element: "point:0".into(),
        },
    ]
}

fn length_parameter(id: ParameterId, display_name: &str, value: i64) -> Parameter {
    Parameter {
        id,
        display_name: display_name.into(),
        value: ParameterValue::LengthNanometers(value),
    }
}

fn top_face_reference(
    body: &BodyId,
    producer: &FeatureId,
    dimensions: PartDimensions,
) -> Result<TopologyReference, EngineError> {
    Ok(TopologyReference {
        id: TopologyReferenceId::from("topology:extrude-top"),
        body: body.clone(),
        producer: producer.clone(),
        kind: TopologyKind::Face,
        stable_kernel_id: 6,
        stable_token: "extrude:end-positive".into(),
        fallback_signature: TopologySignature::Face {
            centroid_nanometers: [
                dimensions.width_nanometers / 2,
                dimensions.height_nanometers / 2,
                dimensions.distance_nanometers,
            ],
            normal_millionths: [0, 0, 1_000_000],
            area_square_nanometers: area(dimensions)?,
        },
    })
}

fn area(dimensions: PartDimensions) -> Result<u64, EngineError> {
    (dimensions.width_nanometers as u64)
        .checked_mul(dimensions.height_nanometers as u64)
        .ok_or(EngineError::DimensionOverflow)
}

fn normalize_edits(edits: Vec<ParameterEdit>) -> Result<BTreeMap<ParameterId, i64>, EngineError> {
    if edits.is_empty() {
        return Err(EngineError::EmptyTransaction);
    }
    let mut normalized = BTreeMap::new();
    for edit in edits {
        validate_positive("parameter", edit.value_nanometers)?;
        if !matches!(
            edit.parameter.0.as_str(),
            WIDTH_PARAMETER_ID | HEIGHT_PARAMETER_ID | DISTANCE_PARAMETER_ID
        ) {
            return Err(EngineError::UnknownParameter(edit.parameter));
        }
        if normalized
            .insert(edit.parameter.clone(), edit.value_nanometers)
            .is_some()
        {
            return Err(EngineError::DuplicateParameter(edit.parameter));
        }
    }
    Ok(normalized)
}

fn dimensions(document: &Document) -> Result<PartDimensions, EngineError> {
    Ok(PartDimensions {
        width_nanometers: length_value(document, WIDTH_PARAMETER_ID)?,
        height_nanometers: length_value(document, HEIGHT_PARAMETER_ID)?,
        distance_nanometers: length_value(document, DISTANCE_PARAMETER_ID)?,
    })
}

fn length_value(document: &Document, id: &str) -> Result<i64, EngineError> {
    let id = ParameterId::from(id);
    let parameter = document
        .parameters
        .get(&id)
        .ok_or_else(|| EngineError::UnknownParameter(id.clone()))?;
    match parameter.value {
        ParameterValue::LengthNanometers(value) => {
            validate_positive(&parameter.display_name, value)?;
            Ok(value)
        }
        _ => Err(EngineError::NotLengthParameter(id)),
    }
}

fn update_derived_geometry(document: &mut Document) -> Result<(), EngineError> {
    let dimensions = dimensions(document)?;
    let sketch = document
        .sketches
        .get_mut(&SketchId::from(RECTANGLE_SKETCH_ID))
        .ok_or_else(|| EngineError::InvalidDocument("rectangle sketch is missing".into()))?;
    let canonical = rectangle_elements(dimensions);
    let canonical_ids: BTreeSet<_> = canonical.iter().map(sketch_element_id).collect();
    sketch
        .elements
        .retain(|element| !canonical_ids.contains(sketch_element_id(element)));
    sketch.elements.splice(0..0, canonical);
    document.topology_references.insert(
        TopologyReferenceId::from("topology:extrude-top"),
        top_face_reference(
            &BodyId::from(BODY_ID),
            &FeatureId::from(EXTRUDE_FEATURE_ID),
            dimensions,
        )?,
    );
    Ok(())
}

fn validate_origin_planes(document: &Document) -> Result<(), EngineError> {
    let expected = origin_planes(&ComponentId::from(ROOT_COMPONENT_ID));
    if document.origin_planes != expected {
        return Err(EngineError::InvalidDocument(
            "stable XY/XZ/YZ origin plane definitions differ".into(),
        ));
    }
    Ok(())
}

fn validate_feature_contract(document: &Document) -> Result<(), EngineError> {
    let rectangle = document
        .features
        .get(&FeatureId::from(RECTANGLE_FEATURE_ID))
        .ok_or_else(|| EngineError::InvalidDocument("rectangle feature is missing".into()))?;
    let extrude = document
        .features
        .get(&FeatureId::from(EXTRUDE_FEATURE_ID))
        .ok_or_else(|| EngineError::InvalidDocument("extrude feature is missing".into()))?;
    if rectangle.operation.schema_id != "crawler.operation.constrained_rectangle"
        || !rectangle.dependencies.is_empty()
        || rectangle.parameters
            != BTreeMap::from([
                ("height".into(), ParameterId::from(HEIGHT_PARAMETER_ID)),
                ("width".into(), ParameterId::from(WIDTH_PARAMETER_ID)),
            ])
        || extrude.operation.schema_id != "crawler.operation.extrude"
        || extrude.dependencies != vec![FeatureId::from(RECTANGLE_FEATURE_ID)]
        || extrude.parameters
            != BTreeMap::from([
                ("distance".into(), ParameterId::from(DISTANCE_PARAMETER_ID)),
                ("height".into(), ParameterId::from(HEIGHT_PARAMETER_ID)),
                ("width".into(), ParameterId::from(WIDTH_PARAMETER_ID)),
            ])
        || extrude.inputs
            != BTreeMap::from([(
                "profile".into(),
                FeatureInput::Sketch(SketchId::from(RECTANGLE_SKETCH_ID)),
            )])
    {
        return Err(EngineError::InvalidDocument(
            "rectangle/extrude shared-parameter contract differs".into(),
        ));
    }
    Ok(())
}

fn validate_rectangle(document: &Document, dimensions: PartDimensions) -> Result<(), EngineError> {
    let sketch = document
        .sketches
        .get(&SketchId::from(RECTANGLE_SKETCH_ID))
        .ok_or_else(|| EngineError::InvalidDocument("rectangle sketch is missing".into()))?;
    if sketch.support
        != (SketchSupport::OriginPlaneReference {
            plane: OriginPlaneId::from(XY_PLANE_ID),
        })
        || !rectangle_elements(dimensions)
            .iter()
            .all(|expected| sketch.elements.contains(expected))
        || !rectangle_sketch(&ComponentId::from(ROOT_COMPONENT_ID), dimensions)
            .constraints
            .iter()
            .all(|expected| sketch.constraints.contains(expected))
    {
        return Err(EngineError::InvalidRectangleIntent);
    }
    Ok(())
}

fn sketch_element_id(element: &SketchElement) -> &str {
    match element {
        SketchElement::Point { id, .. }
        | SketchElement::Line { id, .. }
        | SketchElement::Circle { id, .. }
        | SketchElement::Arc { id, .. }
        | SketchElement::Rectangle { id, .. }
        | SketchElement::ConstructionLine { id, .. }
        | SketchElement::LineSegment { id, .. } => id,
    }
}

fn validate_topology(document: &Document, dimensions: PartDimensions) -> Result<(), EngineError> {
    let expected = top_face_reference(
        &BodyId::from(BODY_ID),
        &FeatureId::from(EXTRUDE_FEATURE_ID),
        dimensions,
    )?;
    if document
        .topology_references
        .get(&TopologyReferenceId::from("topology:extrude-top"))
        != Some(&expected)
    {
        return Err(EngineError::InvalidDocument(
            "extrude topology evidence differs from evaluated dimensions".into(),
        ));
    }
    Ok(())
}

fn stable_topological_order(document: &Document) -> Result<Vec<FeatureId>, EngineError> {
    let component = document
        .components
        .get(&document.root_component)
        .ok_or_else(|| EngineError::InvalidDocument("root component is missing".into()))?;
    let positions: BTreeMap<_, _> = component
        .feature_order
        .iter()
        .cloned()
        .enumerate()
        .map(|(index, feature)| (feature, index))
        .collect();
    if positions.len() != document.features.len()
        || document
            .features
            .keys()
            .any(|feature| !positions.contains_key(feature))
    {
        return Err(EngineError::InvalidFeatureGraph(
            "feature_order must contain every feature exactly once".into(),
        ));
    }
    let mut indegree: BTreeMap<_, usize> = document
        .features
        .keys()
        .cloned()
        .map(|feature| (feature, 0))
        .collect();
    let mut dependents: BTreeMap<FeatureId, Vec<FeatureId>> = BTreeMap::new();
    for (feature_id, feature) in &document.features {
        let mut unique = BTreeSet::new();
        for dependency in &feature.dependencies {
            if !document.features.contains_key(dependency) || !unique.insert(dependency.clone()) {
                return Err(EngineError::InvalidFeatureGraph(format!(
                    "invalid dependency {dependency:?} for {feature_id:?}"
                )));
            }
            *indegree.get_mut(feature_id).expect("feature exists") += 1;
            dependents
                .entry(dependency.clone())
                .or_default()
                .push(feature_id.clone());
        }
    }
    let mut ready: BTreeSet<(usize, FeatureId)> = indegree
        .iter()
        .filter(|(_, degree)| **degree == 0)
        .map(|(feature, _)| (positions[feature], feature.clone()))
        .collect();
    let mut order = Vec::new();
    while let Some((position, feature)) = ready.pop_first() {
        let _ = position;
        order.push(feature.clone());
        for dependent in dependents.get(&feature).into_iter().flatten() {
            let degree = indegree.get_mut(dependent).expect("dependent exists");
            *degree -= 1;
            if *degree == 0 {
                ready.insert((positions[dependent], dependent.clone()));
            }
        }
    }
    if order.len() != document.features.len() {
        return Err(EngineError::InvalidFeatureGraph(
            "feature dependency cycle".into(),
        ));
    }
    Ok(order)
}

fn evaluation_plan(
    document: &Document,
    edited_parameters: &BTreeSet<ParameterId>,
) -> Result<EvaluationPlan, EngineError> {
    let order = stable_topological_order(document)?;
    let direct: BTreeSet<_> = document
        .features
        .iter()
        .filter(|(_, feature)| {
            feature
                .parameters
                .values()
                .any(|parameter| edited_parameters.contains(parameter))
        })
        .map(|(id, _)| id.clone())
        .collect();
    let dirty_roots: BTreeSet<_> = direct
        .iter()
        .filter(|feature| {
            !direct
                .iter()
                .any(|candidate| candidate != *feature && depends_on(document, feature, candidate))
        })
        .cloned()
        .collect();
    let dirty: BTreeSet<_> = document
        .features
        .keys()
        .filter(|feature| {
            dirty_roots
                .iter()
                .any(|root| *feature == root || depends_on(document, feature, root))
        })
        .cloned()
        .collect();
    Ok(EvaluationPlan {
        dirty_roots: order
            .iter()
            .filter(|feature| dirty_roots.contains(*feature))
            .cloned()
            .collect(),
        evaluation_order: order
            .into_iter()
            .filter(|feature| dirty.contains(feature))
            .collect(),
    })
}

fn depends_on(document: &Document, feature: &FeatureId, ancestor: &FeatureId) -> bool {
    let Some(node) = document.features.get(feature) else {
        return false;
    };
    node.dependencies
        .iter()
        .any(|dependency| dependency == ancestor || depends_on(document, dependency, ancestor))
}

fn deterministic_transaction_id<'a>(
    result_revision: u64,
    parameters: impl Iterator<Item = &'a ParameterId>,
) -> TransactionId {
    let names = parameters
        .map(|parameter| parameter.0.trim_start_matches("parameter:"))
        .collect::<Vec<_>>()
        .join("+");
    TransactionId(format!(
        "transaction:{result_revision}:set-parameters:{names}"
    ))
}

fn validate_positive(label: &str, value: i64) -> Result<(), EngineError> {
    if value <= 0 {
        return Err(EngineError::NonPositiveLength {
            label: label.into(),
            value,
        });
    }
    Ok(())
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum EngineError {
    EmptyTransaction,
    UnknownParameter(ParameterId),
    DuplicateParameter(ParameterId),
    NotLengthParameter(ParameterId),
    NonPositiveLength { label: String, value: i64 },
    InvalidRectangleIntent,
    InvalidFeatureGraph(String),
    InvalidDocument(String),
    Serialization(String),
    DimensionOverflow,
    RevisionOverflow,
    NothingToUndo,
    NothingToRedo,
}

impl Display for EngineError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyTransaction => formatter.write_str("parameter transaction is empty"),
            Self::UnknownParameter(parameter) => {
                write!(formatter, "unknown parameter {parameter:?}")
            }
            Self::DuplicateParameter(parameter) => {
                write!(formatter, "duplicate parameter edit {parameter:?}")
            }
            Self::NotLengthParameter(parameter) => {
                write!(formatter, "parameter {parameter:?} is not a length")
            }
            Self::NonPositiveLength { label, value } => {
                write!(formatter, "{label} length must be positive, got {value}")
            }
            Self::InvalidRectangleIntent => {
                formatter.write_str("constrained rectangle intent differs")
            }
            Self::InvalidFeatureGraph(message) => {
                write!(formatter, "invalid feature graph: {message}")
            }
            Self::InvalidDocument(message) => write!(formatter, "invalid part document: {message}"),
            Self::Serialization(message) => {
                write!(formatter, "document serialization failed: {message}")
            }
            Self::DimensionOverflow => {
                formatter.write_str("evaluated dimensions overflow topology evidence")
            }
            Self::RevisionOverflow => formatter.write_str("document revision overflow"),
            Self::NothingToUndo => formatter.write_str("there is no accepted snapshot to undo"),
            Self::NothingToRedo => formatter.write_str("there is no accepted snapshot to redo"),
        }
    }
}

impl Error for EngineError {}
