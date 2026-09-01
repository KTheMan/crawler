# Solid Feature Sprint 3 Qualification Ledger

- Candidate: `solid-feature-sprint-3`, revision 2
- Scope: signed origin-relative offset construction planes plus blind New Body Extrude
- Current decision: **QUALIFIED — INDEPENDENT REVIEW ZERO FINDINGS**
- Frozen manifest: `contracts/solid-feature-candidate/sprint-3.json`
- Source specification: `docs/specs/solid-feature-modernization-sprint-3.md`
- Qualified prerequisite: Sprint 2 revision 1 at `artifacts/solid-feature-qualification/runs/20260828T035943Z-solid-feature-sprint-2-r1`

This ledger is append-only. Failed attempts, findings, corrections, and deferred
work remain visible. A focused pass never substitutes for a complete
source-frozen restart.

## Current gate state

| Gate | State | Evidence or blocker |
|---|---|---|
| Scope and acceptance | Revision 2 frozen | Offset-only boundary, five required stories, nine parity fixtures, and all explicit deferrals are recorded. |
| Candidate structure | Passed | Revision 2 passed QualificationReady validation and produced 33 records plus 141 checksummed files in an isolated validated bundle. |
| Durable document/runtime | Passed automated gate | Typed support/parameter failures, atomic preflight, transitive topological recompute, suppression, persistence, and repair ran in the complete gate. |
| Native/release-WASM geometry | Passed 9/9 | Both oracle validators passed and native/release-WASM fixture parity passed 9/9. |
| Browser lifecycle | Passed 2/2 | The source-bound production-browser gate passed both tests against the generated worker/runtime. |
| Performance | Passed | All three locked workloads recorded zero violations and a 0 ms maximum Long Task. |
| Runtime lock | Locked | Build `solid-feature-sprint-3-r2-20260828`; WASM SHA-256 `865834b5265f23d7ba2348549a93b5d44613a0fd52a34778b3b274ba609a4499`. |
| Full automated qualification | Passed 25/25 | Immutable run `20260828T135258Z-solid-feature-sprint-3-r2`; isolated bundle validation passed. |
| Independent review | Passed — ZERO FINDINGS | Exact-state source, contracts, tests, immutable bundle, and documentation audit completed with zero findings. Revision 1 remains rejected historical evidence. |

## Story evidence state

| Story | Current state | Blocking evidence |
|---|---|---|
| E3D-S3-01 | Qualified | Durable definitions and typed failure/atomicity contracts passed the complete gate and zero-finding review. |
| E3D-S3-02 | Qualified | Exact zero, transitive recompute, suppression/null behavior, persistence, and repair passed the complete gate and review. |
| E3D-S3-03 | Qualified | Native/release-WASM fixture parity passed 9/9 with both oracle validators passing and zero review findings. |
| E3D-S3-04 | Qualified | Source-bound production browser passed 2/2; generated-worker lifecycle and typed request coverage passed review. |
| E3D-S3-05 | Qualified | Immutable bundle validation and the exact-state independent audit completed with zero findings. |

## Locked candidate boundary

Included:

- durable offset construction planes based on origin XY/XZ/YZ;
- exact signed length parameter and origin-aware derived frame;
- exact line/arc/circle region-with-holes profile transport;
- blind Forward/Reverse/Symmetric New Body Extrude;
- preview/cancel/commit/edit/suppress/unsuppress/undo/redo/save/reload/recompute;
- missing base, reachable missing replacement parameter, wrong-type/unsafe
  parameter, and missing/suppressed/invalid support atomic failure/repair;
- native/release-WASM parity, production browser, and locked performance.

Deferred:

- angled, arbitrary, tangent, three-point, topology-derived, and planar-face supports;
- support rebinding and cross-support profile replacement;
- two-side/start/target extent modes and termination references;
- Join/Cut/Intersect, target scope, model-space handles, taper/thin;
- Revolve, Sweep, and Loft.

## Completion log

### 2026-08-28 — Candidate boundary and harness preparation

- Selected evaluated offset construction planes as the next dependency tranche
  after qualified Sprint 2. Angled and planar-face workflows were deliberately
  excluded rather than partially represented.
- Froze five required story IDs and four content-bound parity fixtures. The +12
  mm matrix declares exact world-space expectations for XY/XZ/YZ × Forward/
  Reverse/Symmetric. The signed lifecycle fixture declares -7 mm round-trip and
  an edit to -9 mm with retained plane/sketch/feature/body identities.
