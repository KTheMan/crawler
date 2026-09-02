//! Atomic accepted-document transactions with independent undo and redo history.

use crawler_document::{
    ConstructionPlaneDefinitionReference, ConstructionPlaneDefinitionV1, ConstructionPlaneId,
    Document, DocumentChange, DocumentTransaction, EntityId, FeatureDefinitionReference, FeatureId,
    FeatureInput, FeatureOperationV2, FeatureRecomputeState, FeatureResultV2, ParameterExpression,
    ParameterId, ParameterValue, PlanarSupportReferenceV2, RegionDefinitionV2, SketchSupport,
    TopologyKind, TransactionId,
};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use thiserror::Error;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransactionEvent {
    pub transaction: TransactionId,
    pub base_revision: u64,
    pub result_revision: u64,
    pub affected_entities: Vec<EntityId>,
    pub dirty_roots: Vec<FeatureId>,
    pub accepted_hash: String,
}

#[derive(Debug)]
pub struct DocumentHistory {
    accepted: Document,
    undo: Vec<Document>,
    redo: Vec<Document>,
}

impl DocumentHistory {
    pub fn new(accepted: Document) -> Self {
        Self {
            accepted,
            undo: Vec::new(),
            redo: Vec::new(),
        }
    }

    pub fn accepted(&self) -> &Document {
        &self.accepted
    }

    pub fn accepted_hash(&self) -> String {
        semantic_hash(&self.accepted)
    }

    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }

    /// Validate and apply all changes against a clone before replacing accepted state.
    pub fn commit(
        &mut self,
        transaction_id: TransactionId,
        changes: Vec<DocumentChange>,
    ) -> Result<TransactionEvent, TransactionError> {
        if changes.is_empty() {
            return Err(TransactionError::EmptyTransaction);
        }
        let base_revision = self.accepted.revision;
        let mut candidate = self.accepted.clone();
        let mut affected = Vec::new();
        let mut dirty = BTreeSet::new();

        for change in &changes {
            apply_change(&mut candidate, change, &mut affected, &mut dirty)?;
        }

        candidate.revision = base_revision
            .checked_add(1)
            .ok_or(TransactionError::RevisionOverflow)?;
        candidate.recompute.accepted_revision = candidate.revision;
        for feature in &dirty {
            candidate.recompute.features.insert(
                feature.clone(),
                FeatureRecomputeState::Dirty {
                    since_revision: candidate.revision,
                },
            );
        }
        candidate.transactions.push(DocumentTransaction {
            id: transaction_id.clone(),
            base_revision,
            result_revision: candidate.revision,
            changes,
        });

        validate_document(&candidate)?;
        let result_revision = candidate.revision;
        let accepted_hash = semantic_hash(&candidate);
        self.undo
            .push(std::mem::replace(&mut self.accepted, candidate));
        self.redo.clear();

        Ok(TransactionEvent {
            transaction: transaction_id,
            base_revision,
            result_revision,
            affected_entities: affected,
            dirty_roots: dirty.into_iter().collect(),
            accepted_hash,
        })
    }

    pub fn undo(&mut self) -> Result<&Document, HistoryError> {
        let previous = self.undo.pop().ok_or(HistoryError::NothingToUndo)?;
        self.redo
            .push(std::mem::replace(&mut self.accepted, previous));
        Ok(&self.accepted)
    }

    pub fn redo(&mut self) -> Result<&Document, HistoryError> {
        let next = self.redo.pop().ok_or(HistoryError::NothingToRedo)?;
        self.undo.push(std::mem::replace(&mut self.accepted, next));
        Ok(&self.accepted)
    }
}

