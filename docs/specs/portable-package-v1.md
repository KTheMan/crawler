# Crawler portable package format version 1

## Scope

This specification defines the portable container contract, canonical
manifest, payload addressing, and state boundaries. It does not define save UI,
archive-writing APIs, reference resolution, or migrations beyond version 1.

## Container and document family

A package is a ZIP container containing forward-slash paths. Parts,
assemblies, and drawings are separate packages:

| Kind | Extension | Package MIME |
| --- | --- | --- |
| `part` | `.crawlerpart` | `application/vnd.crawler.part+zip` |
| `assembly` | `.crawlerasm` | `application/vnd.crawler.assembly+zip` |
| `drawing` | `.crawlerdraw` | `application/vnd.crawler.drawing+zip` |

The extension is a transport hint. Readers validate `manifest.json` and do not
select behavior from the filename alone.

## Required layout

```text
manifest.json
payloads/sha256/ab/cdef...  # 64 lowercase hex digits total
```

Archive entries outside `manifest.json` and manifest-declared payload paths are
invalid. Paths are ASCII, relative, forward-slash separated, contain no empty,
`.` or `..` segments, and are derived rather than supplied by a filename.

The deterministic package contract is the canonical `manifest.json` byte
sequence plus the exact set of declared content-addressed payload bytes. ZIP
entry order, compression choice, timestamps, host attributes, comments, and
other container metadata are not semantic package state. A canonical ZIP
writer may normalize those values to produce a byte-identical archive, but a
reader compares and versions packages by the canonical manifest and payload
set rather than by incidental ZIP metadata.

`manifest.json` is UTF-8 without BOM, compact JSON, followed by exactly one LF.
Keys of manifest structs occur in the order shown below. `required_features`
is lexically sorted with no duplicates. `payloads` is a JSON object whose
logical-name keys are lexically sorted. No insignificant whitespace is allowed.

## Canonical manifest

Fields occur in this order:

1. `format_version`: integer `1`.
2. `package_id`: stable non-empty document/package identity.
3. `document_kind`: `part`, `assembly`, or `drawing`.
4. `document_schema_version`: positive document schema version.
5. `required_features`: sorted portable feature tokens a reader must support.
6. `root_payload`: logical name of the semantic root payload.
7. `payloads`: sorted logical names mapped to descriptors.

Payload descriptor fields occur in this order:

1. `role`: `semantic_document` or `imported_geometry`.
2. `media_type`: `application/vnd.crawler.document+json` or `model/step`.
3. `byte_length`: exact uncompressed byte length.
4. `sha256`: 64 lowercase hexadecimal SHA-256 characters.
5. `path`: `payloads/sha256/<sha256[0..2]>/<sha256[2..64]>`.

The root descriptor must pair `semantic_document` with
`application/vnd.crawler.document+json`. `imported_geometry` pairs only with
`model/step`. Unknown enum values, role/media-type pairings, versions, required
fields, or struct fields fail closed.

`required_features` tokens contain only lowercase ASCII letters, digits, `.`,
`-`, `_`, `:`, or `/`. A reader that does not support every listed token must
report the first unsupported feature as a typed compatibility failure before
interpreting the root document. A reader likewise reports an unsupported
`document_schema_version` separately from an unsupported package
`format_version`; these are distinct compatibility dimensions.

## Hash and path verification

For each descriptor, a reader:

1. validates the lowercase SHA-256 spelling;
2. derives the expected path from that digest and requires exact equality;
3. reads exactly `byte_length` uncompressed bytes;
4. computes SHA-256 over those bytes and requires exact digest equality.

These checks occur before semantic decoding. Multiple logical names may point
to identical content. Unreferenced archive entries are invalid rather than
implicit content.

The minimum typed validation outcomes exposed by an implementation are:

- unsupported package format version;
- unsupported document schema version;
- unsupported required feature;
- noncanonical or malformed manifest;
- missing manifest or declared payload;
- undeclared archive entry;
- payload length mismatch; and
- payload SHA-256 mismatch.

This distinction lets callers explain compatibility problems without
misreporting them as corruption, and corruption without interpreting any
unverified document or asset bytes.

## Schema versions

Package `format_version` versions the manifest and layout. The independent
`document_schema_version` versions semantic root JSON. Unknown package versions
fail before payload access. Required semantic capabilities are explicit in
`required_features`; absence means only the named document-schema baseline is
required. Version-1 migration behavior is not defined by this specification.

## State boundaries

The package contains semantic model state only: identities, units, parameters,
sketches, declarative operations/history, stable references, and source
interchange payloads required to reproduce the accepted document.

Document identity, document kind, document schema version, required feature
tokens, payload roles/media types, byte lengths, hashes, and paths are the only
version-1 package metadata. Assets are explicit, manifest-declared immutable
payloads; version 1 admits imported STEP geometry and does not discover assets
from directories, host preferences, environment variables, recent-file state,
or other machine-local sources.

The following never enter `manifest.json`, package payloads, semantic hashes,
or canonical diffs:

- camera, viewport, selection, hover, panel layout, and other view preferences;
- tessellation, render packets, kernel objects, indexes, and other caches;
- autosave/recovery journals, locks, temporary files, and in-flight commands.

Implementations may store volatile state under an OS-specific user-state area
and recovery journals under an OS-specific recovery area. Those stores are not
portable package members and must be safe to delete without changing the last
accepted semantic revision.

## No executable content

Version 1 has no executable payload role or media type. Packages must not embed
or request evaluation of JavaScript, WebAssembly, native libraries, shell
commands, plugins, macros, or arbitrary user source code. Operation history is
declarative data identified by supported operation schema IDs. Readers do not
infer executable behavior from extensions, MIME sniffing, JSON strings, or
unknown fields.
