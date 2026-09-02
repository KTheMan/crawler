# Crawler Implementation Backlog

- Status: M0-M3 part-design alpha implementation complete under automated
  coverage; private-alpha exit still depends on the manual, device, independent
  reader, and external-user gates below
- Date: 2026-07-31
- Last status review: 2026-08-02
- Source: [Crawler Product Requirements](PRODUCT_REQUIREMENTS.md)
- Product target: Browser-based, desktop-class parametric CAD

## 1. Planning assumptions

- The alpha is part-design-first. Assemblies influence the document schema but
  do not block the parametric-cube vertical slice.
- Monstertruck is pinned by exact commit and accessed through a versioned Crawler
  kernel contract.
- The parametric document engine runs in Rust/WASM outside the UI main thread.
- The browser, inspector, viewport, and timeline are views of one authoritative
  document; they do not maintain competing model state.
- Portable part, assembly, and derived drawing documents retain history and are
  designed for deterministic version control.
- Code-linked modeling is not a goal.
- A dependency-canvas environment is a later optional addon, analogous to
  Grasshopper beside Rhino, not a second core Crawler interface.
- Story IDs are stable planning identifiers. They can become external tracker
  keys later without changing this document.

## 2. Priority and milestone vocabulary

| Label | Meaning |
| --- | --- |
| P0 | Required to unlock or complete the current milestone |
| P1 | Required before private alpha |
| P2 | Beta or post-alpha capability |
| M0 | Architecture spikes and contracts |
| M1 | Parametric cube vertical slice |
| M2 | Useful part modeling |
| M3 | Private alpha hardening |
| Beta | Assemblies, derived drawings, and broader workflows |
| Later | Addons and advanced product surfaces |

M0 resolved the worker, renderer, document, operation, and kernel boundaries.
Status below distinguishes automated implementation evidence from manual or
external evidence required for a milestone exit.

## 3. Definition of ready

A story is ready when:

- Its user-visible or developer-visible outcome is unambiguous.
- Required upstream ADRs and dependencies are resolved.
- Acceptance criteria identify the relevant document, geometry, and UI state.
- Test fixtures or reference models are named when geometry is involved.
- Failure behavior is specified, not just the success path.
- Any portable-format change identifies its schema and migration impact.

## 4. Definition of done

A story is done when:

- Acceptance criteria pass with automated coverage at the narrowest useful
  layer and at least one integration path where applicable.
- The UI main thread is not blocked by kernel computation.
- Errors are structured and surfaced at the operation or document boundary.
- Undo/redo, save/load, and recompute behavior are covered for durable edits.
- Stable topology and entity identities survive the tested workflow.
- Keyboard and focus behavior are included for new interactive controls.
- Performance-sensitive work records measurements against the reference model.
- Relevant ADRs, schemas, and user-facing documentation are updated.

## 5. Delivery map

| Sequence | Milestone | Primary epics | Status | Exit evidence |
| --- | --- | --- | --- | --- |
| 1 | M0 | E00, E03, E08 | Complete | ADRs, measured spikes, contract tests |
| 2 | M1 | E01–E06, E08 | Core vertical slice qualified | Cube survives edit, undo, reload, and export |
| 3 | M2 | E04–E08 | Automated implementation complete | Reference mechanical part and durable browser workflows pass executable contracts |
| 4 | M3 | E09 | Automated hardening complete; manual/device/external-user evidence pending | External users model and recover without developer help |
| 5 | Beta | E10, E11 | Not started | Portable assemblies and associative drawings |
| 6 | Later | E12 | Not started | Optional visual-programming addon contract and prototype |

---

## E00 — Architecture and integration contracts

**Outcome:** Crawler has measured, documented boundaries that implementation
teams can build against without reopening foundational decisions in every story.

### E00-S01 — Pin and qualify the Monstertruck baseline

**Milestone/Priority:** M0 / P0

**Depends on:** None

**Story:** As a Crawler developer, I need a qualified kernel baseline so kernel
upgrades are deliberate and regressions are caught before reaching the UI.

**Acceptance criteria:**

- The exact Monstertruck source revision and promotion policy are recorded in
  `Cargo.lock` and an ADR.
- Native and `wasm32-unknown-unknown` contract checks cover construction,
  tessellation, booleans, stable IDs, and STEP I/O.
- A failed contract prevents advancing the locked Git revision.
- The contract suite runs without nested submodule initialization.

**Status:** Complete (2026-07-31)

**Evidence:**

- [ADR 0001](architecture/adr/0001-monstertruck-kernel-baseline.md) records the
  initial kernel/resource pins and qualified raw-WASM API gaps; [ADR 0008](architecture/adr/0008-monstertruck-git-dependencies.md)
  replaces its Git-submodule distribution decision.
- `contracts/kernel-baseline/tests/kernel_contract.rs` executes six native
  contracts covering profile extrusion, WASM render buffers, booleans, stable
  ID persistence, STEP round-trip behavior, and typed native failures.
- `./scripts/qualify-kernel.ps1` verifies that every Monstertruck package is
  locked to one `dev` revision, runs the native suite, and compiles it for
  `wasm32-unknown-unknown`.
- Browser-boundary follow-up is fulfilled by E00-S02 (versioned worker adapter),
  E00-S03 (topology provenance), and E00-S05 (structured protocol errors).

### E00-S02 — Prove worker-hosted kernel commands

**Milestone/Priority:** M0 / P0

**Depends on:** E00-S01

**Story:** As a modeler, I need geometry work off the UI thread so interaction
remains responsive during previews and recomputes.

**Acceptance criteria:**

- The UI sends a versioned command envelope to a worker-hosted WASM engine and
  receives typed progress, result, cancellation, and error events.
- A long-running fixture can be cancelled without corrupting the document.
- Stale preview results cannot overwrite a newer command result.
- Round-trip latency and transferred bytes are recorded for the reference cube.

**Status:** Complete (2026-08-01)

**Evidence:**

- `crates/crawler-kernel-worker` owns the versioned command/event adapter,
  structured failures, acknowledged state, cancellation, and target-safe timing;
  seven native tests pass, including the exact rectangular-prism M1 command.
- `web/worker-spike` loads the dev-generated Rust/WASM adapter in actual Node and
  browser module workers. Eight Node tests prove protocol compatibility,
  structured errors, transferable mesh buffers, cancellation without state
  acknowledgement, stale-result rejection, exact edited bounds, and typed
  failure-state preservation.
- [The worker spike report](spikes/E00-S02-worker-kernel-commands.md) records the
  explicit pinned-kernel tessellation gap and bounded Crawler adapter. Chrome 150
  measured ten cold and ten warm cube runs at 912 transferred bytes: cold
  end-to-end p50/p95 23.7/101.5 ms and warm p50/p95 1.1/1.4 ms.
  A fresh M1 Chrome run additionally records exact 10 x 20 x 30 mm extrusion
  bounds and cold/warm end-to-end p50/p95 of 41.7/175.9 ms and 1.3/85.0 ms.

### E00-S03 — Select the renderer boundary with topology picking

**Milestone/Priority:** M0 / P0

**Depends on:** E00-S01, E00-S02

**Story:** As an implementation team, we need evidence for the renderer boundary
so viewport work starts on a path that preserves topology identity.

**Acceptance criteria:**

- Both in-WASM `wgpu` rendering and transferable render packets are evaluated,
  or an ADR explains why one cannot be evaluated.
- The spike renders a solid and uniquely picks a face and edge by stable ID.
- Build size, buffer-copy cost, highlight latency, fallback feasibility, and
  worker implications are measured.
- The selected path and rejected tradeoffs are recorded in an ADR.

**Status:** Complete (2026-08-01)

**Evidence:**

- [ADR 0002](architecture/adr/0002-renderer-boundary.md) selects versioned
  transferable provenance packets with Three.js/WebGL2 and records why the
  bounded Monstertruck wgpu arm is deferred.
- `crates/crawler-render-packet` passes four native contracts for stable
  face/edge/vertex IDs and retessellation; the native wgpu probe passes one
  type-link test.
- The Chrome 150 Playwright suite passes 4/4 tests for detached worker buffers,
  WebGL2 fallback, and stable face, edge, and vertex picking. Results record
  1,816 transferred bytes, 14.0 ms packet construction, 2.7 ms copy time, 300
  picks at p50/p95 0.10/0.20 ms, 600 frame intervals, and artifact sizes.

### E00-S04 — Define the parametric document contract

**Milestone/Priority:** M0 / P0

**Depends on:** E00-S01

**Story:** As a feature developer, I need one authoritative document contract so
features, persistence, undo, and recompute share the same semantics.

**Acceptance criteria:**

- Stable schemas exist for documents, components, bodies, sketches, features,
  parameters, topology references, transactions, and recompute state.
- Entity identity is distinct from display name and storage position.
- Durable document state is separated from transient UI and cache state.
- Schema fixtures deserialize deterministically in Rust and the UI protocol.

**Status:** Complete (2026-07-31)

**Evidence:**

- [ADR 0003](architecture/adr/0003-parametric-document-contract.md) records the
  durable/transient boundary, identity, exact-value, topology-reference, and
  compatibility decisions.
- `crates/crawler-document` defines the versioned Rust schema and two canonical
  fixtures; four Rust tests cover canonical round trips, identity, and closed
  version handling.
- `web/document-protocol` mirrors the schema in TypeScript; four Node tests read
  the Rust fixtures and prove deterministic cross-language serialization.

### E00-S05 — Define operation schemas and structured errors

**Milestone/Priority:** M0 / P0

**Depends on:** E00-S02, E00-S04

**Story:** As a modeler, I need operations to behave consistently so I can see
their inputs, parameters, preview, validation, and result in one place.

**Acceptance criteria:**

- One typed schema describes operation identity, input slots, parameters,
  selection kinds, validation, preview strategy, and output kind.
- A sample Extrude schema drives both a worker command and a generated inspector
  form without duplicate parameter definitions.
- Structured errors carry operation, input/parameter, recoverability, and
  user-action context.
