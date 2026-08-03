use crawler_package::{
    DocumentKind, PackageError, PackageManifest, PayloadDescriptor, PayloadMediaType, PayloadRole,
    PortablePackage, payload_path_for_sha256,
};
use std::collections::{BTreeMap, BTreeSet};

const MANIFEST: &[u8] = include_bytes!("fixtures/manifest-v1.json");
const DOCUMENT: &[u8] = include_bytes!("fixtures/payloads/part-document.json");

#[test]
fn canonical_manifest_fixture_round_trips_byte_for_byte() {
    let manifest = PackageManifest::from_canonical_bytes(MANIFEST).unwrap();
    assert_eq!(manifest.canonical_bytes().unwrap(), MANIFEST);
    assert_eq!(manifest.package_id, "document:portable-part");
    assert_eq!(manifest.document_kind, DocumentKind::Part);
    assert_eq!(manifest.document_schema_version, 1);
    assert_eq!(
        manifest.required_features,
        BTreeSet::from(["document.core".to_owned()])
    );
    assert_eq!(manifest.document_kind.extension(), ".crawlerpart");
    assert_eq!(
        manifest.document_kind.package_media_type(),
        "application/vnd.crawler.part+zip"
    );
}

#[test]
fn root_payload_hash_length_and_path_are_verified() {
    let manifest = PackageManifest::from_canonical_bytes(MANIFEST).unwrap();
    manifest.payloads["document"]
        .verify_bytes(DOCUMENT)
        .unwrap();

    let error = manifest.payloads["document"]
        .verify_bytes(b"tampered")
        .unwrap_err();
    assert!(matches!(
        error,
        PackageError::LengthMismatch { .. } | PackageError::HashMismatch { .. }
    ));

    let mut same_length_corruption = DOCUMENT.to_vec();
    same_length_corruption[0] ^= 1;
    assert!(matches!(
        manifest.payloads["document"].verify_bytes(&same_length_corruption),
        Err(PackageError::HashMismatch { .. })
    ));
}

#[test]
fn content_paths_require_exact_lowercase_sha256() {
    assert!(payload_path_for_sha256(&"a".repeat(64)).is_ok());
    assert!(payload_path_for_sha256(&"A".repeat(64)).is_err());
    assert!(payload_path_for_sha256("../manifest.json").is_err());

    let mut descriptor = PayloadDescriptor::from_bytes(
        PayloadRole::SemanticDocument,
        PayloadMediaType::CrawlerDocumentJson,
        DOCUMENT,
    );
    descriptor.path = "payloads/document.json".into();
    assert!(matches!(
        descriptor.validate(),
        Err(PackageError::InvalidPayloadPath { .. })
    ));
}

#[test]
fn unknown_versions_and_noncanonical_bytes_fail_closed() {
    let unsupported = String::from_utf8(MANIFEST.to_vec()).unwrap().replacen(
        "\"format_version\":1",
        "\"format_version\":2",
        1,
    );
    assert!(matches!(
        PackageManifest::from_canonical_bytes(unsupported.as_bytes()),
        Err(PackageError::UnsupportedFormatVersion {
            found: 2,
            supported: 1
        })
    ));

    let pretty: serde_json::Value = serde_json::from_slice(MANIFEST).unwrap();
    let pretty = serde_json::to_vec_pretty(&pretty).unwrap();
    assert!(matches!(
        PackageManifest::from_canonical_bytes(&pretty),
        Err(PackageError::NonCanonicalManifest)
    ));
}