fn apply_change(
    document: &mut Document,
    change: &DocumentChange,
    affected: &mut Vec<EntityId>,
    dirty: &mut BTreeSet<FeatureId>,
) -> Result<(), TransactionError> {
    match change {
        DocumentChange::CreatePart { .. } => {
            return Err(TransactionError::CreationRequiresDocumentFactory);
        }
        DocumentChange::CreateParameter {
            component,
            parameter,
        } => {
            if document.parameters.contains_key(&parameter.id) {
                return Err(TransactionError::DuplicateEntity(parameter.id.0.clone()));
            }
            if parameter.id.0.trim().is_empty() || parameter.display_name.trim().is_empty() {
                return Err(TransactionError::EmptyDisplayName);
            }
            document
                .components
                .get_mut(component)
                .ok_or_else(|| TransactionError::MissingEntity(component.0.clone()))?
                .parameter_order
                .push(parameter.id.clone());
            document
                .parameters
                .insert(parameter.id.clone(), parameter.clone());
            affected.push(EntityId::Parameter(parameter.id.clone()));
        }
        DocumentChange::RenameEntity {
            entity,
            display_name,
        } => {
            if display_name.trim().is_empty() {
                return Err(TransactionError::EmptyDisplayName);
            }
            rename(document, entity, display_name)?;
            affected.push(entity.clone());
        }
        DocumentChange::SetParameterValue { parameter, value } => {
            let target = document
                .parameters
                .get_mut(parameter)
                .ok_or_else(|| TransactionError::MissingEntity(parameter.0.clone()))?;
            if std::mem::discriminant(&target.value) != std::mem::discriminant(value) {
                return Err(TransactionError::IncompatibleParameterType(
                    parameter.0.clone(),
                ));
            }
            target.value = value.clone();
            affected.push(EntityId::Parameter(parameter.clone()));
            for (feature_id, feature) in &document.features {
                if feature.parameters.values().any(|id| id == parameter) {
                    dirty.insert(feature_id.clone());
                }
            }
            for (feature_id, definition) in &document.feature_definitions_v2 {
                definition.visit_references(|reference| {
                    if matches!(reference, FeatureDefinitionReference::Parameter(id) if id == parameter)
                    {
                        dirty.insert(feature_id.clone());
                    }
                });
            }
            mark_construction_plane_parameter_dependents(document, parameter, affected, dirty);
        }
        DocumentChange::SetFeatureSuppressed {
            feature,
            suppressed,
        } => {
            document
                .features
                .get_mut(feature)
                .ok_or_else(|| TransactionError::MissingEntity(feature.0.clone()))?
                .suppressed = *suppressed;
            affected.push(EntityId::Feature(feature.clone()));
            dirty.insert(feature.clone());
        }
        DocumentChange::ReorderFeature {
            component,
            feature,
            before,
        } => {
            if !document.features.contains_key(feature) {
                return Err(TransactionError::MissingEntity(feature.0.clone()));
            }
            let owner = document
                .components
                .get_mut(component)
                .ok_or_else(|| TransactionError::MissingEntity(component.0.clone()))?;
            let index = owner
                .feature_order
                .iter()
                .position(|candidate| candidate == feature)
                .ok_or_else(|| TransactionError::MissingEntity(feature.0.clone()))?;
            owner.feature_order.remove(index);
            let insert_at = match before {
                Some(before) => owner
                    .feature_order
                    .iter()
                    .position(|candidate| candidate == before)
                    .ok_or_else(|| TransactionError::MissingEntity(before.0.clone()))?,
                None => owner.feature_order.len(),
            };
            owner.feature_order.insert(insert_at, feature.clone());
            affected.push(EntityId::Feature(feature.clone()));
            dirty.insert(feature.clone());
        }
        DocumentChange::UpsertSketch { sketch }
        | DocumentChange::ApplySketchSolution { sketch, .. } => {
            if !document.components.contains_key(&sketch.component) {
                return Err(TransactionError::MissingEntity(sketch.component.0.clone()));
            }
            let is_new = !document.sketches.contains_key(&sketch.id);
            if let Some(existing) = document.sketches.get(&sketch.id)
                && existing.component != sketch.component
            {
                return Err(TransactionError::CrossComponentEdit(sketch.id.0.clone()));
            }
            document.sketches.insert(sketch.id.clone(), sketch.clone());
            if is_new {
                document
                    .components
                    .get_mut(&sketch.component)
                    .expect("component was validated")
                    .sketch_order
                    .push(sketch.id.clone());
            }
            affected.push(EntityId::Sketch(sketch.id.clone()));
            for (feature_id, feature) in &document.features {
                if feature
                    .inputs
                    .values()
                    .any(|input| input == &FeatureInput::Sketch(sketch.id.clone()))
                {
                    dirty.insert(feature_id.clone());
                }
            }
            for (feature_id, definition) in &document.feature_definitions_v2 {
                definition.visit_references(|reference| {
                    if matches!(reference, FeatureDefinitionReference::Sketch(id) if id == &sketch.id)
                    {
                        dirty.insert(feature_id.clone());
                    }
                });
            }
        }
        DocumentChange::CreateFeature { feature, before } => {
            if document.features.contains_key(&feature.id) {
                return Err(TransactionError::DuplicateEntity(feature.id.0.clone()));
            }
            let component = document
                .components
                .get_mut(&feature.component)
                .ok_or_else(|| TransactionError::MissingEntity(feature.component.0.clone()))?;
            let insert_at = match before {
                Some(before) => component
                    .feature_order
                    .iter()
                    .position(|candidate| candidate == before)
                    .ok_or_else(|| TransactionError::MissingEntity(before.0.clone()))?,
                None => component.feature_order.len(),
            };
            component
                .feature_order
                .insert(insert_at, feature.id.clone());
            document
                .features
                .insert(feature.id.clone(), feature.clone());
            affected.push(EntityId::Feature(feature.id.clone()));
            dirty.insert(feature.id.clone());
        }
        DocumentChange::EditFeature { feature } => {
            let existing = document
                .features
                .get(&feature.id)
                .ok_or_else(|| TransactionError::MissingEntity(feature.id.0.clone()))?;
            if existing.component != feature.component {
                return Err(TransactionError::CrossComponentEdit(feature.id.0.clone()));
            }
            document
                .features
                .insert(feature.id.clone(), feature.clone());
            affected.push(EntityId::Feature(feature.id.clone()));
            dirty.insert(feature.id.clone());
        }
        DocumentChange::UpsertFeatureDefinitionV2 {
            feature,
            definition,
        } => {
            if !document.features.contains_key(feature) {
                return Err(TransactionError::MissingEntity(feature.0.clone()));
            }
            document
                .feature_definitions_v2
                .insert(feature.clone(), definition.clone());
            affected.push(EntityId::Feature(feature.clone()));
            dirty.insert(feature.clone());
        }
        DocumentChange::UpsertRegionDefinitionV2 { region, definition } => {
            validate_region_definition(document, region, definition)?;
            document
                .region_definitions_v2
                .insert(region.clone(), definition.clone());
            affected.push(EntityId::Sketch(definition.sketch.clone()));
            for (feature_id, feature_definition) in &document.feature_definitions_v2 {
                feature_definition.visit_references(|reference| {
                    if matches!(reference, FeatureDefinitionReference::Region(id) if id == region) {
                        dirty.insert(feature_id.clone());
                    }
                });
            }
        }
        DocumentChange::UpsertConstructionPlaneDefinitionV1 { plane, definition } => {
            validate_construction_plane_definition(document, plane, definition)?;
            let is_new = !document.construction_planes.contains_key(plane);
            if let Some(existing) = document.construction_planes.get(plane)
                && existing.component != definition.component
            {
                return Err(TransactionError::CrossComponentEdit(plane.0.clone()));
            }
            document
                .construction_planes
                .insert(plane.clone(), definition.clone());
            if is_new {
                document
                    .components
                    .get_mut(&definition.component)
                    .expect("construction-plane component was validated")
                    .construction_plane_order
                    .push(plane.clone());
            }
            affected.push(EntityId::ConstructionPlane(plane.clone()));
            mark_construction_plane_feature_dependents(document, plane, affected, dirty);
        }
        DocumentChange::DeleteFeature { component, feature } => {
            let stored = document
                .features
                .get(feature)
                .ok_or_else(|| TransactionError::MissingEntity(feature.0.clone()))?;
            if &stored.component != component {
                return Err(TransactionError::CrossComponentEdit(feature.0.clone()));
            }
            if let Some(blocker) = document.features.iter().find_map(|(id, candidate)| {
                (candidate.dependencies.contains(feature)
                    || candidate
                        .inputs
                        .values()
                        .any(|input| matches!(input, FeatureInput::Feature(id) if id == feature)))
                .then(|| id.clone())
            }) {
                return Err(TransactionError::FeatureInUse {
                    feature: feature.0.clone(),
                    blocker: blocker.0,
                });
            }
            if let Some(body) = document
                .bodies
                .values()
                .find(|body| body.accepts_producer(feature))
            {
                return Err(TransactionError::FeatureInUse {
                    feature: feature.0.clone(),
                    blocker: body.id.0.clone(),
                });
            }
            document.features.remove(feature);
            let removed_regions: BTreeSet<_> = document
                .feature_definitions_v2
                .remove(feature)
                .into_iter()
                .flat_map(|definition| {
                    definition
                        .references()
                        .into_iter()
                        .filter_map(|reference| match reference {
                            crawler_document::OwnedFeatureDefinitionReference::Region(region) => {
                                Some(region)
                            }
                            _ => None,
                        })
                })
                .collect();
            for region in removed_regions {
                let still_used = document.feature_definitions_v2.values().any(|definition| {
                    definition.references().into_iter().any(|reference| {
                        matches!(
                            reference,
                            crawler_document::OwnedFeatureDefinitionReference::Region(id)
                                if id == region
                        )
                    })
                });
                if !still_used {
                    document.region_definitions_v2.remove(&region);
                }
            }
            document.recompute.features.remove(feature);
            document
                .components
                .get_mut(component)
                .expect("component was validated")
                .feature_order
                .retain(|id| id != feature);
            document
                .topology_references
                .retain(|_, reference| &reference.producer != feature);
            affected.push(EntityId::Feature(feature.clone()));
        }
        DocumentChange::GroupFeatures {
            group_id,
            display_name,
            features,
        } => {
            if group_id.trim().is_empty() || display_name.trim().is_empty() || features.is_empty() {
                return Err(TransactionError::InvalidGroup);
            }
            let unique: BTreeSet<_> = features.iter().collect();
            if unique.len() != features.len()
                || features
                    .iter()
                    .any(|feature| !document.features.contains_key(feature))
            {
                return Err(TransactionError::InvalidGroup);
            }
            let components: BTreeSet<_> = features
                .iter()
                .map(|feature| document.features[feature].component.clone())
                .collect();
            if components.len() != 1 {
                return Err(TransactionError::InvalidGroup);
            }
            affected.extend(features.iter().cloned().map(EntityId::Feature));
        }
        DocumentChange::SetBodyVisibility { body, visibility } => {
            document
                .bodies
                .get_mut(body)
                .ok_or_else(|| TransactionError::MissingEntity(body.0.clone()))?
                .visibility = *visibility;
            affected.push(EntityId::Body(body.clone()));
        }
        DocumentChange::UpsertTopologyReference { reference } => {
            let body = document.bodies.get(&reference.body);
            let producer = document.features.get(&reference.producer);
            if body.is_none_or(|body| {
                body.component != reference.component || !body.accepts_producer(&reference.producer)
            }) || producer.is_none_or(|producer| producer.component != reference.component)
            {
                return Err(TransactionError::InvalidTopologyTarget);
            }
            document
                .topology_references
                .insert(reference.id.clone(), reference.clone());
        }
        DocumentChange::SetParameterExpression {
            parameter,
            expression,
            evaluated_value,
        } => {
            validate_expression(document, expression)?;
            let stored = document
                .parameters
                .get_mut(parameter)
                .ok_or_else(|| TransactionError::MissingEntity(parameter.0.clone()))?;
            if std::mem::discriminant(&stored.value) != std::mem::discriminant(evaluated_value) {
                return Err(TransactionError::IncompatibleParameterType(
                    parameter.0.clone(),
                ));
            }
            stored.value = evaluated_value.clone();
            affected.push(EntityId::Parameter(parameter.clone()));
            for (feature_id, feature) in &document.features {
                if feature.parameters.values().any(|id| id == parameter) {
                    dirty.insert(feature_id.clone());
                }
            }
            for (feature_id, definition) in &document.feature_definitions_v2 {
                definition.visit_references(|reference| {
                    if matches!(reference, FeatureDefinitionReference::Parameter(id) if id == parameter)
                    {
                        dirty.insert(feature_id.clone());
                    }
                });
            }
            mark_construction_plane_parameter_dependents(document, parameter, affected, dirty);
        }
        DocumentChange::RebindTopology {
            feature,
            input_name,
            from_reference,
            replacement,
        } => {
            let source = document
                .topology_references
                .get(from_reference)
                .cloned()
                .ok_or_else(|| TransactionError::MissingEntity(from_reference.0.clone()))?;
            if !document.bodies.contains_key(&replacement.body)
                || !document.features.contains_key(&replacement.producer)
            {
                return Err(TransactionError::InvalidTopologyTarget);
            }
            if source.kind != TopologyKind::Face
                || replacement.kind != TopologyKind::Face
                || source.component != replacement.component
                || source.body != replacement.body
                || source.producer != replacement.producer
            {
                return Err(TransactionError::InvalidTopologyTarget);
            }
            let source_body = document
                .bodies
                .get(&source.body)
                .ok_or(TransactionError::InvalidTopologyTarget)?;
            let producer = document
                .features
                .get(&source.producer)
                .ok_or(TransactionError::InvalidTopologyTarget)?;
            if !source_body.accepts_producer(&source.producer)
                || source.component != source_body.component
                || source.component != producer.component
            {
                return Err(TransactionError::InvalidTopologyTarget);
            }
            let owned_sketch = {
                let target = document
                    .features
                    .get(feature)
                    .ok_or_else(|| TransactionError::MissingEntity(feature.0.clone()))?;
                if target.component != source_body.component {
                    return Err(TransactionError::InvalidTopologyTarget);
                }
                match target.inputs.get(input_name) {
                    Some(FeatureInput::Topology(current)) if current == from_reference => {}
                    _ => return Err(TransactionError::InvalidTopologyTarget),
                }
                if input_name == "support" {
                    match target.inputs.get("sketch") {
                        Some(FeatureInput::Sketch(sketch)) => {
                            let owned = document
                                .sketches
                                .get(sketch)
                                .ok_or_else(|| TransactionError::MissingEntity(sketch.0.clone()))?;
                            if !matches!(
                                &owned.support,
                                SketchSupport::Topology { reference } if reference == from_reference
                            ) {
                                return Err(TransactionError::InvalidTopologyTarget);
                            }
                            Some(sketch.clone())
                        }
                        _ => None,
                    }
                } else {
                    None
                }
            };
            document
                .topology_references
                .insert(replacement.id.clone(), replacement.clone());
            let target = document
                .features
                .get_mut(feature)
                .expect("feature and input were validated before mutation");
            target.inputs.insert(
                input_name.clone(),
                FeatureInput::Topology(replacement.id.clone()),
            );
            affected.push(EntityId::Feature(feature.clone()));
            // Rebinding an already-solved owned sketch changes only its
            // support frame. Native authority was validated before this
            // transaction; the body-producing consumers need recomputation,
            // not the sketch solution itself. Generic topology inputs remain
            // dirty because this layer cannot accept their evaluation result.
            if owned_sketch.is_none() {
                dirty.insert(feature.clone());
            }
            if let Some(sketch_id) = owned_sketch.as_ref() {
                document
                    .sketches
                    .get_mut(sketch_id)
                    .expect("owned sketch was validated before mutation")
                    .support = SketchSupport::Topology {
                    reference: replacement.id.clone(),
                };
                affected.push(EntityId::Sketch(sketch_id.clone()));
                for (candidate_id, candidate) in &document.features {
                    if candidate_id != feature
                        && candidate
                            .inputs
                            .values()
                            .any(|input| input == &FeatureInput::Sketch(sketch_id.clone()))
                    {
                        dirty.insert(candidate_id.clone());
                    }
                }
            }
            // A topology reference can be shared by independent feature
            // branches. Rebind only the selected feature and direct consumers
            // of the sketch that the selected feature explicitly owns.
            let branch_consumers: BTreeSet<_> = document
                .features
                .iter()
                .filter_map(|(candidate_id, candidate)| {
                    let is_selected = candidate_id == feature;
                    let consumes_owned_sketch = owned_sketch.as_ref().is_some_and(|sketch_id| {
                        candidate
                            .inputs
                            .values()
                            .any(|input| input == &FeatureInput::Sketch(sketch_id.clone()))
                            && candidate.inputs.get("support")
                                == Some(&FeatureInput::Topology(from_reference.clone()))
                    });
                    (is_selected || consumes_owned_sketch).then(|| candidate_id.clone())
                })
                .collect();
            for candidate_id in branch_consumers {
                let Some(definition) = document.feature_definitions_v2.get_mut(&candidate_id)
                else {
                    continue;
                };
                let FeatureOperationV2::Extrude { support, .. } = &mut definition.operation;
                if matches!(
                    support,
                    PlanarSupportReferenceV2::TopologyFace { reference }
                        if reference == from_reference
                ) {
                    *support = PlanarSupportReferenceV2::TopologyFace {
                        reference: replacement.id.clone(),
                    };
                    document
                        .features
                        .get_mut(&candidate_id)
                        .expect("a V2 definition must belong to a validated feature")
                        .inputs
                        .insert(
                            "support".into(),
                            FeatureInput::Topology(replacement.id.clone()),
                        );
                    dirty.insert(candidate_id.clone());
                    affected.push(EntityId::Feature(candidate_id));
                }
            }
        }
        DocumentChange::AcceptFeatureResult {
            feature,
            body,
            request_json,
            result_json,
        } => {
            if request_json.is_empty() || result_json.is_empty() {
                return Err(TransactionError::InvalidFeatureResult);
            }
            let component = document
                .features
                .get(feature)
                .ok_or_else(|| TransactionError::MissingEntity(feature.0.clone()))?
                .component
                .clone();
            let durable_result = document
                .feature_definitions_v2
                .get(feature)
                .map(|definition| (&definition.result, definition.participant_bodies.as_slice()));
            if matches!(durable_result, Some((FeatureResultV2::Cut, _))) {
                let (_, participants) = durable_result.expect("Cut result was matched");
                if participants.len() != 1 || participants[0].body != *body {
                    return Err(TransactionError::InvalidFeatureResult);
                }
                let stored = document
                    .bodies
                    .get_mut(body)
                    .ok_or(TransactionError::InvalidFeatureResult)?;
                if stored.component != component {
                    return Err(TransactionError::CrossComponentEdit(body.0.clone()));
                }
                stored.accept_retained_result(feature.clone());
            } else if let Some(stored) = document.bodies.get_mut(body) {
                match durable_result {
                    Some((FeatureResultV2::NewBody { body: output }, _)) => {
                        if output != body
                            || stored.generated_by != *feature
                            || stored.component != component
                        {
                            return Err(TransactionError::InvalidFeatureResult);
                        }
                    }
                    Some((FeatureResultV2::Cut, _)) => unreachable!("Cut handled above"),
                    None => {
                        if stored.component != component {
                            return Err(TransactionError::CrossComponentEdit(body.0.clone()));
                        }
                        stored.accept_retained_result(feature.clone());
                    }
                }
            } else {
                if durable_result.is_some_and(|(result, _)| {
                    !matches!(result, FeatureResultV2::NewBody { body: output } if output == body)
                }) {
                    return Err(TransactionError::InvalidFeatureResult);
                }
                document.bodies.insert(
                    body.clone(),
                    crawler_document::Body {
                        id: body.clone(),
                        display_name: body.0.clone(),
                        component: component.clone(),
                        generated_by: feature.clone(),
                        producer_lineage: Vec::new(),
                        visibility: crawler_document::ModelVisibility::Visible,
                    },
                );
                document
                    .components
                    .get_mut(&component)
                    .expect("feature component exists")
                    .body_order
                    .push(body.clone());
            }
            document.recompute.features.insert(
                feature.clone(),
                FeatureRecomputeState::Clean {
                    evaluated_revision: document.revision.saturating_add(1),
                },
            );
            // A result accepted in the same transaction satisfies any dirtiness
            // introduced by creating or editing that feature.
            dirty.remove(feature);
            affected.push(EntityId::Body(body.clone()));
            affected.push(EntityId::Feature(feature.clone()));
        }
    }
    Ok(())
}