- Unknown schema versions fail closed with a useful compatibility error.

**Status:** Complete (2026-08-01)

**Evidence:**

- [ADR 0005](architecture/adr/0005-operation-schema-and-errors.md) records the
  shared declarative schema, worker-dispatch, compatibility, and recovery
  contracts.
- `contracts/operation-schema/extrude.v1.json` is consumed by both
  `crates/crawler-operation-schema` and `web/operation-schema`; it defines the
  Extrude identity, profile slot, exact-value parameters, bounds, generated-form
  hints, and replace-older-preview behavior once.
- Four Rust tests validate worker-command construction, contextual structured
  errors, deterministic serialization, and fail-closed versions. Three Node
  tests prove the same fixture generates inspector fields and worker parameters.

### E00-S06 — Establish reference models and measurements

**Milestone/Priority:** M0 / P0

**Depends on:** E00-S01, E00-S03, E00-S04

**Story:** As a product team, we need shared reference models so correctness and
performance claims refer to reproducible evidence.

**Acceptance criteria:**

- Fixtures include a parametric cube, a public mechanical reference part, STEP
  import/export samples, and intentional topology-break cases.
- Each fixture records expected document hash, topology assertions, and visual
  or geometric evidence appropriate to the test.
- Performance measurement defines device class, model revision, warm/cold state,
  and percentile reporting.
- Fixture licensing and provenance are recorded.

**Status:** Complete (2026-08-01)

**Evidence:**

- [ADR 0006](architecture/adr/0006-reference-fixtures-and-measurements.md)
  defines the versioned corpus and evidence policy; the matching measurement
  protocol requires exact fixture/build revisions, device class, cold/warm
  preparation, raw samples, and nearest-rank p50/p95/p99 reporting.
- `fixtures/reference-models` contains a parametric cube, original CC0 mounting
  bracket, hashed STEP import/export pair, and missing/ambiguous topology cases.
  Every fixture records an exact hash, provenance/license, topology assertions,
  and geometric evidence.
- `crates/crawler-reference-fixtures` passes three tests that parse documents
  through `crawler-document`, validate the full catalog and STEP bounds, and
  reject hidden machine-local state.
- `crates/crawler-alpha-reference` now compiles the CC0 mounting-bracket fixture's
  declared sketch, dependencies, feature parameters, patterns, and paired
  through-prism cuts through the public feature-kernel contract. Native tests
  assert ordered operation evidence, final manifold geometry, volume reduction,
  stable hashes, and byte determinism; the qualification report has no recorded
  geometry contract gaps.

---

## E01 — Application shell and interaction system

**Outcome:** Users can enter a stable CAD workspace, navigate the viewport, and
complete operations through one predictable interaction lifecycle.

### E01-S01 — Boot the workspace and kernel visibly

**Milestone/Priority:** M1 / P0

**Depends on:** E00-S02, E00-S03

**Story:** As a modeler, I need the application to load into a useful workspace
with honest progress so I know when modeling is ready.

**Acceptance criteria:**

- The app displays separate UI, WASM, worker, and renderer readiness states.
- Load failure offers retry and diagnostics without presenting an editable
  document.
- Successful load opens a blank part document with browser, viewport, inspector,
  and timeline regions.
- Cold interactive load is measured against the five-second product budget.

### E01-S02 — Provide the history-first workspace layout

**Milestone/Priority:** M1 / P0

**Depends on:** E01-S01, E00-S04

**Story:** As a modeler, I need object, operation, and history views to have clear
roles so I never wonder which panel owns the model.

**Acceptance criteria:**

- The browser answers what exists; the inspector answers what can change; the
  timeline answers how the result was built.
- Selecting an entity synchronizes all applicable views through document IDs.
- Panel resizing and visibility are transient preferences, not semantic model
  changes.
- The viewport remains the largest default workspace region at supported desktop
  sizes.

### E01-S03 — Navigate the viewport predictably

**Milestone/Priority:** M1 / P0

**Depends on:** E01-S01, E00-S03

**Story:** As a modeler, I need orbit, pan, zoom, fit, and standard views so I can
inspect a part without fighting the camera.

**Acceptance criteria:**

- Perspective and orthographic cameras support orbit, pan, zoom, fit, and named
  standard views.
- The default navigation convention is documented and does not conflict with
  selection or manipulators.
- Camera interaction maintains 60 fps on the cube fixture.
- Camera state is saved as view state and excluded from semantic model diffs.

**Status:** Automated camera and view-state contracts complete; representative-
device 60 fps validation pending.

### E01-S04 — Run the shared operation lifecycle

**Milestone/Priority:** M1 / P0

**Depends on:** E00-S05, E01-S02

**Story:** As a modeler, I need every command to collect inputs, preview, validate,
and commit consistently so operations are learnable.

**Acceptance criteria:**

- An operation visibly moves through invoke, collect, preview, validate, commit,
  and recompute states.
- `Enter` commits and `Escape` cancels when valid for the current state.
- Cancelling leaves no durable document transaction or orphan geometry.
- Invalid input is explained beside the relevant inspector slot.

### E01-S05 — Find and operate commands by keyboard

**Milestone/Priority:** M3 / P1

**Depends on:** E01-S04

**Story:** As a keyboard-oriented modeler, I need command search and complete
focus behavior so common work does not require toolbar hunting.

**Acceptance criteria:**

- Command search invokes every enabled operation and explains disabled results.
- Browser, inspector, timeline, and operation fields have visible, logical focus
  order.
- Shortcut conflicts are detected and documented.
- New-command keyboard flows pass an accessibility smoke test.

---

## E02 — Parametric document engine and transactions

**Outcome:** Durable model state is deterministic, transactional, recoverable,
and independent of the UI implementation.

### E02-S01 — Create an authoritative part document

**Milestone/Priority:** M1 / P0

**Depends on:** E00-S04

**Story:** As a modeler, I need a new part document with stable origin entities so
all later features have reliable inputs.

**Acceptance criteria:**

- Creating a document assigns stable IDs and default units deterministically.
- XY, XZ, and YZ origin planes and the origin coordinate system are addressable
  but not ordinary generated features.
- The same creation command produces the same semantic document hash.
- The browser displays the new document without manufacturing extra model state.

### E02-S02 — Apply atomic document transactions

**Milestone/Priority:** M1 / P0

**Depends on:** E02-S01, E00-S05

**Story:** As a modeler, I need edits to commit atomically so failed operations do
not leave half-mutated models.

**Acceptance criteria:**

- A transaction validates before replacing the accepted document state.
- Failed feature creation preserves the prior document hash and geometry.
- One user commit produces one undo entry even when it updates several entities.
- Transaction events identify affected entities and dirty graph roots.

### E02-S03 — Undo and redo durable edits

**Milestone/Priority:** M1 / P0

**Depends on:** E02-S02

**Story:** As a modeler, I need reliable undo and redo so exploration is safe.

**Acceptance criteria:**

- Create, edit, rename, suppress, delete, and parameter transactions restore
  expected document hashes through undo and redo.
- Timeline rollback remains separate from undo/redo.
- A new edit after undo invalidates only the unreachable redo branch.
- Undo/redo after a failed operation leaves the accepted document unchanged.

### E02-S04 — Autosave and recover accepted work

**Milestone/Priority:** M1 / P0

**Depends on:** E02-S02, E08-S02

**Story:** As a modeler, I need accepted changes journaled locally so a reload or
worker crash does not erase my work.

**Acceptance criteria:**

- Accepted transactions are journaled and periodically checkpointed without a
  main-thread long task.
- Reload restores the latest valid checkpoint plus accepted journal entries.
- A corrupt or incompatible tail is isolated and explained rather than applied.
- Recovery never replaces an explicitly saved file without user action.

---

## E03 — Kernel bridge, rendering, and selection provenance

**Outcome:** Geometry crosses the kernel boundary with enough identity and error
information for reliable rendering, selection, and feature references.

### E03-S01 — Produce provenance-rich render packets

**Milestone/Priority:** M1 / P0

**Depends on:** E00-S03, E00-S04

**Story:** As a modeler, I need visible geometry to retain its source identities
so selecting a rendered face selects the correct model entity.

**Acceptance criteria:**

- Render output includes positions, normals, indices, bounds, and topology
  provenance required by the selected renderer path.
- Buffers transfer or bind without unnecessary copies documented by the ADR.
- Re-tessellation preserves stable face/edge selection identities when topology
  is unchanged.
- Render packets are disposable caches and are excluded from semantic saves.

### E03-S02 — Preselect and select topology

**Milestone/Priority:** M1 / P0

**Depends on:** E03-S01, E01-S03

**Story:** As a modeler, I need hover and click feedback for bodies, faces, edges,
and vertices so operation inputs are precise.

**Acceptance criteria:**

- Hover preselection and click selection resolve to stable model references.
- Body, face, edge, and vertex filters constrain both highlighting and accepted
  operation inputs.
- Multi-selection has deterministic ordering where operation semantics require
  it.
- Hidden, suppressed, or stale topology cannot be selected.

### E03-S03 — Surface structured kernel failures

**Milestone/Priority:** M1 / P0

**Depends on:** E00-S05, E02-S02

**Story:** As a modeler, I need kernel failures translated into actionable
operation errors instead of `None`, panics, or console-only messages.

**Acceptance criteria:**

- Kernel bridge results distinguish invalid input, unsupported operation,
  numerical failure, cancellation, and internal fault.
- The operation inspector maps errors to the responsible input or parameter when
  known.
- Internal detail is retained for diagnostics without exposing implementation
  internals as product copy.
- An intentional boolean failure preserves the accepted document and viewport.

---

## E04 — Parametric sketching

**Outcome:** Users can create and edit constrained 2D intent that reliably drives
3D features.

### E04-S01 — Create a constrained rectangle sketch

**Milestone/Priority:** M1 / P0

**Depends on:** E02-S01, E03-S02, E07-S01

**Story:** As a modeler, I need to sketch a dimensioned rectangle on an origin
plane so I can create the reference cube.

