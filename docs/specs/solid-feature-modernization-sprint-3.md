# Offset Construction-Plane Extrude — Sprint 3

- Status: revision 2 qualified after automated qualification and independent ZERO FINDINGS review
- Planning date: 2026-08-28
- Sprint goal: deliver an exact, durable origin-relative offset construction plane and blind New Body Extrude from it
- Parent initiative: [Solid Feature Modernization Initiative Backlog](solid-feature-modernization-initiative.md)
- Qualified baseline: [Extrude Direction Modes — Sprint 2](solid-feature-modernization-sprint-2.md)
- Qualification ledger: [Solid Feature Sprint 3 Qualification](../qualification/solid-feature-sprint-3-qualification.md)
- Frozen candidate: `contracts/solid-feature-candidate/sprint-3.json`

## 1. Outcome and boundary

Sprint 3 adds one evaluated construction-plane recipe: a signed exact offset
from any origin XY, XZ, or YZ plane. A stored construction plane has schema
version, stable plane and component identities, an `offset` definition with a
stable `base_plane` and length-parameter reference `offset`, plus suppression
state. Components retain deterministic `construction_plane_order`.

For base-plane origin `O`, positive unit normal `N`, and signed evaluated offset
`o`, the derived plane origin is exactly `O + oN`. Its X/Y axes, normal,
handedness, and unit scale are inherited from the canonical base frame. A
profile-local point `(x,y)` becomes `O + oN + xX + yY`; omitting the translated
origin is a qualification failure.

The Sprint 3 candidate Extrude boundary retains the qualified Sprint 1/2
behavior after placement:
one exact line/arc/circle material region with holes, blind extent, durable
`positive|negative|symmetric` direction, and `new_body` result. Preview, commit,
edit, recompute, native execution, generated release WASM, and saved documents
must use the same derived frame and durable identities.

This sprint is **offset-only**. It does not imply angled, tangent, three-point,
mid-plane, arbitrary-axis, or topology-derived construction-plane recipes.

## 2. Why this is the next bounded slice

Before this sprint, the qualified origin-plane Extrude foundation discarded
construction-plane references because Rust had no document-owned evaluated
construction-plane map and its modeling transform carried axes but not a plane
origin. The revision 2 Sprint 3 implementation targets that bounded offset gap
and awaits fresh qualification; broader non-offset and topology-derived plane-frame prerequisites still
block later Extrude, Cut, Revolve, Sweep, and Loft tranches.

Offset planes are the smallest production-shaped correction. Revision 2 is
prepared to prove a
signed parameter, dependency ordering, origin-aware placement, edit/recompute,
persistence, suppression, undo/redo, and repair without introducing topology
rebinding or arbitrary-axis selection. Cut is not pulled forward: generic
rotated/curved Boolean execution remains outside the qualified release-WASM
boundary.

## 3. Frozen candidate and traceability

| Sequence | Story | Priority / size | Required outcome |
|---:|---|---|---|
| 1 | E3D-S3-01 | P0 / M | Durable offset-plane definition and canonical serialization |
| 2 | E3D-S3-02 | P0 / L | Signed, exact, origin-aware frame resolution and fail-closed repair |
| 3 | E3D-S3-03 | P0 / L | Exact native/release-WASM New Body Extrude on all origin-relative offset planes and directions |
| 4 | E3D-S3-04 | P0 / L | Unified create/edit/suppress/undo/redo/reload/failure lifecycle |
| 5 | E3D-S3-05 | P0 / M | Distinct, zero-waiver Sprint 3 evidence bundle and independent review |

This sprint advances the offset subset of initiative E3D-01-S01/S02 and the
placement portion of E3D-03. It does not close E3D-01-S02 because planar-face
support and topology repair remain deferred.

### 3.1 Implementation ledger

`Implemented` never means `Qualified`. Retain every failed attempt and
remediation in the qualification ledger.

| Story | State | Completion evidence or shortcoming |
|---|---|---|
| E3D-S3-01 | Qualified | Durable map/order/definition, typed failures, atomic preflight, and exact safe-range behavior passed the complete gate and review. |
| E3D-S3-02 | Qualified | Origin-aware frames, exact zero, transitive recompute, suppression/null behavior, persistence, and repair passed the complete gate and review. |
| E3D-S3-03 | Qualified | Native/release-WASM fixture parity passed 9/9, both oracle validators passed, and independent review found no issues. |
| E3D-S3-04 | Qualified | Source-bound production browser passed 2/2 and its generated-worker lifecycle evidence passed independent review. |
| E3D-S3-05 | Qualified | The immutable bundle validates and the exact-state independent audit returned ZERO FINDINGS. |

## 4. Stories

