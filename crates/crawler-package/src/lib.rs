//! Portable package-format contracts for Crawler documents.
//!
//! This crate owns manifest canonicalization, deterministic ZIP encoding, and
//! validation of the complete portable archive entry set.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;
use std::fmt::{self, Display, Formatter};
use std::io::{Cursor, Read, Write};
use std::path::Path;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

pub const MANIFEST_PATH: &str = "manifest.json";
pub const DOCUMENT_MEDIA_TYPE: &str = "application/vnd.crawler.document+json";
pub const PART_PACKAGE_MEDIA_TYPE: &str = "application/vnd.crawler.part+zip";
pub const ASSEMBLY_PACKAGE_MEDIA_TYPE: &str = "application/vnd.crawler.assembly+zip";
pub const DRAWING_PACKAGE_MEDIA_TYPE: &str = "application/vnd.crawler.drawing+zip";

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub struct PackageFormatVersion(u32);

impl PackageFormatVersion {
    pub const V1: Self = Self(1);

    pub const fn get(self) -> u32 {
        self.0
    }
}

impl Serialize for PackageFormatVersion {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_u32(self.0)
    }
}

impl<'de> Deserialize<'de> for PackageFormatVersion {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        Ok(Self(u32::deserialize(deserializer)?))
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DocumentKind {
    Part,
    Assembly,
    Drawing,
}

impl DocumentKind {
    pub const fn package_media_type(self) -> &'static str {
        match self {
            Self::Part => PART_PACKAGE_MEDIA_TYPE,
            Self::Assembly => ASSEMBLY_PACKAGE_MEDIA_TYPE,
            Self::Drawing => DRAWING_PACKAGE_MEDIA_TYPE,
        }
    }

    pub const fn extension(self) -> &'static str {
        match self {
            Self::Part => ".crawlerpart",
            Self::Assembly => ".crawlerasm",
            Self::Drawing => ".crawlerdraw",
        }
    }
}

/// V1 admits declarative document JSON and source interchange geometry only.
/// There is deliberately no script, module, plugin, or generic binary type.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum PayloadMediaType {
    #[serde(rename = "application/vnd.crawler.document+json")]
    CrawlerDocumentJson,
    #[serde(rename = "model/step")]
    Step,
}