**Acceptance criteria:**

- A sketch can attach to a selected origin plane and enter a plane-aligned edit
  view.
- Rectangle creation produces four connected lines with horizontal and vertical
  intent.
- Width and height dimensions can be entered exactly and edited later.
- Solver state reports under-, fully-, over-, and conflicting-constrained states.

### E04-S02 — Add core sketch geometry

**Milestone/Priority:** M2 / P0

**Depends on:** E04-S01

**Story:** As a part designer, I need common sketch entities so profiles are not
limited to rectangles.

**Acceptance criteria:**

- Line, circle, arc, rectangle, trim, and construction geometry use stable IDs.
- Coincident endpoints remain shared through edit, undo, save, and reload.
- Closed profile detection explains gaps and self-intersections.
- Geometry tools follow the shared commit/cancel interaction lifecycle.

### E04-S03 — Apply the alpha constraint set

**Milestone/Priority:** M2 / P0

**Depends on:** E04-S02

**Story:** As a part designer, I need geometric and dimensional constraints so
the sketch captures design intent rather than approximate coordinates.

**Acceptance criteria:**

- Coincident, horizontal, vertical, parallel, perpendicular, tangent, equal,
  distance, radius, and angle constraints are supported.
- Conflicting constraints identify a minimal useful conflict set.
- Dragging under-constrained geometry updates solver variables and preserves
  valid constraints.
- Constraint results are deterministic across reload and recompute.

### E04-S04 — Edit sketch dimensions in context

**Milestone/Priority:** M1 / P0

**Depends on:** E04-S01, E06-S01

**Story:** As a modeler, I need direct and exact dimension edits to update the
same parameter so viewport manipulation never hides design intent.

**Acceptance criteria:**

- Selecting an in-canvas dimension and editing its inspector field modify one
  underlying value.
- A committed edit dirties and recomputes only downstream features.
- Invalid edits retain the last valid preview and explain the violated rule.
- Undo restores the prior dimension, sketch solution, and solid.

### E04-S05 — Sketch on a planar face and repair attachment

**Milestone/Priority:** M2 / P0

**Depends on:** E03-S02, E04-S03, E06-S04

**Story:** As a part designer, I need sketches attached to planar faces with a
repair path when upstream topology changes.

**Acceptance criteria:**

- A planar face can satisfy a typed sketch-plane input.
- The attachment stores a stable topology reference and diagnostic signature.
- A missing face stops at the sketch and offers explicit candidate rebinding.
- Repair recomputes downstream features and records the rebind transaction.

**Bounded Sprint 4 status (Attempt 42 closeout complete and qualified):** A
current analytic planar-face support can drive Blind New Body Extrude, and a
missing support can be explicitly previewed and atomically rebound only to a
compatible face on the same body, producer, and component. This bounded path
over qualified line, arc, circle, and hole profiles and current
native/release-WASM frame authority passed the fresh 28/28 source-bound gate
with 35 records and 163 checksummed files in
`artifacts/solid-feature-qualification/runs/20260829T103331Z-solid-feature-sprint-4-r1`,
but Attempt 31 rejected that bundle for final qualification.
The initial 25/25 bundle rejected for nine findings, the first 27/27 remediated
bundle rejected for a TypeScript fail-closed defect, and the second 27/27 bundle
rejected for the inverse Rust fail-closed mismatch remain immutable history,
with every finding and remediation retained in the append-only qualification
ledger. Rust rejected numeric `external_line.stable_kernel_id`, whereas the
Attempt 30 TypeScript boundary parsed and then serialized it lossily and storage
accepted it. Exact six-field, safe-coordinate-pair, canonical-`u64`, lossless
document 11/11 and storage 19/19 remediation passes. Attempt 33 then found five
additional persisted-ID paths.
Attempt 34 closes them at focused scope: crawler-sketch 3/3; feature-kernel
29/29 plus 2/2; app builder 20/20 plus TypeScript compilation; runtime 2/2;
WASM/native evidence 1/1 each; alpha 5/5; corrected history typing; and
document/storage 11/11 and 19/19. Attempt 35 is only the administrative
`20260829T113815838Z-incomplete` archive of the old completed Attempt 30 mirror.
Attempt 36 (`20260829T115821960Z-incomplete`) rejected the current source at
17/18 commands on sandbox `C:\Volta` resolution. Attempt 37
(`20260829T121358296Z-incomplete`) reached 24/25 commands but parity rejected two
repair evidence documents at 8/10 because native and release-WASM used different
broken-reference sentinels. Attempt 38 changes native evidence to canonical
`u64::MAX.to_string()` and focused native/release-WASM export plus comparison
passes 10/10 under `target/sprint4-focused-parity-20260829T121122215Z`.
Attempt 39 (`20260829T122635405Z-incomplete`) passed its 26-command prefix but
the mandatory preflight source-integrity check rejected four tracked completion
documents that changed during the run. Attempt 40 reran the stable exact source
and passed 28/28 commands plus isolated validation, sealing 35 passed records
and 163 checksum entries at
`artifacts/solid-feature-qualification/runs/20260829T123714Z-solid-feature-sprint-4-r1`.
Fresh independent Attempt 41 returned exact standalone `ZERO FINDINGS` for the
Attempt 40 exact state. Final documentation-only Attempt 42 by the same reviewer
also returned exact standalone `ZERO FINDINGS` after reviewing the reconciled
documents and `git diff --check`. The bounded path is **COMPLETE AND
QUALIFIED**. No deferred support or repair class is promoted.
E04-S05 remains open for generalized sketch attachment and repair: curved or
nonanalytic supports, automatic healing, split/merge or topology-changing
rebind, and cross-component/cross-support/general rebind are deferred.

---

## E05 — Solid feature modeling

**Outcome:** Users can build useful mechanical parts through editable,
schema-driven features.

**Current planning supplements:** The committed foundations and exact Extrude
vertical slice are defined in
[Solid Feature Foundations — Sprint 1](specs/solid-feature-modernization-sprint.md).

Preceding qualified follow-on sprint:
[Offset Construction-Plane Extrude — Sprint 3](specs/solid-feature-modernization-sprint-3.md),
with status and evidence tracked in
[Solid Feature Sprint 3 Qualification](qualification/solid-feature-sprint-3-qualification.md).
Candidate `solid-feature-sprint-3` revision 1 implemented signed origin-relative
offset planes and blind New Body Extrude and passed its automated gate, but
independent review rejected that evidence and superseded the revision. Its
immutable automated run remains historical at
`artifacts/solid-feature-qualification/runs/20260828T111633Z-solid-feature-sprint-3-r1`,
locked to build `solid-feature-sprint-3-r1-20260828` and generated release-WASM
SHA-256
`5b2b656fce6efb81cadff92f71521610159a87f019925e5ba782f83d9f968177`.
All 25/25 revision 1 commands passed, producing 28 passed records and 121 checksummed files;
web units passed 226/226, worker tests 13/13, native and release-WASM fixture
oracles 4/4 each, parity 4/4 with zero differences, and production browser 2/2.
All three revision 1 locked performance workloads completed two warmups, ten measured
samples, and 50 edit/cancel cycles with zero violations. None of those records
qualifies revision 2.

At its prequalification checkpoint, candidate revision 2 was qualification-ready
but **not qualified**. It remediates
executed lifecycle evidence, real preview operations, typed UI/worker
diagnostics at the boundaries actually tested, suppression/null protocol that
removes the candidate datum preview and blocks dependent recompute while the
last accepted body/packet/hash remains unchanged, selection clearing, transitive
topological recompute, exact zero offset, wrong-type and unsafe offsets at the
exact `±9,007,199,254,740,991` nanometer range, missing/suppressed/invalid
support, reachable existing-plane missing-parameter editing, repaired-runtime
evidence, native/WASM sequence/category alignment, checked BigInt scaling,
atomic commit preflight, and equality of the tested offset-plane tool-first/
selection-first request fields and typed plane/parameter ID shapes. Production
generated-worker lifecycle coverage now also compares selection-first/tool-first unique-
profile Extrude preview bindings: the accepted semantic hash, stable sketch ID/
geometry IDs, explicit `profileGeometryIds`, exact construction-plane support,
direction, and nanometer distance are the same; newly allocated feature/body/
transaction values differ but retain matching typed ID shapes. Construction-
plane datum selection clears selected feature, sketch, and explicit profile
context; the browser asserts the exact empty Extrude selection context before
tool-first launch, whose unique-profile resolution emits explicit
`profileGeometryIds`. The shared edit helper accepts direction-sensitive
`Distance` and symmetric `Total length` input labels. Plane suppression removes the candidate
datum preview and blocks dependent recompute without posting an empty
replacement packet, retaining the last accepted body/packet/hash until valid
recompute. The focused production browser check passed 1/1 in 17.3 seconds; at
that checkpoint, the complete source-bound browser/full automated gate remained
pending. Missing base, parameter, and support faults
cross the real worker/runtime; wrong-type
coverage is a typed UI-boundary injection backed by real native/release-WASM
fixtures. Invalid dependency is rejected on `load`; the invalid document is not
saved or reopened. The unchanged last-valid accepted document is saved/reopened
before valid dependency repair, and no invalid runtime reaches preview. The
manifest is `contracts/solid-feature-candidate/sprint-3.json`; the next gates
were a fresh complete revision 2 automated run, isolated bundle validation, and
a mandatory fresh zero-finding independent review. All six revision 1
attempts and all existing deferrals remain in the append-only qualification
ledger.