#[test]
fn verified_entry_set_round_trips_without_hidden_machine_state() {
    let manifest = PackageManifest::from_canonical_bytes(MANIFEST).unwrap();
    let package = PortablePackage::from_payloads(
        manifest,
        BTreeMap::from([("document".into(), DOCUMENT.to_vec())]),
    )
    .unwrap();

    let entries = package.canonical_entries().unwrap();
    let restored = PortablePackage::from_entries(entries.clone()).unwrap();
    assert_eq!(restored, package);
    assert_eq!(restored.canonical_entries().unwrap(), entries);
    assert_eq!(restored.payload("document"), Some(DOCUMENT));

    let mut with_view_state = entries;
    with_view_state.insert("view/camera.json".into(), br#"{"zoom":1}"#.to_vec());
    assert!(matches!(
        PortablePackage::from_entries(with_view_state),
        Err(PackageError::UnexpectedEntry(path)) if path == "view/camera.json"
    ));
}

#[test]
fn missing_and_corrupt_package_entries_have_typed_failures() {
    assert!(matches!(
        PortablePackage::from_entries(BTreeMap::new()),
        Err(PackageError::MissingManifest)
    ));

    let manifest = PackageManifest::from_canonical_bytes(MANIFEST).unwrap();
    let package = PortablePackage::from_payloads(
        manifest,
        BTreeMap::from([("document".into(), DOCUMENT.to_vec())]),
    )
    .unwrap();
    let entries = package.canonical_entries().unwrap();
    let document_path = package.manifest().payloads["document"].path.clone();

    let mut missing = entries.clone();
    missing.remove(&document_path);
    assert!(matches!(
        PortablePackage::from_entries(missing),
        Err(PackageError::MissingPayloadEntry { logical_name, path })
            if logical_name == "document" && path == document_path
    ));

    let mut corrupt = entries;
    let bytes = corrupt.get_mut(&document_path).unwrap();
    bytes[0] ^= 1;
    assert!(matches!(
        PortablePackage::from_entries(corrupt),
        Err(PackageError::HashMismatch { .. })
    ));

    let manifest = PackageManifest::from_canonical_bytes(MANIFEST).unwrap();
    let payloads = BTreeMap::from([
        ("document".into(), DOCUMENT.to_vec()),
        ("view-cache".into(), b"machine-local".to_vec()),
    ]);
    assert!(matches!(
        PortablePackage::from_payloads(manifest, payloads),
        Err(PackageError::UnexpectedLogicalPayload(name)) if name == "view-cache"
    ));
}

#[test]
fn required_schema_and_feature_compatibility_is_explicit() {
    let manifest = PackageManifest::from_canonical_bytes(MANIFEST).unwrap();
    let no_versions = BTreeSet::new();
    let no_features = BTreeSet::new();
    assert!(matches!(
        manifest.ensure_compatible(&no_versions, &no_features),
        Err(PackageError::UnsupportedDocumentSchemaVersion { found: 1 })
    ));

    let versions = BTreeSet::from([1]);
    assert!(matches!(
        manifest.ensure_compatible(&versions, &no_features),
        Err(PackageError::UnsupportedRequiredFeature(feature))
            if feature == "document.core"
    ));

    let features = BTreeSet::from(["document.core".to_owned()]);
    manifest.ensure_compatible(&versions, &features).unwrap();
}

#[test]
fn imported_geometry_asset_is_content_addressed_and_round_trips() {
    let mut manifest = PackageManifest::from_canonical_bytes(MANIFEST).unwrap();
    let step = b"ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n";
    manifest.payloads.insert(
        "source-step".into(),
        PayloadDescriptor::from_bytes(PayloadRole::ImportedGeometry, PayloadMediaType::Step, step),
    );
    let package = PortablePackage::from_payloads(
        manifest,
        BTreeMap::from([
            ("document".into(), DOCUMENT.to_vec()),
            ("source-step".into(), step.to_vec()),
        ]),
    )
    .unwrap();
    let restored = PortablePackage::from_entries(package.canonical_entries().unwrap()).unwrap();
    assert_eq!(restored.payload("source-step"), Some(step.as_slice()));
}

#[test]
fn executable_payload_roles_and_media_types_are_unrepresentable() {
    let encoded = br#"{"role":"semantic_document","media_type":"javascript","byte_length":0,"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","path":"payloads/sha256/aa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}"#;
    assert!(serde_json::from_slice::<PayloadDescriptor>(encoded).is_err());

    let descriptor = PayloadDescriptor::from_bytes(
        PayloadRole::ImportedGeometry,
        PayloadMediaType::CrawlerDocumentJson,
        b"{}",
    );
    assert!(matches!(
        descriptor.validate(),
        Err(PackageError::InvalidRoleMediaType { .. })
    ));
}

#[test]
fn portable_zip_is_byte_stable_and_round_trips_complete_history() {
    let manifest = PackageManifest::from_canonical_bytes(MANIFEST).unwrap();
    let package = PortablePackage::from_payloads(
        manifest,
        BTreeMap::from([("document".into(), DOCUMENT.to_vec())]),
    )
    .unwrap();

    let first = package.to_archive_bytes().unwrap();
    let second = package.to_archive_bytes().unwrap();
    assert_eq!(first, second);
    assert!(first.starts_with(b"PK\x03\x04"));
    assert_eq!(
        PortablePackage::from_archive_bytes(&first).unwrap(),
        package
    );
}

#[test]
fn malformed_archive_fails_without_manufacturing_a_package() {
    assert!(matches!(
        PortablePackage::from_archive_bytes(b"not a ZIP"),
        Err(PackageError::Archive(_))
    ));
}
