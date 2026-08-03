# ADR 0001: Monstertruck kernel baseline

- Status: Accepted
- Date: 2026-07-31
- Story: E00-S01

## Context

Crawler needs one reviewed geometry baseline that compiles natively and for
`wasm32-unknown-unknown`. Following an upstream branch would allow unqualified
geometry or browser regressions to enter the product.

The upstream default `master` revision evaluated for the initial pin was
`45e5f8d6`. It failed `wasm32-unknown-unknown` compilation because its
`getrandom` dependency was not configured for that target. The Phase 5
upstream-readiness line includes that repair plus continuity and topology
tracking work, and passed the initial native and WASM checks.

Monstertruck declares two nested submodules. Geometry fixtures in `resources`
are required and available. The `.blueprints` repository supplies development
documentation only; its remote is unavailable and it is not part of the Cargo
dependency graph or the kernel contract.

## Decision

Crawler pins Monstertruck at
`e9024ba7d6bff2b8407cd382dd584f784bfa7abe` and its required `resources`
submodule at `9bf9de1426c5fc2f2b8d63f501dca0d3c53ebd91`.

The Crawler-owned qualification suite lives in
`contracts/kernel-baseline`. It exercises the native API and compiles the same
contract dependency graph for `wasm32-unknown-unknown`. The browser application
will use a Crawler-owned Rust/WASM command boundary over Monstertruck's Rust
crates rather than expose raw kernel handles to UI code.

The promotion gate is:

```powershell
./scripts/qualify-kernel.ps1
```

The gate verifies both pinned commits and clean worktrees, runs the
Crawler native executable contract, and compiles the contract plus its raw
WASM-surface dependency for the WASM target. The contract covers:

| Capability | Executed contract |
| --- | --- |
| Primitive/profile and extrusion | Closed rectangular planar profile extrudes to a six-face solid; orthogonal primitive sweeps produce a solid through `monstertruck-wasm` |
| Tessellation and render buffers | The WASM wrapper produces non-empty interleaved vertex and triangle-index buffers |
| Booleans | Union, intersection, and difference of overlapping boxes have expected tessellated volumes |
| Stable topology persistence | Assigned vertex, edge, and face stable IDs survive JSON serialization and deserialization |
| STEP I/O | A generated solid exports to STEP, reimports as a shell, and tessellates |
| Structured failures | Native profile and inspection operations preserve typed error variants |

## Promotion policy

The submodule pin may advance only in a change that:

1. Names the candidate commit and summarizes relevant upstream changes.
2. Updates the expected commit in the gate and this ADR, or adds a superseding
   ADR when the integration decision changes.
3. Initializes and records every required nested resource revision.
4. Passes the native and `wasm32-unknown-unknown` gates without weakening the
   contract or changing expected evidence merely to obtain a pass.
5. Reviews changes to topology identity, serialization, booleans, tessellation,
   STEP I/O, errors, and the raw WASM surface.

A failing capability blocks promotion. Kernel defects stay in Monstertruck;
Crawler protocol or adaptation gaps stay in Crawler. The pin remains on the last
qualified commit until the owning side supplies a passing change.

## Qualified gaps

The pinned Rust crates provide the operations needed by this contract, but the
raw `monstertruck-wasm` API is not yet a sufficient application protocol:

- Stable vertex, edge, face, tracking, and lineage identifiers are not exposed
  as queryable WASM values. JSON persistence retains underlying Rust data, but
  UI callers cannot address topology by stable ID.
- Fallible WASM calls generally collapse typed Rust errors into `Option`, log a
  string, or use assertions/panics for invalid slice lengths. They do not carry
  operation, input, recoverability, or repair context.
- Render buffers contain position, UV, normal, and index data without topology
  provenance for picking.
- `StepHeaderDescriptor` has getters and setters but no public WASM constructor,
  so the wrapper's STEP-export entry point is not independently constructible
  by a JavaScript caller.
- The wrapper does not expose wire/profile assembly needed for a constrained
  rectangle workflow, even though the Rust modeling layer supports it.

These are recorded limitations, not passing claims. E00-S02 owns the first
Crawler WASM command adapter, E00-S03 owns topology provenance in render and
picking packets, and E00-S05 owns the application-level structured error
schema. The adapter should call the qualified Rust APIs internally and must not
forward the wrapper's opaque `Option` failures as its protocol.

## Consequences

- Crawler has a repeatable promotion gate independent of the unavailable
  documentation submodule.
- Native behavior is executed in CI-capable tests; WASM compatibility is a
  compile gate until E00-S02 supplies a worker runtime.
- Stable topology exists and persists in Rust, but browser-visible stable
  references remain explicitly unimplemented until the Crawler boundary is in
  place.
- No Monstertruck source changes are required for the initial integration.