Revision 2 subsequently passed automated qualification in immutable run
`artifacts/solid-feature-qualification/runs/20260828T135258Z-solid-feature-sprint-3-r2`.
All 25/25 logged commands passed: application units 232/232, worker tests 13/13,
parity self-tests 11/11, non-parity self-tests 6/6, native/release-WASM fixture
parity 9/9, and production browser 2/2. Native and release-WASM oracle
validators, candidate QualificationReady validation, and isolated bundle
validation passed. The bundle contains 33 records and 141 checksummed files.
Runtime build `solid-feature-sprint-3-r2-20260828` locks WASM SHA-256
`865834b5265f23d7ba2348549a93b5d44613a0fd52a34778b3b274ba609a4499`;
manifest SHA-256 is
`97bf837d2c8d8031252acc93484e9e4372d69e3dcee5ba3f6d17aef76267b545`.
The 584-file source snapshot and dirty-source hash are both
`e2501912b71848beb3ec70a2640446d6abc9f17bcf09da40d0940304fe79e96f`.
Locked performance recorded zero violations and a 0 ms maximum Long Task:
origin rectangle preview 52.3/54.0 ms p50/p95, recompute 11.9/16.6 ms,
cancel max 56.7 ms, heap growth 1,466,100 bytes; annulus 52.8/57.1 ms,
21.2/30.2 ms, 57.3 ms, and heap growth 1,667,588 bytes; offset-plane rectangle
46.8/56.0 ms, 11.7/19.9 ms, 62.1 ms, and heap growth 1,672,728 bytes.

At the automated-gate checkpoint, the decision was **AUTOMATED QUALIFICATION
PASSED — INDEPENDENT REVIEW PENDING** and revision 2 was **NOT YET QUALIFIED**.
Revision 1 remained rejected historical evidence, and all explicit deferrals
remained unchanged.

On 2026-08-28, the mandatory independent reviewer audited the exact revision 2
source, contracts, tests, isolated immutable bundle, and completion documents
and returned exact **ZERO FINDINGS**. The current Sprint 3 revision 2 decision is
**QUALIFIED** for only the frozen offset-plane and blind New Body Extrude scope.
The immutable run, counts, hashes, validators, and performance evidence above
remain unchanged; revision 1 and all earlier attempts/findings/remediations
remain append-only history. Explicit deferrals remain unchanged and unqualified:
angled/arbitrary/tangent/three-point/face-derived planes; support rebinding;
cross-support profile replacement; two-side/start/target extents;
Join/Cut/Intersect; handles/taper/thin; Revolve/Sweep/Loft. No deferred work is
included in this qualification.

The current scope-frozen follow-on is
[Planar-Face Extrude and Explicit Support Repair — Sprint 4](specs/solid-feature-modernization-sprint-4.md),
tracked append-only in
[Solid Feature Sprint 4 Qualification](qualification/solid-feature-sprint-4-qualification.md)
with candidate `contracts/solid-feature-candidate/sprint-4.json` revision 1.
Revision 1's initial complete source-bound automated gate and isolated
immutable-bundle validation in
`artifacts/solid-feature-qualification/runs/20260829T052403Z-solid-feature-sprint-4-r1`:
25/25 commands, 35 records, and 160 checksummed files. Independent review then
rejected the bundle with nine findings. That run remains immutable historical
evidence, and all nine findings/remediations remain in the append-only Sprint 4
qualification ledger. The remediated revision 1 source passed a fresh 27/27
source-bound automated gate and isolated validation with 35 records and 162
checksummed files at
`artifacts/solid-feature-qualification/runs/20260829T075140Z-solid-feature-sprint-4-r1`.
Independent review rejected that first remediated bundle for one cross-language
fail-closed persistence defect. After the P1 fix, another complete 27/27
source-bound gate and isolated validation passed with 35 records and 162
checksummed files at
`artifacts/solid-feature-qualification/runs/20260829T084448Z-solid-feature-sprint-4-r1`.
Independent exact-state review rejected the newest bundle because Rust accepted
noncanonical decimal kernel IDs and unknown fallback-signature keys that the
TypeScript document and storage boundaries reject. After Rust was aligned to
the same fail-closed domain, the exact remediated source passed 28/28 commands
and isolated validation with 35 records and 163 checksummed files at
`artifacts/solid-feature-qualification/runs/20260829T103331Z-solid-feature-sprint-4-r1`.
The bundle binds manifest SHA-256
`2dd9a81be451d011792eb46ac86275da092f16a20302f14e17c5de4433e16f79`,
source SHA-256
`419dd8c4d9baa4f386b6cbebc0c406935e1a88f3c009780879304ad4a84b0a96`
over 870 entries/files with zero deletions, Git commit
`3f2ec88b4687c15cd8721f840ed21b293955f95e`, runtime build
`solid-feature-sprint-4-r1-20260828`, and release-WASM SHA-256
`c8932ce766f9dd9e2e5e27f1fee8ad4fc462b21c3754297c66621cdd0b130c58`
at 10,887,489 bytes. Native/release-WASM fixtures and parity passed 10/10;
browser passed 2/2 with eight unobscured screenshots; both locked workloads
completed 2/10/50 with zero budget violations and zero Long Tasks. Extrude
preview/recompute p50/p95 were 50.9000000953674/56.6000001430511 ms and
17.2/22.7 ms, with 52 ms maximum cancellation and 1,342,896 bytes heap growth;
repair was 62.5/112.799999952316 ms and
133.299999952316/203.299999952316 ms, with 35.7000000476837 ms maximum
cancellation, 860,652 bytes heap growth, one candidate, and 62 ranking
observations. Independent
exact-state review then rejected Attempt 30. The persisted `external_line`
variant was strict in Rust, absent and lossy in the TypeScript type/codec, and
numerically permissive in storage. The adversarial probe returned `parsed:
true` and `stored: true`; TypeScript serialization silently dropped `body` and
`stable_kernel_id`. Attempt 30 remains immutable rejected history.

Focused remediation now requires exactly `kind`, `id`, `start_nanometers`,
`end_nanometers`, `body`, and `stable_kernel_id`; each coordinate field is an
exact pair of safe integers; kernel identity is a canonical decimal-string
`u64`; invalid, numeric, noncanonical, missing, unknown, and malformed values
fail closed; and document/package serialization retains all fields without
loss. Document protocol passes 11/11 and storage protocol passes 19/19. A fresh
persisted-ID audit then recorded five Attempt 33 findings: crawler-sketch
`ExternalReference` accepted padded and signed strings through `parse::<u64>()`;
advanced-feature request topology vectors persisted JSON numbers; Sprint 4
WASM evidence converted identities through `Number` while native evidence
accepted numeric values; alpha-reference raw evidence used a number; and a
history regression test typed the persisted identity numerically.

At the Attempt 33 checkpoint, crawler-sketch accepted only canonical decimal strings, proved `0` and
`u64::MAX`, rejected padded/signed/empty/whitespace/numeric/out-of-range forms,
and passed 3/3. The advanced-request, Sprint 4 WASM/native-evidence, alpha-raw-
evidence, and history-test findings remained under remediation. Advanced
operations remain functionally
deferred, but their persisted request vectors are shared infrastructure and the
deferral is not a persistence waiver. A fresh complete source-bound no-waiver
bundle, isolated validation, reconciled documents, and independent exact-state
`ZERO FINDINGS` review remain required.

Attempt 34 closes the focused matrix. Feature-kernel Draft, edge-treatment, and
Shell topology arrays use canonical strings and pass 29/29 contracts plus 2/2
persistence tests; the app builder passes 20/20 plus TypeScript compilation;
runtime passes 2/2; release-WASM preserves strings/`BigInt` at 1/1; native
evidence is string-only at 1/1; alpha passes 5/5; history typing is corrected;
and document/storage remain 11/11 and 19/19. Advanced features remain
functionally deferred; canonical shared persistence does not qualify them and
is not a persistence waiver. Attempts 35–37 retain the old completed-current
administrative archive, the 17/18 sandbox-resolution rejection, and the 24/25
run rejected at 8/10 parity. Attempt 38 aligns the native broken-reference
sentinel to canonical `u64::MAX` and passes focused 10/10 native/release-WASM
parity under `target/sprint4-focused-parity-20260829T121122215Z`. Sprint 4 is
then represented by Attempt 39's source-integrity rejection after its passing
26-command prefix and Attempt 40's stable-source 28/28 pass plus isolated
validation. The immutable 35-record, 163-checksum-entry bundle is
`artifacts/solid-feature-qualification/runs/20260829T123714Z-solid-feature-sprint-4-r1`.
Fresh independent Attempt 41 returned exact standalone `ZERO FINDINGS` for the
Attempt 40 exact state. Sprint 4 is **QUALIFIED** for only this bounded scope;
final documentation-only Attempt 42 by the same reviewer also returned exact
standalone `ZERO FINDINGS` for the reconciled documents and `git diff --check`.
Sprint 4 bounded closeout is complete; the program next step is to select the
highest-priority dependency-ready unqualified tranche.
The boundary remains analytic planar-face-supported
Blind New Body Extrude over qualified line, arc, circle, and hole profiles plus
explicit compatible same-body/producer/component face repair under current
native/release-WASM frame authority. Sprint 3 remains qualified. Arbitrary,
angled, tangent,
three-point, and face-derived datum planes; curved/nonanalytic supports;
automatic healing and split/merge/topology-changing rebind;
cross-component/cross-support/general rebind; two-side/start/target extents;
Join/Cut/Intersect/targets; handles, draft/thin; Revolve, Sweep, and Loft remain
deferred and unqualified.

**Selected Sprint 5 follow-on (scope frozen; implementation and qualification pending):**
On 2026-08-31 the next dependency-ready P0 slice was frozen as
[Single-Target Blind Cut — Sprint 5](specs/solid-feature-modernization-sprint-5.md),
tracked append-only in
[Solid Feature Sprint 5 Qualification](qualification/solid-feature-sprint-5-qualification.md).
It subtracts one qualified line/arc/circle/hole region from exactly one
explicitly selected current target body in the same component; supports the
qualified origin, signed-offset, and current analytic planar-face frames plus
Blind Forward/Reverse/Symmetric; retains the target body identity; creates no
new body; and requires native/generated release-WASM, production-browser, and
locked-performance qualification. This is a selection checkpoint only: the
candidate manifest, code, tests, evidence, immutable bundle, and independent
review remain pending and no Sprint 5 behavior is qualified.