fn mark_construction_plane_feature_dependents(
    document: &Document,
    plane: &ConstructionPlaneId,
    affected: &mut Vec<EntityId>,
    dirty: &mut BTreeSet<FeatureId>,
) {
    let supported_sketches: BTreeSet<_> = document
        .sketches
        .iter()
        .filter(|(_, sketch)| {
            matches!(
                &sketch.support,
                SketchSupport::ConstructionPlaneReference { plane: support } if support == plane
            )
        })
        .map(|(sketch_id, _)| sketch_id.clone())
        .collect();
    for sketch in &supported_sketches {
        let entity = EntityId::Sketch(sketch.clone());
        if !affected.contains(&entity) {
            affected.push(entity);
        }
    }

    let mut direct = BTreeSet::new();
    for (feature_id, definition) in &document.feature_definitions_v2 {
        definition.visit_references(|reference| {
            if matches!(reference, FeatureDefinitionReference::ConstructionPlane(id) if id == plane)
            {
                direct.insert(feature_id.clone());
            }
        });
    }
    for (feature_id, feature) in &document.features {
        if feature.inputs.values().any(|input| {
            matches!(input, FeatureInput::Sketch(sketch) if supported_sketches.contains(sketch))
        }) {
            direct.insert(feature_id.clone());
        }
    }
    dirty.extend(direct.iter().cloned());
    mark_transitive_feature_descendants(document, &direct, dirty);
}

fn mark_construction_plane_parameter_dependents(
    document: &Document,
    parameter: &ParameterId,
    affected: &mut Vec<EntityId>,
    dirty: &mut BTreeSet<FeatureId>,
) {
    let dependent_planes: Vec<_> = document
        .construction_planes
        .iter()
        .filter_map(|(plane_id, definition)| {
            let mut depends = false;
            definition.visit_references(|reference| {
                if matches!(reference, ConstructionPlaneDefinitionReference::Parameter(id) if id == parameter)
                {
                    depends = true;
                }
            });
            depends.then(|| plane_id.clone())
        })
        .collect();
    for plane in dependent_planes {
        mark_construction_plane_feature_dependents(document, &plane, affected, dirty);
    }
}

/// Propagate construction-plane dirtiness through every durable feature-input
/// channel. Body inputs only form a forward edge when the body's current
/// producer precedes the consumer in the component timeline; this avoids a
/// backwards edge from a shared body's final producer to an earlier feature.
fn mark_transitive_feature_descendants(
    document: &Document,
    roots: &BTreeSet<FeatureId>,
    dirty: &mut BTreeSet<FeatureId>,
) {
    let positions = feature_timeline_positions(document);
    let mut discovered = roots.clone();
    loop {
        let before = discovered.len();
        for (candidate_id, feature) in &document.features {
            if discovered.contains(candidate_id) {
                continue;
            }
            let depends_on_dirty = feature
                .dependencies
                .iter()
                .any(|id| discovered.contains(id))
                || feature.inputs.values().any(|input| match input {
                    FeatureInput::Feature(id) => discovered.contains(id),
                    FeatureInput::Body(id) => document.bodies.get(id).is_some_and(|body| {
                        body.generated_by != *candidate_id
                            && discovered.contains(&body.generated_by)
                            && positions.get(&body.generated_by) < positions.get(candidate_id)
                    }),
                    FeatureInput::Topology(id) => document
                        .topology_references
                        .get(id)
                        .is_some_and(|reference| discovered.contains(&reference.producer)),
                    FeatureInput::Sketch(_) => false,
                });
            if depends_on_dirty {
                discovered.insert(candidate_id.clone());
            }
        }
        if discovered.len() == before {
            break;
        }
    }
    dirty.extend(discovered);
}

fn feature_timeline_positions(document: &Document) -> BTreeMap<FeatureId, usize> {
    document
        .components
        .values()
        .flat_map(|component| component.feature_order.iter())
        .cloned()
        .enumerate()
        .map(|(position, feature)| (feature, position))
        .collect()
}

