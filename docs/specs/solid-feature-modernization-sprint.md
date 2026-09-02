# Solid Feature Foundations — Sprint 1

- Status: complete; revision 5 qualified after zero-finding independent review
- Planning date: 2026-08-25
- Sprint duration: team-defined; no elapsed-time estimate is implied by relative size
- Sprint goal: deliver one exact, durable blind New Body Extrude vertical slice
- Parent initiative: [Solid Feature Modernization Initiative Backlog](solid-feature-modernization-initiative.md)
- Parent backlog: [E05 — Solid feature modeling](../BACKLOG.md#e05--solid-feature-modeling)

## 1. Sprint outcome

Deliver the first non-demo solid-feature slice without extending the current
polygon-only, origin-plane-only, transaction-log-driven architecture.

At sprint exit, a modeler must be able to create an exact blind New Body Extrude
from one line/arc/circle region with holes on an origin plane, commit it as one
typed durable feature, save/reload it, and edit every delivered input through the
same operation schema: numeric distance and a compatible selected-region
replacement; the support origin plane is derived from that region and has no
separate Sprint 1 rebinding control. Construction-plane support,
reverse/symmetric extent, Join, and Cut are stretch scope and enter the frozen
candidate only when their named gates and team capacity are satisfied. Join and Cut must not be simulated or
silently limited to geometry outside the candidate manifest.

Revolve, Sweep, and Loft remain documented in the parent initiative rather than
public Sprint 1 feature commitments. The optional P1 discovery track can produce
named kernel decisions for Sweep and Loft without displacing the frozen Extrude
candidate. Sweep remains experimental until a true tangent-following surface is
qualified. Loft continuity controls remain disabled until the kernel can
construct and measure the claimed boundary continuity.

## 2. Why the sprint is deliberately narrow

Independent product, CAD-kernel, and qualification reviews found that the full
modernization backlog is a multi-sprint initiative. Current blockers include:

- generic Boolean execution is broader natively than in the current WASM path;
- construction planes are reserved references, not evaluated document entities;
- durable features cannot store ordered typed reference collections or complete
  feature definitions;
- the feature kernel accepts polygon loops and returns one solid body;
- Sweep is a translated-profile skin, not a continuous swept surface; and
- Loft is polygon resampling plus skinning with no rail or boundary-derivative
  contract.

Sprint 1 therefore builds the durable and geometric foundation, proves the risky
kernel paths, and ships only the vertical slice supported by those results.

## 3. Commitment model

### 3.1 Priority and size

| Label | Meaning |
|---|---|
| P0 | Required for the candidate; omission changes the sprint goal |
| P1 | Conditional stretch behind an explicit P0 gate |
| S | Narrow, established implementation pattern |
| M | Bounded cross-layer story or time-boxed technical decision |
| L | Full vertical slice; must have named intermediate test checkpoints |

There are no committed XL stories. Any story discovered to be XL returns to
initiative decomposition before implementation continues.

### 3.2 Gate 0 and candidate freeze

E3D-S1-01 and E3D-S1-02 are pre-commitment Gate 0 stories. They must complete
before the sprint candidate freezes. If E3D-S1-02 cannot prove the required
line/arc/circle path, this sprint goal is not committed under narrower hidden
semantics; the team revises and re-reviews the sprint plan first.

E3D-S1-03 is a separate P1 discovery track. It does not consume committed
Extrude capacity and is not a Sprint 1 exit criterion.

Candidate revision 5 retains these exact P0 story IDs and acceptance boundary
while enforcing the deferred cross-sketch replacement boundary found open in the
revision 4 independent audit:

| Sequence | Story | Size | Candidate result |
|---:|---|---:|---|
| 1 | E3D-S1-05 | L | Typed durable `FeatureDefinitionV2` |
| 2 | E3D-S1-06 | L | V2 line/arc/circle profile transport |
| 3 | E3D-S1-07 | L | Stable outer-loop/hole region references |
| 4 | E3D-S1-08 | L | Exact blind New Body Extrude |
| 5 | E3D-S1-11 | L | Unified create/edit Extrude workflow |
| 6 | E3D-S1-12 | M | Legacy solid-feature compatibility matrix |
| 7 | E3D-S1-13 | M | Candidate manifest and qualification harness |
| 8 | E3D-S1-14 | L | Native/WASM geometry parity runner |
| 9 | E3D-S1-15 | L | Production-build browser and evidence gate |

E3D-S1-04, E3D-S1-09, E3D-S1-10, and E3D-S1-16 are P1 stretch and are not part of
the candidate unless the team updates the checked-in candidate manifest before
implementation begins. This candidate assumes parallel document/schema,
kernel/runtime, and web/qualification workstreams. If team capacity cannot staff
those workstreams, split the manifest at E3D-S1-07: foundation first, then the
E3D-S1-08/S11/S15 user-visible vertical slice. Do not retain the visible slice
while dropping its durable, native-geometry, compatibility, or qualification
dependencies.

### 3.4 Implementation and completion ledger

This ledger is authoritative for Sprint 1 scope. `Implemented` does not mean
`Qualified`: candidate stories become complete only when the immutable full-gate
bundle passes and the independent review reports no issues.

| Story | Scope | State | Completion evidence or shortcoming |
|---|---|---|---|
| E3D-S1-01 | Gate 0 Boolean decision | Decision complete | Native/release-WASM matrix is recorded in `docs/qualification/solid-feature-gate0.md`. Join/Cut are excluded; generic WASM Boolean and returned `preserved_inputs` remain follow-up work. |
| E3D-S1-02 | Gate 0 exact curve decision | Decision complete for line/arc/circle | Exact rational arc/circle construction passed. Elliptical arcs, general conics, and canonical fit splines remain deferred. |
| E3D-S1-03 | Sweep/Loft kernel spike | Deferred / non-candidate | No Sprint 1 capability evidence was promoted. Existing prepared operations are not competitive Sweep/Loft implementations. |
| E3D-S1-04 | Durable construction planes | Deferred / non-candidate | Sprint 1 accepts origin-plane support only. |
| E3D-S1-05 | `FeatureDefinitionV2` | Qualified | Typed operation/result/reference definitions, canonical storage, history, versioning, and compatibility contracts passed content-bound evidence. |
| E3D-S1-06 | Exact profile transport | Qualified | Line, circular-arc, and circle regions crossed document/runtime/kernel boundaries without polygon authority in native/release-WASM evidence. |
| E3D-S1-07 | Stable region references | Qualified | `RegionDefinitionV2` outer/hole identity, annulus behavior, stale-reference refusals, and explicit identity ownership passed. |
| E3D-S1-08 | Blind New Body Extrude | Qualified | Native and generated release-WASM performed same-ID rectangle-to-circle upstream edit/recompute with exact bounds/profile and 6 retained/20 replaced identities. |
| E3D-S1-09 | Reverse/symmetric extents | Deferred / non-candidate | Positive blind extent only. |
| E3D-S1-10 | Join/Cut target modes | Deferred / non-candidate | No Join/Cut UI or hidden restricted semantics are enabled. |
| E3D-S1-11 | Unified create/edit workflow | Qualified | Same-sketch selected replacement passes. Replacement requires the exact source sketch ID and two ready, equal resolved frames; incompatible cross-sketch selection blocks with an explicit reason before preview/commit, with zero dispatch and unchanged hash/references/IDs/bounds/count through recompute/reload. Cross-sketch replacement, dedicated reference display/locate/remove/target chips, support rebinding, and result-mode edits remain deferred. |
| E3D-S1-12 | Legacy compatibility matrix | Qualified | Seven operation-specific V1 goldens passed complete lifecycles and exact hashes; actual future/downgrade/unknown/malformed cases failed atomically. |
| E3D-S1-13 | Candidate manifest/harness | Qualified | Content-addressed source identity, materialized external inputs, portable record links, 55 records, 169 checksums, and isolated timestamped-copy validation passed. |
| E3D-S1-14 | Native/release-WASM parity | Qualified | Full parity passed 15/15 with exact nonempty identity ownership; comparator self-tests passed 7/7. |
| E3D-S1-15 | Production browser/evidence gate | Qualified | Production browser passed 6/6 across all four manifest IDs; both performance workloads and isolated immutable-copy validation passed. |
| E3D-S1-16 | Advanced negative/migration expansion | Deferred / non-candidate | Remains follow-on work and cannot satisfy a candidate record. |

Current evidence status and the retained failure history are maintained in
`docs/qualification/solid-feature-sprint-qualification.md`.

The superseded revision 3 automated result remains immutably retained at
`artifacts/solid-feature-qualification/runs/20260826T094412Z-solid-feature-sprint-1-r3`.
The revision 3 independent audit rejected that run for its E3D-S1-11
selected-replacement evidence gap. Revision 4 closed that gap and its automated
result is immutable at
`artifacts/solid-feature-qualification/runs/20260826T105732Z-solid-feature-sprint-1-r4`.
The revision 4 independent audit then found that cross-sketch selection could
enter the replacement path despite its deferred boundary, so revision 4 is also
historical evidence only. Revision 5 blocks that path and passed automatically at
`artifacts/solid-feature-qualification/runs/20260826T115242Z-solid-feature-sprint-1-r5`:
25/25 commands, application 214/214, worker 13/13, parity 15/15, comparator 7/7,
non-parity 6/6, and browser 6/6. The fresh independent revision 5 review reported
zero findings, satisfying the completion gate. Sprint 1 and all nine candidate
stories are qualified; deferred and non-candidate scope remains unqualified.

### 3.3 Gate outcomes and scope changes

- A failed E3D-S1-01 keeps both Join and Cut out of Sprint 1 and records the
  selected WASM Boolean remediation as the first follow-on implementation story.
- A failed E3D-S1-02 prevents candidate freeze. The team revises the sprint goal;
  it may not silently narrow or polygonize the promised line/arc/circle slice.
- E3D-S1-03 does not affect the Extrude candidate. Its result blocks or unblocks
  follow-on public Sweep, Loft rails, and Loft continuity work.
- A story cannot be removed from the candidate after qualification starts. Scope
  changes require a new candidate-manifest revision and a complete rerun.

## 4. Definition of ready

A sprint story is ready only when:

- its supported and rejected geometry matrix is explicit;
- every dependency is another story ID or an existing repository contract;
- authoritative document data is distinguished from evaluated/cache data;
- expected success, empty-result, disjoint, ambiguous, and failure behavior is
  binary and names the structured error category or result;
- legacy-schema behavior is preserve, migrate, or reject—never merely “readable”;
- native, WASM, runtime, and browser evidence requirements are named; and
- the accepted document/body hashes that must survive failure are identified.

## 5. Definition of done

A story is complete when all its acceptance criteria pass and:

1. preview and commit consume the same normalized definition;
2. out-of-order, canceled, or superseded worker results cannot update preview,
   feature status, commit state, or accepted bodies;
3. failure preserves the previous accepted document and output-body hashes;
4. durable changes support edit, suppress, undo/redo, save/reload, and recompute;
5. stable identities retained or replaced are asserted by fixture-owned sets;
6. display tessellation never becomes authoritative modeling input;
7. unknown schema versions and unsupported required capabilities fail closed;
8. generated bindings and release WASM are reproducible and synchronized; and
9. evidence is produced by the production candidate, not a mock worker,
   TypeScript geometry substitute, or reused development server.

---

## Sprint Epic A — Kernel capability gates

**Outcome:** The team makes bounded, evidence-backed decisions before building UI
or schemas that the browser geometry path cannot execute.

### E3D-S1-01 — Qualify Boolean execution in release WASM

**Priority / Size:** Gate 0 / M

**Depends on:** E00-S01, E00-S02, E05-S03

**Story:** As a feature team, we need to know exactly which Boolean classes run
safely in release WASM so Join and Cut scope is honest and testable.

**Acceptance criteria:**

- A canonical matrix executes union and difference for axis-aligned prisms,
  rotated prisms, extruded circular/arc profiles, disjoint bodies, contained
  tools, tangent contact, empty results, and multi-shell results.
- The same fixtures execute natively and through generated release WASM.
- Each matrix cell is `supported`, `unsupported`, or `blocked`, with a structured
  reason and no process trap or silent fallback.
- The decision selects one path: qualify generic WASM Boolean, move Boolean to a
  different execution boundary, or constrain Sprint 1 Cut to named fixtures.
- E3D-S1-10 consumes the checked-in matrix rather than duplicating assumptions.

**Required evidence:** decision record, raw native/WASM results, before/after
body hashes for failures, and a regression test reproducing the current browser
limitation.

### E3D-S1-02 — Qualify native curve-to-face construction

**Priority / Size:** Gate 0 / M

**Depends on:** E00-S01, current sketch native-curve contracts

**Story:** As a CAD-kernel developer, I need a curve capability matrix so the V2
profile contract represents geometry the kernel can actually build, Boolean,
mesh, and export.

**Acceptance criteria:**

- Line, circle, trimmed arc, ellipse, elliptical arc, rational conic, control-
  point B-spline, and normalized fit spline are evaluated separately.
- The spike covers curve conversion, trimming/seams, loop closure, planar face
  construction, extrusion, tessellation, Boolean participation, and STEP output.
- Fit splines have a named canonical conversion; sampled Catmull–Rom points are
  not accepted as an exact feature representation.
- Every curve class is marked native, exact rational conversion, bounded
  approximation, or unsupported. Bounded approximation cannot be labeled
  analytic and requires an explicit capability flag.
- The selected DTO version and migration boundary are recorded.

**Required evidence:** kernel spike tests, surface/curve classification, display-
tolerance invariance, and an ADR or decision note linked from the candidate
manifest.

### E3D-S1-03 — Qualify Sweep and Loft surface-generation paths

**Priority / Size:** P1 / M

**Depends on:** E3D-S1-02

**Story:** As a CAD-kernel developer, I need to know whether the selected kernel
can create continuous swept and lofted surfaces so follow-on stories do not
mistake sampled skins for production geometry.

**Acceptance criteria:**

- Sweep evidence distinguishes curve-chain representation, profile-to-path
  placement, frame transport, continuous surface construction, caps, corners,
  seams, and self-intersection.
- Loft evidence distinguishes section normalization, connector-driven curve
  splitting, ruled/skin surfaces, rails, and G0/G1/G2 boundary derivatives.
- Sheet-body prerequisites and singular/multiple output behavior are recorded.
- The decision names the narrowest viable first Sweep and Loft implementation or
  records the missing kernel contribution/adapter.
- No public capability is enabled from frame or connector math alone.

**Required evidence:** straight/bent Sweep and two/three-section Loft probes,
surface-class inspection, continuity measurements where claimed, and explicit
supported/rejected matrices.

---

## Sprint Epic B — Durable solid-feature foundations

**Outcome:** Solid intent is represented by typed document data and evaluated in
a complete support frame rather than reconstructed from journal JSON.

### E3D-S1-04 — Add construction-plane definitions and evaluated plane frames

**Priority / Size:** P1 / L

**Depends on:** E00-S04, E04-S05

**Story:** As a modeler, I need a real construction plane and complete support
frame so solid features can exist away from the three origin planes.

**Acceptance criteria:**

- The document stores a versioned `ConstructionPlaneDefinition` map with stable
  identity, defining references/parameters, suppression, and dependencies.
- An evaluated `PlaneFrame` stores origin plus an X/Y basis; normal and
  handedness derive deterministically from that basis under a documented fixed-
  point normalization tolerance.
- Origin-plane and construction-plane supports resolve through one local/world
  transform contract.
- The authoritative support reference remains durable; evaluated world frames
  are recomputable cache/evidence, not a replacement for design intent.
- Offset and angled plane edits dirty only dependent features and survive
  undo/save/reload.
- Degenerate, circular, suppressed, and missing plane dependencies enter a
  structured failed/reference-repair state.

**Intermediate checkpoints:** document/versioning fixtures; evaluator tests;
runtime transform tests; browser plane create/edit/reload workflow.

**Required evidence:** origin, signed-offset, angled-reference, and failed-plane
fixtures with exact local/world point round trips within fixture tolerance.

### E3D-S1-05 — Add typed durable `FeatureDefinitionV2`

**Priority / Size:** P0 / L

**Depends on:** E00-S04, E00-S05

**Story:** As a modeler, I need the document—not the transaction journal—to own
the complete executable feature definition so edits and recompute remain
portable and inspectable.

**Acceptance criteria:**

- `FeatureDefinitionV2` stores versioned operation kind, ordered reference lists,
  typed extents/modifiers, result mode, participant bodies, and parameter IDs.
- Generic dependency traversal and repair inspect all scalar and ordered
  references without command-specific `profile_2` key conventions.
- The transaction journal retains request/evidence for audit but is not the only
  source from which an accepted feature can be re-executed.
- Preview definitions remain transient; commit writes one canonical durable
  definition in one transaction.
- Unknown kinds, enum values, required capabilities, and schema versions fail
  closed with no accepted-document mutation.
- A V1 feature can be preserved or migrated according to E3D-S1-12.

**Intermediate checkpoints:** canonical Rust schema; TypeScript mirror; generic
dependency traversal; runtime evaluation; journal-independence test.

**Required evidence:** cross-language round trips, ordered-reference edit,
missing-reference repair, request-log removal/rebuild test, and canonical hashes.

### E3D-S1-06 — Transport line, arc, and circle profiles through V2

**Priority / Size:** P0 / L

**Depends on:** E3D-S1-02, E3D-S1-05, and the existing origin-plane contract

**Story:** As a modeler, I need common mechanical profiles to remain native from
sketch through feature execution so cylinders and arc walls are not faceted by
modeling-input sampling.

**Acceptance criteria:**

- A versioned Curve2/Curve3 and ordered-loop contract covers lines, trimmed arcs,
  and circles with stable source references, parameter intervals, seam, winding,
  and support frame.
- Sketch-local definitions normalize into the kernel representation selected by
  E3D-S1-02 without fixed display-derived sample counts.
- Display quality changes cannot change operation validity, document hash,
  analytic classification, bounds, volume, or topology identity sets.
- Unsupported curves produce a capability error before preview; they never
  silently enter the V2 operation as polygons.
- Native and WASM execution normalize to the same fixture result.

**Intermediate checkpoints:** DTO/schema tests; line/arc/circle face contracts;
runtime normalization; WASM parity.

**Required evidence:** rectangle, circle, line/arc capsule, annulus-boundary, and
unsupported-spline fixtures.

### E3D-S1-07 — Represent stable regions with holes

**Priority / Size:** P0 / L

**Depends on:** E3D-S1-05, E3D-S1-06

**Story:** As a modeler, I need an explicit material region so an outer boundary
and its holes do not depend on curve creation or array order.

**Acceptance criteria:**

- `RegionReference` records sketch identity, support, stable outer-boundary
  curve references, and ordered inner-boundary references.
- Containment parity and loop orientation classify one outer boundary with zero
  or more holes independently of entity creation order.
- Sprint 1 supports one selected region per Extrude. Multiple disjoint selected
  regions are explicitly deferred to the initiative backlog.
- Open, overlapping, self-intersecting, and multiply ambiguous arrangements
  return referenced curve IDs and measured gaps/intersections.
- Named topology-preserving edits retain region identity; split/merge edits enter
  repair state rather than silently selecting a replacement region.

**Intermediate checkpoints:** arrangement diagnostics; containment/orientation;
region identity matching; viewport selection handoff.

**Required evidence:** rectangle, annulus, two-hole plate, creation-order
permutation, open loop, overlap, and split/merge repair fixtures.

---

## Sprint Epic C — Exact Extrude vertical slice

**Outcome:** Extrude becomes the first feature using V2 definitions, exact common
curves, the three existing origin planes, positive blind New Body semantics, and
complete history edit. Durable user construction planes and additional result or
extent modes remain non-candidate work.

### E3D-S1-08 — Execute exact blind New Body Extrude

**Priority / Size:** P0 / L

**Depends on:** E3D-S1-02, E3D-S1-05 through E3D-S1-07, and the existing
origin-plane contract

**Story:** As a modeler, I need to extrude a precise region into a new body so the
first modernized solid feature is useful without Boolean dependencies.

**Acceptance criteria:**

- Blind Extrude accepts one V2 region, exact positive distance, and support-
  normal direction.
- XY, XZ, and YZ origin-plane profiles create correctly placed solids.
- Line/arc/circle inputs retain the analytic/equivalent classifications proven
  by E3D-S1-02.
- The feature stores `result_mode = new_body`, a stable output ID, exact distance
  parameter identity, and complete source dependencies.
- Preview/cancel/commit are atomic and stale results are rejected by operation
  and accepted-document revision.
- Edit, upstream sketch/plane recompute, suppress, undo/redo, save/reload, and
  deterministic replay pass through generated release WASM.

**Required evidence:** rectangle, cylinder, capsule, annular solid, each origin
plane, invalid/open region, cancel, stale preview, and reload edit fixtures.

### E3D-S1-09 — Add reverse and symmetric blind extents

**Priority / Size:** P1 / M

**Depends on:** E3D-S1-08

**Story:** As a modeler, I need reverse and symmetric Extrude so basic placement
does not require sketch-plane duplication.

**Acceptance criteria:**

- Direction modes are `forward`, `reverse`, and `symmetric`; two-sided
  independent extents remain follow-on scope.
- The durable symmetric parameter is an integer-nanometer half-length. The UI
  displays total end-to-end length as exactly twice that value; user-entered
  totals normalize to a representable even-nanometer value before preview and
  visibly report the normalized value.
- Direction derives from the evaluated support frame and never from camera
  orientation.
- Numeric entry and model-space handle update the same exact distance and mode.
- Angled-frame endpoints use the fixed-point evaluation tolerance established by
  E3D-S1-04; the UI does not claim a smaller Euclidean error.
- Mode edits retain feature/output IDs when fixture-owned compatibility rules
  permit and identify replaced topology IDs otherwise.

**Required evidence:** exact bounds for each mode, angled-plane direction,
camera-invariant drag, edit/cancel/undo/reload, and identity-set assertions.

### E3D-S1-10 — Gate Join and Cut on browser Boolean evidence

**Priority / Size:** P1 / L

**Depends on:** E3D-S1-01, E3D-S1-08

**Story:** As a modeler, I need qualified visible result behavior so an Extrude
can add to or subtract from the intended solid without a hidden temporary-body
workflow.

**Product behavior for Sprint 1:**

- A blank document defaults to New Body.
- Exactly one active editable solid body plus an overlapping preview defaults to
  Join. Any other context defaults to New Body.
- Once the user selects a result mode, later previews never change it
  automatically.
- Join or Cut has exactly one explicit target body in Sprint 1.
- Explicit Join/Cut with a disjoint tool fails with `no_intersection`; it does
  not silently create a new body or accept a no-op.
- Intersect and multi-target participant scope remain follow-on scope.

**Acceptance criteria:**

- Join and Cut remain disabled unless E3D-S1-01 marks their exact candidate
  geometry classes supported in generated release WASM.
- New Body and every result mode marked supported by E3D-S1-01 execute from one
  generic “construct tool, then apply result” definition.
- The typed result records target, tool definition, body lifecycle, and stable
  output-ID rules separately from the profile/extent definition.
- A failed Boolean preserves target bytes/hash, source inputs, and editable
  preview definition.
- Suppression restores the target-only state; unsuppression deterministically
  reapplies the operation.
- Join and Cut are disabled with the gate's capability reason if candidate
  geometry is not safe in release WASM.

**Required evidence:** default-mode rules, overlapping Join, disjoint failure,
qualified Cut fixtures, suppress/undo/reload, and native/WASM comparison.

### E3D-S1-11 — Unify Extrude create and edit UX

**Priority / Size:** P0 / L

**Depends on:** E3D-S1-05 through E3D-S1-08

**Story:** As a modeler, I need creation and timeline editing to expose the same
Extrude inputs so the feature is fully parametric after commit.

**Acceptance criteria:**

- One capability-driven operation schema drives region, region-derived origin
  support, distance, positive support-normal direction, New Body result mode,
  preview, create, and edit. Target collection is absent because E3D-S1-10 is
  not promoted.
- Tool-first and selection-first flows resolve the same typed definition.
- Region and support resolve from the active selection or stored edit
  definition; selection-first creation and a compatible viewport selection from
  the stored source sketch/support can supply a region replacement during
  timeline edit. Cross-sketch reference replacement, separate support rebinding,
  dedicated reference display, locate/remove chips, and all target-chip behavior
  are explicitly deferred and cannot be claimed by this candidate.
- The linear handle is anchored and projected in model space; orbit, zoom, and
  resize do not alter the parameter mapping.
- `Enter` commits, `Escape` cancels, and edit cancellation restores the prior
  definition, accepted geometry, selection-safe IDs, and document hash.
- Rapid field edits, cancel during preview, and upstream recompute reject late
  worker responses. Result-mode changes remain deferred with E3D-S1-10.
- The prior command-specific screen-pixel Extrude path is removed only after V1
  compatibility passes.

**Required evidence:** unit command-state tests; camera-invariant manipulator
tests; tool-first, selection-first, and selected-replacement edit equivalence;
keyboard/accessibility checks; browser lifecycle through production WASM.

---

## Sprint Epic D — Compatibility and advanced-tool readiness

**Outcome:** Existing documents remain safe and the next Revolve, Sweep, and Loft
stories begin from evidence rather than from the old polygon contracts.

### E3D-S1-12 — Define and test the legacy solid-feature matrix

**Priority / Size:** P0 / M

**Depends on:** E3D-S1-05, selected V2 operation contracts

**Story:** As a modeler, I need existing parts to open without silent geometry or
identity drift while modernized features adopt new schemas.

**Acceptance criteria:**

- Golden documents cover every previously shipped Extrude, Extrude Cut,
  Revolve, Revolve Cut, Loft, Sweep, and Boolean schema.
- Each operation is explicitly `preserve_v1`, `migrate_v1_to_v2`, or
  `open_read_only`; save behavior and edit availability are named.
- Migration is adjacent-version, deterministic, atomic, and idempotent.
- Source bytes remain recoverable until migrated document and geometry validate.
- Legacy polygon Sweep is never silently rewritten as tangent-following Sweep.
- Polygon features are never relabeled as analytic geometry.
- Unknown newer versions, enum values, required capabilities, downgrade
  requests, and lossy conversion fail closed without mutating the source.

**Required evidence:** open/recompute/edit/save/reopen as applicable, migrate
twice, future-version rejection, failed-migration atomicity, and golden body/
document hashes.

### E3D-S1-16 — Resolve planar-face support for solid features

**Priority / Size:** P1 / L

**Depends on:** E3D-S1-04, E06-S04

**Story:** As a modeler, I need a sketch on a planar face to drive Extrude so
common sequential modeling does not require construction-plane duplication.

**Acceptance criteria:**

- A planar topology reference resolves a component-local support frame with a
  documented origin, X-axis, normal, orientation, and recompute convention.
- The durable sketch stores the support reference, not only a captured world
  frame.
- Upstream face motion updates placement; missing or non-planar replacement
  enters repair state.
- Rebinding previews the recovered Extrude before one atomic commit.
- Stable support-face identity or geometric-signature recovery is explicit and
  never silently substitutes a different face.

**Required evidence:** face-supported Extrude, upstream face translation,
missing face, non-planar rejection, explicit rebind, undo, and reload.

**Follow-on dependency map (not a completion claim):**

| Tool | Actual Sprint 1 state | First implementation story after Sprint 1 |
|---|---|---|
| Revolve | Some native curve/result prerequisites and V1 disposition are reusable; no Sprint 1 public implementation | Initiative E3D-04-S01/S02, decomposed against E3D-S1-02 |
| Sweep | E3D-S1-03 decision deferred; no readiness evidence produced | Initiative E3D-05-S01/S02, beginning with CurveChain and a new capability gate |
| Loft | E3D-S1-03 decision deferred; no connector/rail/continuity readiness evidence produced | Initiative E3D-06-S01/S02; G1/G2 remains gated by a separate surface-generation story |

---

## Sprint Epic E — Auditable qualification

**Outcome:** Candidate scope, artifacts, geometry results, regressions, and
performance are reproducible and independently reviewable.

### E3D-S1-13 — Check in the candidate manifest and harness first

**Priority / Size:** P0 / M

**Depends on:** None; begins in parallel with Sprint Epic A

**Story:** As a release lead, I need machine-readable candidate scope so the
meaning of “sprint complete” cannot drift during qualification.

**Acceptance criteria:**

- `contracts/solid-feature-candidate/sprint-1.json` or equivalent names every
  committed story ID, fixture ID, test ID, expected artifact, supported
  capability, and disposition.
- The manifest excludes its own harness story from recursive evidence rules.
- Schema validation rejects missing, duplicate, unknown, skipped, blocked,
  waived-candidate, failed, and stale evidence records.
- Scope changes increment the manifest revision and invalidate older candidate
  evidence.
- Each fixture owns exact units, input JSON, schema version, expected result or
  structured error, numeric tolerances, retained/replaced identity sets,
  lifecycle steps, and legacy provenance where applicable.

**Required evidence:** manifest schema/unit tests and one intentionally incomplete
candidate that fails the harness.

### E3D-S1-14 — Compare native and release-WASM geometry results

**Priority / Size:** P0 / L

**Depends on:** E3D-S1-13; implemented incrementally with each feature story

**Story:** As a release lead, I need native and browser runtimes to produce the
same normalized result so separate weak test suites cannot hide divergence.

**Acceptance criteria:**

- Each canonical operation fixture runs through native runtime and the generated
  release WASM.
- Positive results compare body count, manifold/orientation state, AABB, signed
  volume, surface area, centroid, analytic curve/surface classification, stable
  identity sets, and canonical document hash using fixture-owned tolerances.
- Negative results compare error category/code, field path, referenced entity
  IDs, and before/after accepted-document and body hashes.
- Unapproved differences fail the candidate. Approved non-candidate platform
  observations are versioned data with owner, rationale, expiry, affected
  evidence, and follow-up; they cannot satisfy a candidate comparison.
- Changing display tessellation does not change normalized modeling results.

**Required evidence:** parity JSON/JUnit output, tolerance schema, positive and
negative fixture comparisons, and deliberate divergence test.

### E3D-S1-15 — Run production-build browser and evidence qualification

**Priority / Size:** P0 / L

**Depends on:** E3D-S1-13, E3D-S1-14, all other candidate-manifest stories

**Story:** As a product owner, I need one reproducible release gate so the sprint
result is proven against the actual production app and runtime.

**Acceptance criteria:**

- The gate runs dependency-pin checks; locked native kernel/document/versioning/
  graph/runtime tests; wasm32 contracts; protocol mirrors; generated catalog,
  bindings, and release WASM; application unit tests; production build; parity
  runner; and selected sketch/profile-handoff regressions.
- Generators run twice and must be byte-identical. Lockfile drift, unexplained
  generated-file diffs, or source/WASM mismatch fail qualification.
- Browser tests run `vite preview` against a fresh production `dist`, use a
  dedicated port with `reuseExistingServer: false`, and assert the loaded runtime
  build ID and WASM SHA-256 from the candidate manifest.
- A versioned qualification-environment profile fixes supported OS/architecture,
  minimum CPU and memory class, Chrome channel/version range, headless mode,
  viewport/device scale, worker count, and production-server configuration. A
  run outside that profile is marked non-qualifying and cannot satisfy the gate.
  Performance comparisons use the same profile and record any allowed variance.
- No mock worker, TypeScript geometry substitute, or pre-existing development
  server is permitted.
- Console/page errors, keyboard/focus regressions, and stale-preview races fail
  the browser gate.
- A versioned budget file defines warm-up, sample count, p50/p95 preview and
  recompute thresholds, cancellation latency, main-thread long-task limit, and
  repeated preview/edit/cancel memory-growth limit for each candidate workload.
- Every run writes a timestamped, checksummed evidence bundle containing commit
  and dirty-tree hashes, lock/tool/browser/host metadata, generated artifact
  hashes, commands/exit codes, machine-readable results, geometry oracles,
  screenshots, raw performance samples, and an SHA-256 manifest.
- The qualification report records pass, fail, or approved waiver per candidate
  story and links the immutable evidence bundle.

**Required evidence:** `scripts/qualify-solid-features.ps1`, a separate
production-preview Playwright configuration, candidate evidence bundle, and
`docs/qualification/solid-feature-sprint-qualification.md`.

## 6. Named fixture registry

The frozen 21-fixture manifest is authoritative. The table below also reserves
future IDs from the planning draft; `future / non-candidate` rows produce no
Sprint 1 completion evidence.

| Fixture ID | Sprint 1 status | Purpose |
|---|---|---|
| `extrude-origin-blind-rectangle` | candidate | Baseline exact prismatic New Body |
| `extrude-origin-blind-circle` | candidate | Exact-rational circular output |
| `extrude-construction-plane-capsule` | future / non-candidate | Construction-plane Extrude |
| `extrude-origin-annulus` | candidate | Outer boundary and hole classification |
| `extrude-reverse-rectangle` | future / non-candidate | Reverse direction and exact bounds |
| `extrude-symmetric-circle` | future / non-candidate | Symmetric half-length contract |
| `extrude-join-overlap` | future / non-candidate | Target and stable Join body lifecycle |
| `extrude-join-disjoint` | future / non-candidate | `no_intersection` Join atomic failure |
| `extrude-cut-qualified-target` | future / non-candidate | Cut after a separately qualified Boolean path |
| `extrude-stale-preview` | candidate | Late worker response rejection |
| `legacy-solid-operation-matrix` | candidate | V1 preserve/migrate/read-only dispositions |
| `sweep-quarter-bend-probe` | future / non-candidate | Frame versus continuous swept-surface decision |
| `loft-three-section-probe` | future / non-candidate | Connector and surface-generation decision |

The remaining candidate fixture IDs and their exact ownership are declared only
in `contracts/solid-feature-candidate/sprint-1.json`; this planning registry does
not add or waive manifest scope.

## 7. Parent-backlog and initiative mapping

| Existing backlog story | Sprint 1 decomposition | Follow-on initiative scope |
|---|---|---|
| E05-S01 — Extrude reference cube | Candidate E3D-S1-05 through S08, S11 through S15 | E3D-S1-04/S09/S10/S16 plus E3D-02/E3D-03 advanced support/extents/modifiers |
| E05-S02 — Revolve and axis selection | E3D-S1-02 curve decision and reusable E3D-S1-05/S12 foundations only | E3D-04 implementation |
| E05-S03 — Booleans | E3D-S1-01 exclusion decision; E3D-S1-10 deferred | E3D-02 participant/multi-result semantics |
| No existing E05 story — Sweep | E3D-S1-03 deferred with no readiness evidence | New E3D-05 capability gate and implementation; initiative expansion |
| No existing E05 story — Loft | E3D-S1-03 deferred with no readiness evidence | New E3D-06 capability gate and implementation; initiative expansion |

The Sprint 1 Extrude work is a quality completion/decomposition of E05-S01, not
a claim that the prior cube workflow never existed. Sweep and Loft are initiative
scope beyond the current PRD alpha list; their Sprint 1 readiness work was
deferred and must be restarted behind new named capability gates.

## 8. Explicit Sprint 1 non-goals

- To Next, To Object, offset-from-object, and independent two-side extents.
- Taper/draft and thin Extrude.
- Intersect and multi-target participant scope.
- Multi-region disjoint Extrude.
- Public exact Revolve adoption beyond readiness evidence.
- Public path-following Sweep.
- Public connector/rail/continuity Loft.
- Planar-face support unless E3D-S1-16 is promoted before the manifest freezes.
- Sheet bodies, thin/surface Revolve, surface Sweep, and surface Loft.
- Ellipse, conic, and spline solid profiles unless E3D-S1-02 proves and the
  candidate manifest explicitly promotes their implementation.

## 9. Sprint risk register

| Risk | Sprint impact | Response |
|---|---|---|
| Generic Boolean traps or diverges in WASM | Cut cannot meet browser acceptance | E3D-S1-01 gates Cut; never hide the failure with a UI-only mode |
| Monstertruck cannot preserve a curve class end to end | Exact profile scope narrows | E3D-S1-02 records supported classes; unsupported inputs fail before preview |
| `FeatureDefinitionV2` expands beyond one sprint | No portable edit/recompute foundation | Stop visible feature work; split V2 by canonical schema, traversal, evaluator, then UI checkpoints without falling back to journal JSON |
| Construction-plane dependency semantics are incomplete | Off-origin Extrude becomes non-durable | E3D-S1-04 must qualify edit/reload/failure before the support appears in Extrude |
| Region identity churns on ordinary sketch edits | Downstream edit and repair become unreliable | Limit Sprint 1 to named outer/hole edits and define split/merge repair explicitly |
| Qualification is built only at sprint end | Missing evidence discovered too late | E3D-S1-13 starts in parallel with capability gates; every story contributes fixtures incrementally |

## 10. Exit decision

Sprint 1 passes only when every story, fixture, and test named by the frozen
candidate manifest has a passing, checksummed evidence record and the full
production qualification gate succeeds. A waived, skipped, blocked, or failed
candidate item cannot satisfy qualification and forces a nonzero exit. Waivers
may document non-candidate observations only; each records owner, rationale,
expiry, affected evidence, and required follow-up. Removing a candidate item
requires a new manifest revision and complete rerun before qualification begins.
Missing construction-plane support, reverse/symmetric extent, Join, Cut, Sweep,
or Loft public implementation does not fail the frozen New Body Extrude
candidate; presenting an unqualified capability as complete does.
