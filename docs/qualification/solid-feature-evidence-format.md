# Solid Feature Qualification Evidence Format

## Directory layout

```text
artifacts/solid-feature-qualification/current/
  run-metadata.json
  commands.json
  qualification-report.json
  SHA256SUMS.json
  logs/
  records/
  runtime/native/<fixture-id>.json
  runtime/release-wasm/<fixture-id>.json
  parity/parity.json
  parity/parity.junit.xml
  browser/junit.xml
  browser/screenshots/
  performance/results.json
  migration/legacy-matrix.json
```

Runtime records validate against `evidence.schema.json`. Index records under
`records` validate against `qualification-record.schema.json`. Records bind to
the candidate ID, revision, and exact manifest SHA-256; changing any manifest
byte makes earlier evidence stale.

Positive runtime records include body count, manifold and orientation state,
AABB, signed volume, surface area, centroid, analytic classifications, stable
identity sets, canonical document hash, and before/after accepted body hashes.
Negative records include structured category/code/path/entity IDs and must prove
that accepted document and body hashes did not change.

The parity runner rejects extra JSON files as unknown evidence and requires one
native and one release-WASM record for every `parity_required` fixture. Numeric
comparison uses only fixture-owned absolute and relative tolerances. Document
hashes, classifications, identities, result type, and structured errors compare
exactly.

For a topology repair, an ID in `stable_identity_sets.replaced` must have zero
current support consumers across feature inputs, sketch support, and V2 feature
definitions. Its topology-reference definition may remain in the registry so
immutable transaction history, undo, and independent branch state remain
valid; registry retention alone does not count as a live retained identity.