fn validate_expression(
    document: &Document,
    expression: &ParameterExpression,
) -> Result<(), TransactionError> {
    if expression.source.trim().is_empty() {
        return Err(TransactionError::InvalidExpression);
    }
    fn visit(
        document: &Document,
        node: &crawler_document::ParameterExpressionNode,
    ) -> Result<(), TransactionError> {
        use crawler_document::ParameterExpressionNode as Node;
        match node {
            Node::Literal { .. } => Ok(()),
            Node::Parameter { id } => document
                .parameters
                .contains_key(id)
                .then_some(())
                .ok_or_else(|| TransactionError::MissingEntity(id.0.clone())),
            Node::Add { left, right } | Node::Subtract { left, right } => {
                visit(document, left)?;
                visit(document, right)
            }
            Node::Multiply { value, scalar } | Node::Divide { value, scalar } => {
                visit(document, value)?;
                visit(document, scalar)
            }
        }
    }
    visit(document, &expression.root)
}

/// Recover the latest durable structural expression for a named parameter.
pub fn parameter_expression<'a>(
    document: &'a Document,
    parameter: &ParameterId,
) -> Option<&'a ParameterExpression> {
    document.transactions.iter().rev().find_map(|transaction| {
        transaction
            .changes
            .iter()
            .rev()
            .find_map(|change| match change {
                DocumentChange::SetParameterExpression {
                    parameter: candidate,
                    expression,
                    ..
                } if candidate == parameter => Some(expression),
                _ => None,
            })
    })
}

/// Rebuild durable feature groups from the accepted transaction journal.
pub fn feature_groups(document: &Document) -> BTreeMap<String, (String, Vec<FeatureId>)> {
    let mut groups = BTreeMap::new();
    for transaction in &document.transactions {
        for change in &transaction.changes {
            match change {
                DocumentChange::GroupFeatures {
                    group_id,
                    display_name,
                    features,
                } => {
                    groups.insert(group_id.clone(), (display_name.clone(), features.clone()));
                }
                DocumentChange::DeleteFeature { feature, .. } => {
                    for (_, members) in groups.values_mut() {
                        members.retain(|member| member != feature);
                    }
                    groups.retain(|_, (_, members)| !members.is_empty());
                }
                _ => {}
            }
        }
    }
    groups
}

fn rename(
    document: &mut Document,
    entity: &EntityId,
    display_name: &str,
) -> Result<(), TransactionError> {
    match entity {
        EntityId::Document(id) if id == &document.id => document.display_name = display_name.into(),
        EntityId::Component(id) => {
            document
                .components
                .get_mut(id)
                .ok_or_else(|| TransactionError::MissingEntity(id.0.clone()))?
                .display_name = display_name.into()
        }
        EntityId::Body(id) => {
            document
                .bodies
                .get_mut(id)
                .ok_or_else(|| TransactionError::MissingEntity(id.0.clone()))?
                .display_name = display_name.into()
        }
        EntityId::Sketch(id) => {
            document
                .sketches
                .get_mut(id)
                .ok_or_else(|| TransactionError::MissingEntity(id.0.clone()))?
                .display_name = display_name.into()
        }
        EntityId::Feature(id) => {
            document
                .features
                .get_mut(id)
                .ok_or_else(|| TransactionError::MissingEntity(id.0.clone()))?
                .display_name = display_name.into()
        }
        EntityId::Parameter(id) => {
            document
                .parameters
                .get_mut(id)
                .ok_or_else(|| TransactionError::MissingEntity(id.0.clone()))?
                .display_name = display_name.into()
        }
        EntityId::ConstructionPlane(id) => {
            if !document.construction_planes.contains_key(id) {
                return Err(TransactionError::MissingEntity(id.0.clone()));
            }
            return Err(TransactionError::ConstructionPlaneHasNoDisplayName(
                id.0.clone(),
            ));
        }
        EntityId::Document(id) => return Err(TransactionError::MissingEntity(id.0.clone())),
    }
    Ok(())
}

fn validate_document(document: &Document) -> Result<(), TransactionError> {
    if !document.components.contains_key(&document.root_component) {
        return Err(TransactionError::MissingEntity(
            document.root_component.0.clone(),
        ));
    }
    for feature in document.features.values() {
        if !document.components.contains_key(&feature.component) {
            return Err(TransactionError::MissingEntity(feature.component.0.clone()));
        }
        for parameter in feature.parameters.values() {
            if !document.parameters.contains_key(parameter) {
                return Err(TransactionError::MissingEntity(parameter.0.clone()));
            }
        }
    }
    for (plane_id, definition) in &document.construction_planes {
        validate_construction_plane_definition(document, plane_id, definition)?;
    }
    let mut ordered_planes = BTreeSet::new();
    for component in document.components.values() {
        for plane in &component.construction_plane_order {
            if !ordered_planes.insert(plane.clone()) {
                return Err(TransactionError::InvalidConstructionPlaneDefinition(
                    plane.0.clone(),
                ));
            }
            let definition = document
                .construction_planes
                .get(plane)
                .ok_or_else(|| TransactionError::MissingEntity(plane.0.clone()))?;
            if definition.component != component.id {
                return Err(TransactionError::CrossComponentEdit(plane.0.clone()));
            }
        }
    }
    if ordered_planes.len() != document.construction_planes.len() {
        let unordered = document
            .construction_planes
            .keys()
            .find(|plane| !ordered_planes.contains(*plane))
            .expect("construction-plane collection sizes differ");
        return Err(TransactionError::InvalidConstructionPlaneDefinition(
            unordered.0.clone(),
        ));
    }
    for sketch in document.sketches.values() {
        if let SketchSupport::ConstructionPlaneReference { plane } = &sketch.support {
            let definition = document
                .construction_planes
                .get(plane)
                .ok_or_else(|| TransactionError::MissingEntity(plane.0.clone()))?;
            if definition.component != sketch.component {
                return Err(TransactionError::CrossComponentEdit(sketch.id.0.clone()));
            }
        }
    }
    for body in document.bodies.values() {
        let mut seen = BTreeSet::new();
        for producer in &body.producer_lineage {
            let stored = document
                .features
                .get(producer)
                .ok_or_else(|| TransactionError::MissingEntity(producer.0.clone()))?;
            if producer == &body.generated_by
                || stored.component != body.component
                || !seen.insert(producer)
            {
                return Err(TransactionError::InvalidBodyProducerLineage(
                    body.id.0.clone(),
                ));
            }
        }
    }
    for (region_id, definition) in &document.region_definitions_v2 {
        validate_region_definition(document, region_id, definition)?;
    }
    for (feature_id, definition) in &document.feature_definitions_v2 {
        let Some(feature) = document.features.get(feature_id) else {
            return Err(TransactionError::MissingEntity(feature_id.0.clone()));
        };
        definition
            .validate_contract()
            .map_err(|_| TransactionError::InvalidFeatureDefinition(feature_id.0.clone()))?;
        let mut missing = None;
        definition.visit_references(|reference| {
            if missing.is_some() {
                return;
            }
            missing = match reference {
                FeatureDefinitionReference::Body(id) if !document.bodies.contains_key(id) => {
                    Some(id.0.clone())
                }
                FeatureDefinitionReference::Sketch(id) if !document.sketches.contains_key(id) => {
                    Some(id.0.clone())
                }
                FeatureDefinitionReference::OriginPlane(id)
                    if !document.origin_planes.contains_key(id) =>
                {
                    Some(id.0.clone())
                }
                FeatureDefinitionReference::ConstructionPlane(id)
                    if !document.construction_planes.contains_key(id) =>
                {
                    Some(id.0.clone())
                }
                FeatureDefinitionReference::Parameter(id)
                    if !document.parameters.contains_key(id) =>
                {
                    Some(id.0.clone())
                }
                FeatureDefinitionReference::Region(id)
                    if !document.region_definitions_v2.contains_key(id) =>
                {
                    Some(id.0.clone())
                }
                _ => None,
            };
        });
        if let Some(id) = missing {
            return Err(TransactionError::MissingEntity(id));
        }
        match &definition.result {
            FeatureResultV2::NewBody { body } => {
                if document
                    .bodies
                    .get(body)
                    .is_some_and(|output| output.component != feature.component)
                {
                    return Err(TransactionError::CrossComponentEdit(feature_id.0.clone()));
                }
            }
            FeatureResultV2::Cut => {
                let target = &definition.participant_bodies[0].body;
                let stored = document
                    .bodies
                    .get(target)
                    .ok_or_else(|| TransactionError::MissingEntity(target.0.clone()))?;
                if stored.component != feature.component {
                    return Err(TransactionError::CrossComponentEdit(feature_id.0.clone()));
                }
                let FeatureOperationV2::Extrude { support, .. } = &definition.operation;
                if let PlanarSupportReferenceV2::TopologyFace { reference } = support {
                    let topology = document
                        .topology_references
                        .get(reference)
                        .ok_or_else(|| TransactionError::MissingEntity(reference.0.clone()))?;
                    let producer = document.features.get(&topology.producer).ok_or_else(|| {
                        TransactionError::MissingEntity(topology.producer.0.clone())
                    })?;
                    if topology.kind != TopologyKind::Face
                        || topology.body != *target
                        || topology.component != feature.component
                        || producer.component != feature.component
                        || !stored.accepts_producer(&topology.producer)
                    {
                        return Err(TransactionError::InvalidFeatureDefinition(
                            feature_id.0.clone(),
                        ));
                    }
                }
            }
        }
        let referenced_sketch =
            definition
                .references()
                .into_iter()
                .find_map(|reference| match reference {
                    crawler_document::OwnedFeatureDefinitionReference::Sketch(sketch) => {
                        Some(sketch)
                    }
                    _ => None,
                });
        let mut mismatched_region = None;
        definition.visit_references(|reference| {
            if let FeatureDefinitionReference::Region(region) = reference {
                let Some(stored) = document.region_definitions_v2.get(region) else {
                    return;
                };
                if referenced_sketch
                    .as_ref()
                    .is_some_and(|sketch| sketch != &stored.sketch)
                {
                    mismatched_region = Some(region.0.clone());
                }
            }
        });
        if let Some(id) = mismatched_region {
            return Err(TransactionError::InvalidRegionDefinition(id));
        }
    }
    Ok(())
}