- Added missing-base and missing-offset-parameter structured-error fixtures.
  Both require unchanged accepted document/body state through failure and repair.
- Added a manifest-declared locked offset-plane performance workload without changing global warm-
  up/measured samples, thresholds, cycle count, Long Task ceiling, or memory bound.
- Extended candidate enumeration and runtime fixture ownership for Sprint 3.
  Evidence-record mapping now admits new candidate-local IDs only when their
  kind and exact command match an allowlisted full-gate superset; unfamiliar
  commands still fail closed. Sprint 1/2 mappings remain compatible.
- Added structural rejection for a manifest-named workload absent from the
  locked budget and final evidence checks that require the complete budget
  workload set, exact samples/budgets, candidate runtime identity, zero
  violations, and every observed value within its unchanged ceiling.
- Runtime implementation, exporter adapters/oracles, browser coverage, artifact
  lock, full qualification, immutable validation, and independent review remain
  pending. No capability or qualification is claimed by this entry.

### 2026-08-28 — Structural candidate and negative-harness pass

- `scripts/test-solid-feature-candidate.ps1` passed independently for checked-in
  Sprint 1 revision 5, Sprint 2 revision 1, and artifact-pending Sprint 3
  revision 1, preserving explicit prior-candidate compatibility.
- `contracts/solid-feature-candidate/test/manifest-validation.tests.ps1`
  passed its positive manifests and negative cases: incomplete candidate,
  artifact-pending qualification-ready attempt, duplicate story ID, invalid
  sprint ID, and candidate workload absent from the locked budget.
- Every new JSON file parsed, the modified PowerShell scripts passed parser
  checks, and the release-WASM exporter passed Node syntax validation.
- A manifest/spec/ledger consistency scan confirmed every Sprint 3 story and
  fixture binding, fixture file/identity, manifest-declared performance workload,
  artifact-pending null runtime lock, and explicit angled/planar-face deferral.
- This proves only scope/contract/harness structure. Runtime fixture execution,
  exact oracles, production workflows, performance results, runtime locks,
  evidence records, and review remain pending and unclaimed.

### 2026-08-28 — Implementation and focused-integration checkpoint

- Implemented the versioned durable offset-plane entity, explicit component
  order, signed offset parameter, origin-relative right-handed frame evaluation,
  dependency dirtying, history/versioning support, and native/release-WASM
  create, edit, suppress, frame, and serialization entry points.
- Added exact offset-plane Extrude execution across origin XY/XZ/YZ and
  Forward/Reverse/Symmetric, including region-with-holes transport. Focused
  native document, engine, runtime, history, and versioning tests passed; the
  generated release-WASM artifact was synchronized and locked as build
  `solid-feature-sprint-3-r1-20260828`, SHA-256
  `d9f244b7dae2a355a7000271291bd5185f6f94f1b8f482a5ef01fbf41a9d3c22`.
- Added the production construction-plane command, exact signed-decimal input,
  preview/cancel/commit/edit/suppress flows, tree selection/visibility, datum
  rendering and picking, sketch-on-plane handoff, lifecycle coverage, and the
  manifest-owned performance workload. The synchronized web unit suite passed
  225 tests and the production build passed at this checkpoint.
- The first production-browser attempt failed before plane creation because the
  initially checked-in generated runtime did not yet contain the new plane API.
  Regenerating the release artifact corrected that integration mismatch; the
  failed attempt remains part of this ledger and is not treated as evidence.
- The next production-browser attempt exposed a real tree-row layout defect:
  the plane visibility control was positioned beneath the inspector. The row
  positioning was corrected and the workflow was rerun without forced clicks.
- The subsequent workflow exposed that the canonical storage protocol omitted
  `construction_planes`, so the accepted semantic hash discarded the durable
  entity. Canonical document/map field order and typed plane-definition handling
  were added with deterministic and legacy-compatibility tests; all 14 storage
  protocol tests passed after the correction.
- The rerun then reached signed plane editing and exposed another real defect:
  the durable offset changed, but the dependent sketch/Extrude body packet kept
  its old world bounds. Qualification remains blocked while dependent geometry
  recomputation on plane edit/suppress is corrected and retested. No browser,
  performance, parity, full-gate, or qualification pass is claimed here.

