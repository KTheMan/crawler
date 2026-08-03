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

- The exact Monstertruck commit and promotion policy are recorded in an ADR.
- Native and `wasm32-unknown-unknown` contract checks cover construction,
  tessellation, booleans, stable IDs, and STEP I/O.
- A failed contract prevents advancing the submodule pin.
- The contract suite runs without the unavailable documentation-only nested
  submodule.

**Status:** Complete (2026-07-31)

**Evidence:**

- [ADR 0001](architecture/adr/0001-monstertruck-kernel-baseline.md) records the
  exact kernel/resource pins, Phase 5 rationale, promotion policy, gates, and
  qualified raw-WASM API gaps.
- `contracts/kernel-baseline/tests/kernel_contract.rs` executes six native
  contracts covering profile extrusion, WASM render buffers, booleans, stable
  ID persistence, STEP round-trip behavior, and typed native failures.
- `./scripts/qualify-kernel.ps1` verifies the pins and clean vendor worktrees,
  runs the native suite, and compiles it for `wasm32-unknown-unknown` without
  requiring `.blueprints`.
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

---

## E05 — Solid feature modeling

**Outcome:** Users can build useful mechanical parts through editable,
schema-driven features.

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
