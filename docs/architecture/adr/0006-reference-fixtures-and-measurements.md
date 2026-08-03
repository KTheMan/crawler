# ADR 0006: Reference fixtures and measurement evidence

- Status: Accepted
- Date: 2026-08-01
- Story: E00-S06

## Context

Correctness and performance claims are not comparable when they use unnamed
models, changing geometry, unrecorded devices, or ambiguous warm/cold states.
Third-party CAD models also create provenance and redistribution uncertainty
unless their license and exact source are durable parts of the fixture.

## Decision

Crawler owns a versioned, machine-readable reference catalog under
`fixtures/reference-models/`. Every fixture records an exact document byte
length and SHA-256, document schema/revision, stable-topology expectations,
geometric evidence, artifact hashes, SPDX license scope, and provenance.
Validation parses semantic documents with the real `crawler-document` schema
and rejects undeclared machine-local state.

The initial public mechanical part is an original Crawler mounting bracket
dedicated under CC0-1.0. The cube, STEP samples, and intentional missing and
ambiguous topology cases are likewise original/project-generated CC0 data.
This avoids inventing or depending on third-party provenance while permitting
unrestricted copying of the evidence corpus.

Performance evidence follows
`docs/measurements/reference-measurement-protocol-v1.md`. A result identifies
the exact fixture hash and revision, source/build revision, device class,
environment, cold or warm preparation, raw observations, nearest-rank
p50/p95/p99 summaries, and fixture licensing/provenance. Cold and warm samples
are never pooled.

## Consequences

- A changed document or STEP byte sequence is detected before a claim is
  compared with historical evidence.
- Resolved, missing, and ambiguous stable-topology outcomes are explicit test
  data instead of informal screenshots.
- Bounds, volume, surface-area, and STEP point/bounds evidence are portable and
  can be checked without trusting a rendering environment.
- Measurements can be reproduced or rejected as non-equivalent based on the
  recorded subject, build, device, and state.
- The fixture catalog is evidence, not a benchmark result. Real measurements
  must retain raw samples and cannot be populated from estimates.