fn validate_construction_plane_definition(
    document: &Document,
    plane_id: &ConstructionPlaneId,
    definition: &ConstructionPlaneDefinitionV1,
) -> Result<(), TransactionError> {
    if &definition.id != plane_id {
        return Err(TransactionError::ConstructionPlaneIdentityMismatch {
            key: plane_id.0.clone(),
            definition: definition.id.0.clone(),
        });
    }
    if !document.components.contains_key(&definition.component) {
        return Err(TransactionError::MissingEntity(
            definition.component.0.clone(),
        ));
    }
    let mut failure = None;
    definition.visit_references(|reference| {
        if failure.is_some() {
            return;
        }
        failure = match reference {
            ConstructionPlaneDefinitionReference::OriginPlane(id) => {
                document.origin_planes.get(id).map_or_else(
                    || Some(TransactionError::MissingEntity(id.0.clone())),
                    |base| {
                        (base.component != definition.component)
                            .then(|| TransactionError::CrossComponentEdit(plane_id.0.clone()))
                    },
                )
            }
            ConstructionPlaneDefinitionReference::Parameter(id) => {
                match document.parameters.get(id) {
                    None => Some(TransactionError::MissingEntity(id.0.clone())),
                    Some(parameter)
                        if !matches!(parameter.value, ParameterValue::LengthNanometers(_)) =>
                    {
                        Some(TransactionError::IncompatibleParameterType(id.0.clone()))
                    }
                    Some(_) => None,
                }
            }
        };
    });
    failure.map_or(Ok(()), Err)
}

fn validate_region_definition(
    document: &Document,
    region_id: &crawler_document::RegionReferenceId,
    definition: &RegionDefinitionV2,
) -> Result<(), TransactionError> {
    if &definition.id != region_id {
        return Err(TransactionError::RegionIdentityMismatch {
            key: region_id.0.clone(),
            definition: definition.id.0.clone(),
        });
    }
    if !document.sketches.contains_key(&definition.sketch) {
        return Err(TransactionError::MissingEntity(definition.sketch.0.clone()));
    }
    if definition.outer_geometry_ids.is_empty()
        || definition
            .outer_geometry_ids
            .iter()
            .chain(definition.hole_geometry_ids.iter().flatten())
            .any(|id| id.trim().is_empty())
        || definition
            .hole_geometry_ids
            .iter()
            .any(|hole| hole.is_empty())
    {
        return Err(TransactionError::InvalidRegionDefinition(
            region_id.0.clone(),
        ));
    }
    let geometry_ids: Vec<_> = definition
        .outer_geometry_ids
        .iter()
        .chain(definition.hole_geometry_ids.iter().flatten())
        .collect();
    let unique: BTreeSet<_> = geometry_ids.iter().copied().collect();
    if unique.len() != geometry_ids.len() {
        return Err(TransactionError::InvalidRegionDefinition(
            region_id.0.clone(),
        ));
    }
    Ok(())
}

pub fn semantic_hash(document: &Document) -> String {
    let bytes = serde_json::to_vec(document).expect("crawler documents are serializable");
    format!("{:x}", Sha256::digest(bytes))
}

#[derive(Clone, Debug, Eq, PartialEq, Error)]
pub enum TransactionError {
    #[error("part creation must use the deterministic document factory")]
    CreationRequiresDocumentFactory,
    #[error("transaction must contain at least one change")]
    EmptyTransaction,
    #[error("document revision overflow")]
    RevisionOverflow,
    #[error("entity {0} does not exist")]
    MissingEntity(String),
    #[error("display name must not be empty")]
    EmptyDisplayName,
    #[error("parameter {0} cannot change quantity kind")]
    IncompatibleParameterType(String),
    #[error("entity {0} already exists")]
    DuplicateEntity(String),
    #[error("entity {0} cannot move across components")]
    CrossComponentEdit(String),
    #[error("feature {feature} is still used by {blocker}")]
    FeatureInUse { feature: String, blocker: String },
    #[error("feature group is invalid")]
    InvalidGroup,
    #[error("parameter expression is invalid")]
    InvalidExpression,
    #[error("topology replacement identity differs from its map key")]
    TopologyIdentityMismatch,
    #[error("region definition key {key} differs from embedded identity {definition}")]
    RegionIdentityMismatch { key: String, definition: String },
    #[error("region definition {0} is invalid")]
    InvalidRegionDefinition(String),
    #[error("feature definition {0} has an invalid result-mode or target-body contract")]
    InvalidFeatureDefinition(String),
    #[error("body {0} has an invalid retained-producer lineage")]
    InvalidBodyProducerLineage(String),
    #[error("construction-plane key {key} differs from embedded identity {definition}")]
    ConstructionPlaneIdentityMismatch { key: String, definition: String },
    #[error("construction-plane definition {0} is invalid")]
    InvalidConstructionPlaneDefinition(String),
    #[error("construction plane {0} has no display name")]
    ConstructionPlaneHasNoDisplayName(String),
    #[error("topology replacement points to missing semantic entities")]
    InvalidTopologyTarget,
    #[error("feature result payload is invalid")]
    InvalidFeatureResult,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Error)]
pub enum HistoryError {
    #[error("nothing to undo")]
    NothingToUndo,
    #[error("nothing to redo")]
    NothingToRedo,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crawler_document::{
        BodyId, ComponentId, ConstructionPlaneDefinitionV1, ConstructionPlaneId, DocumentChange,
        Feature, FeatureDefinitionV2, OperationReference, Parameter, ParameterId, ParameterValue,
        PlanarSupportReferenceV2, ProfileReferenceV2, RegionDefinitionV2, RegionReferenceId,
        SketchId, TopologyReference, TopologyReferenceId,
    };

    fn fixture() -> Document {
        serde_json::from_str(include_str!(
            "../../crawler-document/tests/fixtures/parametric-block.json"
        ))
        .unwrap()
    }

    fn exact_extrude_fixture() -> Document {
        serde_json::from_str(include_str!(
            "../../crawler-document/tests/fixtures/new-part-cube.json"
        ))
        .unwrap()
    }

    fn cut_history_fixture() -> (Document, FeatureId, BodyId, TopologyReferenceId) {
        let mut document = exact_extrude_fixture();
        let cut_id = FeatureId::from("feature:cut");
        let body = BodyId::from("body:part");
        let topology = TopologyReferenceId::from("topology:extrude-top");
        let region = RegionReferenceId::from("region:cut");
        document.region_definitions_v2.insert(
            region.clone(),
            RegionDefinitionV2 {
                id: region.clone(),
                sketch: SketchId::from("sketch:rectangle"),
                outer_geometry_ids: vec![
                    "line:bottom".into(),
                    "line:right".into(),
                    "line:top".into(),
                    "line:left".into(),
                ],
                hole_geometry_ids: Vec::new(),
            },
        );
        document.features.insert(
            cut_id.clone(),
            Feature {
                id: cut_id.clone(),
                display_name: "Cut".into(),
                component: ComponentId::from("component:root"),
                operation: OperationReference {
                    schema_id: "crawler.operation.extrude".into(),
                    schema_version: 1,
                },
                dependencies: vec![FeatureId::from("feature:extrude")],
                inputs: BTreeMap::from([("target_body".into(), FeatureInput::Body(body.clone()))]),
                parameters: BTreeMap::from([(
                    "distance".into(),
                    ParameterId::from("parameter:distance"),
                )]),
                suppressed: false,
            },
        );
        document
            .components
            .get_mut(&ComponentId::from("component:root"))
            .unwrap()
            .feature_order
            .push(cut_id.clone());
        document.feature_definitions_v2.insert(
            cut_id.clone(),
            FeatureDefinitionV2::exact_blind_cut_extrude(
                ProfileReferenceV2::SketchRegion {
                    sketch: SketchId::from("sketch:rectangle"),
                    region,
                },
                PlanarSupportReferenceV2::TopologyFace {
                    reference: topology.clone(),
                },
                ParameterId::from("parameter:distance"),
                body.clone(),
            ),
        );
        document.recompute.features.insert(
            cut_id.clone(),
            FeatureRecomputeState::Dirty {
                since_revision: document.revision,
            },
        );
        (document, cut_id, body, topology)
    }

    fn explicit_sketch_support_fixture() -> (
        Document,
        FeatureId,
        SketchId,
        TopologyReferenceId,
        TopologyReference,
    ) {
        let mut document = fixture();
        let feature_id = FeatureId::from("feature:sketch");
        let sketch_id = SketchId::from("sketch:base");
        let from_reference = TopologyReferenceId::from("topology:top-face");
        let mut replacement = document.topology_references[&from_reference].clone();
        replacement.id = TopologyReferenceId::from("topology:replacement-face");
        replacement.stable_kernel_id = 7;
        replacement.stable_token = "replacement:face".into();
        let feature = document.features.get_mut(&feature_id).unwrap();
        feature.inputs.insert(
            "support".into(),
            FeatureInput::Topology(from_reference.clone()),
        );
        feature
            .inputs
            .insert("sketch".into(), FeatureInput::Sketch(sketch_id.clone()));
        document.sketches.get_mut(&sketch_id).unwrap().support = SketchSupport::Topology {
            reference: from_reference.clone(),
        };
        (document, feature_id, sketch_id, from_reference, replacement)
    }