Join/Intersect; multi, implicit, overlap-inferred, or cross-component targets;
two-side/start/target and Through All/Next/Object extents; handles/draft/thin;
extra datum planes and curved/nonanalytic supports; generalized repair;
unqualified profile families; and Revolve/Sweep/Loft remain deferred and
unqualified.

The preceding qualified prerequisite is
[Extrude Direction Modes — Sprint 2](specs/solid-feature-modernization-sprint-2.md),
tracked in
[Solid Feature Sprint 2 Qualification](qualification/solid-feature-sprint-2-qualification.md).
Candidate `solid-feature-sprint-2` revision 1 passed its complete automated gate
and isolated immutable-bundle validation, and its fresh independent completion
re-review returned zero findings. It is qualified for only durable
Forward/Reverse/Symmetric blind New Body Extrude on origin XY/XZ/YZ and does not
complete the broader angled/construction-plane boundary from E3D-S1-09.
The corrected source-bound evidence is
`artifacts/solid-feature-qualification/runs/20260828T035943Z-solid-feature-sprint-2-r1`:
25/25 commands, 25 passed records, 109 checksummed files, 219/219 application
units, 13/13 worker tests, 2/2 native/release-WASM parity fixtures, and 2/2
production browser suites. The earlier 23-record bundle is retained but
ineligible after independent review found its two missing subject records.
The broader Extrude, Cut, Revolve, Sweep, and Loft epics and follow-on stories
are defined in the
[Solid Feature Modernization Initiative Backlog](specs/solid-feature-modernization-initiative.md).
Candidate `solid-feature-sprint-1` revision 5 is qualified and complete for the
exact origin-plane, positive blind, New Body Extrude slice after a zero-finding
independent review. The superseded revision 3 automated run,
revision 2 automated run, and all retained failure/remediation history are recorded in
[Solid Feature Sprint 1 Qualification](qualification/solid-feature-sprint-qualification.md).
Angled/arbitrary construction-plane and planar-face supports, cross-sketch
replacement, support rebinding, two-side/start/target extents, Join, Cut, dedicated
locate/remove/target chips, result modes, Revolve, Sweep, and Loft are explicitly
deferred and are not implied by the Sprint 1 implementation.

### E05-S01 — Extrude a sketch into the reference cube

**Milestone/Priority:** M1 / P0

**Depends on:** E00-S05, E03-S01, E04-S01

**Story:** As a modeler, I need to extrude the rectangle with a precise distance
so the first complete parametric solid exists.

**Acceptance criteria:**

- Extrude collects a closed profile, direction, distance, extent, and target
  body through typed inputs.
- Manipulator drag and numeric entry update the same distance value.
- Preview is cancellable and commit creates one editable timeline feature.
- Editing width, height, or distance recomputes the expected cube dimensions.

**Status:** Revision 5 qualified; the independent review reported zero findings
and satisfied the completion gate. Revision 3 was rejected for its remaining
E3D-S1-11 selected-replacement evidence gap. Revision 4 closed that gap, but its
independent audit found that a profile from another sketch/support could enter
timeline replacement despite the deferred cross-sketch boundary. Both immutable
bundles remain historical evidence at
`artifacts/solid-feature-qualification/runs/20260826T094412Z-solid-feature-sprint-1-r3`
and
`artifacts/solid-feature-qualification/runs/20260826T105732Z-solid-feature-sprint-1-r4`.
Revision 5 requires the exact source sketch ID and ready, equal resolved support
frames; an incompatible selection blocks with an explicit reason before preview
or commit. Production evidence records zero preview/commit dispatches and
unchanged hash, references, feature/body IDs, bounds, and count through
recompute/reload. The automated bundle is
`artifacts/solid-feature-qualification/runs/20260826T115242Z-solid-feature-sprint-1-r5`:
25/25 commands, 55 records, 169 checksummed files, application 214/214, worker
13/13, native/release-WASM parity 15/15, comparator 7/7, non-parity 6/6, and
production browser 6/6 across all four manifest IDs. Cross-sketch replacement,
support rebinding, and all prior deferred scope remain unqualified. The revision
2 bundle and all earlier failures remain documented and are not erased.

**Bounded Sprint 4 extension (Attempt 42 closeout complete and qualified):**
The same typed Extrude path now accepts a current analytic planar-face-supported
qualified line, arc, circle, or hole profile for Blind New Body creation and
retains deterministic create, edit,
upstream recompute, undo/redo, save/reopen, and failure behavior. The generated
release-WASM and production-browser evidence for the remediated source is sealed
in
`artifacts/solid-feature-qualification/runs/20260829T103331Z-solid-feature-sprint-4-r1`
(28/28 commands, 35 records, 163 checksummed files) under current
native/release-WASM frame authority, but Attempt 31 rejected it for the
`external_line` Rust/TypeScript/storage mismatch and lossy TypeScript round trip.
All four bundles remain immutable rejected history with their findings and
remediations preserved. Focused document 11/11 and storage 19/19 remediation
passes, and crawler-sketch canonical identity passes 3/3. Attempt 33's numeric
advanced-request, Sprint 4 WASM/native evidence, alpha raw evidence, and
history-test paths are closed by Attempt 34's feature-kernel 29/29 plus 2/2,
builder 20/20 plus TypeScript compilation, runtime 2/2, WASM/native 1/1 each,
alpha 5/5, and corrected history typing. Attempts 35–37 retain the
administrative old-current archive, sandbox-resolution rejection at 17/18, and
parity rejection at 24/25 with 8/10 fixtures. Attempt 38 uses canonical
`u64::MAX` in native broken-reference evidence and passes focused 10/10 parity
under `target/sprint4-focused-parity-20260829T121122215Z`. The full bundle was
then attempted twice: Attempt 39 passed its 26 recorded commands through
browser but failed the mandatory preflight source-integrity comparison after
four tracked completion documents changed, while Attempt 40 passed the stable
28/28 gate and isolated validation with 35 passed records and 163 checksum
entries at
`artifacts/solid-feature-qualification/runs/20260829T123714Z-solid-feature-sprint-4-r1`.
Fresh independent Attempt 41 returned exact standalone `ZERO FINDINGS`, so this
extension is **QUALIFIED** for its frozen boundary. Final documentation-only
Attempt 42 by the same reviewer returned exact standalone `ZERO FINDINGS` after
reviewing the reconciled documents and `git diff --check`; bounded closeout is
complete. E05-S01 remains broadly open:
Join/Cut/Intersect and target selection, independent two-side/start/target
extents, model-space handles, draft, and thin features are not included.

### E05-S02 — Add revolve and axis selection

**Milestone/Priority:** M2 / P0

**Depends on:** E04-S03, E03-S02, E06-S01

**Story:** As a part designer, I need revolve with explicit axis and angle inputs
so rotational parts retain editable intent.

**Acceptance criteria:**

- Revolve accepts a closed profile, valid axis reference, angle, and operation
  mode.
- Invalid self-intersection or axis/profile combinations return structured
  errors.
- Editing the profile, axis, or angle recomputes only affected descendants.
- Save/load and undo preserve the axis reference.

### E05-S03 — Combine bodies with booleans

**Milestone/Priority:** M2 / P0

**Depends on:** E03-S03, E06-S01

**Story:** As a part designer, I need union, cut, and intersect features so I can
compose solids while retaining target and tool history.

**Acceptance criteria:**

- Boolean features capture operation, target body, ordered tools, and tolerance.
- Tools can remain inspectable through history even when consumed visually.
- Empty or failed results produce structured errors without losing inputs.
- Stable references and save/load are tested on a successful and failed case.

### E05-S04 — Modify edges and faces

**Milestone/Priority:** M2 / P0

**Depends on:** E03-S02, E06-S04, kernel contract support

**Story:** As a part designer, I need fillet, chamfer, and shell features so common
manufacturable details remain editable.

**Acceptance criteria:**

- Fillet and chamfer accept stable edge sets and exact dimensional parameters.
- Shell accepts stable face-removal inputs and wall thickness.
- Partial kernel failure identifies the problematic reference where possible.
- Each operation passes edit, suppress, undo, save/load, and repair fixtures
  before being enabled in the command shelf.

**Status:** Fillet, chamfer, and exact axis-aligned prismatic Shell are qualified
through native/WASM contracts and the durable browser workflow.

### E05-S05 — Repeat and transform design intent

**Milestone/Priority:** M2 / P0

**Depends on:** E06-S01, E07-S01

**Story:** As a part designer, I need mirror, linear pattern, circular pattern,
and transform features so repeated geometry is driven by parameters.

**Acceptance criteria:**

- Pattern inputs include source feature/body, direction or axis, count, and
  spacing/angle with unit-aware parameters.
- Mirror records an explicit plane reference.
- Feature-sequence and body transforms have distinct typed semantics.
- Editing count or source recomputes deterministic instance identities.

**Status:** Body mirror, linear/circular pattern, and exact XYZ Transform are
qualified. Feature-sequence substitution remains a distinct typed, fail-closed
path rather than being silently treated as a body transform.

---

## E06 — Feature graph, timeline, and reference repair

**Outcome:** History is understandable, incrementally recomputed, and repairable
when upstream edits invalidate topology.

### E06-S01 — Evaluate a deterministic feature graph

**Milestone/Priority:** M1 / P0

**Depends on:** E00-S04, E02-S02, E03-S03

**Story:** As a modeler, I need downstream features to recompute deterministically
after an early edit.

**Acceptance criteria:**

- Dependencies are explicit and cycles are rejected with the cycle path.
- A transaction marks the minimum affected graph dirty and evaluates in stable
  topological order.
- Unaffected feature outputs retain identity and cached render data.
- Cancellation leaves the last accepted document result intact.

**Status:** Advanced-feature consumers are re-executed in stable topological
order after an upstream edit, in one atomic undoable transaction; explicit
recompute uses the same path and refused consumers preserve the accepted graph.

### E06-S02 — Read and edit the feature timeline

**Milestone/Priority:** M1 / P0