### 2026-08-28 — Release-WASM evidence adapter and parity checkpoint

- Added exact release-WASM evidence ownership for all four frozen Sprint 3
  fixture IDs and kinds. The exporter refuses a missing or extra Sprint 3
  fixture and refuses a known ID whose input kind changes, rather than falling
  through to a generic adapter.
- The positive adapters execute the generated runtime's real construction-plane,
  sketch, Extrude, edit, recompute, save/reopen, suppress, undo, and redo APIs.
  `oracle_assertions` are runtime observations and must canonical-equal the
  complete frozen `expected.result`; they are not copied from the descriptor.
  The emitted success packets retain the measured geometric fields required for
  native/release-WASM parity.
- The negative adapters now reconcile both the legacy runtime diagnostics and
  the typed `missing_construction_plane_base_plane` /
  `missing_construction_plane_offset_parameter` diagnostics to the frozen
  structured errors. Both begin from the same accepted rectangular-body
  baseline as native evidence and prove unchanged accepted document and body
  hashes across rejection and repair.
- The first focused signed-edit self-test found that sorting the observed stable
  IDs changed the descriptor's declared presentation order. The set comparison
  remains order-insensitive, while the evidence packet now preserves the frozen
  construction-plane, sketch, feature, and body order.
- After the dependent-recompute runtime change, the first negative rerun found
  that the missing-base diagnostic had moved from prose to the typed document
  error. Classification was tightened to require the typed code, field path,
  and referenced request entity while retaining the earlier diagnostic mapping.
- The first complete parity run passed all four fixture-oracle validations but
  failed parity for all four records: release-WASM success evidence projected
  only identity fields while native evidence projected full measured geometry,
  and release-WASM negative evidence used a blank baseline while native used an
  accepted rectangular body. These were evidence-adapter setup/projection
  defects, not oracle discrepancies. The adapters were aligned and the failed
  comparison remains recorded here.
- Against final generated runtime SHA-256
  `5b2b656fce6efb81cadff92f71521610159a87f019925e5ba782f83d9f968177`,
  `node --test scripts/test-export-solid-feature-wasm-evidence.mjs` passed all
  six tests, including the Sprint 1 and Sprint 2 regressions. Fresh native and
  release-WASM exports each passed fixture-oracle validation for all four Sprint
  3 fixtures, and the fresh native/release-WASM comparison passed 4/4.
- This is a focused runtime-evidence and parity checkpoint only. Browser
  lifecycle, performance, full immutable evidence generation, complete-gate
  execution, and the mandatory independent zero-finding review remain outside
  this entry; no Sprint 3 qualification decision is claimed here.

### 2026-08-28 — First complete source-bound gate failed at evidence schema indexing

- The first complete source-frozen restart passed candidate contracts, source
  snapshot integrity, dependency pins, the locked native workspace, clippy with
  warnings denied, all five wasm32 compile gates, document and operation mirrors,
  two byte-identical generator passes, 226 web unit tests, the production build,
  four native fixture oracles, four release-WASM fixture oracles, 4/4 parity,
  and both manifest-owned production browser tests.
- The gate then failed closed while indexing the 27 generated evidence records.
  `evidence.schema.json` admitted only scalar or scalar-array oracle values, so
  it rejected the frozen matrix's nine nested case objects even though the
  descriptor-oracle validator and native/WASM comparator had already accepted
  their exact values. No immutable bundle or qualification claim was produced.
- The evidence schema now admits the finite, non-null nested matrix case shape
  while retaining canonical snake_case property names at every object depth. The
  manifest negative suite includes a deterministic nested-matrix positive probe
  and rejects a nested noncanonical property name. This is a harness-schema
  correction only; the frozen fixture, runtime result, artifact hash, budgets,
  and acceptance values were not changed.
- Because this source correction invalidates the first run's source snapshot,
  all partial evidence remains an incomplete archived attempt and the complete
  source-bound gate must restart from the beginning.

### 2026-08-28 — Second complete source-bound gate failed on a transient Windows file mapping

- The complete gate restarted after the schema correction and again passed the
  candidate, source snapshot, dependency, native workspace, clippy, and wasm32
  stages. During generator pass 2, `wasm-bindgen` could not replace the generated
  runtime WASM because Windows returned OS error 1224: a user-mapped section was
  still open on that file.