### E3D-S3-01 — Define a durable evaluated offset construction plane

**Acceptance criteria**

1. The document has a versioned construction-plane map and deterministic
   component order; legacy documents default both collections without changing
   their semantic meaning.
2. An offset definition stores stable `base_plane` and `offset` parameter IDs;
   it never copies a display value in place of parameter identity.
3. Creation/upsert is atomic and rejects duplicate/wrong-component identity,
   a missing or wrong-type parameter, unsafe evaluated length, missing base
   plane, and unknown schema/definition kinds.
4. Canonical Rust/TypeScript/document round trips preserve signed nanometers,
   stable IDs, ordering, and suppression exactly.

### E3D-S3-02 — Resolve signed origin-relative frames fail closed

**Acceptance criteria**

1. XY/XZ/YZ resolve the derived origin as base origin plus signed offset along
   the base normal while retaining the base X/Y/normal orientation.
2. Positive, zero, and negative offsets are exact safe integer nanometers.
3. Plane edits dirty the plane's sketch and feature descendants in stable order;
   unrelated features remain clean.
4. A missing/suppressed plane, missing base, missing/wrong-type/overflowing
   parameter, or invalid dependency enters structured repair state with a field
   path and referenced IDs before preview or commit.
5. Failed preview, edit, recompute, or repair preserves the last accepted
   document hash, bodies, and feature identities.

### E3D-S3-03 — Execute exact blind New Body Extrude from offset planes

**Acceptance criteria**

1. The same normalized request drives native and generated release-WASM
   preview, commit, edit, reload, and recompute.
2. The +12 mm fixture executes XY/XZ/YZ × Forward/Reverse/Symmetric: 9/9 cells
   have declared bounds, centroids, body count, manifold status, outward
   orientation, stable identities, and exact durable parameters.
3. One-sided 10 × 6 × 4 mm cells measure 240 mm³ and symmetric cells 480 mm³;
   Symmetric retains Sprint 2's stored half-distance rule.
4. A -7 mm plane round-trips and an edit to -9 mm translates the result exactly
   without replacing plane, sketch, Extrude feature, or body identity.

### E3D-S3-04 — Unify create, edit, persistence, and repair

**Acceptance criteria**

1. Tool-first and selection-first flows bind the same typed plane/profile
   inputs. Offset-plane entry compares `base_plane_id`, `component_id`, exact
   `offset_nanometers`, `suppressed`, and typed `plane_id`/
   `offset_parameter_id` shapes. Unique-profile Extrude preview compares the
   same accepted semantic hash, stable sketch ID/geometry IDs, explicit profile
   geometry IDs, exact construction-plane support, direction, and nanometer
   distance; newly allocated feature/body/transaction values may differ but
   their typed ID shapes match.
2. `Enter` commits and `Escape` cancels without creating durable state; stale
   previews cannot overwrite a newer accepted result.
3. Plane-offset editing, direction/distance editing, suppress/unsuppress,
   undo/redo, save/reload, and deterministic recompute retain required IDs.
4. Missing base/parameter failures expose actionable field-addressed repair and
   dispatch no Extrude against an unresolved plane.
5. The production generated-WASM workload
   `extrude-offset-plane-rectangle` includes 50 offset-plane
   preview/edit/cancel cycles and retains the locked Sprint 1/2 thresholds,
   sample counts, raw Long Task accounting, memory bound, and renderer-resource
   balance.

### E3D-S3-05 — Qualify without waivers

**Acceptance criteria**

1. The manifest is scope-frozen before runtime artifacts are locked.
2. Every required story, fixture, test, artifact, and completeness rule emits a
   passing content-bound record; no candidate waiver is permitted.
3. Native and release-WASM evidence match every parity fixture with zero
   differences and exact fixture descriptor/input hashes.
4. The isolated immutable bundle validates from bundled inputs only.
5. A fresh independent review reports **ZERO FINDINGS** after all remediation
   and final documentation edits.

## 5. Required fixtures and gates