**Depends on:** E01-S02, E06-S01

**Story:** As a modeler, I need the timeline to show how the part was built and let
me edit a feature without confusing it with undo history.

**Acceptance criteria:**

- Timeline items show type, name, and clean, dirty, computing, warning, failed,
  and suppressed states.
- Selecting or editing a feature opens its schema-driven inspector.
- Rename and edit are transactions with undo/redo coverage.
- Timeline rollback changes evaluation position without deleting later features.

### E06-S03 — Suppress, delete, group, and reorder safely

**Milestone/Priority:** M2 / P0

**Depends on:** E06-S02

**Story:** As a modeler, I need controlled history editing so I can explore and
organize a model without creating hidden dependency damage.

**Acceptance criteria:**

- Suppress/unsuppress, delete, and group are explicit document transactions.
- Reorder is permitted only when dependencies remain valid.
- A blocked reorder names the dependency that prevents it.
- Downstream failures remain attributed to the first broken feature.

### E06-S04 — Repair a missing topology reference

**Milestone/Priority:** M2 / P0

**Depends on:** E03-S02, E06-S01, E06-S02

**Story:** As a modeler, I need to repair a broken face or edge reference explicitly
so an upstream edit does not force me to rebuild the model blindly.

**Acceptance criteria:**

- The first unresolved input stops evaluation at its owning feature.
- Candidate replacements are ranked using topology kind and geometric signature
  without applying a silent match.
- Explicit rebind is previewed, committed as a transaction, and undoable.
- Downstream recovery is summarized after recompute.

**Bounded Sprint 4 status (Attempt 42 closeout complete and qualified):**
Read-only candidate ranking, explicit preview, and atomic repair passed for a
missing analytic planar-face Extrude support when the replacement is current
and belongs to the same body, producer, and component. The immutable automated
evidence is
`artifacts/solid-feature-qualification/runs/20260829T103331Z-solid-feature-sprint-4-r1`
(28/28 commands, 35 records, 163 checksummed files) over the qualified planar
profile families and current native/release-WASM frame authority, but Attempt
31 rejected it for the `external_line` Rust/TypeScript/storage mismatch and
lossy TypeScript serialization. All four bundles remain immutable rejected
history, with all findings and remediations preserved. Focused exact-six-field,
safe-pair, canonical-`u64`, no-loss document 11/11 and storage 19/19 remediation
passes, and crawler-sketch canonical identity passes 3/3. Attempt 33's advanced-
request vectors, Sprint 4 WASM/native evidence, alpha raw evidence, and history-
test typing are closed by Attempt 34's feature-kernel 29/29 plus 2/2, builder
20/20 plus TypeScript compilation, runtime 2/2, WASM/native 1/1 each, alpha 5/5,
and corrected history typing. Attempts 35–37 preserve the administrative old-current
archive, sandbox-resolution rejection at 17/18, and parity rejection at 24/25
with 8/10 fixtures. Attempt 38 aligns native broken-reference evidence to
canonical `u64::MAX` and passes focused 10/10 native/release-WASM parity under
`target/sprint4-focused-parity-20260829T121122215Z`. Attempt 39 passed its 26
recorded commands but failed mandatory source-integrity preflight when four
tracked completion documents changed during execution. Attempt 40 passed the
stable-source 28/28 gate and isolated validation in the 35-record,
163-checksum-entry immutable bundle at
`artifacts/solid-feature-qualification/runs/20260829T123714Z-solid-feature-sprint-4-r1`.
Fresh independent Attempt 41 returned exact standalone `ZERO FINDINGS`, so the
bounded repair path is **QUALIFIED**. Final documentation-only Attempt 42 by the
same reviewer also returned exact standalone `ZERO FINDINGS` after reviewing
the reconciled documents and `git diff --check`; bounded closeout is complete.
E06-S04 remains open for
edge repair, automatic healing, split/merge or topology-changing rebind,
cross-component/cross-support/general rebind, and other repair classes.

### E06-S05 — Explain dependencies and compute cost

**Milestone/Priority:** M2 / P1

**Depends on:** E06-S01, E06-S02

**Story:** As a modeler, I need lightweight dependency and timing cues so I can
understand impact without switching to a graph editor.

**Acceptance criteria:**

- A feature can highlight direct inputs and consumers in the timeline and
  viewport.
- “Recompute from here” respects graph dependencies and rollback position.
- Per-feature compute timing is available in a compact diagnostics view.
- Diagnostics are excluded from semantic document history.

---

## E07 — Units, parameters, and expressions

**Outcome:** Exact values are reusable, unit-safe design inputs rather than
unrelated numeric fields.

### E07-S01 — Use typed quantities in every dimensional field

**Milestone/Priority:** M1 / P0

**Depends on:** E00-S04, E00-S05

**Story:** As a modeler, I need dimensions to carry units so values cannot be
misinterpreted across documents or operations.

**Acceptance criteria:**

- Length, angle, count, scalar, and tolerance types reject incompatible values.
- Document display units do not alter stored semantic quantities.
- Parsing, formatting, save/load, and undo preserve exact intended values.
- Unit errors appear beside the responsible field.

### E07-S02 — Promote and reuse named parameters

**Milestone/Priority:** M2 / P0

**Depends on:** E07-S01, E06-S01

**Story:** As a part designer, I need named parameters and expressions so one
design value can drive several features safely.

**Acceptance criteria:**

- Any dimensional field can promote its value to a stable named parameter.
- Expressions reference parameters structurally and survive parameter rename.
- Cycles are rejected with an understandable dependency path.
- The evaluated value is shown without discarding the entered expression.

### E07-S03 — Create parameter configurations

**Milestone/Priority:** Beta / P2

**Depends on:** E07-S02, E08-S02

**Story:** As a designer, I need named parameter sets so related variants share
one feature history.

**Acceptance criteria:**

- A configuration overrides declared parameters without duplicating the graph.
- Switching configurations recomputes deterministic outputs and stable identities
  where topology is unchanged.
- Configuration changes are represented in semantic diff output.
- Invalid configurations identify the first failed feature.

---

## E08 — Portable files, version control, and interchange

**Outcome:** Crawler documents preserve history, round-trip safely, and produce
useful semantic revisions while interoperating with standard CAD formats.

### E08-S01 — Decide the portable package and canonical manifest

**Milestone/Priority:** M0 / P0

**Depends on:** E00-S04

**Story:** As a tool builder, I need a documented portable format so independent
implementations can inspect, validate, migrate, and version Crawler documents.

**Acceptance criteria:**

- An ADR selects separate files versus a related package for parts, assemblies,
  and derived drawings.
- The canonical manifest, content-addressed payload layout, schema versioning,
  and MIME/extensions are specified.
- Embedded executable user code is prohibited; operation history is declarative
  data.
- Volatile view state, caches, and recovery journals are separated from semantic
  model content.

**Status:** Complete (2026-08-01)

**Evidence:**

- [ADR 0004](architecture/adr/0004-portable-package-format.md) selects separate
  part, assembly, and drawing containers in one related package family.
- [Portable package v1](specs/portable-package-v1.md) specifies canonical
  manifests, MIME/extensions, content-addressed payloads, compatibility, and
  the semantic/transient boundary.
- `crates/crawler-package` passes nine contract tests for deterministic entry
  sets, part and STEP payloads, typed compatibility/corruption failures, and
  rejection of executable or undeclared machine-local content.

### E08-S02 — Save and load a canonical part document

**Milestone/Priority:** M1 / P0

**Depends on:** E02-S01, E08-S01

**Story:** As a modeler, I need portable part files that preserve complete history
and do not create noisy version-control changes.

**Acceptance criteria:**

- Save/load preserves parameters, sketches, feature graph, stable references,
  provenance, units, and schema version.
- Saving the same semantic document twice produces byte-identical canonical
  content or an identical canonical manifest and payload set.
- Timestamp, cache, camera, panel, and selection changes create no semantic diff.
- Unknown required schema features fail with a compatibility explanation.

### E08-S03 — Show a structural document diff

**Milestone/Priority:** M2 / P1

**Depends on:** E08-S02, E07-S02

**Story:** As a reviewer, I need revisions described in CAD terms so version
control is useful beyond binary file replacement.

**Acceptance criteria:**

- Diff output identifies stable additions, removals, renames, parameter changes,
  feature edits, and reference changes.
- Reordering canonical storage without semantic change produces an empty diff.
- Diff output can be consumed as structured data and rendered as readable text.
- Geometry payload changes reference the owning semantic entity and content hash.

### E08-S04 — Merge independent changes and stop on conflicts

**Milestone/Priority:** Beta / P2

**Depends on:** E08-S03

**Story:** As a team using version control, we need independent edits merged and
conflicting design intent surfaced explicitly.

**Acceptance criteria:**

- Fixtures prove safe merge of independent parameter or feature edits.
- Concurrent edits to the same parameter, feature inputs, topology reference, or
  provenance create a typed conflict.
- No geometry or history conflict is resolved by an unreported heuristic.
- Resolved merges validate and recompute before producing an accepted document.

### E08-S05 — Migrate document schemas deterministically

**Milestone/Priority:** M3 / P1

**Depends on:** E08-S02

**Story:** As a modeler, I need older files upgraded without losing history so
Crawler remains trustworthy across releases.

**Acceptance criteria:**

- Migrations declare source/destination versions and run deterministically.
- The original input remains recoverable until the migrated document validates.
- Migration fixtures cover every supported schema transition.
- Unsupported or lossy migrations stop with explicit choices and diagnostics.

### E08-S06 — Import and inspect STEP

**Milestone/Priority:** M2 / P0

**Depends on:** E03-S01, E03-S03, E06-S01

**Story:** As a modeler, I need to import STEP geometry as an inspectable feature
so existing CAD can participate in Crawler workflows.

**Acceptance criteria:**

- STEP import runs in the worker with progress and cancellation.
- Imported shells/solids retain source file hash and import settings as
  provenance.
