# Solid Feature Sprint 2 Qualification

**Candidate:** `solid-feature-sprint-2` revision 1  
**Last updated:** 2026-08-27  
**Current decision:** **QUALIFIED**

This is the append-only completion ledger for E3D-S2-01 through E3D-S2-04.
Sprint 1 history remains in
[`solid-feature-sprint-qualification.md`](solid-feature-sprint-qualification.md)
and must not be copied forward as Sprint 2 proof.

## Current gate state

| Gate | State | Evidence or shortcoming |
|---|---|---|
| Scope and semantics | Frozen | Revision 1 is limited to `positive|negative|symmetric` blind New Body Extrude on origin XY/XZ/YZ; Symmetric stores half-distance. |
| Candidate/fixture structure | Passed | Both Sprint manifests pass structural/reference validation; duplicate IDs, invalid sprint IDs, incomplete input, and a synthetic artifact-pending candidate fail closed. The final bundle contains the required manifest-validation and completeness records. |
| Durable/runtime implementation | Automated pass | Durable document, shared preview/commit/recompute conversion, overflow handling, fast-edit fallback, worker payloads, UI normalization, catalog contracts, and renderer packet reuse passed the complete gate. |
| Release-WASM evidence adapter | Passed | Manifest-selected exporter self-tests pass 4/4, including both Sprint 2 durable direction oracles, against the synchronized generated runtime. |
| Six-cell origin-plane matrix | Passed | One production-path Rust/runtime test passes Reverse and Symmetric on XY, XZ, and YZ with exact bounds, preview non-mutation, stable IDs, commits, and durable recompute. |
| Runtime artifact lock | Complete | Build `solid-feature-sprint-2-r1-20260827` and release-WASM SHA-256 `47db4148fd18b2a08467bdc8058b7815dedb30fd49171195364a34f5acef46f7` are locked in both manifest locations. |
| Native/release-WASM parity | Passed | 2/2 descriptor-bound exemplars passed with zero differences. |
| Production browser lifecycle | Passed | Manifest-locked real-worker lifecycle passed with Reverse/Symmetric exact bounds, stale response rejection, cancel restoration, odd-total normalization, durable half-distance, reload/edit, renderer reuse/resource accounting, and success screenshots. |
| Performance regression | Passed | Both locked workloads passed unchanged budgets, 50 edit/cancel cycles each, and zero observed Long Tasks. |
| Immutable bundle | Passed | The post-review-remediation bundle passed isolated validation with 25 records and 109 checksummed files at `artifacts/solid-feature-qualification/runs/20260828T035943Z-solid-feature-sprint-2-r1`. The earlier 23-record bundle remains historical and ineligible. |
| Independent review | Passed | A fresh read-only re-review of the corrected source-bound bundle, implementation, tests, semantics, deferrals, and documentation returned zero findings. |

## Required quantitative and qualitative evidence

- **2/2** manifest parity fixtures pass natively and through the manifest-locked
  generated release WASM with zero comparator differences.
- **6/6** Reverse/Symmetric × origin XY/XZ/YZ cells pass exact world-bounds tests.
- XY Reverse observes bounds `[-5,-3,-4,5,3,0]` mm, centroid
  `[0,0,-2]` mm, volume `240 mm³`, and area `248 mm²`.
- XY Symmetric with stored half-distance 4 mm observes bounds
  `[-5,-3,-4,5,3,4]` mm, centroid `[0,0,0]`, volume `480 mm³`, and area
  `376 mm²`.
- Production JUnit has exactly the manifest-owned suites, at least one case per
  suite, and zero failures, errors, or skips. Screenshots must visibly show
  direction-accurate Reverse and Symmetric geometry previews plus reopened edit
  state; they do not claim a model-space anchored directional arrow.
- The raw performance record passes every locked budget. Command records,
  source identity, fixture descriptor/input hashes, records, and final checksums
  must all bind to candidate revision 1.