- The attempt produced no immutable bundle and is not reused. Inspection found
  no current repo-local Vite, Playwright, or Chrome process; unrelated older
  browser automation processes were left untouched. The locked runtime bytes,
  source, fixtures, and budgets were not changed to work around the failure.
- Qualification remains blocked until two standalone byte-identical generator
  passes succeed after the transient mapping is released, followed by another
  complete source-bound restart.
- After the failed process exited and the mapping settled, two standalone
  generator passes completed successfully and both reproduced locked SHA-256
  `5b2b656fce6efb81cadff92f71521610159a87f019925e5ba782f83d9f968177`.
  This clears only the transient retry precondition; the complete gate still
  requires a fresh restart.

### 2026-08-28 — Third complete source-bound gate reproduced the mapped-artifact race

- The next full restart again passed candidate, snapshot, dependency, native,
  clippy, and wasm32 gates, then reproduced Windows OS error 1224 during
  generator pass 1 while copying the generated kernel WASM. The affected file
  changed from the runtime artifact to the kernel artifact, confirming a general
  replace race rather than corrupt candidate bytes. No immutable bundle was
  produced and no partial evidence is reused.
- Both binding generators now write tool output to their normal source or an
  isolated target staging directory, then copy each generated file through a
  bounded retry loop. The runtime generator no longer asks `wasm-bindgen` to
  replace a potentially mapped checked-in file directly. Staging deletion is
  guarded to remain under `target/wasm-bindgen-staging`.
- This repeatability correction does not alter generated contents, the runtime
  lock, geometry, or budgets. Two byte-identical standalone generator passes
  and the locked SHA must pass before a fourth complete source-bound restart.
- Two complete standalone binding/catalog/runtime generator passes then
  succeeded. Runtime SHA-256 was identical at the locked `5b2b656f...` value and
  kernel SHA-256 was identical at `2235047ca631f09f6f7ac1fad074bb93a329e69d6f21ebcb43164721e1c2a789`.
  This clears the generator-repeatability precondition for the next full run.

### 2026-08-28 — Fourth complete source-bound gate failed the locked Long Task ceiling

- The fourth complete restart passed the corrected schema path, both generator
  passes, runtime locks, native/release-WASM fixture oracles, and 4/4 parity,
  then ran the two production-browser tests. The lifecycle passed. The
  performance test rejected `extrude-origin-blind-rectangle` because one
  measured recompute Long Task was 67 ms against the unchanged 50 ms ceiling.
- The recorded preview, recompute, cancellation, and memory observations all
  remained within their budgets, but qualification is conjunctive: the single
  Long Task violation fails the whole attempt. No waiver, sample reduction,
  warm-up change, or threshold relaxation is permitted or applied.
- Host inspection immediately after failure found an unrelated concurrent
  `cargo test --workspace --locked` process. Earlier focused final-artifact runs
  and the first full attempt observed a zero-millisecond Long Task maximum, but
  they cannot substitute for a complete passing restart. This attempt remains
  archived as failed; the next full restart will begin only after host build
  contention clears.

### 2026-08-28 — Production lifecycle and browser-harness closure checkpoint

- After dependent plane-edit recomputation was implemented, the generated-WASM
  workflow retained the construction-plane, sketch, Extrude feature, and body
  identities while translating the accepted body to the exact signed world
  bounds. Suppressing the plane removed its datum and dependent body packet;
  unsuppressing recomputed both atomically.
- The first post-fix browser rerun exposed a harness interaction with the Undo
  toolbar control, which is deliberately hidden in the production layout. The
  test was corrected to use the supported `Ctrl+Z` and `Ctrl+Y` commands rather
  than a forced or hidden-element click. A later rerun found the same harness
  mistake at explicit Save; it was corrected to use the supported `Ctrl+S`
  command. These were test-driver defects, not product failures, and no forced
  clicks were introduced.
- The next rerun completed save/reload and exact geometry recovery, then failed
  because the test expected `Recompute from here` to preserve the pre-recompute
  semantic hash. A successful recompute is intentionally accepted as a normal,
  undoable transaction, so it advances the durable revision/journal and changes
  that hash. The assertion now requires a new accepted hash while separately
  requiring unchanged stable IDs and exact body bounds.