| Fixture | Required proof |
|---|---|
| `extrude-offset-plane-direction-matrix` | +12 mm XY/XZ/YZ × Forward/Reverse/Symmetric exact world bounds, centroids, volume, orientation, and durable tokens |
| `extrude-offset-plane-signed-edit` | -7 mm round-trip, edit to -9 mm, identity retention, suppression/undo/redo/save/reload/recompute |
| `construction-plane-missing-reference` | Missing base plane is field-addressed and atomic |
| `construction-plane-missing-offset-parameter` | A valid existing-plane edit attempting a missing replacement parameter is field-addressed and atomic; repair restores the accepted binding |
| `construction-plane-wrong-type-offset-parameter` | An unbound wrong-type Boolean parameter is value-addressed; the attempted plane binding is refused atomically and remains repairable |
| `construction-plane-unsafe-offset-parameter` | Exact safe-range overflow is typed, value-addressed, atomic, and repairable |
| `extrude-missing-construction-plane-support` | Real Extrude preview reports missing support before generic request equality |
| `extrude-suppressed-construction-plane-support` | Real Extrude preview reports suppressed support; the candidate datum preview is removed and dependent recompute is blocked while the last accepted body/packet/hash remains unchanged |
| `extrude-invalid-construction-plane-dependency` | Invalid dependency is rejected on load; the unchanged last-valid document is saved/reopened before valid dependency repair, and no preview of the rejected document is claimed |

The repeatable gate retains candidate/schema negative tests, content-addressed
source snapshots, locked dependencies, the complete native workspace, zero-
warning Clippy, all declared WASM targets, document/operation mirrors, two
byte-identical generated builds, serial application units, real release-WASM
worker tests, comparator/non-parity self-tests, production build, both runtime
exporters, zero-difference parity, manifest-bound production browser/JUnit,
locked performance, complete evidence records, checksums, and isolated bundle
validation.

The following revision 1 result is historical and superseded. Its manifest and
immutable run were locked to build
`solid-feature-sprint-3-r1-20260828` and generated release-WASM SHA-256
`5b2b656fce6efb81cadff92f71521610159a87f019925e5ba782f83d9f968177`.
The complete automated gate passed 25/25 commands and produced 28 passed records
and 121 checksummed files at
`artifacts/solid-feature-qualification/runs/20260828T111633Z-solid-feature-sprint-3-r1`.
Web units passed 226/226, worker tests passed 13/13, native and release-WASM
fixture oracles passed 4/4 each, parity passed 4/4 with zero differences, and
the two production-browser tests passed 2/2.

The locked performance run used two warmups, ten measured samples, and 50
edit/cancel cycles per workload with zero violations. Rectangle preview p50/p95
was 53.1/63.2 ms, recompute 12.0/16.7 ms, maximum cancel 66.8 ms, maximum Long
Task 0 ms, and peak heap 1,592,372 bytes. Annulus observations were 52.7/66.8
ms, 17.8/28.6 ms, 63.7 ms, 0 ms, and 1,757,168 bytes. Offset-plane rectangle
observations were 53.2/65.2 ms, 13.7/16.5 ms, 65.6 ms, 0 ms, and 1,756,336
bytes in the same order.

Independent review rejected that revision 1 bundle for the findings retained in
the qualification ledger. Revision 2 supersedes it, expands the fixture set to
nine, and is qualification-ready, but it has not passed a fresh automated gate.
No revision 1 browser, performance, parity, generated artifact, or bundle record
is promoted to revision 2. Sprint 3 remains unqualified until revision 2 passes
the complete source-frozen automated gate, validates its isolated immutable
bundle, and then receives a fresh independent review with zero findings.

### 5.1 Revision 2 prequalification record

Revision 2 remediates lifecycle evidence that previously asserted descriptor
tokens rather than observed execution; typed worker/UI support diagnostics;
suppression/null packet handling; selection clearing; transitive topological
recompute; the exact zero-offset boundary; wrong-type and unsafe offsets within
the exact `±9,007,199,254,740,991` range; missing, suppressed, and invalid
support errors; reachable existing-plane missing-parameter editing; repaired-
runtime identity evidence; native/WASM operation-sequence and error-category
alignment; checked BigInt frame scaling; atomic commit preflight; real preview
operations; and equality of the tested offset-plane tool-first/selection-first
request fields and typed plane/parameter ID shapes. Missing base, parameter, and
support faults cross the real worker/runtime; wrong-type coverage is a typed UI-
boundary injection backed by real native/release-WASM fixtures.

Production generated-worker lifecycle coverage now compares selection-first and
tool-first unique-profile Extrude preview bindings using the same accepted
semantic hash, stable sketch ID/geometry IDs, explicit `profileGeometryIds`,
exact construction-plane support, direction, and nanometer distance. Freshly
allocated feature/body/transaction values differ while retaining matching typed
ID shapes. Construction-plane datum selection clears selected feature, sketch,
and explicit profile context; the browser asserts the exact empty Extrude
selection context before tool-first launch, whose unique-profile resolution
emits explicit `profileGeometryIds`. The shared edit helper accepts
direction-sensitive `Distance` and symmetric `Total length` input labels.
Suppressing the
plane removes the candidate datum preview and blocks dependent recompute without
posting an empty replacement packet; the last accepted body/packet/hash remains
unchanged until valid recompute. The focused production browser check passed 1/1
in 17.3 seconds. It does not substitute for the pending complete source-bound
browser/full automated gate.