- Imported bodies can be selected, measured, combined, hidden, and re-imported.
- Invalid entities are reported without discarding successfully diagnosed input.

### E08-S07 — Export STEP, STL, and OBJ without mutating history

**Milestone/Priority:** M1 for cube export; M2 for full corpus / P0

**Depends on:** E05-S01, E08-S02

**Story:** As a modeler, I need standard exports generated from the accepted
document without changing the model merely to serialize it.

**Acceptance criteria:**

- The reference cube exports and validates in at least one independent reader.
- STEP uses authoritative B-rep geometry; STL/OBJ use explicit tessellation
  settings.
- Export settings and errors are visible but do not create semantic model edits.
- Round-trip reference fixtures record geometric and visual validation evidence.

**Status:** Deterministic automated STEP/STL/OBJ export contracts complete;
independent-reader STEP validation pending.

---

## E09 — Private-alpha quality, recovery, and delivery

**Outcome:** The application meets its interaction, reliability, compatibility,
accessibility, and offline promises for external alpha users.

### E09-S01 — Enforce performance budgets

**Milestone/Priority:** M3 / P1

**Depends on:** E00-S06, M2 reference part

**Story:** As a modeler, I need edits and navigation to stay responsive as the
reference part grows.

**Acceptance criteria:**

- Automated or repeatable measurements cover input feedback, preview latency,
  recompute percentiles, frame rate, load time, and memory.
- Regressions beyond agreed budgets fail the performance gate or require an
  explicit recorded exception.
- Long recomputes expose progress and remain cancellable.
- Results identify document revision, browser, device class, and build.

**Status:** Automated smoke budget passing; representative-device run pending.

### E09-S02 — Recover from worker and application failure

**Milestone/Priority:** M3 / P1

**Depends on:** E02-S04

**Story:** As a modeler, I need the last durable checkpoint recoverable after a
worker crash or interrupted session.

**Acceptance criteria:**

- A forced worker fault restarts into a safe non-editing recovery state.
- Recovery validates checkpoint and journal before opening the document.
- The user can inspect recovery provenance and choose recovered or saved state.
- Repeated recovery failure preserves the source artifacts for diagnosis.

### E09-S03 — Install and work offline

**Milestone/Priority:** M3 / P1

**Depends on:** E01-S01, E08-S02

**Story:** As a local-first user, I need an installable application that opens,
models, saves, and recovers without a network connection.

**Acceptance criteria:**

- The PWA installs with required UI, worker, WASM, and static assets cached.
- New/open/save, cube modeling, undo, and recovery work offline.
- Update availability is announced without replacing a running modeling session.
- Storage quota failure is actionable and does not silently lose accepted work.

### E09-S04 — Complete the accessibility and input pass

**Milestone/Priority:** M3 / P1

**Depends on:** E01-S05, M2 workflows

**Story:** As a modeler using keyboard or assistive technology, I need the core
workflow to expose state without relying only on pointer hover or color.

**Acceptance criteria:**

- Cube creation, dimension edit, timeline edit, save, and recovery are operable
  by keyboard.
- Focus, operation, selection, solver, and error states have accessible names and
  non-color indicators.
- Camera transitions respect reduced-motion preferences.
- Automated checks and a documented manual pass cover the reference workflow.

**Status:** Automated accessibility workflow contracts passing; documented
manual keyboard, zoom, reduced-motion, and screen-reader passes pending.

### E09-S05 — Onboard users through the reference workflow

**Milestone/Priority:** M3 / P1

**Depends on:** M2 exit criteria, E09-S04

**Story:** As a first-time user, I need concise guidance that teaches Crawler's
object, operation, and history model through actual modeling.

**Acceptance criteria:**

- Onboarding creates a real editable reference part, not a disposable mock.
- Guidance explains browser versus timeline versus undo using the current state.
- Users can skip, resume, and restart onboarding.
- Usability sessions measure active-operation recognition, dimension discovery,
  and broken-reference repair targets from the PRD.

**Status:** Onboarding automation passing; external usability sessions pending.

---

## E10 — Small assemblies

**Outcome:** Beta users can compose portable part documents into small,
history-preserving assemblies without destabilizing part design.

### E10-S01 — Save and load a portable assembly document

**Milestone/Priority:** Beta / P2

**Depends on:** E08-S02, M3 exit

**Story:** As an assembly designer, I need an assembly document that references
parts by stable identity and revision while preserving assembly history.

**Acceptance criteria:**

- Occurrences reference part identity, revision/content hash, and transform.
- Missing or changed part revisions produce explicit resolution state.
- Assembly save/load is canonical and participates in structural diff.
- Part history remains in the part document rather than being flattened into the
  assembly.

### E10-S02 — Position occurrences with joints

**Milestone/Priority:** Beta / P2

**Depends on:** E10-S01, E03-S02, E07-S01

**Story:** As an assembly designer, I need occurrences and basic joints so I can
define a small mechanism with inspectable constraints.

**Acceptance criteria:**

- Fixed, revolute, slider, and planar joint scope is confirmed before build.
- Joint inputs use stable component/topology references and typed quantities.
- Solver failure identifies conflicting or under-defined relationships.
- Joint creation and edits are transactional, undoable, and history-preserving.

### E10-S03 — Inspect assembly interference

**Milestone/Priority:** Beta / P2

**Depends on:** E10-S02, kernel contract support

**Story:** As an assembly designer, I need interference results tied to component
identities so I can diagnose collisions without altering the assembly.

**Acceptance criteria:**

- Interference runs asynchronously with progress and cancellation.
- Results identify occurrence pairs and highlight collision geometry.
- Analysis results are caches unless explicitly captured as a report.
- Updating a referenced part invalidates only affected analysis results.

---

## E11 — Associative derived drawings

**Outcome:** Derived drawings remain portable, inspectable artifacts linked to
specific part or assembly history and revision.

### E11-S01 — Save and load a derived drawing document

**Milestone/Priority:** Beta / P2

**Depends on:** E08-S01, E10-S01 for assembly sources

**Story:** As a drawing author, I need a drawing document with explicit source
provenance so updates are predictable and version-controllable.

**Acceptance criteria:**

- The document records sheets, views, annotations, dimensions, derivation
  settings, and source document identity/revision.
- Drawing save/load is canonical and structural diff addresses entities by
  stable ID.
- Source geometry is referenced rather than silently flattened into drawing
  history.
- Missing source revisions open in a diagnosable unresolved state.

### E11-S02 — Create associative projected views

**Milestone/Priority:** Beta / P2

**Depends on:** E11-S01, renderer/vectorization spike

**Story:** As a drawing author, I need base and projected views that update from
the accepted source revision.

**Acceptance criteria:**

- Base view records source, orientation, scale, and display settings.
- Projected views retain an explicit dependency on their parent view.
- Source changes produce an update preview and identify affected drawing items.
- Updating is a drawing transaction and preserves prior revision provenance.

### E11-S03 — Add associative dimensions and annotations

**Milestone/Priority:** Beta / P2

**Depends on:** E11-S02, E06-S04

**Story:** As a drawing author, I need dimensions and annotations anchored to
source intent so broken references are visible and repairable.

**Acceptance criteria:**

- Dimensions reference stable drawing/source entities and store presentation
  separately from measured value.
- A changed or missing source reference creates a repair state, not a silently
  detached annotation.
- Rebinding is explicit, previewed, transactional, and undoable.
- Drawing diff reports annotation, dimension, and source-reference changes.

---

## E12 — Optional visual-programming addon

**Outcome:** A later addon can provide graph-based procedural modeling through a
stable extension boundary without turning Crawler itself into a node editor or
code-linked modeling tool.

### E12-S01 — Define the addon contract

**Milestone/Priority:** Later / P2

**Depends on:** Stable E00-S05 operation schema, M3 exit

**Story:** As an addon developer, I need a typed, versioned extension contract so
visual nodes can use Crawler operations without private kernel access.

**Acceptance criteria:**

- The contract exposes approved parameter, selection, operation, part, and
  assembly types through capability-scoped APIs.
- Addons cannot mutate an accepted document outside transactions.
- Contract compatibility and failure isolation are specified.
- Core Crawler remains fully usable without the addon installed.

### E12-S02 — Store a portable procedural graph

**Milestone/Priority:** Later / P2

**Depends on:** E12-S01, E08-S02

**Story:** As a procedural designer, I need the node graph stored as a related,
versioned document so its intent and generated-output provenance survive review.

**Acceptance criteria:**

- Nodes, ports, connections, parameters, operation schema versions, and output
  provenance have stable semantic IDs.
- Graph serialization is canonical and supports structural diff.
- The graph contains declarative node data, not embedded arbitrary executable
  user code.
- Generated Crawler entities identify graph revision and producing node.

### E12-S03 — Evaluate a graph into reviewable Crawler history

**Milestone/Priority:** Later / P2

**Depends on:** E12-S02, E06-S01

**Story:** As a procedural designer, I need graph results materialized through
Crawler's document engine so they can be inspected, versioned, and diagnosed.

**Acceptance criteria:**

- Evaluation runs outside the UI thread with progress and cancellation.
- Outputs enter Crawler through normal typed operations and transactions.
- A failed node identifies upstream inputs and leaves the last accepted document
  intact.
- The core timeline groups generated results without pretending the graph is the
  default editing surface.

## 6. Remaining private-alpha exit work

The implementation and automated qualification do not substitute for these
remaining product gates:

1. Record the reference workflow at 60 fps and the other performance budgets on
   the agreed representative device.
2. Validate exported STEP geometry in an independent reader.
3. Complete the documented manual keyboard, 200% zoom, reduced-motion, and
   screen-reader accessibility passes.
4. Complete the CAD-experienced and new-CAD-user sessions without developer help.
5. Qualify a geometry backend for Shell before enabling that command.

The evidence template and exact pending checks live in
[manual alpha validation](manual-alpha-validation.md).

## 2026-08-31 — Sprint 5 revision-3 prequalification checkpoint

