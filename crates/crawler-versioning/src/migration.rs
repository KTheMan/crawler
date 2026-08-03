use crawler_document::Document;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, BTreeSet};
use thiserror::Error;

type MigrationFn = fn(Value) -> Result<Value, StepFailure>;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MigrationStepDescriptor {
    pub id: String,
    pub source_version: u32,
    pub destination_version: u32,
}

struct MigrationStep {
    descriptor: MigrationStepDescriptor,
    migrate: MigrationFn,
}

pub struct MigrationRegistry {
    steps: BTreeMap<(u32, u32), MigrationStep>,
}

impl Default for MigrationRegistry {
    fn default() -> Self {
        let mut registry = Self {
            steps: BTreeMap::new(),
        };
        registry.register(MigrationStep {
            descriptor: MigrationStepDescriptor {
                id: "crawler.document.0-to-1.display-units".into(),
                source_version: 0,
                destination_version: 1,
            },
            migrate: migrate_v0_to_v1,
        });
        registry
    }
}

impl MigrationRegistry {
    pub fn descriptors(&self) -> Vec<MigrationStepDescriptor> {
        self.steps
            .values()
            .map(|step| step.descriptor.clone())
            .collect()
    }

    pub fn migrate(
        &self,
        input: &[u8],
        required_features: &BTreeSet<String>,
        supported_features: &BTreeSet<String>,
        target_version: u32,
    ) -> Result<MigrationOutcome, MigrationError> {
        validate_features(required_features, supported_features)?;
        let original_bytes = input.to_vec();
        let mut value: Value = serde_json::from_slice(input)?;
        let source_version = schema_version(&value)?;
        if source_version > target_version {
            return Err(MigrationError::UnsupportedOrLossy {
                source_version,
                target_version,
                diagnostic:
                    "downgrade migrations are not lossless and are not selected automatically"
                        .into(),
                choices: vec![
                    "open with a reader supporting the newer schema".into(),
                    "export a neutral interchange format explicitly".into(),
                ],
            });
        }

        let mut current = source_version;
        let mut applied_steps = Vec::new();
        while current < target_version {
            let destination = current + 1;
            let step =
                self.steps
                    .get(&(current, destination))
                    .ok_or(MigrationError::NoMigrationPath {
                        source_version: current,
                        target_version,
                    })?;
            let migrated = (step.migrate)(value.clone()).map_err(|failure| {
                MigrationError::UnsupportedOrLossy {
                    source_version: current,
                    target_version: destination,
                    diagnostic: failure.diagnostic,
                    choices: failure.choices,
                }
            })?;
            // Run the pure step again and compare so registry mistakes fail
            // before any migrated document is accepted.
            let repeated =
                (step.migrate)(value).map_err(|failure| MigrationError::UnsupportedOrLossy {
                    source_version: current,
                    target_version: destination,
                    diagnostic: failure.diagnostic,
                    choices: failure.choices,
                })?;
            if migrated != repeated {
                return Err(MigrationError::NondeterministicStep(
                    step.descriptor.id.clone(),
                ));
            }
            if schema_version(&migrated)? != destination {
                return Err(MigrationError::InvalidStepDestination {
                    step: step.descriptor.id.clone(),
                    expected: destination,
                });
            }
            value = migrated;
            current = destination;
            applied_steps.push(step.descriptor.clone());
        }

        let document: Document = serde_json::from_value(value)?;
        if document.schema_version.get() != target_version {
            return Err(MigrationError::Validation(format!(
                "validated schema {} differs from requested {target_version}",
                document.schema_version.get()
            )));
        }
        let mut migrated_bytes = serde_json::to_vec(&document)?;
        migrated_bytes.push(b'\n');
        Ok(MigrationOutcome {
            original_bytes,
            migrated_bytes,
            document,
            source_version,
            target_version,
            applied_steps,
        })
    }