    fn construction_plane_dependency_fixture() -> (
        Document,
        ConstructionPlaneId,
        ParameterId,
        SketchId,
        BTreeSet<FeatureId>,
        FeatureId,
    ) {
        let mut document = exact_extrude_fixture();
        let component = document.root_component.clone();
        let plane = ConstructionPlaneId::from("construction-plane:dependency-test");
        let parameter = ParameterId::from("parameter:dependency-test-offset");
        let sketch = SketchId::from("sketch:rectangle");
        document.parameters.insert(
            parameter.clone(),
            Parameter {
                id: parameter.clone(),
                display_name: "Dependency Test Offset".into(),
                value: ParameterValue::LengthNanometers(7_000_000),
            },
        );
        let owner = document.components.get_mut(&component).unwrap();
        owner.parameter_order.push(parameter.clone());
        owner.construction_plane_order.push(plane.clone());
        document.construction_planes.insert(
            plane.clone(),
            ConstructionPlaneDefinitionV1::offset(
                plane.clone(),
                component.clone(),
                crawler_document::OriginPlaneId::from("origin-plane:xy"),
                parameter.clone(),
            ),
        );
        document.sketches.get_mut(&sketch).unwrap().support =
            SketchSupport::ConstructionPlaneReference {
                plane: plane.clone(),
            };

        let feature = |id: &str,
                       dependencies: Vec<FeatureId>,
                       inputs: BTreeMap<String, FeatureInput>| Feature {
            id: FeatureId::from(id),
            display_name: id.into(),
            component: component.clone(),
            operation: OperationReference {
                schema_id: "crawler.operation.dependency-test".into(),
                schema_version: 1,
            },
            dependencies,
            inputs,
            parameters: BTreeMap::new(),
            suppressed: false,
        };
        let root = FeatureId::from("feature:extrude");
        let via_dependency = FeatureId::from("feature:z-via-dependency");
        let via_feature = FeatureId::from("feature:a-via-feature-input");
        let via_body = FeatureId::from("feature:y-via-body-input");
        let via_topology = FeatureId::from("feature:b-via-topology-input");
        let unrelated = FeatureId::from("feature:unrelated-clean");
        let body = BodyId::from("body:via-feature-input");
        let topology = TopologyReferenceId::from("topology:via-body-input");
        let chain = [
            feature(&via_dependency.0, vec![root.clone()], BTreeMap::new()),
            feature(
                &via_feature.0,
                Vec::new(),
                BTreeMap::from([(
                    "source".into(),
                    FeatureInput::Feature(via_dependency.clone()),
                )]),
            ),
            feature(
                &via_body.0,
                Vec::new(),
                BTreeMap::from([("target".into(), FeatureInput::Body(body.clone()))]),
            ),
            feature(
                &via_topology.0,
                Vec::new(),
                BTreeMap::from([("face".into(), FeatureInput::Topology(topology.clone()))]),
            ),
            feature(&unrelated.0, Vec::new(), BTreeMap::new()),
        ];
        let owner = document.components.get_mut(&component).unwrap();
        for feature in &chain {
            owner.feature_order.push(feature.id.clone());
        }
        owner.body_order.push(body.clone());
        for feature in chain {
            document.recompute.features.insert(
                feature.id.clone(),
                FeatureRecomputeState::Clean {
                    evaluated_revision: document.revision,
                },
            );
            document.features.insert(feature.id.clone(), feature);
        }
        document.bodies.insert(
            body.clone(),
            crawler_document::Body {
                id: body.clone(),
                display_name: "Dependency Body".into(),
                component: component.clone(),
                generated_by: via_feature.clone(),
                producer_lineage: Vec::new(),
                visibility: crawler_document::ModelVisibility::Visible,
            },
        );
        let mut topology_reference = document
            .topology_references
            .values()
            .next()
            .unwrap()
            .clone();
        topology_reference.id = topology.clone();
        topology_reference.body = body;
        topology_reference.producer = via_body.clone();
        topology_reference.stable_kernel_id = 91;
        topology_reference.stable_token = "dependency-test:face".into();
        document
            .topology_references
            .insert(topology, topology_reference);
        (
            document,
            plane,
            parameter,
            sketch,
            BTreeSet::from([root, via_dependency, via_feature, via_body, via_topology]),
            unrelated,
        )
    }

    #[test]
    fn a_multi_change_commit_is_one_atomic_undo_entry() {
        let mut history = DocumentHistory::new(fixture());
        let initial_hash = history.accepted_hash();
        let event = history
            .commit(
                TransactionId::from("transaction:resize"),
                vec![
                    DocumentChange::SetParameterValue {
                        parameter: ParameterId::from("parameter:width"),
                        value: ParameterValue::LengthNanometers(50_000_000),
                    },
                    DocumentChange::SetParameterValue {
                        parameter: ParameterId::from("parameter:height"),
                        value: ParameterValue::LengthNanometers(50_000_000),
                    },
                ],
            )
            .unwrap();
        assert_eq!(event.base_revision, 1);
        assert_eq!(event.result_revision, 2);
        assert_ne!(event.accepted_hash, initial_hash);
        assert_eq!(history.undo().map(semantic_hash).unwrap(), initial_hash);
        assert_eq!(
            history.redo().map(semantic_hash).unwrap(),
            event.accepted_hash
        );
    }

    #[test]
    fn typed_feature_definition_commits_atomically_and_survives_without_journal_evidence() {
        let feature_id = FeatureId::from("feature:extrude");
        let definition = FeatureDefinitionV2::exact_blind_new_body_extrude(
            ProfileReferenceV2::SketchRegion {
                sketch: SketchId::from("sketch:rectangle"),
                region: RegionReferenceId::from("region:rectangle"),
            },
            PlanarSupportReferenceV2::OriginPlane {
                plane: crawler_document::OriginPlaneId::from("origin-plane:xy"),
            },
            ParameterId::from("parameter:distance"),
            BodyId::from("body:part"),
        );
        let mut history = DocumentHistory::new(exact_extrude_fixture());
        let region = RegionDefinitionV2 {
            id: RegionReferenceId::from("region:rectangle"),
            sketch: SketchId::from("sketch:rectangle"),
            outer_geometry_ids: vec![
                "line:bottom".into(),
                "line:right".into(),
                "line:top".into(),
                "line:left".into(),
            ],
            hole_geometry_ids: Vec::new(),
        };
        history
            .commit(
                TransactionId::from("transaction:adopt-feature-v2"),
                vec![
                    DocumentChange::UpsertRegionDefinitionV2 {
                        region: region.id.clone(),
                        definition: region.clone(),
                    },
                    DocumentChange::UpsertFeatureDefinitionV2 {
                        feature: feature_id.clone(),
                        definition: definition.clone(),
                    },
                ],
            )
            .unwrap();

        assert_eq!(
            history.accepted().feature_definitions_v2[&feature_id],
            definition
        );
        assert_eq!(
            history
                .accepted()
                .transactions
                .last()
                .unwrap()
                .changes
                .len(),
            2
        );
        assert_eq!(history.accepted().region_definitions_v2[&region.id], region);
        assert!(history.undo().unwrap().feature_definitions_v2.is_empty());
        assert!(history.accepted().region_definitions_v2.is_empty());
        assert_eq!(
            history.redo().unwrap().feature_definitions_v2[&feature_id],
            definition
        );

        let mut journal_free: Document =
            serde_json::from_str(&serde_json::to_string(history.accepted()).unwrap()).unwrap();
        journal_free.transactions.clear();
        assert_eq!(journal_free.feature_definitions_v2[&feature_id], definition);
        assert_eq!(journal_free.region_definitions_v2[&region.id], region);
    }

    #[test]
    fn invalid_region_update_rolls_back_the_entire_transaction() {
        let mut history = DocumentHistory::new(exact_extrude_fixture());
        let before = history.accepted_hash();
        let error = history
            .commit(
                TransactionId::from("transaction:invalid-region"),
                vec![DocumentChange::UpsertRegionDefinitionV2 {
                    region: RegionReferenceId::from("region:rectangle"),
                    definition: RegionDefinitionV2 {
                        id: RegionReferenceId::from("region:different"),
                        sketch: SketchId::from("sketch:rectangle"),
                        outer_geometry_ids: vec!["line:bottom".into()],
                        hole_geometry_ids: Vec::new(),
                    },
                }],
            )
            .unwrap_err();
        assert!(matches!(
            error,
            TransactionError::RegionIdentityMismatch { .. }
        ));
        assert_eq!(history.accepted_hash(), before);
        assert!(history.accepted().region_definitions_v2.is_empty());
        assert!(!history.can_undo());
    }