- Against locked build `solid-feature-sprint-3-r1-20260828` and generated
  release-WASM SHA-256
  `5b2b656fce6efb81cadff92f71521610159a87f019925e5ba782f83d9f968177`,
  the corrected production construction-plane lifecycle passed 1/1 in 24.1 s.
  It covers preview/cancel/create, tree visibility, sketch support, Forward,
  Reverse and Symmetric Extrude, stale preview ordering, signed plane edit,
  undo/redo, suppress/unsuppress, explicit save, reload/recovery, recompute,
  exact bounds, stable identities, and balanced renderer packet ownership.
- Focused TypeScript construction-plane/sketch/adapter tests passed 17/17;
  canonical storage protocol tests passed 14/14, including Rust-compatible
  construction-plane field/map ordering and all prior recovery/compatibility
  cases. TypeScript checking completed without diagnostics. The independently
  executed complete web unit suite passed 226/226.
- An earlier locked performance run passed all three workloads with the frozen
  two warmups, ten measured samples, 50 edit/cancel cycles, zero Long Tasks,
  and memory below the unchanged ceiling, but it preceded the final `5b2b...`
  runtime lock and is not promoted as final evidence. A fresh final-artifact
  performance run, the complete source-frozen qualification gate, immutable
  bundle validation, and the mandatory independent zero-finding review remain
  required before changing the qualification decision.

### 2026-08-28 — Operation-catalog mapped-file remediation

- Complete source-bound qualification attempt 5 passed its preceding native,
  lint, WASM, parity, browser, and generated-artifact work, then failed during
  generator pass 2 when the Rust operation-catalog example wrote directly to
  `contracts/operation-schema/catalog.v1.json`. Windows returned OS error 1224
  because a user-mapped section of the destination was still open. This failed
  attempt is retained and did not produce a qualifying bundle.
- `scripts/generate-operation-catalog.ps1` now writes the Rust output to a
  per-process, per-invocation directory beneath guarded
  `target/operation-catalog-staging`, then copies that one file to the checked-in
  destination with the same bounded 30-attempt, 500 ms retry used by the
  contract-binding and part-runtime generators. The staging path is normalized
  and required to remain below its intended target root before creation, and
  the unique staging directory is removed in `finally`.
- PowerShell parser validation completed with zero errors. Two complete catalog
  generations then passed consecutively, left zero staging entries, and retained
  byte-identical SHA-256
  `ad5673ef974112e631a3813894496449f9d02eedfefbb51e22f4c3cf679aad1`
  before, after pass 1, and after pass 2. No generated catalog bytes, runtime
  bytes, performance budgets, or qualification semantics changed.
- The existing full-gate repeatability check already snapshots the catalog,
  runs the complete generator set twice, requires identical output file sets
  and bytes, and requires pass-2 output to equal the qualification-start bytes;
  no duplicate test path was added. A fresh complete source-bound restart and
  the mandatory independent zero-finding review remain required.

### 2026-08-28 — Host-contention clearance before fifth complete restart

- The unrelated `trestle-support-engine` workspace test and every observed
  Cargo, Rust compiler, and spawned test descendant exited without intervention.
  Two independent read-only monitors then observed a continuous idle interval of
  at least 60 seconds; the root monitor extended that interval to 90 seconds.
- PowerShell parsing passed for both hardened generators, `git diff --check`
  passed, and the candidate manifest validation suite passed before this source
  boundary was frozen. The fifth attempt will restart the complete qualification
  gate and will not reuse any partial evidence from the four failed attempts.

### 2026-08-28 — Complete automated qualification passed; independent review pending

- The fresh source-bound restart completed all 25/25 declared commands and
  produced immutable run
  `artifacts/solid-feature-qualification/runs/20260828T111633Z-solid-feature-sprint-3-r1`.
  The bundle contains 28 passed evidence records and 121 checksummed files and
  passed isolated validation from its bundled manifest, fixtures, schemas, and
  evidence rather than mutable working-tree inputs.
- The run is locked to build `solid-feature-sprint-3-r1-20260828` and generated
  release-WASM SHA-256
  `5b2b656fce6efb81cadff92f71521610159a87f019925e5ba782f83d9f968177`.
  The complete web unit suite passed 226/226 and the release-WASM worker suite
  passed 13/13.
- Native fixture-oracle evidence passed 4/4 and release-WASM fixture-oracle
  evidence passed 4/4. All 4/4 native/release-WASM comparisons passed with zero
  differences.
- Both production-browser tests passed 2/2. They cover the complete accepted
  create/edit/persistence/recovery lifecycle and the locked performance suite
  against the generated runtime.
