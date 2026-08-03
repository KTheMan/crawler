//! Versioned operation definitions shared by Crawler inspectors and workers.
//!
//! Schemas are declarative data. They contain no executable user code and are
//! validated before an invocation can cross the kernel-worker boundary.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

mod catalog;

pub use catalog::{alpha_capabilities, alpha_operation_catalog};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SchemaVersion(u32);

impl SchemaVersion {
    pub const V1: Self = Self(1);

    pub const fn get(self) -> u32 {
        self.0
    }
}

impl Serialize for SchemaVersion {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_u32(self.0)
    }
}

impl<'de> Deserialize<'de> for SchemaVersion {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let version = u32::deserialize(deserializer)?;
        match version {
            1 => Ok(Self::V1),
            unsupported => Err(serde::de::Error::custom(format!(
                "unsupported crawler operation schema version {unsupported}; supported version is 1"
            ))),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct OperationSchema {
    pub schema_version: SchemaVersion,
    pub id: String,
    pub label: String,
    pub group: OperationGroup,
    pub output_kind: OutputKind,
    pub input_slots: Vec<InputSlotSchema>,
    pub parameters: Vec<ParameterSchema>,
    pub preview: PreviewSchema,
    #[serde(default)]
    pub lifecycle: LifecycleSchema,
    #[serde(default)]
    pub enablement: EnablementSchema,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct OperationCatalog {
    pub catalog_version: CatalogVersion,
    pub capabilities: Vec<CapabilitySchema>,
    pub operations: Vec<OperationSchema>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CatalogVersion(u32);

impl CatalogVersion {
    pub const V1: Self = Self(1);

    pub const fn get(self) -> u32 {
        self.0
    }
}

impl Serialize for CatalogVersion {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_u32(self.0)
    }
}

impl<'de> Deserialize<'de> for CatalogVersion {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let version = u32::deserialize(deserializer)?;
        match version {
            1 => Ok(Self::V1),
            unsupported => Err(serde::de::Error::custom(format!(
                "unsupported crawler operation catalog version {unsupported}; supported version is 1"
            ))),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CapabilitySchema {
    pub id: String,
    pub state: CapabilityState,
    pub reason: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityState {
    Qualified,
    Unavailable,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct LifecycleSchema {
    pub stage: LifecycleStage,
    pub supports_preview: bool,
    pub supports_edit: bool,
    pub supports_suppression: bool,
}

impl Default for LifecycleSchema {
    fn default() -> Self {
        Self {
            stage: LifecycleStage::Alpha,
            supports_preview: true,
            supports_edit: true,
            supports_suppression: true,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LifecycleStage {
    #[default]
    Alpha,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct EnablementSchema {
    pub state: EnablementState,
    pub capability: String,
    pub reason: Option<String>,
}

impl Default for EnablementSchema {
    fn default() -> Self {
        Self {
            state: EnablementState::Enabled,
            capability: "legacy.contract".to_owned(),
            reason: None,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EnablementState {
    #[default]
    Enabled,
    Disabled,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OperationGroup {
    Sketch,
    PartDesign,
    Transform,
    ImportExport,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OutputKind {
    Sketch,
    Body,
    Bodies,
    Transform,
    File,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct InputSlotSchema {
    pub key: String,
    pub label: String,
    pub allowed_kinds: Vec<SelectionKind>,
    pub minimum_count: u32,
    pub maximum_count: Option<u32>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SelectionKind {
    SketchEntity,
    SketchCurve,
    SketchPoint,
    SketchProfile,
    Body,
    Feature,
    Vertex,
    Edge,
    Face,
    Plane,
    Axis,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ParameterSchema {
    pub key: String,
    pub label: String,
    pub value_kind: ParameterValueKind,
    pub default: ParameterValue,
    pub bounds: Option<ParameterBounds>,
    #[serde(default)]
    pub choices: Vec<String>,
    pub advanced_group: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ParameterValueKind {
    LengthNanometers,
    AngleMicrodegrees,
    ScalarMillionths,
    Count,
    Boolean,
    Text,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum ParameterValue {
    LengthNanometers(i64),
    AngleMicrodegrees(i64),
    ScalarMillionths(i64),
    Count(u64),
    Boolean(bool),
    Text(String),
}

impl ParameterValue {
    fn kind(&self) -> ParameterValueKind {
        match self {
            Self::LengthNanometers(_) => ParameterValueKind::LengthNanometers,
            Self::AngleMicrodegrees(_) => ParameterValueKind::AngleMicrodegrees,
            Self::ScalarMillionths(_) => ParameterValueKind::ScalarMillionths,
            Self::Count(_) => ParameterValueKind::Count,
            Self::Boolean(_) => ParameterValueKind::Boolean,
            Self::Text(_) => ParameterValueKind::Text,
        }
    }

    fn integer_value(&self) -> Option<i128> {
        match self {
            Self::LengthNanometers(value)
            | Self::AngleMicrodegrees(value)
            | Self::ScalarMillionths(value) => Some(i128::from(*value)),
            Self::Count(value) => Some(i128::from(*value)),
            Self::Boolean(_) | Self::Text(_) => None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ParameterBounds {
    pub minimum: Option<i64>,
    pub maximum: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PreviewSchema {
    pub strategy: PreviewStrategy,
    pub debounce_milliseconds: u32,
    pub cancellation: CancellationBehavior,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PreviewStrategy {
    None,
    Immediate,
    Debounced,
    Explicit,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CancellationBehavior {
    NotCancellable,
    Cooperative,
    ReplaceOlderPreview,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct OperationInvocation {
    pub operation_id: String,
    pub schema_id: String,
    pub schema_version: u32,
    pub inputs: BTreeMap<String, Vec<InputSelection>>,
    pub parameters: BTreeMap<String, ParameterValue>,
    pub preview_generation: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct InputSelection {
    pub kind: SelectionKind,
    pub entity_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct OperationWorkerCommand {
    pub operation_id: String,
    pub schema_id: String,
    pub schema_version: u32,
    pub inputs: BTreeMap<String, Vec<InputSelection>>,
    pub parameters: BTreeMap<String, ParameterValue>,
    pub preview_generation: u64,
    pub cancellation: CancellationBehavior,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct OperationError {
    pub code: ErrorCode,
    pub operation: OperationContext,
    pub location: ErrorLocation,
    pub recoverability: Recoverability,
    pub message: String,
    pub user_actions: Vec<UserAction>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    OperationDisabled,
    IncompatibleSchema,
    MissingInput,
    InvalidInputCount,
    InvalidInputKind,
    UnknownInput,
    MissingParameter,
    InvalidParameterType,
    ParameterOutOfBounds,
    InvalidChoice,
    UnknownParameter,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct OperationContext {
    pub schema_id: String,
    pub operation_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ErrorLocation {
    Operation,
    Input { key: String },
    Parameter { key: String },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Recoverability {
    RetryAfterEdit,
    ReselectInput,
    UpgradeRequired,
    NotRecoverable,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UserAction {
    pub kind: UserActionKind,
    pub label: String,
    pub target: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UserActionKind {
    FocusInput,
    FocusParameter,
    UpgradeDocument,
    Retry,
    ViewCapability,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SchemaDefinitionError {
    pub path: String,
    pub message: String,
}

impl OperationSchema {
    /// Validate an invocation and produce the exact payload sent to a worker.
    pub fn worker_command(
        &self,
        invocation: OperationInvocation,
    ) -> Result<OperationWorkerCommand, Vec<OperationError>> {
        let errors = self.validate(&invocation);
        if !errors.is_empty() {
            return Err(errors);
        }

        Ok(OperationWorkerCommand {
            operation_id: invocation.operation_id,
            schema_id: invocation.schema_id,
            schema_version: invocation.schema_version,
            inputs: invocation.inputs,
            parameters: invocation.parameters,
            preview_generation: invocation.preview_generation,
            cancellation: self.preview.cancellation,
        })
    }

    pub fn validate(&self, invocation: &OperationInvocation) -> Vec<OperationError> {
        let mut errors = Vec::new();
        if invocation.schema_id != self.id || invocation.schema_version != self.schema_version.get()
        {
            errors.push(self.error(
                invocation,
                ErrorCode::IncompatibleSchema,
                ErrorLocation::Operation,
                Recoverability::UpgradeRequired,
                "operation invocation targets an unsupported schema",
                UserActionKind::UpgradeDocument,
                "Use a supported operation version",
                &invocation.schema_id,
            ));
            return errors;
        }

        if self.enablement.state == EnablementState::Disabled {
            errors.push(
                self.error(
                    invocation,
                    ErrorCode::OperationDisabled,
                    ErrorLocation::Operation,
                    Recoverability::NotRecoverable,
                    self.enablement
                        .reason
                        .as_deref()
                        .unwrap_or("operation is not enabled"),
                    UserActionKind::ViewCapability,
                    "Review operation availability",
                    &self.enablement.capability,
                ),
            );
            return errors;
        }

        for key in invocation.inputs.keys() {
            if !self.input_slots.iter().any(|slot| slot.key == *key) {
                errors.push(self.error(
                    invocation,
                    ErrorCode::UnknownInput,
                    ErrorLocation::Input { key: key.clone() },
                    Recoverability::ReselectInput,
                    "operation invocation contains an unknown input",
                    UserActionKind::FocusInput,
                    "Remove unknown input",
                    key,
                ));
            }
        }

        for slot in &self.input_slots {
            let values = invocation
                .inputs
                .get(&slot.key)
                .map(Vec::as_slice)
                .unwrap_or(&[]);
            if values.len() < slot.minimum_count as usize {
                errors.push(self.error(
                    invocation,
                    ErrorCode::MissingInput,
                    ErrorLocation::Input {
                        key: slot.key.clone(),
                    },
                    Recoverability::ReselectInput,
                    &format!(
                        "{} requires at least {} selection(s)",
                        slot.label, slot.minimum_count
                    ),
                    UserActionKind::FocusInput,
                    &format!("Select {}", slot.label),
                    &slot.key,
                ));
                continue;
            }
            if let Some(maximum) = slot.maximum_count
                && values.len() > maximum as usize
            {
                errors.push(self.error(
                    invocation,
                    ErrorCode::InvalidInputCount,
                    ErrorLocation::Input {
                        key: slot.key.clone(),
                    },
                    Recoverability::ReselectInput,
                    &format!("{} accepts no more than {maximum} selection(s)", slot.label),
                    UserActionKind::FocusInput,
                    &format!("Reselect {}", slot.label),
                    &slot.key,
                ));
            }
            if values
                .iter()
                .any(|value| !slot.allowed_kinds.contains(&value.kind))
            {
                errors.push(self.error(
                    invocation,
                    ErrorCode::InvalidInputKind,
                    ErrorLocation::Input {
                        key: slot.key.clone(),
                    },
                    Recoverability::ReselectInput,
                    &format!("{} contains a selection of an unsupported kind", slot.label),
                    UserActionKind::FocusInput,
                    &format!("Reselect {}", slot.label),
                    &slot.key,
                ));
            }
        }

        for key in invocation.parameters.keys() {
            if !self
                .parameters
                .iter()
                .any(|parameter| parameter.key == *key)
            {
                errors.push(self.error(
                    invocation,
                    ErrorCode::UnknownParameter,
                    ErrorLocation::Parameter { key: key.clone() },
                    Recoverability::RetryAfterEdit,
                    "operation invocation contains an unknown parameter",
                    UserActionKind::FocusParameter,
                    "Remove unknown parameter",
                    key,
                ));
            }
        }

        for parameter in &self.parameters {
            let Some(value) = invocation.parameters.get(&parameter.key) else {
                errors.push(self.error(
                    invocation,
                    ErrorCode::MissingParameter,
                    ErrorLocation::Parameter {
                        key: parameter.key.clone(),
                    },
                    Recoverability::RetryAfterEdit,
                    &format!("{} is required", parameter.label),
                    UserActionKind::FocusParameter,
                    &format!("Set {}", parameter.label),
                    &parameter.key,
                ));
                continue;
            };
            if value.kind() != parameter.value_kind {
                errors.push(self.error(
                    invocation,
                    ErrorCode::InvalidParameterType,
                    ErrorLocation::Parameter {
                        key: parameter.key.clone(),
                    },
                    Recoverability::RetryAfterEdit,
                    &format!("{} has the wrong value type", parameter.label),
                    UserActionKind::FocusParameter,
                    &format!("Edit {}", parameter.label),
                    &parameter.key,
                ));
                continue;
            }
            if let (Some(bounds), Some(number)) = (&parameter.bounds, value.integer_value()) {
                let below = bounds
                    .minimum
                    .is_some_and(|minimum| number < i128::from(minimum));
                let above = bounds
                    .maximum
                    .is_some_and(|maximum| number > i128::from(maximum));
                if below || above {
                    errors.push(self.error(
                        invocation,
                        ErrorCode::ParameterOutOfBounds,
                        ErrorLocation::Parameter {
                            key: parameter.key.clone(),
                        },
                        Recoverability::RetryAfterEdit,
                        &format!("{} is outside its allowed bounds", parameter.label),
                        UserActionKind::FocusParameter,
                        &format!("Edit {}", parameter.label),
                        &parameter.key,
                    ));
                }
            }
            if let ParameterValue::Text(choice) = value
                && !parameter.choices.is_empty()
                && !parameter.choices.contains(choice)
            {
                errors.push(self.error(
                    invocation,
                    ErrorCode::InvalidChoice,
                    ErrorLocation::Parameter {
                        key: parameter.key.clone(),
                    },
                    Recoverability::RetryAfterEdit,
                    &format!("{} is not an allowed choice", parameter.label),
                    UserActionKind::FocusParameter,
                    &format!("Edit {}", parameter.label),
                    &parameter.key,
                ));
            }
        }

        errors
    }

    /// Validate the declarative definition before exposing it to an inspector.
    pub fn validate_definition(&self) -> Vec<SchemaDefinitionError> {
        let mut errors = Vec::new();
        let mut input_keys = std::collections::BTreeSet::new();
        for slot in &self.input_slots {
            if !input_keys.insert(slot.key.as_str()) {
                errors.push(definition_error(
                    format!("input_slots.{}", slot.key),
                    "input key must be unique",
                ));
            }
            if slot.allowed_kinds.is_empty() {
                errors.push(definition_error(
                    format!("input_slots.{}.allowed_kinds", slot.key),
                    "at least one selection kind is required",
                ));
            }
            if slot
                .maximum_count
                .is_some_and(|maximum| maximum < slot.minimum_count)
            {
                errors.push(definition_error(
                    format!("input_slots.{}.maximum_count", slot.key),
                    "maximum_count cannot be less than minimum_count",
                ));
            }
        }

        let mut parameter_keys = std::collections::BTreeSet::new();
        for parameter in &self.parameters {
            let path = format!("parameters.{}", parameter.key);
            if !parameter_keys.insert(parameter.key.as_str()) {
                errors.push(definition_error(
                    path.clone(),
                    "parameter key must be unique",
                ));
            }
            if parameter.default.kind() != parameter.value_kind {
                errors.push(definition_error(
                    format!("{path}.default"),
                    "default value kind must match value_kind",
                ));
                continue;
            }
            if let (Some(bounds), Some(value)) =
                (&parameter.bounds, parameter.default.integer_value())
                && (bounds
                    .minimum
                    .is_some_and(|minimum| value < i128::from(minimum))
                    || bounds
                        .maximum
                        .is_some_and(|maximum| value > i128::from(maximum)))
            {
                errors.push(definition_error(
                    format!("{path}.default"),
                    "default value must be inside bounds",
                ));
            }
            if let ParameterValue::Text(default) = &parameter.default
                && !parameter.choices.is_empty()
                && !parameter.choices.contains(default)
            {
                errors.push(definition_error(
                    format!("{path}.default"),
                    "default text value must be an allowed choice",
                ));
            }
        }

        if self.enablement.state == EnablementState::Disabled
            && self
                .enablement
                .reason
                .as_ref()
                .is_none_or(|reason| reason.trim().is_empty())
        {
            errors.push(definition_error(
                "enablement.reason",
                "disabled operations require a product-readable reason",
            ));
        }
        errors
    }

    #[allow(clippy::too_many_arguments)]
    fn error(
        &self,
        invocation: &OperationInvocation,
        code: ErrorCode,
        location: ErrorLocation,
        recoverability: Recoverability,
        message: &str,
        action_kind: UserActionKind,
        action_label: &str,
        action_target: &str,
    ) -> OperationError {
        OperationError {
            code,
            operation: OperationContext {
                schema_id: self.id.clone(),
                operation_id: invocation.operation_id.clone(),
            },
            location,
            recoverability,
            message: message.to_owned(),
            user_actions: vec![UserAction {
                kind: action_kind,
                label: action_label.to_owned(),
                target: action_target.to_owned(),
            }],
        }
    }
}

impl OperationCatalog {
    pub fn operation(&self, id: &str) -> Option<&OperationSchema> {
        self.operations.iter().find(|operation| operation.id == id)
    }

    pub fn validate_definition(&self) -> Vec<SchemaDefinitionError> {
        let mut errors = Vec::new();
        let mut capability_ids = std::collections::BTreeSet::new();
        for capability in &self.capabilities {
            if !capability_ids.insert(capability.id.as_str()) {
                errors.push(definition_error(
                    format!("capabilities.{}", capability.id),
                    "capability id must be unique",
                ));
            }
            if capability.state == CapabilityState::Unavailable
                && capability
                    .reason
                    .as_ref()
                    .is_none_or(|reason| reason.trim().is_empty())
            {
                errors.push(definition_error(
                    format!("capabilities.{}.reason", capability.id),
                    "unavailable capabilities require a product-readable reason",
                ));
            }
            if capability.state == CapabilityState::Qualified && capability.reason.is_some() {
                errors.push(definition_error(
                    format!("capabilities.{}.reason", capability.id),
                    "qualified capabilities cannot carry an unavailable reason",
                ));
            }
        }
        let capabilities: BTreeMap<&str, &CapabilitySchema> = self
            .capabilities
            .iter()
            .map(|capability| (capability.id.as_str(), capability))
            .collect();
        let mut operation_ids = std::collections::BTreeSet::new();
        for operation in &self.operations {
            if !operation_ids.insert(operation.id.as_str()) {
                errors.push(definition_error(
                    format!("operations.{}", operation.id),
                    "operation id must be unique",
                ));
            }
            errors.extend(operation.validate_definition().into_iter().map(|error| {
                SchemaDefinitionError {
                    path: format!("operations.{}.{}", operation.id, error.path),
                    message: error.message,
                }
            }));
            match capabilities.get(operation.enablement.capability.as_str()) {
                None => errors.push(definition_error(
                    format!("operations.{}.enablement.capability", operation.id),
                    "operation capability must exist in the catalog",
                )),
                Some(capability) => {
                    let expected_state = match capability.state {
                        CapabilityState::Qualified => EnablementState::Enabled,
                        CapabilityState::Unavailable => EnablementState::Disabled,
                    };
                    if operation.enablement.state != expected_state
                        || operation.enablement.reason != capability.reason
                    {
                        errors.push(definition_error(
                            format!("operations.{}.enablement", operation.id),
                            "operation enablement must be derived from capability state",
                        ));
                    }
                }
            }
        }
        errors
    }
}

fn definition_error(path: impl Into<String>, message: impl Into<String>) -> SchemaDefinitionError {
    SchemaDefinitionError {
        path: path.into(),
        message: message.into(),
    }
}
