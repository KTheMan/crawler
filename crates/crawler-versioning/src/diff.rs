use crate::VersionedDocument;
use crawler_document::{
    BodyId, ComponentId, FeatureId, OriginPlaneId, ParameterId, SketchId, TopologyReferenceId,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::{self, Display, Formatter};

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SemanticAddress {
    pub entity_kind: String,
    pub semantic_id: String,
}

impl SemanticAddress {
    fn new(entity_kind: &str, semantic_id: impl Into<String>) -> Self {
        Self {
            entity_kind: entity_kind.into(),
            semantic_id: semantic_id.into(),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ChangeKind {
    Added,
    Removed,
    Renamed,
    ParameterChanged,
    FeatureEdited,
    ReferenceChanged,
    GeometryPayloadChanged,
    ProvenanceChanged,
    RequiredFeaturesChanged,
    EntityEdited,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct StructuralChange {
    pub address: SemanticAddress,
    pub kind: ChangeKind,
    pub field: Option<String>,
    pub before: Value,
    pub after: Value,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct StructuralDiff {
    pub changes: Vec<StructuralChange>,
}

impl StructuralDiff {
    pub fn is_empty(&self) -> bool {
        self.changes.is_empty()
    }
}

impl Display for StructuralDiff {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        if self.changes.is_empty() {
            return formatter.write_str("No semantic changes.");
        }
        for (index, change) in self.changes.iter().enumerate() {
            if index > 0 {
                formatter.write_str("\n")?;
            }
            write!(
                formatter,
                "{:?} {} {}",
                change.kind, change.address.entity_kind, change.address.semantic_id
            )?;
            if let Some(field) = &change.field {
                write!(formatter, " ({field})")?;
            }
            match change.kind {
                ChangeKind::Renamed | ChangeKind::ParameterChanged => {
                    write!(formatter, ": {} -> {}", change.before, change.after)?;
                }
                ChangeKind::GeometryPayloadChanged => {
                    write!(
                        formatter,
                        ": content {} -> {}",
                        display_hash(&change.before),
                        display_hash(&change.after)
                    )?;
                }
                _ => {}
            }
        }
        Ok(())
    }
}

pub fn structural_diff(base: &VersionedDocument, target: &VersionedDocument) -> StructuralDiff {
    let mut changes = Vec::new();
    if base.document.display_name != target.document.display_name {
        changes.push(change(
            "document",
            base.document.id.0.clone(),
            ChangeKind::Renamed,
            Some("display_name"),
            &base.document.display_name,
            &target.document.display_name,
        ));
    }
    if base.required_features != target.required_features {
        changes.push(change(
            "document",
            base.document.id.0.clone(),
            ChangeKind::RequiredFeaturesChanged,
            Some("required_features"),
            &base.required_features,
            &target.required_features,
        ));
    }

    diff_map(
        "origin_plane",
        &base.document.origin_planes,
        &target.document.origin_planes,
        &mut changes,
        |_, before, after, changes| {
            if before != after {
                changes.push(entity_edit("origin_plane", before, after));
            }
        },
    );
    diff_map(
        "component",
        &base.document.components,
        &target.document.components,
        &mut changes,
        |id, before, after, changes| {
            diff_named_entity("component", id, before, after, changes);
        },
    );
    diff_map(
        "body",
        &base.document.bodies,
        &target.document.bodies,
        &mut changes,
        |id, before, after, changes| {
            diff_named_entity("body", id, before, after, changes);
        },
    );
    diff_map(
        "sketch",
        &base.document.sketches,
        &target.document.sketches,
        &mut changes,
        |id, before, after, changes| {
            diff_named_entity("sketch", id, before, after, changes);
        },
    );
    diff_map(
        "feature",
        &base.document.features,
        &target.document.features,
        &mut changes,
        diff_feature,
    );
    diff_map(
        "parameter",
        &base.document.parameters,
        &target.document.parameters,
        &mut changes,
        diff_parameter,
    );
    diff_map(
        "topology_reference",
        &base.document.topology_references,
        &target.document.topology_references,
        &mut changes,
        |id, before, after, changes| {
            if before != after {
                changes.push(change(
                    "topology_reference",
                    id,
                    ChangeKind::ReferenceChanged,
                    None,
                    before,
                    after,
                ));
            }
        },
    );
    diff_sidecar(
        "geometry_payload",
        ChangeKind::GeometryPayloadChanged,
        &base.geometry_payloads,
        &target.geometry_payloads,
        &mut changes,
    );
    diff_sidecar(
        "provenance",
        ChangeKind::ProvenanceChanged,
        &base.provenance,
        &target.provenance,
        &mut changes,
    );

    changes.sort_by(|left, right| {
        (
            &left.address.entity_kind,
            &left.address.semantic_id,
            left.kind,
            &left.field,
        )
            .cmp(&(
                &right.address.entity_kind,
                &right.address.semantic_id,
                right.kind,
                &right.field,
            ))
    });
    StructuralDiff { changes }
}

fn diff_map<K, V, F>(
    kind: &str,
    base: &BTreeMap<K, V>,
    target: &BTreeMap<K, V>,
    changes: &mut Vec<StructuralChange>,
    mut compare: F,
) where
    K: Ord + SemanticKey,
    V: PartialEq + Serialize,
    F: FnMut(String, &V, &V, &mut Vec<StructuralChange>),
{
    let ids: BTreeSet<_> = base.keys().chain(target.keys()).collect();
    for id in ids {
        match (base.get(id), target.get(id)) {
            (None, Some(after)) => changes.push(change(
                kind,
                id.semantic_key(),
                ChangeKind::Added,
                None,
                &Value::Null,
                after,
            )),
            (Some(before), None) => changes.push(change(
                kind,
                id.semantic_key(),
                ChangeKind::Removed,
                None,
                before,
                &Value::Null,
            )),
            (Some(before), Some(after)) => {
                compare(id.semantic_key(), before, after, changes);
            }
            (None, None) => unreachable!(),
        }
    }
}

fn diff_named_entity<V: Serialize>(
    kind: &str,
    id: String,
    before: &V,
    after: &V,
    changes: &mut Vec<StructuralChange>,
) {
    let before = serde_json::to_value(before).expect("entity serializes");
    let after = serde_json::to_value(after).expect("entity serializes");
    if before == after {
        return;
    }
    if before["display_name"] != after["display_name"] {
        changes.push(StructuralChange {
            address: SemanticAddress::new(kind, id.clone()),
            kind: ChangeKind::Renamed,
            field: Some("display_name".into()),
            before: before["display_name"].clone(),
            after: after["display_name"].clone(),
        });
    }
    if without_fields(&before, &["display_name"]) != without_fields(&after, &["display_name"]) {
        changes.push(StructuralChange {
            address: SemanticAddress::new(kind, id),
            kind: ChangeKind::EntityEdited,
            field: None,
            before,
            after,
        });
    }
}

fn diff_parameter<V: Serialize + PartialEq>(
    id: String,
    before: &V,
    after: &V,
    changes: &mut Vec<StructuralChange>,
) {
    let before = serde_json::to_value(before).expect("parameter serializes");
    let after = serde_json::to_value(after).expect("parameter serializes");
    if before["display_name"] != after["display_name"] {
        changes.push(StructuralChange {
            address: SemanticAddress::new("parameter", id.clone()),
            kind: ChangeKind::Renamed,
            field: Some("display_name".into()),
            before: before["display_name"].clone(),
            after: after["display_name"].clone(),
        });
    }
    if before["value"] != after["value"] {
        changes.push(StructuralChange {
            address: SemanticAddress::new("parameter", id),
            kind: ChangeKind::ParameterChanged,
            field: Some("value".into()),
            before: before["value"].clone(),
            after: after["value"].clone(),
        });
    }
}

fn diff_feature<V: Serialize + PartialEq>(
    id: String,
    before: &V,
    after: &V,
    changes: &mut Vec<StructuralChange>,
) {
    let before = serde_json::to_value(before).expect("feature serializes");
    let after = serde_json::to_value(after).expect("feature serializes");
    if before["display_name"] != after["display_name"] {
        changes.push(StructuralChange {
            address: SemanticAddress::new("feature", id.clone()),
            kind: ChangeKind::Renamed,
            field: Some("display_name".into()),
            before: before["display_name"].clone(),
            after: after["display_name"].clone(),
        });
    }
    if before["inputs"] != after["inputs"] {
        changes.push(StructuralChange {
            address: SemanticAddress::new("feature", id.clone()),
            kind: ChangeKind::ReferenceChanged,
            field: Some("inputs".into()),
            before: before["inputs"].clone(),
            after: after["inputs"].clone(),
        });
    }
    if without_fields(&before, &["display_name", "inputs"])
        != without_fields(&after, &["display_name", "inputs"])
    {
        changes.push(StructuralChange {
            address: SemanticAddress::new("feature", id),
            kind: ChangeKind::FeatureEdited,
            field: None,
            before,
            after,
        });
    }
}

fn diff_sidecar<V: PartialEq + Serialize>(
    kind: &str,
    change_kind: ChangeKind,
    base: &BTreeMap<String, V>,
    target: &BTreeMap<String, V>,
    changes: &mut Vec<StructuralChange>,
) {
    diff_map(kind, base, target, changes, |id, before, after, changes| {
        if before != after {
            changes.push(change(
                kind,
                id,
                change_kind,
                Some("content_hash"),
                before,
                after,
            ));
        }
    });
}

fn entity_edit<V: Serialize>(kind: &str, before: &V, after: &V) -> StructuralChange {
    let before_value = serde_json::to_value(before).expect("entity serializes");
    let id = before_value["id"].as_str().unwrap_or("unknown").to_owned();
    change(kind, id, ChangeKind::EntityEdited, None, before, after)
}

fn change<B: Serialize, A: Serialize>(
    kind: &str,
    id: impl Into<String>,
    change_kind: ChangeKind,
    field: Option<&str>,
    before: &B,
    after: &A,
) -> StructuralChange {
    StructuralChange {
        address: SemanticAddress::new(kind, id),
        kind: change_kind,
        field: field.map(str::to_owned),
        before: serde_json::to_value(before).expect("diff value serializes"),
        after: serde_json::to_value(after).expect("diff value serializes"),
    }
}

fn without_fields(value: &Value, fields: &[&str]) -> Value {
    let mut value = value.clone();
    if let Value::Object(object) = &mut value {
        for field in fields {
            object.remove(*field);
        }
    }
    value
}

fn display_hash(value: &Value) -> &str {
    value["content_hash"].as_str().unwrap_or("none")
}

trait SemanticKey {
    fn semantic_key(&self) -> String;
}

macro_rules! stable_key {
    ($($id:ty),+ $(,)?) => {
        $(
            impl SemanticKey for $id {
                fn semantic_key(&self) -> String {
                    self.0.clone()
                }
            }
        )+
    };
}

stable_key!(
    OriginPlaneId,
    ComponentId,
    BodyId,
    SketchId,
    FeatureId,
    ParameterId,
    TopologyReferenceId,
);

impl SemanticKey for String {
    fn semantic_key(&self) -> String {
        self.clone()
    }
}