    #[test]
    fn deleting_the_last_region_consumer_cleans_up_its_definition() {
        let feature_id = FeatureId::from("feature:temporary-region-consumer");
        let region_id = RegionReferenceId::from("region:rectangle");
        let component = crawler_document::ComponentId::from("component:root");
        let mut history = DocumentHistory::new(exact_extrude_fixture());
        history
            .commit(
                TransactionId::from("transaction:create-region-consumer"),
                vec![
                    DocumentChange::CreateFeature {
                        feature: crawler_document::Feature {
                            id: feature_id.clone(),
                            display_name: "Temporary Extrude".into(),
                            component: component.clone(),
                            operation: crawler_document::OperationReference {
                                schema_id: "crawler.operation.extrude".into(),
                                schema_version: 2,
                            },
                            dependencies: Vec::new(),
                            inputs: BTreeMap::new(),
                            parameters: BTreeMap::new(),
                            suppressed: false,
                        },
                        before: None,
                    },
                    DocumentChange::UpsertRegionDefinitionV2 {
                        region: region_id.clone(),
                        definition: RegionDefinitionV2 {
                            id: region_id.clone(),
                            sketch: SketchId::from("sketch:rectangle"),
                            outer_geometry_ids: vec!["rectangle:profile".into()],
                            hole_geometry_ids: Vec::new(),
                        },
                    },
                    DocumentChange::UpsertFeatureDefinitionV2 {
                        feature: feature_id.clone(),
                        definition: FeatureDefinitionV2::exact_blind_new_body_extrude(
                            ProfileReferenceV2::SketchRegion {
                                sketch: SketchId::from("sketch:rectangle"),
                                region: region_id.clone(),
                            },
                            PlanarSupportReferenceV2::OriginPlane {
                                plane: crawler_document::OriginPlaneId::from("origin-plane:xy"),
                            },
                            ParameterId::from("parameter:distance"),
                            BodyId::from("body:part"),
                        ),
                    },
                ],
            )
            .unwrap();
        assert!(
            history
                .accepted()
                .region_definitions_v2
                .contains_key(&region_id)
        );

        history
            .commit(
                TransactionId::from("transaction:delete-region-consumer"),
                vec![DocumentChange::DeleteFeature {
                    component,
                    feature: feature_id,
                }],
            )
            .unwrap();
        assert!(
            !history
                .accepted()
                .region_definitions_v2
                .contains_key(&region_id)
        );
    }

    #[test]
    fn failed_transactions_preserve_the_accepted_hash_and_history() {
        let mut history = DocumentHistory::new(fixture());
        let initial_hash = history.accepted_hash();
        let error = history
            .commit(
                TransactionId::from("transaction:invalid"),
                vec![DocumentChange::SetParameterValue {
                    parameter: ParameterId::from("parameter:missing"),
                    value: ParameterValue::LengthNanometers(1),
                }],
            )
            .unwrap_err();
        assert!(matches!(error, TransactionError::MissingEntity(_)));
        assert_eq!(history.accepted_hash(), initial_hash);
        assert!(!history.can_undo());
    }

    #[test]
    fn a_new_commit_after_undo_discards_only_the_redo_branch() {
        let mut history = DocumentHistory::new(fixture());
        history
            .commit(
                TransactionId::from("transaction:first"),
                vec![DocumentChange::RenameEntity {
                    entity: EntityId::Document(history.accepted().id.clone()),
                    display_name: "First".into(),
                }],
            )
            .unwrap();
        history.undo().unwrap();
        assert!(history.can_redo());
        history
            .commit(
                TransactionId::from("transaction:branch"),
                vec![DocumentChange::RenameEntity {
                    entity: EntityId::Document(history.accepted().id.clone()),
                    display_name: "Branch".into(),
                }],
            )
            .unwrap();
        assert!(!history.can_redo());
        assert_eq!(history.accepted().display_name, "Branch");
    }

    #[test]
    fn explicit_sketch_support_rebind_updates_feature_and_owned_sketch_atomically() {
        let (document, feature_id, sketch_id, from_reference, replacement) =
            explicit_sketch_support_fixture();
        let replacement_id = replacement.id.clone();
        let mut history = DocumentHistory::new(document);

        let event = history
            .commit(
                TransactionId::from("transaction:rebind-sketch-support"),
                vec![DocumentChange::RebindTopology {
                    feature: feature_id.clone(),
                    input_name: "support".into(),
                    from_reference,
                    replacement,
                }],
            )
            .unwrap();

        assert_eq!(
            history.accepted().features[&feature_id].inputs["support"],
            FeatureInput::Topology(replacement_id.clone())
        );
        assert_eq!(
            history.accepted().sketches[&sketch_id].support,
            SketchSupport::Topology {
                reference: replacement_id
            }
        );
        assert!(
            event
                .affected_entities
                .contains(&EntityId::Feature(feature_id.clone()))
        );
        assert!(
            event
                .affected_entities
                .contains(&EntityId::Sketch(sketch_id))
        );
        assert!(!event.dirty_roots.contains(&feature_id));
        assert!(matches!(
            history.accepted().recompute.features.get(&feature_id),
            Some(FeatureRecomputeState::Clean { .. })
        ));
    }

    #[test]
    fn explicit_rebind_is_scoped_to_the_selected_owned_sketch_branch() {
        let (mut document, selected_sketch_feature, selected_sketch, from_reference, replacement) =
            explicit_sketch_support_fixture();
        let component = document.root_component.clone();
        let selected_consumer = FeatureId::from("feature:extrude");
        document
            .features
            .get_mut(&selected_consumer)
            .unwrap()
            .inputs
            .extend([
                (
                    "sketch".into(),
                    FeatureInput::Sketch(selected_sketch.clone()),
                ),
                (
                    "support".into(),
                    FeatureInput::Topology(from_reference.clone()),
                ),
            ]);

        let other_sketch = SketchId::from("sketch:other-branch");
        let mut other_sketch_record = document.sketches[&selected_sketch].clone();
        other_sketch_record.id = other_sketch.clone();
        other_sketch_record.display_name = "Other Branch".into();
        document
            .sketches
            .insert(other_sketch.clone(), other_sketch_record);
        document
            .components
            .get_mut(&component)
            .unwrap()
            .sketch_order
            .push(other_sketch.clone());

        let other_sketch_feature = FeatureId::from("feature:sketch-other-branch");
        let mut other_sketch_feature_record = document.features[&selected_sketch_feature].clone();
        other_sketch_feature_record.id = other_sketch_feature.clone();
        other_sketch_feature_record.display_name = "Other Sketch".into();
        other_sketch_feature_record
            .inputs
            .insert("sketch".into(), FeatureInput::Sketch(other_sketch.clone()));
        document
            .features
            .insert(other_sketch_feature.clone(), other_sketch_feature_record);

        let other_consumer = FeatureId::from("feature:extrude-other-branch");
        let mut other_consumer_record = document.features[&selected_consumer].clone();
        other_consumer_record.id = other_consumer.clone();
        other_consumer_record.display_name = "Other Extrude".into();
        other_consumer_record.dependencies = vec![other_sketch_feature.clone()];
        other_consumer_record
            .inputs
            .retain(|_, input| !matches!(input, FeatureInput::Sketch(_)));
        other_consumer_record
            .inputs
            .insert("sketch".into(), FeatureInput::Sketch(other_sketch.clone()));
        document
            .features
            .insert(other_consumer.clone(), other_consumer_record);
        document
            .components
            .get_mut(&component)
            .unwrap()
            .feature_order
            .extend([other_sketch_feature.clone(), other_consumer.clone()]);
        document.recompute.features.insert(
            other_sketch_feature,
            FeatureRecomputeState::Clean {
                evaluated_revision: document.revision,
            },
        );
        document.recompute.features.insert(
            other_consumer.clone(),
            FeatureRecomputeState::Clean {
                evaluated_revision: document.revision,
            },
        );

        let selected_region = RegionReferenceId::from("region:selected-branch");
        let other_region = RegionReferenceId::from("region:other-branch");
        for (region, sketch) in [
            (selected_region.clone(), selected_sketch.clone()),
            (other_region.clone(), other_sketch.clone()),
        ] {
            document.region_definitions_v2.insert(
                region.clone(),
                RegionDefinitionV2 {
                    id: region,
                    sketch,
                    outer_geometry_ids: vec!["point:origin".into()],
                    hole_geometry_ids: Vec::new(),
                },
            );
        }
        let definition = |sketch, region| {
            FeatureDefinitionV2::exact_blind_new_body_extrude(
                ProfileReferenceV2::SketchRegion { sketch, region },
                PlanarSupportReferenceV2::TopologyFace {
                    reference: from_reference.clone(),
                },
                ParameterId::from("parameter:height"),
                BodyId::from("body:block"),
            )
        };
        document.feature_definitions_v2.insert(
            selected_consumer.clone(),
            definition(selected_sketch.clone(), selected_region),
        );
        document.feature_definitions_v2.insert(
            other_consumer.clone(),
            definition(other_sketch.clone(), other_region),
        );

        let replacement_id = replacement.id.clone();
        let mut history = DocumentHistory::new(document);
        history
            .commit(
                TransactionId::from("transaction:branch-scoped-rebind"),
                vec![DocumentChange::RebindTopology {
                    feature: selected_sketch_feature,
                    input_name: "support".into(),
                    from_reference: from_reference.clone(),
                    replacement,
                }],
            )
            .unwrap();
        let accepted = history.accepted();
        assert_eq!(
            accepted.sketches[&selected_sketch].support,
            SketchSupport::Topology {
                reference: replacement_id.clone()
            }
        );
        assert_eq!(
            accepted.features[&selected_consumer].inputs["support"],
            FeatureInput::Topology(replacement_id.clone())
        );
        assert!(matches!(
            &accepted.feature_definitions_v2[&selected_consumer].operation,
            FeatureOperationV2::Extrude {
                support: PlanarSupportReferenceV2::TopologyFace { reference },
                ..
            } if reference == &replacement_id
        ));
        assert_eq!(
            accepted.sketches[&other_sketch].support,
            SketchSupport::Topology {
                reference: from_reference.clone()
            }
        );
        assert_eq!(
            accepted.features[&other_consumer].inputs["support"],
            FeatureInput::Topology(from_reference.clone())
        );
        assert!(matches!(
            &accepted.feature_definitions_v2[&other_consumer].operation,
            FeatureOperationV2::Extrude {
                support: PlanarSupportReferenceV2::TopologyFace { reference },
                ..
            } if reference == &from_reference
        ));
    }