The invalid-dependency fixture declares `load,save,reopen,repair`. Document
invariants reject the invalid dependency during `load`; the invalid document is
not saved or reopened. Instead, the unchanged last-valid accepted document is
saved and reopened before a valid dependency repair. Constructing an accepted
invalid runtime merely to claim preview coverage would weaken the product
invariant or falsify evidence. Suppressing a datum removes its candidate preview
and blocks dependent recompute with a repair diagnostic while the last accepted
body, packet, and document hash remain unchanged until valid recompute.
All six revision 1 automated attempts and every explicit deferral remain in the
append-only qualification ledger.

### 5.2 Revision 2 automated qualification record

The prequalification record above remains append-only history. Revision 2 then
passed the complete automated gate while revision 1 remained rejected historical
evidence. The immutable run is
`artifacts/solid-feature-qualification/runs/20260828T135258Z-solid-feature-sprint-3-r2`.

- All 25/25 logged commands passed: application units 232/232, worker tests
  13/13, parity self-tests 11/11, non-parity self-tests 6/6,
  native/release-WASM fixture parity 9/9, and production browser 2/2.
- Native and release-WASM oracle validators, candidate QualificationReady
  validation, and isolated bundle validation passed. The bundle contains 33
  records and 141 checksummed files.
- Runtime build `solid-feature-sprint-3-r2-20260828` is locked to WASM SHA-256
  `865834b5265f23d7ba2348549a93b5d44613a0fd52a34778b3b274ba609a4499`.
  Manifest SHA-256 is
  `97bf837d2c8d8031252acc93484e9e4372d69e3dcee5ba3f6d17aef76267b545`.
  The 584-file source snapshot and dirty-source hash are both
  `e2501912b71848beb3ec70a2640446d6abc9f17bcf09da40d0940304fe79e96f`.

Locked performance recorded zero violations and a 0 ms maximum Long Task for
all workloads:

| Workload | Preview p50/p95 | Recompute p50/p95 | Cancel max | Heap growth |
|---|---:|---:|---:|---:|
| Origin rectangle | 52.3/54.0 ms | 11.9/16.6 ms | 56.7 ms | 1,466,100 bytes |
| Annulus | 52.8/57.1 ms | 21.2/30.2 ms | 57.3 ms | 1,667,588 bytes |
| Offset-plane rectangle | 46.8/56.0 ms | 11.7/19.9 ms | 62.1 ms | 1,672,728 bytes |

The current decision is **AUTOMATED QUALIFICATION PASSED — INDEPENDENT REVIEW
PENDING**. Sprint 3 is **NOT YET QUALIFIED**. All explicit deferrals remain
unchanged, and a fresh zero-finding independent review is the remaining gate.

### 5.3 Revision 2 independent completion review

On 2026-08-28, the mandatory independent reviewer audited the exact revision 2
source, contracts, tests, isolated immutable bundle, and completion documents
and returned exact **ZERO FINDINGS**. The immutable run, command/test counts,
hashes, validators, and performance results in section 5.2 remain unchanged.
Revision 1 remains rejected historical evidence, and all prior attempts,
findings, and remediations remain append-only.

Sprint 3 revision 2 is **QUALIFIED** for only its frozen offset-plane and blind
New Body Extrude scope. Explicit deferrals remain unchanged and unqualified:
angled/arbitrary/tangent/three-point/face-derived planes; support rebinding;
cross-support profile replacement; two-side/start/target extents;
Join/Cut/Intersect; handles/taper/thin; Revolve/Sweep/Loft. No deferred work is
included in this qualification.

## 6. Explicitly deferred work

| Deferred capability | Boundary |
|---|---|
| Angled/arbitrary/tangent/three-point construction planes | Need axis/topology operands, ambiguity, and edit/repair contracts |
| Planar-face support and support rebinding | Need stable current topology evidence, missing-face repair, and cross-recompute identity |
| Cross-support profile replacement | Only source-compatible replacement remains accepted |
| Two-side, start offset, Through All, To Next, To Object | Need shared start/termination and ambiguity semantics |
| Join, Cut, Intersect and target-body scope | Need generic release-WASM Boolean and deterministic participant selection |
| Model-space plane/direction handles | Needs picking, occlusion, camera invariance, and shared parameter identity |
| Taper/draft and thin Extrude | Need offset/draft validity and self-intersection contracts |
| Revolve, Sweep, Loft | Remain separate feature-family tranches after shared placement/extent prerequisites |

No deferred capability may be represented as completed by a disabled control,
reserved reference token, fallback polygon, or test-only fixture.