impl PayloadMediaType {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::CrawlerDocumentJson => DOCUMENT_MEDIA_TYPE,
            Self::Step => "model/step",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PayloadRole {
    SemanticDocument,
    ImportedGeometry,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PayloadDescriptor {
    pub role: PayloadRole,
    pub media_type: PayloadMediaType,
    pub byte_length: u64,
    pub sha256: String,
    pub path: String,
}

impl PayloadDescriptor {
    pub fn from_bytes(role: PayloadRole, media_type: PayloadMediaType, bytes: &[u8]) -> Self {
        let sha256 = sha256_hex(bytes);
        let path = payload_path_for_sha256(&sha256).expect("generated SHA-256 must be valid");
        Self {
            role,
            media_type,
            byte_length: bytes.len() as u64,
            sha256,
            path,
        }
    }

    pub fn validate(&self) -> Result<(), PackageError> {
        validate_role_media_type(self.role, self.media_type)?;
        let expected_path = payload_path_for_sha256(&self.sha256)?;
        if self.path != expected_path {
            return Err(PackageError::InvalidPayloadPath {
                actual: self.path.clone(),
                expected: expected_path,
            });
        }
        Ok(())
    }

    pub fn verify_bytes(&self, bytes: &[u8]) -> Result<(), PackageError> {
        self.validate()?;
        let actual_length = bytes.len() as u64;
        if actual_length != self.byte_length {
            return Err(PackageError::LengthMismatch {
                expected: self.byte_length,
                actual: actual_length,
            });
        }
        let actual = sha256_hex(bytes);
        if actual != self.sha256 {
            return Err(PackageError::HashMismatch {
                expected: self.sha256.clone(),
                actual,
            });
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PackageManifest {
    pub format_version: PackageFormatVersion,
    pub package_id: String,
    pub document_kind: DocumentKind,
    pub document_schema_version: u32,
    pub required_features: BTreeSet<String>,
    /// Logical payload name, normally `document`, rather than an archive path.
    pub root_payload: String,
    /// Logical names are stable; descriptors point to immutable content paths.
    pub payloads: BTreeMap<String, PayloadDescriptor>,
}

impl PackageManifest {
    pub fn validate(&self) -> Result<(), PackageError> {
        if self.format_version != PackageFormatVersion::V1 {
            return Err(PackageError::UnsupportedFormatVersion {
                found: self.format_version.get(),
                supported: PackageFormatVersion::V1.get(),
            });
        }
        if self.package_id.is_empty() {
            return Err(PackageError::EmptyPackageId);
        }
        if self.document_schema_version == 0 {
            return Err(PackageError::InvalidDocumentSchemaVersion);
        }
        for feature in &self.required_features {
            if feature.is_empty() || !is_portable_token(feature) {
                return Err(PackageError::InvalidRequiredFeature(feature.clone()));
            }
        }
        for (logical_name, descriptor) in &self.payloads {
            if logical_name.is_empty() || !is_portable_token(logical_name) {
                return Err(PackageError::InvalidLogicalName(logical_name.clone()));
            }
            descriptor.validate()?;
        }
        let root = self
            .payloads
            .get(&self.root_payload)
            .ok_or_else(|| PackageError::MissingRootPayload(self.root_payload.clone()))?;
        if root.role != PayloadRole::SemanticDocument
            || root.media_type != PayloadMediaType::CrawlerDocumentJson
        {
            return Err(PackageError::InvalidRootPayload);
        }
        Ok(())
    }

    /// Checks semantic compatibility after structural validation and before a
    /// caller interprets the root document.
    pub fn ensure_compatible(
        &self,
        supported_document_schema_versions: &BTreeSet<u32>,
        supported_features: &BTreeSet<String>,
    ) -> Result<(), PackageError> {
        self.validate()?;
        if !supported_document_schema_versions.contains(&self.document_schema_version) {
            return Err(PackageError::UnsupportedDocumentSchemaVersion {
                found: self.document_schema_version,
            });
        }
        if let Some(feature) = self
            .required_features
            .iter()
            .find(|feature| !supported_features.contains(*feature))
        {
            return Err(PackageError::UnsupportedRequiredFeature(feature.clone()));
        }
        Ok(())
    }

    /// Compact UTF-8 JSON with a single LF. Struct order, `BTreeSet`, and
    /// `BTreeMap` make the result independent of insertion order.
    pub fn canonical_bytes(&self) -> Result<Vec<u8>, PackageError> {
        self.validate()?;
        let mut bytes = serde_json::to_vec(self).map_err(PackageError::Serialize)?;
        bytes.push(b'\n');
        Ok(bytes)
    }

    pub fn from_canonical_bytes(bytes: &[u8]) -> Result<Self, PackageError> {
        let manifest: Self = serde_json::from_slice(bytes).map_err(PackageError::Deserialize)?;
        manifest.validate()?;
        if manifest.canonical_bytes()? != bytes {
            return Err(PackageError::NonCanonicalManifest);
        }
        Ok(manifest)
    }
}

/// A structurally and cryptographically verified portable package.
///
/// Payloads are keyed by their stable logical manifest names. Keeping the
/// fields private prevents callers from manufacturing a verified value with
/// undeclared entries or stale hashes.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PortablePackage {
    manifest: PackageManifest,
    payloads: BTreeMap<String, Vec<u8>>,
}

impl PortablePackage {
    /// Builds a package from logical payload names and verifies the complete
    /// manifest-to-content relationship.
    pub fn from_payloads(
        manifest: PackageManifest,
        payloads: BTreeMap<String, Vec<u8>>,
    ) -> Result<Self, PackageError> {
        manifest.validate()?;
        for (logical_name, descriptor) in &manifest.payloads {
            let bytes = payloads
                .get(logical_name)
                .ok_or_else(|| PackageError::MissingLogicalPayload(logical_name.clone()))?;
            descriptor.verify_bytes(bytes)?;
        }
        if let Some(logical_name) = payloads
            .keys()
            .find(|logical_name| !manifest.payloads.contains_key(*logical_name))
        {
            return Err(PackageError::UnexpectedLogicalPayload(logical_name.clone()));
        }
        Ok(Self { manifest, payloads })
    }

    /// Validates an unpacked ZIP entry set. The manifest must be canonical,
    /// every declared content path must exist and verify, and no undeclared
    /// entry (including local view/cache/recovery state) is accepted.
    pub fn from_entries(mut entries: BTreeMap<String, Vec<u8>>) -> Result<Self, PackageError> {
        let manifest_bytes = entries
            .remove(MANIFEST_PATH)
            .ok_or(PackageError::MissingManifest)?;
        let manifest = PackageManifest::from_canonical_bytes(&manifest_bytes)?;
        let mut expected_paths = BTreeSet::new();
        let mut payloads = BTreeMap::new();

        for (logical_name, descriptor) in &manifest.payloads {
            expected_paths.insert(descriptor.path.clone());
            let bytes =
                entries
                    .get(&descriptor.path)
                    .ok_or_else(|| PackageError::MissingPayloadEntry {
                        logical_name: logical_name.clone(),
                        path: descriptor.path.clone(),
                    })?;
            descriptor.verify_bytes(bytes)?;
            payloads.insert(logical_name.clone(), bytes.clone());
        }

        if let Some(path) = entries.keys().find(|path| !expected_paths.contains(*path)) {
            return Err(PackageError::UnexpectedEntry(path.clone()));
        }

        Ok(Self { manifest, payloads })
    }

    pub const fn manifest(&self) -> &PackageManifest {
        &self.manifest
    }

    pub fn payload(&self, logical_name: &str) -> Option<&[u8]> {
        self.payloads.get(logical_name).map(Vec::as_slice)
    }

    /// Produces the deterministic logical entry set consumed by a ZIP writer.
    /// Entry ordering is lexical because the returned map is a `BTreeMap`.
    pub fn canonical_entries(&self) -> Result<BTreeMap<String, Vec<u8>>, PackageError> {
        let mut entries = BTreeMap::new();
        entries.insert(MANIFEST_PATH.to_owned(), self.manifest.canonical_bytes()?);
        for (logical_name, descriptor) in &self.manifest.payloads {
            let bytes = self
                .payloads
                .get(logical_name)
                .expect("verified package must contain every declared payload");
            entries
                .entry(descriptor.path.clone())
                .or_insert_with(|| bytes.clone());
        }
        Ok(entries)
    }

    /// Encodes a byte-stable portable ZIP. Entries are stored in lexical order,
    /// uncompressed, with ZIP's fixed 1980 epoch and fixed regular-file mode.
    pub fn to_archive_bytes(&self) -> Result<Vec<u8>, PackageError> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Stored)
            .unix_permissions(0o644);
        for (path, bytes) in self.canonical_entries()? {
            writer
                .start_file(path, options)
                .map_err(|error| PackageError::Archive(error.to_string()))?;
            writer
                .write_all(&bytes)
                .map_err(|error| PackageError::Archive(error.to_string()))?;
        }
        writer
            .finish()
            .map(Cursor::into_inner)
            .map_err(|error| PackageError::Archive(error.to_string()))
    }

    /// Decodes a complete portable ZIP and then applies the same canonical
    /// manifest, path, declaration, length, and content-hash validation as an
    /// unpacked entry set.
    pub fn from_archive_bytes(bytes: &[u8]) -> Result<Self, PackageError> {
        let mut archive = ZipArchive::new(Cursor::new(bytes))
            .map_err(|error| PackageError::Archive(error.to_string()))?;
        let mut entries = BTreeMap::new();
        for index in 0..archive.len() {
            let mut file = archive
                .by_index(index)
                .map_err(|error| PackageError::Archive(error.to_string()))?;
            if !file.is_file() {
                return Err(PackageError::UnexpectedEntry(file.name().to_owned()));
            }
            let path = file.name().to_owned();
            if path.is_empty()
                || path.contains('\\')
                || file
                    .enclosed_name()
                    .is_none_or(|value| value != Path::new(&path))
            {
                return Err(PackageError::InvalidArchivePath(path));
            }
            let mut content = Vec::new();
            file.read_to_end(&mut content)
                .map_err(|error| PackageError::Archive(error.to_string()))?;
            if entries.insert(path.clone(), content).is_some() {
                return Err(PackageError::DuplicateEntry(path));
            }
        }
        Self::from_entries(entries)
    }
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub fn payload_path_for_sha256(digest: &str) -> Result<String, PackageError> {
    if digest.len() != 64
        || !digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(PackageError::InvalidSha256(digest.to_owned()));
    }
    Ok(format!("payloads/sha256/{}/{}", &digest[..2], &digest[2..]))
}

fn is_portable_token(value: &str) -> bool {
    value.bytes().all(|byte| {
        byte.is_ascii_lowercase()
            || byte.is_ascii_digit()
            || matches!(byte, b'.' | b'-' | b'_' | b':' | b'/')
    })
}

fn validate_role_media_type(
    role: PayloadRole,
    media_type: PayloadMediaType,
) -> Result<(), PackageError> {
    match (role, media_type) {
        (PayloadRole::SemanticDocument, PayloadMediaType::CrawlerDocumentJson)
        | (PayloadRole::ImportedGeometry, PayloadMediaType::Step) => Ok(()),
        _ => Err(PackageError::InvalidRoleMediaType { role, media_type }),
    }
}

#[derive(Debug)]
pub enum PackageError {
    Deserialize(serde_json::Error),
    Serialize(serde_json::Error),
    UnsupportedFormatVersion {
        found: u32,
        supported: u32,
    },
    EmptyPackageId,
    InvalidDocumentSchemaVersion,
    InvalidRequiredFeature(String),
    InvalidLogicalName(String),
    MissingRootPayload(String),
    InvalidRootPayload,
    InvalidSha256(String),
    InvalidPayloadPath {
        actual: String,
        expected: String,
    },
    InvalidRoleMediaType {
        role: PayloadRole,
        media_type: PayloadMediaType,
    },
    LengthMismatch {
        expected: u64,
        actual: u64,
    },
    HashMismatch {
        expected: String,
        actual: String,
    },
    NonCanonicalManifest,
    UnsupportedDocumentSchemaVersion {
        found: u32,
    },
    UnsupportedRequiredFeature(String),
    MissingManifest,
    MissingLogicalPayload(String),
    UnexpectedLogicalPayload(String),
    MissingPayloadEntry {
        logical_name: String,
        path: String,
    },
    UnexpectedEntry(String),
    Archive(String),
    InvalidArchivePath(String),
    DuplicateEntry(String),
}

impl Display for PackageError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        match self {
            Self::Deserialize(error) => write!(formatter, "invalid package manifest: {error}"),
            Self::Serialize(error) => write!(formatter, "could not serialize manifest: {error}"),
            Self::UnsupportedFormatVersion { found, supported } => write!(
                formatter,
                "package format version {found} is unsupported; this reader supports version {supported}"
            ),
            Self::EmptyPackageId => formatter.write_str("package_id must not be empty"),
            Self::InvalidDocumentSchemaVersion => {
                formatter.write_str("document_schema_version must be greater than zero")
            }
            Self::InvalidRequiredFeature(feature) => {
                write!(formatter, "invalid required feature token {feature:?}")
            }
            Self::InvalidLogicalName(name) => {
                write!(formatter, "invalid logical payload name {name:?}")
            }
            Self::MissingRootPayload(name) => write!(formatter, "root payload {name:?} is missing"),
            Self::InvalidRootPayload => {
                formatter.write_str("root payload must be semantic_document Crawler document JSON")
            }
            Self::InvalidSha256(hash) => write!(formatter, "invalid lowercase SHA-256 {hash:?}"),
            Self::InvalidPayloadPath { actual, expected } => {
                write!(formatter, "payload path {actual:?} must be {expected:?}")
            }
            Self::InvalidRoleMediaType { role, media_type } => {
                write!(
                    formatter,
                    "media type {media_type:?} is not valid for role {role:?}"
                )
            }
            Self::LengthMismatch { expected, actual } => {
                write!(
                    formatter,
                    "payload length {actual} does not match declared {expected}"
                )
            }
            Self::HashMismatch { expected, actual } => {
                write!(
                    formatter,
                    "payload hash {actual} does not match declared {expected}"
                )
            }
            Self::NonCanonicalManifest => formatter.write_str("manifest bytes are not canonical"),
            Self::UnsupportedDocumentSchemaVersion { found } => write!(
                formatter,
                "document schema version {found} is unsupported by this reader"
            ),
            Self::UnsupportedRequiredFeature(feature) => write!(
                formatter,
                "required document feature {feature:?} is unsupported by this reader"
            ),
            Self::MissingManifest => formatter.write_str("package is missing manifest.json"),
            Self::MissingLogicalPayload(name) => {
                write!(formatter, "logical payload {name:?} is missing")
            }
            Self::UnexpectedLogicalPayload(name) => {
                write!(formatter, "logical payload {name:?} is not declared")
            }
            Self::MissingPayloadEntry { logical_name, path } => write!(
                formatter,
                "payload {logical_name:?} is missing declared entry {path:?}"
            ),
            Self::UnexpectedEntry(path) => {
                write!(formatter, "package entry {path:?} is not declared")
            }
            Self::Archive(message) => write!(formatter, "invalid package archive: {message}"),
            Self::InvalidArchivePath(path) => {
                write!(formatter, "package archive path {path:?} is not portable")
            }
            Self::DuplicateEntry(path) => {
                write!(
                    formatter,
                    "package archive contains duplicate entry {path:?}"
                )
            }
        }
    }
}

impl Error for PackageError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Deserialize(error) | Self::Serialize(error) => Some(error),
            _ => None,
        }
    }
}
