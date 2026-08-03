# ADR 0003: Parametric document contract

- Status: Accepted
- Date: 2026-07-31
- Story: E00-S04

## Context

Feature evaluation, persistence, transactions, undo, recovery, and the browser
UI need one durable document meaning. Keeping authoritative model state in UI
components or encoding identity in names and array positions would make
recompute and version control nondeterministic.

## Decision

Crawler's authoritative version-1 document schema is defined in the Rust
`crawler-document` crate and mirrored by the TypeScript document protocol.

- Every durable entity has a typed semantic ID distinct from its display name
  and presentation order.
- Maps use deterministic lexical key ordering. Vectors are used only when their
  order is semantic, such as the feature timeline and transaction changes.
- Dimensional values use exact integer base units. Documents contain no
  executable user code.
- Features reference versioned declarative operation schemas and typed inputs.
- Topology references retain the owning body and producer, kernel stable ID,
  semantic token, and a deterministic fallback geometric signature.
- Transactions and accepted recompute facts are durable. Selection, hover,
  active recompute work, and render-cache keys are process-local transient state.
- Unknown document schema versions fail closed. Schema changes require a
  deterministic migration before a newer version can be accepted.

The canonical fixtures live with the Rust crate and must round-trip byte for
byte through both Rust and TypeScript implementations.

## Consequences

- UI code can project and edit the document but cannot become its authority.
- Renaming or reordering an entity does not change its identity.
- Canonical serialization is suitable for later content addressing and
  structural diff work.
- JavaScript numbers exactly represent only integers in the safe-integer range.
  Version 1 fixtures remain inside that range; the portable-package decision
  must encode larger integer values without loss.
- The TypeScript parser currently gates the top-level object and schema version
  while compile-time types describe the remaining shape. Portable-file loading
  must add exhaustive runtime validation before accepting untrusted documents.