- Exact locked performance observations were:
  - `extrude-origin-blind-rectangle`: preview p50/p95 53.1/63.2 ms,
    recompute p50/p95 12.0/16.7 ms, maximum cancellation latency 66.8 ms,
    maximum Long Task 0 ms, and peak heap 1,592,372 bytes;
  - `extrude-origin-annulus`: preview p50/p95 52.7/66.8 ms, recompute p50/p95
    17.8/28.6 ms, maximum cancellation latency 63.7 ms, maximum Long Task 0 ms,
    and peak heap 1,757,168 bytes;
  - `extrude-offset-plane-rectangle`: preview p50/p95 53.2/65.2 ms,
    recompute p50/p95 13.7/16.5 ms, maximum cancellation latency 65.6 ms,
    maximum Long Task 0 ms, and peak heap 1,756,336 bytes.
  Each workload used the frozen 2 warmups, 10 measured samples, and 50
  edit/cancel cycles and reported zero violations.
- Stories E3D-S3-01 through E3D-S3-04 are implemented and automated-passed.
  E3D-S3-05 has satisfied its automated bundle requirements but remains open
  until a fresh independent review reports zero findings after documentation
  finalization.
- All explicit deferrals remain unchanged: angled/arbitrary/tangent/three-point
  and topology-derived planes, planar-face support/rebinding, cross-support
  replacement, advanced extents and termination, Join/Cut/Intersect and target
  scope, model-space handles, taper/thin, Revolve, Sweep, and Loft are not part
  of this candidate.
- The current decision is therefore **AUTOMATED QUALIFICATION PASSED —
  INDEPENDENT REVIEW PENDING**. This entry does not claim final qualification.

### 2026-08-28 — Revision 1 rejected by independent review; revision 2 prequalification remediation

- The preceding revision 1 automated result is retained verbatim as immutable
  history, but it is **superseded and rejected for qualification**. Independent
  review found evidence-integrity, runtime-correctness, production-reachability,
  numeric-boundary, worker/UI, and request-coverage defects that the automated
  bundle did not expose. Its 25/25 command result, 28 records, 121 checksummed
  files, browser records, performance samples, build ID, and runtime hash are
  not eligible evidence for revision 2.
- Candidate revision 2 is qualification-ready only. Focused implementation,
  exporter, comparator, native, generated-WASM, UI, worker, and browser-harness
  checks have been used during remediation, but **no revision 2 automated
  qualification pass, immutable bundle, performance pass, or final
  qualification is claimed**. The next eligible evidence must come from a
  fresh source-frozen automated restart, isolated bundle validation, and then a
  fresh independent review that returns zero findings.

#### Retained automated-attempt history

The six revision 1 source-bound attempts remain explicit and are not collapsed
into the revision 2 candidate:

1. Attempt 1 failed closed while indexing nested matrix oracle evidence against
   an underspecified evidence schema.
2. Attempt 2 failed on a transient Windows mapped-section replacement of the
   generated runtime artifact.
3. Attempt 3 reproduced the mapped-artifact race on the generated kernel and
   led to guarded staged generation and bounded replacement retries.
4. Attempt 4 failed the unchanged 50 ms Long Task ceiling under observed host
   build contention; no threshold, samples, warmups, or cycle count changed.
5. Attempt 5 failed while replacing the mapped operation catalog and led to the
   same guarded staging/retry discipline.
6. Attempt 6 produced the revision 1 automated bundle recorded above. It passed
   the automated gate but was subsequently rejected by independent review and
   is historical evidence only.

#### Categorized independent findings and revision 2 remediations

**Evidence integrity and lifecycle execution**

- Native and release-WASM exporters no longer copy descriptor lifecycle tokens
  as proof. A token is recorded only after the corresponding operation executes
  successfully or its declared rejection is observed, and fixture validation
  fails closed when a declared operation is omitted or an unexecuted token is
  added.
- Missing and suppressed support records now use real Extrude preview calls at
  the support boundary. Invalid construction-plane dependency is rejected on
  `load`, before an accepted runtime capable of preview can exist. The unchanged
  last-valid accepted document is then `save`d and `reopen`ed before `repair`
  installs a valid dependency; the rejected invalid document is never saved or
  reopened.
- Repair evidence now evaluates the repaired runtime rather than merely
  rechecking the untouched baseline. It requires a distinct repaired accepted
  hash, a resolvable plane, a successful real Extrude preview where applicable,
  and retained baseline body and feature identity.
