//! Executable validation for Crawler reference-model evidence.

use crawler_document::Document;
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;
use std::fmt::{self, Display, Formatter};
use std::fs;
use std::path::{Component, Path, PathBuf};

pub const CATALOG_FILE: &str = "catalog.json";

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FixtureCatalog {
    pub catalog_version: u32,
    pub fixtures: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FixtureRecord {
    pub fixture_format_version: u32,
    pub id: String,
    pub title: String,
    pub category: FixtureCategory,
    pub license: FixtureLicense,
    pub provenance: FixtureProvenance,
    pub document: DocumentEvidence,
    pub topology_assertions: Vec<TopologyAssertion>,
    pub geometric_evidence: Vec<GeometricEvidence>,
    #[serde(default)]
    pub artifacts: Vec<ArtifactEvidence>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd)]
#[serde(rename_all = "snake_case")]
pub enum FixtureCategory {
    ParametricModel,
    MechanicalReference,
    StepRoundtrip,
    TopologyBreak,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FixtureLicense {
    pub spdx: String,
    pub scope: String,
    pub notice: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FixtureProvenance {
    pub source_type: ProvenanceSourceType,
    pub creator: String,
    pub created: String,
    pub source: String,
    pub generator: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ProvenanceSourceType {
    ProjectAuthored,
    Generated,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DocumentEvidence {
    pub path: String,
    pub sha256: String,
    pub byte_length: u64,
    pub schema_version: u32,
    pub revision: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TopologyAssertion {
    pub reference: String,
    pub entity_kind: TopologyEntityKind,
    pub expected_status: TopologyStatus,
    pub expected_match_count: u32,
    pub geometric_signature: BTreeMap<String, Value>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TopologyEntityKind {
    Vertex,
    Edge,
    Face,
    Shell,
    Solid,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd)]
#[serde(rename_all = "snake_case")]
pub enum TopologyStatus {
    Resolved,
    Missing,
    Ambiguous,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum GeometricEvidence {
    AxisAlignedBounds {
        units: LengthEvidenceUnit,
        min: [i64; 3],
        max: [i64; 3],
    },
    Volume {
        units: VolumeEvidenceUnit,
        value: u64,
    },
    SurfaceArea {
        units: AreaEvidenceUnit,
        value: u64,
    },
    StepCartesianPoints {
        artifact: String,
        count: usize,
        units: LengthEvidenceUnit,
        min: [i64; 3],
        max: [i64; 3],
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum LengthEvidenceUnit {
    Millimeter,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum VolumeEvidenceUnit {
    CubicMillimeter,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AreaEvidenceUnit {
    SquareMillimeter,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactEvidence {
    pub role: ArtifactRole,
    pub path: String,
    pub media_type: ArtifactMediaType,
    pub sha256: String,
    pub byte_length: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactRole {
    ImportSample,
    ExportSample,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
pub enum ArtifactMediaType {
    #[serde(rename = "model/step")]
    Step,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValidationReport {
    pub fixture_count: usize,
    pub artifact_count: usize,
    pub categories: BTreeSet<FixtureCategory>,
    pub topology_statuses: BTreeSet<TopologyStatus>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ValidationCode {
    Io,
    MalformedJson,
    UnsupportedVersion,
    InvalidCatalog,
    InvalidPath,
    InvalidLicense,
    InvalidProvenance,
    HashMismatch,
    LengthMismatch,
    InvalidDocument,
    HiddenMachineState,
    InvalidTopologyAssertion,
    InvalidGeometricEvidence,
    InvalidStep,
    MissingCoverage,
}

#[derive(Debug, Eq, PartialEq)]
pub struct ValidationError {
    pub code: ValidationCode,
    pub fixture: Option<String>,
    pub message: String,
}

impl ValidationError {
    fn new(code: ValidationCode, fixture: Option<&str>, message: impl Into<String>) -> Self {
        Self {
            code,
            fixture: fixture.map(str::to_owned),
            message: message.into(),
        }
    }
}

impl Display for ValidationError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        if let Some(fixture) = &self.fixture {
            write!(formatter, "{}: ", fixture)?;
        }
        write!(formatter, "{:?}: {}", self.code, self.message)
    }
}

impl Error for ValidationError {}

pub fn validate_repository(root: impl AsRef<Path>) -> Result<ValidationReport, ValidationError> {
    let root = root.as_ref();
    let catalog_bytes = read_file(root, CATALOG_FILE, None)?;
    let catalog: FixtureCatalog = serde_json::from_slice(&catalog_bytes).map_err(|error| {
        ValidationError::new(
            ValidationCode::MalformedJson,
            None,
            format!("invalid {CATALOG_FILE}: {error}"),
        )
    })?;
    if catalog.catalog_version != 1 {
        return Err(ValidationError::new(
            ValidationCode::UnsupportedVersion,
            None,
            format!("unsupported catalog version {}", catalog.catalog_version),
        ));
    }
    if catalog.fixtures.is_empty() {
        return Err(ValidationError::new(
            ValidationCode::InvalidCatalog,
            None,
            "catalog has no fixtures",
        ));
    }

    let mut ids = BTreeSet::new();
    let mut categories = BTreeSet::new();
    let mut topology_statuses = BTreeSet::new();
    let mut artifact_roles = BTreeSet::new();
    let mut artifact_count = 0;

    for fixture_path in &catalog.fixtures {
        let record_bytes = read_file(root, fixture_path, None)?;
        let record: FixtureRecord = serde_json::from_slice(&record_bytes).map_err(|error| {
            ValidationError::new(
                ValidationCode::MalformedJson,
                Some(fixture_path),
                format!("invalid fixture record: {error}"),
            )
        })?;
        validate_record(root, fixture_path, &record)?;
        if !ids.insert(record.id.clone()) {
            return Err(ValidationError::new(
                ValidationCode::InvalidCatalog,
                Some(&record.id),
                "duplicate fixture id",
            ));
        }
        categories.insert(record.category);
        topology_statuses.extend(
            record
                .topology_assertions
                .iter()
                .map(|assertion| assertion.expected_status),
        );
        artifact_roles.extend(record.artifacts.iter().map(|artifact| artifact.role));
        artifact_count += record.artifacts.len();
    }

    let required_categories = BTreeSet::from([
        FixtureCategory::ParametricModel,
        FixtureCategory::MechanicalReference,
        FixtureCategory::StepRoundtrip,
        FixtureCategory::TopologyBreak,
    ]);
    if !required_categories.is_subset(&categories)
        || !topology_statuses.contains(&TopologyStatus::Missing)
        || !topology_statuses.contains(&TopologyStatus::Ambiguous)
        || !artifact_roles.contains(&ArtifactRole::ImportSample)
        || !artifact_roles.contains(&ArtifactRole::ExportSample)
    {
        return Err(ValidationError::new(
            ValidationCode::MissingCoverage,
            None,
            "catalog must cover cube, mechanical reference, STEP import/export, and missing/ambiguous topology breaks",
        ));
    }

    Ok(ValidationReport {
        fixture_count: ids.len(),
        artifact_count,
        categories,
        topology_statuses,
    })
}

fn validate_record(
    root: &Path,
    fixture_record_path: &str,
    record: &FixtureRecord,
) -> Result<(), ValidationError> {
    let fixture = record.id.as_str();
    if record.fixture_format_version != 1 {
        return Err(ValidationError::new(
            ValidationCode::UnsupportedVersion,
            Some(fixture),
            format!(
                "unsupported fixture format version {}",
                record.fixture_format_version
            ),
        ));
    }
    if record.id.is_empty() || record.title.is_empty() {
        return Err(ValidationError::new(
            ValidationCode::InvalidCatalog,
            Some(fixture),
            "fixture id and title must be non-empty",
        ));
    }
    if record.license.spdx != "CC0-1.0"
        || record.license.scope.is_empty()
        || record.license.notice.is_empty()
    {
        return Err(ValidationError::new(
            ValidationCode::InvalidLicense,
            Some(fixture),
            "fixture must record a non-empty CC0-1.0 license scope and notice",
        ));
    }
    if record.provenance.creator.is_empty()
        || record.provenance.created.is_empty()
        || record.provenance.source.is_empty()
        || record.provenance.generator.is_empty()
    {
        return Err(ValidationError::new(
            ValidationCode::InvalidProvenance,
            Some(fixture),
            "creator, creation date, source, and generator are required",
        ));
    }

    let fixture_dir = Path::new(fixture_record_path)
        .parent()
        .unwrap_or_else(|| Path::new(""));
    let document_relative = join_portable(fixture_dir, &record.document.path, fixture)?;
    let document_bytes = read_file(root, &document_relative, Some(fixture))?;
    verify_bytes(
        &document_bytes,
        record.document.byte_length,
        &record.document.sha256,
        fixture,
        "document",
    )?;
    let document_value: Value = serde_json::from_slice(&document_bytes).map_err(|error| {
        ValidationError::new(
            ValidationCode::InvalidDocument,
            Some(fixture),
            format!("document is not JSON: {error}"),
        )
    })?;
    reject_hidden_state(&document_value, fixture)?;
    let document: Document = serde_json::from_slice(&document_bytes).map_err(|error| {
        ValidationError::new(
            ValidationCode::InvalidDocument,
            Some(fixture),
            format!("document does not satisfy crawler-document: {error}"),
        )
    })?;
    if document.schema_version.get() != record.document.schema_version
        || document.revision != record.document.revision
    {
        return Err(ValidationError::new(
            ValidationCode::InvalidDocument,
            Some(fixture),
            "document schema version or revision differs from recorded evidence",
        ));
    }

    if record.topology_assertions.is_empty() {
        return Err(ValidationError::new(
            ValidationCode::InvalidTopologyAssertion,
            Some(fixture),
            "at least one topology assertion is required",
        ));
    }
    let mut topology_references = BTreeSet::new();
    for assertion in &record.topology_assertions {
        if assertion.reference.is_empty()
            || assertion.geometric_signature.is_empty()
            || !topology_references.insert(assertion.reference.clone())
        {
            return Err(ValidationError::new(
                ValidationCode::InvalidTopologyAssertion,
                Some(fixture),
                "topology references and geometric signatures must be non-empty and unique",
            ));
        }
        let count_valid = match assertion.expected_status {
            TopologyStatus::Resolved => assertion.expected_match_count == 1,
            TopologyStatus::Missing => assertion.expected_match_count == 0,
            TopologyStatus::Ambiguous => assertion.expected_match_count >= 2,
        };
        if !count_valid {
            return Err(ValidationError::new(
                ValidationCode::InvalidTopologyAssertion,
                Some(fixture),
                format!(
                    "topology assertion {:?} has incompatible match count {}",
                    assertion.expected_status, assertion.expected_match_count
                ),
            ));
        }
    }

    if record.geometric_evidence.is_empty() {
        return Err(ValidationError::new(
            ValidationCode::InvalidGeometricEvidence,
            Some(fixture),
            "at least one geometric evidence item is required",
        ));
    }

    let mut artifacts = BTreeMap::new();
    for artifact in &record.artifacts {
        let relative = join_portable(fixture_dir, &artifact.path, fixture)?;
        let bytes = read_file(root, &relative, Some(fixture))?;
        verify_bytes(
            &bytes,
            artifact.byte_length,
            &artifact.sha256,
            fixture,
            &artifact.path,
        )?;
        validate_step(&bytes, fixture, &artifact.path)?;
        if artifacts.insert(artifact.path.clone(), bytes).is_some() {
            return Err(ValidationError::new(
                ValidationCode::InvalidCatalog,
                Some(fixture),
                format!("duplicate artifact path {:?}", artifact.path),
            ));
        }
    }
    validate_geometric_evidence(&record.geometric_evidence, &artifacts, fixture)?;
    Ok(())
}

fn validate_geometric_evidence(
    evidence: &[GeometricEvidence],
    artifacts: &BTreeMap<String, Vec<u8>>,
    fixture: &str,
) -> Result<(), ValidationError> {
    for item in evidence {
        match item {
            GeometricEvidence::AxisAlignedBounds { min, max, .. } => {
                validate_bounds(*min, *max, fixture)?;
            }
            GeometricEvidence::Volume { value, .. }
            | GeometricEvidence::SurfaceArea { value, .. }
                if *value == 0 =>
            {
                return Err(ValidationError::new(
                    ValidationCode::InvalidGeometricEvidence,
                    Some(fixture),
                    "area and volume evidence must be positive",
                ));
            }
            GeometricEvidence::StepCartesianPoints {
                artifact,
                count,
                min,
                max,
                ..
            } => {
                validate_bounds(*min, *max, fixture)?;
                let bytes = artifacts.get(artifact).ok_or_else(|| {
                    ValidationError::new(
                        ValidationCode::InvalidGeometricEvidence,
                        Some(fixture),
                        format!("STEP evidence references unknown artifact {artifact:?}"),
                    )
                })?;
                let points = step_cartesian_points(bytes, fixture, artifact)?;
                if points.len() != *count || bounds(&points) != Some((*min, *max)) {
                    return Err(ValidationError::new(
                        ValidationCode::InvalidGeometricEvidence,
                        Some(fixture),
                        format!("STEP point count or bounds differ for {artifact:?}"),
                    ));
                }
            }
            GeometricEvidence::Volume { .. } | GeometricEvidence::SurfaceArea { .. } => {}
        }
    }
    Ok(())
}

fn validate_bounds(min: [i64; 3], max: [i64; 3], fixture: &str) -> Result<(), ValidationError> {
    if (0..3).any(|axis| min[axis] > max[axis]) {
        return Err(ValidationError::new(
            ValidationCode::InvalidGeometricEvidence,
            Some(fixture),
            "geometric bounds have min greater than max",
        ));
    }
    Ok(())
}

fn reject_hidden_state(value: &Value, fixture: &str) -> Result<(), ValidationError> {
    const FORBIDDEN_KEYS: &[&str] = &[
        "camera",
        "cache",
        "hover",
        "journal",
        "machine",
        "panel_layout",
        "recovery",
        "selection",
        "timestamp",
        "viewport",
    ];
    match value {
        Value::Object(object) => {
            for (key, nested) in object {
                if FORBIDDEN_KEYS.contains(&key.as_str()) {
                    return Err(ValidationError::new(
                        ValidationCode::HiddenMachineState,
                        Some(fixture),
                        format!("document contains forbidden machine-local key {key:?}"),
                    ));
                }
                reject_hidden_state(nested, fixture)?;
            }
        }
        Value::Array(values) => {
            for nested in values {
                reject_hidden_state(nested, fixture)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn validate_step(bytes: &[u8], fixture: &str, artifact: &str) -> Result<(), ValidationError> {
    let text = std::str::from_utf8(bytes).map_err(|error| {
        ValidationError::new(
            ValidationCode::InvalidStep,
            Some(fixture),
            format!("STEP artifact {artifact:?} is not UTF-8 ASCII: {error}"),
        )
    })?;
    if !text.is_ascii()
        || !text.starts_with("ISO-10303-21;\nHEADER;\n")
        || !text.contains("\nDATA;\n")
        || !text.ends_with("END-ISO-10303-21;\n")
    {
        return Err(ValidationError::new(
            ValidationCode::InvalidStep,
            Some(fixture),
            format!("STEP artifact {artifact:?} has an invalid Part 21 envelope"),
        ));
    }
    Ok(())
}

fn step_cartesian_points(
    bytes: &[u8],
    fixture: &str,
    artifact: &str,
) -> Result<Vec<[i64; 3]>, ValidationError> {
    let text = std::str::from_utf8(bytes).expect("STEP UTF-8 was validated");
    let mut points = Vec::new();
    for line in text.lines().filter(|line| line.contains("CARTESIAN_POINT")) {
        let start = line.rfind("',(").map(|index| index + 3).ok_or_else(|| {
            ValidationError::new(
                ValidationCode::InvalidStep,
                Some(fixture),
                format!("cannot parse Cartesian point in {artifact:?}"),
            )
        })?;
        let end = line[start..]
            .find(")")
            .map(|index| start + index)
            .ok_or_else(|| {
                ValidationError::new(
                    ValidationCode::InvalidStep,
                    Some(fixture),
                    format!("cannot parse Cartesian point in {artifact:?}"),
                )
            })?;
        let coordinates = line[start..end]
            .split(',')
            .map(|coordinate| coordinate.parse::<f64>())
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| {
                ValidationError::new(
                    ValidationCode::InvalidStep,
                    Some(fixture),
                    format!("invalid Cartesian coordinate in {artifact:?}: {error}"),
                )
            })?;
        if coordinates.len() != 3
            || coordinates
                .iter()
                .any(|coordinate| !coordinate.is_finite() || coordinate.fract() != 0.0)
        {
            return Err(ValidationError::new(
                ValidationCode::InvalidStep,
                Some(fixture),
                format!("reference STEP coordinates in {artifact:?} must be integral triples"),
            ));
        }
        points.push([
            coordinates[0] as i64,
            coordinates[1] as i64,
            coordinates[2] as i64,
        ]);
    }
    if points.is_empty() {
        return Err(ValidationError::new(
            ValidationCode::InvalidStep,
            Some(fixture),
            format!("STEP artifact {artifact:?} has no Cartesian points"),
        ));
    }
    Ok(points)
}

fn bounds(points: &[[i64; 3]]) -> Option<([i64; 3], [i64; 3])> {
    let first = *points.first()?;
    let mut min = first;
    let mut max = first;
    for point in &points[1..] {
        for axis in 0..3 {
            min[axis] = min[axis].min(point[axis]);
            max[axis] = max[axis].max(point[axis]);
        }
    }
    Some((min, max))
}

fn verify_bytes(
    bytes: &[u8],
    expected_length: u64,
    expected_sha256: &str,
    fixture: &str,
    label: &str,
) -> Result<(), ValidationError> {
    let actual_length = bytes.len() as u64;
    if actual_length != expected_length {
        return Err(ValidationError::new(
            ValidationCode::LengthMismatch,
            Some(fixture),
            format!("{label} has {actual_length} bytes; expected {expected_length}"),
        ));
    }
    if expected_sha256.len() != 64
        || !expected_sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(ValidationError::new(
            ValidationCode::HashMismatch,
            Some(fixture),
            format!("{label} records an invalid lowercase SHA-256"),
        ));
    }
    let actual = sha256_hex(bytes);
    if actual != expected_sha256 {
        return Err(ValidationError::new(
            ValidationCode::HashMismatch,
            Some(fixture),
            format!("{label} hash {actual} differs from {expected_sha256}"),
        ));
    }
    Ok(())
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn read_file(
    root: &Path,
    relative: &str,
    fixture: Option<&str>,
) -> Result<Vec<u8>, ValidationError> {
    let path = safe_path(root, relative, fixture)?;
    fs::read(&path).map_err(|error| {
        ValidationError::new(
            ValidationCode::Io,
            fixture,
            format!("could not read {}: {error}", path.display()),
        )
    })
}

fn join_portable(base: &Path, leaf: &str, fixture: &str) -> Result<String, ValidationError> {
    if leaf.contains('\\') {
        return Err(ValidationError::new(
            ValidationCode::InvalidPath,
            Some(fixture),
            format!("path {leaf:?} must use forward slashes"),
        ));
    }
    let path = base.join(leaf);
    let text = path.to_str().ok_or_else(|| {
        ValidationError::new(
            ValidationCode::InvalidPath,
            Some(fixture),
            "path is not UTF-8",
        )
    })?;
    Ok(text.replace('\\', "/"))
}

fn safe_path(
    root: &Path,
    relative: &str,
    fixture: Option<&str>,
) -> Result<PathBuf, ValidationError> {
    if relative.is_empty() || relative.contains('\\') {
        return Err(ValidationError::new(
            ValidationCode::InvalidPath,
            fixture,
            format!("invalid portable path {relative:?}"),
        ));
    }
    let path = Path::new(relative);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(ValidationError::new(
            ValidationCode::InvalidPath,
            fixture,
            format!("path {relative:?} must be relative without dot segments"),
        ));
    }
    Ok(root.join(path))
}
