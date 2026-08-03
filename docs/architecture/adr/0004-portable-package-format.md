# ADR 0004: Portable package format

- Status: Accepted
- Date: 2026-07-31
- Story: E08-S01

## Context

Crawler must preserve parametric semantics while allowing parts, assemblies,
and drawings to evolve and be versioned independently. A monolithic project
archive would make a drawing edit rewrite unrelated part and assembly state,
complicate source revision references, and obscure useful repository history.
Loose directories, meanwhile, are easy to partially copy and do not provide a
single portable artifact.

The format must also keep deterministic semantic state distinct from camera,
selection, caches, and crash recovery. A package must never become a mechanism
for distributing executable user code.

## Decision

Parts, assemblies, and derived drawings are **separate files in one related
package family**. Each file is an independently portable ZIP container using a
common version-1 manifest and content-addressed payload layout:

| Document | Extension | MIME type |
| --- | --- | --- |
| Part | `.crawlerpart` | `application/vnd.crawler.part+zip` |
| Assembly | `.crawlerasm` | `application/vnd.crawler.assembly+zip` |
| Drawing | `.crawlerdraw` | `application/vnd.crawler.drawing+zip` |

Assemblies and drawings refer to source document identity, semantic revision,
and content digest from their declarative document data. They do not silently
copy another document's editable history into their own package.

Every package has canonical `manifest.json` bytes and immutable payloads at
`payloads/sha256/<first-two-hex>/<remaining-62-hex>`. Version 1 admits only the
declarative Crawler document JSON payload and source STEP geometry. Script,
module, plugin, macro, native-library, and generic executable payload kinds do
not exist in the schema. Consumers must treat document operation history as
data and must not evaluate fields as source code.

Only semantic state enters the portable package and its manifest. Volatile
view state, render/kernel caches, and recovery journals use external local
stores and are excluded from hashes and canonical saves. The normative layout
and canonicalization rules are in `docs/specs/portable-package-v1.md`.

The canonical identity used for validation, diffing, and repeat-save checks is
the canonical manifest plus its exact declared payload set. Incidental ZIP
metadata is not semantic state. Readers reject undeclared entries and expose
package-version, document-schema, required-feature, missing-content, length,
and checksum failures as distinct outcomes before semantic decoding.

## Consequences

- Source documents can be revised, reviewed, and transferred independently.
- A package can be validated before any document is interpreted.
- Equal payload bytes share the same archive path and detect corruption by
  length plus SHA-256.
- Implementations can distinguish an incompatible reader from a corrupt
  transfer and can validate a complete unpacked entry set deterministically.
- Undeclared view, cache, recovery, host, or timestamp entries are invalid, so
  machine-local state cannot silently enter the canonical package.
- MIME sniffing does not grant permission to execute content; unknown payload
  media types fail closed.
- ZIP writing/reading, canonical archive metadata, save/load UI, reference
  resolution, and migrations beyond version 1 remain follow-up work.