- The missing-offset fixture now starts with a valid existing plane. Preview
  and commit perform real existing-plane edit requests that attempt to bind a
  missing replacement parameter; both must emit the same typed diagnostic and
  preserve accepted state. Repair restores the previously accepted parameter
  binding and proves the repaired transition.

**Typed diagnostics, atomicity, and protocol behavior**

- Missing, suppressed, and invalid construction-plane support now emit stable
  codes, `extrude.support`, and referenced IDs before the generic accepted-vs-
  request support equality guard. Missing base, missing replacement parameter,
  and missing/suppressed support faults are exercised through the real worker
  and runtime boundary. The wrong-type case is a typed UI-boundary injection
  backed by real native and release-WASM fixtures; it does not claim a real
  worker fault injection. Unsafe values and cross-component dependency paths
  retain stable field-addressed diagnostics at each boundary actually tested.
- Construction-plane offset preview and commit share atomic preflight. Editing
  an existing plane cannot silently create or rebind an absent replacement
  parameter, and failed preflight leaves document hash, bodies, history, and
  undo/redo state unchanged.
- Suppression and no-active-body transport use one explicit nullable protocol.
  Suppressing a datum removes the candidate datum preview and blocks dependent
  recompute with a repair diagnostic. The last accepted body, renderer packet,
  and accepted-document hash remain unchanged until a valid recompute succeeds;
  the generated worker does not post an empty replacement packet and no accepted
  body is cleared. Worker errors remain typed through the UI instead of being
  flattened into generic prose.

**Dependency and recompute correctness**

- Dirty propagation includes the supported sketch and the transitive closure of
  `Feature.dependencies`, feature inputs, body producers, and topology
  producers. Unrelated branches remain clean.
- Recompute is deterministic topological evaluation, not lexical feature-ID
  order. Each accepted upstream result is rebound into the isolated candidate
  before downstream execution, preventing stale multi-feature bodies.
- Suppress, unsuppress, edit, undo, redo, reload, and recompute now share these
  dependency semantics and the explicit null-body protocol.

**Exact numeric and parity boundaries**

- The signed-edit fixture explicitly evaluates zero offset with exact frame
  origin, body bounds, and stable plane/sketch/feature/body identities. Native
  and release-WASM execute the same `-9 mm -> 0 -> -9 mm` transaction sequence
  and categories before comparing final canonical state.
- The shared construction-plane nanometer bound is exactly
  `[-9,007,199,254,740,991, +9,007,199,254,740,991]`. Boundary values are
  accepted; stored or requested values outside that range fail with the typed
  unsafe diagnostic. Wrong-type and unsafe fixtures preserve the referenced
  parameter ID and observed value through native/WASM evidence.
- Plane-frame scaling uses checked BigInt/intermediate arithmetic before exact
  integer conversion, so JavaScript number precision cannot silently alter a
  signed origin or overflow decision.

**Production UI, worker, and request coverage**

- The tested offset-plane tool-first and selection-first entries construct the
  same request fields: `base_plane_id`, `component_id`, exact
  `offset_nanometers`, `suppressed`, and typed `plane_id` and
  `offset_parameter_id` shapes.
- The production generated-worker lifecycle now also compares selection-first
  and tool-first unique-profile Extrude preview bindings. Both retain the same
  accepted semantic hash, stable sketch ID and geometry IDs, explicit
  `profileGeometryIds`, exact construction-plane support, direction, and
  nanometer distance. Newly allocated feature, body, and transaction values may
  differ, but their typed ID shapes must match. The focused production browser
  check passed 1/1 in 17.3 seconds; the full source-bound gate remains pending.
- Selection is cleared when suppression, deletion, reload, or null active-body
  state invalidates the selected datum/body; inspector state and renderer
  highlights cannot retain a stale entity. Selecting a construction-plane datum
  clears selected feature, sketch, and explicit profile context; the browser
  asserts an exactly empty Extrude selection context before tool-first launch.
  Tool-first unique-profile resolution then emits explicit
  `profileGeometryIds` rather than relying on implicit profile state.
- The shared lifecycle edit helper accepts the direction-sensitive input label:
  `Distance` for forward/reverse and `Total length` for symmetric Extrude.
