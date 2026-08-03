//! Atomic accepted-document transactions with independent undo and redo history.

use crawler_document::{
    Document, DocumentChange, DocumentTransaction, EntityId, FeatureId, FeatureInput,
    FeatureRecomputeState, ParameterExpression, ParameterId, TransactionId,
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
                .find(|body| &body.generated_by == feature)
            {
                return Err(TransactionError::FeatureInUse {
                    feature: feature.0.clone(),
                    blocker: body.id.0.clone(),
                });
            }
            document.features.remove(feature);
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
        }
        DocumentChange::RebindTopology {
            feature,
            input_name,
            from_reference,
            replacement,
        } => {
            if !document.topology_references.contains_key(from_reference) {
                return Err(TransactionError::MissingEntity(from_reference.0.clone()));
            }
            if !document.bodies.contains_key(&replacement.body)
                || !document.features.contains_key(&replacement.producer)
            {
                return Err(TransactionError::InvalidTopologyTarget);
            }
            document
                .topology_references
                .insert(replacement.id.clone(), replacement.clone());
            let target = document
                .features
                .get_mut(feature)
                .ok_or_else(|| TransactionError::MissingEntity(feature.0.clone()))?;
            match target.inputs.get(input_name) {
                Some(FeatureInput::Topology(current)) if current == from_reference => {}
                _ => return Err(TransactionError::InvalidTopologyTarget),
            }
            target.inputs.insert(
                input_name.clone(),
                FeatureInput::Topology(replacement.id.clone()),
            );
            affected.push(EntityId::Feature(feature.clone()));
            dirty.insert(feature.clone());
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
            if let Some(stored) = document.bodies.get_mut(body) {
                stored.generated_by = feature.clone();
            } else {
                document.bodies.insert(
                    body.clone(),
                    crawler_document::Body {
                        id: body.clone(),
                        display_name: body.0.clone(),
                        component: component.clone(),
                        generated_by: feature.clone(),
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
    use crawler_document::{DocumentChange, ParameterId, ParameterValue};

    fn fixture() -> Document {
        serde_json::from_str(include_str!(
            "../../crawler-document/tests/fixtures/parametric-block.json"
        ))
        .unwrap()
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
}