The earlier Sprint 5 selection checkpoint is retained as history, but its
statement that the manifest, code, tests, and evidence are all pending is no
longer the current state. Candidate `solid-feature-sprint-5` revision 3 now
freezes nineteen native/generated release-WASM parity fixtures, one production-
browser lifecycle fixture, and three performance workloads for the bounded
single-explicit-target Blind Cut slice. Fresh native and release-WASM evidence
validates and compares 19/19 with zero differences against the independent
oracles. The generated release runtime is locked to build ID
`solid-feature-sprint-5-r3-20260831` and SHA-256
`38de6df2ef1e2fc6543fa01e1483981a4c7bcbcabe79e5c71aadcf031f540313`.

Revision-3 review remediation now proves exact invalid support/profile
refusals without claiming a Boolean attempt, a complete two-body pre-state and
unchanged unrelated body, actual Cut repair evaluation with transaction/result
binding, and the same authoritative recovery evidence through the generated
worker in production. The focused lifecycle/recovery artifact at
`artifacts/solid-feature-qualification/focused-s5-r3-review-remediation-recompute`
passes 2/2. The hardened performance result passes all three workloads with
zero invalid topology transitions, Long Tasks, or budget violations; its twelve
failure/recovery samples all record the real refusal, exact state restoration,
repair/retry, diagnostic, and request pairs.

This remains a prequalification checkpoint. The new source-bound immutable
revision-3 bundle, isolated bundle validation, independent exact-state
`ZERO FINDINGS`, reconciled final completion ledger, and final documentation-
only re-review remain open. Sprint 5 is **UNQUALIFIED** and every exclusion in
the frozen Sprint 5 specification remains deferred.

## 2026-09-01 — Sprint 5 full qualification checkpoint

Candidate `solid-feature-sprint-5` revision 3 has passed its complete
source-bound automated qualification and sealed the immutable evidence bundle
at
`artifacts/solid-feature-qualification/runs/20260901T070012Z-solid-feature-sprint-5-r3`.
The successful run validates nineteen native and nineteen generated
release-WASM fixtures with 19/19 parity and zero differences, passes all 3
production-browser tests, indexes 45 records, checksums 213 files, and passes a
separate isolated-bundle validation. The locked runtime remains build
`solid-feature-sprint-5-r3-20260831`, SHA-256
`38de6df2ef1e2fc6543fa01e1483981a4c7bcbcabe79e5c71aadcf031f540313`.

The immediately preceding full attempt passed all substantive commands but was
correctly rejected at completeness because the shared evidence schema omitted
the new revision-3 recovery-result fields. It produced no qualified bundle and
is preserved at
`artifacts/solid-feature-qualification/runs/20260901T064850080Z-incomplete`.
The schema and a revision-bounded positive/negative regression now close that
gap.

All three performance workloads pass their frozen limits with zero violations
and zero attributed Long Tasks. Rectangle preview/recompute p50/p95 is
51.9/67.2 ms and 25.0/35.8 ms; annulus is 59.5/69.7 ms and 31.2/49.9 ms;
failure/recovery preview is 60.0/66.3 ms and the complete sequence is
484.4/864.7 ms against 750/1200 ms. All twelve recovery samples prove the real
worker refusal, accepted-state preservation, exact diagnostic/request pair,
and repaired retry.

No implementation or automated-qualification shortcoming remains inside the
bounded single-explicit-target Blind Cut slice. Join/Intersect, broader target
selection, additional extents, draft/thin behavior, generalized repair,
additional supports and profile families, and Revolve/Sweep/Loft remain
deferred. Sprint 5 is still **NOT YET QUALIFIED** solely because the mandatory
independent exact-state review and final documentation-only re-review have not
yet returned exact `ZERO FINDINGS`.

## 2026-09-01 — Sprint 5 independent review checkpoint

The mandatory reviewer found no implementation or immutable-evidence defect,
but initially rejected the completion update because status/table edits inside
the pre-run specification and qualification ledger violated their strict
append-only policy. Those pre-existing bytes were restored. The frozen prefixes
of the specification, qualification ledger, and backlog now reproduce their
Attempt 13 source-snapshot hashes exactly; all later qualification and review
facts remain appended tails.

The reviewer then repeated the exact-state audit and returned exact
`ZERO FINDINGS`. Candidate qualification-ready validation, isolated bundle
validation at 45 records/213 checksummed files, and `git diff --check` pass.
No product or evidence shortcoming remains in the bounded Sprint 5 slice, and
all earlier deferrals remain unchanged. Sprint 5 is **NOT YET QUALIFIED** only
until the separately required final documentation-only re-review returns exact
`ZERO FINDINGS` for these reconciled append-only records.

## 2026-09-01 — Sprint 5 qualified closeout

The final independent documentation-only re-review returned exact
`ZERO FINDINGS`. Candidate `solid-feature-sprint-5` revision 3 is therefore
**COMPLETE AND QUALIFIED** for the frozen single-explicit-target Blind Cut
boundary, with all five Sprint 5 stories complete. The immutable qualifying
bundle remains
`artifacts/solid-feature-qualification/runs/20260901T070012Z-solid-feature-sprint-5-r3`
at 45 records and 213 checksummed files. All failed attempts, the append-only
documentation finding and remediation, shortcomings, and deferrals remain in
the Sprint 5 qualification ledger. No deferred target, extent, repair, support,
profile, or Revolve/Sweep/Loft behavior is promoted.

## 2026-09-02 — Sprint 5 current-source requalification history

All five Sprint 5 stories remain complete for the same frozen single-explicit-
target Blind Cut scope. The prior qualifying bundle remains immutable history
for its own source identity, while later lint and generated-output maintenance
required current source to repeat the no-waiver gate without promoting any
backlog exclusion or deferral.

The first run is preserved at
`artifacts/solid-feature-qualification/runs/20260902T000118944Z-incomplete`.
It stopped at locked Rust 1.98 lint after seven passing commands; command 8
returned 101 for two `chunks_exact(2)` findings. Commit
`8b66f718ecfe2ca3123239a851ee4aa6d1e0aa65` remediated them. The next
run is preserved at
`artifacts/solid-feature-qualification/runs/20260902T004241733Z-incomplete`.
All 18 ledgered commands and both byte-identical generator passes succeeded, but
the following synchronization assertion correctly found that the output
differed from the checked-in generated state present at run start. Commit
`13966369dfb836176271f9ff4aaa4af903c25356` synchronized the generated
artifacts and current runtime lock. Neither failed attempt produced a qualifying
bundle.

The fresh run passed and sealed
`artifacts/solid-feature-qualification/runs/20260902T005828Z-solid-feature-sprint-5-r3`.
It binds commit `13966369dfb836176271f9ff4aaa4af903c25356`, manifest SHA-256
`e1a4b79f3b4cf1cf930d0745f7bdcda5cc2b56436c3316fab68f97e57881a526`,
runtime WASM SHA-256
`a8fccae29d36468623da693fc07edd8da4c1f692aa654c75e47e38c42c5d126d`,
and source snapshot SHA-256
`ae861b966bca656c850f7d114a8e82d8caed6b6d3ac6b1e02caf394010b90ef2`
over 496 files with zero deleted entries. All 30 commands and 45 records pass;
native/release-WASM evidence is 19 plus 19 with 19/19 zero-difference parity;
browser qualification is 3/3; and isolated validation passes at 45 records and
213 checksummed files. Performance passes all three workloads with zero Long
Tasks or violations; failure/recovery measures 484.2/918.8 ms p50/p95 against
its unchanged 750/1200 ms limits and proves all twelve refusal/recovery samples.

This append preserves the backlog's bundle-captured first 82,700 bytes,
SHA-256
`6a9a54c2d860d03bad97ed7fa4d5d88784124effcde22bbf6ff3e7997f1add5f`,
byte-for-byte. Attempts 17 and 18 remain unwaived failure history. The current-
source automated gate is green, but mandatory independent exact-state and final
documentation-only `ZERO FINDINGS` reviews remain open. Sprint 5 therefore has
not yet completed current-source requalification; all previously deferred
target, result, extent, repair, support, profile, Revolve, Sweep, and Loft work
remains deferred.

## 2026-09-02 — Sprint 5 current-source exact-state review checkpoint

The mandatory independent reviewer audited commit
`0ca413d255610f30b981b8c7e9c7494bf44982f9`, the sealed current-source
Sprint 5 bundle, and the complete append-only requalification history, and
returned exact `ZERO FINDINGS`. The implementation/evidence exact-state gate is
closed with every story, exclusion, shortcoming, and deferral unchanged.

This append preserves the backlog's first 85,385 bytes at SHA-256
`c732c4fed0fc37e7ce42fa18a19355b323fff82ee5b6822114fe61a26b881e47`.
The final documentation-only re-review remains open. Sprint 5 is therefore
**NOT YET CURRENT-SOURCE REQUALIFIED**, and no final current-source completion
or deferred feature promotion is claimed.

## 2026-09-02 — Sprint 5 current-source requalification closeout

The mandatory independent documentation-only reviewer examined commit
`ba6e3c6894a51f72091a0f467e0f1523761385be`, the append-only current-source
reconciliation, and the immutable bundle at
`artifacts/solid-feature-qualification/runs/20260902T005828Z-solid-feature-sprint-5-r3`,
and returned exact `ZERO FINDINGS`. The final current-source gate is closed.

All five Sprint 5 stories remain complete for the same frozen single-explicit-
target Blind Cut boundary. The earlier `20260901T070012Z` bundle remains
immutable historical evidence; the `20260902T005828Z` bundle is the current-
source qualifying evidence at 45 passed records and 213 checksummed files.
Attempts 17 and 18 remain preserved rejected history rather than waived passes.

This append preserves the backlog's reviewed first 86,138 bytes at SHA-256
`e61324de8d1f9b293fdd94dca0abbb917d77e3f778bc4ffd46864d6fe2f9b147`.
No target, result, extent, repair, support, profile, Revolve, Sweep, or Loft
deferral is promoted, and no current-source Sprint 5 qualification gate remains
open.