- Preview/cancel checks exercise real operations. Browser missing-base,
  missing-parameter, and missing/suppressed-support faults cross the real
  worker/runtime and preserve typed responses. Wrong-type coverage injects a
  typed fault at the UI boundary and is backed by real native/release-WASM
  fixtures rather than being represented as a real worker fault injection.

#### Status and unchanged deferrals

- Revision 2 currently has nine parity fixtures: the direction matrix, signed
  edit with exact zero boundary, missing base, reachable missing replacement
  parameter, wrong-type parameter, unsafe parameter, missing support,
  suppressed support, and invalid dependency load/repair.
- All prior deferrals remain unchanged: angled, arbitrary, tangent,
  three-point, topology-derived, and planar-face supports; support rebinding and
  cross-support profile replacement; two-side/start/target extent modes;
  Join/Cut/Intersect and target scope; model-space handles; taper/thin;
  Revolve; Sweep; and Loft.
- The decision remains **NOT QUALIFIED**. A fresh revision 2 automated gate is
  pending; only after it passes and its immutable bundle validates may the
  mandatory independent zero-finding review begin.

### 2026-08-28 — Revision 2 full automated qualification passed; independent review pending

This checkpoint supersedes the revision 2 prequalification status above without
rewriting it. Revision 1 remains rejected, immutable historical evidence.
Revision 2 is **NOT YET QUALIFIED** because the mandatory independent review is
still pending.

- The complete gate passed all 25/25 logged commands. Application units passed
  232/232, worker tests 13/13, parity self-tests 11/11, non-parity self-tests
  6/6, native/release-WASM fixture parity 9/9, and production browser 2/2.
- Native and release-WASM oracle validators passed. Candidate
  QualificationReady validation and isolated immutable-bundle validation also
  passed. The bundle contains 33 evidence records and 141 checksummed files.
- The immutable run is
  `artifacts/solid-feature-qualification/runs/20260828T135258Z-solid-feature-sprint-3-r2`.
  Runtime build ID is `solid-feature-sprint-3-r2-20260828`; generated WASM
  SHA-256 is
  `865834b5265f23d7ba2348549a93b5d44613a0fd52a34778b3b274ba609a4499`;
  manifest SHA-256 is
  `97bf837d2c8d8031252acc93484e9e4372d69e3dcee5ba3f6d17aef76267b545`.
- The 584-file source snapshot and dirty-source hash are both
  `e2501912b71848beb3ec70a2640446d6abc9f17bcf09da40d0940304fe79e96f`.

Locked performance used the declared workload protocol. Every workload recorded
zero violations and a 0 ms maximum Long Task:

| Workload | Preview p50/p95 | Recompute p50/p95 | Cancel max | Heap growth |
|---|---:|---:|---:|---:|
| Origin rectangle | 52.3/54.0 ms | 11.9/16.6 ms | 56.7 ms | 1,466,100 bytes |
| Annulus | 52.8/57.1 ms | 21.2/30.2 ms | 57.3 ms | 1,667,588 bytes |
| Offset-plane rectangle | 46.8/56.0 ms | 11.7/19.9 ms | 62.1 ms | 1,672,728 bytes |

All explicit deferrals remain unchanged. The automated decision is
**AUTOMATED QUALIFICATION PASSED — INDEPENDENT REVIEW PENDING**. No Sprint 3
qualification claim may be made unless the fresh independent review reports
zero findings.

### 2026-08-28 — Independent completion review returned ZERO FINDINGS; Sprint 3 qualified

The mandatory independent reviewer audited the exact revision 2 state across
source, contracts, tests, the isolated immutable bundle, and these completion
documents and returned exact **ZERO FINDINGS**. The qualified evidence remains
the immutable run
`artifacts/solid-feature-qualification/runs/20260828T135258Z-solid-feature-sprint-3-r2`
with all previously recorded counts, hashes, validators, and performance data
unchanged. Revision 1 remains rejected immutable history, and every prior
attempt, finding, and remediation above remains append-only.

The final decision is **QUALIFIED** for only the frozen Sprint 3 revision 2
offset-plane and blind New Body Extrude boundary. Explicit deferrals remain
unchanged and unqualified: angled/arbitrary/tangent/three-point/face-derived
planes; support rebinding; cross-support profile replacement;
two-side/start/target extents; Join/Cut/Intersect; handles/taper/thin;
Revolve/Sweep/Loft. No deferred capability is implied by
this qualification.