    fn register(&mut self, step: MigrationStep) {
        let key = (
            step.descriptor.source_version,
            step.descriptor.destination_version,
        );
        assert_eq!(
            key.1,
            key.0 + 1,
            "migration registry steps must be adjacent"
        );
        assert!(
            self.steps.insert(key, step).is_none(),
            "duplicate migration registry step"
        );
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MigrationOutcome {
    /// Exact caller input retained until the validated result exists.
    pub original_bytes: Vec<u8>,
    pub migrated_bytes: Vec<u8>,
    pub document: Document,
    pub source_version: u32,
    pub target_version: u32,
    pub applied_steps: Vec<MigrationStepDescriptor>,
}

#[derive(Debug, Error)]
pub enum MigrationError {
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("document has no non-negative integer schema_version")]
    MissingSchemaVersion,
    #[error("required feature {0:?} is unsupported")]
    UnsupportedRequiredFeature(String),
    #[error("required feature token {0:?} is invalid")]
    InvalidRequiredFeature(String),
    #[error("no migration path from schema {source_version} to {target_version}")]
    NoMigrationPath {
        source_version: u32,
        target_version: u32,
    },
    #[error(
        "migration from schema {source_version} to {target_version} requires an explicit choice: {diagnostic}"
    )]
    UnsupportedOrLossy {
        source_version: u32,
        target_version: u32,
        diagnostic: String,
        choices: Vec<String>,
    },
    #[error("migration step {0:?} produced different outputs for identical input")]
    NondeterministicStep(String),
    #[error("migration step {step:?} did not produce schema {expected}")]
    InvalidStepDestination { step: String, expected: u32 },
    #[error("migrated document validation failed: {0}")]
    Validation(String),
}

#[derive(Debug)]
struct StepFailure {
    diagnostic: String,
    choices: Vec<String>,
}

fn migrate_v0_to_v1(mut value: Value) -> Result<Value, StepFailure> {
    let object = value.as_object_mut().ok_or_else(|| StepFailure {
        diagnostic: "schema-0 root is not an object".into(),
        choices: vec!["retain the original bytes".into()],
    })?;
    let units = object
        .get_mut("units")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| StepFailure {
            diagnostic: "schema-0 units object is missing".into(),
            choices: vec!["retain the original bytes".into()],
        })?;
    let length = units.remove("length").ok_or_else(|| StepFailure {
        diagnostic: "schema-0 units.length is missing".into(),
        choices: vec!["retain the original bytes".into()],
    })?;
    let angle = units.remove("angle").ok_or_else(|| StepFailure {
        diagnostic: "schema-0 units.angle is missing".into(),
        choices: vec!["retain the original bytes".into()],
    })?;
    if !units.is_empty() {
        return Err(StepFailure {
            diagnostic: "schema-0 units contain unknown fields".into(),
            choices: vec!["retain the original bytes".into()],
        });
    }
    *units = Map::from_iter([
        ("display_length".into(), length),
        ("display_angle".into(), angle),
    ]);
    object.insert("schema_version".into(), Value::from(1));
    Ok(value)
}

fn schema_version(value: &Value) -> Result<u32, MigrationError> {
    value
        .get("schema_version")
        .and_then(Value::as_u64)
        .and_then(|version| u32::try_from(version).ok())
        .ok_or(MigrationError::MissingSchemaVersion)
}

fn validate_features(
    required: &BTreeSet<String>,
    supported: &BTreeSet<String>,
) -> Result<(), MigrationError> {
    for feature in required {
        if feature.is_empty()
            || !feature.bytes().all(|byte| {
                byte.is_ascii_lowercase()
                    || byte.is_ascii_digit()
                    || matches!(byte, b'.' | b'-' | b'_' | b':' | b'/')
            })
        {
            return Err(MigrationError::InvalidRequiredFeature(feature.clone()));
        }
        if !supported.contains(feature) {
            return Err(MigrationError::UnsupportedRequiredFeature(feature.clone()));
        }
    }
    Ok(())
}