    #[test]
    fn unrelated_topology_rebind_does_not_mutate_owned_sketch_support() {
        let (mut document, feature_id, sketch_id, from_reference, replacement) =
            explicit_sketch_support_fixture();
        let feature = document.features.get_mut(&feature_id).unwrap();
        feature.inputs.insert(
            "reference".into(),
            FeatureInput::Topology(from_reference.clone()),
        );
        let original_support = document.sketches[&sketch_id].support.clone();
        let mut history = DocumentHistory::new(document);

        let event = history
            .commit(
                TransactionId::from("transaction:rebind-unrelated-input"),
                vec![DocumentChange::RebindTopology {
                    feature: feature_id,
                    input_name: "reference".into(),
                    from_reference,
                    replacement,
                }],
            )
            .unwrap();

        assert_eq!(
            history.accepted().sketches[&sketch_id].support,
            original_support
        );
        assert!(
            !event
                .affected_entities
                .contains(&EntityId::Sketch(sketch_id))
        );
    }

    #[test]
    fn support_rebind_without_explicit_sketch_input_updates_only_the_feature() {
        let (mut document, feature_id, sketch_id, from_reference, replacement) =
            explicit_sketch_support_fixture();
        document
            .features
            .get_mut(&feature_id)
            .unwrap()
            .inputs
            .remove("sketch");
        let replacement_id = replacement.id.clone();
        let original_sketch = document.sketches[&sketch_id].clone();
        let mut history = DocumentHistory::new(document);

        let event = history
            .commit(
                TransactionId::from("transaction:rebind-feature-only-support"),
                vec![DocumentChange::RebindTopology {
                    feature: feature_id.clone(),
                    input_name: "support".into(),
                    from_reference,
                    replacement,
                }],
            )
            .unwrap();

        assert_eq!(
            history.accepted().features[&feature_id].inputs["support"],
            FeatureInput::Topology(replacement_id)
        );
        assert_eq!(history.accepted().sketches[&sketch_id], original_sketch);
        assert!(
            !event
                .affected_entities
                .contains(&EntityId::Sketch(sketch_id))
        );
    }

    #[test]
    fn mismatched_explicit_sketch_support_rebind_fails_atomically() {
        let (mut document, feature_id, sketch_id, from_reference, replacement) =
            explicit_sketch_support_fixture();
        document.sketches.get_mut(&sketch_id).unwrap().support = SketchSupport::OriginPlane {
            plane: crawler_document::OriginPlane::Xy,
        };
        let mut history = DocumentHistory::new(document);
        let initial_hash = history.accepted_hash();
        let original_feature = history.accepted().features[&feature_id].clone();
        let original_sketch = history.accepted().sketches[&sketch_id].clone();

        let error = history
            .commit(
                TransactionId::from("transaction:mismatched-owned-sketch-support"),
                vec![
                    DocumentChange::RenameEntity {
                        entity: EntityId::Document(history.accepted().id.clone()),
                        display_name: "Must Roll Back".into(),
                    },
                    DocumentChange::RebindTopology {
                        feature: feature_id.clone(),
                        input_name: "support".into(),
                        from_reference,
                        replacement,
                    },
                ],
            )
            .unwrap_err();

        assert_eq!(error, TransactionError::InvalidTopologyTarget);
        assert_eq!(history.accepted_hash(), initial_hash);
        assert_eq!(history.accepted().features[&feature_id], original_feature);
        assert_eq!(history.accepted().sketches[&sketch_id], original_sketch);
        assert!(!history.can_undo());
    }

    #[test]
    fn failed_explicit_sketch_support_rebind_preserves_all_accepted_state() {
        let (document, feature_id, sketch_id, from_reference, mut replacement) =
            explicit_sketch_support_fixture();
        replacement.producer = FeatureId::from("feature:missing");
        let mut history = DocumentHistory::new(document);
        let initial_hash = history.accepted_hash();
        let original_feature = history.accepted().features[&feature_id].clone();
        let original_sketch = history.accepted().sketches[&sketch_id].clone();

        let error = history
            .commit(
                TransactionId::from("transaction:failed-sketch-rebind"),
                vec![
                    DocumentChange::RenameEntity {
                        entity: EntityId::Document(history.accepted().id.clone()),
                        display_name: "Must Roll Back".into(),
                    },
                    DocumentChange::RebindTopology {
                        feature: feature_id.clone(),
                        input_name: "support".into(),
                        from_reference,
                        replacement,
                    },
                ],
            )
            .unwrap_err();

        assert_eq!(error, TransactionError::InvalidTopologyTarget);
        assert_eq!(history.accepted_hash(), initial_hash);
        assert_eq!(history.accepted().features[&feature_id], original_feature);
        assert_eq!(history.accepted().sketches[&sketch_id], original_sketch);
        assert!(!history.can_undo());
    }

    #[test]
    fn construction_plane_parameter_and_definition_edits_propagate_every_dependency_channel() {
        let (document, plane, parameter, sketch, expected_dirty, unrelated) =
            construction_plane_dependency_fixture();
        let mut parameter_history = DocumentHistory::new(document.clone());
        let parameter_event = parameter_history
            .commit(
                TransactionId::from("transaction:edit-plane-parameter-dependencies"),
                vec![DocumentChange::SetParameterValue {
                    parameter: parameter.clone(),
                    value: ParameterValue::LengthNanometers(9_000_000),
                }],
            )
            .unwrap();
        assert_eq!(
            parameter_event
                .affected_entities
                .iter()
                .filter(|entity| **entity == EntityId::Sketch(sketch.clone()))
                .count(),
            1
        );
        assert_eq!(
            parameter_event
                .dirty_roots
                .iter()
                .cloned()
                .collect::<BTreeSet<_>>(),
            expected_dirty
        );
        assert!(matches!(
            parameter_history.accepted().recompute.features[&unrelated],
            FeatureRecomputeState::Clean { .. }
        ));

        let mut edited_definition = document.construction_planes[&plane].clone();
        edited_definition.suppressed = true;
        let mut plane_history = DocumentHistory::new(document);
        let plane_event = plane_history
            .commit(
                TransactionId::from("transaction:edit-plane-definition-dependencies"),
                vec![DocumentChange::UpsertConstructionPlaneDefinitionV1 {
                    plane,
                    definition: edited_definition,
                }],
            )
            .unwrap();
        assert!(
            plane_event
                .affected_entities
                .contains(&EntityId::Sketch(sketch))
        );
        assert_eq!(
            plane_event
                .dirty_roots
                .iter()
                .cloned()
                .collect::<BTreeSet<_>>(),
            expected_dirty
        );
        assert!(matches!(
            plane_history.accepted().recompute.features[&unrelated],
            FeatureRecomputeState::Clean { .. }
        ));
    }

    #[test]
    fn cut_acceptance_retains_exact_producer_lineage_and_topology_ownership() {
        let (document, cut, body_id, topology_id) = cut_history_fixture();
        let original_producer = document.bodies[&body_id].generated_by.clone();
        let mut history = DocumentHistory::new(document);
        history
            .commit(
                TransactionId::from("transaction:accept-cut"),
                vec![DocumentChange::AcceptFeatureResult {
                    feature: cut.clone(),
                    body: body_id.clone(),
                    request_json: "{\"mode\":\"cut\"}".into(),
                    result_json: "{\"status\":\"accepted\"}".into(),
                }],
            )
            .unwrap();

        let accepted = history.accepted();
        let body = &accepted.bodies[&body_id];
        assert_eq!(body.generated_by, cut);
        assert_eq!(body.producer_lineage.as_slice(), std::slice::from_ref(&original_producer));
        assert!(body.accepts_producer(&original_producer));
        assert_eq!(
            accepted.topology_references[&topology_id].producer,
            original_producer
        );
        let json = serde_json::to_string(accepted).unwrap();
        assert!(json.contains(r#""producer_lineage":["feature:extrude"]"#));
        let reopened = serde_json::from_str::<Document>(&json).unwrap();
        assert_eq!(reopened, *accepted);
        validate_document(&reopened).unwrap();

        let mut wrong = accepted.topology_references[&topology_id].clone();
        wrong.id = TopologyReferenceId::from("topology:wrong-producer");
        wrong.producer = FeatureId::from("feature:rectangle-sketch");
        assert_eq!(
            history
                .commit(
                    TransactionId::from("transaction:wrong-producer"),
                    vec![DocumentChange::UpsertTopologyReference { reference: wrong }],
                )
                .unwrap_err(),
            TransactionError::InvalidTopologyTarget
        );
    }

    #[test]
    fn face_supported_cut_rejects_wrong_target_owner_and_unaccepted_producer() {
        let (document, cut, target, topology_id) = cut_history_fixture();

        let mut wrong_owner = document.clone();
        let other_id = BodyId::from("body:other");
        let mut other = wrong_owner.bodies[&target].clone();
        other.id = other_id.clone();
        wrong_owner.bodies.insert(other_id.clone(), other);
        wrong_owner
            .topology_references
            .get_mut(&topology_id)
            .unwrap()
            .body = other_id;
        assert_eq!(
            validate_document(&wrong_owner).unwrap_err(),
            TransactionError::InvalidFeatureDefinition(cut.0.clone())
        );

        let mut wrong_producer = document;
        wrong_producer
            .topology_references
            .get_mut(&topology_id)
            .unwrap()
            .producer = FeatureId::from("feature:rectangle-sketch");
        assert_eq!(
            validate_document(&wrong_producer).unwrap_err(),
            TransactionError::InvalidFeatureDefinition(cut.0)
        );
    }
}