## Commands

Structural validation is safe while artifacts are pending:

```powershell
pwsh -NoProfile -File scripts/test-solid-feature-candidate.ps1 `
  -Manifest contracts/solid-feature-candidate/sprint-2.json
pwsh -NoProfile -File contracts/solid-feature-candidate/test/manifest-validation.tests.ps1
```

The full command is recorded in the Sprint 2 spec. It must not run until the
manifest is changed to `qualification_ready` and both runtime hashes equal the
generated release-WASM SHA-256. The harness preserves an existing `current`
directory as a timestamped incomplete run and never overwrites prior evidence.

## Zero-waiver exit rule

Every required story, fixture, test, and artifact must have one passed record.
`failed`, `skipped`, `blocked`, or `waived` cannot satisfy the candidate. A scope
change requires a new manifest revision and a full rerun. The final status may
change to **QUALIFIED** only after the immutable copied bundle passes isolated
validation and an independent reviewer returns zero findings.

## Deferred and known shortcomings

Construction/angled planes, planar faces, Join/Cut, two-side and advanced
terminations, model-space anchored direction handles, taper, thin features,
Revolve, Sweep, and Loft remain deferred for the reasons in the Sprint 2 spec. Consequently this candidate does not complete
the broader E3D-S1-09 story. There are no waivers for those omissions because
they are explicitly non-candidate scope.

## Completion history

### 2026-08-27 — Revision 1 scope freeze

- Froze four Sprint 2 stories and two quantitative XY parity descriptors.
- Generalized story-ID schemas for later numbered sprints without changing any
  Sprint 1 acceptance or evidence.
- Parameterized manifest-selected browser execution and parity comparison so a
  Sprint 2 run emits distinct records while explicit Sprint 1 runs remain valid.
- Structural validation passed for both manifests and the manifest negative
  self-test passed. JavaScript and PowerShell syntax checks passed. The existing
  Sprint 1 release-WASM exporter test remained green after parameterization.
- The new Sprint 2 release-WASM oracle test is implementation-gated: it currently
  fails at `extrude-origin-blind-negative` because the checked-in generated WASM
  predates direction-mode support. This is retained as a shortcoming until
  regeneration and the same test pass; it is not waived.
- Recorded implementation, runtime lock, full qualification, bundle, and
  independent review as pending. No capability is claimed qualified yet.

### 2026-08-27 — Implementation integration and artifact lock

- Implemented the durable `positive|negative|symmetric` contract, exact signed
  and centered native geometry conversion, shared preview/commit/recompute
  path, worker protocol, operation UI, total/half-distance normalization, and
  operation-catalog source contract.
- Added and passed the 6/6 Reverse/Symmetric × XY/XZ/YZ production-path runtime
  matrix. Focused direction tests, 217/217 web unit tests, formatting, production
  TypeScript/build checks, and both manifest validation suites passed.
- Regenerated the release runtime and locked build
  `solid-feature-sprint-2-r1-20260827` to SHA-256
  `c3b29bb24eb67e54b73768e183ab7cff2f92f190c6a31f030226848933413a1d`.
  The previously gated release-WASM exporter suite then passed 4/4.
- The first synchronized browser lifecycle run exposed a test-only hidden-panel
  locator assumption after cancellation; the assertion now uses the stable
  control ID while retaining an accessible-name check when visible. The second
  run exposed an incorrect one-worker expectation across an intentional page
  reload; it now asserts exactly the initial and replacement workers. Neither
  failure changed product state. The corrected manifest-locked lifecycle rerun
  passed 1/1 and produced the required success screenshots.
- Full workspace/lint/WASM/parity/browser/performance evidence generation,
  immutable bundle validation, and independent review remain pending. The
  candidate is qualification-ready but is not yet qualified.

### 2026-08-27 — First full-gate lint stop and correction

- The first full candidate run completed candidate/source/dependency checks and
  the entire locked native workspace suite, then stopped at `clippy -D
  warnings`. Clippy found a manually implemented default on the direction enum;
  it was replaced by a derived default with `Positive` marked explicitly.
- The required focused lint rerun then found a collapsible nested conditional in
  the fast extent-edit fallback. The control flow was collapsed without
  changing its rule: an ineligible or failed fast edit still falls through to
  a full exact rebuild.
- One intervening host attempt failed while `sccache` spawned the very large
  `web-sys` command, before emitting a code diagnostic. The repeatable gate now
  sets two Cargo jobs and unsets `RUSTC_WRAPPER`; under that recorded environment
  the complete workspace/all-target Clippy gate passed with zero warnings.
- All affected generated outputs were rebuilt after the source corrections.
  Build `solid-feature-sprint-2-r1-20260827` is now locked to release-WASM
  SHA-256 `c3b29bb24eb67e54b73768e183ab7cff2f92f190c6a31f030226848933413a1d`.
  No partial evidence from the stopped run is eligible for qualification; the
  complete gate must restart from the beginning.

### 2026-08-27 — Full-gate fixture-oracle stop and correction

- The clean full-gate restart passed candidate/source/dependency checks, the
  complete locked native workspace, zero-warning Clippy, all release-WASM
  compile targets, deterministic generation twice, 217/217 application unit
  tests, 13/13 real release-WASM worker tests, 7/7 parity-comparator self-tests,
  6/6 fixture-bound non-parity tests, and the production build.
- Native evidence generation then stopped the gate before release-WASM parity:
  both new descriptors had not declared their direction-specific oracle fields,
  the native and release-WASM exporters emitted different oracle shapes, and a
  negative native sweep exposed inward shell orientation. This is a failed
  qualification attempt, not eligible evidence and not waived.
- Corrected the reverse conversion to translate the profile opposite the
  support normal and sweep forward, preserving the same exact reverse bounds
  with outward orientation. Added an outward-orientation assertion to every
  Reverse/Symmetric origin-plane matrix cell.
- Declared the direction, half/one-sided distance semantics, measured geometry,
  and stable feature/body observations in both fixture oracles, and aligned the
  native and release-WASM exporter assertion shapes. Focused verification and
  a complete gate restart remain required before any qualification claim.
- The 6/6 matrix rerun passed with its new outward-orientation assertions. The
  regenerated release runtime is now locked in both manifest locations at
  SHA-256 `47db4148fd18b2a08467bdc8058b7815dedb30fd49171195364a34f5acef46f7`;
  the prior hash remains above only as immutable failure history.
- Focused native and release-WASM fixture-oracle validation then passed 2/2 for
  each runtime, but the parity invocation stopped because the comparator still
  required Sprint 1's literal `native-wasm-parity` test ID. The comparator now
  accepts a fixture binding to any test declared with manifest kind `parity`,
  retains unknown-test rejection, and has a negative self-test proving native
  or stale Sprint 1 IDs cannot substitute for the Sprint 2 parity binding.

### 2026-08-27 — Full-gate locked-performance stop

- The next complete restart passed all source, dependency, native workspace,
  zero-warning lint, WASM compile, mirror, deterministic generation, unit,
  release-WASM worker, parity/non-parity self-test, production build, 2/2
  native fixture-oracle, 2/2 release-WASM fixture-oracle, and 2/2 zero-difference
  parity gates. The production direction lifecycle also passed.
- The locked production performance suite stopped the run because one measured
  preview long task was 51 ms against the unchanged 50 ms maximum. Preview p95
  was 9.4 ms, recompute p95 was 31.6 ms, cancellation max was 5.3 ms, and memory
  growth was 13,186,920 bytes; those measurements passed their budgets. The
  single long-task excess is not waived and the incomplete run is ineligible.
- The failed raw performance record is retained before any isolated rerun. An
  unchanged-build focused performance pass and then another complete gate are
  required; repeated failure requires implementation/harness investigation
  rather than relaxing the locked budget.
- The immediate isolated rerun on the unchanged manifest-locked build passed
  both workloads without changing a budget: rectangle preview p95 7.4 ms,
  recompute p95 19.3 ms, cancellation max 3.0 ms, no observed long task, and
  13,177,956-byte memory growth; annulus preview p95 11.9 ms, recompute p95
  26.0 ms, cancellation max 3.2 ms, no observed long task, and 13,321,888-byte
  memory growth. This focused result establishes that the locked profile can
  pass but does not qualify the candidate; another complete gate is required.

### 2026-08-27 — Full-gate unit-concurrency stop and correction

- The following complete restart passed source, dependency, native workspace,
  lint, WASM compile, mirrors, and both deterministic generation passes, then
  stopped with 216/217 application unit tests passing. The preserved command
  log identifies the sole failure as the 20,000-edge unordered profile workload:
  886.2 ms against its unchanged 750 ms ceiling.
- An immediate identical suite rerun passed 217/217 and measured the same
  workload at 55.0 ms, proving the algorithm did not deterministically regress.
  The failure occurred while Node's default file-level test concurrency ran
  multiple independent scale workloads together after the full build pipeline.
- The repeatable `test:unit` command now uses Node's supported
  `--test-concurrency=1` mode. This removes cross-file CPU contention without
  changing any workload, assertion, timeout, dataset size, or quantitative
  ceiling. A serial 217/217 focused pass and another complete gate are required;
  the stopped run remains ineligible.

### 2026-08-27 — Repeated full-gate render-swap performance stop

- The serial-harness complete restart passed every gate through deterministic
  generation, 217/217 unit tests, production build, both runtime fixture-oracle
  sets, 2/2 zero-difference parity, and the direction browser lifecycle.
- The locked performance suite again found exactly one 51 ms long task against
  the unchanged 50 ms maximum, this time during annulus cancellation; all other
  measurements passed. Because the same one-millisecond excess repeated in a
  different phase, it is treated as an implementation performance defect, not
  a host-only outlier, and is not waived.
- Inspection shows every preview and accepted-packet restore disposes and
  recreates the complete WebGL renderer, view cube, navigation listeners, and
  packet geometry on the main thread. Repeated edit/cancel cycles therefore
  accumulate avoidable renderer setup and collection pressure. The correction
  is gated on an in-place packet/body replacement path that reuses renderer
  infrastructure while disposing only packet-owned GPU resources, followed by
  focused locked-performance verification and another complete gate.

### 2026-08-27 — Render-swap correction and focused performance pass

- Replaced complete renderer reconstruction with an in-place packet-resource
  swap for accepted packets, Extrude previews/restores, and advanced-feature
  previews. The WebGL context, camera, viewport state, navigation listeners,
  view cube, scheduler, sketch infrastructure, and appearance state are now
  retained while superseded face, edge, vertex, material, and pick resources
  are explicitly disposed and rebuilt.
- Added read-only lifecycle instrumentation and production-browser assertions.
  Preview, stale-response rejection, and cancel restoration retain one renderer
  instance; after every observed swap, packet installs equal disposals plus one
  live packet, and face/edge/vertex object counts exactly match their current
  pick-record counts. Bounds-derived grid scale/Y, clipping, visibility, and
  picking thresholds follow the replacement packet.
- Corrected performance evidence attribution without relaxing any criterion.
  Raw Long Tasks are classified after collection by their own start timestamps
  against recorded action intervals; unmatched tasks remain unattributed and
  still count against the maximum. Preview and cancellation now include packet
  installation and two stable animation frames, and cancellation additionally
  requires the accepted bounds to be restored.
- The unchanged locked profile then passed both workloads with all 50
  preview/edit/cancel cycles: rectangle preview p95 **55.0 ms**, recompute p95
  **15.5 ms**, cancellation max **52.4 ms**, zero observed Long Tasks, and
  **1,492,916 bytes** memory growth; annulus preview p95 **56.0 ms**, recompute
  p95 **27.4 ms**, cancellation max **54.5 ms**, zero observed Long Tasks, and
  **1,632,576 bytes** memory growth. Attribution unit tests passed 2/2,
  TypeScript/build checks passed, the application unit suite remained green,
  and the direction lifecycle with renderer-resource assertions passed 1/1.
- This focused evidence does not qualify the candidate. A complete gate restart
  and immutable bundle validation remain mandatory.

### 2026-08-27 — Full-gate bundle-validator stop and correction

- The post-performance complete restart passed the full native workspace,
  zero-warning lint, all WASM compile/generation determinism checks, 219/219
  application units, 13/13 release-WASM worker tests, 8/8 comparator tests,
  6/6 non-parity tests, production build, both 2/2 fixture-oracle sets, 2/2
  zero-difference parity, and both production browser suites including the
  unchanged locked performance budgets.
- Final isolated-bundle validation then stopped because its implementation
  still hardcoded `sprint-1.json`, although the active candidate and copied
  input are Sprint 2. The validator now locates exactly one bundled candidate
  manifest whose SHA-256 equals run metadata, then applies the same manifest,
  artifact, fixture, record, command, and checksum checks. Zero or multiple
  hash matches fail closed.
- The stopped bundle records the failed `bundle-integrity` command and is
  ineligible. A source-frozen complete restart remains required; no prior pass
  is substituted or waived.

### 2026-08-27 — Complete automated qualification pass

- The source-frozen restart passed all **25/25** recorded commands with zero
  nonzero exits: the complete native workspace, zero-warning lint, WASM target
  compilation, two deterministic release generations, **219/219** application
  units, **13/13** release-WASM worker tests, **8/8** comparator tests, **6/6**
  non-parity tests, production build, both **2/2** fixture-oracle sets, **2/2**
  zero-difference parity, and both production browser suites.
- Locked performance passed unchanged criteria. Rectangle observed preview p95
  **54.1 ms**, recompute p95 **16.7 ms**, cancel max **51.8 ms**, zero Long
  Tasks, and **1,467,492 bytes** growth. Annulus observed preview p95 **56.0
  ms**, recompute p95 **30.2 ms**, cancel max **58.0 ms**, zero Long Tasks,
  and **1,628,800 bytes** growth.
- The immutable bundle contains **23** passed records and **107** checksummed
  files and passed isolated validation at
  `artifacts/solid-feature-qualification/runs/20260828T033251Z-solid-feature-sprint-2-r1`.
- Automated qualification is complete. Final qualification remains gated on a
  fresh independent review returning zero findings; no review result is yet
  claimed in this entry.

### 2026-08-27 — Independent review findings and evidence-record correction

- The first independent review rejected qualification with two findings. The
  immutable bundle had omitted passed records for required story E3D-S2-04 and
  test `candidate-manifest-validation`, while the frozen exit rule requires one
  passed record for every story, fixture, test, and artifact. The report also
  described only non-self-referential rules as complete. Separately, the Sprint
  2 implementation table still described already-passed automated gates as
  pending.
- Changed E3D-S2-04 to required evidence, mapped manifest validation to its
  recorded candidate-contract command, required all disposition-required
  stories and every manifest test at final completeness, and changed the report
  claim to every candidate story/fixture/test/artifact/evidence rule. Preflight
  may defer only the completeness record that it is in the process of proving;
  final validation requires that record too.
- Updated the Sprint 2 table to the actual automated state without claiming
  qualification. The prior 23-record bundle remains immutable historical
  evidence but is ineligible under the independent finding. A complete
  source-bound rerun, isolated validation, and zero-finding re-review are
  mandatory; neither finding is waived.

### 2026-08-27 — Complete post-review-remediation qualification pass

- The corrected source-frozen restart passed all **25/25** recorded commands
  with zero nonzero exits, including the complete native workspace,
  zero-warning lint, both WASM targets, deterministic release generation,
  **219/219** application units, **13/13** worker tests, **8/8** comparator
  tests, **6/6** non-parity tests, production build, native and release-WASM
  **2/2** fixture oracles, **2/2** zero-difference parity, and both production
  browser suites.
- The corrected bundle contains **25** passed subject records, including
  `story.E3D-S2-04.json`, `test.candidate-manifest-validation.json`, and
  `test.candidate-evidence-completeness.json`. Its report states that every
  candidate story, fixture, test, artifact, and evidence rule passed.
- Locked performance again passed unchanged criteria. Rectangle observed
  preview p95 **54.4 ms**, recompute p95 **15.5 ms**, cancel max **52.1 ms**,
  zero Long Tasks, and **1,464,952 bytes** growth. Annulus observed preview p95
  **58.8 ms**, recompute p95 **25.2 ms**, cancel max **52.5 ms**, zero Long
  Tasks, and **1,639,104 bytes** growth.
- The immutable bundle contains **109** checksummed files and passed isolated
  validation at
  `artifacts/solid-feature-qualification/runs/20260828T035943Z-solid-feature-sprint-2-r1`.
  Automated qualification is complete; the corrected bundle and current
  documentation now require a fresh independent zero-finding review.

### 2026-08-27 — Zero-finding independent completion re-review

- The fresh read-only reviewer confirmed that both prior findings are closed:
  E3D-S2-04 and `candidate-manifest-validation` have passed records and are
  enforced fail-closed, and the implementation ledger/report claim match the
  corrected evidence contract.
- The reviewer independently reran manifest positive/negative validation and
  isolated bundle validation, then verified **25/25** zero-exit commands,
  **25** passed records, **109** checksummed files, **2/2** zero-difference
  native/release-WASM parity, browser JUnit **2/2** with zero failures/errors/
  skips, unchanged performance budgets with zero violations, exact runtime
  identities, six-cell semantics/outward orientation, lifecycle/resource
  behavior, and explicit deferred boundaries.
- The reviewer returned **ZERO FINDINGS**. The independent completion gate
  passes and candidate `solid-feature-sprint-2` revision 1 is **QUALIFIED** at
  `artifacts/solid-feature-qualification/runs/20260828T035943Z-solid-feature-sprint-2-r1`.

### 2026-08-27 — Terminal documentation finding and correction

- A required docs-only review of the terminal qualification edits found one
  stale current-baseline sentence in the initiative: it still described
  Extrude as positive-only despite the qualified Forward/Reverse/Symmetric
  public workflow. The reviewer found no other status, evidence, scope,
  deferral, or history inconsistency.
- Replaced that historical statement with the actual remaining Extrude gap:
  independent two-side values, start offsets, target termination, and other
  advanced extent modes. The finding is not waived; a fresh docs-only
  zero-finding confirmation remains required before completion is claimed.
- That follow-up closed the direction wording but found a second stale baseline
  overstatement saying analytic and spline profiles were sampled before
  modeling. It conflicted with the qualified exact line/arc/circle path.
  Narrowed the remaining gap to unsupported analytic/spline families and
  legacy operation paths; another fresh docs-only zero-finding confirmation is
  required, with no waiver.

### 2026-08-27 — Zero-finding terminal documentation re-review

- The final full four-document re-review confirmed both documentation findings
  closed and returned **ZERO FINDINGS**. It verified consistent qualified scope,
  exact evidence counts and bundle identity, preserved rejection/remediation
  history, and explicit unsupported-profile, advanced-extent, support,
  result-mode, Revolve, Sweep, and Loft deferrals.
- The terminal documentation gate passes. No outstanding Sprint 2 finding,
  waiver, or undocumented shortcoming remains.
