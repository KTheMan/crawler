# ADR 0005: Share operation schemas and structured errors

- Status: Accepted
- Date: 2026-08-01
- Story: E00-S05

## Context

Crawler operations appear in command search, inspectors, persisted features,
previews, and kernel-worker commands. Defining each surface independently would
allow required inputs, units, defaults, validation, and cancellation behavior
to drift. The kernel boundary also needs machine-readable failures that retain
enough context for the inspector to focus the field a modeler can repair.

## Decision

Each operation is versioned declarative data with a stable operation ID, group,
output kind, typed input slots, exact-value parameter definitions, bounds,
choices, advanced grouping, and preview/cancellation policy. Schema version 1
contains no executable user code.

The same schema must generate the inspector model and validate the payload sent
to the worker. An operation invocation names the schema ID/version and its
feature instance, inputs, parameters, and preview generation. Unsupported
schema versions fail closed before dispatch.

Validation failures carry:

- a stable error code;
- schema and operation-instance context;
- the operation, input slot, or parameter location;
- recoverability classification; and
- one or more explicit user actions with a target field.

`contracts/operation-schema/extrude.v1.json` is the cross-language reference
definition. Rust owns durable validation and worker-command construction;
TypeScript consumes that same fixture to generate inspector fields and the
equivalent worker payload.

## Consequences

- Adding an operation requires one schema definition instead of separate UI and
  worker parameter lists.
- Schema changes require a new supported version or a deterministic migration.
- Product-specific display rendering remains a UI concern, but field meaning,
  units, defaults, selection kinds, and validation do not.
- Kernel failures may add causal diagnostics later, while preserving the
  operation context and recovery contract defined here.

## Evidence

- `cargo test -p crawler-operation-schema` passes four contract tests.
- `npm --prefix web/operation-schema test` passes three cross-boundary tests.
- The tests prove one Extrude fixture generates both inspector fields and a
  validated worker command, returns contextual recovery actions, and rejects
  unknown versions.
